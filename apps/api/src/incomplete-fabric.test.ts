/**
 * Point 10 (D24 point 4, D25 point 1) on the api: a product whose fabric has only a name is stored
 * and can be sized, whichever way it comes in (the plain merchant PUT, the Shopify sync's mapped
 * product, the WooCommerce plugin's payload).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_ID, fromShopifyProduct, fromWooMeta } from '@curtain/schema';
import { shops } from './db/schema.js';
import { asTryGarment, findProduct, upsertProduct } from './services/products.js';
import { findShopById } from './services/shops.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const WRAP = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
const NAME_ONLY = { primary: 'linen' };
const base = (id: string) => ({ id, name: 'Linen Wrap Dress', brand: 'Aalter Studio', category: 'dress', sizeChartType: 'body', sizeChart: WRAP.sizeChart });

describe('a fabric with only a name', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t, { products: [] });
  });
  afterAll(async () => {
    await t.close();
  });
  const put = (id: string, payload: unknown) => t.app.inject({ method: 'PUT', url: `/v1/merchant/products/${id}`, headers: { authorization: `Bearer ${s.apiKey}` }, payload: payload as object });

  it('plain api: PUT stores it as active and keeps the name', async () => {
    const res = await put('plain-1', { ...base('plain-1'), fabric: NAME_ONLY });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ externalId: 'plain-1', status: 'active', changed: true });
    expect((await findProduct(t.handle.db, s.shop.id, 'plain-1'))?.payload.fabric).toEqual(NAME_ONLY);
  });

  it('Shopify: the product the sync job maps from metafields is stored', async () => {
    const mapped = fromShopifyProduct(
      { id: 'gid://shopify/Product/8812345678901', handle: 'linen-wrap-dress', title: 'Linen Wrap Dress', vendor: 'Aalter Studio', productType: 'Dresses', status: 'ACTIVE' },
      [
        { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
        { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify(WRAP.sizeChart) },
        { namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify(NAME_ONLY) },
      ],
      { defaultBrand: 'Aalter Studio' },
    );
    expect(mapped.fabric).toEqual(NAME_ONLY);
    // As jobs/syncShopifyProduct.ts calls it.
    const r = await upsertProduct(t.handle.db, s.shop.id, mapped.id!, { ...mapped, brand: mapped.brand ?? 'Aalter Studio' }, { handle: 'linen-wrap-dress', audienceSource: null });
    expect(r.status).toBe('active');
    expect(r.product.payload.fabric).toEqual(NAME_ONLY);
  });

  it('WooCommerce: the payload the plugin builds from product meta is stored', async () => {
    const mapped = fromWooMeta({
      id: 42,
      name: 'Linen Wrap Dress',
      slug: 'linen-wrap-dress',
      type: 'variable',
      status: 'publish',
      price: '149',
      categories: [{ id: 7, name: 'Dresses', slug: 'dresses' }],
      attributes: [{ name: 'Brand', slug: 'pa_brand', options: ['Aalter Studio'] }],
      meta_data: [
        { key: '_curtain_size_chart_type', value: 'body' },
        { key: '_curtain_size_chart', value: JSON.stringify(WRAP.sizeChart) },
        { key: '_curtain_fabric', value: JSON.stringify(NAME_ONLY) },
      ],
    });
    expect(mapped.fabric).toEqual(NAME_ONLY);
    const res = await put(mapped.id!, mapped);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'active' });
  });
});

describe('incomplete product data: notices, the shop setting, and holding a product back', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  let other: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t, { products: [] });
    other = await seedShop(t, { products: [] });
  });
  afterAll(async () => {
    await t.close();
  });
  const auth = (key = s.apiKey) => ({ authorization: `Bearer ${key}` });
  const put = (id: string, payload: unknown, key?: string) => t.app.inject({ method: 'PUT', url: `/v1/merchant/products/${id}`, headers: auth(key), payload: payload as object });
  const setPolicy = (incompleteProductData: string, key?: string) => t.app.inject({ method: 'PUT', url: '/v1/merchant/settings', headers: auth(key), payload: { incompleteProductData } });
  const stored = (id: string) => findProduct(t.handle.db, s.shop.id, id);
  const tryStatus = async (externalId: string) => {
    const device = await createDevice(t);
    const session = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', headers: { origin: 'https://merchant.example' }, payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId: externalId, pageUrl: 'https://merchant.example/p' } });
    if (session.statusCode !== 200) return { session: session.statusCode, try: null };
    const token = session.json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    const res = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: device.auth });
    return { session: 200, try: res.statusCode, code: res.statusCode === 200 ? null : res.json<{ error: { code: string } }>().error.code };
  };

  describe('GET/PUT /v1/merchant/settings', () => {
    it('needs merchant auth', async () => {
      expect((await t.app.inject({ method: 'GET', url: '/v1/merchant/settings' })).statusCode).toBe(401);
      expect((await t.app.inject({ method: 'PUT', url: '/v1/merchant/settings', payload: { incompleteProductData: 'hold-back' } })).statusCode).toBe(401);
    });

    it('lets through by default; the choice is stored per shop', async () => {
      const get = () => t.app.inject({ method: 'GET', url: '/v1/merchant/settings', headers: auth() });
      expect((await get()).json()).toEqual({ incompleteProductData: 'let-through' });
      const res = await setPolicy('hold-back');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ incompleteProductData: 'hold-back' });
      expect((await get()).json()).toEqual({ incompleteProductData: 'hold-back' });
      // Another shop is not touched.
      expect((await t.app.inject({ method: 'GET', url: '/v1/merchant/settings', headers: auth(other.apiKey) })).json()).toEqual({ incompleteProductData: 'let-through' });
      // An empty update changes nothing.
      expect((await t.app.inject({ method: 'PUT', url: '/v1/merchant/settings', headers: auth(), payload: {} })).json()).toEqual({ incompleteProductData: 'hold-back' });
      expect((await setPolicy('let-through')).json()).toEqual({ incompleteProductData: 'let-through' });
    });

    it('refuses a value outside the two, and any key that is not named', async () => {
      expect((await setPolicy('refuse')).statusCode).toBe(400);
      const sneaky = await t.app.inject({ method: 'PUT', url: '/v1/merchant/settings', headers: auth(), payload: { incompleteProductData: 'hold-back', garment3d: true, includedSessions: 999999 } });
      expect(sneaky.statusCode).toBe(400);
      const shop = await findShopById(t.handle.db, s.shop.id);
      expect(shop?.incompleteProductData).toBe('let-through');
      expect(shop?.settings.garment3d).toBeUndefined();
      expect(shop?.settings.includedSessions).toBeUndefined();
    });
  });

  describe('let-through (the default)', () => {
    it('a name-only fabric: stored, active, and the answer says stretch and drape were assumed', async () => {
      const res = await put('lt-1', { ...base('lt-1'), fabric: NAME_ONLY });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ status: 'active', heldBack: null });
      expect(body.notices.leftOut).toEqual([]);
      expect(body.notices.defaulted).toEqual(expect.arrayContaining(['fabric.stretchPct', 'fabric.drape']));
      expect(body.notices.defaulted).not.toContain('fabric.primary');
      expect((await tryStatus('lt-1')).try).toBe(200);
    });

    it('a complete product has no notices', async () => {
      const res = await put('lt-full', { ...WRAP, id: 'lt-full' });
      expect(res.json()).toMatchObject({ status: 'active', heldBack: null, notices: { defaulted: [], leftOut: [] } });
      expect((await stored('lt-full'))?.payload.fabric).toEqual(WRAP.fabric);
    });

    it('stretch 150: not a 400. Only that value is left out, with a notice; the rest of the fabric and the chart are kept', async () => {
      const res = await put('lt-2', { ...base('lt-2'), fabric: { primary: 'linen', blend: [['linen', 100]], stretchPct: 150, drape: 0.7 } });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.status).toBe('active');
      expect(body.notices.leftOut).toEqual([{ field: 'fabric.stretchPct', reason: expect.any(String) }]);
      expect(body.notices.defaulted).toContain('fabric.stretchPct');
      const row = await stored('lt-2');
      expect(row?.payload.fabric).toEqual({ primary: 'linen', blend: [['linen', 100]], drape: 0.7 });
      expect(row?.payload.sizeChart).toEqual(WRAP.sizeChart);
      // The shopper is sized with 0 % stretch.
      expect(asTryGarment(row!)?.fabric.stretchPct).toBe(0);
    });

    it('sending the same body again is a no-op that still reports the notice', async () => {
      const res = await put('lt-2', { ...base('lt-2'), fabric: { primary: 'linen', blend: [['linen', 100]], stretchPct: 150, drape: 0.7 } });
      expect(res.json()).toMatchObject({ changed: false, status: 'active' });
      expect(res.json().notices.leftOut.map((l: { field: string }) => l.field)).toEqual(['fabric.stretchPct']);
    });

    it('everything else is still validated: a bad chart is a 400 and stores nothing', async () => {
      const res = await put('lt-3', { ...base('lt-3'), sizeChart: [{ size: 'S' }, { size: 's' }], fabric: NAME_ONLY });
      expect(res.statusCode).toBe(400);
      expect(await stored('lt-3')).toBeUndefined();
      expect((await put('lt-4', { ...base('lt-4'), fabric: '95% cotton' })).statusCode).toBe(400);
    });

    it('the product list does not mark it', async () => {
      const list = await t.app.inject({ method: 'GET', url: '/v1/merchant/products?limit=50', headers: auth() });
      const item = list.json<{ items: Array<{ externalId: string; heldBack?: unknown }> }>().items.find((i) => i.externalId === 'lt-1');
      expect(item).toBeDefined();
      expect(item).not.toHaveProperty('heldBack');
    });
  });

  describe('hold-back', () => {
    const HELD = { reason: 'incomplete_product_data', fields: ['fabric.stretchPct'] };

    it('switching the setting holds back the products the shop already has, and only the incomplete ones', async () => {
      expect((await setPolicy('hold-back')).statusCode).toBe(200);
      expect(await stored('lt-1')).toMatchObject({ status: 'incomplete', heldBack: HELD });
      expect(await stored('lt-full')).toMatchObject({ status: 'active', heldBack: null });
      expect(await tryStatus('lt-1')).toMatchObject({ try: 422, code: 'product_incomplete' });
      expect((await tryStatus('lt-full')).try).toBe(200);
    });

    it('a new incomplete product answers 200 with the held-back state, and is stored as not ready with the reason', async () => {
      const res = await put('hb-1', { ...base('hb-1'), fabric: NAME_ONLY });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ externalId: 'hb-1', status: 'incomplete', changed: true, heldBack: HELD });
      const row = await stored('hb-1');
      expect(row).toMatchObject({ status: 'incomplete', heldBack: HELD });
      expect(row?.payload.fabric).toEqual(NAME_ONLY);
      expect(asTryGarment(row!)).toBeNull();
    });

    it('a chart fix in the same save is kept, and the data that was live before does not stay live', async () => {
      // Live and complete first.
      expect((await put('hb-2', { ...WRAP, id: 'hb-2' })).json()).toMatchObject({ status: 'active', heldBack: null });
      expect((await tryStatus('hb-2')).try).toBe(200);
      // One save: the chart is corrected and the stretch is no longer valid.
      const fixedChart = WRAP.sizeChart.map((r) => (r.size === 'M' ? { ...r, bust: 93 } : r));
      const res = await put('hb-2', { ...WRAP, id: 'hb-2', sizeChart: fixedChart, fabric: { ...WRAP.fabric, stretchPct: 150 } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ status: 'incomplete', changed: true, heldBack: HELD });
      expect(res.json().notices.leftOut.map((l: { field: string }) => l.field)).toEqual(['fabric.stretchPct']);
      const row = await stored('hb-2');
      expect(row?.payload.sizeChart).toEqual(fixedChart);
      const { stretchPct: _stretch, ...restOfFabric } = WRAP.fabric;
      void _stretch;
      expect(row?.payload.fabric).toEqual(restOfFabric);
      expect(row?.status).toBe('incomplete');
      // Shoppers no longer get the old product.
      expect(await tryStatus('hb-2')).toMatchObject({ try: 422, code: 'product_incomplete' });
      const peekable = await t.app.inject({ method: 'GET', url: '/v1/merchant/products?status=active&limit=50', headers: auth() });
      expect(peekable.json<{ items: Array<{ externalId: string }> }>().items.map((i) => i.externalId)).not.toContain('hb-2');
    });

    it('a value left out other than stretch holds the product back too; a missing drape alone does not', async () => {
      const bad = await put('hb-3', { ...base('hb-3'), fabric: { primary: 'linen', stretchPct: 2, drape: 7 } });
      expect(bad.json()).toMatchObject({ status: 'incomplete', heldBack: { reason: 'incomplete_product_data', fields: ['fabric.drape'] } });
      const noDrape = await put('hb-4', { ...base('hb-4'), fabric: { primary: 'linen', stretchPct: 2 } });
      expect(noDrape.json()).toMatchObject({ status: 'active', heldBack: null });
      expect(noDrape.json().notices.defaulted).toContain('fabric.drape');
    });

    it('a complete product is active, and an accessory needs no stretch', async () => {
      expect((await put('hb-full', { ...WRAP, id: 'hb-full' })).json()).toMatchObject({ status: 'active', heldBack: null });
      const bag = MOCK_GARMENTS.find((g) => g.category === 'accessory')!;
      const res = await put('hb-bag', { id: 'hb-bag', name: bag.name, brand: bag.brand, category: 'accessory', sizeChartType: bag.sizeChartType, sizeChart: bag.sizeChart });
      expect(res.json()).toMatchObject({ status: 'active', heldBack: null });
    });

    it('the product list marks a held-back product with the reason', async () => {
      const list = await t.app.inject({ method: 'GET', url: '/v1/merchant/products?limit=50', headers: auth() });
      expect(list.statusCode).toBe(200);
      const items = list.json<{ items: Array<{ externalId: string; status: string; heldBack?: unknown }> }>().items;
      expect(items.find((i) => i.externalId === 'hb-1')).toMatchObject({ status: 'incomplete', heldBack: HELD });
      expect(items.find((i) => i.externalId === 'hb-full')).not.toHaveProperty('heldBack');
    });

    it('completing the product releases it', async () => {
      const res = await put('hb-1', { ...base('hb-1'), fabric: { primary: 'linen', stretchPct: 2 } });
      expect(res.json()).toMatchObject({ status: 'active', changed: true, heldBack: null });
      expect(await stored('hb-1')).toMatchObject({ status: 'active', heldBack: null });
      expect((await tryStatus('hb-1')).try).toBe(200);
    });

    it('the Shopify sync path stores a held-back product instead of throwing', async () => {
      const r = await upsertProduct(t.handle.db, s.shop.id, 'hb-sync', { ...base('hb-sync'), fabric: NAME_ONLY }, { handle: 'hb-sync', audienceSource: null });
      expect(r).toMatchObject({ status: 'incomplete', changed: true, heldBack: HELD });
    });

    it("another shop's products are not held back", async () => {
      const res = await put('o-1', { ...base('o-1'), fabric: NAME_ONLY }, other.apiKey);
      expect(res.json()).toMatchObject({ status: 'active', heldBack: null });
    });

    it('switching back to let-through releases what was held, without a re-sync', async () => {
      expect(await stored('hb-sync')).toMatchObject({ status: 'incomplete', heldBack: HELD });
      expect((await setPolicy('let-through')).statusCode).toBe(200);
      expect(await stored('hb-sync')).toMatchObject({ status: 'active', heldBack: null });
      expect(await stored('lt-1')).toMatchObject({ status: 'active', heldBack: null });
      expect((await tryStatus('lt-1')).try).toBe(200);
    });

    it('the same body under a changed setting is not a silent no-op', async () => {
      const body = { ...base('flip-1'), fabric: NAME_ONLY };
      expect((await put('flip-1', body)).json()).toMatchObject({ status: 'active', changed: true });
      await t.handle.db.update(shops).set({ incompleteProductData: 'hold-back' }).where(eq(shops.id, s.shop.id));
      expect((await put('flip-1', body)).json()).toMatchObject({ status: 'incomplete', changed: true, heldBack: HELD });
      expect((await put('flip-1', body)).json()).toMatchObject({ status: 'incomplete', changed: false, heldBack: HELD });
      await t.handle.db.update(shops).set({ incompleteProductData: 'let-through' }).where(eq(shops.id, s.shop.id));
    });
  });

  it('the database refuses any other value for the setting', async () => {
    await expect(t.handle.db.update(shops).set({ incompleteProductData: 'refuse' as never }).where(eq(shops.id, s.shop.id))).rejects.toThrow();
  });
});
