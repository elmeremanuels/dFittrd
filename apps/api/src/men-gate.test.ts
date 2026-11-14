/**
 * The men's gate (decision D20 point 3, docs/research/men-3d-plan.md slice M0, services/readiness.ts).
 *
 * Two apps with the same catalogue: one with the gate off (the default), one with MEN_3D_GATE=1.
 *  - off: a men's product behaves exactly like any other product on every route;
 *  - on: a men's product without the full 3D experience answers "coming soon" on every route that
 *    serves product or fit data, with no garment, no pairing, no size and no bill;
 *  - on: women's, unisex and audience-less products answer the same bodies as with the gate off;
 *  - a `men` read from a title or a collection only is not gated; men's shoes and accessories
 *    follow their own switch; a men's product with an approved male bundle passes, in the overlay only.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENS_OXFORD_SHIRT, MENS_STRAIGHT_JEANS, MOCK_GARMENTS, MOCK_GARMENTS_BY_ID, fromShopifyProduct, type AudienceDecision, type GarmentPayload } from '@curtain/schema';
import { garmentAssets, pairings, products, renderJobs, shops, trySessions, usageEvents, wardrobeItems } from './db/schema.js';
import { loadEnv } from './env.js';
import { approveAsset, importBundle } from './services/assets.js';
import { upsertProduct } from './services/products.js';
import { menGateScope } from './services/readiness.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const SITE = 'https://noordman.example';
const PAGE = `${SITE}/products/oxford`;
const MEN = MENS_OXFORD_SHIRT.id;
const WOMEN = 'aalter-women';
const UNISEX = 'aalter-unisex';
const NO_AUDIENCE = 'aalter-studio-1';
const MEN_SHOES = 'noordman-shoes';

const base = MOCK_GARMENTS_BY_ID[NO_AUDIENCE]!;
const shoes = MOCK_GARMENTS.find((g) => g.category === 'shoes')!;
const CATALOGUE: GarmentPayload[] = [
  base,
  { ...base, id: WOMEN, audience: 'women' },
  { ...base, id: UNISEX, audience: 'unisex' },
  MENS_OXFORD_SHIRT,
  MENS_STRAIGHT_JEANS,
  { ...shoes, id: MEN_SHOES, audience: 'men' },
];

interface World {
  t: TestApp;
  shop: Awaited<ReturnType<typeof seedShop>>;
  ids: Record<string, string>;
}

async function world(env: Record<string, string>): Promise<World> {
  const assetDir = await mkdtemp(join(tmpdir(), 'curtain-men-gate-'));
  const t = await makeApp({ ASSET_DIR: assetDir, TRY_RATE_LIMIT_PER_MIN: '1000', SDK_RATE_LIMIT_PER_MIN: '1000', K_ANON: '1', RENDERS_DIR: join(assetDir, 'renders'), ...env });
  const shop = await seedShop(t, { domain: 'noordman.example', name: 'Noordman', products: [] });
  await t.handle.db.update(shops).set({ settings: { ...shop.shop.settings, siteUrl: SITE } }).where(eq(shops.id, shop.shop.id));
  const ids: Record<string, string> = {};
  for (const g of CATALOGUE) ids[g.id] = (await upsertProduct(t.handle.db, shop.shop.id, g.id, g)).product.id;
  return { t, shop, ids };
}

const mint = (w: World, product: string, surface: 'embed' | 'button' = 'embed') =>
  w.t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', headers: { origin: SITE }, payload: { shopKeyPrefix: w.shop.publicKeyPrefix, productExternalId: product, pageUrl: PAGE, surface } });
const tokenOf = (res: { json: <T>() => T }): string => res.json<{ embedUrl: string }>().embedUrl.split('/embed/')[1]!;
const resolve = (w: World, token: string, auth: Record<string, string>) => w.t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: auth });
const peek = (w: World, product: string, auth: Record<string, string>) =>
  w.t.app.inject({ method: 'GET', url: `/v1/peek?${new URLSearchParams({ shop: w.shop.publicKeyPrefix, product, page: PAGE }).toString()}`, headers: auth });
const deck = (w: World, auth: Record<string, string>) => w.t.app.inject({ method: 'GET', url: `/v1/shops/${w.shop.shop.id}/products?limit=50`, headers: auth });
const productGet = (w: World, product: string, auth: Record<string, string>) => w.t.app.inject({ method: 'GET', url: `/v1/products/${product}?shopId=${w.shop.shop.id}`, headers: auth });
const cohort = (w: World, product: string, auth: Record<string, string>) => w.t.app.inject({ method: 'GET', url: `/v1/fit/cohort/${product}?shopId=${w.shop.shop.id}`, headers: auth });
const merchantList = (w: World) => w.t.app.inject({ method: 'GET', url: '/v1/merchant/products?limit=50', headers: { authorization: `Bearer ${w.shop.apiKey}` } });

let heroImage: string;
const hero = (w: World, product: string, auth: Record<string, string>) =>
  w.t.app.inject({
    method: 'POST',
    url: '/v1/renders/hero',
    headers: auth,
    payload: {
      productId: product,
      shopId: w.shop.shop.id,
      size: 'M',
      person: { kind: 'avatarRender', mimeType: 'image/png', imageBase64: heroImage, width: 512, height: 768 },
      consent: { tier: 'heroOptIn', ack: true, acknowledgedAt: new Date().toISOString() },
    },
  });

async function pairedDevice(w: World) {
  const d = await createDevice(w.t);
  await w.t.handle.db.insert(pairings).values({ deviceId: d.deviceId, shopId: w.shop.shop.id, pseudonym: `ps_${d.deviceId.slice(0, 8)}`, source: 'embed', pairedAt: new Date() });
  return d;
}

/** One wardrobe row, so the cohort has something to show (K_ANON is 1 in these apps). */
async function wear(w: World, product: string, deviceId: string) {
  await w.t.handle.db.insert(wardrobeItems).values({ deviceId, shopId: w.shop.shop.id, productId: product, size: 'M', state: 'kept', updatedAt: new Date() });
}

