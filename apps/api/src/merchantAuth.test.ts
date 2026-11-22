import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';

describe('merchant routes answer 401 without a key, before schema validation', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t, { products: [] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('every merchant route without a key answers 401, even with an invalid query or body', async () => {
    const routes = [
      { method: 'GET', url: '/v1/merchant/products?from=not-a-date' },
      { method: 'GET', url: '/v1/merchant/usage?from=not-a-date&to=also-not-a-date' },
      { method: 'GET', url: '/v1/merchant/ledger?limit=-1' },
      { method: 'GET', url: '/v1/merchant/setup' },
      { method: 'GET', url: '/v1/merchant/settings' },
      { method: 'GET', url: '/v1/merchant/charts/templates' },
      { method: 'GET', url: '/v1/merchant/analytics/periods' },
      { method: 'GET', url: '/v1/merchant/analytics/swipes?period=invalid' },
      { method: 'GET', url: '/v1/merchant/analytics/abandoned?period=invalid' },
      { method: 'GET', url: '/v1/merchant/analytics/fit-sizes?period=invalid' },
      { method: 'GET', url: '/v1/merchant/usage/anomalies?from=bad&to=bad' },
      { method: 'POST', url: '/v1/merchant/products/validate', payload: { invalid: 'body' } },
      { method: 'PUT', url: '/v1/merchant/setup', payload: { invalid: 'body' } },
      { method: 'PUT', url: '/v1/merchant/settings', payload: { invalid: 'body' } },
      { method: 'PUT', url: '/v1/merchant/products/ext-1', payload: { invalid: 'body' } },
      { method: 'DELETE', url: '/v1/merchant/products/ext-1' },
      { method: 'POST', url: '/v1/merchant/keys/rotate' },
      { method: 'POST', url: '/v1/merchant/console-link' },
      { method: 'DELETE', url: '/v1/merchant/console-session' },
      { method: 'PUT', url: '/v1/merchant/shops/self', payload: { invalid: 'body' } },
      { method: 'POST', url: '/v1/merchant/billing/stripe/checkout' },
    ];

    for (const route of routes) {
      const res = await t.app.inject({
        method: route.method,
        url: route.url,
        ...(route.payload ? { payload: JSON.stringify(route.payload), headers: { 'content-type': 'application/json' } } : {}),
      });
      expect(res.statusCode, `${route.method} ${route.url} should be 401 without auth`).toBe(401);
    }
  });

  it('a valid key with an invalid query still returns 400 (validation runs)', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/merchant/usage?from=not-a-date&to=also-not-a-date',
      headers: { authorization: `Bearer ${s.apiKey}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a valid key with a valid query returns 200', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/merchant/usage?from=2026-01-01&to=2026-01-31',
      headers: { authorization: `Bearer ${s.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
