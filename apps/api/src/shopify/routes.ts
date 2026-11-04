/**
 * Shopify app backend (D6, managed installation):
 *  - POST /shopify/token-exchange  session token → offline access token (stored encrypted), shop row,
 *    metafield definitions, backfill job.
 *  - POST /shopify/webhooks        HMAC-verified; products/*, app/uninstalled, app_subscriptions/update,
 *    the three GDPR topics. Every delivery is logged with its payload for replay (webhook_log).
 *  - POST /shopify/billing/subscribe  appSubscriptionCreate (Starter + usage line with cappedAmount).
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireMerchant } from '../auth/merchant.js';
import { isShopifyDomain, verifyShopifySessionToken } from '../auth/shopifySessionToken.js';
import { PLAN_SPECS } from '../billing/plans.js';
import { shops, webhookLog } from '../db/schema.js';
import { JOB } from '../jobs/queue.js';
import { badRequest, forbidden, serviceUnavailable, unauthorized } from '../lib/errors.js';
import { HOUR } from '../lib/time.js';
import { archiveProduct } from '../services/products.js';
import { createShop, findShopByDomain, issueMerchantKeys, updateSettings } from '../services/shops.js';

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

      const { accessToken, scope } = await shopify.tokenExchange(shopDomain, req.body.sessionToken);
      let shop = await findShopByDomain(db, shopDomain);
      if (!shop) shop = await createShop(db, { platform: 'shopify', domain: shopDomain, name: shopDomain.replace(/\.myshopify\.com$/, ''), plan: 'free' });
      if (shop.uninstalledAt || !shop.apiKeyPrefix) {
        await db.update(shops).set({ uninstalledAt: null, purgeAfter: null, paused: false, installedAt: now(), updatedAt: now() }).where(eq(shops.id, shop.id));
      }
      if (!shop.apiKeyPrefix) await issueMerchantKeys(db, env, shop);
      await shopify.saveOfflineSession(shop.id, shopDomain, accessToken, scope);
      try {
        const r = await shopify.ensureMetafieldDefinitions(shopDomain, accessToken);
        req.log.info({ shopDomain, created: r.created.length, existing: r.existing.length }, 'shopify metafield definitions ensured');
      } catch (err) {
        req.log.warn({ err, shopDomain }, 'metafield definitions could not be created (continuing)');
      }
      const jobId = await queue.send(JOB.backfillShopify, { shopId: shop.id }, { singletonKey: `backfill:${shop.id}` });
      const fresh = (await findShopByDomain(db, shopDomain))!;
      return { shopId: fresh.id, shopDomain, publicKeyPrefix: fresh.apiKeyPrefix!, scope, backfillQueued: jobId !== null };
    },
  );

  app.post(
    '/shopify/billing/subscribe',
    {
      schema: {
        body: z.object({ plan: z.enum(['starter', 'pro']).default('starter'), returnUrl: z.url().optional(), test: z.boolean().optional() }),
        response: { 200: z.object({ confirmationUrl: z.string().nullable(), subscriptionId: z.string().nullable() }) },
      },
      preHandler: requireMerchant,
    },
    async (req) => {
      const shop = req.shop!;
      if (shop.platform !== 'shopify') throw badRequest('not_shopify', 'Shopify billing is only for Shopify shops');
      const token = await shopify.accessTokenFor(shop.domain);
      if (!token) throw unauthorized('shop has no offline token — run token exchange', 'shop_not_installed');
      const spec = PLAN_SPECS[req.body.plan];
      const r = await shopify.appSubscriptionCreate(shop.domain, token, {
        name: `Paskamer ${spec.name[0]!.toUpperCase()}${spec.name.slice(1)}`,
        returnUrl: req.body.returnUrl ?? `${env.PUBLIC_APP_URL}/merchant?billing=done`,
        priceEurPerMonth: spec.priceEurPerMonth,
        cappedAmountEur: 100,
        overageTerms: `€${spec.overageEurPerSession.toFixed(2)} per try-on session above ${spec.includedSessions} per month`,
        trialDays: spec.trialDays,
        test: req.body.test ?? env.NODE_ENV !== 'production',
      });
      await updateSettings(db, shop.id, { usageLineItemId: r.usageLineItemId ?? undefined, subscriptionStatus: 'PENDING' }, { billingRef: r.subscriptionId, plan: req.body.plan });
      return { confirmationUrl: r.confirmationUrl, subscriptionId: r.subscriptionId };
    },
  );

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

    const logged = await db
      .insert(webhookLog)
      .values({ platform: 'shopify', shopId: shop?.id ?? null, shopDomain, topic, eventId, externalId: externalIdOf(payload), payload: loggablePayload(topic, payload), status: 'received' })
      .onConflictDoNothing({ target: [webhookLog.platform, webhookLog.eventId] })
      .returning({ id: webhookLog.id });
    if (logged.length === 0) return reply.code(200).send({ ok: true, duplicate: true });
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
          await db.update(shops).set({ uninstalledAt: now(), paused: true, purgeAfter: new Date(now().getTime() + 48 * HOUR), updatedAt: now() }).where(eq(shops.id, shop.id));
          await shopify.deleteSessions(shop.id);
          break;
        }
        case 'app_subscriptions/update': {
          if (!shop) break;
          const sub = (payload.app_subscription ?? {}) as { status?: string; admin_graphql_api_id?: string; name?: string };
          const status = (sub.status ?? '').toUpperCase();
          const active = status === 'ACTIVE';
          const dead = ['CANCELLED', 'EXPIRED', 'DECLINED', 'FROZEN'].includes(status);
          const plan = dead ? 'free' : /pro/i.test(sub.name ?? '') ? 'pro' : 'starter';
          await updateSettings(db, shop.id, { subscriptionStatus: status }, { paused: !active, plan, billingRef: sub.admin_graphql_api_id ?? shop.billingRef });
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
    }
    return reply.code(200).send({ ok: true });
  });
};

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
