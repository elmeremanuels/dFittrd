/**
 * The api's Shopify facade: a thin, db-aware wrapper over @curtain/shopify-app (finding #5). The
 * GraphQL client (cost-aware retries), token exchange, webhook HMAC, product queries, metafield
 * definitions and the Billing mutations all live in that package; this class only adds what needs
 * the api's env and database: the API version and URL template from env.ts, the offline access
 * token (and, for expiring tokens, its refresh token) stored AES-GCM encrypted in
 * shopify_sessions, and the shop's billing currency.
 *
 * Expiring offline tokens (App Store requirement 3.1.2, checklist A3):
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 *  - token exchange asks for `expiring=1` (SHOPIFY_EXPIRING_OFFLINE_TOKENS, default on) and stores
 *    the access token, its expiry, the refresh token (encrypted) and the refresh token's expiry;
 *  - `accessTokenFor` refreshes SHOPIFY_TOKEN_REFRESH_MARGIN_SEC before the access token expires,
 *    and every Admin API call made through `admin()` refreshes once and retries on a 401;
 *  - a refresh rotates the refresh token, so both are stored again after every refresh;
 *  - token exchange and refresh for the same shop never run at the same time ("acquiring a token
 *    and refreshing one each retire the other's result"): both go through `lockShop`. The lock is
 *    per process; the api runs as one process with its job runner (D9), so that is enough today.
 *    A second replica would need a database lock here;
 *  - a terminal refresh failure (401) drops the refresh token; the next admin open runs token
 *    exchange again. Until then jobs see no token and skip the shop;
 *  - `refreshDueTokens` (daily job) refreshes dormant shops before the 90-day refresh token runs
 *    out and migrates stored non-expiring tokens to expiring ones.
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import {
  adminGraphqlUrl,
  createAdminClient,
  createAppSubscription,
  createUsageRecord,
  ensureMetafieldDefinitions,
  fetchBillingCurrency,
  fetchPrimaryDomainHost,
  fetchProduct,
  fetchProductsPage,
  isDevelopmentStore,
  migrateToExpiringToken,
  refreshAccessToken,
  requestTokenExchange,
  resolveUsdChargeCurrency,
  ShopifyGraphqlError,
  TokenExchangeError,
  tokenExpiries,
  verifyWebhookHmac,
  type AdminGraphqlClient,
  type EurRates,
  type FetchLike as ShopifyFetchLike,
  type ProductsPage,
  type SubscriptionCreated,
  type SubscriptionPlanInput,
  type TokenExchangeResult,
  type UsdChargeCurrency,
} from '@curtain/shopify-app';
import type { ShopifyProductNode } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { shopifySessions, type ShopSettings } from '../db/schema.js';
import type { Env } from '../env.js';
import { decryptString, encryptString } from '../lib/crypto.js';
import { findShopByDomain } from '../services/shops.js';
import type { FetchLike } from '../context.js';

export type { SubscriptionPlanInput } from '@curtain/shopify-app';

/** What the api stores on the shop about its Shopify subscription currency (in `shops.settings`). */
export interface ShopifyBillingSettings {
  /** ISO 4217 code of the subscription's line item (e.g. `AUD`). */
  billingCurrency?: string;
  /** Pre-D17 subscriptions: 1 EUR = n units of `billingCurrency`. */
  billingEurRate?: number;
  /** D17: 1 USD = n units of `billingCurrency`, fixed at subscription time. */
  billingUsdRate?: number;
  /** D17: the monthly price sent to Shopify, in `billingCurrency`. */
  billingPrice?: number;
}

/** Legacy usage records: the currency fields of a pre-D17 subscription (absent → EUR at rate 1). */
export function shopBillingCurrency(settings: ShopSettings | null | undefined): { currencyCode: string; eurRate: number } {
  const s = (settings ?? {}) as ShopSettings & ShopifyBillingSettings;
  const code = typeof s.billingCurrency === 'string' && /^[A-Z]{3}$/.test(s.billingCurrency) ? s.billingCurrency : 'EUR';
  const rate = typeof s.billingEurRate === 'number' && s.billingEurRate > 0 ? s.billingEurRate : code === 'EUR' ? 1 : undefined;
  if (rate === undefined) throw new ShopifyGraphqlError(`shop bills in ${code} but has no stored EUR rate`, 'user_errors');
  return { currencyCode: code, eurRate: rate };
}

