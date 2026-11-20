/**
 * The Settings section of the Shopify embedded admin: `GET/PUT /shopify/settings` with a Shopify
 * session token. Same stored values, DTOs and service as `/v1/merchant/settings`, so a change made
 * in the Shopify admin is what the web console reads, and the other way round.
 */
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MerchantProductsResponse } from '@curtain/schema';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { findShopById, updateSettings } from '../services/shops.js';
import { makeApp, seedShop, type TestApp } from '../test/helpers.js';

const API_KEY = 'shpa_testkey';
const API_SECRET = 'shpss' + '_test_secret_0123456789';
const SHOP = 'settings-shop.myshopify.com';

async function sessionToken(shop = SHOP, secret = API_SECRET) {
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, sub: '42', sid: 'sid-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(API_KEY)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('1m')
    .setJti(`jti-${Math.random()}`)
    .sign(new TextEncoder().encode(secret));
}

const WRAP = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;

describe('Shopify admin settings routes', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  let woo: Awaited<ReturnType<typeof seedShop>>;

  const session = async () => ({ authorization: `Bearer ${await sessionToken()}` });
  const key = () => ({ authorization: `Bearer ${s.apiKey}` });
  const get = async (headers: Record<string, string>, url = '/shopify/settings') => t.app.inject({ method: 'GET', url, headers });
  const put = async (payload: object, url = '/shopify/settings') => t.app.inject({ method: 'PUT', url, headers: await session(), payload });

  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
    s = await seedShop(t, { platform: 'shopify', domain: SHOP, name: 'Settings Shop', products: [] });
    woo = await seedShop(t, { domain: 'woo-settings.example', products: [] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('reads the defaults with a session token: show size advice anyway, wordmark on', async () => {
    const res = await get(await session());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ incompleteProductData: 'let-through', showFitByCurtain: true, shopName: 'Settings Shop', platform: 'shopify' });
  });

  it('answers exactly what /v1/merchant/settings answers for the same shop', async () => {
    const viaShopify = (await get(await session())).json();
    expect((await get(await session(), '/v1/merchant/settings')).json()).toEqual(viaShopify);
    expect((await get(key(), '/v1/merchant/settings')).json()).toEqual(viaShopify);
  });

  it('a switch changed in the Shopify admin is what the web console reads, and the other way round', async () => {
    const off = await put({ showFitByCurtain: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ showFitByCurtain: false, incompleteProductData: 'let-through' });
    expect((await get(key(), '/v1/merchant/settings')).json()).toMatchObject({ showFitByCurtain: false });
    expect((await findShopById(t.handle.db, s.shop.id))!.settings.showFitByCurtain).toBe(false);

    const on = await t.app.inject({ method: 'PUT', url: '/v1/merchant/settings', headers: key(), payload: { showFitByCurtain: true } });
    expect(on.statusCode, on.body).toBe(200);
    expect((await get(await session())).json()).toMatchObject({ showFitByCurtain: true });
  });

  it('"hold back" holds the shop’s incomplete products back, and "show anyway" releases them', async () => {
    const product = { id: 'h-1', name: 'Linen Wrap Dress', brand: 'Aalter Studio', category: 'dress', sizeChartType: 'body', sizeChart: WRAP.sizeChart, fabric: { primary: 'linen' } };
    expect((await t.app.inject({ method: 'PUT', url: '/v1/merchant/products/h-1', headers: await session(), payload: product })).statusCode).toBe(200);
    const row = async () => (await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: await session() })).json<MerchantProductsResponse>().items.find((p) => p.externalId === 'h-1')!;
    expect((await row()).status).toBe('active');

    expect((await put({ incompleteProductData: 'hold-back' })).json()).toMatchObject({ incompleteProductData: 'hold-back' });
    expect((await findShopById(t.handle.db, s.shop.id))!.incompleteProductData).toBe('hold-back');
    expect(await row()).toMatchObject({ status: 'incomplete', heldBack: { reason: 'incomplete_product_data', fields: ['fabric.stretchPct'] } });
    expect((await get(key(), '/v1/merchant/settings')).json()).toMatchObject({ incompleteProductData: 'hold-back' });

    expect((await put({ incompleteProductData: 'let-through' })).statusCode).toBe(200);
    const released = await row();
    expect(released.status).toBe('active');
    expect(released.heldBack).toBeUndefined();
  });

  it('keeps the billing and operator keys of the stored settings', async () => {
    await updateSettings(t.handle.db, s.shop.id, { includedSessions: 1234 });
    expect((await put({ showFitByCurtain: false })).statusCode).toBe(200);
    expect((await findShopById(t.handle.db, s.shop.id))!.settings).toMatchObject({ includedSessions: 1234, showFitByCurtain: false });
    expect(JSON.stringify((await get(await session())).json())).not.toContain('includedSessions');
    await put({ showFitByCurtain: true });
  });

  it('refuses an unknown key and a value outside the two choices', async () => {
    expect((await put({ includedSessions: 99 })).statusCode).toBe(400);
    expect((await put({ shopName: 'Other' })).statusCode).toBe(400);
    expect((await put({ incompleteProductData: 'refuse' })).statusCode).toBe(400);
    expect((await put({ showFitByCurtain: 'no' })).statusCode).toBe(400);
  });

  it('needs a valid session token of an installed shop', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/shopify/settings' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'PUT', url: '/shopify/settings', payload: { showFitByCurtain: false } })).statusCode).toBe(401);
    const forged = await get({ authorization: `Bearer ${await sessionToken(SHOP, 'not-the-app-secret-0123456789')}` });
    expect(forged.statusCode).toBe(401);
    const stranger = await get({ authorization: `Bearer ${await sessionToken('never-installed.myshopify.com')}` });
    expect(stranger.statusCode).toBe(401);
    expect(stranger.json().error.code).toBe('shop_not_installed');
    expect((await findShopById(t.handle.db, s.shop.id))!.settings.showFitByCurtain).not.toBe(false);
  });

  it('is for Shopify shops only: a WooCommerce shop is sent to its own route', async () => {
    const res = await get({ authorization: `Bearer ${woo.apiKey}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('not_shopify');
    const write = await t.app.inject({ method: 'PUT', url: '/shopify/settings', headers: { authorization: `Bearer ${woo.apiKey}` }, payload: { showFitByCurtain: false } });
    expect(write.statusCode).toBe(400);
    expect((await findShopById(t.handle.db, woo.shop.id))!.settings.showFitByCurtain).not.toBe(false);
  });
});
