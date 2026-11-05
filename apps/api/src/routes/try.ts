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
 * that product that UTC day (same rule as the deck path), and (e) stays under the per-shop daily
 * anomaly cap. Anything else is recorded on the try session but answers `billed: false`. Both routes
 * are rate-limited per client IP.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { FitShownRequestSchema, FitShownResponseSchema, TryResolveParamsSchema, TryResolveResponseSchema, type PairingSource } from '@curtain/schema';
import { requireDevice } from '../auth/device.js';
import { pairings, trySessions, usageDaily, usageEvents } from '../db/schema.js';
import { pseudonymFor } from '../lib/crypto.js';
import { conflict, forbidden, gone, HttpError, notFound, unauthorized, unprocessable } from '../lib/errors.js';
import { embedAllowedOrigins } from '../services/embed.js';
import { byteLength, fieldNames, writeLedger } from '../services/ledger.js';
import { asGarment, findProductById } from '../services/products.js';
import { findShopById, isPaused, shopBranding } from '../services/shops.js';
import { recordUsage } from '../services/usage.js';
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
      const garment = asGarment(product);
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
      };
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
        if (sameDay.length > 0) return false;
        const today = await db.query.usageDaily.findFirst({ where: and(eq(usageDaily.shopId, shop.id), eq(usageDaily.day, day)) });
        if ((today?.fitSessions ?? 0) >= env.EMBED_BILLED_SESSIONS_PER_DAY) {
          app.log.warn({ shopId: shop.id, day, cap: env.EMBED_BILLED_SESSIONS_PER_DAY }, 'embed billing anomaly cap reached; fit-shown not billed');
          return false;
        }
        return true;
      };

      const t = now();
      const billable = await isBillable(t);
      if (!billable) {
        // Recorded on the try session (first report wins), never billed.
        if (!session.fitShownAt) {
          await db
            .update(trySessions)
            .set({ fitShownAt: t, recommendedSize: req.body.recommendedSize, fitConfidence: req.body.confidence })
            .where(eq(trySessions.id, session.id));
        }
        return { billed: false };
      }

      return db.transaction(async (tx) => {
        // One billable session per intent token. The key is shared with the app's swipe path,
        // so a session billed there (or by an earlier call) is never billed twice.
        const billed = await recordUsage(tx, {
          shopId: shop.id,
          deviceId,
          productId: session.productId,
          kind: 'fit_session',
          idempotencyKey: `intent:${session.intentToken}`,
          at: t,
        });
        if (!billed) return { billed: false };
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
