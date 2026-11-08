/**
 * GET /v1/try/:token — the app or the standalone embed resolves the 10-minute try token minted
 * for the merchant page: returns shop branding + garment + the embed's allowed postMessage origins,
 * creates the pairing with a per-(device, shop) pseudonym, marks the try session resolved and
 * hands out the intent token (billing idempotency, D7).
 *
 * POST /v1/try/:token/fit-shown — the standalone embed's billing event (docs/STANDALONE.md §2):
 * one billable try-on session per intent token, the size label + confidence only (no measurements).
 *
 * Billing integrity (SEC-1, SEC-2): the try token is minted from a public pk_ key, so fit-shown only
 * bills a session that (a) was minted for the standalone overlay (`surface: 'embed'`), (b) came from
 * a page on the shop's own storefront (its `pageOrigin` is in the embed's allowed origins), (c) is
 * for a product that still exists and is not archived, (d) is the device's first billed fit for
 * that product that UTC day (same rule as the deck path), and (e) passes `billFitSession`: the
 * device is paired with the shop, the intent token has not billed yet (D7) and the shop is under
 * its per-plan daily cap (carry-over #7; the swipe path shares the helper). Anything else is
 * recorded on the try session but answers `billed: false`. Both routes are rate-limited per client IP.
 *
 * GET /v1/peek — the size peek's read-only lookup (shop branding, garment, allowed origins) for a
 * device already paired with the shop. It mints no try session, resolves nothing, creates no
 * pairing and bills nothing, so peek views never show up in merchant analytics, never count toward
 * the k floor (C1) and never use the shop's SDK rate limit that real button clicks need (C2). Its own
 * per-IP limit (`peek-ip:`).
 *
 * The merchant views of the same data (GET /v1/merchant/usage/anomalies, GET
 * /v1/merchant/analytics/fit-sizes) live in routes/merchant.ts with the other merchant routes.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  FitShownRequestSchema,
  FitShownResponseSchema,
  PeekQuerySchema,
  PeekResponseSchema,
  TryResolveParamsSchema,
  TryResolveResponseSchema,
  type PairingSource,
} from '@curtain/schema';
import { requireDevice } from '../auth/device.js';
import { pairings, trySessions, usageEvents } from '../db/schema.js';
import { pseudonymFor } from '../lib/crypto.js';
import { conflict, forbidden, gone, HttpError, notFound, unauthorized, unprocessable } from '../lib/errors.js';
import { embedAllowedOrigins, originOf } from '../services/embed.js';
import { byteLength, fieldNames, writeLedger } from '../services/ledger.js';
import { activeAssetRef } from '../services/assets.js';
import { asTryGarment, findProduct, findProductById } from '../services/products.js';
import { findShopById, findShopByPrefix, isPaused, shopBranding } from '../services/shops.js';
import { billFitSession } from '../services/usage.js';
import { dayStart, utcDay } from '../lib/time.js';

/** How long after the try link's 10-minute TTL the embed may still report the fit it showed. */
const FIT_SHOWN_GRACE_SEC = 2 * 3600;

const pairingSource = (surface: string): PairingSource => (surface === 'embed' ? 'embed' : surface === 'api' ? 'link' : 'qr');

