import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { signMerchantRequest } from './lib/crypto.js';
import { findShopById } from './services/shops.js';
import { json, makeApp, seedShop, type TestApp } from './test/helpers.js';

function hmacHeaders(prefix: string, secret: string, method: string, path: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = signMerchantRequest(secret, method, path, String(ts), body);
  return { authorization: `PK-HMAC key=${prefix}, ts=${ts}, sig=${sig}`, 'content-type': 'application/json' };
}

describe('merchant auth + products', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t, { products: [] });
  });
  afterAll(async () => {
    await t.close();
  });

  const signed = (method: 'PUT' | 'POST' | 'GET' | 'DELETE', path: string, payload?: unknown, ts?: number) => {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    return t.app.inject({ method, url: path, headers: hmacHeaders(s.publicKeyPrefix, s.apiKey, method, path, body, ts), ...(payload === undefined ? {} : { payload: body }) });
  };

  it('upserts a draft (incomplete, with missing field paths) and a full payload (active); equal hash is a no-op', async () => {
    const draft = { id: 'new-1', name: 'Linen wrap', brand: 'Aalter Studio' };
    const r1 = await signed('PUT', '/v1/merchant/products/new-1', draft);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ externalId: 'new-1', status: 'incomplete', changed: true });
    expect(r1.json().missingFields).toEqual(expect.arrayContaining(['category', 'sizeChartType', 'sizeChart', 'fabric.primary', 'flatLayPhoto']));
    expect(r1.json().contentHash).toHaveLength(64);

    const r2 = await signed('PUT', '/v1/merchant/products/new-1', draft);
    expect(r2.json().changed).toBe(false);
    expect(r2.json().contentHash).toBe(r1.json().contentHash);

    const full = { ...MOCK_GARMENTS_BY_ID['aalter-studio-1']!, id: 'new-1' };
    const r3 = await signed('PUT', '/v1/merchant/products/new-1', full);
    expect(r3.statusCode).toBe(200);
    expect(r3.json()).toMatchObject({ status: 'active', changed: true, missingFields: [] });
    expect(r3.json().score).toBeGreaterThan(0.9);

    const mismatch = await signed('PUT', '/v1/merchant/products/other', full);
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('id_mismatch');
  });

  it('rejects bad signatures, stale timestamps, wrong keys', async () => {
    const path = '/v1/merchant/products';
    const good = await signed('GET', path);
    expect(good.statusCode).toBe(200);
    const stale = await signed('GET', path, undefined, Math.floor(Date.now() / 1000) - 600);
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error.code).toBe('stale_signature');
    const bad = await t.app.inject({ method: 'GET', url: path, headers: { ...hmacHeaders(s.publicKeyPrefix, ('sk_' + 'test_wrong'), 'GET', path, '') } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('bad_signature');
    const unknown = await t.app.inject({ method: 'GET', url: path, headers: { ...hmacHeaders('pk_test_unknown1', s.apiKey, 'GET', path, '') } });
    expect(unknown.json().error.code).toBe('unknown_key');
    // signature covers the body: tampering fails
    const body = JSON.stringify({ id: 'x', name: 'X', brand: 'B' });
    const h = hmacHeaders(s.publicKeyPrefix, s.apiKey, 'PUT', '/v1/merchant/products/x', body);
    const tampered = await t.app.inject({ method: 'PUT', url: '/v1/merchant/products/x', headers: h, payload: JSON.stringify({ id: 'x', name: 'Y', brand: 'B' }) });
    expect(tampered.statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
  });

  it('accepts Bearer sk_ keys and rejects wrong ones', async () => {
    const ok = await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: { authorization: `Bearer ${s.apiKey}` } });
    expect(ok.statusCode).toBe(200);
    const bad = await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: { authorization: 'Bearer sk_test_' + 'a'.repeat(48) } });
    expect(bad.statusCode).toBe(401);
  });

  it('validate is a dry run with completeness and zod issues', async () => {
    const ok = await signed('POST', '/v1/merchant/products/validate', { payload: MOCK_GARMENTS_BY_ID['monochrome-02'] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ valid: true, issues: [], completeness: { status: 'active' } });
    const bad = await signed('POST', '/v1/merchant/products/validate', { payload: { id: 'x', primaryColorHex: 'red' } });
    expect(bad.json().valid).toBe(false);
    expect(bad.json().issues.some((i: { path: string }) => i.path === 'primaryColorHex')).toBe(true);
    expect(bad.json().completeness.status).toBe('incomplete');
    const list = await signed('GET', '/v1/merchant/products?status=active');
    expect(list.json().items.map((i: { externalId: string }) => i.externalId)).toEqual(['new-1']);
  });

  it('lists with counts, archives on delete, reports usage and empty ledger', async () => {
    await signed('PUT', '/v1/merchant/products/draft-2', { id: 'draft-2', name: 'Draft', brand: 'B' });
    const list = await signed('GET', '/v1/merchant/products');
    expect(list.json().counts).toEqual({ active: 1, incomplete: 1, archived: 0 });
    const del = await signed('DELETE', '/v1/merchant/products/draft-2');
    expect(del.json()).toEqual({ externalId: 'draft-2', status: 'archived' });
    expect((await signed('DELETE', '/v1/merchant/products/none')).statusCode).toBe(404);
    expect((await signed('GET', '/v1/merchant/products')).json().counts.archived).toBe(1);

    const usage = await signed('GET', '/v1/merchant/usage?from=2026-11-01&to=2026-11-04');
    expect(usage.statusCode).toBe(200);
    expect(usage.json().plan).toMatchObject({ name: 'starter', includedSessions: 500, overageEurPerSession: 0.05, paused: false });
    expect((await signed('GET', '/v1/merchant/usage?from=2026-11-05&to=2026-11-04')).statusCode).toBe(400);
    const ledger = await signed('GET', '/v1/merchant/ledger');
    expect(ledger.json()).toEqual({ entries: [], nextCursor: null });
  });

  it('rotates keys: new key works, old key keeps working for 24 h, prefix is stable', async () => {
    const rot = await signed('POST', '/v1/merchant/keys/rotate');
    expect(rot.statusCode).toBe(200);
    const { apiKey, publicKeyPrefix } = rot.json<{ apiKey: string; publicKeyPrefix: string }>();
    expect(publicKeyPrefix).toBe(s.publicKeyPrefix);
    expect(apiKey).not.toBe(s.apiKey);
    const withNew = await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: hmacHeaders(publicKeyPrefix, apiKey, 'GET', '/v1/merchant/products', '') });
    expect(withNew.statusCode).toBe(200);
    const withOld = await signed('GET', '/v1/merchant/products');
    expect(withOld.statusCode).toBe(200);
    s.apiKey = apiKey;
  });

  it('PUT /v1/merchant/shops/self updates branding and persists the ads toggle', async () => {
    const res = await signed('PUT', '/v1/merchant/shops/self', { name: 'Aalter Studio BV', brandColor: '#1A1612', pluginVersion: '0.1.0', siteUrl: 'https://aalter.example', adsEnabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Aalter Studio BV', platform: 'woocommerce', publicKeyPrefix: s.publicKeyPrefix });
    const stored = await findShopById(t.handle.db, s.shop.id);
    expect(stored?.settings).toMatchObject({ brandColor: '#1A1612', pluginVersion: '0.1.0', siteUrl: 'https://aalter.example', adsEnabled: true });

    // A later hello without the field leaves the stored value untouched; an explicit false turns it off.
    expect((await signed('PUT', '/v1/merchant/shops/self', { pluginVersion: '0.1.1' })).statusCode).toBe(200);
    expect((await findShopById(t.handle.db, s.shop.id))?.settings.adsEnabled).toBe(true);
    expect((await signed('PUT', '/v1/merchant/shops/self', { adsEnabled: false })).statusCode).toBe(200);
    expect((await findShopById(t.handle.db, s.shop.id))?.settings.adsEnabled).toBe(false);
  });

  it('WooCommerce Connect without Stripe → manual key path', async () => {
    const connect = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: 'https://new-woo.example/shop', name: 'New Woo' } });
    expect(connect.statusCode).toBe(200);
    expect(connect.json().mode).toBe('manual-key');
    // Domain proof (carry-over #12): no keys until the site publishes the nonce.
    const unproven = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken: connect.json().connectToken } });
    expect(unproven.statusCode).toBe(403);
    expect(unproven.json().error.code).toBe('domain_unverified');
    t.fetchMock.on('https://new-woo.example/wp-json/curtain/v1/verify', () => json({ nonce: connect.json().verification.nonce }));
    const complete = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken: connect.json().connectToken } });
    expect(complete.statusCode).toBe(200);
    const { apiKey, publicKeyPrefix, plan } = complete.json<{ apiKey: string; publicKeyPrefix: string; plan: string }>();
    expect(apiKey).toMatch(/^sk_test_/);
    expect(publicKeyPrefix).toMatch(/^pk_test_/);
    expect(plan).toBe('free');
    const hello = await t.app.inject({ method: 'PUT', url: '/v1/merchant/shops/self', headers: { authorization: `Bearer ${apiKey}` }, payload: { pluginVersion: '0.1.0' } });
    expect(hello.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken: connect.json().connectToken } })).statusCode).toBe(404);
    const again = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: 'https://new-woo.example/shop', name: 'New Woo' } });
    expect(again.statusCode).toBe(409);
  });
});