/** Settings patch for `updateSettings` after a D17 subscription was created: currency, rate and price. */
export function billingSettingsPatch(r: { currencyCode: string; usdRate: number; price: number }): Partial<ShopSettings> {
  return { billingCurrency: r.currencyCode, billingUsdRate: r.usdRate, billingPrice: r.price };
}

export interface UsageRecordRequest {
  lineItemId: string;
  description: string;
  amountEur: number;
  idempotencyKey: string;
  currencyCode?: string;
  eurRate?: number;
}

/** The decrypted offline session of a shop. */
export interface OfflineSession {
  accessToken: string;
  scope: string | null;
  /** Null for a non-expiring (legacy) token. */
  expiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}

/** Expiring-token fields of a token exchange / refresh result. */
export type ExpiringTokenFields = Pick<TokenExchangeResult, 'expiresIn' | 'refreshToken' | 'refreshTokenExpiresIn'>;

export interface RefreshDueResult {
  refreshed: number;
  migrated: number;
  failed: number;
}

export class ShopifyClient {
  /** Per-shop serialisation of token exchange and refresh (see the header). */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly fetchImpl: FetchLike,
    /** EUR-based rate table for new subscriptions (default: the package's DEFAULT_EUR_RATES). */
    private readonly eurRates?: EurRates,
    private readonly now: () => Date = () => new Date(),
  ) {}

  configured(): boolean {
    return Boolean(this.env.SHOPIFY_API_KEY && this.env.SHOPIFY_API_SECRET);
  }

  adminUrl(shopDomain: string): string {
    return adminGraphqlUrl(shopDomain, this.env.SHOPIFY_API_VERSION, this.env.SHOPIFY_ADMIN_URL_TEMPLATE);
  }

  /**
   * A package Admin GraphQL client bound to this shop, the env's API version and our fetch. A 401
   * from the Admin API refreshes an expiring token once and repeats the request with the new token.
   */
  admin(shopDomain: string, accessToken: string): AdminGraphqlClient {
    return createAdminClient({
      shopDomain,
      accessToken,
      apiVersion: this.env.SHOPIFY_API_VERSION,
      adminUrlTemplate: this.env.SHOPIFY_ADMIN_URL_TEMPLATE,
      fetch: this.refreshingFetch(shopDomain, accessToken),
    });
  }

  private refreshingFetch(shopDomain: string, accessToken: string): ShopifyFetchLike {
    let token = accessToken;
    return async (url, init) => {
      const res = await this.fetchImpl(url, withAccessToken(init, token));
      if (res.status !== 401) return res;
      const fresh = await this.accessTokenFor(shopDomain, { forceRefresh: true, staleToken: token }).catch(() => null);
      if (!fresh || fresh === token) return res;
      token = fresh;
      return this.fetchImpl(url, withAccessToken(init, token));
    };
  }

  /** HMAC-SHA256 (base64) of the raw body with the API secret — `X-Shopify-Hmac-Sha256`. */
  verifyWebhookHmac(rawBody: Uint8Array | string, header: string | undefined): boolean {
    return verifyWebhookHmac(rawBody, header, this.env.SHOPIFY_API_SECRET);
  }

  async graphql<T>(shopDomain: string, accessToken: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.admin(shopDomain, accessToken).request<T>(query, variables);
  }

  /** The storefront's primary domain host (e.g. `shop.example`), for the embed's allowed origins. */
  async fetchPrimaryDomainHost(shopDomain: string, accessToken: string): Promise<string | null> {
    return fetchPrimaryDomainHost(this.admin(shopDomain, accessToken));
  }

  /** Runs `fn` while no other token exchange or refresh for this shop runs in this process. */
  async lockShop<T>(shopDomain: string, fn: () => Promise<T>): Promise<T> {
    const key = shopDomain.toLowerCase();
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  /**
   * Token exchange (managed installation, D6): session token → offline access token, expiring with
   * a refresh token unless SHOPIFY_EXPIRING_OFFLINE_TOKENS=0. Call it inside `lockShop` together
   * with `saveOfflineSession`, so a refresh cannot retire the new token in between.
   * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
   */
  async tokenExchange(shopDomain: string, sessionToken: string): Promise<{ accessToken: string; scope: string } & ExpiringTokenFields> {
    const r = await requestTokenExchange({
      apiKey: this.env.SHOPIFY_API_KEY ?? '',
      apiSecret: this.env.SHOPIFY_API_SECRET ?? '',
      shopDomain,
      sessionToken,
      ...(this.env.SHOPIFY_EXPIRING_OFFLINE_TOKENS ? { expiring: true } : {}),
      fetch: this.fetchImpl as ShopifyFetchLike,
    });
    return {
      accessToken: r.accessToken,
      scope: r.scope,
      ...(r.expiresIn !== undefined ? { expiresIn: r.expiresIn } : {}),
      ...(r.refreshToken !== undefined ? { refreshToken: r.refreshToken } : {}),
      ...(r.refreshTokenExpiresIn !== undefined ? { refreshTokenExpiresIn: r.refreshTokenExpiresIn } : {}),
    };
  }

  sessionId(shopDomain: string): string {
    return `offline_${shopDomain}`;
  }

  /**
   * Stores the offline session. With `tokens` from an expiring token, the expiry, the refresh token
   * (AES-GCM, like the access token) and its expiry are stored too; without, the token is treated
   * as non-expiring and any stored refresh token is cleared.
   */
  async saveOfflineSession(shopId: string, shopDomain: string, accessToken: string, scope: string, tokens: ExpiringTokenFields = {}): Promise<void> {
    const at = this.now();
    const exp = tokenExpiries(tokens, at);
    const values = {
      id: this.sessionId(shopDomain),
      shopId,
      shopDomain,
      accessTokenEnc: encryptString(accessToken, this.env.ENCRYPTION_KEY),
      scope,
      isOnline: false,
      expiresAt: tokens.refreshToken ? exp.expiresAt : null,
      refreshTokenEnc: tokens.refreshToken ? encryptString(tokens.refreshToken, this.env.ENCRYPTION_KEY) : null,
      refreshTokenExpiresAt: tokens.refreshToken ? exp.refreshTokenExpiresAt : null,
      updatedAt: at,
    };
    await this.db.insert(shopifySessions).values(values).onConflictDoUpdate({ target: shopifySessions.id, set: values });
  }

  /** The stored offline session, decrypted (no refresh). */
  async offlineSession(shopDomain: string): Promise<OfflineSession | null> {
    const row = await this.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.id, this.sessionId(shopDomain)) });
    if (!row) return null;
    return {
      accessToken: decryptString(row.accessTokenEnc, this.env.ENCRYPTION_KEY),
      scope: row.scope,
      expiresAt: row.expiresAt,
      refreshToken: row.refreshTokenEnc ? decryptString(row.refreshTokenEnc, this.env.ENCRYPTION_KEY) : null,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    };
  }

  /**
   * A usable offline access token for the shop, or null (not installed, or an expired token that
   * can no longer be refreshed: the next admin open runs token exchange). An expiring token is
   * refreshed when it expires within the margin; `forceRefresh` (after a 401) refreshes unless
   * another caller already replaced `staleToken`. A transient refresh failure returns the current
   * token while it is still valid and throws otherwise, so a job retries later.
   */
  async accessTokenFor(shopDomain: string, opts: { forceRefresh?: boolean; staleToken?: string } = {}): Promise<string | null> {
    const s = await this.offlineSession(shopDomain);
    if (!s) return null;
    if (!opts.forceRefresh && !this.needsRefresh(s)) return s.accessToken;
    if (!s.expiresAt && !s.refreshToken) return opts.forceRefresh ? null : s.accessToken; // non-expiring: nothing to refresh
    return this.lockShop(shopDomain, async () => {
      const cur = await this.offlineSession(shopDomain);
      if (!cur) return null;
      // Someone else refreshed (or a token exchange stored a new token) while we waited.
      if (opts.forceRefresh && opts.staleToken !== undefined && cur.accessToken !== opts.staleToken) return cur.accessToken;
      if (!opts.forceRefresh && !this.needsRefresh(cur)) return cur.accessToken;
      return this.refreshLocked(shopDomain, cur);
    });
  }

  private needsRefresh(s: OfflineSession): boolean {
    if (!s.expiresAt) return false;
    return s.expiresAt.getTime() - this.env.SHOPIFY_TOKEN_REFRESH_MARGIN_SEC * 1000 <= this.now().getTime();
  }

  /** Refresh with the shop's lock held. */
  private async refreshLocked(shopDomain: string, cur: OfflineSession): Promise<string | null> {
    const now = this.now();
    const stillValid = cur.expiresAt !== null && cur.expiresAt.getTime() > now.getTime();
    if (!cur.refreshToken || (cur.refreshTokenExpiresAt && cur.refreshTokenExpiresAt.getTime() <= now.getTime())) {
      await this.dropRefreshToken(shopDomain);
      return stillValid ? cur.accessToken : null;
    }
    let r: TokenExchangeResult;
    try {
      r = await refreshAccessToken({
        apiKey: this.env.SHOPIFY_API_KEY ?? '',
        apiSecret: this.env.SHOPIFY_API_SECRET ?? '',
        shopDomain,
        refreshToken: cur.refreshToken,
        fetch: this.fetchImpl as ShopifyFetchLike,
      });
    } catch (err) {
      if (err instanceof TokenExchangeError && err.terminal) {
        await this.dropRefreshToken(shopDomain);
        return null;
      }
      if (stillValid) return cur.accessToken;
      throw err;
    }
    await this.storeRefreshed(shopDomain, r);
    return r.accessToken;
  }

  private async storeRefreshed(shopDomain: string, r: TokenExchangeResult): Promise<void> {
    const at = this.now();
    const exp = tokenExpiries(r, at);
    await this.db
      .update(shopifySessions)
      .set({
        accessTokenEnc: encryptString(r.accessToken, this.env.ENCRYPTION_KEY),
        ...(r.scope ? { scope: r.scope } : {}),
        expiresAt: exp.expiresAt,
        refreshTokenEnc: r.refreshToken ? encryptString(r.refreshToken, this.env.ENCRYPTION_KEY) : null,
        refreshTokenExpiresAt: exp.refreshTokenExpiresAt,
        refreshedAt: at,
        updatedAt: at,
      })
      .where(eq(shopifySessions.id, this.sessionId(shopDomain)));
  }

  /** A refresh token Shopify no longer accepts: forget it, keep the (expiring) access token until it runs out. */
  private async dropRefreshToken(shopDomain: string): Promise<void> {
    await this.db.update(shopifySessions).set({ refreshTokenEnc: null, refreshTokenExpiresAt: null, updatedAt: this.now() }).where(eq(shopifySessions.id, this.sessionId(shopDomain)));
  }

  /**
   * Daily job: refresh every expiring session whose refresh token runs out within
   * SHOPIFY_REFRESH_TOKEN_RENEW_DAYS (dormant shops must refresh at least once per 90 days), and
   * migrate stored non-expiring tokens when SHOPIFY_EXPIRING_OFFLINE_TOKENS is on.
   */
  async refreshDueTokens(): Promise<RefreshDueResult> {
    const result: RefreshDueResult = { refreshed: 0, migrated: 0, failed: 0 };
    if (!this.configured()) return result;
    const horizon = new Date(this.now().getTime() + this.env.SHOPIFY_REFRESH_TOKEN_RENEW_DAYS * 86_400_000);
    const rows = await this.db
      .select({ shopDomain: shopifySessions.shopDomain, expiresAt: shopifySessions.expiresAt })
      .from(shopifySessions)
      .where(and(eq(shopifySessions.isOnline, false), or(isNull(shopifySessions.expiresAt), lt(shopifySessions.refreshTokenExpiresAt, horizon))));
    for (const row of rows) {
      try {
        if (row.expiresAt === null) {
          if (!this.env.SHOPIFY_EXPIRING_OFFLINE_TOKENS) continue;
          if (await this.migrateLegacyToken(row.shopDomain)) result.migrated++;
        } else {
          const ok = await this.lockShop(row.shopDomain, async () => {
            const cur = await this.offlineSession(row.shopDomain);
            if (!cur?.refreshToken) return false;
            return (await this.refreshLocked(row.shopDomain, cur)) !== null;
          });
          if (ok) result.refreshed++;
          else result.failed++;
        }
      } catch {
        result.failed++;
      }
    }
    return result;
  }

  /**
   * Non-expiring stored token → expiring token + refresh token (no merchant session needed).
   * https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
   * The old token stops working for the Admin API, so the new pair is stored before anything else.
   * A lost response is recovered by the next run: the same request within seven days returns the
   * same pair.
   */
  async migrateLegacyToken(shopDomain: string): Promise<boolean> {
    return this.lockShop(shopDomain, async () => {
      const cur = await this.offlineSession(shopDomain);
      if (!cur || cur.expiresAt !== null || cur.refreshToken) return false;
      const r = await migrateToExpiringToken({
        apiKey: this.env.SHOPIFY_API_KEY ?? '',
        apiSecret: this.env.SHOPIFY_API_SECRET ?? '',
        shopDomain,
        accessToken: cur.accessToken,
        fetch: this.fetchImpl as ShopifyFetchLike,
      });
      await this.storeRefreshed(shopDomain, r);
      return true;
    });
  }

  async deleteSessions(shopId: string): Promise<void> {
    await this.db.delete(shopifySessions).where(eq(shopifySessions.shopId, shopId));
  }

  async fetchProduct(shopDomain: string, accessToken: string, gid: string): Promise<ShopifyProductNode | null> {
    return fetchProduct(this.admin(shopDomain, accessToken), gid);
  }

  async fetchProductsPage(shopDomain: string, accessToken: string, cursor: string | null): Promise<ProductsPage> {
    return fetchProductsPage(this.admin(shopDomain, accessToken), cursor);
  }

  /**
   * The currency to bill this shop in (D17): `shopBillingPreferences.currency` when the rate table
   * covers it (price converted from USD, rate recorded), else USD. Errors propagate.
   */
  async chargeCurrency(shopDomain: string, accessToken: string): Promise<UsdChargeCurrency & { billingCurrency: string | null }> {
    const info = await fetchBillingCurrency(this.admin(shopDomain, accessToken));
    return { ...resolveUsdChargeCurrency(info.billingCurrency, this.eurRates), billingCurrency: info.billingCurrency };
  }

  /** Partner development stores accept test charges only. */
  async isDevelopmentStore(shopDomain: string, accessToken: string): Promise<boolean> {
    return isDevelopmentStore(this.admin(shopDomain, accessToken));
  }

  /** D17: one recurring line, in `plan.currencyCode` (default USD). */
  async appSubscriptionCreate(shopDomain: string, accessToken: string, plan: SubscriptionPlanInput): Promise<SubscriptionCreated> {
    return createAppSubscription(this.admin(shopDomain, accessToken), plan);
  }

  /**
   * Legacy only (pre-D17 subscriptions with a usage line): one usage record. The nightly rollup
   * computes a zero amount on every current plan, so this is not reached for D17 shops.
   */
  async appUsageRecordCreate(shopDomain: string, accessToken: string, input: UsageRecordRequest): Promise<string | null> {
    let money = input.currencyCode ? { currencyCode: input.currencyCode, eurRate: input.eurRate } : undefined;
    if (!money) money = shopBillingCurrency((await findShopByDomain(this.db, shopDomain))?.settings);
    const r = await createUsageRecord(this.admin(shopDomain, accessToken), {
      lineItemId: input.lineItemId,
      description: input.description,
      amountEur: input.amountEur,
      idempotencyKey: input.idempotencyKey,
      currencyCode: money.currencyCode,
      ...(money.eurRate !== undefined ? { eurRate: money.eurRate } : {}),
    });
    if (r.capReached) throw new ShopifyGraphqlError('appUsageRecordCreate: capped amount reached (merchant must raise the cap)', 'user_errors');
    return r.id;
  }

  /** Creates the $app:curtain metafield definitions (idempotent: TAKEN errors are ignored). */
  async ensureMetafieldDefinitions(shopDomain: string, accessToken: string): Promise<{ created: string[]; existing: string[] }> {
    return ensureMetafieldDefinitions(this.admin(shopDomain, accessToken));
  }
}

/** `init` with the Admin API access token header set to `token` (header names are case-insensitive). */
function withAccessToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers: Record<string, string> = {};
  const h = init?.headers;
  if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) headers[String(k).toLowerCase()] = String(v);
  else if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
  headers['x-shopify-access-token'] = token;
  return { ...init, headers };
}
