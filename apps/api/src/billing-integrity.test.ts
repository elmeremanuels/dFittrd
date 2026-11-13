/**
 * Carry-over findings #7 (per-plan daily cap + anomaly signal, device minting), #8 (deck swipes need a
 * pairing and share the cap), #9 (DELETE /v1/me/signature) and #10 (expired device tokens rotate
 * within a bounded grace, once).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FS_LENGTH } from '@curtain/schema';
import { fitSignatures, ledgerEntries, pairings, shops, usageDaily, usageEvents } from './db/schema.js';
import { testEnv } from './env.js';
import { utcDay, DAY } from './lib/time.js';
import type { ShopRow } from './services/shops.js';
import { billingAnomalies, dailyBilledCap } from './services/usage.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

type Device = Awaited<ReturnType<typeof createDevice>>;
const PAGE = 'https://aalter.example/products/wrap';

async function embedShop(t: TestApp) {
  const seeded = await seedShop(t, { domain: 'aalter.example' });
  await t.handle.db
    .update(shops)
    .set({ settings: { ...seeded.shop.settings, siteUrl: 'https://aalter.example' } })
    .where(eq(shops.id, seeded.shop.id));
  return seeded;
}

/** SDK session + GET /v1/try/:token (which pairs the device with the shop). */
async function resolve(t: TestApp, prefix: string, d: Device, productExternalId = 'aalter-studio-1', surface: 'embed' | 'button' = 'embed') {
  const sdk = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: prefix, productExternalId, pageUrl: PAGE, surface } });
  const token = sdk.json<{ embedUrl: string }>().embedUrl.split('/embed/')[1]!;
  const r = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
  expect(r.statusCode).toBe(200);
  return { token, intentToken: r.json<{ trySession: { intentToken: string } }>().trySession.intentToken };
}

const swipe = (shopId: string, itemId: string, over: Record<string, unknown> = {}) => ({
  itemId,
  action: 'love',
  at: Date.now(),
  sizeAtSwipe: 'M',
  fitScore: 0.9,
  dealIndex: 0,
  shopId,
  clientId: `c-${Math.random().toString(36).slice(2, 12)}`,
  ...over,
});

describe('dailyBilledCap derives from the plan fair-use reference (D7 unit, D17: nothing billed per session)', () => {
  const env = testEnv();
  const shop = (plan: ShopRow['plan'], includedSessions?: number) => ({ plan, settings: includedSessions ? { includedSessions } : {} }) as ShopRow;
  it('ten average days of the allowance, at least the floor, at most the global ceiling', () => {
    expect(dailyBilledCap(env, shop('free'))).toBe(100); // 50/30*10 = 17 → floor 100
    expect(dailyBilledCap(env, shop('curtain'))).toBe(1667); // 5000/30*10
    expect(dailyBilledCap(env, shop('curtain', 500))).toBe(167); // a hand-set fair-use override
    expect(dailyBilledCap(env, shop('curtain', 30_000))).toBe(5000); // EMBED_BILLED_SESSIONS_PER_DAY ceiling
    expect(dailyBilledCap(testEnv({ BILLED_DAILY_CAP_MIN: '3' }), shop('free'))).toBe(17);
  });
});

