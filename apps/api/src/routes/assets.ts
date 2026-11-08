/**
 * Garment assets over HTTP (D13, D16).
 *
 * Merchant (Shopify session or WooCommerce keys, `requireMerchant`):
 *   GET  /v1/merchant/products/:externalId/assets   the versions of a product's 3D bundle
 *   POST /v1/merchant/assets/:id/approve            D13: the merchant's approval makes it live
 *   POST /v1/merchant/assets/:id/reject             with a reason; takes it off the storefront
 * None of these takes or returns shopper data.
 *
 * Static files, demo and dev only (`SERVE_ASSETS`): GET /assets/<shopId>/<productId>/<version>/<file>
 * with the same headers Caddy sets in production (infra/Caddyfile): immutable, CORP cross-origin,
 * ACAO the app origin, no cookies. GET and HEAD only; no query, no body.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { GARMENT_BUNDLE_FILES, GarmentAssetActionResponseSchema, GarmentAssetRejectRequestSchema, MerchantGarmentAssetListSchema } from '@curtain/schema';
import { requireMerchant } from '../auth/merchant.js';
import { products } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { approveAsset, assetDir, assetDto, listAssets, rejectAsset } from '../services/assets.js';

const AssetIdParams = z.object({ id: z.uuid() });
const ProductParams = z.object({ externalId: z.string().min(1).max(256) });
const FileParams = z.object({
  shopId: z.uuid(),
  productId: z.uuid(),
  version: z.string().regex(/^[0-9a-f]{16}$/),
  file: z.enum(GARMENT_BUNDLE_FILES),
});

const CONTENT_TYPE: Record<(typeof GARMENT_BUNDLE_FILES)[number], string> = {
  'base.glb': 'model/gltf-binary',
  'anchors.json': 'application/json',
  'grading.json': 'application/json',
  'material.json': 'application/json',
  'qa.json': 'application/json',
};

export const assetRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, now } = app.ctx;

  app.get('/v1/merchant/products/:externalId/assets', { schema: { params: ProductParams, response: { 200: MerchantGarmentAssetListSchema } }, preHandler: requireMerchant }, async (req) => ({
    assets: await listAssets(db, req.shop!.id, req.params.externalId),
  }));

  const dtoFor = async (row: Awaited<ReturnType<typeof approveAsset>>) => {
    const product = await db.query.products.findFirst({ where: eq(products.id, row.productId) });
    if (!product) throw notFound('product');
    return { asset: assetDto(row, product) };
  };

  app.post('/v1/merchant/assets/:id/approve', { schema: { params: AssetIdParams, response: { 200: GarmentAssetActionResponseSchema } }, preHandler: requireMerchant }, async (req) =>
    dtoFor(await approveAsset(db, req.shop!.id, req.params.id, `merchant:${req.shop!.domain}`, now())),
  );

  app.post(
    '/v1/merchant/assets/:id/reject',
    { schema: { params: AssetIdParams, body: GarmentAssetRejectRequestSchema, response: { 200: GarmentAssetActionResponseSchema } }, preHandler: requireMerchant },
    async (req) => dtoFor(await rejectAsset(db, req.shop!.id, req.params.id, req.body.reason, now())),
  );

  if (!env.SERVE_ASSETS) return;

  app.get('/assets/:shopId/:productId/:version/:file', { schema: { params: FileParams }, config: { rateLimit: false } }, async (req, reply) => {
    if (req.url.includes('?')) throw notFound('asset');
    const { shopId, productId, version, file } = req.params;
    const path = `${assetDir(env, shopId, productId, version)}/${file}`;
    let size: number;
    try {
      const s = await stat(path);
      if (!s.isFile()) throw new Error('not a file');
      size = s.size;
    } catch {
      throw notFound('asset');
    }
    reply
      .header('Content-Type', CONTENT_TYPE[file])
      .header('Content-Length', String(size))
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Access-Control-Allow-Origin', env.PUBLIC_APP_URL.replace(/\/+$/, ''))
      .header('Vary', 'Origin');
    return reply.send(createReadStream(path));
  });
};
