/**
 * SDK routes (public, CORS *, rate-limited per shop):
 *  - POST /v1/sdk/sessions → 10-minute try token, embed URL (standalone overlay, D11), deep link and
 *    QR SVG (app mode; no QR for `surface: 'embed'`). 402 + the same body when the shop is paused
 *    (D7: the button still works, the embed/app shows the paused screen).
 *  - GET /sdk/v1.js → the built @curtain/sdk IIFE (served from our origin: zero third-party requests).
 *  - GET /v1/sdk/media?shop=<id>&u=<url> → the shop's logo or one of its product photos, fetched
 *    through safeFetch and served from our origin (carry-over #11). Allowlisted per shop, so it is
 *    not an open proxy; raster images only, size-capped, cached.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SdkSessionRequestSchema, SdkSessionResponseSchema } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { products, trySessions } from '../db/schema.js';
import { randomAlnum } from '../lib/crypto.js';
import { HttpError, notFound } from '../lib/errors.js';
import { MediaCache, PROXY_IMAGE_TYPES, sniffImageType, type CachedMedia } from '../lib/mediaProxy.js';
import { qrSvg } from '../lib/qr.js';
import { safeFetch, UnsafeUrlError } from '../lib/safeFetch.js';
import { originOf } from '../services/embed.js';
import { findProduct } from '../services/products.js';
import { findShopById, findShopByPrefix, isPaused, type ShopRow } from '../services/shops.js';

export const MediaProxyQuerySchema = z.object({
  shop: z.uuid(),
  u: z.url({ protocol: /^https?$/ }).max(2048),
});

/** Negative results (unavailable, refused, not an image) are remembered this long, in ms. */
const MEDIA_NEGATIVE_TTL_MS = 60_000;

