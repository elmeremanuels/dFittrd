/**
 * Shopify app backend (D6, managed installation):
 *  - GET  /shopify/admin           the embedded admin page (shopify.app.toml `application_url`), rendered
 *    by @curtain/shopify-app with a frame-ancestors CSP for the shop + admin.shopify.com.
 *  - GET  /shopify/auth/callback   the toml's required redirect URL; managed installation never needs
 *    it, so it redirects to the embedded app home in the admin.
 *  - POST /shopify/token-exchange  session token → expiring offline access token + refresh token (both
 *    stored encrypted, A3), shop row, metafield definitions, app-data metafields for the theme block
 *    (public key + api url), backfill job. The exchange and the save hold the shop's token lock.
 *  - POST /shopify/webhooks        HMAC-verified; products/*, app/uninstalled, app_subscriptions/update,
 *    the three GDPR topics. Every delivery is logged with its payload for replay (webhook_log).
 *  - /shopify/charts/*, /shopify/products/:id/*  the size chart builder (charts.ts).
 *  - POST /shopify/billing/subscribe  appSubscriptionCreate for the one D17 plan, "Curtain": one recurring
 *    line of USD 8.99 per 30 days, no usage line. A shop billed in a currency our rate table covers is
 *    charged the converted amount; the currency, the USD rate and the price are stored on the shop.
 *    The plan changes only when Shopify reports the subscription ACTIVE (app_subscriptions/update),
 *    and the trial clock starts then too (never at PENDING: a merchant who declines keeps the trial).
 *
 * Uninstall and reinstall (checklist B2): Shopify cancels the subscription on uninstall, and the
 * CANCELLED update never reaches us because the app's webhooks are gone by then. So app/uninstalled
 * resets the shop to `free` with no subscription, a reinstall starts from that state, and every
 * token exchange reconciles the plan with the subscriptions Shopify reports (`reconcileSubscription`).
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { adminAppUrl, adminContentSecurityPolicy, CURTAIN_PLAN, renderAdminPage, setAppDataMetafields, ShopifyGraphqlError, type ActiveSubscription } from '@curtain/shopify-app';
import { z } from 'zod';
import { requireMerchant } from '../auth/merchant.js';
import { isShopifyDomain, verifyShopifySessionToken } from '../auth/shopifySessionToken.js';
import { PLAN_SPECS, remainingTrialDays } from '../billing/plans.js';
import type { Db } from '../db/client.js';
import { shops, webhookLog, type ShopSettings } from '../db/schema.js';
import { JOB } from '../jobs/queue.js';
import { badRequest, conflict, forbidden, serviceUnavailable, unauthorized } from '../lib/errors.js';
import { HOUR } from '../lib/time.js';
import { archiveProduct } from '../services/products.js';
import { clearSettings, createShop, findShopByDomain, issueMerchantKeys, updateSettings, type ShopRow } from '../services/shops.js';
import { shopifyChartRoutes } from './charts.js';
import { billingSettingsPatch } from './client.js';

export const SHOPIFY_TOPICS = [
  'products/create',
  'products/update',
  'products/delete',
  'app/uninstalled',
  'app_subscriptions/update',
  'customers/data_request',
  'customers/redact',
  'shop/redact',
] as const;

export const shopifyRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, queue, shopify, now } = app.ctx;
  // Size chart builder of the embedded admin (charts.ts): templates, bulk assign, description import, checklist, onboarding.
  await app.register(shopifyChartRoutes);

  /** `?shop=` as Shopify sends it, or null when it is not a *.myshopify.com domain. */
  const shopParam = (v: string | undefined): string | null => {
    const d = (v ?? '').trim().toLowerCase();
    return isShopifyDomain(d) ? d : null;
  };

  app.get(
    '/shopify/admin',
    { schema: { querystring: z.object({ shop: z.string().max(255).optional() }).passthrough() }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!env.SHOPIFY_API_KEY) throw serviceUnavailable('shopify_not_configured', 'SHOPIFY_API_KEY/SECRET are not set');
      const html = renderAdminPage({ apiKey: env.SHOPIFY_API_KEY, apiUrl: env.PUBLIC_API_URL, appUrl: env.PUBLIC_APP_URL, appHandle: env.SHOPIFY_APP_HANDLE, billing: env.SHOPIFY_DISTRIBUTION === 'custom' ? 'arranged' : 'shopify' });
      // The page is framed by the Shopify admin: helmet's X-Frame-Options would block it, and the
      // CSP limits framing to this shop and admin.shopify.com (Shopify's embedded-app requirement).
      reply.removeHeader('x-frame-options');
      return reply
        .header('content-security-policy', adminContentSecurityPolicy(shopParam(req.query.shop)))
        .header('cache-control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(html);
    },
  );

  app.get('/shopify/auth/callback', { schema: { querystring: z.object({ shop: z.string().max(255).optional() }).passthrough() } }, async (req, reply) => {
    const shop = shopParam(req.query.shop);
    if (!shop) throw badRequest('bad_shop', 'shop must be a *.myshopify.com domain');
    return reply.redirect(adminAppUrl(shop, env.SHOPIFY_APP_HANDLE), 302);
  });

  app.post(
    '/shopify/token-exchange',
    {
      schema: {
        body: z.object({ shop: z.string().min(3).max(255), sessionToken: z.string().min(16) }),
        response: { 200: z.object({ shopId: z.uuid(), shopDomain: z.string(), publicKeyPrefix: z.string(), scope: z.string(), backfillQueued: z.boolean() }) },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      if (!shopify.configured()) throw serviceUnavailable('shopify_not_configured', 'SHOPIFY_API_KEY/SECRET are not set');
      const shopDomain = req.body.shop.toLowerCase();
      if (!isShopifyDomain(shopDomain)) throw badRequest('bad_shop', 'shop must be a *.myshopify.com domain');
      const claims = await verifyShopifySessionToken(req.body.sessionToken, env.SHOPIFY_API_KEY!, env.SHOPIFY_API_SECRET!, now());
      if (!claims) throw unauthorized('invalid session token', 'invalid_session_token');
      if (claims.shopDomain !== shopDomain) throw forbidden('session token was issued for another shop', 'shop_mismatch');

      // A3: exchange and store under the shop's token lock, so a concurrent refresh cannot retire the new token.
      const { shop, accessToken, scope } = await shopify.lockShop(shopDomain, async () => {
        const tok = await shopify.tokenExchange(shopDomain, req.body.sessionToken);
        let row = await findShopByDomain(db, shopDomain);
        if (!row) row = await createShop(db, { platform: 'shopify', domain: shopDomain, name: shopDomain.replace(/\.myshopify\.com$/, ''), plan: 'free' });
        if (row.uninstalledAt || !row.apiKeyPrefix) {
          // A reinstall starts like a new install: Shopify cancelled the old subscription on uninstall.
          const reset = row.uninstalledAt ? { plan: 'free' as const, billingRef: null } : {};
          await db.update(shops).set({ uninstalledAt: null, purgeAfter: null, paused: false, installedAt: now(), updatedAt: now(), ...reset }).where(eq(shops.id, row.id));
          if (row.uninstalledAt) await clearSettings(db, row.id, SUBSCRIPTION_KEYS);
        }
        if (!row.apiKeyPrefix) await issueMerchantKeys(db, env, row);
        // Custom distribution cannot bill through Shopify: the plan is arranged with the merchant, so
        // an install (and a reinstall, which reset the shop to `free` above) is granted it by hand.
        // A shop already on `curtain` is left alone, so a pause set by the operator survives.
        if (env.SHOPIFY_DISTRIBUTION === 'custom' && (row.uninstalledAt || row.plan !== 'curtain')) {
          await updateSettings(db, row.id, { subscriptionStatus: 'ARRANGED' }, { plan: 'curtain', paused: false, billingRef: null, periodStart: now().toISOString().slice(0, 10) });
        }
        const { accessToken: at, scope: sc, ...expiring } = tok;
        await shopify.saveOfflineSession(row.id, shopDomain, at, sc, expiring);
        return { shop: row, accessToken: at, scope: sc };
      });
      try {
        const r = await shopify.ensureMetafieldDefinitions(shopDomain, accessToken);
        req.log.info({ shopDomain, created: r.created.length, existing: r.existing.length }, 'shopify metafield definitions ensured');
      } catch (err) {
        req.log.warn({ err, shopDomain }, 'metafield definitions could not be created (continuing)');
      }
      // Standalone embed (docs/STANDALONE.md §2): the primary domain is a postMessage target.
      try {
        const primaryDomain = await shopify.fetchPrimaryDomainHost(shopDomain, accessToken);
        if (primaryDomain && primaryDomain !== shopDomain) await updateSettings(db, shop.id, { primaryDomain });
      } catch (err) {
        req.log.warn({ err, shopDomain }, 'primary domain could not be read; the embed posts to the myshopify.com origin only (continuing)');
      }
      // B2: the plan follows what Shopify reports (a missed webhook, a reinstall, a legacy subscription).
      try {
        const subs = await shopify.activeSubscriptions(shopDomain, accessToken);
        const r = await reconcileSubscription(db, (await findShopByDomain(db, shopDomain))!, subs, now());
        if (r !== 'unchanged') req.log.info({ shopDomain, result: r }, 'shop plan reconciled with Shopify subscriptions');
      } catch (err) {
        req.log.warn({ err, shopDomain }, 'active subscriptions could not be read; plan left as stored (continuing)');
      }
      const fresh = (await findShopByDomain(db, shopDomain))!;
      // The theme block reads app.metafields.curtain.{public_key,api_url,app_url}; without them the
      // button renders but cannot load the SDK. The public prefix is stable across key rotations, so
      // writing it on every token exchange (each admin open) keeps it correct without a rotation hook.
      try {
        await setAppDataMetafields(shopify.admin(shopDomain, accessToken), { publicKeyPrefix: fresh.apiKeyPrefix!, apiUrl: env.PUBLIC_API_URL, appUrl: env.PUBLIC_APP_URL });
      } catch (err) {
        req.log.warn({ err, shopDomain }, 'app-data metafields could not be written; the theme block needs its advanced key/API URL settings (continuing)');
      }
      const jobId = await queue.send(JOB.backfillShopify, { shopId: shop.id }, { singletonKey: `backfill:${shop.id}` });
      return { shopId: fresh.id, shopDomain, publicKeyPrefix: fresh.apiKeyPrefix!, scope, backfillQueued: jobId !== null };
    },
  );

  app.post(
    '/shopify/billing/subscribe',
    {
      schema: {
        // D17 has one plan; the retired names are still accepted from an old admin page and mean `curtain`.
        body: z.object({ plan: z.enum(['curtain', 'starter', 'pro']).default('curtain'), returnUrl: z.url().optional(), test: z.boolean().optional() }),
        response: { 200: z.object({ confirmationUrl: z.string().nullable(), subscriptionId: z.string().nullable(), currency: z.string(), price: z.number(), trialDays: z.number().int(), test: z.boolean() }) },
      },
      preHandler: requireMerchant,
    },
    async (req) => {
      const shop = req.shop!;
      if (shop.platform !== 'shopify') throw badRequest('not_shopify', 'Shopify billing is only for Shopify shops');
      if (env.SHOPIFY_DISTRIBUTION === 'custom') throw conflict('billing_not_available', CUSTOM_BILLING_MESSAGE);
      const token = await shopify.accessTokenFor(shop.domain);
      if (!token) throw unauthorized('shop has no offline token — run token exchange', 'shop_not_installed');
      const spec = PLAN_SPECS.curtain;
      // D17: USD price; a billing currency in the rate table gets the converted amount (rate recorded).
      const currency = await shopify.chargeCurrency(shop.domain, token);
      if (currency.fallback) req.log.warn({ shopDomain: shop.domain, billingCurrency: currency.billingCurrency }, 'no rate for the shop billing currency; charging in USD');
      const test = await billingTestFlag(req.body.test, () => shopify.isDevelopmentStore(shop.domain, token));
      const trialDays = remainingTrialDays(env.BILLING_TRIAL_DAYS, shop.settings.trialStartedAt, now());
      const r = await shopify
        .appSubscriptionCreate(shop.domain, token, {
          name: CURTAIN_PLAN.name,
          returnUrl: req.body.returnUrl ?? `${env.PUBLIC_APP_URL}/merchant?billing=done`,
          priceUsdPerMonth: spec.priceUsdPerMonth,
          trialDays,
          test,
          currencyCode: currency.currencyCode,
          usdRate: currency.usdRate,
        })
        .catch((err: unknown) => {
          // SHOPIFY_DISTRIBUTION says public but the Dev Dashboard says custom (or none chosen yet).
          if (isBillingRefusedForDistribution(err)) {
            req.log.error({ shopDomain: shop.domain }, 'Shopify refused the Billing API for this app: set SHOPIFY_DISTRIBUTION=custom, or use the public-distribution app');
            throw conflict('billing_not_available', CUSTOM_BILLING_MESSAGE);
          }
          throw err;
        });
      await updateSettings(db, shop.id, {
        subscriptionStatus: 'PENDING',
        // The trial clock starts when Shopify reports the subscription ACTIVE, not here (B3).
        ...(r.subscriptionId ? { pendingSubscriptionId: r.subscriptionId } : {}),
        ...billingSettingsPatch(r),
      });
      req.log.info({ shopDomain: shop.domain, currency: r.currencyCode, usdRate: r.usdRate, price: r.price, trialDays, test }, 'shopify subscription created (pending approval)');
      return { confirmationUrl: r.confirmationUrl, subscriptionId: r.subscriptionId, currency: r.currencyCode, price: r.price, trialDays, test };
    },
  );

  /**
   * Test charges: forced by SHOPIFY_BILLING_TEST, always outside production, and on partner
   * development stores (they accept nothing else). In production the merchant's request cannot ask
   * for a test charge (it would be free).
   */
  async function billingTestFlag(requested: boolean | undefined, devStore: () => Promise<boolean>): Promise<boolean> {
    if (env.SHOPIFY_BILLING_TEST !== undefined) return env.SHOPIFY_BILLING_TEST;
    if (env.NODE_ENV !== 'production') return requested ?? true;
    try {
      return await devStore();
    } catch {
      return false;
    }
  }

  app.post('/shopify/webhooks', { config: { rateLimit: false }, bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const raw = req.rawBody ?? Buffer.alloc(0);
    const hmac = header(req.headers['x-shopify-hmac-sha256']);
    if (!shopify.verifyWebhookHmac(raw, hmac)) throw unauthorized('bad webhook hmac', 'bad_hmac');
    const topic = header(req.headers['x-shopify-topic']) ?? '';
    const shopDomain = (header(req.headers['x-shopify-shop-domain']) ?? '').toLowerCase();
    const eventId = header(req.headers['x-shopify-webhook-id']) ?? null;
    // Shopify always sends the delivery id; without it the dedupe index cannot stop a replay of a
    // captured (validly signed) delivery, so refuse rather than process it.
    if (!eventId) throw badRequest('missing_webhook_id', 'X-Shopify-Webhook-Id header is required');
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const shop = shopDomain ? await findShopByDomain(db, shopDomain) : undefined;

    let logged = await db
      .insert(webhookLog)
      .values({ platform: 'shopify', shopId: shop?.id ?? null, shopDomain, topic, eventId, externalId: externalIdOf(payload), payload: loggablePayload(topic, payload), status: 'received' })
      .onConflictDoNothing({ target: [webhookLog.platform, webhookLog.eventId] })
      .returning({ id: webhookLog.id });
    if (logged.length === 0) {
      // A delivery we have seen. Shopify retries a non-2xx answer (8 times over 4 hours), so a
      // delivery whose processing failed is claimed again and reprocessed; any other is acknowledged.
      logged = await db
        .update(webhookLog)
        .set({ status: 'received', error: null, processedAt: null })
        .where(and(eq(webhookLog.platform, 'shopify'), eq(webhookLog.eventId, eventId), eq(webhookLog.status, 'failed')))
        .returning({ id: webhookLog.id });
      if (logged.length === 0) return reply.code(200).send({ ok: true, duplicate: true });
    }
    const logId = logged[0]!.id;
    const finish = (status: 'processed' | 'ignored' | 'failed', error?: string) =>
      db.update(webhookLog).set({ status, processedAt: now(), ...(error ? { error } : {}) }).where(eq(webhookLog.id, logId));

    try {
      switch (topic) {
        case 'products/create':
        case 'products/update': {
          if (!shop) break;
          const gid = typeof payload.admin_graphql_api_id === 'string' ? payload.admin_graphql_api_id : `gid://shopify/Product/${String(payload.id)}`;
          await queue.send(JOB.syncShopifyProduct, { shopId: shop.id, productGid: gid }, { singletonKey: `sync:${shop.id}:${gid}` });
          break;
        }
        case 'products/delete': {
          if (!shop) break;
          await archiveProduct(db, shop.id, String(payload.id));
          break;
        }
        case 'app/uninstalled': {
          if (!shop) break;
          // Shopify cancels the subscription on uninstall; its CANCELLED update never reaches us (the
          // webhooks go with the app), so the shop drops to `free` here. trialStartedAt is kept.
          await db
            .update(shops)
            .set({ uninstalledAt: now(), paused: true, plan: 'free', billingRef: null, purgeAfter: new Date(now().getTime() + 48 * HOUR), updatedAt: now() })
            .where(eq(shops.id, shop.id));
          await clearSettings(db, shop.id, SUBSCRIPTION_KEYS);
          await shopify.deleteSessions(shop.id);
          break;
        }
        case 'app_subscriptions/update': {
          if (!shop) break;
          await applySubscriptionUpdate(db, shop, payload, now());
          break;
        }
        case 'customers/data_request':
        case 'customers/redact':
          // We hold no customer PII (anonymous devices, pseudonymous pairings): nothing to return or erase.
          req.log.info({ topic, shopDomain }, 'GDPR customer topic acknowledged (no customer data held)');
          break;
        case 'shop/redact': {
          if (!shop) break;
          await queue.send(JOB.purgeShop, { shopId: shop.id }, { startAfter: 48 * 3600, singletonKey: `purge:${shop.id}` });
          break;
        }
        default:
          await finish('ignored');
          return reply.code(200).send({ ok: true, ignored: true });
      }
      await finish(shop || topic.startsWith('customers/') ? 'processed' : 'ignored');
    } catch (err) {
      req.log.error({ err, topic, shopDomain }, 'webhook processing failed');
      await finish('failed', err instanceof Error ? err.message : String(err));
      // Not acknowledged: Shopify redelivers with the same X-Shopify-Webhook-Id, which is reprocessed above.
      return reply.code(500).send({ ok: false });
    }
    return reply.code(200).send({ ok: true });
  });
};

