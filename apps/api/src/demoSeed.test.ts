import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { seedDemo } from './demoSeed.js';
import { makeApp, type TestApp } from './test/helpers.js';

describe('local demo seed (docs/STANDALONE.md §4)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('seeds Aalter Studio on both platforms with ≥ 8 active dresses, tops and bottoms; idempotent', async () => {
    const first = await seedDemo(t.handle.db, t.env);
    expect(first.shops.map((s) => [s.name, s.platform])).toEqual([
      ['Aalter Studio', 'woocommerce'],
      ['Aalter Studio (Shopify)', 'shopify'],
    ]);
    for (const shop of first.shops) {
      expect(shop.publicKey).toMatch(/^pk_test_[A-Za-z0-9]{6,32}$/);
      expect(shop.products.length).toBeGreaterThanOrEqual(8);
      expect(shop.products.every((p) => p.status === 'active')).toBe(true);
      expect(shop.products.map((p) => p.category)).toEqual(expect.arrayContaining(['dress', 'top', 'bottom']));
      expect(shop.allowedOrigins).toEqual(expect.arrayContaining(['http://localhost:5180', 'http://localhost:3000']));
    }
    expect(first.publicKey).toBe(first.shops[0]!.publicKey);
    // UX-3: product photos come from the demo storefront, never a third-party placeholder host.
    for (const p of first.shops.flatMap((s) => s.products)) expect(p.photo).toBe(`http://localhost:5180/img/${p.externalId}.svg`);
    expect(first.productExternalIds).toContain('aalter-studio-1');

    const again = await seedDemo(t.handle.db, t.env);
    expect(again.shops.map((s) => s.publicKey)).toEqual(first.shops.map((s) => s.publicKey));
    expect(again.shops.map((s) => s.shopId)).toEqual(first.shops.map((s) => s.shopId));

    // The seeded key opens an embed session for a seeded product.
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/sdk/sessions',
      payload: { shopKeyPrefix: first.publicKey, productExternalId: first.productExternalIds[0], pageUrl: 'http://localhost:5180/woo/', surface: 'embed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().embedUrl).toContain('/embed/');
  });
});

describe('demo seed 3D bundles (D16): the import gate decides, the expected QA flags must match', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ ASSET_DIR: await mkdtemp(join(tmpdir(), 'curtain-demo-assets-')) });
  });
  afterAll(async () => {
    await t.close();
  });

  const lowRise = { kind: 'low-rise', decision: 'founder, 2026-11-08', offsetCm: 5.08, targetCm: 85.58 };
  /** A bundle for a product that is not a schema fixture (its payload.json), with the given QA. */
  async function bundle(id: string, chartAgreement: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'curtain-demo-bundle-'));
    const g = MOCK_GARMENTS_BY_ID['kaap-bottom-01']!;
    const sizes = g.sizeChart.map((r) => r.size);
    await writeFile(join(dir, 'base.glb'), Buffer.from(`glTF-fake-${id}`));
    await writeFile(join(dir, 'anchors.json'), JSON.stringify({ format: 'curtain.garment.anchors' }));
    await writeFile(join(dir, 'grading.json'), JSON.stringify({ format: 'curtain.garment.grading', baseSize: sizes[0], sizes: sizes.map((size) => ({ size })) }));
    await writeFile(join(dir, 'material.json'), JSON.stringify({ format: 'curtain.garment.material' }));
    await writeFile(join(dir, 'qa.json'), JSON.stringify({ format: 'curtain.garment.qa', chartAgreement }));
    await writeFile(join(dir, 'payload.json'), JSON.stringify({ ...g, id, name: `Demo ${id}` }));
    return dir;
  }

  it('approves a low-rise bundle only when low_rise_waist is expected; a refused or unexpectedly flagged bundle leaves the product without 3D', async () => {
    const warnings: string[] = [];
    const m = await seedDemo(t.handle.db, t.env, {
      warn: (w) => warnings.push(w),
      bundles: [
        { shop: 'shopify', externalId: 'demo-low-rise', dir: await bundle('demo-low-rise', { pass: true, toleranceCm: 2, beforeCalibrationMaxAbsCm: 2.49, waistReading: lowRise }), payload: true, colorHex: '#A3243B', colorName: 'Crimson', qaFlags: ['precalibration_outside_tolerance', 'low_rise_waist'] },
        { shop: 'shopify', externalId: 'demo-unexpected-flag', dir: await bundle('demo-unexpected-flag', { pass: true, waistReading: lowRise }), payload: true },
        { shop: 'shopify', externalId: 'demo-flag-missing', dir: await bundle('demo-flag-missing', { pass: true }), payload: true, qaFlags: ['low_rise_waist'] },
        { shop: 'shopify', externalId: 'demo-qa-failed', dir: await bundle('demo-qa-failed', { pass: false }), payload: true, qaFlags: ['low_rise_waist'] },
      ],
    });
    const shop = m.shops.find((s) => s.key === 'shopify')!;
    const by = (id: string) => shop.products.find((p) => p.externalId === id)!;
    // Payload products first, in the order listed.
    expect(shop.products.slice(0, 4).map((p) => p.externalId)).toEqual(['demo-low-rise', 'demo-unexpected-flag', 'demo-flag-missing', 'demo-qa-failed']);
    expect(by('demo-low-rise')).toMatchObject({ asset3d: expect.stringMatching(/^[0-9a-f]{16}$/), asset3dFlags: ['low_rise_waist', 'precalibration_outside_tolerance'], details: { colorways: [{ name: 'Crimson', hex: '#A3243B' }] } });
    for (const id of ['demo-unexpected-flag', 'demo-flag-missing', 'demo-qa-failed']) expect(by(id).asset3d).toBeNull();
    expect(warnings.join('\n')).toMatch(/demo-unexpected-flag: .*QA flags \[low_rise_waist\], expected \[\]/);
    expect(warnings.join('\n')).toMatch(/demo-flag-missing: .*QA flags \[\], expected \[low_rise_waist\]/);
    expect(warnings.join('\n')).toMatch(/demo-qa-failed: bundle rejected: qa_failed/);
  });
});
