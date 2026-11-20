/**
 * Slice 1, the console and the popup (D25 points 1, 5 and 7): what the merchant's product list is
 * told, the settings the console can change, what the popup is told, and the SDK's "is this shop
 * paused" question.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { GarmentPayloadSchema, MOCK_GARMENTS_BY_ID, type MerchantProductsResponse } from '@curtain/schema';
import { shops } from './db/schema.js';
import { asGarment, findProduct } from './services/products.js';
import { findShopById, patchSettings } from './services/shops.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const WRAP = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
const base = (id: string) => ({ id, name: 'Linen Wrap Dress', brand: 'Aalter Studio', category: 'dress', sizeChartType: 'body', sizeChart: WRAP.sizeChart });

describe('slice 1: console settings, product-list notices, popup flags, paused shop', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t, { products: [] });
  });
  afterAll(async () => {
    await t.close();
  });
  const auth = () => ({ authorization: `Bearer ${s.apiKey}` });
  const put = (id: string, payload: unknown) => t.app.inject({ method: 'PUT', url: `/v1/merchant/products/${id}`, headers: auth(), payload: payload as object });
  const settings = (payload: object) => t.app.inject({ method: 'PUT', url: '/v1/merchant/settings', headers: auth(), payload });
  const list = async () => (await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: auth() })).json<MerchantProductsResponse>().items;
  const resolve = async (externalId: string) => {
    const device = await createDevice(t);
    const session = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', headers: { origin: 'https://merchant.example' }, payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId: externalId, pageUrl: 'https://merchant.example/p' } });
    const token = session.json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    return t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: device.auth });
  };

  describe('the merchant product list', () => {
    it('says which fabric value was left out, after the save answer is gone', async () => {
      expect((await put('n-150', { ...base('n-150'), fabric: { primary: 'linen', stretchPct: 150, drape: 0.4 } })).statusCode).toBe(200);
      const row = (await list()).find((p) => p.externalId === 'n-150')!;
      expect(row.status).toBe('active');
      expect(row.notices?.leftOut).toEqual([{ field: 'fabric.stretchPct', reason: expect.any(String) }]);
      expect(row.notices?.defaulted).toEqual(['fabric.stretchPct']);
      // The refused value itself is never stored or echoed.
      expect(JSON.stringify(row.notices)).not.toContain('150');
    });

    it('lists only fabric assumptions, never the render-only defaults', async () => {
      await put('n-name', { ...base('n-name'), fabric: { primary: 'linen' } });
      const row = (await list()).find((p) => p.externalId === 'n-name')!;
      expect(row.notices).toEqual({ defaulted: ['fabric.stretchPct', 'fabric.drape'], leftOut: [] });
    });

    it('a complete product has empty notices; fixing the value clears the left-out note', async () => {
      await put('n-150', { ...base('n-150'), fabric: { primary: 'linen', stretchPct: 5, drape: 0.4 } });
      const row = (await list()).find((p) => p.externalId === 'n-150')!;
      expect(row.notices).toEqual({ defaulted: [], leftOut: [] });
    });

    it('a held-back product carries the reason, and a left-out value keeps it held back when the setting is applied again', async () => {
      await put('n-held', { ...base('n-held'), fabric: { primary: 'linen', stretchPct: 5, drape: 7 } });
      expect((await settings({ incompleteProductData: 'hold-back' })).statusCode).toBe(200);
      const row = (await list()).find((p) => p.externalId === 'n-held')!;
      expect(row.status).toBe('incomplete');
      expect(row.heldBack).toEqual({ reason: 'incomplete_product_data', fields: ['fabric.drape'] });
      expect(row.notices?.leftOut.map((l) => l.field)).toEqual(['fabric.drape']);
      await settings({ incompleteProductData: 'let-through' });
      expect((await list()).find((p) => p.externalId === 'n-held')!.heldBack).toBeUndefined();
    });
  });

  describe('settings the console can change', () => {
    it('shows the wordmark by default and returns the shop name, platform, colour and logo', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/v1/merchant/settings', headers: auth() });
      expect(res.json()).toEqual({ incompleteProductData: 'let-through', showFitByCurtain: true, shopName: s.shop.name, platform: s.shop.platform, brandColor: s.shop.settings.brandColor ?? null, logoUrl: null });
    });

    it('stores colour, logo and the wordmark switch, keeps the other stored settings, and null removes', async () => {
      await t.handle.db.update(shops).set({ settings: { ...(await findShopById(t.handle.db, s.shop.id))!.settings, includedSessions: 1234 } }).where(eq(shops.id, s.shop.id));
      const res = await settings({ brandColor: '#2F4F3A', logoUrl: 'https://merchant.example/logo.png', showFitByCurtain: false });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ brandColor: '#2F4F3A', logoUrl: 'https://merchant.example/logo.png', showFitByCurtain: false, incompleteProductData: 'let-through' });
      let shop = (await findShopById(t.handle.db, s.shop.id))!;
      expect(shop.settings).toMatchObject({ brandColor: '#2F4F3A', logoUrl: 'https://merchant.example/logo.png', showFitByCurtain: false, includedSessions: 1234 });
      const cleared = await settings({ brandColor: null, logoUrl: null });
      expect(cleared.json()).toMatchObject({ brandColor: null, logoUrl: null, showFitByCurtain: false });
      shop = (await findShopById(t.handle.db, s.shop.id))!;
      expect('brandColor' in shop.settings).toBe(false);
      expect('logoUrl' in shop.settings).toBe(false);
      expect(shop.settings.includedSessions).toBe(1234);
      await settings({ showFitByCurtain: true });
    });

    it('writes on the stored row as it is now, not on a copy read earlier', async () => {
      // What the route holds from auth time is `before`; another request then changes a billing key.
      const before = (await findShopById(t.handle.db, s.shop.id))!;
      await t.handle.db.update(shops).set({ settings: { ...before.settings, includedSessions: 4321, logoUrl: 'https://merchant.example/old.png' } }).where(eq(shops.id, s.shop.id));
      const row = await patchSettings(t.handle.db, s.shop.id, { set: { brandColor: '#112233', showFitByCurtain: undefined }, remove: ['logoUrl'] });
      expect(row!.settings).toMatchObject({ includedSessions: 4321, brandColor: '#112233' });
      expect('logoUrl' in row!.settings).toBe(false);
      expect('showFitByCurtain' in row!.settings).toBe('showFitByCurtain' in before.settings);
      expect(await patchSettings(t.handle.db, '00000000-0000-4000-8000-000000000000', { set: { brandColor: '#112233' } })).toBeUndefined();
      await t.handle.db.update(shops).set({ settings: before.settings }).where(eq(shops.id, s.shop.id));
    });

    it('refuses a bad colour, a logo that is not https, and the shop name (it comes from the platform)', async () => {
      expect((await settings({ brandColor: 'green' })).statusCode).toBe(400);
      expect((await settings({ logoUrl: 'http://merchant.example/logo.png' })).statusCode).toBe(400);
      expect((await settings({ logoUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
      expect((await settings({ shopName: 'Other' })).statusCode).toBe(400);
    });
  });

  describe('what the popup is told', () => {
    it('stretchAssumed only when the shop gave no stretch', async () => {
      await put('p-name', { ...base('p-name'), fabric: { primary: 'linen' } });
      await put('p-full', { ...base('p-full'), fabric: { primary: 'linen', stretchPct: 0, drape: 0.4 } });
      expect((await resolve('p-name')).json()).toMatchObject({ stretchAssumed: true });
      const full = (await resolve('p-full')).json<Record<string, unknown>>();
      expect('stretchAssumed' in full).toBe(false);
    });

    it('never for an accessory, whose size does not depend on stretch', async () => {
      const res = await put('p-acc', { ...base('p-acc'), category: 'accessory', sizeChartType: 'body', sizeChart: [{ size: 'One size' }] });
      expect(res.json(), res.body).toMatchObject({ status: 'active' });
      // The save answer the WooCommerce product screen stores and words: no "no stretch" notice either.
      expect(res.json().notices.defaulted).not.toContain('fabric.stretchPct');
      const body = (await resolve('p-acc')).json<Record<string, unknown>>();
      expect(body.garment).toBeDefined();
      expect('stretchAssumed' in body).toBe(false);
      expect((await list()).find((p) => p.externalId === 'p-acc')!.notices?.defaulted).not.toContain('fabric.stretchPct');
    });

    it('hideWordmark only when the shop switched "Fit by Curtain" off', async () => {
      expect('hideWordmark' in (await resolve('p-full')).json<{ shop: Record<string, unknown> }>().shop).toBe(false);
      await settings({ showFitByCurtain: false });
      expect((await resolve('p-full')).json<{ shop: Record<string, unknown> }>().shop.hideWordmark).toBe(true);
      await settings({ showFitByCurtain: true });
      expect('hideWordmark' in (await resolve('p-full')).json<{ shop: Record<string, unknown> }>().shop).toBe(false);
    });
  });

  describe('a held-back product is not served to shoppers on any route', () => {
    // A complete payload (every field the app needs) with one fabric value that was left out.
    const complete = (id: string) => ({ ...WRAP, id, fabric: { ...WRAP.fabric, weightGsm: 0 } });

    it('the app product page refuses it, and asGarment (hero render, AI-enhanced estimate) gives none; released, it is served again', async () => {
      const saved = await put('h-complete', complete('h-complete'));
      expect(saved.json(), saved.body).toMatchObject({ status: 'active', notices: { leftOut: [{ field: 'fabric.weightGsm' }] } });
      const device = await createDevice(t);
      const page = () => t.app.inject({ method: 'GET', url: `/v1/products/h-complete?shopId=${s.shop.id}`, headers: device.auth });
      expect((await page()).statusCode).toBe(200);

      await settings({ incompleteProductData: 'hold-back' });
      const row = (await findProduct(t.handle.db, s.shop.id, 'h-complete'))!;
      expect(row.heldBack).toEqual({ reason: 'incomplete_product_data', fields: ['fabric.weightGsm'] });
      // The stored payload itself is complete: only the held-back state keeps it from shoppers.
      expect(GarmentPayloadSchema.safeParse(row.payload).success).toBe(true);
      expect(asGarment(row)).toBeNull();
      const held = await page();
      expect(held.statusCode).toBe(422);
      expect(held.json().error.code).toBe('product_incomplete');
      // The hero render and the AI-enhanced estimate ask the same question (asGarment), tested above.

      await settings({ incompleteProductData: 'let-through' });
      expect((await page()).statusCode).toBe(200);
      expect(asGarment((await findProduct(t.handle.db, s.shop.id, 'h-complete'))!)).not.toBeNull();
    });
  });

  describe('GET /v1/sdk/shop (D25 point 5: a paused shop shows no button)', () => {
    const status = (shop: string) => t.app.inject({ method: 'GET', url: `/v1/sdk/shop?shop=${shop}`, headers: { origin: 'https://merchant.example' } });

    it('is public, readable from any shop page, cached for a minute, and says only paused or not', async () => {
      const res = await status(s.publicKeyPrefix);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ paused: false });
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['cache-control']).toBe('public, max-age=60');
    });

    it('answers paused for a paused shop, 404 for an unknown shop, 400 for something that is not a public key', async () => {
      await t.handle.db.update(shops).set({ paused: true }).where(eq(shops.id, s.shop.id));
      expect((await status(s.publicKeyPrefix)).json()).toEqual({ paused: true });
      await t.handle.db.update(shops).set({ paused: false }).where(eq(shops.id, s.shop.id));
      expect((await status('pk_' + 'test_doesnotexist1')).statusCode).toBe(404);
      expect((await status('nonsense')).statusCode).toBe(400);
    });
  });
});