const CUSTOM_BILLING_MESSAGE = 'This Curtain app is distributed to your store directly (custom distribution); Shopify does not let it charge through Shopify billing. Your plan is arranged with Curtain.';

/**
 * The userError Shopify returns when an app without public distribution calls the Billing API
 * (wording reported by developers: "Custom apps cannot use the Billing API", "Apps without a public
 * distribution cannot use the Billing API"). Matched loosely: the exact text is not documented.
 */
export function isBillingRefusedForDistribution(err: unknown): boolean {
  return err instanceof ShopifyGraphqlError && err.code === 'user_errors' && /custom apps cannot use the billing api|without a public distribution/i.test(err.message);
}

/** Shopify AppSubscriptionStatus values that end a subscription. */
const ENDED = ['CANCELLED', 'EXPIRED', 'DECLINED'];

/** Settings that describe a subscription; cleared when the shop no longer has one (uninstall). */
const SUBSCRIPTION_KEYS: (keyof ShopSettings)[] = ['subscriptionStatus', 'pendingSubscriptionId', 'legacyPlan'];

/** A Shopify subscription id as stored in billingRef (Stripe ids look different). */
const isShopifySubscription = (ref: string | null): boolean => typeof ref === 'string' && ref.startsWith('gid://shopify/AppSubscription/');

