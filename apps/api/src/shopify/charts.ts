/**
 * Size chart builder (embedded Shopify admin). Merchant-authenticated (Shopify session token) and
 * Shopify-only: every write goes to the shop's `$app:curtain` product metafields through
 * @curtain/shopify-app, and every written product gets the existing sync job, so the shop stays the
 * source of truth (D6) and the products table follows within seconds.
 *
 *  - GET  /shopify/charts/onboarding            the five first-run steps (connect, template, assign, theme block, test)
 *  - PUT  /shopify/charts/onboarding            remember the picked template / confirmed steps (AppInstallation metafield)
 *  - POST /shopify/charts/preview               how many products a selection means (+ a sample)
 *  - POST /shopify/charts/assign                write one chart to a selection, one page per call (`nextCursor`)
 *  - GET  /shopify/products/:id/chart-import    a garment chart + fabric proposed from the description (no write)
 *  - PUT  /shopify/products/:id/chart           write one product's chart (and confirmed fabric/lengths)
 *  - GET  /shopify/products/:id/checklist       completeness checklist + "Try it on" preview link
 *
 * D3: nothing here touches shopper data; the onboarding "tested" fact is the shop's own fit-session
 * count, never a device or a measurement.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ChartAssignRequestSchema,
  ChartAssignResponseSchema,
  ChartPreviewRequestSchema,
  ChartPreviewResponseSchema,
  ChartSpecError,
  OnboardingResponseSchema,
  OnboardingUpdateRequestSchema,
  ProductChartImportResponseSchema,
  ProductChartWriteRequestSchema,
  ProductChartWriteResponseSchema,
  ProductChecklistResponseSchema,
  chartTemplateById,
  checkChart,
  convertChart,
  resolveChartSpec,
  shopifyExternalId,
  type GarmentPayload,
} from '@curtain/schema';
import {
  assignChartToTargets,
  countSelection,
  fetchProductDetail,
  fetchSelectionPage,
  onboardingSteps,
  productChecklist,
  productGid,
  proposeFromDescription,
  readOnboardingState,
  setProductMetafields,
  ShopifyGraphqlError,
  updateOnboardingState,
  type AdminGraphqlClient,
} from '@curtain/shopify-app';
import { z } from 'zod';
import { requireMerchant } from '../auth/merchant.js';
import { products } from '../db/schema.js';
import { JOB } from '../jobs/queue.js';
import { HttpError, badRequest, notFound, unauthorized, unprocessable } from '../lib/errors.js';
import { utcDay } from '../lib/time.js';
import type { ShopRow } from '../services/shops.js';
import { fitSessionsBetween } from '../services/usage.js';

const ProductIdParams = z.object({ id: z.string().regex(/^\d{1,20}$/, 'numeric Shopify product id') });

/** Shopify API failures become a 502 the admin page can show, never a 500 with a stack. */
function upstream(err: unknown): never {
  if (err instanceof ShopifyGraphqlError) {
    if (err.code === 'unauthorized') throw unauthorized('the shop’s Shopify token was refused — reopen the app to reconnect', 'shop_not_installed');
    throw new HttpError(502, 'shopify_error', `Shopify: ${err.message}`);
  }
  throw err;
}

