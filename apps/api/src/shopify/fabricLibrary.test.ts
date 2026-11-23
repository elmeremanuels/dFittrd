/**
 * Fabric library (CUR-40, WO-026): the shop's saved fabrics, persisted per shop.
 * Tests prove:
 *   - CRUD round-trip (create, list, update, delete)
 *   - Shop scoping: shop A cannot see shop B's fabrics
 *   - Validation: FabricSchema rejects invalid payloads
 */
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, seedShop, type TestApp } from '../test/helpers.js';
import { shopifySessions } from '../db/schema.js';

const API_KEY = 'shpa_testkey';
const API_SECRET = 'shpss' + '_test_secret_0123456789';

async function sessionToken(shop: string) {
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, sub: '42', sid: 'sid-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(API_KEY)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('1m')
    .setJti(`jti-${Math.random()}`)
    .sign(new TextEncoder().encode(API_SECRET));
}

const validFabric = { primary: 'cotton jersey', stretchPct: 30, drape: 0.45 };

async function seedShopifyShop(t: TestApp, domain: string) {
  const { shop } = await seedShop(t, { platform: 'shopify', domain, name: domain });
  // The session token auth needs an offline token row for the shop.
  await t.handle.db.insert(shopifySessions).values({
    id: `offline_${domain}`,
    shopId: shop.id,
    shopDomain: domain,
    accessTokenEnc: 'enc_offline_token',
  });
  return shop;
}

describe('Shopify fabric library', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
  });
  afterAll(async () => { await t.close(); });

  it('creates, lists, updates and deletes a library entry', async () => {
    const shop = await seedShopifyShop(t, 'lib-crud.myshopify.com');
    const auth = async () => ({ authorization: `Bearer ${await sessionToken(shop.domain)}` });

    // POST: create
    const create = await t.app.inject({ method: 'POST', url: '/shopify/fabric-library', headers: await auth(), payload: { name: 'cotton jersey', fabric: validFabric } });
    expect(create.statusCode).toBe(201);
    const created = create.json<{ entry: { id: string; name: string; fabric: typeof validFabric } }>();
    expect(created.entry.name).toBe('cotton jersey');
    expect(created.entry.fabric.stretchPct).toBe(30);
    const id = created.entry.id;

    // GET: list
    const list = await t.app.inject({ method: 'GET', url: '/shopify/fabric-library', headers: await auth() });
    expect(list.statusCode).toBe(200);
    const listed = list.json<{ entries: Array<{ id: string }> }>();
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]!.id).toBe(id);

    // PUT: update
    const update = await t.app.inject({ method: 'PUT', url: `/shopify/fabric-library/${id}`, headers: await auth(), payload: { name: 'cotton jersey v2', fabric: { ...validFabric, stretchPct: 25 } } });
    expect(update.statusCode).toBe(200);
    expect(update.json<{ entry: { name: string } }>().entry.name).toBe('cotton jersey v2');

    // DELETE
    const del = await t.app.inject({ method: 'DELETE', url: `/shopify/fabric-library/${id}`, headers: await auth() });
    expect(del.statusCode).toBe(200);
    expect(del.json<{ deleted: boolean }>().deleted).toBe(true);

    // GET: empty after delete
    const list2 = await t.app.inject({ method: 'GET', url: '/shopify/fabric-library', headers: await auth() });
    expect(list2.json<{ entries: unknown[] }>().entries).toHaveLength(0);
  });

  it('shop A cannot see shop B\'s fabrics (scoping)', async () => {
    const shopA = await seedShopifyShop(t, 'lib-shop-a.myshopify.com');
    const shopB = await seedShopifyShop(t, 'lib-shop-b.myshopify.com');
    const authA = async () => ({ authorization: `Bearer ${await sessionToken(shopA.domain)}` });
    const authB = async () => ({ authorization: `Bearer ${await sessionToken(shopB.domain)}` });

    // Shop A creates two entries.
    await t.app.inject({ method: 'POST', url: '/shopify/fabric-library', headers: await authA(), payload: { name: 'linen', fabric: { primary: 'linen', stretchPct: 5, drape: 0.7 } } });
    await t.app.inject({ method: 'POST', url: '/shopify/fabric-library', headers: await authA(), payload: { name: 'silk', fabric: { primary: 'silk', stretchPct: 0, drape: 0.9 } } });

    // Shop B sees nothing.
    const listB = await t.app.inject({ method: 'GET', url: '/shopify/fabric-library', headers: await authB() });
    expect(listB.statusCode).toBe(200);
    expect(listB.json<{ entries: unknown[] }>().entries).toHaveLength(0);

    // Shop A sees both.
    const listA = await t.app.inject({ method: 'GET', url: '/shopify/fabric-library', headers: await authA() });
    expect(listA.json<{ entries: unknown[] }>().entries).toHaveLength(2);

    // Shop B cannot delete shop A's entry (returns not_found).
    const aEntries = listA.json<{ entries: Array<{ id: string }> }>().entries;
    const del = await t.app.inject({ method: 'DELETE', url: `/shopify/fabric-library/${aEntries[0]!.id}`, headers: await authB() });
    expect(del.json<{ deleted: boolean }>().deleted).toBe(false);
  });

  it('rejects a fabric that fails FabricSchema validation', async () => {
    const shop = await seedShopifyShop(t, 'lib-validation.myshopify.com');
    const auth = async () => ({ authorization: `Bearer ${await sessionToken(shop.domain)}` });

    // Missing required field `stretchPct`.
    const bad = await t.app.inject({ method: 'POST', url: '/shopify/fabric-library', headers: await auth(), payload: { name: 'bad fabric', fabric: { primary: 'cotton' } } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad.statusCode).toBeLessThan(500);

    // `stretchPct` out of range.
    const bad2 = await t.app.inject({ method: 'POST', url: '/shopify/fabric-library', headers: await auth(), payload: { name: 'bad stretch', fabric: { primary: 'cotton', stretchPct: 200, drape: 0.5 } } });
    expect(bad2.statusCode).toBeGreaterThanOrEqual(400);
    expect(bad2.statusCode).toBeLessThan(500);
  });

  it('deleting a non-existent entry returns deleted=false', async () => {
    const shop = await seedShopifyShop(t, 'lib-noop-delete.myshopify.com');
    const auth = async () => ({ authorization: `Bearer ${await sessionToken(shop.domain)}` });
    const del = await t.app.inject({ method: 'DELETE', url: '/shopify/fabric-library/00000000-0000-0000-0000-000000000000', headers: await auth() });
    expect(del.statusCode).toBe(200);
    expect(del.json<{ deleted: boolean }>().deleted).toBe(false);
  });

  it('updating a non-existent entry returns 404', async () => {
    const shop = await seedShopifyShop(t, 'lib-noop-update.myshopify.com');
    const auth = async () => ({ authorization: `Bearer ${await sessionToken(shop.domain)}` });
    const put = await t.app.inject({ method: 'PUT', url: '/shopify/fabric-library/00000000-0000-0000-0000-000000000000', headers: await auth(), payload: { name: 'x', fabric: validFabric } });
    expect(put.statusCode).toBe(404);
  });
});
