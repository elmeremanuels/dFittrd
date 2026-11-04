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

  it('abandoned sessions are aggregated per product with the floor', async () => {
    for (let i = 0; i < 5; i++) {
      await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId: 'monochrome-02', pageUrl: 'https://m.example/p' } });
    }
    await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId: 'raw-denim-01', pageUrl: 'https://m.example/p' } });
    const day = new Date().toISOString().slice(0, 10);
    const res = await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/abandoned?from=${day}&to=${day}`, headers: { authorization: `Bearer ${s.apiKey}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().byProduct).toEqual([{ externalId: 'monochrome-02', sessions: 5, resolved: 0, withFit: 0, abandonedRate: 1 }]);
    expect(res.json().suppressedGroups).toBe(1);
    expect(res.json().totals.sessions).toBe(6);
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
