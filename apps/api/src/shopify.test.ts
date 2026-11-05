import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { products, shopifySessions, shops, webhookLog } from './db/schema.js';
import { hmacBase64 } from './lib/crypto.js';
import { json, makeApp, seedShop, type TestApp } from './test/helpers.js';

const API_KEY = 'shpa_testkey';
const API_SECRET = ('shpss' + '_test_secret_0123456789');
const SHOP = 'aalter.myshopify.com';

async function sessionToken(shop = SHOP, over: Record<string, unknown> = {}) {
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, sub: '42', sid: 'sid-1', ...over })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(API_KEY)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('1m')
    .setJti('jti-1')
    .sign(new TextEncoder().encode(API_SECRET));
}

const productNode = (id = 'gid://shopify/Product/9001') => ({
  id,
  handle: 'linen-wrap',
  title: 'Linen wrap dress',
  vendor: 'Aalter Studio',
  productType: 'Dress',
  status: 'ACTIVE',
  featuredImage: { url: 'https://cdn.shopify.com/wrap.jpg' },
  images: { nodes: [{ url: 'https://cdn.shopify.com/wrap.jpg' }] },
  priceRangeV2: { minVariantPrice: { amount: '189.00', currencyCode: 'EUR' } },
  variants: { nodes: [{ price: '189.00', selectedOptions: [{ name: 'Size', value: 'M' }] }] },
  metafields: {
    nodes: [
      { namespace: '$app:curtain', key: 'category', type: 'single_line_text_field', value: 'dress' },
      { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
      { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify([{ size: 'S', bust: 86, waist: 68, hip: 94, shoulder: 37 }, { size: 'M', bust: 90, waist: 72, hip: 98, shoulder: 38 }]) },
      { namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify({ primary: 'linen', stretchPct: 0, drape: 0.5 }) },
      { namespace: '$app:curtain', key: 'flat_lay_photo', type: 'url', value: 'https://cdn.shopify.com/wrap-flat.png' },
      { namespace: '$app:curtain', key: 'pattern_block', type: 'single_line_text_field', value: 'wrap' },
      { namespace: '$app:curtain', key: 'primary_color_hex', type: 'color', value: '#C97A4F' },
    ],
  },
});

describe('Shopify: webhooks (HMAC + GDPR), token exchange, sync job', () => {
  let t: TestApp;
  let shop: Awaited<ReturnType<typeof seedShop>>['shop'];
  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
    shop = (await seedShop(t, { platform: 'shopify', domain: SHOP, products: [] })).shop;
  });
  afterAll(async () => {
    await t.close();
  });

  const webhook = (topic: string, payload: object, over: Record<string, string> = {}) => {
    const body = JSON.stringify(payload);
    return t.app.inject({
      method: 'POST',
      url: '/shopify/webhooks',
      headers: {
        'content-type': 'application/json',
        'x-shopify-topic': topic,
        'x-shopify-shop-domain': SHOP,
        'x-shopify-webhook-id': `wh-${Math.random().toString(36).slice(2)}`,
        'x-shopify-hmac-sha256': hmacBase64(API_SECRET, body),
        ...over,
      },
      payload: body,
    });
  };

  it('rejects a bad HMAC and logs nothing', async () => {
    const res = await webhook('products/update', { id: 9001 }, { 'x-shopify-hmac-sha256': hmacBase64('wrong', '{}') });
    expect(res.statusCode).toBe(401);
    expect(await t.handle.db.select().from(webhookLog)).toHaveLength(0);
  });

  it('products/update logs the payload, queues the sync job once per product; duplicates are acknowledged', async () => {
    const res = await webhook('products/update', { id: 9001, admin_graphql_api_id: 'gid://shopify/Product/9001', title: 'Linen wrap dress' }, { 'x-shopify-webhook-id': 'wh-fixed-1' });
    expect(res.statusCode).toBe(200);
    const dup = await webhook('products/update', { id: 9001 }, { 'x-shopify-webhook-id': 'wh-fixed-1' });
    expect(dup.json()).toEqual({ ok: true, duplicate: true });
    await webhook('products/update', { id: 9001, admin_graphql_api_id: 'gid://shopify/Product/9001' });
    expect(t.queue.pending('sync-shopify-product')).toHaveLength(1);
    const log = await t.handle.db.select().from(webhookLog).where(eq(webhookLog.topic, 'products/update'));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ status: 'processed', externalId: '9001', shopId: shop.id });
    expect((log[0]!.payload as { title: string }).title).toBe('Linen wrap dress');
  });

  it('token exchange stores the encrypted offline token, issues keys, ensures metafields and queues the backfill', async () => {
    t.fetchMock.reset();
    t.fetchMock.on(`https://${SHOP}/admin/oauth/access_token`, () => json({ access_token: ('shpat' + '_offline_123'), scope: 'read_products,write_products' }));
    t.fetchMock.on(`https://${SHOP}/admin/api/`, async (_url, init) => {
      const q = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (q.query.includes('metafieldDefinitionCreate')) return json({ data: { metafieldDefinitionCreate: { createdDefinition: { id: 'x', key: (q.variables.definition as { key: string }).key }, userErrors: [] } } });
      if (q.query.includes('CurtainProducts')) return json({ data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [productNode('gid://shopify/Product/7001')] } } });
      if (q.query.includes('CurtainProduct(')) return json({ data: { product: productNode() } });
      if (q.query.includes('currentAppInstallation')) return json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/77' } } });
      if (q.query.includes('metafieldsSet')) {
        const mf = q.variables.metafields as Array<{ key: string; namespace: string }>;
        return json({ data: { metafieldsSet: { metafields: mf.map((m, i) => ({ id: `gid://shopify/Metafield/${i}`, key: m.key, namespace: m.namespace, ownerType: 'APP_INSTALLATION' })), userErrors: [] } } });
      }
      return json({ errors: [{ message: 'unexpected query' }] }, 400);
    });

    const wrongShop = await t.app.inject({ method: 'POST', url: '/shopify/token-exchange', payload: { shop: 'other.myshopify.com', sessionToken: await sessionToken() } });
    expect(wrongShop.statusCode).toBe(403);
    const badSig = await t.app.inject({ method: 'POST', url: '/shopify/token-exchange', payload: { shop: SHOP, sessionToken: (await sessionToken()).slice(0, -3) + 'abc' } });
    expect(badSig.statusCode).toBe(401);

    const res = await t.app.inject({ method: 'POST', url: '/shopify/token-exchange', payload: { shop: SHOP, sessionToken: await sessionToken() } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ shopId: shop.id, shopDomain: SHOP, scope: 'read_products,write_products', backfillQueued: true });
    expect(res.json().publicKeyPrefix).toMatch(/^pk_test_/);
    const sess = await t.handle.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.shopId, shop.id) });
    expect(sess?.accessTokenEnc).not.toContain(('shpat' + '_offline_123'));
    expect(await t.app.ctx.shopify.accessTokenFor(SHOP)).toBe(('shpat' + '_offline_123'));
    const defs = t.fetchMock.calls.filter((c) => String(c.init?.body).includes('metafieldDefinitionCreate'));
    expect(defs.length).toBeGreaterThanOrEqual(17);
    // app-data metafields for the theme block: the public key + API/app URLs on the AppInstallation, never the secret
    const appData = t.fetchMock.calls.find((c) => String(c.init?.body).includes('metafieldsSet'));
    expect(appData).toBeDefined();
    const sent = (JSON.parse(String(appData!.init!.body)) as { variables: { metafields: Array<{ ownerId: string; namespace: string; key: string; value: string }> } }).variables.metafields;
    expect(sent.map((m) => [m.ownerId, m.namespace, m.key, m.value])).toEqual([
      ['gid://shopify/AppInstallation/77', 'curtain', 'public_key', res.json().publicKeyPrefix],
      ['gid://shopify/AppInstallation/77', 'curtain', 'api_url', t.env.PUBLIC_API_URL],
      ['gid://shopify/AppInstallation/77', 'curtain', 'app_url', t.env.PUBLIC_APP_URL],
    ]);
    expect(String(appData!.init!.body)).not.toMatch(/sk_(live|test)_/);

    // session token now authenticates merchant routes for this shop
    const me = await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: { authorization: `Bearer ${await sessionToken()}` } });
    expect(me.statusCode).toBe(200);

    // backfill + sync jobs run against the mocked Admin API → normalised products
    expect(await t.queue.drain()).toBe(2);
    expect(t.queue.failed).toHaveLength(0);
    const rows = await t.handle.db.select().from(products).where(eq(products.shopId, shop.id));
    expect(rows.map((r) => r.externalId).sort()).toEqual(['7001', '9001']);
    const synced = rows.find((r) => r.externalId === '9001')!;
    expect(synced.status).toBe('active');
    expect(synced.category).toBe('dress');
    expect(synced.priceEur).toBe(189);
    expect(synced.payload).toMatchObject({ sizeChartType: 'body', patternBlock: 'wrap', fabric: { primary: 'linen' }, flatLayPhoto: 'https://cdn.shopify.com/wrap-flat.png' });
    expect((synced.payload as Record<string, unknown>).handle).toBeUndefined();
    expect(synced.handle).toBe('linen-wrap');
  });

  it('serves the embedded admin page framable only by this shop and the Shopify admin', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/shopify/admin?shop=${SHOP}&host=YWRtaW4&embedded=1` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['content-security-policy']).toBe(`frame-ancestors https://${SHOP} https://admin.shopify.com;`);
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.body).toContain(`<meta name="shopify-api-key" content="${API_KEY}" />`);
    expect(res.body).toContain('https://cdn.shopify.com/shopifycloud/app-bridge.js');
    expect(res.body).not.toContain('__CURTAIN_');
    expect(res.body).not.toContain(API_SECRET);

    // a hostile ?shop= never reaches the CSP
    const evil = await t.app.inject({ method: 'GET', url: `/shopify/admin?shop=${encodeURIComponent('evil.example; script-src *')}` });
    expect(evil.headers['content-security-policy']).toBe('frame-ancestors https://admin.shopify.com;');
  });

  it('auth callback redirects to the embedded app home and rejects non-Shopify domains', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/shopify/auth/callback?shop=${SHOP}&code=x` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://admin.shopify.com/store/aalter/apps/curtain');
    const bad = await t.app.inject({ method: 'GET', url: '/shopify/auth/callback?shop=evil.example.com' });
    expect(bad.statusCode).toBe(400);
  });

  it('products/delete archives; app_subscriptions/update sets plan + paused; app/uninstalled pauses and drops the token', async () => {
    await webhook('products/delete', { id: 7001 });
    const archived = await t.handle.db.query.products.findFirst({ where: eq(products.externalId, '7001') });
    expect(archived?.status).toBe('archived');

    await webhook('app_subscriptions/update', { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', name: 'Curtain Starter', status: 'ACTIVE' } });
    let s = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(s).toMatchObject({ plan: 'starter', paused: false, billingRef: 'gid://shopify/AppSubscription/1' });
    await webhook('app_subscriptions/update', { app_subscription: { admin_graphql_api_id: 'gid://shopify/AppSubscription/1', name: 'Curtain Starter', status: 'FROZEN' } });
    s = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(s).toMatchObject({ plan: 'free', paused: true });

    await webhook('app/uninstalled', { id: 1, domain: SHOP });
    s = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(s?.uninstalledAt).not.toBeNull();
    expect(s?.purgeAfter).not.toBeNull();
    expect(await t.handle.db.select().from(shopifySessions).where(eq(shopifySessions.shopId, shop.id))).toHaveLength(0);
    const denied = await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: { authorization: `Bearer ${await sessionToken()}` } });
    expect(denied.statusCode).toBe(403);
  });

  it('GDPR topics: customers/* are acknowledged no-ops, shop/redact purges 48 h later via a job', async () => {
    const dr = await webhook('customers/data_request', { shop_id: 1, shop_domain: SHOP, customer: { id: 5, email: 'x@y.z' }, orders_requested: [] });
    expect(dr.statusCode).toBe(200);
    const rd = await webhook('customers/redact', { shop_id: 1, shop_domain: SHOP, customer: { id: 5 } });
    expect(rd.statusCode).toBe(200);
    const logs = await t.handle.db.select().from(webhookLog).where(eq(webhookLog.shopId, shop.id));
    expect(logs.filter((l) => l.topic.startsWith('customers/')).every((l) => l.status === 'processed')).toBe(true);
    // the shop is untouched by customer topics
    expect(await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) })).toBeTruthy();

    const sr = await webhook('shop/redact', { shop_id: 1, shop_domain: SHOP });
    expect(sr.statusCode).toBe(200);
    const purge = t.queue.pending('purge-shop');
    expect(purge).toHaveLength(1);
    expect(purge[0]!.runAt - Date.now()).toBeGreaterThan(47 * 3600 * 1000);
    expect(await t.queue.drain()).toBe(0); // not due yet
    expect(await t.queue.drain(true)).toBe(1);
    expect(await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) })).toBeUndefined();
    expect(await t.handle.db.select().from(products).where(eq(products.shopId, shop.id))).toHaveLength(0);
    const unknownShop = await webhook('products/update', { id: 1 });
    expect(unknownShop.statusCode).toBe(200);
  });
});

describe('Shopify not configured', () => {
  it('token exchange answers 503 and session tokens are not accepted', async () => {
    const t = await makeApp();
    try {
      const res = await t.app.inject({ method: 'POST', url: '/shopify/token-exchange', payload: { shop: SHOP, sessionToken: await sessionToken() } });
      expect(res.statusCode).toBe(503);
      const wh = await t.app.inject({ method: 'POST', url: '/shopify/webhooks', headers: { 'x-shopify-hmac-sha256': 'x' }, payload: {} });
      expect(wh.statusCode).toBe(401);
    } finally {
      await t.close();
    }
  });
});
