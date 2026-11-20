import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pairings, shops, trySessions } from './db/schema.js';
import { pseudonymFor } from './lib/crypto.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

describe('SDK sessions → try token → pairing with pseudonym', () => {
  let t: TestApp;
  let seeded: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    seeded = await seedShop(t);
  });
  afterAll(async () => {
    await t.close();
  });

  const session = (productExternalId = 'aalter-studio-1', prefix = seeded.publicKeyPrefix) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/sdk/sessions',
      headers: { origin: 'https://merchant.example' },
      payload: { shopKeyPrefix: prefix, productExternalId, pageUrl: 'https://merchant.example/products/wrap' },
    });

  it('mints a 10-minute deep link with a QR and CORS *', async () => {
    const res = await session();
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const body = res.json<{ tryUrl: string; qrSvg: string; expiresAt: string; shopPaused: boolean }>();
    expect(body.tryUrl.startsWith(`${t.env.PUBLIC_APP_URL}/try/`)).toBe(true);
    expect(body.qrSvg).toContain('<svg');
    expect(body.shopPaused).toBe(false);
    const ttl = (new Date(body.expiresAt).getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
    const row = await t.handle.db.query.trySessions.findFirst({ where: eq(trySessions.shopId, seeded.shop.id) });
    expect(row?.resolvedAt).toBeNull();
    expect(row?.intentToken).toMatch(/^it_/);
  });

  it('rejects unknown shops, secret keys and unknown products', async () => {
    expect((await session('aalter-studio-1', 'pk_test_doesnotexist')).statusCode).toBe(404);
    expect((await session('nope')).statusCode).toBe(404);
    const sk = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: seeded.apiKey, productExternalId: 'aalter-studio-1', pageUrl: 'https://m.example' } });
    expect(sk.statusCode).toBe(400);
  });

  it('paused shop → 402 but still a tryUrl (never break the merchant page)', async () => {
    await t.handle.db.update(shops).set({ paused: true }).where(eq(shops.id, seeded.shop.id));
    const res = await session();
    expect(res.statusCode).toBe(402);
    expect(res.json().shopPaused).toBe(true);
    expect(res.json().tryUrl).toContain('/try/');
    await t.handle.db.update(shops).set({ paused: false }).where(eq(shops.id, seeded.shop.id));
  });

  it('resolves the token: garment + shop, pairing created once with a pseudonym, session resolved', async () => {
    const d = await createDevice(t);
    const token = (await session()).json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    const unauth = await t.app.inject({ method: 'GET', url: `/v1/try/${token}` });
    expect(unauth.statusCode).toBe(401);

    const res = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ shop: { id: string; name: string; paused: boolean; brandColor?: string }; garment: { id: string }; trySession: { intentToken: string }; pairing: { created: boolean } }>();
    expect(body.shop).toMatchObject({ id: seeded.shop.id, name: 'Aalter Studio', paused: false, brandColor: '#FF5A3C' });
    expect(body.garment.id).toBe('aalter-studio-1');
    expect(body.trySession.intentToken).toMatch(/^it_/);
    expect(body.pairing.created).toBe(true);

    const pairing = await t.handle.db.query.pairings.findFirst({ where: and(eq(pairings.deviceId, d.deviceId), eq(pairings.shopId, seeded.shop.id)) });
    expect(pairing?.pseudonym).toBe(pseudonymFor(d.deviceId, seeded.shop.id, t.env.SHOP_KEY_PEPPER));
    expect(pairing?.pseudonym).not.toContain(d.deviceId.slice(0, 8));
    const sess = await t.handle.db.query.trySessions.findFirst({ where: eq(trySessions.deviceId, d.deviceId) });
    expect(sess?.resolvedAt).not.toBeNull();

    // same device again: idempotent, pairing not re-created; another device: 409
    const again = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
    expect(again.json().pairing.created).toBe(false);
    const other = await createDevice(t);
    expect((await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: other.auth })).statusCode).toBe(409);

    // the ledger recorded the pairing without values
    const ledger = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: d.auth });
    expect(ledger.json().entries.map((e: { kind: string }) => e.kind)).toContain('pairing');

    // paired → the shop catalogue is a deck source; the other device is not paired
    const deck = await t.app.inject({ method: 'GET', url: `/v1/shops/${seeded.shop.id}/products?limit=2`, headers: d.auth });
    expect(deck.statusCode).toBe(200);
    expect(deck.json().items).toHaveLength(2);
    expect(deck.json().nextCursor).toBeTruthy();
    const page2 = await t.app.inject({ method: 'GET', url: `/v1/shops/${seeded.shop.id}/products?limit=2&cursor=${deck.json().nextCursor}`, headers: d.auth });
    expect(page2.json().items).toHaveLength(1);
    expect(page2.json().nextCursor).toBeNull();
    expect((await t.app.inject({ method: 'GET', url: `/v1/shops/${seeded.shop.id}/products`, headers: other.auth })).statusCode).toBe(403);
  });

  it('rejects tampered and expired tokens', async () => {
    const d = await createDevice(t);
    const token = (await session()).json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    const bad = await t.app.inject({ method: 'GET', url: `/v1/try/${token}x`, headers: d.auth });
    expect(bad.statusCode).toBe(401);
    const jti = (await t.app.ctx.tokens.verifyTry(token))!.jti;
    await t.handle.db.update(trySessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(trySessions.tokenJti, jti));
    const expired = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
    expect(expired.statusCode).toBe(410);
  });
});

describe('SDK per-shop rate limit', () => {
  it('limits by shop key prefix', async () => {
    const t = await makeApp({ SDK_RATE_LIMIT_PER_MIN: '2' });
    try {
      const { publicKeyPrefix } = await seedShop(t);
      const hit = () => t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', payload: { shopKeyPrefix: publicKeyPrefix, productExternalId: 'aalter-studio-1', pageUrl: 'https://m.example/p' } });
      expect((await hit()).statusCode).toBe(200);
      expect((await hit()).statusCode).toBe(200);
      const third = await hit();
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('rate_limited');
    } finally {
      await t.close();
    }
  });
});
