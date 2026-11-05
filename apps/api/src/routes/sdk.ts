/**
 * SDK routes (public, CORS *, rate-limited per shop):
 *  - POST /v1/sdk/sessions → 10-minute try token, embed URL (standalone overlay, D11), deep link and
 *    QR SVG (app mode; no QR for `surface: 'embed'`). 402 + the same body when the shop is paused
 *    (D7: the button still works, the embed/app shows the paused screen).
 *  - GET /sdk/v1.js → the built @curtain/sdk IIFE (served from our origin: zero third-party requests).
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SdkSessionRequestSchema, SdkSessionResponseSchema } from '@curtain/schema';
import { trySessions } from '../db/schema.js';
import { randomAlnum } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { qrSvg } from '../lib/qr.js';
import { originOf } from '../services/embed.js';
import { findProduct } from '../services/products.js';
import { findShopByPrefix, isPaused } from '../services/shops.js';

export const sdkRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, tokens, now } = app.ctx;

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
