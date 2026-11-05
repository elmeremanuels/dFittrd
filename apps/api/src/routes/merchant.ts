/**
 * MERCHANT routes (PK-HMAC / Bearer sk_ / Shopify session token). Merchants never receive a
 * measurement, a photo or a device id (AGENTS.md rule 4); analytics apply the k floor.
 */
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AnalyticsSwipesResponseSchema,
  DateRangeQuerySchema,
  HexColorSchema,
  MerchantKeyRotateResponseSchema,
  MerchantLedgerResponseSchema,
  MerchantProductDeleteResponseSchema,
  MerchantProductParamsSchema,
  MerchantProductUpsertRequestSchema,
  MerchantProductUpsertResponseSchema,
  MerchantProductValidateRequestSchema,
  MerchantProductValidateResponseSchema,
  MerchantProductsQuerySchema,
  MerchantProductsResponseSchema,
  UsageResponseSchema,
  validateGarmentDraft,
} from '@curtain/schema';
import { requireMerchant } from '../auth/merchant.js';
import { ledgerEntries, shops } from '../db/schema.js';
import { randomAlnum } from '../lib/crypto.js';
import { badRequest, conflict, notFound, serviceUnavailable } from '../lib/errors.js';
import { periodFor, utcDay } from '../lib/time.js';
import { abandonedAnalytics, swipeAnalytics } from '../services/analytics.js';
import { decodeCursor, encodeCursor } from '../services/ledger.js';
import { archiveProduct, listMerchantProducts, upsertProduct } from '../services/products.js';
import { connectTokenHash, createShop, findShopByConnectToken, findShopByDomain, isPaused, issueMerchantKeys, planInfo, updateSettings } from '../services/shops.js';
import { fitSessionsBetween, usageDays } from '../services/usage.js';

const httpUrl = z.url({ protocol: /^https?$/ });

/** Local DTOs for routes @curtain/schema does not define yet (see README "Open issues"). */
export const ShopSelfRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  siteUrl: httpUrl.optional(),
  brandColor: HexColorSchema.optional(),
  logoUrl: httpUrl.optional(),
  pluginVersion: z.string().max(32).optional(),
  platformVersion: z.string().max(32).optional(),
  /** Merchant opt-in for the "shop ads" surface (WooCommerce settings toggle); persisted in shops.settings.adsEnabled. */
  adsEnabled: z.boolean().optional(),
  /**
   * Extra storefront origins the standalone embed may postMessage to (docs/STANDALONE.md §2), e.g.
   * a headless storefront. Exact https origins; replaces the stored list.
   */
  embedOrigins: z
    .array(z.url({ protocol: /^https$/ }).refine((u) => new URL(u).origin === u.replace(/\/$/, ''), 'must be an origin (no path)'))
    .max(10)
    .optional(),
});
export const ShopSelfResponseSchema = z.object({
  shopId: z.uuid(),
  name: z.string(),
  platform: z.enum(['shopify', 'woocommerce']),
  plan: z.enum(['free', 'starter', 'pro']),
  paused: z.boolean(),
  publicKeyPrefix: z.string().nullable(),
});
export const WooConnectRequestSchema = z.object({
  siteUrl: httpUrl,
  name: z.string().min(1).max(120),
  email: z.email().optional(),
  returnUrl: httpUrl.optional(),
});
export const WooConnectResponseSchema = z.object({
  shopId: z.uuid(),
  connectToken: z.string(),
  mode: z.enum(['stripe', 'manual-key']),
  checkoutUrl: httpUrl.optional(),
});
export const WooCompleteRequestSchema = z.object({ connectToken: z.string().min(16).max(128) });
export const WooCompleteResponseSchema = z.object({
  shopId: z.uuid(),
  apiKey: z.string(),
  publicKeyPrefix: z.string(),
  plan: z.enum(['free', 'starter', 'pro']),
});
export const AbandonedResponseSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  kAnonymityFloor: z.number().int(),
  suppressedGroups: z.number().int(),
  totals: z.object({ sessions: z.number().int(), resolved: z.number().int(), withFit: z.number().int() }),
  byProduct: z.array(z.object({ externalId: z.string(), sessions: z.number().int(), resolved: z.number().int(), withFit: z.number().int(), abandonedRate: z.number() })),
});

