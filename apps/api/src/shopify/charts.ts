/**
 * Size chart builder (embedded Shopify admin). Merchant-authenticated (Shopify session token) and
 * Shopify-only: every write goes to the shop's `$app:curtain` product metafields through
 * @curtain/shopify-app, and every written product gets the existing sync job, so the shop stays the
 * source of truth (D6) and the products table follows within seconds.
 *
 *  - GET  /shopify/charts/onboarding            the five first-run steps (connect, chart, measure, button, phone; services/setup.ts)
 *  - PUT  /shopify/charts/onboarding            remember the picked template / confirmed steps (AppInstallation metafield)
 *  - POST /shopify/charts/preview               how many products a selection means (+ a sample)
 *  - POST /shopify/charts/assign                write one chart to a selection, one page per call (`nextCursor`)
 *  - GET  /shopify/products/:id/chart-import    a garment chart + fabric proposed from the description (no write)
 *  - PUT  /shopify/products/:id/chart           write one product's chart (and confirmed fabric/lengths)
 *  - GET  /shopify/products/:id/checklist       completeness checklist + "Try it on" preview link
 *  - GET  /shopify/products/:id/garment-tape    the "Garment measurements" form: closure, measured sizes, filled tape
 *  - PUT  /shopify/products/:id/garment-tape    check + fill (`dryRun`: no write) and write `closure` / `garment_tape`
 *
 * D3: nothing here touches shopper data; the onboarding "tested" fact is the shop's own fit-session
 * count, never a device or a measurement.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ChartAssignRequestSchema,
  ChartAssignResponseSchema,
  ChartPreviewRequestSchema,
  ChartPreviewResponseSchema,
  ChartSpecError,
  GarmentTapeFormResponseSchema,
  GarmentTapeWriteRequestSchema,
  OnboardingResponseSchema,
  OnboardingUpdateRequestSchema,
  ProductChartImportResponseSchema,
  ProductChartWriteRequestSchema,
  ProductChartWriteResponseSchema,
  ProductChecklistResponseSchema,
  chartTemplateById,
  checkChart,
  checkGarmentTapeInput,
  collapseSharedDepthIssues,
  convertChart,
  fromShopifyProduct,
  measuredFromGarmentTape,
  resolveChartSpec,
  shopifyExternalId,
  type GarmentPayload,
  type GarmentTapeFormResponse,
} from '@curtain/schema';
import {
  assignChartToTargets,
  countSelection,
  deleteProductMetafields,
  fetchProductDetail,
  fetchSelectionPage,
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
import { JOB } from '../jobs/queue.js';
import { HttpError, badRequest, notFound, unauthorized, unprocessable } from '../lib/errors.js';
import type { ShopRow } from '../services/shops.js';
import { merchantSetup } from '../services/setup.js';

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
    // The five steps of @curtain/schema merchantSetup.ts; the theme block and the phone check can be ticked by hand.
    const setup = await merchantSetup({ db, shop, now: now(), buttonConfirmed: state.themeBlockConfirmed, phoneConfirmed: state.tested });
    return { ...setup, state: { templateId: state.templateId, themeBlockConfirmed: state.themeBlockConfirmed, tested: state.tested } };
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

  /**
   * The product as the form sees it: chart sizes, category, and the stored closure and tape read
   * back against the current chart. Garment data only; no shopper data exists on this path.
   */
  async function tapeContext(client: AdminGraphqlClient, id: string) {
    const node = await fetchProductDetail(client, id).catch(upstream);
    if (!node) throw notFound('product');
    const draft = fromShopifyProduct(node);
    const chart = draft.sizeChart ?? [];
    const category = typeof draft.category === 'string' ? draft.category : null;
    return { draft, chart, category };
  }

  app.get(
    '/shopify/products/:id/garment-tape',
    { schema: { params: ProductIdParams, response: { 200: GarmentTapeFormResponseSchema } }, preHandler: requireMerchant },
    async (req): Promise<GarmentTapeFormResponse> => {
      const { client } = await adminFor(req.shop);
      const { draft, chart, category } = await tapeContext(client, req.params.id);
      const measured = measuredFromGarmentTape(draft.garmentTape);
      const check = checkGarmentTapeInput({ category, chart, closure: draft.closure ?? null, measured });
      return {
        productId: req.params.id,
        category,
        sizes: chart.map((r) => r.size),
        closure: draft.closure ?? null,
        measured,
        garmentTape: draft.garmentTape ?? null,
        errors: check.errors,
        warnings: check.warnings,
        written: [],
        syncQueued: false,
      };
    },
  );

  app.put(
    '/shopify/products/:id/garment-tape',
    {
      schema: { params: ProductIdParams, body: GarmentTapeWriteRequestSchema, response: { 200: GarmentTapeFormResponseSchema } },
      preHandler: requireMerchant,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req): Promise<GarmentTapeFormResponse> => {
      const { shop, client } = await adminFor(req.shop);
      const { chart, category } = await tapeContext(client, req.params.id);
      const check = checkGarmentTapeInput({ category, chart, closure: req.body.closure, measured: req.body.measured });
      // The form has one depth input: a bad depth is one error on that input, not one per size.
      const depth = req.body.measured.find((m) => m.hipDepthBelowBandCm !== undefined && m.hipDepthBelowBandCm !== null)?.hipDepthBelowBandCm;
      check.errors = collapseSharedDepthIssues(check.errors, depth);
      const base = {
        productId: req.params.id,
        category,
        sizes: chart.map((r) => r.size),
        closure: check.closure ?? null,
        measured: check.ok && check.garmentTape ? measuredFromGarmentTape(check.garmentTape) : req.body.measured,
        garmentTape: check.garmentTape ?? null,
        errors: check.errors,
        warnings: check.warnings,
      };
      if (req.body.dryRun) return { ...base, written: [], syncQueued: false };
      if (!check.ok) throw unprocessable('invalid_garment_tape', check.errors.map((e) => e.message).join(' '), { errors: check.errors, warnings: check.warnings });
      const gid = productGid(req.params.id);
      const payload: Partial<GarmentPayload> = {};
      if (check.closure) payload.closure = check.closure;
      if (check.garmentTape) payload.garmentTape = check.garmentTape;
      const r = await setProductMetafields(client, gid, payload).catch(upstream);
      const cleared = [...(check.closure ? [] : ['closure']), ...(check.garmentTape ? [] : ['garment_tape'])];
      const deleted = await deleteProductMetafields(client, gid, cleared).catch(upstream);
      const written = [...r.metafields.map((m) => m.key), ...deleted];
      if (written.length > 0) await queueSync(shop.id, [gid]);
      req.log.info({ shopId: shop.id, measuredSizes: check.measuredSizes.length, closure: check.closure ?? null }, 'garment tape written');
      return { ...base, written, syncQueued: written.length > 0 };
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
