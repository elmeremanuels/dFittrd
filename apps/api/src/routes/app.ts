/**
 * APP routes (bearer device JWT except POST /v1/devices). Typed from @paskamer/schema DTOs.
 * Privacy: the only body data accepted here is the 80-float fit signature; swipes carry no body data.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DeviceCreateRequestSchema,
  DeviceRotateRequestSchema,
  DeviceTokenResponseSchema,
  FitCohortResponseSchema,
  LedgerListQuerySchema,
  LedgerListResponseSchema,
  MeDeleteResponseSchema,
  MeExportResponseSchema,
  ProductGetResponseSchema,
  ShopProductsQuerySchema,
  ShopProductsResponseSchema,
  SignaturePutRequestSchema,
  SignaturePutResponseSchema,
  SwipeBatchRequestSchema,
  SwipeBatchResponseSchema,
  WardrobeItemSchema,
  WardrobeListResponseSchema,
  WardrobePutParamsSchema,
  WardrobePutRequestSchema,
  FS_LENGTH,
  type SwipeWireEvent,
} from '@paskamer/schema';
import { requireDevice } from '../auth/device.js';
import { devices, fitSignatures, ledgerEntries, pairings, renderJobs, swipeEvents, trySessions, wardrobeItems } from '../db/schema.js';
import { forbidden, notFound, unprocessable } from '../lib/errors.js';
import { HOUR, utcDay } from '../lib/time.js';
import { fitCohort } from '../services/analytics.js';
import { byteLength, fieldNames, listLedger, toDto, writeLedger } from '../services/ledger.js';
import { asGarment, findProduct, findProductById, listActiveGarments } from '../services/products.js';
import { findShopById } from '../services/shops.js';
import { recordUsage } from '../services/usage.js';

const uuid = z.uuid();

/**
 * Billing day for a deck swipe (D7 idempotency `deck:<device>:<shop>:<item>:<day>`). The client
 * timestamp is honoured for offline outboxes synced a little later, but clamped to ±36 h of
 * server time so a device cannot mint one billable session per fabricated day.
 */
export function deckBillingDay(clientAt: number, now: Date): string {
  const delta = Math.abs(clientAt - now.getTime());
  return utcDay(delta <= 36 * HOUR ? new Date(clientAt) : now);
}

