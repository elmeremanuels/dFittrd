/**
 * The merchant's first-run checklist (GET/PUT /v1/merchant/setup, services/setup.ts): every step ticks
 * itself from the shop's own rows, steps 4 and 5 can be ticked by hand, and nothing about a shopper is in
 * the answer (rule 4).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY, type SetupResponse } from '@curtain/schema';
import { products, trySessions, usageEvents } from './db/schema.js';
import { upsertProduct } from './services/products.js';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';

describe('GET /v1/merchant/setup', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeApp();
  });
  afterEach(async () => {
    await t.close();
  });

  const get = async (apiKey: string): Promise<SetupResponse> => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/merchant/setup', headers: { authorization: `Bearer ${apiKey}` } });
    expect(res.statusCode).toBe(200);
    return res.json<SetupResponse>();
  };
  const step = (r: SetupResponse, key: string) => r.steps.find((s) => s.key === key)!;

  it('a new shop with no products: connected, importing, the chart step is next', async () => {
    const { apiKey } = await seedShop(t, { products: [] });
    const r = await get(apiKey);
    expect(r.steps.map((s) => s.key)).toEqual(['connect', 'chart', 'measure', 'button', 'phone']);
    expect(r.steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5]);
    expect(step(r, 'connect')).toMatchObject({ done: true, action: null });
    expect(step(r, 'connect').detail).toMatch(/bringing in your products/);
    expect(r.next).toBe('chart');
    expect(r.doneCount).toBe(1);
    expect(r.headline).toBe('1 of 5 done');
    expect(r.platform).toBe('woocommerce');
    expect(step(r, 'button').detail).toMatch(/WooCommerce → Curtain/);
    expect(r.measureProduct).toBeNull();
    expect(r.phoneCheck).toBeNull();
  });

  it('ticks chart, measure, button and phone from the shop’s own rows, and offers the skirt to measure first', async () => {
    const { shop, apiKey } = await seedShop(t, { products: [] });
    const skirt = await upsertProduct(t.handle.db, shop.id, PILOT_SKIRT_CHART_ONLY.id, { ...PILOT_SKIRT_CHART_ONLY, productUrl: 'https://bohohippychic.com.au/products/crimson-wildflower-maxi-skirt' });
    let r = await get(apiKey);
    expect(step(r, 'chart')).toMatchObject({ done: true, detail: '1 product has a size chart.' });
    expect(r.next).toBe('measure');
    expect(r.measureProduct).toEqual({ externalId: PILOT_SKIRT_CHART_ONLY.id, name: 'Crimson Wildflower Maxi Skirt' });
    expect(r.phoneCheck).toMatchObject({ externalId: PILOT_SKIRT_CHART_ONLY.id, url: 'https://bohohippychic.com.au/products/crimson-wildflower-maxi-skirt' });
    expect(r.phoneCheck!.qrSvg).toMatch(/^<svg/);

    await upsertProduct(t.handle.db, shop.id, PILOT_PULL_ON_SKIRT.id, { ...PILOT_PULL_ON_SKIRT, productUrl: 'https://bohohippychic.com.au/products/crimson-wildflower-maxi-skirt' });
    r = await get(apiKey);
    expect(step(r, 'measure').done).toBe(true);
    expect(r.next).toBe('button');

    // A "Try it on" opened on the product page proves the button is live.
    await t.handle.db.insert(trySessions).values({ tokenJti: 'j1', intentToken: 'it_1', shopId: shop.id, productId: skirt.product.id, expiresAt: new Date(Date.now() + 60_000) });
    r = await get(apiKey);
    expect(step(r, 'button')).toMatchObject({ done: true, confirmLabel: null });
    expect(r.next).toBe('phone');

    // A size shown on the page finishes the list.
    await t.handle.db.insert(usageEvents).values({ shopId: shop.id, productId: skirt.product.id, kind: 'fit_session', idempotencyKey: 'intent:it_1' });
    r = await get(apiKey);
    expect(step(r, 'phone').detail).toBe('1 size was shown on your product pages in the last 30 days.');
    expect(r.next).toBeNull();
    expect(r.headline).toMatch(/All done/);
    // Rule 4: counts and the shop's own product pages only.
    expect(JSON.stringify(r)).not.toMatch(/deviceId|device_id|measurement"|hip"|waist"/);
  });

  it('a size shown on a page that is not counted (a theme preview) still ticks the phone check', async () => {
    const { shop, apiKey } = await seedShop(t, { products: [] });
    const skirt = await upsertProduct(t.handle.db, shop.id, 'p1', PILOT_SKIRT_CHART_ONLY);
    await t.handle.db.insert(trySessions).values({ tokenJti: 'j2', intentToken: 'it_2', shopId: shop.id, productId: skirt.product.id, expiresAt: new Date(Date.now() + 60_000), fitShownAt: new Date(), recommendedSize: '10' });
    const r = await get(apiKey);
    expect(step(r, 'phone')).toMatchObject({ done: true, detail: '1 size was shown on your product pages in the last 30 days.' });
    expect(JSON.stringify(r)).not.toContain('"10"');
  });

  it('PUT ticks the button and the phone check by hand, and they stay ticked', async () => {
    const { apiKey } = await seedShop(t, { products: ['aalter-studio-1'] });
    const put = await t.app.inject({ method: 'PUT', url: '/v1/merchant/setup', headers: { authorization: `Bearer ${apiKey}` }, payload: { buttonConfirmed: true } });
    expect(put.statusCode).toBe(200);
    expect(step(put.json<SetupResponse>(), 'button').done).toBe(true);
    expect(step(put.json<SetupResponse>(), 'phone').done).toBe(false);
    await t.app.inject({ method: 'PUT', url: '/v1/merchant/setup', headers: { authorization: `Bearer ${apiKey}` }, payload: { phoneConfirmed: true } });
    const r = await get(apiKey);
    expect(step(r, 'button').done).toBe(true);
    expect(step(r, 'phone')).toMatchObject({ done: true, detail: 'You checked it on your phone.' });
  });

  it('never offers a non-https product page as the phone link', async () => {
    const { shop, apiKey } = await seedShop(t, { products: [] });
    await upsertProduct(t.handle.db, shop.id, 'p1', { ...PILOT_SKIRT_CHART_ONLY, productUrl: 'http://shop.example/products/p1' });
    expect((await get(apiKey)).phoneCheck).toBeNull();
  });

  it('the products list says which products the shop measured', async () => {
    const { shop, apiKey } = await seedShop(t, { products: [] });
    await upsertProduct(t.handle.db, shop.id, 'skirt-a', PILOT_PULL_ON_SKIRT);
    await upsertProduct(t.handle.db, shop.id, 'skirt-b', PILOT_SKIRT_CHART_ONLY);
    const res = await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: { authorization: `Bearer ${apiKey}` } });
    const byId = Object.fromEntries(res.json<{ items: { externalId: string; measured?: boolean }[] }>().items.map((p) => [p.externalId, p.measured]));
    expect(byId).toEqual({ 'skirt-a': true, 'skirt-b': false });
    expect((await t.handle.db.select().from(products)).length).toBe(2);
  });

  it('needs a merchant key', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/merchant/setup' });
    expect(res.statusCode).toBe(401);
  });
});
