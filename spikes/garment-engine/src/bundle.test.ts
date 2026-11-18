import { createHash } from 'node:crypto';
import { MALE_REFERENCE, glbFloatAccessor, readGlb } from '@curtain/mannequin';
import { SYNTHETIC_MENS_TEE, bundleMannequinFamily, checkGarmentBundle } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { buildBundle, mannequinFor } from './bundle';
import { SPIKE_PRODUCT_IDS, spikeProduct } from './product';

const sha = (d: Uint8Array | string) => createHash('sha256').update(d).digest('hex');

describe.each(SPIKE_PRODUCT_IDS)('bundle %s', (id) => {
  const a = buildBundle(id, { skipSeparation: true });

  it('is deterministic: same input → same bytes for every file', () => {
    const b = buildBundle(id, { skipSeparation: true });
    for (const name of Object.keys(a.files) as (keyof typeof a.files)[]) expect(sha(b.files[name]), name).toBe(sha(a.files[name]));
  });

  it('writes the four bundle files plus qa.json, under the 3 MB budget', () => {
    expect(Object.keys(a.files).sort()).toEqual(['anchors.json', 'base.glb', 'grading.json', 'material.json', 'qa.json']);
    const bytes = Object.values(a.files).reduce((n, d) => n + (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength), 0);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it('has a readable base.glb in metres', () => {
    const glb = readGlb(a.files['base.glb']);
    const pos = glbFloatAccessor(glb, glb.json.meshes[0]!.primitives[0]!.attributes.POSITION!);
    expect(pos.length).toBe(a.baseMesh.positions.length);
    expect(Math.max(...Array.from(pos).filter((_, i) => i % 3 === 1))).toBeLessThan(2);
    expect(glb.json.asset.extras).toMatchObject({ productId: id, synthetic: true });
  });

  it('anchors.json carries loops, girths, chart values and the calibration; qa.json passes chart agreement', () => {
    const anchors = JSON.parse(a.files['anchors.json']);
    expect(anchors.synthetic).toBe(true);
    expect(anchors.rings.chest.loop).toHaveLength(32);
    expect(Math.abs(anchors.rings.chest.circumferenceCm - anchors.rings.chest.chartCm)).toBeLessThan(2);
    expect(anchors.calibration.globalScale).toBeGreaterThan(0.9);
    expect(anchors.inputHash).toMatch(/^[0-9a-f]{64}$/);
    const qa = JSON.parse(a.files['qa.json']);
    expect(qa.chartAgreement.pass).toBe(true);
    expect(qa.meshHealth.nonManifoldEdges).toBe(0);
    expect(qa.separation).toBeNull();
  });

  it('material.json comes from the fabric library', () => {
    const mat = JSON.parse(a.files['material.json']);
    expect(mat.format).toBe('curtain.garment.material');
    expect(mat.fabricLibraryVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(mat.fibres[0].id).toBe('cotton');
  });

  it('changes the input hash when the input changes', () => {
    const other = buildBundle(id, { skipSeparation: true, sample: { chest: 101 } });
    expect(JSON.parse(other.files['anchors.json']).inputHash).not.toBe(JSON.parse(a.files['anchors.json']).inputHash);
  });
});

describe('the body family in the bundle (men-3d-plan slice M1)', () => {
  // sha256 (first 16 hex) of the female bundles as built before M1 (`out/` of 18 Nov 2026, the same bytes):
  // writing the family only for the male body leaves every female file, and so every female asset version, unchanged.
  const BEFORE_M1: Record<string, Record<string, string>> = {
    'aalter-studio-2': { 'base.glb': '37c0822cb7524f0e', 'anchors.json': '450075f158ed56bb', 'grading.json': '7f8cf2e48a33e2d7', 'material.json': 'ddf478e551cfcc3b', 'qa.json': '36c519bafdd86b88' },
    'monochrome-03': { 'base.glb': '5b0a7eec72c7e733', 'anchors.json': '7a516a8271fa7328', 'grading.json': '6206acfd362f065d', 'material.json': '4301c8bb072a6034', 'qa.json': '20cd0128fc220a63' },
  };
  it.each(SPIKE_PRODUCT_IDS)('a female bundle (%s) is byte for byte what it was before M1 and names no family', (id) => {
    const b = buildBundle(id, { skipSeparation: true });
    for (const [name, want] of Object.entries(BEFORE_M1[id]!)) expect(sha(b.files[name as keyof typeof b.files]).slice(0, 16), `${id} ${name}`).toBe(want);
    expect(JSON.parse(b.files['anchors.json']).mannequin).toEqual({ version: '0.1.0', shape: 'M' });
    expect(JSON.parse(b.files['qa.json'])).not.toHaveProperty('mannequin');
    expect(bundleFamilyOfMeta(b)).toBe('female');
    expect(mannequinFor(spikeProduct(id)).shape.family).toBe('female');
  });

  it('the SYNTHETIC men’s tee is built on the male M, names the family in anchors.json and qa.json, and passes the shared check for a men’s product only', () => {
    const b = buildBundle('synthetic-men-tee', { skipSeparation: true });
    expect(b.mannequin.shape.family).toBe('male');
    expect(b.mannequin.statureCm).toBe(MALE_REFERENCE.M.stature);
    const anchors = JSON.parse(b.files['anchors.json']);
    const qa = JSON.parse(b.files['qa.json']);
    expect(anchors.mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(qa.mannequin).toEqual(anchors.mannequin);
    expect(anchors.synthetic).toBe(true);
    expect(qa.chartAgreement.pass).toBe(true);
    expect(qa.meshHealth.nonManifoldEdges).toBe(0);
    expect(bundleFamilyOfMeta(b)).toBe('male');
    const meta = { anchors, grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa };
    const sizes = SYNTHETIC_MENS_TEE.sizeChart.map((r) => r.size);
    expect(checkGarmentBundle(meta, sizes, { family: 'male' })).toMatchObject({ ok: true, info: { family: 'male', sizes } });
    expect(checkGarmentBundle(meta, sizes, { family: 'female' })).toEqual({ ok: false, problem: 'family_mismatch' });
    // The family enters the input hash for the male body only.
    expect(anchors.inputHash).not.toBe(JSON.parse(buildBundle('monochrome-03', { skipSeparation: true }).files['anchors.json']).inputHash);
    expect(mannequinFor(SYNTHETIC_MENS_TEE).shape.family).toBe('male');
    expect(mannequinFor({ audience: 'unisex' }).shape.family).toBe('female');
  });
});

function bundleFamilyOfMeta(b: { files: { 'anchors.json': string; 'qa.json': string } }): string | null {
  return bundleMannequinFamily({ anchors: JSON.parse(b.files['anchors.json']), qa: JSON.parse(b.files['qa.json']) });
}