export const tryRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, tokens, now } = app.ctx;

  const rateLimit = { max: env.TRY_RATE_LIMIT_PER_MIN, timeWindow: '1 minute', keyGenerator: (req: { ip: string }) => `try-ip:${req.ip}` };

  app.get(
    '/v1/try/:token',
    { schema: { params: TryResolveParamsSchema, response: { 200: TryResolveResponseSchema } }, preHandler: requireDevice, config: { rateLimit } },
    async (req) => {
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
      // Size advice needs category + chart type + chart; price, colour, block and fabric default.
      const garment = asTryGarment(product, { colorHex: shop.settings.brandColor ?? undefined });
      if (!garment) throw unprocessable('product_incomplete', 'the shop has not finished this product’s fit data');

      const pseudonym = pseudonymFor(deviceId, shop.id, env.SHOP_KEY_PEPPER);
      const inserted = await db
        .insert(pairings)
        .values({ deviceId, shopId: shop.id, pseudonym, source: pairingSource(session.surface), pairedAt: t })
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
        embed: { allowedOrigins: embedAllowedOrigins(shop, session.pageOrigin) },
        // D13/D16: only an approved bundle that still matches the live chart, only with the 3D estimate on.
        asset: await activeAssetRef(db, env, shop, product, garment),
      };
    },
  );

  app.get(
    '/v1/peek',
    {
      schema: { querystring: PeekQuerySchema, response: { 200: PeekResponseSchema } },
      preHandler: requireDevice,
      config: { rateLimit: { max: env.TRY_RATE_LIMIT_PER_MIN, timeWindow: '1 minute', keyGenerator: (req: { ip: string }) => `peek-ip:${req.ip}` } },
    },
    async (req) => {
      const shop = await findShopByPrefix(db, req.query.shop);
      if (!shop || shop.uninstalledAt) throw notFound('shop');
      // A paused shop shows no peek (the button still opens the paused screen).
      if (isPaused(shop)) throw new HttpError(402, 'shop_paused', 'this shop has paused Curtain');
      // Only products the button can really open: try-able, not incomplete or archived.
      const product = await findProduct(db, shop.id, req.query.product);
      const garment = product && product.status === 'active' ? asTryGarment(product, { colorHex: shop.settings.brandColor ?? undefined }) : null;
      if (!garment) throw notFound('product');
      // Only a shopper who already used the fitting room on this shop (read, never created here).
      const paired = await db.query.pairings.findFirst({ where: and(eq(pairings.deviceId, req.device!.id), eq(pairings.shopId, shop.id)) });
      if (!paired) throw notFound('pairing');
      return { shop: shopBranding(shop), garment, embed: { allowedOrigins: embedAllowedOrigins(shop, originOf(req.query.page)) } };
    },
  );

  app.post(
    '/v1/try/:token/fit-shown',
    { schema: { params: TryResolveParamsSchema, body: FitShownRequestSchema, response: { 200: FitShownResponseSchema } }, preHandler: requireDevice, config: { rateLimit } },
    async (req) => {
      const claims = await tokens.verifyTry(req.params.token, { graceSec: FIT_SHOWN_GRACE_SEC });
      if (!claims) throw unauthorized('invalid or expired try token', 'invalid_try_token');
      const session = await db.query.trySessions.findFirst({ where: eq(trySessions.tokenJti, claims.jti) });
      if (!session) throw notFound('try session');
      const deviceId = req.device!.id;
      // Only the device that resolved the link can report its fit (GET /v1/try/:token first).
      if (!session.deviceId) throw conflict('not_resolved', 'resolve the try link before reporting a fit');
      if (session.deviceId !== deviceId) throw forbidden('this try link was opened on another device', 'other_device');
      if (session.intentToken !== req.body.intentToken) throw forbidden('intent token does not belong to this try link', 'intent_mismatch');

      const shop = await findShopById(db, session.shopId);
      if (!shop) throw notFound('shop');
      // D7: below plan the embed shows the paused screen and nothing is billed.
      if (isPaused(shop)) throw new HttpError(402, 'shop_paused', 'this shop has paused Curtain; the try-on is not billed');

      /** SEC-1 / SEC-2: see the file header. Every "no" is silent to the caller (`billed: false`). */
      const isBillable = async (at: Date): Promise<boolean> => {
        if (session.surface !== 'embed') return false;
        // embedAllowedOrigins keeps the page origin only when it belongs to the shop.
        if (!session.pageOrigin || !embedAllowedOrigins(shop, session.pageOrigin).includes(session.pageOrigin)) return false;
        const product = await findProductById(db, session.productId);
        if (!product || product.status === 'archived') return false;
        const day = utcDay(at);
        const sameDay = await db
          .select({ id: usageEvents.id })
          .from(usageEvents)
          .where(and(eq(usageEvents.deviceId, deviceId), eq(usageEvents.productId, product.id), eq(usageEvents.kind, 'fit_session'), gte(usageEvents.at, dayStart(day))))
          .limit(1);
        return sameDay.length === 0;
      };

      const t = now();
      // Checked before the transaction: isBillable reads through `db`, and PGlite (tests, demo) has one connection.
      const billable = await isBillable(t);
      return db.transaction(async (tx) => {
        // One billable session per intent token. The key is shared with the app's swipe path,
        // so a session billed there (or by an earlier call) is never billed twice. The pairing
        // rule and the per-plan daily cap live in billFitSession, shared with the swipe path.
        const outcome = billable
          ? await billFitSession(tx, env, shop, { deviceId, productId: session.productId, idempotencyKey: `intent:${session.intentToken}`, at: t }, req.log)
          : 'not_billable';
        if (outcome !== 'billed') {
          // Recorded on the try session (first report wins), never billed.
          if (!session.fitShownAt) {
            await tx
              .update(trySessions)
              .set({ fitShownAt: t, recommendedSize: req.body.recommendedSize, fitConfidence: req.body.confidence })
              .where(eq(trySessions.id, session.id));
          }
          return { billed: false };
        }
        await tx
          .update(trySessions)
          .set({ billedAt: session.billedAt ?? t, fitShownAt: t, recommendedSize: req.body.recommendedSize, fitConfidence: req.body.confidence })
          .where(eq(trySessions.id, session.id));
        // The shopper's privacy ledger: what went up (field names and size only, never values).
        await writeLedger(tx, {
          deviceId,
          kind: 'fit',
          shopId: shop.id,
          payloadSummary: { bytes: byteLength(req.body), fields: fieldNames(req.body), shopId: shop.id },
        });
        return { billed: true };
      });
    },
  );
};