export const merchantRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, now, stripe } = app.ctx;

  // ---- products ------------------------------------------------------------------------------
  app.put(
    '/v1/merchant/products/:externalId',
    { schema: { params: MerchantProductParamsSchema, body: MerchantProductUpsertRequestSchema, response: { 200: MerchantProductUpsertResponseSchema } }, preHandler: requireMerchant },
    async (req) => {
      if (req.body.id !== req.params.externalId) throw badRequest('id_mismatch', 'payload.id must equal :externalId');
      const r = await upsertProduct(db, req.shop!.id, req.params.externalId, req.body);
      return {
        externalId: r.product.externalId,
        status: r.status,
        score: r.score,
        missingFields: r.missingFields,
        contentHash: r.product.contentHash,
        changed: r.changed,
        updatedAt: r.product.updatedAt.toISOString(),
      };
    },
  );

  app.post(
    '/v1/merchant/products/validate',
    { schema: { body: MerchantProductValidateRequestSchema, response: { 200: MerchantProductValidateResponseSchema } }, preHandler: requireMerchant },
    async (req) => validateGarmentDraft(req.body.payload),
  );

  app.delete(
    '/v1/merchant/products/:externalId',
    { schema: { params: MerchantProductParamsSchema, response: { 200: MerchantProductDeleteResponseSchema } }, preHandler: requireMerchant },
    async (req) => {
      const ok = await archiveProduct(db, req.shop!.id, req.params.externalId);
      if (!ok) throw notFound('product');
      return { externalId: req.params.externalId, status: 'archived' as const };
    },
  );

  app.get('/v1/merchant/products', { schema: { querystring: MerchantProductsQuerySchema, response: { 200: MerchantProductsResponseSchema } }, preHandler: requireMerchant }, async (req) => {
    return listMerchantProducts(db, req.shop!.id, req.query);
  });

  // ---- usage / ledger / analytics ---------------------------------------------------------------
  app.get('/v1/merchant/usage', { schema: { querystring: DateRangeQuerySchema, response: { 200: UsageResponseSchema } }, preHandler: requireMerchant }, async (req) => {
    const shop = req.shop!;
    const days = await usageDays(db, shop.id, req.query.from, req.query.to);
    const totals = days.reduce(
      (acc, d) => ({ fitSessions: acc.fitSessions + d.fitSessions, heroRenders: acc.heroRenders + d.heroRenders, costUsd: acc.costUsd + d.costUsd }),
      { fitSessions: 0, heroRenders: 0, costUsd: 0 },
    );
    const period = periodFor(shop.periodStart, now());
    const spec = planInfo(shop);
    const used = await fitSessionsBetween(db, shop.id, period.start, utcDay(now()));
    return {
      from: req.query.from,
      to: req.query.to,
      days: days.map((d) => ({ day: d.day, fitSessions: d.fitSessions, heroRenders: d.heroRenders, costUsd: round2(d.costUsd) })),
      totals: { ...totals, costUsd: round2(totals.costUsd) },
      plan: {
        name: shop.plan,
        includedSessions: spec.includedSessions,
        overageEurPerSession: spec.overageEurPerSession,
        periodStart: period.start,
        periodEnd: period.end,
        sessionsUsedThisPeriod: used,
        paused: isPaused(shop),
      },
    };
  });

  app.get(
    '/v1/merchant/ledger',
    { schema: { querystring: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), response: { 200: MerchantLedgerResponseSchema } }, preHandler: requireMerchant },
    async (req) => {
      const c = decodeCursor(req.query.cursor);
      const base = and(eq(ledgerEntries.shopId, req.shop!.id), eq(ledgerEntries.kind, 'hero_render'));
      const where = c ? and(base, or(lt(ledgerEntries.at, c.at), and(eq(ledgerEntries.at, c.at), lt(ledgerEntries.id, c.id)))) : base;
      const rows = await db.select().from(ledgerEntries).where(where).orderBy(desc(ledgerEntries.at), desc(ledgerEntries.id)).limit(req.query.limit + 1);
      const page = rows.slice(0, req.query.limit);
      const last = page[page.length - 1];
      return {
        entries: page.map((r) => ({
          id: r.id,
          at: r.at.toISOString(),
          kind: 'hero_render' as const,
          productExternalId: r.productExternalId ?? '',
          provider: r.payloadSummary.provider ?? 'unknown',
          model: r.payloadSummary.model ?? 'unknown',
          retentionHours: r.payloadSummary.retentionHours ?? 0,
          inputs: (r.inputs ?? ['avatarRender']) as Array<'avatarRender' | 'flatLayPhoto' | 'productPhoto' | 'metadataPrompt'>,
        })),
        nextCursor: rows.length > req.query.limit && last ? encodeCursor({ at: last.at, id: last.id }) : null,
      };
    },
  );

  app.get('/v1/merchant/analytics/swipes', { schema: { querystring: DateRangeQuerySchema, response: { 200: AnalyticsSwipesResponseSchema } }, preHandler: requireMerchant }, async (req) => {
    return swipeAnalytics(db, req.shop!.id, req.query.from, req.query.to, env.K_ANON);
  });

  app.get('/v1/merchant/analytics/abandoned', { schema: { querystring: DateRangeQuerySchema, response: { 200: AbandonedResponseSchema } }, preHandler: requireMerchant }, async (req) => {
    return abandonedAnalytics(db, req.shop!.id, req.query.from, req.query.to, env.K_ANON);
  });

  // ---- keys ------------------------------------------------------------------------------------
  app.post('/v1/merchant/keys/rotate', { schema: { response: { 200: MerchantKeyRotateResponseSchema } }, preHandler: requireMerchant }, async (req) => {
    const { keys, previousKeyValidUntil } = await issueMerchantKeys(db, env, req.shop!);
    return { apiKey: keys.apiKey, publicKeyPrefix: keys.publicKeyPrefix, rotatedAt: now().toISOString(), previousKeyValidUntil: previousKeyValidUntil.toISOString() };
  });

  // ---- WooCommerce: hello + Connect round-trip (D6) ----------------------------------------------
  app.put('/v1/merchant/shops/self', { schema: { body: ShopSelfRequestSchema, response: { 200: ShopSelfResponseSchema } }, preHandler: requireMerchant }, async (req) => {
    const b = req.body;
    const shop = await updateSettings(
      db,
      req.shop!.id,
      { siteUrl: b.siteUrl, brandColor: b.brandColor, logoUrl: b.logoUrl, pluginVersion: b.pluginVersion, platformVersion: b.platformVersion, adsEnabled: b.adsEnabled, embedOrigins: b.embedOrigins?.map((u) => new URL(u).origin) },
      b.name ? { name: b.name } : {},
    );
    return { shopId: shop.id, name: shop.name, platform: shop.platform, plan: shop.plan, paused: isPaused(shop), publicKeyPrefix: shop.apiKeyPrefix };
  });

  /**
   * Step 1 of Connect: the plugin posts the site, we create the shop and (when Stripe is configured)
   * a Checkout session. Without Stripe the merchant gets a manual key path and the free plan.
   */
  app.post(
    '/v1/merchant/woo/connect',
    { schema: { body: WooConnectRequestSchema, response: { 200: WooConnectResponseSchema } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const domain = new URL(req.body.siteUrl).host.toLowerCase();
      if (req.body.returnUrl && new URL(req.body.returnUrl).host.toLowerCase() !== domain) throw badRequest('bad_return_url', 'returnUrl must be on the connected site');
      let shop = await findShopByDomain(db, domain);
      // A domain already installed through another platform (e.g. a Shopify store) can never be
      // re-claimed through the unauthenticated WooCommerce path: that row owns products, usage and ledger.
      if (shop && shop.platform !== 'woocommerce') throw conflict('platform_mismatch', 'this domain is registered through another platform');
      if (shop && shop.connectState === 'complete' && !shop.uninstalledAt) throw conflict('already_connected', 'this site is already connected — rotate the key from the console instead');
      if (!shop) shop = await createShop(db, { platform: 'woocommerce', domain, name: req.body.name, plan: 'free', settings: { siteUrl: req.body.siteUrl } });
      const connectToken = `ct_${randomAlnum(40)}`;
      const mode: 'stripe' | 'manual-key' = stripe.configured() ? 'stripe' : 'manual-key';
      await db
        .update(shops)
        .set({
          name: req.body.name,
          connectTokenHash: connectTokenHash(connectToken),
          connectTokenExpiresAt: new Date(now().getTime() + 3_600_000),
          connectState: mode === 'stripe' ? 'pending' : 'manual',
          uninstalledAt: null,
          updatedAt: now(),
        })
        .where(eq(shops.id, shop.id));
      if (mode === 'manual-key') return { shopId: shop.id, connectToken, mode };
      const returnUrl = req.body.returnUrl ?? req.body.siteUrl;
      const session = await stripe.createCheckoutSession({
        shopId: shop.id,
        shopDomain: domain,
        successUrl: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}curtain=connected`,
        cancelUrl: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}curtain=cancelled`,
        ...(req.body.email ? { email: req.body.email } : {}),
      });
      return { shopId: shop.id, connectToken, mode, checkoutUrl: session.url };
    },
  );

  /** Step 2: after Checkout (webhook marked the shop paid) or directly in manual mode → keys. */
  app.post(
    '/v1/merchant/woo/complete',
    { schema: { body: WooCompleteRequestSchema, response: { 200: WooCompleteResponseSchema } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const shop = await findShopByConnectToken(db, req.body.connectToken);
      if (!shop) throw notFound('connect token');
      if (shop.connectState === 'pending') throw serviceUnavailable('payment_pending', 'checkout not completed yet — retry after the Stripe redirect');
      const { keys } = await issueMerchantKeys(db, env, shop);
      await db.update(shops).set({ connectState: 'complete', connectTokenHash: null, connectTokenExpiresAt: null, updatedAt: now() }).where(eq(shops.id, shop.id));
      return { shopId: shop.id, apiKey: keys.apiKey, publicKeyPrefix: keys.publicKeyPrefix, plan: shop.plan };
    },
  );
};

const round2 = (n: number) => Math.round(n * 100) / 100;
