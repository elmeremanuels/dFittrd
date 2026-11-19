/**
 * POST /v1/renders/realism (D22): flag off by default, render passes only (never a photo), the
 * fidelity checks refuse an image that lies, and every answer carries the AI-enhanced estimate label.
 */
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_ENHANCED_LABEL, ESTIMATE_DISCLAIMER, RealismResponseSchema } from '@curtain/schema';
import { encodeMask, encodeRgba, FakeRealismProvider, syntheticPasses, type FakeRealismMode, type RenderPasses } from '@curtain/tryon-providers';
import { ledgerEntries } from './db/schema.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');

async function wirePasses(p: RenderPasses): Promise<Record<string, unknown>> {
  return {
    kind: 'renderPasses',
    width: p.width,
    height: p.height,
    colourPng: b64(await encodeRgba(p.colour)),
    depthPng: b64(await encodeMask(p.depth)),
    normalPng: b64(await encodeRgba(p.normal)),
    garmentMaskPng: b64(await encodeMask(p.garmentMask)),
    figureMaskPng: b64(await encodeMask(p.figureMask)),
    ...(p.neighbour ? { neighbour: { size: p.neighbour.size, garmentMaskPng: b64(await encodeMask(p.neighbour.garmentMask)) } } : {}),
    meta: { statureCm: p.meta.statureCm, waistRow: p.meta.waistRow, hipRow: p.meta.hipRow, backdropHex: p.meta.backdropHex, garmentHex: p.meta.garmentHex },
  };
}

describe('env: the fake adapter never reaches production', () => {
  it('refuses AI_REALISM with the fake provider in production', async () => {
    const { loadEnv } = await import('./env.js');
    expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), SHOP_KEY_PEPPER: 'p'.repeat(20), ENCRYPTION_KEY: 'a'.repeat(64), AI_REALISM: '1' })).toThrow(/fake/);
  });
});

describe('POST /v1/renders/realism with the flag off (default)', () => {
  it('does not exist and never calls a provider', async () => {
    const fake = new FakeRealismProvider();
    const t = await makeApp({}, { realism: fake });
    try {
      expect(t.env.AI_REALISM).toBe(false);
      const s = await seedShop(t);
      const d = await createDevice(t);
      const res = await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: { shopId: s.shop.id, productId: 'aalter-studio-1', size: 'M' } });
      expect(res.statusCode).toBe(404);
      expect(fake.calls).toHaveLength(0);
    } finally {
      await t.close();
    }
  });
});

