/**
 * The male path end to end on the api (docs/research/men-3d-plan.md slice M1), with a real bundle:
 * the SYNTHETIC men's test tee (`SYNTHETIC_MENS_TEE`, not a product) built on the male mannequin by
 * the spike's own builder (`spikes/garment-engine/scripts/build-bundle.ts`, run here as a child
 * process: CPU, deterministic, under a second), then
 *   import (`asset:import`'s `importBundle`) → merchant approval (D13) → shop 3D on → the men's gate
 *   with MEN_3D_GATE=1 → `GET /v1/try?caps=requires3d` hands out the asset with `requires3d` → the
 *   five files are served under the asset ref and are the bundle's bytes.
 * The family check is strict: the male bundle is refused for a women's product, and a female-built
 * bundle (the spike's synthetic dress) is refused for the men's product, on import. The family
 * follows the audience even when the `men` is only a guess (weak source, not gated): see the last block.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GARMENT_BUNDLE_FILES, MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { pairings, shops } from './db/schema.js';
import { approveAsset, assetMannequinFamily, importBundle } from './services/assets.js';
import { upsertProduct } from './services/products.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const SITE = 'https://noordman.example';
const PAGE = `${SITE}/products/tee`;
const TEE = SYNTHETIC_MENS_TEE.id;
const WOMEN = 'aalter-studio-2';

/** The spike's builder, one product, without the slow stage 3; returns the bundle folder. */
function spikeBundle(id: string, out: string): string {
  const tsx = join(repo, 'apps', 'api', 'node_modules', '.bin', 'tsx');
  execFileSync(tsx, [join(repo, 'spikes', 'garment-engine', 'scripts', 'build-bundle.ts'), '--only', id, '--out', out, '--skip-separation'], { cwd: repo, stdio: 'pipe', timeout: 120_000 });
  return join(out, id);
}

interface World {
  t: TestApp;
  shop: Awaited<ReturnType<typeof seedShop>>;
  ids: Record<string, string>;
}

async function world(env: Record<string, string>): Promise<World> {
  const assetDir = await mkdtemp(join(tmpdir(), 'curtain-men-m1-'));
  const t = await makeApp({ ASSET_DIR: assetDir, SERVE_ASSETS: '1', TRY_RATE_LIMIT_PER_MIN: '1000', SDK_RATE_LIMIT_PER_MIN: '1000', ...env });
  const shop = await seedShop(t, { domain: 'noordman.example', name: 'Noordman', products: [] });
  await t.handle.db.update(shops).set({ settings: { ...shop.shop.settings, siteUrl: SITE, garment3d: true } }).where(eq(shops.id, shop.shop.id));
  const ids: Record<string, string> = {};
  // The men's tee with a strong audience source, as a Shopify sync stores it: only that gates.
  ids[TEE] = (await upsertProduct(t.handle.db, shop.shop.id, TEE, SYNTHETIC_MENS_TEE, { audienceSource: 'productType' })).product.id;
  ids[WOMEN] = (await upsertProduct(t.handle.db, shop.shop.id, WOMEN, MOCK_GARMENTS_BY_ID[WOMEN]!)).product.id;
  return { t, shop, ids };
}

const mint = (w: World, product: string) =>
  w.t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', headers: { origin: SITE }, payload: { shopKeyPrefix: w.shop.publicKeyPrefix, productExternalId: product, pageUrl: PAGE, surface: 'embed' } });
const tokenOf = (res: { json: <T>() => T }): string => res.json<{ embedUrl: string }>().embedUrl.split('/embed/')[1]!;

async function pairedDevice(w: World) {
  const d = await createDevice(w.t);
  await w.t.handle.db.insert(pairings).values({ deviceId: d.deviceId, shopId: w.shop.shop.id, pseudonym: `ps_${d.deviceId.slice(0, 8)}`, source: 'embed', pairedAt: new Date() });
  return d;
}

let maleDir: string;
let femaleDir: string;
let on: World;
let off: World;

beforeAll(async () => {
  const out = await mkdtemp(join(tmpdir(), 'curtain-spike-bundles-'));
  maleDir = spikeBundle(TEE, out);
  femaleDir = spikeBundle(WOMEN, out);
  [on, off] = await Promise.all([world({ MEN_3D_GATE: '1' }), world({})]);
}, 180_000);