export const appRoutes: FastifyPluginAsyncZod = async (app) => {
  const { ctx } = app;
  const { db, env, tokens } = ctx;

  // ---- devices ---------------------------------------------------------------------------
  app.post(
    '/v1/devices',
    {
      schema: { body: DeviceCreateRequestSchema, response: { 201: DeviceTokenResponseSchema } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const [row] = await db.insert(devices).values({ platform: req.body.platform, appVersion: req.body.appVersion }).returning();
      const { token, expiresAt } = await tokens.signDevice(row!.id, row!.tokenVersion, env.DEVICE_TOKEN_TTL_DAYS);
      return reply.code(201).send({ deviceId: row!.id, token, expiresAt: expiresAt.toISOString(), tokenVersion: row!.tokenVersion });
    },
  );

  app.post('/v1/devices/rotate', { schema: { body: DeviceRotateRequestSchema.optional(), response: { 200: DeviceTokenResponseSchema } }, preHandler: requireDevice }, async (req) => {
    const version = req.device!.tokenVersion + 1;
    await db
      .update(devices)
      .set({ tokenVersion: version, lastSeenAt: new Date(), ...(req.body?.appVersion ? { appVersion: req.body.appVersion } : {}) })
      .where(eq(devices.id, req.device!.id));
    const { token, expiresAt } = await tokens.signDevice(req.device!.id, version, env.DEVICE_TOKEN_TTL_DAYS);
    return { deviceId: req.device!.id, token, expiresAt: expiresAt.toISOString(), tokenVersion: version };
  });

  // ---- me --------------------------------------------------------------------------------
  app.put('/v1/me/signature', { schema: { body: SignaturePutRequestSchema, response: { 200: SignaturePutResponseSchema } }, preHandler: requireDevice }, async (req) => {
    const { version, vector, quality } = req.body;
    if (vector.length !== FS_LENGTH) throw unprocessable('bad_vector', `vector must have ${FS_LENGTH} floats`);
    const updatedAt = new Date();
    await db
      .insert(fitSignatures)
      .values({ deviceId: req.device!.id, version, vector: [...vector], quality, updatedAt })
      .onConflictDoUpdate({ target: fitSignatures.deviceId, set: { version, vector: [...vector], quality, updatedAt } });
    const entry = await writeLedger(db, {
      deviceId: req.device!.id,
      kind: 'signature_sync',
      payloadSummary: { bytes: byteLength(req.body), fields: fieldNames(req.body) },
    });
    return { updatedAt: updatedAt.toISOString(), ledgerEntryId: entry.id };
  });

  app.get('/v1/me/ledger', { schema: { querystring: LedgerListQuerySchema, response: { 200: LedgerListResponseSchema } }, preHandler: requireDevice }, async (req) => {
    return listLedger(db, req.device!.id, req.query.cursor, req.query.limit);
  });

  app.get('/v1/me/export', { schema: { response: { 200: MeExportResponseSchema } }, preHandler: requireDevice }, async (req) => {
    const deviceId = req.device!.id;
    const sig = await db.query.fitSignatures.findFirst({ where: eq(fitSignatures.deviceId, deviceId) });
    const swipes = await db.select().from(swipeEvents).where(eq(swipeEvents.deviceId, deviceId)).orderBy(swipeEvents.at);
    const wardrobe = await db.select().from(wardrobeItems).where(eq(wardrobeItems.deviceId, deviceId));
    const pairs = await db.select().from(pairings).where(eq(pairings.deviceId, deviceId));
    const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.deviceId, deviceId)).orderBy(ledgerEntries.at);
    return {
      deviceId,
      exportedAt: new Date().toISOString(),
      signature: sig ? { version: sig.version as 1, vector: sig.vector, quality: sig.quality } : null,
      swipes: swipes.map((s) => ({
        itemId: s.itemId,
        action: s.action,
        at: s.at.getTime(),
        sizeAtSwipe: s.sizeRecommended,
        fitScore: s.fitScore,
        ...(s.reasons ? { reasons: s.reasons as SwipeWireEvent['reasons'] } : {}),
        dealIndex: s.dealIndex,
        shopId: s.shopId,
      })),
      wardrobe: wardrobe.map((w) => ({ productId: w.productId, shopId: w.shopId, size: w.size, state: w.state, updatedAt: w.updatedAt.toISOString() })),
      pairings: pairs.map((p) => ({ shopId: p.shopId, pairedAt: p.pairedAt.toISOString(), source: p.source })),
      ledger: ledger.map(toDto),
    };
  });

  /** GDPR erase in one call: the device row cascades to everything; render files are removed too. */
  app.delete('/v1/me', { schema: { response: { 200: MeDeleteResponseSchema } }, preHandler: requireDevice }, async (req) => {
    const deviceId = req.device!.id;
    const jobs = await db.select().from(renderJobs).where(eq(renderJobs.deviceId, deviceId));
    for (const j of jobs) {
      await app.renders.remove(j.personPath);
      await app.renders.remove(j.resultPath);
      await app.renders.remove(j.videoPath);
    }
    await db.delete(devices).where(eq(devices.id, deviceId));
    return {
      deleted: true as const,
      tables: ['devices', 'fit_signatures', 'pairings', 'swipe_events', 'wardrobe_items', 'render_jobs', 'ledger_entries', 'try_sessions.device_id', 'usage_events.device_id'],
      at: new Date().toISOString(),
    };
  });

  // ---- catalogue ----------------------------------------------------------------------------
  app.get(
    '/v1/shops/:shopId/products',
    { schema: { params: z.object({ shopId: uuid }), querystring: ShopProductsQuerySchema, response: { 200: ShopProductsResponseSchema } }, preHandler: requireDevice },
    async (req) => {
      const pairing = await db.query.pairings.findFirst({ where: and(eq(pairings.deviceId, req.device!.id), eq(pairings.shopId, req.params.shopId)) });
      if (!pairing) throw forbidden('shop is not paired with this device', 'not_paired');
      return listActiveGarments(db, req.params.shopId, req.query);
    },
  );

  app.get(
    '/v1/products/:id',
    { schema: { params: z.object({ id: z.string().min(1).max(128) }), querystring: z.object({ shopId: uuid.optional() }), response: { 200: ProductGetResponseSchema } }, preHandler: requireDevice },
    async (req) => {
      const row = uuid.safeParse(req.params.id).success
        ? await findProductById(db, req.params.id)
        : req.query.shopId
          ? await findProduct(db, req.query.shopId, req.params.id)
          : undefined;
      if (!row || row.status === 'archived') throw notFound('product');
      const garment = asGarment(row);
      if (!garment) throw unprocessable('product_incomplete', 'product is not complete enough to try on');
      return { shopId: row.shopId, garment };
    },
  );

  // ---- swipes (batch ≤ 100, no body data) ---------------------------------------------------
  app.post('/v1/swipes', { schema: { body: SwipeBatchRequestSchema, response: { 200: SwipeBatchResponseSchema } }, preHandler: requireDevice }, async (req) => {
    const deviceId = req.device!.id;
    const now = ctx.now();
    let accepted = 0;
    let duplicates = 0;
    let usageEventsCreated = 0;
    const shopCache = new Map<string, boolean>();
    for (const ev of req.body.events) {
      if (!shopCache.has(ev.shopId)) shopCache.set(ev.shopId, Boolean(await findShopById(db, ev.shopId)));
      if (!shopCache.get(ev.shopId)) throw unprocessable('unknown_shop', `unknown shop ${ev.shopId}`);
      const product = await findProduct(db, ev.shopId, ev.itemId);
      const inserted = await db
        .insert(swipeEvents)
        .values({
          deviceId,
          shopId: ev.shopId,
          productId: product?.id ?? null,
          itemId: ev.itemId,
          clientId: ev.clientId,
          action: ev.action,
          sizeRecommended: ev.sizeAtSwipe,
          fitScore: ev.fitScore,
          reasons: ev.reasons ?? null,
          dealIndex: ev.dealIndex,
          at: new Date(ev.at),
        })
        .onConflictDoNothing({ target: [swipeEvents.deviceId, swipeEvents.clientId] })
        .returning({ id: swipeEvents.id });
      if (inserted.length === 0) {
        duplicates++;
        continue;
      }
      accepted++;
      // D7: the session is billable once a fit result exists; idempotent by intent token.
      const hasFit = ev.fitScore !== null || ev.sizeAtSwipe !== null;
      if (!hasFit) continue;
      let key: string | null = null;
      if (ev.intentToken) {
        const session = await db.query.trySessions.findFirst({ where: eq(trySessions.intentToken, ev.intentToken) });
        if (session && session.deviceId === deviceId && session.shopId === ev.shopId) {
          if (session.billedAt) continue; // already billed
          key = `intent:${ev.intentToken}`;
          const created = await recordUsage(db, { shopId: ev.shopId, deviceId, productId: session.productId, kind: 'fit_session', idempotencyKey: key });
          if (created) {
            usageEventsCreated++;
            await db.update(trySessions).set({ billedAt: new Date() }).where(eq(trySessions.id, session.id));
          }
          continue;
        }
      }
      // Deck accounting bills the merchant only for a product that exists in their catalogue —
      // a fit result for an unknown or archived item is not a try-on session (billing integrity).
      if (!product || product.status === 'archived') continue;
      key = `deck:${deviceId}:${ev.shopId}:${ev.itemId}:${deckBillingDay(ev.at, now)}`;
      const created = await recordUsage(db, { shopId: ev.shopId, deviceId, productId: product.id, kind: 'fit_session', idempotencyKey: key });
      if (created) usageEventsCreated++;
    }
    const shopIds = new Set(req.body.events.map((e) => e.shopId));
    const entry = await writeLedger(db, {
      deviceId,
      kind: 'swipe_batch',
      payloadSummary: { bytes: byteLength(req.body), fields: ['events'], ...(shopIds.size === 1 ? { shopId: [...shopIds][0]! } : {}) },
    });
    return { accepted, duplicates, usageEventsCreated, ledgerEntryId: entry.id };
  });

  // ---- wardrobe -----------------------------------------------------------------------------
  app.put(
    '/v1/wardrobe/:productId',
    { schema: { params: WardrobePutParamsSchema, body: WardrobePutRequestSchema, response: { 200: WardrobeItemSchema } }, preHandler: requireDevice },
    async (req) => {
      const deviceId = req.device!.id;
      if (!(await findShopById(db, req.body.shopId))) throw unprocessable('unknown_shop', 'unknown shop');
      const values = { deviceId, shopId: req.body.shopId, productId: req.params.productId, size: req.body.size, state: req.body.state, updatedAt: new Date() };
      const [row] = await db
        .insert(wardrobeItems)
        .values(values)
        .onConflictDoUpdate({ target: [wardrobeItems.deviceId, wardrobeItems.shopId, wardrobeItems.productId], set: values })
        .returning();
      await writeLedger(db, { deviceId, kind: 'wardrobe_sync', payloadSummary: { bytes: byteLength(req.body), fields: fieldNames(req.body), shopId: req.body.shopId } });
      return { productId: row!.productId, shopId: row!.shopId, size: row!.size, state: row!.state, updatedAt: row!.updatedAt.toISOString() };
    },
  );

  app.get('/v1/wardrobe', { schema: { response: { 200: WardrobeListResponseSchema } }, preHandler: requireDevice }, async (req) => {
    const rows = await db.select().from(wardrobeItems).where(eq(wardrobeItems.deviceId, req.device!.id)).orderBy(wardrobeItems.updatedAt);
    return { items: rows.map((w) => ({ productId: w.productId, shopId: w.shopId, size: w.size, state: w.state, updatedAt: w.updatedAt.toISOString() })) };
  });

  // ---- cohort (wardrobe aggregates only, k floor) -------------------------------------------
  app.get(
    '/v1/fit/cohort/:productId',
    { schema: { params: z.object({ productId: z.string().min(1).max(128) }), querystring: z.object({ shopId: uuid.optional() }), response: { 200: FitCohortResponseSchema } }, preHandler: requireDevice },
    async (req) => fitCohort(db, req.params.productId, req.query.shopId, env.K_ANON),
  );
};