describe('POST /v1/renders/realism with AI_REALISM=1', () => {
  const fake = { mode: 'faithful' as FakeRealismMode };
  // One provider whose behaviour each test sets: it delegates to a fresh FakeRealismProvider.
  const calls: unknown[] = [];
  const provider = {
    name: 'fake-realism',
    models: ['fake-realism-v0'],
    capabilities: new FakeRealismProvider().capabilities,
    estimateCostUsd: () => 0,
    enhance: (input: Parameters<FakeRealismProvider['enhance']>[0]) => {
      calls.push(input);
      return new FakeRealismProvider({ mode: fake.mode }).enhance(input);
    },
  };
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  let body: (passes?: RenderPasses) => Promise<Record<string, unknown>>;
  beforeAll(async () => {
    t = await makeApp({ AI_REALISM: '1', AI_REALISM_RATE_LIMIT_PER_MIN: '200' }, { realism: provider });
    s = await seedShop(t);
    body = async (passes = syntheticPasses({ neighbour: { size: 'L', grow: 10, longer: 14 } })) => ({
      shopId: s.shop.id,
      productId: 'aalter-studio-1',
      size: 'M',
      passes: await wirePasses(passes),
      consent: { tier: 'heroOptIn', ack: true, acknowledgedAt: new Date().toISOString() },
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('returns the checked image, labelled an AI-enhanced estimate, and writes one ledger line', async () => {
    fake.mode = 'faithful';
    const d = await createDevice(t);
    const res = await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: await body() });
    expect(res.statusCode).toBe(200);
    const r = RealismResponseSchema.parse(res.json());
    expect(r.status).toBe('ok');
    expect(r.label).toBe(AI_ENHANCED_LABEL);
    expect(r.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    if (r.status === 'ok') {
      expect(r.metrics.silhouetteIoU).toBeGreaterThan(0.95);
      expect(r.metrics.sizeSeparation).toMatchObject({ neighbour: 'L', ok: true });
      const meta = await sharp(Buffer.from(r.imageBase64, 'base64')).metadata();
      expect(meta).toMatchObject({ format: 'png', width: 384, height: 576 });
    }
    const ledger = await t.handle.db.select().from(ledgerEntries);
    const line = ledger.find((l) => l.inputs?.includes('renderPasses'));
    expect(line?.payloadSummary.fields).not.toContain('person');
    expect(line?.payloadSummary.provider).toBe('fake-realism');
  });

  it('refuses, labelled, an image that moved the hem or changed the colour', async () => {
    const d = await createDevice(t);
    fake.mode = 'move-hem';
    const hem = RealismResponseSchema.parse((await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: await body() })).json());
    expect(hem).toMatchObject({ status: 'refused', label: AI_ENHANCED_LABEL, disclaimer: ESTIMATE_DISCLAIMER });
    if (hem.status === 'refused') expect(hem.reasons).toContain('hem');
    fake.mode = 'recolour';
    const red = RealismResponseSchema.parse((await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: await body(syntheticPasses({ garmentHex: '#B0303A' })) })).json());
    expect(red).toMatchObject({ status: 'refused', label: AI_ENHANCED_LABEL });
    if (red.status === 'refused') expect(red.reasons).toContain('colour');
    expect(JSON.stringify(red)).not.toContain('imageBase64');
  });

  it('accepts no photo: no person/photo/face field, and a camera-like picture in the colour pass is refused before any provider call', async () => {
    const d = await createDevice(t);
    const ok = await body();
    const before = calls.length;
    for (const extra of [{ person: { kind: 'userPhoto', imageBase64: 'AAAA' } }, { photo: 'AAAA' }, { faceImageBase64: 'AAAA' }]) {
      const res = await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: { ...ok, ...extra } });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
    }
    const inPasses = await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: { ...ok, passes: { ...(ok.passes as object), photoPng: 'AAAA' } } });
    expect(inPasses.statusCode).toBe(400);
    const wrongKind = await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: { ...ok, passes: { ...(ok.passes as object), kind: 'userPhoto' } } });
    expect(wrongKind.statusCode).toBe(400);

    // A photo-like colour pass: textured background, no flat backdrop.
    const photo = syntheticPasses();
    for (let i = 0; i < photo.width * photo.height; i++) {
      photo.colour.data[4 * i] = (i * 13) % 256;
      photo.colour.data[4 * i + 1] = (i * 7) % 256;
    }
    const res = await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: await body(photo) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('not_a_render');
    // A JPEG instead of PNG passes is refused too.
    const jpeg = (await sharp({ create: { width: 384, height: 576, channels: 3, background: '#777777' } }).jpeg().toBuffer()).toString('base64');
    const j = await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: { ...ok, passes: { ...(ok.passes as object), colourPng: jpeg } } });
    expect(j.statusCode).toBe(422);
    expect(calls.length).toBe(before);
  });

  it('needs a device, consent and a known product', async () => {
    const d = await createDevice(t);
    const ok = await body();
    expect((await t.app.inject({ method: 'POST', url: '/v1/renders/realism', payload: ok })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: { ...ok, consent: { tier: 'heroOptIn', ack: false, acknowledgedAt: new Date().toISOString() } } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: '/v1/renders/realism', headers: d.auth, payload: { ...ok, productId: 'nope' } })).statusCode).toBe(404);
  });
});
