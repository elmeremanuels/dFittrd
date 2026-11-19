/**
 * The POM tee builder (men-3d-plan slice M3, the tee proof) on the SYNTHETIC tee measurements (not a
 * product): one welded piece, every input measurement on the built mesh within 0.5 cm of the tape in
 * every size, the device's grading of the base within 0.5 cm too, and a bundle the shared gate admits
 * for a men's product only, flagged as built from the tape.
 */
import { describe, expect, it } from 'vitest';
import { bundleMannequinFamily, checkGarmentBundle, garmentQaFlags, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { buildMannequin, familyShape, topology } from '@curtain/mannequin';
import { buildPomBundle, POM_KEYS, POM_TAPE_TOLERANCE_CM, torsoTapeAt } from './pomBundle';
import { buildPomTee, measurePomTee } from './pomTee';
import { SYNTHETIC_TEE_POM } from './pomTeeSynthetic';

const male = buildMannequin(familyShape('male', 'M')!);

/** Boundary loops of a mesh (edges used by one triangle, chained). */
function boundaryLoops(indices: Uint32Array): number {
  const uses = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = indices[t + e]!, b = indices[t + ((e + 1) % 3)]!;
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  const adj = new Map<number, number[]>();
  for (const [k, n] of uses) if (n === 1) {
    const [a, b] = k.split(',').map(Number) as [number, number];
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set<number>();
  let loops = 0;
  for (const v of adj.keys()) {
    if (seen.has(v)) continue;
    loops++;
    const stack = [v];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const y of adj.get(x) ?? []) if (!seen.has(y)) stack.push(y);
    }
  }
  return loops;
}

describe('POM tee builder', () => {
  it('builds one welded, manifold, consistently wound piece with four openings (neck, hem, two sleeves) within the triangle budget', () => {
    const b = buildPomTee(male, SYNTHETIC_TEE_POM[1]!);
    const h = topology(b.mesh);
    expect(h.nonManifoldEdges).toBe(0);
    expect(h.inconsistentEdges).toBe(0);
    expect(h.triangles).toBeLessThanOrEqual(15000);
    expect(boundaryLoops(b.mesh.indices)).toBe(4);
    // The sleeve is sewn to the armhole: its first ring is the torso's own vertices, so the shoulder point is shared.
    expect(b.sleeveTop[0][0]).toBe(b.shoulderPoint[0]);
    expect(b.mesh.vertexPart[b.shoulderPoint[0]]).toBe(0);
  });

  it('measures every input within 0.5 cm on the base size (its own tape)', () => {
    const row = SYNTHETIC_TEE_POM[1]!;
    const b = buildPomTee(male, row);
    const got = measurePomTee(male, b, torsoTapeAt);
    for (const k of POM_KEYS) expect(Math.abs((got[k] as number) - (row[k] as number)), k).toBeLessThanOrEqual(POM_TAPE_TOLERANCE_CM);
  });

  it('as a bundle: every size within 0.5 cm on its own table body (M3 gate), the device grading of the base within 0.5 cm, a men-only bundle flagged as built from the tape', () => {
    const b = buildPomBundle(SYNTHETIC_MENS_TEE.id, SYNTHETIC_MENS_TEE, SYNTHETIC_TEE_POM);
    expect(b.tape.map((t) => t.size)).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
    for (const t of b.tape) expect(t.maxAbsCm, t.size).toBeLessThanOrEqual(POM_TAPE_TOLERANCE_CM);
    for (const g of b.gradingCheck) for (const [k, v] of Object.entries(g.errorCm)) expect(Math.abs(v!), `${g.size} ${k}`).toBeLessThanOrEqual(POM_TAPE_TOLERANCE_CM);
    const qa = JSON.parse(b.files['qa.json']);
    expect(qa.pomTape.pass).toBe(true);
    expect(qa.chartAgreement).toMatchObject({ kind: 'tape-built', pass: true });
    expect(garmentQaFlags(qa)).toEqual(['tape_built_no_chart_check']);
    const meta = { anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa };
    expect(bundleMannequinFamily(meta)).toBe('male');
    const sizes = SYNTHETIC_MENS_TEE.sizeChart.map((r) => r.size);
    expect(checkGarmentBundle(meta, sizes, { family: 'male' })).toMatchObject({ ok: true, info: { family: 'male', qaFlags: ['tape_built_no_chart_check'] } });
    expect(checkGarmentBundle(meta, sizes, { family: 'female' })).toEqual({ ok: false, problem: 'family_mismatch' });
    // The shoulder points are the mesh's own vertices, at ±shoulder / 2.
    const seams = meta.anchors.breadths.shoulder_width.seams as number[][];
    expect(seams[0]![0]! - seams[1]![0]!).toBeCloseTo(44, 1);
    // A small bundle: under 200 KB in all.
    const bytes = Object.values(b.files).reduce((n, d) => n + (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength), 0);
    expect(bytes).toBeLessThan(200_000);
  }, 120_000);
});
