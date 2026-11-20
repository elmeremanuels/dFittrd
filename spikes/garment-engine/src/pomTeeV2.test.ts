/**
 * The POM tee built on the male shape v2 (`buildPomBundle(…, { maleShape: 'v2' })`): on the SYNTHETIC tee
 * measurements (not a product) every input is within 0.25 cm of the tape in every size on its own v2 table body
 * (built on the ellipses round the v2 sections the hem missed by up to 3.3 cm), no size is tighter than its body, the
 * bundle states the shape it was built on, and every size reaches the device as built (`GradingJson.built`).
 * The bundle built on v1 is byte for byte what it was before the builder learned about v2.
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { MALE_REFERENCE, buildBody, buildMannequin, familyShape, topology } from '@curtain/mannequin';
import { bundleMaleShape, checkGarmentBundle, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { buildBundle } from './bundle';
import { assignChains } from './garment';
import { applyGrading, builtOffsets, encodeBuiltOffsets } from './grading';
import { BUILT_QUANTUM_CM, POM_KEYS, buildPomBundle, pomErrors, torsoTapeAt, type PomBundle } from './pomBundle';
import { pomBody } from './pomBody';
import { buildPomTee, measurePomTee, shoulderSeamBumpCm } from './pomTee';
import { SYNTHETIC_TEE_POM } from './pomTeeSynthetic';

const sha = (d: string | Uint8Array): string => createHash('sha256').update(d).digest('hex');
const tableBody = (id: keyof typeof MALE_REFERENCE, shape: 'v1' | 'v2' = 'v2') => {
  const r = MALE_REFERENCE[id];
  return buildBody({ family: 'male', bust: r.chest, waist: r.waist, hip: r.hip, heightCm: r.stature, shoulderCm: r.shoulderWidth }, shape === 'v2' ? { maleShape: 'v2' } : {});
};

let v2: PomBundle;
beforeAll(() => {
  v2 = buildPomBundle(SYNTHETIC_MENS_TEE.id, SYNTHETIC_MENS_TEE, SYNTHETIC_TEE_POM, 'M', { maleShape: 'v2' });
}, 240_000);

describe('the POM tee built on the male shape v2', () => {
  it('reads the drawn body: only a v2 body has an outline reader; its armpit is the drawn one', () => {
    expect(pomBody(buildMannequin(familyShape('male', 'M')!))).toBeNull();
    const m = buildMannequin(familyShape('male', 'M')!, { maleShape: 'v2' });
    const b = pomBody(m)!;
    expect(pomBody(m)).toBe(b);
    // The torso's section at the seat: its hull is the hip girth, where the ellipses' hull is 10 cm longer.
    const pts = b.sectionPoints(m.morphHeights.hip);
    expect(pts.length).toBeGreaterThan(90);
    // On the chest ring, 1 cm outside the body in front and 1 cm inside.
    const y = m.morphHeights.chest;
    const o = m.outlines!.torso(y)!;
    const front = o.r[24]!;
    expect(b.torsoDistance([0, y, o.cz + front + 1])).toBeGreaterThan(0.8);
    expect(b.torsoDistance([0, y, o.cz + front + 1])).toBeLessThan(1.05);
    expect(b.torsoDistance([0, y, o.cz + front - 1])).toBeLessThan(-0.8);
    expect(b.torsoDistance([0, m.statureCm + 20, 0])).toBe(Infinity);
    expect(b.armpitY).toBeGreaterThan(m.morphHeights.chest - 2);
    expect(b.armpitY).toBeLessThan(m.morphHeights.shoulder - 8);
    expect(b.armTopS).toBeLessThan(0);
    expect(b.armRadius(m.arms.left, 20, 0)).toBeCloseTo(m.armAt(20, 1)!.a, 0);
  });

  it('every size on its own v2 table body: every input within 0.25 cm of the tape, nothing tighter than the body, no bump on the shoulder seam, one welded piece without a degenerate edge', () => {
    // Measured 19 Nov 2026, S … XXL: max 0.13 / 0.14 / 0.16 / 0.14 / 0.17 cm (the chest; the hem −0.05). Built on the
    // ellipses round the v2 sections: hem +3.09 / +3.03 / +2.67 / +2.78 / +3.25, XXL waist +1.08, 9 to 18 rows tighter than the body.
    for (const t of v2.tape) {
      expect(t.body, t.size).toBe(`male ${t.size} (shape v2)`);
      expect(t.maxAbsCm, t.size).toBeLessThanOrEqual(0.25);
      expect(t.tight, t.size).toEqual([]);
      for (const k of POM_KEYS) expect(Math.abs(t.errorCm[k] ?? 0), `${t.size} ${k}`).toBeLessThanOrEqual(0.25);
    }
    expect(shoulderSeamBumpCm(v2.base)).toBeLessThan(0.1);
    const h = topology(v2.base.mesh);
    expect(h.nonManifoldEdges).toBe(0);
    expect(h.inconsistentEdges).toBe(0);
    expect(h.triangles).toBeLessThanOrEqual(15000);
    // The armhole's first row and the tube's top row were 0.11 cm apart at the armpit (v1: 0.24): now one vertex.
    const P = v2.base.mesh.positions, I = v2.base.mesh.indices;
    let shortest = Infinity;
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = I[t + e]!, b = I[t + ((e + 1) % 3)]!;
      shortest = Math.min(shortest, Math.hypot(P[3 * a]! - P[3 * b]!, P[3 * a + 1]! - P[3 * b + 1]!, P[3 * a + 2]! - P[3 * b + 2]!));
    }
    expect(shortest).toBeGreaterThan(0.4);
  });

  it('the bundle states the shape in anchors.json and qa.json; the shared gate admits it for the v2 body only, and the v1 bundle for the v1 body only', () => {
    const meta = (b: { files: Record<string, string | Uint8Array> }) => ({ anchors: JSON.parse(b.files['anchors.json'] as string), grading: JSON.parse(b.files['grading.json'] as string), material: JSON.parse(b.files['material.json'] as string), qa: JSON.parse(b.files['qa.json'] as string) });
    const m2 = meta(v2);
    expect(m2.anchors.mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male', maleShape: 'v2' });
    expect(m2.qa.mannequin).toEqual(m2.anchors.mannequin);
    expect(m2.qa.pomTape).toMatchObject({ pass: true });
    expect(bundleMaleShape(m2)).toBe('v2');
    const sizes = SYNTHETIC_MENS_TEE.sizeChart.map((r) => r.size);
    expect(checkGarmentBundle(m2, sizes, { family: 'male', maleShape: 'v2' })).toMatchObject({ ok: true, info: { family: 'male', maleShape: 'v2', qaFlags: ['tape_built_no_chart_check'] } });
    expect(checkGarmentBundle(m2, sizes, { family: 'male', maleShape: 'v1' })).toEqual({ ok: false, problem: 'shape_mismatch' });
    const v1 = buildBundle('synthetic-men-tee', { skipSeparation: true });
    const m1 = meta(v1);
    expect(m1.anchors.mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(m1.grading.built).toBeUndefined();
    expect(checkGarmentBundle(m1, sizes, { family: 'male', maleShape: 'v1' })).toMatchObject({ ok: true });
    expect(checkGarmentBundle(m1, sizes, { family: 'male', maleShape: 'v2' })).toEqual({ ok: false, problem: 'shape_mismatch' });
    // Byte for byte the bundle of before this builder knew v2 (sha256 of the files built on commit e7e0413).
    expect(sha(v1.files['base.glb'])).toBe('b966d34f36f3fda597fc8787846419b44f16d61519dd77805356ed2aac644678');
    expect(sha(v1.files['anchors.json'])).toBe('8a59a0cf7ed98b6f963f152a738db2ad17bdf9cc4752c677fd7cc12e32568965');
    expect(sha(v1.files['grading.json'])).toBe('ff3a415f75e57f30dbc60be193026784f33bfb6a6b76f892e2deeb9c7ae4c911');
    expect(sha(v1.files['qa.json'])).toBe('1762e5355ca703e06a410c30198d80c16f4f3aa71ed91dec57c7e441b566214f');
  }, 240_000);

  it('every size reaches the device as built: the offsets decode to the size built on its own body (0.005 cm), taped there within 0.25 cm; the armhole grows with the body, which the morph does not do', () => {
    const g = v2.grading;
    const n = v2.base.mesh.positions.length / 3;
    expect(g.built).toMatchObject({ encoding: 'int16le-base64', quantumCm: BUILT_QUANTUM_CM, vertices: n });
    expect(Object.keys(g.built!.offsets)).toEqual(['S', 'L', 'XL', 'XXL']);
    expect(g.built!.bodies).toEqual({ S: 'male S (shape v2)', L: 'male L (shape v2)', XL: 'male XL (shape v2)', XXL: 'male XXL (shape v2)' });
    const m = v2.mannequin;
    const chains = assignChains(m, v2.base.mesh);
    for (const check of v2.gradingCheck) for (const [k, v] of Object.entries(check.errorCm)) expect(Math.abs(v!), `${check.size} ${k}`).toBeLessThanOrEqual(0.25);
    const depth = (pos: ArrayLike<number>): number => {
      // The armhole front to back: the sleeve's first ring is the armhole.
      let lo = Infinity, hi = -Infinity;
      for (const i of v2.base.sleeveRings[0][0]!) {
        lo = Math.min(lo, pos[3 * i + 2]!);
        hi = Math.max(hi, pos[3 * i + 2]!);
      }
      return hi - lo;
    };
    const row = SYNTHETIC_TEE_POM[4]!;
    const body = tableBody('XXL');
    const direct = buildPomTee(body, row, { sizeStep: 3, counts: v2.base.counts });
    expect(Array.from(direct.mesh.indices)).toEqual(Array.from(v2.base.mesh.indices));
    const device = applyGrading(m, v2.base.mesh, chains, g, 'XXL');
    const lift = body.morphHeights.shoulder - m.morphHeights.shoulder;
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(device.positions[3 * i]! - direct.mesh.positions[3 * i]!), Math.abs(device.positions[3 * i + 1]! + lift - direct.mesh.positions[3 * i + 1]!), Math.abs(device.positions[3 * i + 2]! - direct.mesh.positions[3 * i + 2]!));
    expect(worst).toBeLessThanOrEqual(BUILT_QUANTUM_CM / 2 + 1e-9);
    // The base size has no offsets: it is the base mesh.
    expect(Array.from(applyGrading(m, v2.base.mesh, chains, g, 'M').positions)).toEqual(Array.from(v2.base.mesh.positions));
    // Without the built sizes the device morphs, as for every other bundle: the armhole then grows 18 % front to back where the built XXL has it 29 % deeper.
    const morphed = applyGrading(m, v2.base.mesh, chains, { ...g, built: undefined } as never, 'XXL');
    expect(depth(device.positions) / depth(v2.base.mesh.positions)).toBeGreaterThan(1.25);
    expect(depth(morphed.positions) / depth(v2.base.mesh.positions)).toBeLessThan(1.22);
    // Offsets that do not fit the mesh are not used.
    expect(builtOffsets(g.built, 'XXL', n + 1)).toBeNull();
    expect(builtOffsets(g.built, 'M', n)).toBeNull();
    expect(builtOffsets(undefined, 'XXL', n)).toBeNull();
    expect(Array.from(builtOffsets({ ...g.built!, offsets: { X: encodeBuiltOffsets([0, 0, 0], [1.234, -2, 327], 0.01) }, vertices: 1 }, 'x', 1)!)).toEqual([1.23, -2, 327]);
    expect(() => encodeBuiltOffsets([0], [400], 0.01)).toThrow(RangeError);
    // The tape of the size as built with the base's counts, on its own body.
    const errs = pomErrors(row, measurePomTee(body, direct, torsoTapeAt));
    expect(Math.max(...Object.values(errs).map((v) => Math.abs(v!)))).toBeLessThanOrEqual(0.25);
  }, 240_000);
});