/** A bundle directory for a product; `male` writes the mannequin family the gate reads (qa.json). */
async function bundleFor(g: GarmentPayload, male: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'curtain-men-bundle-'));
  const sizes = g.sizeChart.map((r) => r.size);
  await writeFile(join(dir, 'base.glb'), Buffer.from(`glTF-fake-${g.id}-${male}`));
  await writeFile(join(dir, 'anchors.json'), JSON.stringify({ format: 'curtain.garment.anchors', baseSize: sizes[0] }));
  await writeFile(join(dir, 'grading.json'), JSON.stringify({ format: 'curtain.garment.grading', baseSize: sizes[0], sizes: sizes.map((size) => ({ size })) }));
  await writeFile(join(dir, 'material.json'), JSON.stringify({ format: 'curtain.garment.material' }));
  await writeFile(join(dir, 'qa.json'), JSON.stringify({ format: 'curtain.garment.qa', chartAgreement: { pass: true }, ...(male ? { mannequin: { family: 'male' } } : {}) }));
  return dir;
}

/** Bodies without the values that differ per run (ids, tokens, timestamps). */
function stable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v: unknown) => {
      if (['id', 'tryUrl', 'embedUrl', 'expiresAt', 'intentToken', 'pairedAt', 'updatedAt', 'shopId', 'jobId'].includes(key)) return `<${key}>`;
      return v;
    }),
  );
}

