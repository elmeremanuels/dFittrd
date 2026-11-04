/**
 * GET /v1/try/:token — the app resolves the 10-minute try token minted for the merchant page:
 * returns shop branding + garment, creates the pairing with a per-(device, shop) pseudonym,
 * marks the try session resolved and hands out the intent token (billing idempotency, D7).
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TryResolveParamsSchema, TryResolveResponseSchema } from '@paskamer/schema';
import { requireDevice } from '../auth/device.js';
import { pairings, trySessions } from '../db/schema.js';
import { pseudonymFor } from '../lib/crypto.js';
import { conflict, gone, notFound, unauthorized, unprocessable } from '../lib/errors.js';
import { writeLedger } from '../services/ledger.js';
import { asGarment, findProductById } from '../services/products.js';
import { findShopById, shopBranding } from '../services/shops.js';

export const tryRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, tokens, now } = app.ctx;

  app.get('/v1/try/:token', { schema: { params: TryResolveParamsSchema, response: { 200: TryResolveResponseSchema } }, preHandler: requireDevice }, async (req) => {
    const claims = await tokens.verifyTry(req.params.token);
    if (!claims) throw unauthorized('invalid or expired try token', 'invalid_try_token');
    const session = await db.query.trySessions.findFirst({ where: eq(trySessions.tokenJti, claims.jti) });
    if (!session) throw notFound('try session');
    const t = now();
    if (session.expiresAt < t) throw gone('try link expired — tap the button again');
    const deviceId = req.device!.id;
    if (session.deviceId && session.deviceId !== deviceId) throw conflict('already_resolved', 'this try link was opened on another device');

    const shop = await findShopById(db, session.shopId);
    const product = await findProductById(db, session.productId);
    if (!shop || !product || product.status === 'archived') throw notFound('product');
    const garment = asGarment(product);
    if (!garment) throw unprocessable('product_incomplete', 'the shop has not finished this product’s fit data');

    const pseudonym = pseudonymFor(deviceId, shop.id, env.SHOP_KEY_PEPPER);
    const inserted = await db
      .insert(pairings)
      .values({ deviceId, shopId: shop.id, pseudonym, source: session.surface === 'api' ? 'link' : 'qr', pairedAt: t })
      .onConflictDoNothing({ target: [pairings.deviceId, pairings.shopId] })
      .returning();
    const created = inserted.length > 0;
    const pairing = inserted[0] ?? (await db.query.pairings.findFirst({ where: and(eq(pairings.deviceId, deviceId), eq(pairings.shopId, shop.id)) }))!;
    if (created) {
      await writeLedger(db, { deviceId, kind: 'pairing', shopId: shop.id, payloadSummary: { bytes: 0, fields: ['pseudonym'], shopId: shop.id } });
    }
    if (!session.resolvedAt) {
      await db.update(trySessions).set({ deviceId, resolvedAt: t }).where(eq(trySessions.id, session.id));
    }
    return {
      shop: shopBranding(shop),
      garment,
      trySession: { id: session.id, expiresAt: session.expiresAt.toISOString(), intentToken: session.intentToken },
      pairing: { created, pairedAt: pairing.pairedAt.toISOString() },
    };
  });
};
