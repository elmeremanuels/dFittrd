import { createHash } from 'node:crypto';
import { glbFloatAccessor, readGlb } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { buildBundle } from './bundle';
import { SPIKE_PRODUCT_IDS } from './product';

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
