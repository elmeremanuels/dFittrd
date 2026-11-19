/**
 * The male body shape a men's bundle was built on, on the api (`MALE_SHAPE`, the server's side of the web
 * build's `VITE_MALE_SHAPE`): the SYNTHETIC men's test tee (not a product) built by the spike on the
 * male shape v1 and on v2, each imported and handed out only by a deployment that draws that shape.
 * The check sits where the family check sits: on import (`shape_mismatch`, with a hint) and before
 * `GET /v1/try` hands out the asset ref (a deployment that changed its shape after the import).
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { pairings, shops } from './db/schema.js';
import { activeAssetRef, approveAsset, assetMaleShape, importBundle } from './services/assets.js';
import { upsertProduct } from './services/products.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const SITE = 'https://noordman.example';
const TEE = SYNTHETIC_MENS_TEE.id;

function spikeBundle(out: string, shape: 'v1' | 'v2'): string {
  const tsx = join(repo, 'apps', 'api', 'node_modules', '.bin', 'tsx');
  execFileSync(tsx, [join(repo, 'spikes', 'garment-engine', 'scripts', 'build-bundle.ts'), '--only', TEE, '--out', out, '--skip-separation', ...(shape === 'v2' ? ['--male-shape=v2'] : [])], { cwd: repo, stdio: 'pipe', timeout: 240_000 });
  return join(out, TEE);
}

interface World {
  t: TestApp;
  shop: Awaited<ReturnType<typeof seedShop>>;
}

async function world(env: Record<string, string>): Promise<World> {
  const t = await makeApp({ ASSET_DIR: await mkdtemp(join(tmpdir(), 'curtain-male-shape-')), SERVE_ASSETS: '1', TRY_RATE_LIMIT_PER_MIN: '1000', SDK_RATE_LIMIT_PER_MIN: '1000', MEN_3D_GATE: '1', ...env });
  const shop = await seedShop(t, { domain: 'noordman.example', name: 'Noordman', products: [] });
  await t.handle.db.update(shops).set({ settings: { ...shop.shop.settings, siteUrl: SITE, garment3d: true } }).where(eq(shops.id, shop.shop.id));
  await upsertProduct(t.handle.db, shop.shop.id, TEE, SYNTHETIC_MENS_TEE, { audienceSource: 'productType' });
  return { t, shop };
}

const mint = (w: World) =>
  w.t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', headers: { origin: SITE }, payload: { shopKeyPrefix: w.shop.publicKeyPrefix, productExternalId: TEE, pageUrl: `${SITE}/products/tee`, surface: 'embed' } });

async function tryAsset(w: World): Promise<{ status: number; asset: { version: string } | null | undefined; comingSoon: boolean }> {
  const minted = await mint(w);
  const comingSoon = minted.json<{ productState?: string }>().productState === 'coming_soon';
  const d = await createDevice(w.t);
  await w.t.handle.db.insert(pairings).values({ deviceId: d.deviceId, shopId: w.shop.shop.id, pseudonym: `ps_${d.deviceId.slice(0, 8)}`, source: 'embed', pairedAt: new Date() });
  const res = await w.t.app.inject({ method: 'GET', url: `/v1/try/${minted.json<{ embedUrl: string }>().embedUrl.split('/embed/')[1]!}?caps=requires3d`, headers: d.auth });
  return { status: res.statusCode, asset: res.statusCode === 200 ? res.json<{ asset?: { version: string } | null }>().asset : undefined, comingSoon };
}

let v1Dir: string;
let v2Dir: string;
let onV1: World;
let onV2: World;

beforeAll(async () => {
  v1Dir = spikeBundle(await mkdtemp(join(tmpdir(), 'curtain-tee-v1-')), 'v1');
  v2Dir = spikeBundle(await mkdtemp(join(tmpdir(), 'curtain-tee-v2-')), 'v2');
  [onV1, onV2] = await Promise.all([world({}), world({ MALE_SHAPE: 'v2' })]);
}, 480_000);

afterAll(async () => {
  await onV1?.t.close();
  await onV2?.t.close();
});

describe('the male body shape of a men’s bundle (MALE_SHAPE)', () => {
  it('the setting is v2 only for exactly v2; the v2-built bundle says so in anchors.json and qa.json, the v1-built one says nothing', async () => {
    expect(onV1.t.env.MALE_SHAPE).toBe('v1');
    expect(onV2.t.env.MALE_SHAPE).toBe('v2');
    const read = async (dir: string, name: string) => (JSON.parse(await readFile(join(dir, name), 'utf8')) as { mannequin: unknown }).mannequin;
    expect(await read(v2Dir, 'anchors.json')).toEqual({ version: '0.1.0', shape: 'M', family: 'male', maleShape: 'v2' });
    expect(await read(v2Dir, 'qa.json')).toEqual(await read(v2Dir, 'anchors.json'));
    expect(await read(v1Dir, 'anchors.json')).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(await read(v1Dir, 'qa.json')).toEqual(await read(v1Dir, 'anchors.json'));
  });

  it('import refuses the bundle of the other shape, both ways, with the next step; its own shape imports', async () => {
    const a = await importBundle(onV1.t.handle.db, onV1.t.env, onV1.shop.shop.id, TEE, v2Dir).catch((e: unknown) => e);
    expect(a).toMatchObject({ problem: 'shape_mismatch' });
    expect((a as Error).message).toMatch(/male body v1 \(MALE_SHAPE\)/);
    const b = await importBundle(onV2.t.handle.db, onV2.t.env, onV2.shop.shop.id, TEE, v1Dir).catch((e: unknown) => e);
    expect(b).toMatchObject({ problem: 'shape_mismatch' });
    expect((b as Error).message).toMatch(/male body v2 \(MALE_SHAPE\).*--male-shape=v2/);
    expect((await tryAsset(onV1)).comingSoon).toBe(true);
    expect((await tryAsset(onV2)).comingSoon).toBe(true);

    const one = await importBundle(onV1.t.handle.db, onV1.t.env, onV1.shop.shop.id, TEE, v1Dir);
    const two = await importBundle(onV2.t.handle.db, onV2.t.env, onV2.shop.shop.id, TEE, v2Dir);
    expect(assetMaleShape(one.asset)).toBe('v1');
    expect(assetMaleShape(two.asset)).toBe('v2');
    await approveAsset(onV1.t.handle.db, onV1.shop.shop.id, one.asset.id, 'test');
    await approveAsset(onV2.t.handle.db, onV2.shop.shop.id, two.asset.id, 'test');
    expect(await tryAsset(onV1)).toMatchObject({ status: 200, comingSoon: false, asset: { version: one.asset.version } });
    expect(await tryAsset(onV2)).toMatchObject({ status: 200, comingSoon: false, asset: { version: two.asset.version } });
  });

  it('an approved bundle is not handed out once the deployment draws the other shape (the switch was flipped after the import)', async () => {
    const product = (await onV1.t.handle.db.query.products.findFirst({ where: (p, { and: both, eq: is }) => both(is(p.shopId, onV1.shop.shop.id), is(p.externalId, TEE)) }))!;
    const shop = (await onV1.t.handle.db.query.shops.findFirst({ where: (s, { eq: is }) => is(s.id, onV1.shop.shop.id) }))!;
    expect(await activeAssetRef(onV1.t.handle.db, onV1.t.env, shop, product, SYNTHETIC_MENS_TEE)).not.toBeNull();
    expect(await activeAssetRef(onV1.t.handle.db, { ...onV1.t.env, MALE_SHAPE: 'v2' }, shop, product, SYNTHETIC_MENS_TEE)).toBeNull();
  });
});
