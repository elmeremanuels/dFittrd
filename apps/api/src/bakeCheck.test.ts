import { cp, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PILOT_PULL_ON_SKIRT, type MerchantGarmentAsset } from '@curtain/schema';
import { garmentAssets, products } from './db/schema.js';
import { upsertProduct } from './services/products.js';
import { AssetImportError, importBundle } from './services/assets.js';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';

/**
 * The import's automatic bake check, end to end: the POM v2 tape-built fixture (packages/garment-viewer/fixtures,
 * the skirt's rest geometry from the shop's tape, in the exact bake format) passes and is an ordinary asset to
 * approve; a copy whose tape disagrees with its geometry is recorded as refused, with no files stored.
 */
const FIXTURE = fileURLToPath(new URL('../../../packages/garment-viewer/fixtures/pom-v2-rest/', import.meta.url));
const PRODUCT = PILOT_PULL_ON_SKIRT.id;

async function copyFixture(edit?: (qa: Record<string, unknown>) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'curtain-bake-'));
  await cp(FIXTURE, dir, { recursive: true });
  if (edit) {
    const qa = JSON.parse(await readFile(join(dir, 'qa.json'), 'utf8')) as Record<string, unknown>;
    edit(qa);
    await writeFile(join(dir, 'qa.json'), JSON.stringify(qa));
  }
  return dir;
}

describe('the bake check on import', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp({ ASSET_DIR: await mkdtemp(join(tmpdir(), 'curtain-assets-')), SERVE_ASSETS: '1' });
    s = await seedShop(t, { products: [] });
    await upsertProduct(t.handle.db, s.shop.id, PRODUCT, PILOT_PULL_ON_SKIRT);
  });
  afterAll(async () => {
    await t.close();
  });
  const auth = () => ({ authorization: `Bearer ${s.apiKey}` });
  const list = async (): Promise<MerchantGarmentAsset[]> => (await t.app.inject({ method: 'GET', url: `/v1/merchant/products/${PRODUCT}/assets`, headers: auth() })).json<{ assets: MerchantGarmentAsset[] }>().assets;

  it('a bake that passes is an ordinary asset to approve: no tape-built flag, the tape provenance in the console', async () => {
    const { asset, created } = await importBundle(t.handle.db, t.env, s.shop.id, PRODUCT, await copyFixture());
    expect(created).toBe(true);
    expect(asset.status).toBe('awaiting_approval');
    const row = (await list()).find((a) => a.id === asset.id)!;
    expect(row).toMatchObject({ status: 'awaiting_approval', qaPass: true, qaFlags: [], qaNotes: [] });
    expect(row.bakeCheck?.pass).toBe(true);
    expect(row.bakeCheck?.checks.every((c) => c.pass === true)).toBe(true);
    expect(row.bakeCheck?.tape?.sizes.map((x) => `${x.size} ${x.provenance}`)).toEqual(['8 measured', '10 measured', '12 interpolated', '14 measured', '16 extrapolated']);
    await stat(join(asset.bundlePath, 'base.glb'));
    const ok = await t.app.inject({ method: 'POST', url: `/v1/merchant/assets/${asset.id}/approve`, headers: auth() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ asset: MerchantGarmentAsset }>().asset).toMatchObject({ status: 'approved', live: true });
  });

  it('a bake whose tape disagrees with its geometry is refused with a plain reason, recorded, never stored or approvable', async () => {
    const dir = await copyFixture((qa) => {
      const tape = qa.tape as { sizes: { tape: { hemSweepCm: { cm: number } } }[] };
      tape.sizes[2]!.tape.hemSweepCm.cm = 280; // AU 12's hem drawn 254 cm around
    });
    const err = await importBundle(t.handle.db, t.env, s.shop.id, PRODUCT, dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssetImportError);
    expect((err as AssetImportError).problem).toBe('bake_check_failed');
    expect((err as AssetImportError).message).toMatch(/Hip line and hem agree with the tape: no\. size 12 on the body with 104 cm hips: the draped hem is 254 cm around, the tape says 280 cm \(allowed ±5\.6 cm\)/);
    const refused = (await list()).find((a) => a.status === 'refused')!;
    expect(refused.rejectReason).toMatch(/^Hip line and hem agree with the tape: no\./);
    expect(refused.bakeCheck?.pass).toBe(false);
    expect(refused.bakeCheck?.checks.find((c) => c.id === 'tape_rings')?.pass).toBe(false);
    const stored = await t.handle.db.query.garmentAssets.findFirst({ where: eq(garmentAssets.id, refused.id) });
    expect(stored!.bundlePath).toBe('');
    const no = await t.app.inject({ method: 'POST', url: `/v1/merchant/assets/${refused.id}/approve`, headers: auth() });
    expect(no.statusCode).toBe(400);
    expect(no.json<{ error: { code: string } }>().error.code).toBe('asset_refused');
    // the approved version stays live
    const p = await t.handle.db.query.products.findFirst({ where: eq(products.externalId, PRODUCT) });
    expect(p!.activeAssetVersion).not.toBeNull();
    expect(p!.activeAssetVersion).not.toBe(refused.version);
  });

  it('a bundle cannot carry its own bake check', async () => {
    const dir = await copyFixture((qa) => {
      qa.bakeCheck = { format: 'curtain.garment.bakeCheck', version: 1, pass: true, checks: [], tape: null, drapes: [], checkedAt: '2026-11-19T00:00:00Z' };
    });
    await expect(importBundle(t.handle.db, t.env, s.shop.id, PRODUCT, dir)).rejects.toMatchObject({ problem: 'format' });
  });
});
