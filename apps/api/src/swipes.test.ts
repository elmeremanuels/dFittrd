import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { swipeEvents, usageDaily, usageEvents } from './db/schema.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

describe('POST /v1/swipes — batch, idempotent, billable by intent token (D7)', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t);
  });
  afterAll(async () => {
    await t.close();
  });

  async function resolveTry(d: Awaited<ReturnType<typeof createDevice>>, productExternalId = 'aalter-studio-1') {
    const sdk = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId, pageUrl: 'https://m.example/p' } });
    const token = sdk.json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    const res = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
    return res.json<{ trySession: { intentToken: string } }>().trySession.intentToken;
  }

  const ev = (over: Partial<Record<string, unknown>> = {}) => ({
    itemId: 'aalter-studio-1',
    action: 'love',
    at: Date.now(),
    sizeAtSwipe: 'M',
    fitScore: 0.91,
    dealIndex: 0,
    shopId: s.shop.id,
    clientId: `c-${Math.random().toString(36).slice(2, 12)}`,
    ...over,
  });

  it('bills one fit session per intent token, replays are duplicates', async () => {
    const d = await createDevice(t);
    const intentToken = await resolveTry(d);
    const first = ev({ intentToken, clientId: 'client-1' });
    const r1 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [first] } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ accepted: 1, duplicates: 0, usageEventsCreated: 1 });

    const r2 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [first] } });
    expect(r2.json()).toMatchObject({ accepted: 0, duplicates: 1, usageEventsCreated: 0 });

    const r3 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ intentToken, action: 'save' })] } });
    expect(r3.json()).toMatchObject({ accepted: 1, usageEventsCreated: 0 });

    const usage = await t.handle.db.select().from(usageEvents).where(eq(usageEvents.shopId, s.shop.id));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ kind: 'fit_session', idempotencyKey: `intent:${intentToken}` });
    // no body data on the wire / in the ledger
    const ledger = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: d.auth });
    const batch = ledger.json().entries.find((e: { kind: string }) => e.kind === 'swipe_batch');
    expect(batch.payloadSummary).toMatchObject({ fields: ['events'], shopId: s.shop.id });
  });

  it('a swipe without a fit result is not billable; deck swipes bill once per product and day', async () => {
    const d = await createDevice(t);
    await resolveTry(d); // pairs the device with the shop (deck billing needs a pairing, carry-over #8)
    const noFit = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ sizeAtSwipe: null, fitScore: null, action: 'pass', reasons: ['price'] })] } });
    expect(noFit.json()).toMatchObject({ accepted: 1, usageEventsCreated: 0 });

    const deck1 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ itemId: 'raw-denim-01', sizeAtSwipe: '28' }), ev({ itemId: 'raw-denim-01', sizeAtSwipe: '28', action: 'save' })] } });
    expect(deck1.json()).toMatchObject({ accepted: 2, usageEventsCreated: 1 });
    const deck2 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ itemId: 'monochrome-02', sizeAtSwipe: 'S' })] } });
    expect(deck2.json().usageEventsCreated).toBe(1);

    // an intent token from another device is ignored (falls back to deck accounting)
    const other = await createDevice(t);
    const foreignIntent = await resolveTry(other, 'monochrome-02');
    const stolen = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ itemId: 'monochrome-02', intentToken: foreignIntent })] } });
    expect(stolen.json().usageEventsCreated).toBe(0);

    const daily = await t.handle.db.select().from(usageDaily).where(eq(usageDaily.shopId, s.shop.id));
    expect(daily).toHaveLength(1);
    expect(daily[0]!.fitSessions).toBe(3);
  });

  it('accepts the valid events of a batch and reports the rejected ones per event (#23)', async () => {
    const d = await createDevice(t);
    await resolveTry(d);
    const GHOST = '00000000-0000-4000-8000-000000000000';
    const unknown = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ shopId: GHOST, clientId: 'ghost-only-1' })] } });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toMatchObject({ accepted: 0, duplicates: 0, acceptedClientIds: [], rejected: [{ index: 0, clientId: 'ghost-only-1', reason: 'unknown_shop' }], usageEventsCreated: 0 });

    // a mixed batch: the known event is stored and billed, the unknown shop and the malformed events are reported
    const knownFirst = ev({ clientId: 'mixed-known-1', itemId: 'raw-denim-01', sizeAtSwipe: '28' });
    const mixed = await t.app.inject({
      method: 'POST',
      url: '/v1/swipes',
      headers: d.auth,
      payload: {
        events: [knownFirst, ev({ shopId: GHOST, clientId: 'mixed-ghost-1' }), ev({ clientId: 'mixed-bad-score', fitScore: 7 }), 'not an event', ev({ clientId: 'mixed-known-2', itemId: 'monochrome-02', sizeAtSwipe: null, fitScore: null })],
      },
    });
    expect(mixed.statusCode).toBe(200);
    const body = mixed.json();
    expect(body).toMatchObject({ accepted: 2, duplicates: 0, acceptedClientIds: ['mixed-known-1', 'mixed-known-2'], usageEventsCreated: 1 });
    expect(body.rejected).toEqual([
      { index: 1, clientId: 'mixed-ghost-1', reason: 'unknown_shop' },
      { index: 2, clientId: 'mixed-bad-score', reason: 'invalid_event', detail: 'fitScore' },
      { index: 3, clientId: null, reason: 'invalid_event', detail: 'event' },
    ]);
    expect(await t.handle.db.select().from(swipeEvents).where(and(eq(swipeEvents.deviceId, d.deviceId), eq(swipeEvents.clientId, 'mixed-known-1')))).toHaveLength(1);
    expect(await t.handle.db.select().from(swipeEvents).where(and(eq(swipeEvents.deviceId, d.deviceId), eq(swipeEvents.clientId, 'mixed-bad-score')))).toHaveLength(0);
    expect(await t.handle.db.select().from(usageEvents).where(eq(usageEvents.deviceId, d.deviceId))).toHaveLength(1);

    // replaying the accepted events is idempotent: duplicates, listed as stored, billed once
    const retry = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [knownFirst] } });
    expect(retry.json()).toMatchObject({ accepted: 0, duplicates: 1, acceptedClientIds: ['mixed-known-1'], rejected: [], usageEventsCreated: 0 });
    expect(await t.handle.db.select().from(usageEvents).where(eq(usageEvents.deviceId, d.deviceId))).toHaveLength(1);

    // the envelope itself is still validated as a whole
    const big = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: Array.from({ length: 101 }, () => ev()) } });
    expect(big.statusCode).toBe(400);
    const empty = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [] } });
    expect(empty.statusCode).toBe(400);
    // unknown keys (body data) are stripped, never stored
    const extra = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ bust: 92, photo: 'x', clientId: 'extra-keys-1' })] } });
    expect(extra.statusCode).toBe(200);
    expect(extra.json().acceptedClientIds).toEqual(['extra-keys-1']);
  });
});
