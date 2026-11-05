/**
 * The api's Shopify facade: a thin, db-aware wrapper over @curtain/shopify-app (finding #5). The
 * GraphQL client (cost-aware retries), token exchange, webhook HMAC, product queries, metafield
 * definitions and the Billing mutations all live in that package; this class only adds what needs
 * the api's env and database: the API version and URL template from env.ts, the offline access
 * token stored AES-GCM encrypted in shopify_sessions, and the shop's billing currency (#6).
 */
import { eq } from 'drizzle-orm';
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
  requestTokenExchange,
  resolveChargeCurrency,
  ShopifyGraphqlError,
  verifyWebhookHmac,
  type AdminGraphqlClient,
  type ChargeCurrency,
  type EurRates,
  type FetchLike as ShopifyFetchLike,
  type ProductsPage,
  type SubscriptionCreated,
  type SubscriptionPlanInput,
} from '@curtain/shopify-app';
import type { ShopifyProductNode } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { shopifySessions, type ShopSettings } from '../db/schema.js';
import type { Env } from '../env.js';
import { decryptString, encryptString } from '../lib/crypto.js';
import { findShopByDomain } from '../services/shops.js';
import type { FetchLike } from '../context.js';

export type { SubscriptionPlanInput } from '@curtain/shopify-app';

/**
 * What the api stores on the shop about its Shopify subscription currency (in `shops.settings`).
 * Usage records reuse exactly this currency and rate, so they always match the subscription.
 */
export interface ShopifyBillingSettings {
  /** ISO 4217 code of the subscription's line items (e.g. `AUD`). Missing = EUR (pre-#6 shops). */
  billingCurrency?: string;
  /** 1 EUR = n units of `billingCurrency`, fixed at subscription time. */
  billingEurRate?: number;
}

/** Read the billing currency fields from a shop's settings (absent → EUR at rate 1). */
export function shopBillingCurrency(settings: ShopSettings | null | undefined): { currencyCode: string; eurRate: number } {
  const s = (settings ?? {}) as ShopSettings & ShopifyBillingSettings;
  const code = typeof s.billingCurrency === 'string' && /^[A-Z]{3}$/.test(s.billingCurrency) ? s.billingCurrency : 'EUR';
  const rate = typeof s.billingEurRate === 'number' && s.billingEurRate > 0 ? s.billingEurRate : code === 'EUR' ? 1 : undefined;
  if (rate === undefined) throw new ShopifyGraphqlError(`shop bills in ${code} but has no stored EUR rate`, 'user_errors');
  return { currencyCode: code, eurRate: rate };
}

/** Settings patch for `updateSettings` after a subscription was created. */
export function billingSettingsPatch(currency: { currencyCode: string; eurRate: number }): Partial<ShopSettings> {
  return { billingCurrency: currency.currencyCode, billingEurRate: currency.eurRate };
}

export interface UsageRecordRequest {
  lineItemId: string;
  description: string;
  amountEur: number;
  idempotencyKey: string;
  /** The subscription's currency; read from the shop's settings when omitted. */
  currencyCode?: string;
  eurRate?: number;
}

export class ShopifyClient {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly fetchImpl: FetchLike,
    /** EUR-based rate table for new subscriptions (default: the package's DEFAULT_EUR_RATES). */
    private readonly eurRates?: EurRates,
  ) {}

  configured(): boolean {
    return Boolean(this.env.SHOPIFY_API_KEY && this.env.SHOPIFY_API_SECRET);
  }

  adminUrl(shopDomain: string): string {
    return adminGraphqlUrl(shopDomain, this.env.SHOPIFY_API_VERSION, this.env.SHOPIFY_ADMIN_URL_TEMPLATE);
  }

  /** A package Admin GraphQL client bound to this shop, the env's API version and our fetch. */
  admin(shopDomain: string, accessToken: string): AdminGraphqlClient {
    return createAdminClient({
      shopDomain,
      accessToken,
      apiVersion: this.env.SHOPIFY_API_VERSION,
      adminUrlTemplate: this.env.SHOPIFY_ADMIN_URL_TEMPLATE,
      fetch: this.fetchImpl as ShopifyFetchLike,
    });
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

  /**
   * Token exchange (managed installation, D6): session token → offline access token.
   * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
   */
  async tokenExchange(shopDomain: string, sessionToken: string): Promise<{ accessToken: string; scope: string }> {
    const r = await requestTokenExchange({
      apiKey: this.env.SHOPIFY_API_KEY ?? '',
      apiSecret: this.env.SHOPIFY_API_SECRET ?? '',
      shopDomain,
      sessionToken,
      fetch: this.fetchImpl as ShopifyFetchLike,
    });
    return { accessToken: r.accessToken, scope: r.scope };
  }

  sessionId(shopDomain: string): string {
    return `offline_${shopDomain}`;
  }

  async saveOfflineSession(shopId: string, shopDomain: string, accessToken: string, scope: string): Promise<void> {
    const values = {
      id: this.sessionId(shopDomain),
      shopId,
      shopDomain,
      accessTokenEnc: encryptString(accessToken, this.env.ENCRYPTION_KEY),
      scope,
      isOnline: false,
      updatedAt: new Date(),
    };
    await this.db.insert(shopifySessions).values(values).onConflictDoUpdate({ target: shopifySessions.id, set: values });
  }

  async accessTokenFor(shopDomain: string): Promise<string | null> {
    const row = await this.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.id, this.sessionId(shopDomain)) });
    return row ? decryptString(row.accessTokenEnc, this.env.ENCRYPTION_KEY) : null;
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
   * The currency to bill this shop in (#6): `shopBillingPreferences.currency` when our rate table
   * covers it, else USD. Errors propagate: never guess EUR for a shop that may not be billed in it.
   */
  async chargeCurrency(shopDomain: string, accessToken: string): Promise<ChargeCurrency & { billingCurrency: string | null }> {
    const info = await fetchBillingCurrency(this.admin(shopDomain, accessToken));
    return { ...resolveChargeCurrency(info.billingCurrency, this.eurRates), billingCurrency: info.billingCurrency };
  }

  /** Recurring line + usage line with cappedAmount (D6), in `plan.currencyCode` (default EUR). */
  async appSubscriptionCreate(shopDomain: string, accessToken: string, plan: SubscriptionPlanInput): Promise<SubscriptionCreated> {
    return createAppSubscription(this.admin(shopDomain, accessToken), plan);
  }

  /**
   * One usage record, in the subscription's currency (the shop's stored `billingCurrency` and rate
   * unless given). A reached cap throws, so the caller keeps the day unpushed and retries.
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