/**
 * The stored plan against the subscriptions Shopify reports (`currentAppInstallation.activeSubscriptions`),
 * on every token exchange. ACTIVE there and not here → applied as an ACTIVE update. None ACTIVE (or
 * FROZEN) while the shop is on `curtain` through a Shopify subscription → `free` and paused, as a
 * cancel would. A plan granted by hand (no Shopify billingRef, e.g. a free pilot) is never touched.
 */
export async function reconcileSubscription(db: Db, shop: ShopRow, subs: Pick<ActiveSubscription, 'id' | 'status'>[], at: Date): Promise<'unchanged' | 'activated' | 'ended'> {
  const active = subs.find((s) => s.status.toUpperCase() === 'ACTIVE');
  if (active) {
    if (shop.plan === 'curtain' && !shop.paused && shop.billingRef === active.id) return 'unchanged';
    await applySubscriptionUpdate(db, shop, { app_subscription: { status: 'ACTIVE', admin_graphql_api_id: active.id } }, at);
    return 'activated';
  }
  if (subs.some((s) => s.status.toUpperCase() === 'FROZEN')) return 'unchanged';
  if (shop.plan !== 'curtain' || !isShopifySubscription(shop.billingRef)) return 'unchanged';
  await updateSettings(db, shop.id, { subscriptionStatus: 'NONE' }, { plan: 'free', paused: true, billingRef: null });
  await clearSettings(db, shop.id, ['legacyPlan']);
  return 'ended';
}

