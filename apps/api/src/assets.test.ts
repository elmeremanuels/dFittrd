import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { garmentAssets, products, shops } from './db/schema.js';
import { AssetImportError, importBundle } from './services/assets.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const SIZES = MOCK_GARMENTS_BY_ID['aalter-studio-1']!.sizeChart.map((r) => r.size);

async function fakeBundle(opts: { sizes?: string[]; pass?: boolean; seed?: string } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'curtain-bundle-'));
  const sizes = opts.sizes ?? SIZES;
  await writeFile(join(dir, 'base.glb'), Buffer.from(`glTF-fake-${opts.seed ?? 'a'}`));
  await writeFile(join(dir, 'anchors.json'), JSON.stringify({ format: 'curtain.garment.anchors', baseSize: sizes[1] }));
  await writeFile(join(dir, 'grading.json'), JSON.stringify({ format: 'curtain.garment.grading', baseSize: sizes[1], sizes: sizes.map((size) => ({ size })) }));
  await writeFile(join(dir, 'material.json'), JSON.stringify({ format: 'curtain.garment.material' }));
  await writeFile(join(dir, 'qa.json'), JSON.stringify({ format: 'curtain.garment.qa', chartAgreement: { pass: opts.pass ?? true } }));
  // Never served: a shop-derived payload next to the bundle.
  await writeFile(join(dir, 'payload.json'), JSON.stringify({ productPhotos: ['https://cdn.example/photo.jpg'] }));
  return dir;
}

