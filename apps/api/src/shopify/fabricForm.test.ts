/**
 * Fabric form (CUR-13, WO-017) routes: GET / PUT / DELETE /shopify/products/:id/fabric.
 *
 * Proves the round-trip: the metafield JSON that the admin writes is exactly what the payload
 * builder reads (the form's write body is `FabricSchema`-validated, so anything it accepts is a
 * valid payload fabric).
 */
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json, makeApp, seedShop, type TestApp } from '../test/helpers.js';

const API_KEY = 'shpa_testkey';
const API_SECRET = 'shpss' + '_test_secret_0123456789';
const SHOP = 'bohohippychic.myshopify.com';
const TOKEN = 'shpat' + '_offline_fabric';
const GID = 'gid://shopify/Product/10894387020081';

async function sessionToken(shop = SHOP) {
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, sub: '42', sid: 'sid-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(API_KEY)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('1m')
    .setJti(`jti-${Math.random()}`)
    .sign(new TextEncoder().encode(API_SECRET));
}

interface GqlCall {
  query: string;
  variables: Record<string, unknown>;
}
type SetInput = { ownerId: string; namespace: string; key: string; type: string; value: string };

const mf = (key: string, value: string, type = 'json') => ({ namespace: 'app--1--curtain', key, type, value });

const validFabric = {
  primary: 'cotton',
  stretchPct: 30,
  drape: 0.45,
};

describe('Shopify fabric form', () => {
  let t: TestApp;
  let calls: GqlCall[];
  let metafields: ReturnType<typeof mf>[];
  let apiKey: string;

  const auth = async () => ({ authorization: `Bearer ${await sessionToken()}` });
  const sets = () => calls.filter((c) => c.query.includes('metafieldsSet')).flatMap((c) => c.variables.metafields as SetInput[]);
  const deletes = () => calls.filter((c) => c.query.includes('metafieldsDelete')).flatMap((c) => c.variables.metafields as { key: string }[]);
  const skirtNode = () => ({
    id: GID,
    handle: 'crimson-wildflower-maxi-skirt',
    title: 'Crimson Wildflower Maxi Skirt',
    vendor: 'Boho Hippy Chic',
    productType: 'Skirts',
    status: 'ACTIVE',
    descriptionHtml: '',
    options: [{ name: 'Size', optionValues: ['8', '10', '12', '14', '16'].map((name) => ({ name })) }],
    variants: { nodes: [{ price: '89.95', selectedOptions: [{ name: 'Size', value: '8' }] }] },
    metafields: { nodes: metafields },
  });

  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
    const { shop, apiKey: key } = await seedShop(t, { platform: 'shopify', domain: SHOP, name: 'Boho Hippy Chic', products: [] });
    apiKey = key;
    await t.app.ctx.shopify.saveOfflineSession(shop.id, SHOP, TOKEN, 'read_products,write_products');
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    calls = [];
    metafields = [
      mf('category', 'bottom', 'single_line_text_field'),
      mf('size_chart_type', 'body', 'single_line_text_field'),
    ];
    t.fetchMock.reset();
    t.fetchMock.on(`https://${SHOP}/admin/api/`, async (_url, init) => {
      const q = JSON.parse(String(init?.body)) as GqlCall;
      calls.push(q);
      if (q.query.includes('metafieldsSet')) {
        const list = q.variables.metafields as SetInput[];
        return json({ data: { metafieldsSet: { metafields: list.map((m, i) => ({ id: `gid://shopify/Metafield/${i}`, key: m.key, namespace: m.namespace, ownerType: 'PRODUCT' })), userErrors: [] } } });
      }
      if (q.query.includes('metafieldsDelete')) {
        const list = q.variables.metafields as { key: string; ownerId: string; namespace: string }[];
        const present = new Set(metafields.map((m) => m.key));
        return json({ data: { metafieldsDelete: { deletedMetafields: list.map((m) => (present.has(m.key) ? m : null)), userErrors: [] } } });
      }
      if (q.query.includes('product(')) return json({ data: { product: skirtNode() } });
      return json({ errors: [{ message: 'unexpected query' }] }, 400);
    });
  });

  it('GET returns null when the product has no fabric', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/shopify/products/10894387020081/fabric', headers: await auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ productId: '10894387020081', fabric: null, errors: [], written: [], syncQueued: false });
    expect(sets()).toHaveLength(0);
  });

  it('PUT validates with FabricSchema and writes the JSON to the $app:curtain.fabric metafield', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/fabric',
      headers: await auth(),
      payload: { fabric: validFabric },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ written: ['fabric'], syncQueued: true, fabric: validFabric });
    const written = sets();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ ownerId: GID, namespace: '$app:curtain', key: 'fabric' });
    // Round-trip: the metafield JSON parses to the same fabric the form sent.
    expect(JSON.parse(written[0]!.value)).toEqual(validFabric);
    expect(t.queue.pending('sync-shopify-product').some((j) => (j.data as { productGid: string }).productGid === GID)).toBe(true);
  });

  it('PUT rejects an invalid stretch with 400 (Fastify schema validation)', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/fabric',
      headers: await auth(),
      payload: { fabric: { ...validFabric, stretchPct: 150 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
    expect(sets()).toHaveLength(0);
  });

  it('PUT rejects a drape out of range', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/fabric',
      headers: await auth(),
      payload: { fabric: { ...validFabric, drape: 1.5 } },
    });
    expect(res.statusCode).toBe(400);
    expect(sets()).toHaveLength(0);
  });

  it('PUT rejects a blend whose percentages do not add up to 100 with 422 (handler check)', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/fabric',
      headers: await auth(),
      payload: { fabric: { ...validFabric, blend: [['cotton', 90], ['elastane', 2]] } },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.message).toMatch(/blend/i);
    expect(sets()).toHaveLength(0);
  });

  it('PUT rejects a blend that lists the same fibre twice', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/fabric',
      headers: await auth(),
      payload: { fabric: { ...validFabric, blend: [['cotton', 50], ['Cotton', 50]] } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/listed twice/);
  });

  it('PUT accepts a valid blend', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/fabric',
      headers: await auth(),
      payload: { fabric: { ...validFabric, blend: [['cotton', 98], ['elastane', 2]] } },
    });
    expect(res.statusCode).toBe(200);
    const written = sets();
    expect(JSON.parse(written[0]!.value)).toMatchObject({ blend: [['cotton', 98], ['elastane', 2]] });
  });

  it('dryRun validates without writing', async () => {
    const queueBefore = t.queue.pending('sync-shopify-product').length;
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/fabric',
      headers: await auth(),
      payload: { fabric: validFabric, dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ written: [], syncQueued: false, fabric: validFabric });
    expect(sets()).toHaveLength(0);
    expect(t.queue.pending('sync-shopify-product').length).toBe(queueBefore);
  });

  it('GET reads the stored fabric back: what the admin wrote is what the payload builder reads', async () => {
    metafields.push(mf('fabric', JSON.stringify(validFabric)));
    const res = await t.app.inject({ method: 'GET', url: '/shopify/products/10894387020081/fabric', headers: await auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fabric: validFabric });
  });

  it('DELETE removes the fabric metafield and queues a sync', async () => {
    metafields.push(mf('fabric', JSON.stringify(validFabric)));
    const res = await t.app.inject({ method: 'DELETE', url: '/shopify/products/10894387020081/fabric', headers: await auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fabric: null, written: ['fabric'], syncQueued: true });
    expect(deletes()).toMatchObject([{ key: 'fabric' }]);
  });
});