/**
 * APP_SUBSCRIPTIONS_UPDATE (D17). ACTIVE → plan `curtain`, unpaused, this subscription becomes the
 * shop's billingRef. FROZEN (the store's own Shopify bill is unpaid) → paused, plan kept, so ACTIVE
 * resumes it. CANCELLED / EXPIRED / DECLINED of the shop's current subscription → plan `free`,
 * paused. The same statuses for any other subscription (an old one Shopify replaces when the
 * merchant approves a new one, a declined second attempt) change nothing but the log, so they can
 * never pause a shop that is paying. PENDING / ACCEPTED only record the status.
 *
 * The first ACTIVE starts the trial clock (`trialStartedAt`, B3). An ACTIVE for a new subscription
 * (the pending one, or any other than the stored billingRef) ends a pre-D17 legacy plan: Shopify
 * replaces the old subscription when the merchant approves the new one (B2).
 * https://shopify.dev/docs/api/webhooks/latest?reference=toml#list-of-topics-app_subscriptions/update
 */
export async function applySubscriptionUpdate(db: Db, shop: ShopRow, payload: Record<string, unknown>, at: Date): Promise<'activated' | 'frozen' | 'ended' | 'other_subscription' | 'recorded'> {
  const sub = (payload.app_subscription ?? {}) as { status?: string; admin_graphql_api_id?: string };
  const status = (sub.status ?? '').toUpperCase();
  const id = sub.admin_graphql_api_id ?? null;
  const current = shop.billingRef;
  if (status === 'ACTIVE') {
    const legacySwitch = shop.settings.legacyPlan !== undefined && id !== null && (id === shop.settings.pendingSubscriptionId || (current !== null && id !== current));
    await updateSettings(
      db,
      shop.id,
      { subscriptionStatus: status, ...(shop.settings.trialStartedAt ? {} : { trialStartedAt: at.toISOString() }) },
      { plan: 'curtain', paused: false, billingRef: id ?? current, periodStart: shop.plan === 'curtain' && current === id ? shop.periodStart : at.toISOString().slice(0, 10) },
    );
    await clearSettings(db, shop.id, legacySwitch ? ['pendingSubscriptionId', 'legacyPlan'] : ['pendingSubscriptionId']);
    return 'activated';
  }
  const isCurrent = id !== null && current === id;
  if (status === 'FROZEN' && isCurrent) {
    await updateSettings(db, shop.id, { subscriptionStatus: status }, { paused: true });
    return 'frozen';
  }
  if (ENDED.includes(status) && isCurrent) {
    await updateSettings(db, shop.id, { subscriptionStatus: status }, { plan: 'free', paused: true });
    return 'ended';
  }
  if (id !== null && current !== null && current !== id) return 'other_subscription';
  if (ENDED.includes(status) && id !== null && shop.settings.pendingSubscriptionId === id) {
    await updateSettings(db, shop.id, { subscriptionStatus: status });
    await clearSettings(db, shop.id, ['pendingSubscriptionId']);
    return 'recorded';
  }
  await updateSettings(db, shop.id, { subscriptionStatus: status });
  return 'recorded';
}

function header(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * `customers/data_request` and `customers/redact` carry the customer's id, e-mail, phone and
 * order ids (D3: we hold no customer PII, and the replay log must not become the place where it
 * first lands). Only the shop identifiers are kept; every other topic is stored verbatim.
 */
export function loggablePayload(topic: string, payload: Record<string, unknown>): unknown {
  if (!topic.startsWith('customers/')) return payload;
  return {
    redacted: true,
    reason: 'customer PII is never stored (D3)',
    ...(payload.shop_id !== undefined ? { shop_id: payload.shop_id } : {}),
    ...(typeof payload.shop_domain === 'string' ? { shop_domain: payload.shop_domain } : {}),
    ...(typeof payload.data_request === 'object' && payload.data_request ? { data_request: { id: (payload.data_request as { id?: unknown }).id } } : {}),
  };
}

function externalIdOf(payload: Record<string, unknown>): string | null {
  if (payload.id !== undefined && payload.id !== null) return String(payload.id);
  if (typeof payload.shop_id === 'number') return String(payload.shop_id);
  return null;
}
