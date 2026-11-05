import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';
import { hueBucket } from './services/analytics.js';

describe('k-anonymity floor (K_ANON=5)', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  const devices: Awaited<ReturnType<typeof createDevice>>[] = [];
  beforeAll(async () => {
    t = await makeApp({ K_ANON: '5' });
    s = await seedShop(t);
    for (let i = 0; i < 6; i++) devices.push(await createDevice(t));
  });
  afterAll(async () => {
    await t.close();
  });

  it('cohort: below the floor nothing is returned; at the floor the histogram and kept rate appear', async () => {
    for (const d of devices.slice(0, 5)) {
      await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/aalter-studio-1', headers: d.auth, payload: { shopId: s.shop.id, size: 'M', state: 'kept' } });
    }
    await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/monochrome-02', headers: devices[5]!.auth, payload: { shopId: s.shop.id, size: 'S', state: 'returned' } });

    const below = await t.app.inject({ method: 'GET', url: '/v1/fit/cohort/monochrome-02', headers: devices[0]!.auth });
    expect(below.json()).toEqual({ productId: 'monochrome-02', n: 1, kAnonymityFloor: 5, sizeHistogram: {}, keptRate: null });

    const at = await t.app.inject({ method: 'GET', url: `/v1/fit/cohort/aalter-studio-1?shopId=${s.shop.id}`, headers: devices[0]!.auth });
    expect(at.json()).toEqual({ productId: 'aalter-studio-1', n: 5, kAnonymityFloor: 5, sizeHistogram: { M: 5 }, keptRate: 1 });

    // a 6th user with a unique size must not leak that size
    await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/aalter-studio-1', headers: devices[5]!.auth, payload: { shopId: s.shop.id, size: 'XL', state: 'returned' } });
    const six = await t.app.inject({ method: 'GET', url: '/v1/fit/cohort/aalter-studio-1', headers: devices[0]!.auth });
    expect(six.json()).toMatchObject({ n: 6, sizeHistogram: { M: 5 } });
    expect(six.json().sizeHistogram.XL).toBeUndefined();
    expect(six.json().keptRate).toBeCloseTo(5 / 6, 3);
  });

  it('merchant swipe analytics suppress groups with fewer than K users and carry no body data', async () => {
    const at = Date.now();
    for (const d of devices.slice(0, 5)) {
      await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [{ itemId: 'aalter-studio-1', action: 'love', at, sizeAtSwipe: 'M', fitScore: 0.9, dealIndex: 0, shopId: s.shop.id, clientId: `a-${d.deviceId}` }] } });
    }
    for (const d of devices.slice(0, 2)) {
      await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [{ itemId: 'raw-denim-01', action: 'pass', at, sizeAtSwipe: '28', fitScore: 0.4, reasons: ['fit'], dealIndex: 1, shopId: s.shop.id, clientId: `b-${d.deviceId}` }] } });
    }
    const day = new Date(at).toISOString().slice(0, 10);
    const res = await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/swipes?from=${day}&to=${day}`, headers: { authorization: `Bearer ${s.apiKey}` } });
    expect(res.statusCode).toBe(200);
    const a = res.json<{ kAnonymityFloor: number; suppressedGroups: number; byProduct: Array<{ externalId: string; love: number; sizeHistogram: Record<string, number> }>; bySize: Array<{ size: string }>; byColour: Array<{ hue: string }>; byFabric: Array<{ fabric: string }> }>();
    expect(a.kAnonymityFloor).toBe(5);
    expect(a.byProduct.map((p) => p.externalId)).toEqual(['aalter-studio-1']);
    expect(a.byProduct[0]).toMatchObject({ love: 5, sizeHistogram: { M: 5 } });
    expect(a.bySize.map((x) => x.size)).toEqual(['M']);
    expect(a.suppressedGroups).toBeGreaterThanOrEqual(3); // raw-denim by product, by size '28', denim fabric, its colour
    expect(a.byFabric.length).toBe(1);
    expect(a.byColour.length).toBe(1);
    const text = JSON.stringify(a);
    for (const d of devices) expect(text).not.toContain(d.deviceId);
  });

  it('abandoned opens: the floor counts distinct shoppers, not sessions, and totals leak no suppressed rows (#19)', async () => {
    const open = async (productExternalId: string) => {
      const res = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId, pageUrl: 'https://m.example/p' } });
      return res.json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    };
    // monochrome-02: five different shoppers resolve, plus three opens that never resolve
    for (const d of devices.slice(0, 5)) {
      const token = await open('monochrome-02');
      expect((await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth })).statusCode).toBe(200);
    }
    for (let i = 0; i < 3; i++) await open('monochrome-02');
    // raw-denim-01: six sessions, all one shopper → below the floor although sessions >= K
    for (let i = 0; i < 6; i++) {
      const token = await open('raw-denim-01');
      await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: devices[5]!.auth });
    }
    const day = new Date().toISOString().slice(0, 10);
    const res = await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/abandoned?from=${day}&to=${day}`, headers: { authorization: `Bearer ${s.apiKey}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().byProduct).toEqual([{ externalId: 'monochrome-02', sessions: 8, resolved: 5, withFit: 0, abandonedRate: 1 }]);
    expect(res.json().suppressedGroups).toBe(1);
    expect(res.json().totals).toEqual({ sessions: 8, resolved: 5, withFit: 0 });
  });

  it('standalone fit-shown sizes: k floor on distinct shoppers, totals over reported sizes only (#18)', async () => {
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
    await shown(devices[5]!, 'XL');
    await shown(devices[5]!, 'XL');
    const day = new Date().toISOString().slice(0, 10);
    const auth = { authorization: `Bearer ${s.apiKey}` };
    const res = await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/fit-sizes?from=${day}&to=${day}`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ from: day, to: day, kAnonymityFloor: 5, suppressedGroups: 1, bySize: [{ size: 'M', sessions: 6 }], totals: { sessions: 6 } });
    for (const d of devices) expect(res.body).not.toContain(d.deviceId);
    expect((await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/fit-sizes?from=${day}&to=${day}` })).statusCode).toBe(401);
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
