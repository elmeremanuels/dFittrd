/**
 * GET /v1/peek — the size peek's read-only lookup (apps/web/src/embed/peek.ts). Findings C1/C2 of
 * the release review: peek views must not create try sessions (merchant analytics, the k floor) or
 * use the shop's SDK rate limit; P1: only try-able products and only devices already paired here.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pairings, products, shops, trySessions } from './db/schema.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const PAGE = 'https://aalter.example/products/wrap';

describe('GET /v1/peek', () => {
  let t: TestApp;
  let seeded: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp({ SDK_RATE_LIMIT_PER_MIN: '3', TRY_RATE_LIMIT_PER_MIN: '200' });
    seeded = await seedShop(t, { domain: 'aalter.example' });
    await t.handle.db
      .update(shops)
      .set({ settings: { ...seeded.shop.settings, siteUrl: 'https://aalter.example' } })
      .where(eq(shops.id, seeded.shop.id));
  });
  afterAll(async () => {
    await t.close();
  });

  const peek = (auth: Record<string, string>, product = 'aalter-studio-1', page = PAGE) =>
    t.app.inject({ method: 'GET', url: `/v1/peek?${new URLSearchParams({ shop: seeded.publicKeyPrefix, product, page }).toString()}`, headers: { origin: 'http://localhost:5173', ...auth } });

  /** A device that used the fitting room on this shop once (the pairing the overlay creates). */
  async function pairedDevice() {
    const d = await createDevice(t);
    await t.handle.db.insert(pairings).values({ deviceId: d.deviceId, shopId: seeded.shop.id, pseudonym: `ps_${d.deviceId.slice(0, 8)}`, source: 'embed', pairedAt: new Date() });
    return d;
  }
  const sessionCount = async () => (await t.handle.db.select().from(trySessions).where(eq(trySessions.shopId, seeded.shop.id))).length;

  it('a paired device gets branding, the garment and the allowed origins; nothing is written', async () => {
    const d = await pairedDevice();
    const before = await sessionCount();
    const res = await peek(d.auth);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ shop: { id: string; paused: boolean }; garment: { id: string }; embed: { allowedOrigins: string[] } }>();
    expect(body.shop).toMatchObject({ id: seeded.shop.id, paused: false });
    expect(body.garment.id).toBe('aalter-studio-1');
    expect(body.embed.allowedOrigins).toEqual(['https://aalter.example']);
    expect(Object.keys(body).sort()).toEqual(['embed', 'garment', 'shop']); // no try session, no intent token
    expect(await sessionCount()).toBe(before);
  });

  it('a page origin the shop does not own is not added to the allowed origins', async () => {
    const d = await pairedDevice();
    const res = await peek(d.auth, 'aalter-studio-1', 'https://evil.example/');
    expect(res.json<{ embed: { allowedOrigins: string[] } }>().embed.allowedOrigins).toEqual(['https://aalter.example']);
  });

  it('a device never paired with the shop gets 404 and no pairing is created', async () => {
    const d = await createDevice(t);
    expect((await peek(d.auth)).statusCode).toBe(404);
    expect(await t.handle.db.select().from(pairings).where(eq(pairings.deviceId, d.deviceId))).toHaveLength(0);
    expect((await peek({})).statusCode).toBe(401);
  });

  it('only try-able products: unknown, incomplete or archived ids answer 404', async () => {
    const d = await pairedDevice();
    expect((await peek(d.auth, 'no-such-product')).statusCode).toBe(404);
    await t.handle.db.update(products).set({ status: 'incomplete' }).where(eq(products.id, seeded.productIds['monochrome-02']!));
    expect((await peek(d.auth, 'monochrome-02')).statusCode).toBe(404);
    await t.handle.db.update(products).set({ status: 'archived' }).where(eq(products.id, seeded.productIds['raw-denim-01']!));
    expect((await peek(d.auth, 'raw-denim-01')).statusCode).toBe(404);
  });

  it('C1/C2: peek views create no try sessions and never use the shop SDK budget real clicks need', async () => {
    const d = await pairedDevice();
    const before = await sessionCount();
    for (let i = 0; i < 6; i++) expect((await peek(d.auth)).statusCode).toBe(200);
    expect(await sessionCount()).toBe(before);
    // SDK_RATE_LIMIT_PER_MIN is 3 here: the button still gets its sessions after six peeks
    for (let i = 0; i < 3; i++) {
      const res = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: seeded.publicKeyPrefix, productExternalId: 'aalter-studio-1', pageUrl: PAGE, surface: 'embed' } });
      expect(res.statusCode).toBe(200);
    }
  });

  it('a paused shop shows no peek', async () => {
    const d = await pairedDevice();
    await t.handle.db.update(shops).set({ paused: true }).where(eq(shops.id, seeded.shop.id));
    try {
      expect((await peek(d.auth)).statusCode).toBe(402);
    } finally {
      await t.handle.db.update(shops).set({ paused: false }).where(eq(shops.id, seeded.shop.id));
    }
  });
});