describe("men's gate (D20 point 3, slice M0)", () => {
  let off: World;
  let on: World;
  beforeAll(async () => {
    heroImage = (await sharp({ create: { width: 512, height: 768, channels: 3, background: '#F5EFE7' } }).png().toBuffer()).toString('base64');
    off = await world({});
    on = await world({ MEN_3D_GATE: '1' });
  }, 120_000);
  afterAll(async () => {
    await off.t.close();
    await on.t.close();
  });

  it('the flag is read in env.ts and is off by default, in production too', () => {
    expect(off.t.env.MEN_3D_GATE).toBe(false);
    expect(off.t.env.MEN_3D_GATE_SHOES_ACCESSORIES).toBe(false);
    const prod = loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), SHOP_KEY_PEPPER: 'p'.repeat(20), ENCRYPTION_KEY: 'a'.repeat(64) });
    expect(prod.MEN_3D_GATE).toBe(false);
    expect(prod.MEN_3D_GATE_SHOES_ACCESSORIES).toBe(false);
    expect(on.t.env.MEN_3D_GATE).toBe(true);
  });

  describe('gate off: a men’s product is served like any other', () => {
    it('sessions, try, peek, deck, product, hero render and cohort all answer as today', async () => {
      const d = await pairedDevice(off);
      const session = await mint(off, MEN);
      expect(session.statusCode).toBe(200);
      expect(session.json()).not.toHaveProperty('productState');
      const tried = await resolve(off, tokenOf(session), d.auth);
      expect(tried.statusCode).toBe(200);
      expect(tried.json<{ garment: { id: string; audience: string } }>().garment).toMatchObject({ id: MEN, audience: 'men' });
      expect(tried.json()).not.toHaveProperty('requires3d');
      expect((await peek(off, MEN, d.auth)).statusCode).toBe(200);
      expect((await deck(off, d.auth)).json<{ items: Array<{ id: string }> }>().items.map((g) => g.id)).toContain(MEN);
      expect((await productGet(off, MEN, d.auth)).statusCode).toBe(200);
      expect((await hero(off, MEN, d.auth)).statusCode).toBe(202);
      await wear(off, MEN, d.deviceId);
      expect((await cohort(off, MEN, d.auth)).json()).toMatchObject({ n: 1, sizeHistogram: { M: 1 } });
      for (const item of (await merchantList(off)).json<{ items: object[] }>().items) expect(item).not.toHaveProperty('menGate');
    });
  });

  describe('gate on: a men’s product without the full 3D experience is coming soon on every route', () => {
    it('POST /v1/sdk/sessions still mints the session and says coming_soon', async () => {
      const session = await mint(on, MEN);
      expect(session.statusCode).toBe(200);
      expect(session.json<{ productState?: string; embedUrl: string }>().productState).toBe('coming_soon');
      expect(session.json<{ embedUrl: string }>().embedUrl).toContain('/embed/');
      // app mode (QR, deep link) too
      expect((await mint(on, MENS_STRAIGHT_JEANS.id, 'button')).json<{ productState?: string }>().productState).toBe('coming_soon');
    });

    it('GET /v1/try/:token answers 422 men_coming_soon: no garment, no pairing, session not resolved', async () => {
      const d = await createDevice(on.t);
      const token = tokenOf(await mint(on, MEN));
      const res = await resolve(on, token, d.auth);
      expect(res.statusCode).toBe(422);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('men_coming_soon');
      expect(res.body).not.toContain('sizeChart');
      expect(res.body).not.toContain('garment');
      expect(await on.t.handle.db.select().from(pairings).where(eq(pairings.deviceId, d.deviceId))).toHaveLength(0);
      const sessions = await on.t.handle.db.select().from(trySessions).where(eq(trySessions.productId, on.ids[MEN]!));
      expect(sessions.every((s) => s.resolvedAt === null && s.deviceId === null)).toBe(true);
    });

    it('POST /v1/try/:token/fit-shown never bills a product that turned coming soon after it was resolved', async () => {
      const d = await createDevice(on.t);
      // Resolved while the audience was not set, then the sync says "men".
      await on.t.handle.db.update(products).set({ payload: { ...MENS_STRAIGHT_JEANS, audience: undefined } }).where(eq(products.id, on.ids[MENS_STRAIGHT_JEANS.id]!));
      const token = tokenOf(await mint(on, MENS_STRAIGHT_JEANS.id));
      const tried = await resolve(on, token, d.auth);
      expect(tried.statusCode).toBe(200);
      await on.t.handle.db.update(products).set({ payload: MENS_STRAIGHT_JEANS }).where(eq(products.id, on.ids[MENS_STRAIGHT_JEANS.id]!));
      const shown = await on.t.app.inject({
        method: 'POST',
        url: `/v1/try/${token}/fit-shown`,
        headers: d.auth,
        payload: { intentToken: tried.json<{ trySession: { intentToken: string } }>().trySession.intentToken, recommendedSize: 'M', confidence: 0.8 },
      });
      expect(shown.statusCode).toBe(200);
      expect(shown.json()).toEqual({ billed: false });
      expect(await on.t.handle.db.select().from(usageEvents).where(and(eq(usageEvents.deviceId, d.deviceId), eq(usageEvents.kind, 'fit_session')))).toHaveLength(0);
    });

    it('GET /v1/peek answers 404 (no 2D figure, no size next to the button)', async () => {
      const d = await pairedDevice(on);
      expect((await peek(on, MEN, d.auth)).statusCode).toBe(404);
      expect((await peek(on, NO_AUDIENCE, d.auth)).statusCode).toBe(200);
    });

    it('GET /v1/shops/:shopId/products leaves it out; GET /v1/products/:id answers 422', async () => {
      const d = await pairedDevice(on);
      const ids = (await deck(on, d.auth)).json<{ items: Array<{ id: string }> }>().items.map((g) => g.id);
      expect(ids).not.toContain(MEN);
      expect(ids).not.toContain(MENS_STRAIGHT_JEANS.id);
      expect(ids).toEqual(expect.arrayContaining([NO_AUDIENCE, WOMEN, UNISEX, MEN_SHOES]));
      const res = await productGet(on, MEN, d.auth);
      expect(res.statusCode).toBe(422);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('men_coming_soon');
      expect((await on.t.app.inject({ method: 'GET', url: `/v1/products/${on.ids[MEN]!}`, headers: d.auth })).statusCode).toBe(422);
    });

    it('POST /v1/renders/hero answers 422 and queues nothing', async () => {
      const d = await createDevice(on.t);
      const res = await hero(on, MEN, d.auth);
      expect(res.statusCode).toBe(422);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('men_coming_soon');
      expect(await on.t.handle.db.select().from(renderJobs).where(eq(renderJobs.deviceId, d.deviceId))).toHaveLength(0);
      expect((await hero(on, WOMEN, d.auth)).statusCode).toBe(202);
    });

    it('GET /v1/fit/cohort/:productId answers the empty cohort (no size histogram)', async () => {
      const d = await pairedDevice(on);
      await wear(on, MEN, d.deviceId);
      await wear(on, WOMEN, d.deviceId);
      expect((await cohort(on, MEN, d.auth)).json()).toEqual({ productId: MEN, n: 0, kAnonymityFloor: 1, sizeHistogram: {}, keptRate: null });
      expect((await on.t.app.inject({ method: 'GET', url: `/v1/fit/cohort/${MEN}`, headers: d.auth })).json<{ n: number }>().n).toBe(0);
      expect((await cohort(on, WOMEN, d.auth)).json()).toMatchObject({ n: 1, sizeHistogram: { M: 1 } });
    });

    it('GET /v1/merchant/products marks it for the merchant, and only it', async () => {
      const items = (await merchantList(on)).json<{ items: Array<{ externalId: string; menGate?: string }> }>().items;
      const gate = Object.fromEntries(items.map((i) => [i.externalId, i.menGate]));
      expect(gate[MEN]).toBe('coming_soon');
      expect(gate[WOMEN]).toBeUndefined();
      expect(gate[UNISEX]).toBeUndefined();
      expect(gate[NO_AUDIENCE]).toBeUndefined();
      expect(gate[MEN_SHOES]).toBeUndefined();
    });
  });

  describe('gate on: women’s, unisex and audience-less products are unchanged', () => {
    it.each([WOMEN, UNISEX, NO_AUDIENCE])('%s answers the same bodies as with the gate off', async (product) => {
      const bodies = async (w: World) => {
        const d = await pairedDevice(w);
        const session = await mint(w, product);
        const tried = await resolve(w, tokenOf(session), d.auth);
        const peeked = await peek(w, product, d.auth);
        const got = await productGet(w, product, d.auth);
        const rendered = await hero(w, product, d.auth);
        const listed = (await merchantList(w)).json<{ items: Array<{ externalId: string }> }>().items.find((i) => i.externalId === product);
        return stable({
          session: [session.statusCode, session.json()],
          tried: [tried.statusCode, tried.json()],
          peeked: [peeked.statusCode, peeked.json()],
          got: [got.statusCode, got.json()],
          rendered: [rendered.statusCode, rendered.json()],
          listed,
        });
      };
      const a = await bodies(off);
      const b = await bodies(on);
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).not.toMatch(/productState|requires3d|menGate|men_coming_soon/);
    });
  });

  describe('weak audience source', () => {
    it('the Shopify mapping reports where the audience was read', () => {
      const seen: Array<AudienceDecision | undefined> = [];
      const node = (over: object) => ({ id: 'gid://shopify/Product/1', title: 'Oxford shirt', ...over });
      fromShopifyProduct(node({ title: "Men's Oxford shirt" }) as never, undefined, { onAudience: (d) => seen.push(d) });
      fromShopifyProduct(node({ productType: 'Menswear' }) as never, undefined, { onAudience: (d) => seen.push(d) });
      fromShopifyProduct(node({}) as never, undefined, { onAudience: (d) => seen.push(d) });
      expect(seen).toEqual([{ audience: 'men', source: 'title' }, { audience: 'men', source: 'productType' }, undefined]);
    });

    it('a men’s product named so only in its title or a collection is not gated until the merchant confirms', async () => {
      const row = (await on.t.handle.db.query.products.findFirst({ where: eq(products.id, on.ids[MEN]!) }))!;
      expect(row.audienceSource).toBeNull(); // the merchant API does not say where the audience came from
      expect(menGateScope(on.t.env, row)).toBe('gated'); // unknown counts as strong
      for (const source of ['title', 'collections'] as const) expect(menGateScope(on.t.env, { ...row, audienceSource: source })).toBe('unconfirmed');
      for (const source of ['override', 'attribute', 'productType', 'category', 'tags'] as const) expect(menGateScope(on.t.env, { ...row, audienceSource: source })).toBe('gated');

      // The sync stores the source; the same content keeps its hash and only the source changes.
      const weak = await upsertProduct(on.t.handle.db, on.shop.shop.id, MEN, MENS_OXFORD_SHIRT, { audienceSource: 'title' });
      expect(weak).toMatchObject({ changed: false, product: { audienceSource: 'title' } });
      try {
        const d = await pairedDevice(on);
        const session = await mint(on, MEN);
        expect(session.json()).not.toHaveProperty('productState');
        const tried = await resolve(on, tokenOf(session), d.auth);
        expect(tried.statusCode).toBe(200);
        expect(tried.json()).not.toHaveProperty('requires3d');
        expect((await peek(on, MEN, d.auth)).statusCode).toBe(200);
        expect((await productGet(on, MEN, d.auth)).statusCode).toBe(200);
        const listed = (await merchantList(on)).json<{ items: Array<{ externalId: string; menGate?: string }> }>().items.find((i) => i.externalId === MEN);
        expect(listed?.menGate).toBe('audience_unconfirmed');

        // The merchant confirms (an override is a strong source): gated again.
        await upsertProduct(on.t.handle.db, on.shop.shop.id, MEN, MENS_OXFORD_SHIRT, { audienceSource: 'override' });
        expect((await mint(on, MEN)).json<{ productState?: string }>().productState).toBe('coming_soon');
      } finally {
        await upsertProduct(on.t.handle.db, on.shop.shop.id, MEN, MENS_OXFORD_SHIRT, { audienceSource: null });
      }
    });

    it('a write that does not know the source keeps it for the same content and clears it for new content', async () => {
      const id = 'noordman-source';
      const g = { ...MENS_OXFORD_SHIRT, id };
      await upsertProduct(on.t.handle.db, on.shop.shop.id, id, g, { audienceSource: 'collections' });
      expect((await upsertProduct(on.t.handle.db, on.shop.shop.id, id, g)).product.audienceSource).toBe('collections');
      expect((await upsertProduct(on.t.handle.db, on.shop.shop.id, id, { ...g, name: 'Oxford shirt, new name' })).product.audienceSource).toBeNull();
      await on.t.handle.db.delete(products).where(and(eq(products.shopId, on.shop.shop.id), eq(products.externalId, id)));
    });
  });

  describe('men’s shoes and accessories (open founder question)', () => {
    it('keep today’s behaviour by default; MEN_3D_GATE_SHOES_ACCESSORIES gates them', async () => {
      const d = await pairedDevice(on);
      const session = await mint(on, MEN_SHOES);
      expect(session.json()).not.toHaveProperty('productState');
      expect((await resolve(on, tokenOf(session), d.auth)).statusCode).toBe(200);

      const row = (await on.t.handle.db.query.products.findFirst({ where: eq(products.id, on.ids[MEN_SHOES]!) }))!;
      expect(menGateScope({ MEN_3D_GATE: true, MEN_3D_GATE_SHOES_ACCESSORIES: false }, row)).toBe('none');
      expect(menGateScope({ MEN_3D_GATE: true, MEN_3D_GATE_SHOES_ACCESSORIES: true }, row)).toBe('gated');
      expect(menGateScope({ MEN_3D_GATE: false, MEN_3D_GATE_SHOES_ACCESSORIES: true }, row)).toBe('none');
      expect(menGateScope({ MEN_3D_GATE: true, MEN_3D_GATE_SHOES_ACCESSORIES: true }, { ...row, payload: { ...row.payload, category: 'accessory' } })).toBe('gated');
    });

    it('with the switch on they are coming soon like men’s clothing', async () => {
      const strict = await world({ MEN_3D_GATE: '1', MEN_3D_GATE_SHOES_ACCESSORIES: '1' });
      try {
        expect((await mint(strict, MEN_SHOES)).json<{ productState?: string }>().productState).toBe('coming_soon');
        const d = await createDevice(strict.t);
        expect((await resolve(strict, tokenOf(await mint(strict, MEN_SHOES)), d.auth)).statusCode).toBe(422);
      } finally {
        await strict.t.close();
      }
    });
  });

  describe('gate on: a men’s product leaves the gate only with an approved male 3D bundle', () => {
    const jeans = MENS_STRAIGHT_JEANS.id;
    const state = async () => (await mint(on, jeans)).json<{ productState?: string }>().productState;

    it('3D off, no bundle, a female bundle: coming soon; a male bundle: ready with requires3d, in the overlay only', async () => {
      const db = on.t.handle.db;
      expect(await state()).toBe('coming_soon'); // the shop has no 3D estimate
      await db.update(shops).set({ settings: { ...on.shop.shop.settings, siteUrl: SITE, garment3d: true } }).where(eq(shops.id, on.shop.shop.id));
      expect(await state()).toBe('coming_soon'); // no bundle

      const female = await importBundle(db, on.t.env, on.shop.shop.id, jeans, await bundleFor(MENS_STRAIGHT_JEANS, false));
      expect(await state()).toBe('coming_soon'); // imported, not approved (D13)
      await approveAsset(db, on.shop.shop.id, female.asset.id, 'test');
      expect(await state()).toBe('coming_soon'); // approved, but built on the female mannequin

      const male = await importBundle(db, on.t.env, on.shop.shop.id, jeans, await bundleFor(MENS_STRAIGHT_JEANS, true));
      await approveAsset(db, on.shop.shop.id, male.asset.id, 'test');
      expect(await state()).toBeUndefined();

      const d = await pairedDevice(on);
      const tried = await resolve(on, tokenOf(await mint(on, jeans)), d.auth);
      expect(tried.statusCode).toBe(200);
      const body = tried.json<{ requires3d?: boolean; asset?: { version: string } | null; garment: { id: string } }>();
      expect(body.requires3d).toBe(true);
      expect(body.asset?.version).toBe(male.asset.version);
      expect(body.garment.id).toBe(jeans);

      // Surfaces without a 3D view never show it: app-mode sessions, the peek, the deck, the product page, the hero render.
      expect((await mint(on, jeans, 'button')).json<{ productState?: string }>().productState).toBe('coming_soon');
      expect((await resolve(on, tokenOf(await mint(on, jeans, 'button')), (await createDevice(on.t)).auth)).statusCode).toBe(422);
      expect((await peek(on, jeans, d.auth)).statusCode).toBe(404);
      expect((await deck(on, d.auth)).json<{ items: Array<{ id: string }> }>().items.map((g) => g.id)).not.toContain(jeans);
      expect((await productGet(on, jeans, d.auth)).statusCode).toBe(422);
      expect((await hero(on, jeans, d.auth)).statusCode).toBe(422);
      const listed = (await merchantList(on)).json<{ items: Array<{ externalId: string; menGate?: string }> }>().items.find((i) => i.externalId === jeans);
      expect(listed).not.toHaveProperty('menGate');

      // The merchant switches 3D off again: back to coming soon.
      await db.update(shops).set({ settings: { ...on.shop.shop.settings, siteUrl: SITE, garment3d: false } }).where(eq(shops.id, on.shop.shop.id));
      expect(await state()).toBe('coming_soon');
      expect(await db.select().from(garmentAssets).where(eq(garmentAssets.productId, on.ids[jeans]!))).toHaveLength(2);
    });
  });
});
