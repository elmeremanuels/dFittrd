/**
 * The k floor through the real routes (D3, launch-readiness finding 1): one closed calendar month per answer, frozen
 * once answered, complementary suppression inside every table. The attack-style property tests are in
 * `kfloor.property.test.ts`; these check the wiring, the shapes and the refusals.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WARDROBE_SIZE_UNKNOWN } from '@curtain/schema';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';
import { hueBucket } from './services/analytics.js';
import { addMonths, lastClosedMonth, utcMonth } from './services/kfloor.js';

const DAY = 86_400_000;
/** Rows are written at the real time; the app's clock is moved past the month's end (and grace) before reading. */
const LATER = 70 * DAY;

describe('k-anonymity floor (K_ANON=5)', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  const clock = { shift: 0 };
  const devices: Awaited<ReturnType<typeof createDevice>>[] = [];
  const period = utcMonth(new Date());
  const merchant = () => ({ authorization: `Bearer ${s.apiKey}` });
  const get = (path: string) => t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/${path}?period=${period}`, headers: merchant() });
  beforeAll(async () => {
    t = await makeApp({ K_ANON: '5' }, { now: () => new Date(Date.now() + clock.shift) });
    s = await seedShop(t);
    for (let i = 0; i < 16; i++) devices.push(await createDevice(t));
  });
  afterAll(async () => {
    await t.close();
  });
  const later = async <T>(fn: () => Promise<T>): Promise<T> => {
    clock.shift = LATER;
    try {
      return await fn();
    } finally {
      clock.shift = 0;
    }
  };

  it('refuses an arbitrary from/to and a month that is not over yet; lists the closed months', async () => {
    const day = new Date().toISOString().slice(0, 10);
    for (const path of ['swipes', 'fit-sizes', 'abandoned']) {
      const range = await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/${path}?from=${day}&to=${day}`, headers: merchant() });
      expect(range.statusCode, path).toBe(400);
      const mixed = await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/${path}?period=${period}&from=${day}`, headers: merchant() });
      expect(mixed.statusCode, path).toBe(400);
      const open = await get(path);
      expect(open.statusCode, path).toBe(400);
      expect(open.json<{ error: { code: string } }>().error.code).toBe('period_not_closed');
      expect((await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/${path}?period=2026-13`, headers: merchant() })).statusCode).toBe(400);
    }
    const periods = await t.app.inject({ method: 'GET', url: '/v1/merchant/analytics/periods', headers: merchant() });
    expect(periods.statusCode).toBe(200);
    // The shop was created this month: nothing is closed yet.
    expect(periods.json()).toMatchObject({ granularity: 'month', kAnonymityFloor: 5, periods: [] });
    expect(periods.json<{ openPeriod: string }>().openPeriod).toBe(addMonths(lastClosedMonth(new Date()), 1));
    const laterPeriods = await later(() => t.app.inject({ method: 'GET', url: '/v1/merchant/analytics/periods', headers: merchant() }));
    expect(laterPeriods.json<{ periods: string[] }>().periods).toContain(period);
    expect((await t.app.inject({ method: 'GET', url: '/v1/merchant/analytics/periods' })).statusCode).toBe(401);
  });

  it('cohort: a month below the floor is left out; a hidden size is never recoverable from n', async () => {
    // aalter-studio-1: five people kept M, one returned XL. Showing M=5 next to n=6 would give the XL person away.
    for (const d of devices.slice(0, 5)) {
      await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/aalter-studio-1', headers: d.auth, payload: { shopId: s.shop.id, size: 'M', state: 'kept' } });
    }
    await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/aalter-studio-1', headers: devices[5]!.auth, payload: { shopId: s.shop.id, size: 'XL', state: 'returned' } });
    await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/monochrome-02', headers: devices[5]!.auth, payload: { shopId: s.shop.id, size: 'S', state: 'returned' } });

    // While the month is open the cohort shows nothing of it.
    const now = await t.app.inject({ method: 'GET', url: '/v1/fit/cohort/aalter-studio-1', headers: devices[0]!.auth });
    expect(now.json()).toMatchObject({ n: 0, sizeHistogram: {}, keptRate: null });

    const below = await later(() => t.app.inject({ method: 'GET', url: '/v1/fit/cohort/monochrome-02', headers: devices[0]!.auth }));
    expect(below.json()).toEqual({ productId: 'monochrome-02', n: 0, kAnonymityFloor: 5, sizeHistogram: {}, keptRate: null, through: lastClosedMonth(new Date(Date.now() + LATER)) });

    const six = await later(() => t.app.inject({ method: 'GET', url: `/v1/fit/cohort/aalter-studio-1?shopId=${s.shop.id}`, headers: devices[0]!.auth }));
    expect(six.json()).toMatchObject({ n: 6, sizeHistogram: {} });
    expect(six.json<{ keptRate: number }>().keptRate).toBeCloseTo(5 / 6, 3);
  });

  it('cohort: rows saved without a size count towards n and the hidden remainder, never as an "unknown" bucket', async () => {
    for (const d of devices.slice(0, 5)) {
      const r = await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/raw-denim-01', headers: d.auth, payload: { shopId: s.shop.id, size: WARDROBE_SIZE_UNKNOWN, state: 'kept' } });
      expect(r.statusCode).toBeLessThan(300);
    }
    const res = await later(() => t.app.inject({ method: 'GET', url: '/v1/fit/cohort/raw-denim-01', headers: devices[0]!.auth }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ productId: 'raw-denim-01', n: 5, kAnonymityFloor: 5, sizeHistogram: {}, keptRate: 1 });
    expect(res.json().sizeHistogram[WARDROBE_SIZE_UNKNOWN]).toBeUndefined();
  });

  it('swipes: products and their sizes are floored with complementary suppression; colour, fabric and size sum shown cells only', async () => {
    const at = Date.now();
    const swipe = (d: (typeof devices)[number], itemId: string, action: string, size: string, tag: string) =>
      t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [{ itemId, action, at, sizeAtSwipe: size, fitScore: 0.8, ...(action === 'pass' ? { reasons: ['fit'] } : {}), dealIndex: 0, shopId: s.shop.id, clientId: `${tag}-${d.deviceId}` }] } });
    // aalter: 5 × M, 5 × L, 1 × XS (11 people); monochrome: 5 people; raw-denim: 2 people.
    for (const [i, d] of devices.slice(0, 11).entries()) await swipe(d, 'aalter-studio-1', 'love', i < 5 ? 'M' : i < 10 ? 'L' : 'XS', 'a');
    for (const d of devices.slice(11, 16)) await swipe(d, 'monochrome-02', 'save', 'S', 'm');
    for (const d of devices.slice(0, 2)) await swipe(d, 'raw-denim-01', 'pass', '28', 'r');

    const res = await later(() => get('swipes'));
    expect(res.statusCode).toBe(200);
    const a = res.json<{ period: string; byProduct: Array<{ externalId: string; love: number; sizeHistogram: Record<string, number> }>; bySize: Array<{ size: string; love: number }>; byColour: Array<{ love: number; save: number }>; byFabric: unknown[]; suppression: object; suppressedGroups: number }>();
    expect(a.period).toBe(period);
    // raw-denim (2 people) is below the floor; on its own it would be "total minus the rest", so the smallest
    // shown product (monochrome, 5 people) is hidden with it.
    expect(a.byProduct.map((p) => p.externalId)).toEqual(['aalter-studio-1']);
    // Inside aalter: XS (1 person) is below the floor, so L (5 people, sorted before M) is hidden with it.
    expect(a.byProduct[0]).toMatchObject({ love: 11, sizeHistogram: { M: 5 } });
    expect(a.bySize).toEqual([{ size: 'M', love: 5, pass: 0, save: 0, less: 0 }]);
    expect(a.byColour.reduce((n, c) => n + c.love + c.save, 0)).toBe(11);
    expect(a.byFabric).toHaveLength(1);
    expect(a.suppression).toEqual({ belowFloor: 2, complementary: 2 });
    expect(a.suppressedGroups).toBe(4);
    for (const d of devices) expect(res.body).not.toContain(d.deviceId);
  });

  it('abandoned opens: the floor counts distinct shoppers, not sessions; a hidden product is never total minus the rest (#19)', async () => {
    const open = async (productExternalId: string) => {
      const res = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId, pageUrl: 'https://m.example/p' } });
      return res.json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    };
    // monochrome-02: five shoppers resolve, plus three opens that never resolve.
    for (const d of devices.slice(0, 5)) expect((await t.app.inject({ method: 'GET', url: `/v1/try/${await open('monochrome-02')}`, headers: d.auth })).statusCode).toBe(200);
    for (let i = 0; i < 3; i++) await open('monochrome-02');
    // aalter-studio-1: five shoppers, one session each.
    for (const d of devices.slice(5, 10)) await t.app.inject({ method: 'GET', url: `/v1/try/${await open('aalter-studio-1')}`, headers: d.auth });
    // raw-denim-01: six sessions, all one shopper → below the floor although sessions >= K.
    for (let i = 0; i < 6; i++) await t.app.inject({ method: 'GET', url: `/v1/try/${await open('raw-denim-01')}`, headers: devices[15]!.auth });

    const res = await later(() => get('abandoned'));
    expect(res.statusCode).toBe(200);
    expect(res.json().byProduct).toEqual([{ externalId: 'monochrome-02', sessions: 8, resolved: 5, withFit: 0, abandonedRate: 1 }]);
    expect(res.json().suppression).toEqual({ belowFloor: 1, complementary: 1 });
    expect(res.json().totals).toEqual({ sessions: 8, resolved: 5, withFit: 0 });
  });

  it('standalone fit-shown sizes: floor on distinct shoppers, complementary suppression, frozen after the first answer (#18)', async () => {
    const shown = async (d: (typeof devices)[number], size: string) => {
      const sdk = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId: 'aalter-studio-1', pageUrl: 'https://m.example/p', surface: 'embed' } });
      const token = sdk.json<{ embedUrl: string }>().embedUrl.split('/embed/')[1]!;
      const r = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
      const intentToken = r.json<{ trySession: { intentToken: string } }>().trySession.intentToken;
      const f = await t.app.inject({ method: 'POST', url: `/v1/try/${token}/fit-shown`, headers: d.auth, payload: { intentToken, recommendedSize: size, confidence: 0.6 } });
      expect(f.statusCode).toBe(200);
    };
    for (const d of devices.slice(0, 5)) await shown(d, 'M');
    await shown(devices[0]!, 'M'); // a second session by the same shopper counts as a session, not a person
    for (const d of devices.slice(6, 11)) await shown(d, 'L');
    await shown(devices[5]!, 'XL');
    await shown(devices[5]!, 'XL');
    const res = await later(() => get('fit-sizes'));
    expect(res.statusCode).toBe(200);
    const { from, to } = res.json<{ from: string; to: string }>();
    expect(res.json()).toEqual({ period, from, to, kAnonymityFloor: 5, suppressedGroups: 2, suppression: { belowFloor: 1, complementary: 1 }, bySize: [{ size: 'M', sessions: 6 }], totals: { sessions: 6 } });
    expect(from).toBe(`${period}-01`);
    for (const d of devices) expect(res.body).not.toContain(d.deviceId);

    // An M shopper is erased: the same question keeps its first answer, so "before minus after" shows nothing.
    expect((await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: devices[1]!.auth })).statusCode).toBe(200);
    const again = await later(() => get('fit-sizes'));
    expect(again.json()).toEqual(res.json());
    expect((await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/fit-sizes?period=${period}` })).statusCode).toBe(401);
  });

  it('hue buckets', () => {
    expect(hueBucket('#FF5A3C')).toBe('red');
    expect(hueBucket('#1E2B4D')).toBe('blue');
    expect(hueBucket('#1A1612')).toBe('black');
    expect(hueBucket('#F5EFE7')).toBe('white');
    expect(hueBucket('#fff')).toBe('white');
    expect(hueBucket(null)).toBe('unknown');
  });
});

describe('a raised floor never re-answers a frozen month', () => {
  it('a month frozen under K=1 is served with every row hidden once K is 5', async () => {
    const { swipeAnalytics } = await import('./services/analytics.js');
    const t = await makeApp({ K_ANON: '1' });
    try {
      const s = await seedShop(t);
      const d = await createDevice(t);
      await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [{ itemId: 'aalter-studio-1', action: 'love', at: Date.now(), sizeAtSwipe: 'M', fitScore: 0.9, dealIndex: 0, shopId: s.shop.id, clientId: 'c_00000001' }] } });
      const period = utcMonth(new Date());
      const k1 = await swipeAnalytics(t.handle.db, s.shop.id, period, 1);
      expect(k1.byProduct).toHaveLength(1);
      const k5 = await swipeAnalytics(t.handle.db, s.shop.id, period, 5);
      expect(k5).toMatchObject({ kAnonymityFloor: 5, byProduct: [], bySize: [], byColour: [], byFabric: [], suppression: { belowFloor: 1, complementary: 0 } });
    } finally {
      await t.close();
    }
  });
});