describe('#8 deck swipes: pairing required, shared per-shop daily cap (#7)', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof embedShop>>;
  beforeAll(async () => {
    // free plan → cap = min(EMBED ceiling 3, max(MIN 2, ceil(50/30 × 1))) = 2
    t = await makeApp({ EMBED_BILLED_SESSIONS_PER_DAY: '3', BILLED_DAILY_CAP_MIN: '2', BILLED_DAILY_CAP_FACTOR: '1' });
    s = await embedShop(t);
    await t.handle.db.update(shops).set({ plan: 'free' }).where(eq(shops.id, s.shop.id));
  });
  afterAll(async () => {
    await t.close();
  });

  it('a device that was never paired with the shop bills nothing (swipes are still stored)', async () => {
    const bot = await createDevice(t);
    const res = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: bot.auth, payload: { events: [swipe(s.shop.id, 'aalter-studio-1'), swipe(s.shop.id, 'raw-denim-01')] } });
    expect(res.json()).toMatchObject({ accepted: 2, usageEventsCreated: 0 });
    expect(await t.handle.db.select().from(usageEvents).where(eq(usageEvents.deviceId, bot.deviceId))).toHaveLength(0);
  });

  it('a paired device bills until the cap; then fit-shown and swipes stop billing and the merchant sees cap_reached', async () => {
    const d = await createDevice(t);
    await resolve(t, s.publicKeyPrefix, d, 'monochrome-02', 'button');
    const r1 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [swipe(s.shop.id, 'aalter-studio-1'), swipe(s.shop.id, 'raw-denim-01')] } });
    expect(r1.json().usageEventsCreated).toBe(2);
    // cap of 2 reached: a third product on the swipe path is not billed …
    const r2 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [swipe(s.shop.id, 'monochrome-02')] } });
    expect(r2.json()).toMatchObject({ accepted: 1, usageEventsCreated: 0 });
    // … and neither is a standalone fit-shown (one helper for both paths)
    const e = await createDevice(t);
    const embed = await resolve(t, s.publicKeyPrefix, e);
    const shown = await t.app.inject({ method: 'POST', url: `/v1/try/${embed.token}/fit-shown`, headers: e.auth, payload: { intentToken: embed.intentToken, recommendedSize: 'M', confidence: 0.7 } });
    expect(shown.json()).toEqual({ billed: false });
    // a replay of an already-billed key is a duplicate, not a refused session
    const replay = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [swipe(s.shop.id, 'aalter-studio-1')] } });
    expect(replay.json().usageEventsCreated).toBe(0);

    const today = utcDay(new Date());
    const daily = await t.handle.db.query.usageDaily.findFirst({ where: and(eq(usageDaily.shopId, s.shop.id), eq(usageDaily.day, today)) });
    expect(daily?.fitSessions).toBe(2);
    const [cap] = await t.handle.db.select().from(billingAnomalies).where(and(eq(billingAnomalies.shopId, s.shop.id), eq(billingAnomalies.kind, 'cap_reached')));
    expect(cap).toMatchObject({ day: today, billedSessions: 2, deniedSessions: 2, threshold: 2 });

    const res = await t.app.inject({ method: 'GET', url: `/v1/merchant/usage/anomalies?from=${today}&to=${today}`, headers: { authorization: `Bearer ${s.apiKey}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ dailyCap: number; today: { billedSessions: number; capReached: boolean }; anomalies: Array<{ kind: string; deniedSessions: number }> }>();
    expect(body.dailyCap).toBe(2);
    expect(body.today).toMatchObject({ billedSessions: 2, capReached: true });
    expect(body.anomalies).toEqual([expect.objectContaining({ kind: 'cap_reached', deniedSessions: 2 })]);
    // shop-level counters only: no device id reaches the merchant
    expect(res.body).not.toContain(d.deviceId);
    expect((await t.app.inject({ method: 'GET', url: `/v1/merchant/usage/anomalies?from=${today}&to=${today}` })).statusCode).toBe(401);
  });
});

describe('#7 anomaly signal: billed sessions far above the trailing average', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof embedShop>>;
  beforeAll(async () => {
    t = await makeApp({ BILLING_ANOMALY_MIN_SESSIONS: '2', BILLING_ANOMALY_FACTOR: '3', BILLING_ANOMALY_TRAILING_DAYS: '14' });
    s = await embedShop(t);
    // 14 days of history at 1 billed session a day → trailing average 1, threshold max(2, 3) = 3
    const rows = Array.from({ length: 14 }, (_, i) => ({ shopId: s.shop.id, day: utcDay(new Date(Date.now() - (i + 1) * DAY)), fitSessions: 1 }));
    await t.handle.db.insert(usageDaily).values(rows);
  });
  afterAll(async () => {
    await t.close();
  });

  it('flags a spike once the day exceeds 3 × the average; it never blocks billing', async () => {
    const today = utcDay(new Date());
    const a = await createDevice(t);
    const b = await createDevice(t);
    await resolve(t, s.publicKeyPrefix, a, 'aalter-studio-1', 'button');
    await resolve(t, s.publicKeyPrefix, b, 'aalter-studio-1', 'button');
    const r1 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: a.auth, payload: { events: [swipe(s.shop.id, 'raw-denim-01'), swipe(s.shop.id, 'monochrome-02'), swipe(s.shop.id, 'aalter-studio-1')] } });
    expect(r1.json().usageEventsCreated).toBe(3);
    expect(await t.handle.db.select().from(billingAnomalies).where(eq(billingAnomalies.shopId, s.shop.id))).toHaveLength(0);
    const r2 = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: b.auth, payload: { events: [swipe(s.shop.id, 'raw-denim-01')] } });
    expect(r2.json().usageEventsCreated).toBe(1);
    const [spike] = await t.handle.db.select().from(billingAnomalies).where(eq(billingAnomalies.shopId, s.shop.id));
    expect(spike).toMatchObject({ day: today, kind: 'spike', billedSessions: 4, threshold: 3, deniedSessions: 0 });
    expect(spike!.trailingAverage).toBeCloseTo(1, 5);

    const res = await t.app.inject({ method: 'GET', url: `/v1/merchant/usage/anomalies?from=${today}&to=${today}`, headers: { authorization: `Bearer ${s.apiKey}` } });
    expect(res.json().today).toMatchObject({ billedSessions: 4, spikeThreshold: 3, spike: true, capReached: false });
    expect(res.json().anomalies[0]).toMatchObject({ kind: 'spike', billedSessions: 4 });
  });
});

describe('#7 device minting is rate-limited per IP per hour', () => {
  it('refuses the third registration with DEVICE_CREATE_RATE_LIMIT_PER_HOUR=2', async () => {
    const t = await makeApp({ DEVICE_CREATE_RATE_LIMIT_PER_HOUR: '2' });
    try {
      const mint = () => t.app.inject({ method: 'POST', url: '/v1/devices', payload: { platform: 'web', appVersion: '0.1.0' } });
      expect((await mint()).statusCode).toBe(201);
      expect((await mint()).statusCode).toBe(201);
      const third = await mint();
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('rate_limited');
    } finally {
      await t.close();
    }
  });
});

describe('#9 DELETE /v1/me/signature and #10 device token rotation grace', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });
  const vector = (quality = 0.8) => {
    const v = new Array<number>(FS_LENGTH).fill(0);
    v[0] = 36;
    v[2] = 92;
    v[78] = 1;
    v[79] = quality;
    return v;
  };

  it('removes only the fit signature, writes an erase ledger entry, and is idempotent', async () => {
    const d = await createDevice(t);
    const { shop, publicKeyPrefix } = await embedShop(t);
    const put = await t.app.inject({ method: 'PUT', url: '/v1/me/signature', headers: d.auth, payload: { version: 1, vector: vector(), quality: 0.8 } });
    expect(put.statusCode).toBe(200);
    await resolve(t, publicKeyPrefix, d);
    expect(await t.handle.db.select().from(fitSignatures).where(eq(fitSignatures.deviceId, d.deviceId))).toHaveLength(1);

    const del = await t.app.inject({ method: 'DELETE', url: '/v1/me/signature', headers: d.auth });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ deleted: true });
    expect(await t.handle.db.select().from(fitSignatures).where(eq(fitSignatures.deviceId, d.deviceId))).toHaveLength(0);
    // the device, its pairing and its ledger survive ("Delete everything" is DELETE /v1/me)
    expect(await t.handle.db.select().from(pairings).where(and(eq(pairings.deviceId, d.deviceId), eq(pairings.shopId, shop.id)))).toHaveLength(1);
    const ledger = await t.handle.db.select().from(ledgerEntries).where(eq(ledgerEntries.deviceId, d.deviceId));
    expect(ledger.map((l) => l.kind)).toEqual(expect.arrayContaining(['signature_sync', 'pairing', 'erase']));
    expect(ledger.find((l) => l.kind === 'erase')!.payloadSummary).toMatchObject({ bytes: 0, fields: ['signature'] });

    const again = await t.app.inject({ method: 'DELETE', url: '/v1/me/signature', headers: d.auth });
    expect(again.json()).toMatchObject({ deleted: false });
    expect((await t.app.inject({ method: 'DELETE', url: '/v1/me/signature' })).statusCode).toBe(401);
  });

  it('an expired token answers token_expired, rotates within the grace (same device id), and only once', async () => {
    const d = await createDevice(t);
    const { token: expired } = await t.app.ctx.tokens.signDevice(d.deviceId, 0, -10); // expired 10 days ago
    const auth = { authorization: `Bearer ${expired}` };
    const use = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: auth });
    expect(use.statusCode).toBe(401);
    expect(use.json().error.code).toBe('token_expired');
    // the grace is for rotation only
    expect((await t.app.inject({ method: 'DELETE', url: '/v1/me/signature', headers: auth })).statusCode).toBe(401);

    const rot = await t.app.inject({ method: 'POST', url: '/v1/devices/rotate', headers: auth, payload: {} });
    expect(rot.statusCode).toBe(200);
    const fresh = rot.json<{ deviceId: string; token: string; tokenVersion: number; expiresAt: string }>();
    expect(fresh.deviceId).toBe(d.deviceId);
    expect(fresh.tokenVersion).toBe(1);
    expect(new Date(fresh.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: { authorization: `Bearer ${fresh.token}` } })).statusCode).toBe(200);

    // the rotated old token cannot rotate again
    const twice = await t.app.inject({ method: 'POST', url: '/v1/devices/rotate', headers: auth, payload: {} });
    expect(twice.statusCode).toBe(401);
    expect(twice.json().error.code).toBe('token_rotated');
  });

  it('beyond the grace (180 days past expiry) rotation fails and the token is invalid', async () => {
    const d = await createDevice(t);
    const { token } = await t.app.ctx.tokens.signDevice(d.deviceId, 0, -(30 + 181));
    const auth = { authorization: `Bearer ${token}` };
    const rot = await t.app.inject({ method: 'POST', url: '/v1/devices/rotate', headers: auth, payload: {} });
    expect(rot.statusCode).toBe(401);
    expect(rot.json().error.code).toBe('invalid_token');
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: auth })).json().error.code).toBe('invalid_token');
  });

  it('two concurrent rotations of the same token: exactly one wins', async () => {
    const d = await createDevice(t);
    const [a, b] = await Promise.all([
      t.app.inject({ method: 'POST', url: '/v1/devices/rotate', headers: d.auth, payload: {} }),
      t.app.inject({ method: 'POST', url: '/v1/devices/rotate', headers: d.auth, payload: {} }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 401]);
  });

  it('a forged token (wrong key) never rotates', async () => {
    const d = await createDevice(t);
    const forged = `${d.token.slice(0, -4)}AAAA`;
    expect((await t.app.inject({ method: 'POST', url: '/v1/devices/rotate', headers: { authorization: `Bearer ${forged}` }, payload: {} })).statusCode).toBe(401);
  });
});