export const sdkRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, tokens, now, lookup, publicTransport } = app.ctx;

  app.post(
    '/v1/sdk/sessions',
    {
      schema: { body: SdkSessionRequestSchema, response: { 200: SdkSessionResponseSchema, 402: SdkSessionResponseSchema } },
      config: {
        rateLimit: {
          max: env.SDK_RATE_LIMIT_PER_MIN,
          timeWindow: '1 minute',
          // Runs at preValidation (app.ts): the JSON body is parsed but not validated yet.
          keyGenerator: (req) => {
            const body = req.body as { shopKeyPrefix?: unknown } | undefined;
            const prefix = typeof body?.shopKeyPrefix === 'string' && /^pk_(live|test)_[A-Za-z0-9]{1,32}$/.test(body.shopKeyPrefix) ? body.shopKeyPrefix : null;
            return prefix ? `sdk:${prefix}` : `sdk-ip:${req.ip}`;
          },
        },
      },
    },
    async (req, reply) => {
      const shop = await findShopByPrefix(db, req.body.shopKeyPrefix);
      if (!shop || shop.uninstalledAt) throw notFound('shop');
      const product = await findProduct(db, shop.id, req.body.productExternalId);
      if (!product || product.status === 'archived') throw notFound('product');
      const { token, jti, expiresAt } = await tokens.signTry(shop.id, product.id, env.TRY_TOKEN_TTL_SEC);
      await db.insert(trySessions).values({
        tokenJti: jti,
        intentToken: `it_${randomAlnum(40)}`,
        shopId: shop.id,
        productId: product.id,
        surface: req.body.surface,
        pageOrigin: originOf(req.body.pageUrl),
        createdAt: now(),
        expiresAt,
      });
      const tryUrl = `${env.PUBLIC_APP_URL}/try/${token}`;
      const embedUrl = `${env.PUBLIC_APP_URL}/embed/${token}`;
      const body = {
        tryUrl,
        embedUrl,
        // Standalone mode never shows a QR code: skip the work.
        ...(req.body.surface === 'embed' ? {} : { qrSvg: await qrSvg(tryUrl) }),
        expiresAt: expiresAt.toISOString(),
        shopPaused: isPaused(shop),
      };
      return reply.code(body.shopPaused ? 402 : 200).send(body);
    },
  );

  // ---- media proxy (carry-over #11) ------------------------------------------------------------
  const mediaCache = new MediaCache(env.MEDIA_PROXY_CACHE_MB * 1024 * 1024);
  const inflight = new Map<string, Promise<CachedMedia>>();
  const loadMedia = async (url: string): Promise<CachedMedia> => {
    const t = now().getTime();
    const negative: CachedMedia = { body: null, contentType: null, expiresAt: t + MEDIA_NEGATIVE_TTL_MS };
    try {
      const res = await safeFetch(url, { lookup, transport: publicTransport, maxBytes: env.MEDIA_PROXY_MAX_BYTES, timeoutMs: 8_000, accept: PROXY_IMAGE_TYPES.join(','), contentTypes: [...PROXY_IMAGE_TYPES, 'image/jpg'] });
      const sniffed = res ? sniffImageType(res.body) : null;
      // The bytes must be the raster type the server claimed (no HTML or SVG behind an image/* header).
      if (!res || !sniffed || sniffed !== res.contentType.replace('image/jpg', 'image/jpeg')) return negative;
      return { body: res.body, contentType: sniffed, expiresAt: t + env.MEDIA_PROXY_CACHE_TTL_SEC * 1000 };
    } catch (err) {
      if (err instanceof UnsafeUrlError) app.log.warn({ reason: err.reason }, 'media proxy URL rejected by the SSRF guard');
      return negative;
    }
  };

  app.get(
    '/v1/sdk/media',
    { schema: { querystring: MediaProxyQuerySchema, hide: true }, config: { rateLimit: { max: env.MEDIA_PROXY_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { shop: shopId, u } = req.query;
      const key = `${shopId}\n${u}`;
      let entry = mediaCache.get(key, now().getTime());
      if (!entry) {
        const shop = await findShopById(db, shopId);
        if (!shop || shop.uninstalledAt || !(await isShopMediaUrl(db, shop, u))) throw new HttpError(404, 'not_found', 'media not found');
        let pending = inflight.get(key);
        if (!pending) {
          pending = loadMedia(u).finally(() => inflight.delete(key));
          inflight.set(key, pending);
        }
        entry = await pending;
        mediaCache.set(key, entry);
      }
      if (!entry.body || !entry.contentType) throw new HttpError(502, 'media_unavailable', 'the image could not be loaded from the shop');
      return reply
        .header('content-type', entry.contentType)
        .header('cache-control', `public, max-age=${env.MEDIA_PROXY_CACHE_TTL_SEC}`)
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(Buffer.from(entry.body));
    },
  );

  const sdkFile = await resolveSdkFile(env.SDK_FILE);
  app.get('/sdk/v1.js', { config: { rateLimit: false } }, async (_req, reply) => {
    if (!sdkFile) throw notFound('sdk bundle (build @curtain/sdk first)');
    const js = await readFile(sdkFile, 'utf8');
    return reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(js);
  });
};

export async function resolveSdkFile(override?: string): Promise<string | null> {
  const candidates = override ? [override] : [];
  try {
    const require = createRequire(import.meta.url);
    candidates.push(require.resolve('@curtain/sdk/sdk.v1.js'));
  } catch {
    /* not built */
  }
  for (const c of candidates) {
    try {
      await readFile(c, 'utf8');
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * The proxy allowlist: `url` is the shop's stored logo, or the flat-lay / a product photo of one of
 * the shop's products that is not archived. Exact string match (the URL the merchant stored).
 */
export async function isShopMediaUrl(db: Db, shop: ShopRow, url: string): Promise<boolean> {
  if (shop.settings.logoUrl === url) return true;
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.shopId, shop.id),
        ne(products.status, 'archived'),
        or(sql`${products.payload} -> 'productPhotos' @> ${JSON.stringify([url])}::jsonb`, sql`${products.payload} ->> 'flatLayPhoto' = ${url}`),
      ),
    )
    .limit(1);
  return Boolean(row);
}
