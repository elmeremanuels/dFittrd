import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from './demoSeed.js';
import { makeApp, type TestApp } from './test/helpers.js';

describe('local demo seed (docs/STANDALONE.md §4)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('seeds Aalter Studio on both platforms with ≥ 8 active dresses, tops and bottoms; idempotent', async () => {
    const first = await seedDemo(t.handle.db, t.env);
    expect(first.shops.map((s) => [s.name, s.platform])).toEqual([
      ['Aalter Studio', 'woocommerce'],
      ['Aalter Studio (Shopify)', 'shopify'],
    ]);
    for (const shop of first.shops) {
      expect(shop.publicKey).toMatch(/^pk_test_[A-Za-z0-9]{6,32}$/);
      expect(shop.products.length).toBeGreaterThanOrEqual(8);
      expect(shop.products.every((p) => p.status === 'active')).toBe(true);
      expect(shop.products.map((p) => p.category)).toEqual(expect.arrayContaining(['dress', 'top', 'bottom']));
      expect(shop.allowedOrigins).toEqual(expect.arrayContaining(['http://localhost:5180', 'http://localhost:3000']));
    }
    expect(first.publicKey).toBe(first.shops[0]!.publicKey);
    // UX-3: product photos come from the demo storefront, never a third-party placeholder host.
    for (const p of first.shops.flatMap((s) => s.products)) expect(p.photo).toBe(`http://localhost:5180/img/${p.externalId}.svg`);
    expect(first.productExternalIds).toContain('aalter-studio-1');

    const again = await seedDemo(t.handle.db, t.env);
    expect(again.shops.map((s) => s.publicKey)).toEqual(first.shops.map((s) => s.publicKey));
    expect(again.shops.map((s) => s.shopId)).toEqual(first.shops.map((s) => s.shopId));

    // The seeded key opens an embed session for a seeded product.
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/sdk/sessions',
      payload: { shopKeyPrefix: first.publicKey, productExternalId: first.productExternalIds[0], pageUrl: 'http://localhost:5180/woo/', surface: 'embed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().embedUrl).toContain('/embed/');
  });
});
