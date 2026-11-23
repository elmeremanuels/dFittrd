/**
 * Fabric form (CUR-13, WO-017, D25 point 4, OI-124): the embedded Shopify admin's per-product
 * fabric form. The merchant types or picks a fabric; the form validates it against
 * `@curtain/schema`'s `FabricSchema` and writes the resulting JSON to the product's
 * `$app:curtain.fabric` metafield — the exact JSON the payload builder reads.
 *
 * Routes (all merchant-authenticated, Shopify-only):
 *   - GET  /shopify/products/:id/fabric   the fabric currently on the product (or null)
 *   - PUT  /shopify/products/:id/fabric   validate + write (with `dryRun`: validate only)
 *
 * D3: nothing here touches shopper data.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  deleteProductMetafields,
  fetchProductDetail,
  productGid,
  setProductMetafields,
  ShopifyGraphqlError,
  type AdminGraphqlClient,
} from '@curtain/shopify-app';
import { z } from 'zod';
import { FabricSchema, fromShopifyProduct, type Fabric, type GarmentPayload } from '@curtain/schema';
import { requireMerchant } from '../auth/merchant.js';
import { JOB } from '../jobs/queue.js';
import { badRequest, unauthorized, unprocessable } from '../lib/errors.js';
import type { ShopRow } from '../services/shops.js';

const ProductIdParams = z.object({ id: z.string().regex(/^\d{1,20}$/, 'numeric Shopify product id') });

/** The form's wire shape: what the admin HTML sends. The API validates it with `FabricSchema` and
 *  writes exactly what the schema accepts to the metafield. */
export const FabricFormWriteRequestSchema = z.object({
  fabric: FabricSchema,
  /** When true, the form is validated but not written. */
  dryRun: z.boolean().optional(),
});
export type FabricFormWriteRequest = z.infer<typeof FabricFormWriteRequestSchema>;

export const FabricFormResponseSchema = z.object({
  productId: z.string(),
  /** The stored fabric (null when the product has none). */
  fabric: FabricSchema.nullable(),
  /** Errors from validating the request's fabric (empty on a successful write or a clean read). */
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
  /** Metafield keys written on this call (`fabric` on a successful PUT; empty on a GET). */
  written: z.array(z.string()),
  /** True when the products-table sync job was queued. */
  syncQueued: z.boolean(),
});
export type FabricFormResponse = z.infer<typeof FabricFormResponseSchema>;

async function currentFabric(client: AdminGraphqlClient, id: string): Promise<Fabric | null> {
  const node = await fetchProductDetail(client, id);
  if (!node) return null;
  const draft = fromShopifyProduct(node);
  // `FabricSchema` requires stretch and drape: a draft with only a name is stored but not a valid
  // fabric. The form shows the partial draft so the merchant can complete it.
  if (!draft.fabric) return null;
  const parsed = FabricSchema.safeParse(draft.fabric);
  return parsed.success ? parsed.data : null;
}

/** Shopify API failures become a 502 the admin page can show, never a 500 with a stack. */
function upstream(err: unknown): never {
  if (err instanceof ShopifyGraphqlError) {
    const e = new Error(err.message);
    (e as Error & { statusCode?: number }).statusCode = 502;
    throw e;
  }
  throw err;
}

export const shopifyFabricFormRoutes: FastifyPluginAsyncZod = async (app) => {
  const { queue, shopify } = app.ctx;

  /** The authenticated Shopify shop and an Admin client with its offline token. */
  async function adminFor(shop: ShopRow | undefined): Promise<{ shop: ShopRow; client: AdminGraphqlClient }> {
    if (!shop) throw unauthorized();
    if (shop.platform !== 'shopify') throw badRequest('not_shopify', 'the fabric form writes Shopify metafields; this shop is not a Shopify shop');
    const token = await shopify.accessTokenFor(shop.domain);
    if (!token) throw unauthorized('shop has no offline token — run token exchange', 'shop_not_installed');
    return { shop, client: shopify.admin(shop.domain, token) };
  }

  async function queueSync(shopId: string, gids: readonly string[]): Promise<number> {
    for (const gid of gids) await queue.send(JOB.syncShopifyProduct, { shopId, productGid: gid }, { singletonKey: `sync:${shopId}:${gid}` });
    return gids.length;
  }

  app.get(
    '/shopify/products/:id/fabric',
    { schema: { params: ProductIdParams, response: { 200: FabricFormResponseSchema } }, preHandler: requireMerchant },
    async (req): Promise<FabricFormResponse> => {
      const { client } = await adminFor(req.shop);
      const fabric = await currentFabric(client, req.params.id).catch(upstream);
      return { productId: req.params.id, fabric, errors: [], written: [], syncQueued: false };
    },
  );

  app.put(
    '/shopify/products/:id/fabric',
    {
      schema: { params: ProductIdParams, body: FabricFormWriteRequestSchema, response: { 200: FabricFormResponseSchema } },
      preHandler: requireMerchant,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req): Promise<FabricFormResponse> => {
      const { shop, client } = await adminFor(req.shop);
      const fabric = req.body.fabric;
      // Extra checks the schema does not encode: blend percents must sum to 100 (within 0.5 %),
      // no fibre listed twice.
      const errors: { field: string; message: string }[] = [];
      if (fabric.blend && fabric.blend.length > 0) {
        const sum = fabric.blend.reduce((s, [, n]) => s + n, 0);
        if (Math.abs(sum - 100) > 0.5) errors.push({ field: 'blend', message: `The blend must add up to 100 % (got ${sum.toFixed(1)} %).` });
        const seen = new Set<string>();
        for (const [name] of fabric.blend) {
          const key = name.toLowerCase();
          if (seen.has(key)) errors.push({ field: 'blend', message: `The fibre "${name}" is listed twice.` });
          seen.add(key);
        }
      }
      if (errors.length) throw unprocessable('invalid_fabric', errors.map((e) => e.message).join(' '), { errors });
      if (req.body.dryRun) {
        return { productId: req.params.id, fabric, errors: [], written: [], syncQueued: false };
      }
      const gid = productGid(req.params.id);
      const payload: Partial<GarmentPayload> = { fabric };
      const r = await setProductMetafields(client, gid, payload).catch(upstream);
      const written = r.metafields.map((m) => m.key);
      if (written.length > 0) await queueSync(shop.id, [gid]);
      req.log.info({ shopId: shop.id, primary: fabric.primary, stretchPct: fabric.stretchPct }, 'fabric written');
      return { productId: req.params.id, fabric, errors: [], written, syncQueued: written.length > 0 };
    },
  );

  app.delete(
    '/shopify/products/:id/fabric',
    { schema: { params: ProductIdParams, response: { 200: FabricFormResponseSchema } }, preHandler: requireMerchant },
    async (req): Promise<FabricFormResponse> => {
      const { shop, client } = await adminFor(req.shop);
      const gid = productGid(req.params.id);
      const deleted = await deleteProductMetafields(client, gid, ['fabric']).catch(upstream);
      if (deleted.length > 0) await queueSync(shop.id, [gid]);
      return { productId: req.params.id, fabric: null, errors: [], written: deleted, syncQueued: deleted.length > 0 };
    },
  );
};