export const shopifyChartRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, queue, shopify, now } = app.ctx;

  /** The authenticated Shopify shop and an Admin client with its offline token. */
  async function adminFor(shop: ShopRow | undefined): Promise<{ shop: ShopRow; client: AdminGraphqlClient }> {
    if (!shop) throw unauthorized();
    if (shop.platform !== 'shopify') throw badRequest('not_shopify', 'the chart builder writes Shopify metafields; this shop is not a Shopify shop');
    const token = await shopify.accessTokenFor(shop.domain);
    if (!token) throw unauthorized('shop has no offline token — run token exchange', 'shop_not_installed');
    return { shop, client: shopify.admin(shop.domain, token) };
  }

  async function queueSync(shopId: string, gids: readonly string[]): Promise<number> {
    for (const gid of gids) await queue.send(JOB.syncShopifyProduct, { shopId, productGid: gid }, { singletonKey: `sync:${shopId}:${gid}` });
    return gids.length;
  }

  app.get('/shopify/charts/onboarding', { schema: { response: { 200: OnboardingResponseSchema } }, preHandler: requireMerchant }, async (req) => {
    const { shop, client } = await adminFor(req.shop);
    const state = await readOnboardingState(client).catch(upstream);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.shopId, shop.id), ne(products.status, 'archived'), sql`not ('sizeChart' = any(${products.missingFields}))`, sql`not ('sizeChartType' = any(${products.missingFields}))`));
    const today = utcDay(now());
    const from = utcDay(new Date(now().getTime() - 29 * 86_400_000));
    const fitSessions = await fitSessionsBetween(db, shop.id, from, today);
    const { steps, next } = onboardingSteps({
      connected: true,
      templateId: state.templateId,
      themeBlockConfirmed: state.themeBlockConfirmed,
      tested: state.tested,
      productsWithChart: row?.n ?? 0,
      fitSessions,
    });
    return { steps, next, state: { templateId: state.templateId, themeBlockConfirmed: state.themeBlockConfirmed, tested: state.tested } };
  });

  app.put(
    '/shopify/charts/onboarding',
    { schema: { body: OnboardingUpdateRequestSchema, response: { 200: OnboardingResponseSchema.shape.state } }, preHandler: requireMerchant },
    async (req) => {
      const { client } = await adminFor(req.shop);
      if (req.body.templateId !== undefined && !chartTemplateById(req.body.templateId)) throw badRequest('unknown_template', `unknown chart template '${req.body.templateId}'`);
      const s = await updateOnboardingState(client, req.body).catch(upstream);
      return { templateId: s.templateId, themeBlockConfirmed: s.themeBlockConfirmed, tested: s.tested };
    },
  );

  app.post(
    '/shopify/charts/preview',
    { schema: { body: ChartPreviewRequestSchema, response: { 200: ChartPreviewResponseSchema } }, preHandler: requireMerchant, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const { client } = await adminFor(req.shop);
      const [count, page] = await Promise.all([countSelection(client, req.body.selector), fetchSelectionPage(client, req.body.selector, null, 5)]).catch(upstream);
      return { ...count, sample: page.targets.map((t) => ({ id: shopifyExternalId(t.id), title: t.title, hasChart: t.hasChart })) };
    },
  );

  app.post(
    '/shopify/charts/assign',
    { schema: { body: ChartAssignRequestSchema, response: { 200: ChartAssignResponseSchema } }, preHandler: requireMerchant, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { shop, client } = await adminFor(req.shop);
      let chart;
      try {
        chart = resolveChartSpec(req.body.chart);
      } catch (err) {
        if (err instanceof ChartSpecError) throw badRequest('bad_chart', err.message);
        throw err;
      }
      const check = checkChart(chart);
      if (!check.ok) throw unprocessable('invalid_chart', check.errors.join(' '), { errors: check.errors, warnings: check.warnings });
      const page = await fetchSelectionPage(client, req.body.selector, req.body.cursor ?? null).catch(upstream);
      const r = await assignChartToTargets(client, page.targets, chart, { overwrite: req.body.overwrite });
      const syncQueued = await queueSync(shop.id, r.written);
      req.log.info({ shopId: shop.id, written: r.written.length, skipped: r.skipped.length, failed: r.failed.length, kind: req.body.selector.kind }, 'size chart assigned');
      return {
        written: r.written.map(shopifyExternalId),
        skipped: r.skipped.map((s) => ({ ...s, id: shopifyExternalId(s.id) })),
        failed: r.failed.map((f) => ({ ...f, id: shopifyExternalId(f.id) })),
        syncQueued,
        nextCursor: page.nextCursor,
        chart,
        warnings: check.warnings,
      };
    },
  );

  app.get(
    '/shopify/products/:id/chart-import',
    { schema: { params: ProductIdParams, response: { 200: ProductChartImportResponseSchema } }, preHandler: requireMerchant },
    async (req) => {
      const { client } = await adminFor(req.shop);
      const node = await fetchProductDetail(client, req.params.id).catch(upstream);
      if (!node) throw notFound('product');
      const p = proposeFromDescription({ title: node.title, descriptionHtml: node.descriptionHtml, options: node.options, variants: node.variants });
      const hasChart = (node.metafields?.nodes ?? []).some((m) => m.key === 'size_chart');
      return { productId: req.params.id, title: node.title, hasChart, ...p };
    },
  );

  app.put(
    '/shopify/products/:id/chart',
    { schema: { params: ProductIdParams, body: ProductChartWriteRequestSchema, response: { 200: ProductChartWriteResponseSchema } }, preHandler: requireMerchant },
    async (req) => {
      const { shop, client } = await adminFor(req.shop);
      const chart = { sizeChartType: req.body.sizeChartType, sizeChart: convertChart(req.body.sizeChart, req.body.unit ?? 'cm', 'cm') };
      const check = checkChart(chart);
      if (!check.ok) throw unprocessable('invalid_chart', check.errors.join(' '), { errors: check.errors, warnings: check.warnings });
      const payload: Partial<GarmentPayload> = { ...chart };
      if (req.body.fabric) payload.fabric = req.body.fabric;
      if (req.body.lengthCm) payload.lengthCm = req.body.lengthCm;
      const gid = productGid(req.params.id);
      const r = await setProductMetafields(client, gid, payload).catch(upstream);
      await queueSync(shop.id, [gid]);
      return { productId: req.params.id, written: r.metafields.map((m) => m.key), syncQueued: true, warnings: check.warnings };
    },
  );

  app.get(
    '/shopify/products/:id/checklist',
    { schema: { params: ProductIdParams, response: { 200: ProductChecklistResponseSchema } }, preHandler: requireMerchant },
    async (req) => {
      const { shop, client } = await adminFor(req.shop);
      const node = await fetchProductDetail(client, req.params.id).catch(upstream);
      if (!node) throw notFound('product');
      return productChecklist(node, shop.domain, shop.name);
    },
  );
};