describe('garment assets (D13, D16)', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  let assetDir: string;
  beforeAll(async () => {
    assetDir = await mkdtemp(join(tmpdir(), 'curtain-assets-'));
    t = await makeApp({ ASSET_DIR: assetDir, SERVE_ASSETS: '1' });
    s = await seedShop(t, { products: ['aalter-studio-1'] });
  });
  afterAll(async () => {
    await t.close();
  });

  const auth = () => ({ authorization: `Bearer ${s.apiKey}` });
  const tryAsset = async () => {
    const d = await createDevice(t);
    const mint = await t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', headers: { origin: 'https://merchant.example' }, payload: { shopKeyPrefix: s.publicKeyPrefix, productExternalId: 'aalter-studio-1', pageUrl: 'https://merchant.example/p' } });
    const token = mint.json<{ tryUrl: string }>().tryUrl.split('/try/')[1]!;
    const res = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
    expect(res.statusCode).toBe(200);
    return res.json<{ asset?: { baseUrl: string; version: string; label: string; sizes: string[] } | null }>().asset ?? null;
  };

  it('imports idempotently, awaiting approval, and never hands out a ref before approval', async () => {
    const dir = await fakeBundle();
    const a = await importBundle(t.handle.db, t.env, s.shop.id, 'aalter-studio-1', dir);
    expect(a.created).toBe(true);
    expect(a.asset.status).toBe('awaiting_approval');
    expect(a.asset.version).toMatch(/^[0-9a-f]{16}$/);
    const b = await importBundle(t.handle.db, t.env, s.shop.id, 'aalter-studio-1', dir);
    expect(b).toMatchObject({ created: false, asset: { id: a.asset.id } });
    await t.handle.db.update(shops).set({ settings: { ...s.shop.settings, garment3d: true } }).where(eq(shops.id, s.shop.id));
    expect(await tryAsset()).toBeNull();
  });

  it('rejects a bundle that does not cover the chart or failed QA', async () => {
    await expect(importBundle(t.handle.db, t.env, s.shop.id, 'aalter-studio-1', await fakeBundle({ sizes: SIZES.slice(1) }))).rejects.toBeInstanceOf(AssetImportError);
    await expect(importBundle(t.handle.db, t.env, s.shop.id, 'aalter-studio-1', await fakeBundle({ pass: false }))).rejects.toMatchObject({ problem: 'qa_failed' });
  });

  it('merchant approval makes it live; the try response carries an estimate-labelled ref; files are served immutable without payload.json', async () => {
    const list = await t.app.inject({ method: 'GET', url: '/v1/merchant/products/aalter-studio-1/assets', headers: auth() });
    expect(list.statusCode).toBe(200);
    const [asset] = list.json<{ assets: { id: string; status: string; live: boolean }[] }>().assets;
    expect(asset).toMatchObject({ status: 'awaiting_approval', live: false });
    const ok = await t.app.inject({ method: 'POST', url: `/v1/merchant/assets/${asset!.id}/approve`, headers: auth() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().asset).toMatchObject({ status: 'approved', live: true });

    const ref = await tryAsset();
    expect(ref).toMatchObject({ label: 'estimate', sizes: SIZES });
    const path = new URL(ref!.baseUrl).pathname;
    const glb = await t.app.inject({ method: 'GET', url: `${path}/base.glb` });
    expect(glb.statusCode).toBe(200);
    expect(glb.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(glb.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(glb.headers['set-cookie']).toBeUndefined();
    expect((await t.app.inject({ method: 'GET', url: `${path}/payload.json` })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await t.app.inject({ method: 'GET', url: `${path}/..%2F..%2Fqa.json` })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await t.app.inject({ method: 'POST', url: `${path}/qa.json`, payload: { bust: 90 } })).statusCode).toBe(404);
  });

  it('falls back (null) when the shop switches 3D off or the live chart gains a size', async () => {
    await t.handle.db.update(shops).set({ settings: { ...s.shop.settings, garment3d: false } }).where(eq(shops.id, s.shop.id));
    expect(await tryAsset()).toBeNull();
    await t.handle.db.update(shops).set({ settings: { ...s.shop.settings, garment3d: true } }).where(eq(shops.id, s.shop.id));
    expect(await tryAsset()).not.toBeNull();
    const row = (await t.handle.db.query.products.findFirst({ where: eq(products.id, s.productIds['aalter-studio-1']!) }))!;
    const chart = [...row.payload.sizeChart!, { ...row.payload.sizeChart![0]!, size: 'XXXL' }];
    await t.handle.db.update(products).set({ payload: { ...row.payload, sizeChart: chart } }).where(eq(products.id, row.id));
    expect(await tryAsset()).toBeNull();
    await t.handle.db.update(products).set({ payload: row.payload }).where(eq(products.id, row.id));
  });

  it('a newer approval supersedes the old version; rejecting the live one takes 3D off', async () => {
    const { asset } = await importBundle(t.handle.db, t.env, s.shop.id, 'aalter-studio-1', await fakeBundle({ seed: 'b' }));
    await t.app.inject({ method: 'POST', url: `/v1/merchant/assets/${asset.id}/approve`, headers: auth() });
    const rows = await t.handle.db.query.garmentAssets.findMany({ where: eq(garmentAssets.productId, s.productIds['aalter-studio-1']!) });
    expect(rows.map((r) => r.status).sort()).toEqual(['approved', 'superseded']);
    expect((await tryAsset())?.version).toBe(asset.version);
    const rej = await t.app.inject({ method: 'POST', url: `/v1/merchant/assets/${asset.id}/reject`, headers: auth(), payload: { reason: 'hem too short' } });
    expect(rej.json().asset).toMatchObject({ status: 'rejected', live: false, rejectReason: 'hem too short' });
    expect(await tryAsset()).toBeNull();
  });

  it('another shop cannot approve this shop’s asset', async () => {
    const other = await seedShop(t, { products: ['aalter-studio-1'] });
    const [row] = await t.handle.db.query.garmentAssets.findMany({ where: eq(garmentAssets.shopId, s.shop.id), limit: 1 });
    const res = await t.app.inject({ method: 'POST', url: `/v1/merchant/assets/${row!.id}/approve`, headers: { authorization: `Bearer ${other.apiKey}` } });
    expect(res.statusCode).toBe(404);
  });
});
