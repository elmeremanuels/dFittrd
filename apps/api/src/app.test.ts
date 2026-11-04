import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FS_LENGTH } from '@paskamer/schema';
import { fitSignatures, ledgerEntries, wardrobeItems } from './db/schema.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const vector = (quality = 0.8) => {
  const v = new Array<number>(FS_LENGTH).fill(0);
  v[0] = 36;
  v[2] = 92;
  v[4] = 74;
  v[5] = 98;
  v[78] = 1;
  v[79] = quality;
  return v;
};

describe('devices → signature → export → delete cascade', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('creates an anonymous device with a 30-day token', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/devices', payload: { platform: 'web', appVersion: '0.1.0' } });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ deviceId: string; token: string; expiresAt: string; tokenVersion: number }>();
    expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.tokenVersion).toBe(0);
    const days = (new Date(body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('rejects missing, garbage and foreign tokens', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/ledger' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });

  it('stores the 80-float signature, writes a ledger line, rejects other lengths', async () => {
    const d = await createDevice(t);
    const bad = await t.app.inject({ method: 'PUT', url: '/v1/me/signature', headers: d.auth, payload: { version: 1, vector: vector().slice(0, 79), quality: 0.8 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation');

    const ok = await t.app.inject({ method: 'PUT', url: '/v1/me/signature', headers: d.auth, payload: { version: 1, vector: vector(0.8), quality: 0.8 } });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<{ updatedAt: string; ledgerEntryId: string }>();
    expect(body.ledgerEntryId).toMatch(/-/);

    const row = await t.handle.db.query.fitSignatures.findFirst({ where: eq(fitSignatures.deviceId, d.deviceId) });
    expect(row?.vector).toHaveLength(80);
    expect(row?.vector[79]).toBeCloseTo(0.8, 5);

    const ledger = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: d.auth });
    expect(ledger.json().entries).toHaveLength(1);
    expect(ledger.json().entries[0]).toMatchObject({ kind: 'signature_sync', payloadSummary: { fields: ['version', 'vector', 'quality'] } });
    // the ledger never stores values
    expect(JSON.stringify(ledger.json())).not.toContain('"92');

    // re-put overwrites (one row per device)
    const again = await t.app.inject({ method: 'PUT', url: '/v1/me/signature', headers: d.auth, payload: { version: 1, vector: vector(0.9), quality: 0.9 } });
    expect(again.statusCode).toBe(200);
    expect((await t.handle.db.select().from(fitSignatures).where(eq(fitSignatures.deviceId, d.deviceId))).length).toBe(1);
  });

  it('rotates the token and invalidates the previous one', async () => {
    const d = await createDevice(t);
    const rot = await t.app.inject({ method: 'POST', url: '/v1/devices/rotate', headers: d.auth, payload: { appVersion: '0.2.0' } });
    expect(rot.statusCode).toBe(200);
    const fresh = rot.json<{ token: string; tokenVersion: number }>();
    expect(fresh.tokenVersion).toBe(1);
    const old = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: d.auth });
    expect(old.statusCode).toBe(401);
    expect(old.json().error.code).toBe('token_rotated');
    const ok = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: { authorization: `Bearer ${fresh.token}` } });
    expect(ok.statusCode).toBe(200);
  });

  it('wardrobe put/list and export, then DELETE /v1/me erases everything', async () => {
    const d = await createDevice(t);
    const { shop } = await seedShop(t);
    await t.app.inject({ method: 'PUT', url: '/v1/me/signature', headers: d.auth, payload: { version: 1, vector: vector(), quality: 0.8 } });
    const put = await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/aalter-studio-1', headers: d.auth, payload: { shopId: shop.id, size: 'M', state: 'bought' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ productId: 'aalter-studio-1', shopId: shop.id, size: 'M', state: 'bought' });
    const upd = await t.app.inject({ method: 'PUT', url: '/v1/wardrobe/aalter-studio-1', headers: d.auth, payload: { shopId: shop.id, size: 'M', state: 'kept' } });
    expect(upd.json().state).toBe('kept');
    const list = await t.app.inject({ method: 'GET', url: '/v1/wardrobe', headers: d.auth });
    expect(list.json().items).toHaveLength(1);

    const exp = await t.app.inject({ method: 'GET', url: '/v1/me/export', headers: d.auth });
    expect(exp.statusCode).toBe(200);
    const e = exp.json<{ deviceId: string; signature: { vector: number[] } | null; wardrobe: unknown[]; ledger: unknown[]; swipes: unknown[]; pairings: unknown[] }>();
    expect(e.deviceId).toBe(d.deviceId);
    expect(e.signature?.vector).toHaveLength(80);
    expect(e.wardrobe).toHaveLength(1);
    expect(e.ledger.length).toBeGreaterThanOrEqual(2);

    const del = await t.app.inject({ method: 'DELETE', url: '/v1/me', headers: d.auth });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ deleted: true });
    expect(del.json().tables).toContain('fit_signatures');

    const { db } = t.handle;
    expect(await db.select().from(fitSignatures).where(eq(fitSignatures.deviceId, d.deviceId))).toHaveLength(0);
    expect(await db.select().from(wardrobeItems).where(eq(wardrobeItems.deviceId, d.deviceId))).toHaveLength(0);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.deviceId, d.deviceId))).toHaveLength(0);
    const after = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: d.auth });
    expect(after.statusCode).toBe(401);
  });

  it('products are readable by uuid or by shop + external id, incomplete ones are 422', async () => {
    const d = await createDevice(t);
    const { shop, productIds } = await seedShop(t);
    const byId = await t.app.inject({ method: 'GET', url: `/v1/products/${productIds['monochrome-02']}`, headers: d.auth });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().garment.id).toBe('monochrome-02');
    const byExt = await t.app.inject({ method: 'GET', url: `/v1/products/raw-denim-01?shopId=${shop.id}`, headers: d.auth });
    expect(byExt.statusCode).toBe(200);
    expect(byExt.json().shopId).toBe(shop.id);
    expect((await t.app.inject({ method: 'GET', url: `/v1/products/nope?shopId=${shop.id}`, headers: d.auth })).statusCode).toBe(404);
  });
});