afterAll(async () => {
  await on?.t.close();
  await off?.t.close();
});

describe('the synthetic men’s tee bundle (built on the male mannequin)', () => {
  it('names the male family in anchors.json and qa.json, and is labelled synthetic', async () => {
    const anchors = JSON.parse(await readFile(join(maleDir, 'anchors.json'), 'utf8')) as { mannequin: unknown; synthetic: boolean };
    const qa = JSON.parse(await readFile(join(maleDir, 'qa.json'), 'utf8')) as { mannequin: unknown; synthetic: boolean };
    expect(anchors.mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(qa.mannequin).toEqual(anchors.mannequin);
    expect(anchors.synthetic).toBe(true);
    expect(qa.synthetic).toBe(true);
    expect(SYNTHETIC_MENS_TEE.name).toMatch(/SYNTHETIC .*not a product/);
  });
});

describe('import: the family check (three places refuse a bundle of the wrong family; this is the first)', () => {
  it('refuses the male bundle for a women’s product and a female-built bundle for the men’s product', async () => {
    const db = on.t.handle.db;
    await expect(importBundle(db, on.t.env, on.shop.shop.id, WOMEN, maleDir)).rejects.toMatchObject({ problem: 'family_mismatch' });
    // The dress's sizes are not the tee's either; the family is checked first, so that is what the import says.
    await expect(importBundle(db, on.t.env, on.shop.shop.id, TEE, femaleDir)).rejects.toMatchObject({ problem: 'family_mismatch' });
    const female = await importBundle(db, on.t.env, on.shop.shop.id, WOMEN, femaleDir);
    expect(assetMannequinFamily(female.asset)).toBe('female');
  });
});

describe('gate on (MEN_3D_GATE=1): the men’s tee goes live only with its approved male bundle', () => {
  it('coming soon before approval; after it, GET /v1/try sends the asset with requires3d, and the files are the bundle', async () => {
    const db = on.t.handle.db;
    const state = async () => (await mint(on, TEE)).json<{ productState?: string }>().productState;
    expect(await state()).toBe('coming_soon'); // no bundle yet

    const { asset, created } = await importBundle(db, on.t.env, on.shop.shop.id, TEE, maleDir);
    expect(created).toBe(true);
    expect(asset.status).toBe('awaiting_approval');
    expect(assetMannequinFamily(asset)).toBe('male');
    expect(asset.sizes).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
    expect(await state()).toBe('coming_soon'); // imported, not approved (D13)

    await approveAsset(db, on.shop.shop.id, asset.id, 'test');
    expect(await state()).toBeUndefined(); // ready

    const d = await pairedDevice(on);
    const tried = await on.t.app.inject({ method: 'GET', url: `/v1/try/${tokenOf(await mint(on, TEE))}?caps=requires3d`, headers: d.auth });
    expect(tried.statusCode).toBe(200);
    const body = tried.json<{ requires3d?: boolean; asset: { version: string; baseUrl: string; sizes: string[]; label: string } | null; garment: { id: string; audience?: string } }>();
    expect(body.requires3d).toBe(true);
    expect(body.garment).toMatchObject({ id: TEE, audience: 'men' });
    expect(body.asset).toMatchObject({ version: asset.version, sizes: ['S', 'M', 'L', 'XL', 'XXL'], label: 'estimate' });

    // What the embed's viewer GETs: the five files, byte for byte (payload.json is never copied).
    const path = new URL(body.asset!.baseUrl).pathname;
    for (const name of GARMENT_BUNDLE_FILES) {
      const res = await on.t.app.inject({ method: 'GET', url: `${path}/${name}` });
      expect(res.statusCode).toBe(200);
      expect(Buffer.compare(res.rawPayload, await readFile(join(maleDir, name)))).toBe(0);
    }
    expect((await on.t.app.inject({ method: 'GET', url: `${path}/payload.json` })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('a men’s audience that is only a guess (title or collection; the gate leaves it ungated)', () => {
  // The gate and the body family answer different questions: may a guessed `men` hide the product
  // (no: `unconfirmed`), and which body does the embed draw (the male one, since M0). The bundle
  // must match the drawn body, so the family follows the audience whatever its source.
  const GUESSED_TEE = 'guessed-tee';
  const GUESSED_DRESS = 'guessed-dress';

  it('is not gated, takes a male bundle and gets the optional 3D view on the male body', async () => {
    const db = on.t.handle.db;
    await upsertProduct(db, on.shop.shop.id, GUESSED_TEE, { ...SYNTHETIC_MENS_TEE, id: GUESSED_TEE }, { audienceSource: 'title' });
    expect((await mint(on, GUESSED_TEE)).json<{ productState?: string }>().productState).toBeUndefined();
    const male = await importBundle(db, on.t.env, on.shop.shop.id, GUESSED_TEE, maleDir);
    await approveAsset(db, on.shop.shop.id, male.asset.id, 'test');
    const d = await pairedDevice(on);
    const res = await on.t.app.inject({ method: 'GET', url: `/v1/try/${tokenOf(await mint(on, GUESSED_TEE))}?caps=requires3d`, headers: d.auth });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ requires3d?: boolean; asset: { version: string } | null; garment: { audience?: string } }>();
    expect(body.requires3d).not.toBe(true); // not gated: 3D is optional, the 2D flow stays
    expect(body.asset?.version).toBe(male.asset.version);
    expect(body.garment.audience).toBe('men');
  });

  it('refuses a female-built bundle with a hint to build it on the male body or correct the audience; once corrected, it imports', async () => {
    const db = on.t.handle.db;
    // A women's dress whose title read as men's: the guess, not gated, drawn on the male body.
    await upsertProduct(db, on.shop.shop.id, GUESSED_DRESS, { ...MOCK_GARMENTS_BY_ID[WOMEN]!, id: GUESSED_DRESS, audience: 'men' }, { audienceSource: 'title' });
    expect((await mint(on, GUESSED_DRESS)).json<{ productState?: string }>().productState).toBeUndefined();
    const refused = await importBundle(db, on.t.env, on.shop.shop.id, GUESSED_DRESS, femaleDir).catch((e: unknown) => e);
    expect(refused).toMatchObject({ problem: 'family_mismatch' });
    expect((refused as Error).message).toMatch(/a guess \(from the title\).*correct the audience/);
    // The merchant corrects the audience: the same bundle now imports, on the female body.
    await upsertProduct(db, on.shop.shop.id, GUESSED_DRESS, { ...MOCK_GARMENTS_BY_ID[WOMEN]!, id: GUESSED_DRESS, audience: 'women' }, { audienceSource: 'override' });
    const female = await importBundle(db, on.t.env, on.shop.shop.id, GUESSED_DRESS, femaleDir);
    expect(assetMannequinFamily(female.asset)).toBe('female');
  });
});

describe('gate off (the default): the same men’s tee and its male bundle', () => {
  it('get the 3D button without requires3d; a women’s product with a female bundle is unchanged', async () => {
    const db = off.t.handle.db;
    const male = await importBundle(db, off.t.env, off.shop.shop.id, TEE, maleDir);
    await approveAsset(db, off.shop.shop.id, male.asset.id, 'test');
    const female = await importBundle(db, off.t.env, off.shop.shop.id, WOMEN, femaleDir);
    await approveAsset(db, off.shop.shop.id, female.asset.id, 'test');
    const d = await pairedDevice(off);
    for (const [product, version] of [[TEE, male.asset.version], [WOMEN, female.asset.version]] as const) {
      const res = await off.t.app.inject({ method: 'GET', url: `/v1/try/${tokenOf(await mint(off, product))}?caps=requires3d`, headers: d.auth });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ requires3d?: boolean; asset: { version: string } | null }>();
      expect(body.requires3d).not.toBe(true);
      expect(body.asset?.version).toBe(version);
    }
  });

  it('the try route hands out no asset when the live bundle is of the other family (the audience changed after import)', async () => {
    const db = off.t.handle.db;
    // The merchant re-labels the men's tee as women's: the approved male bundle no longer matches the body the embed draws.
    await upsertProduct(db, off.shop.shop.id, TEE, { ...SYNTHETIC_MENS_TEE, audience: 'women' });
    const d = await pairedDevice(off);
    const res = await off.t.app.inject({ method: 'GET', url: `/v1/try/${tokenOf(await mint(off, TEE))}?caps=requires3d`, headers: d.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ asset: unknown }>().asset).toBeNull();
  });
});
