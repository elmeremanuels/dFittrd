/**
 * Male shape v2 (`buildMannequin(shape, { maleShape: 'v2' })`, src/maleV2.ts): every ring girth on
 * the mesh within 0.5 % of the table, closed parts, the female family and the default (v1) male
 * body untouched, and the shape properties v2 is for, measured on the mesh: non-elliptical sections
 * at ANSUR II's depth, a V from the deltoids to the seat, a slanted neck base and a crotch with no
 * ledge.
 */
import { createHash } from 'node:crypto';
import { ANCHOR_RINGS } from '@curtain/anchors';
import { describe, expect, it } from 'vitest';
import {
  BODY_SHAPE_IDS,
  CHEST_EXPONENT_LIMIT,
  MALE_BODY_SHAPE_IDS,
  MALE_REFERENCE,
  MALE_SECTION_REFERENCE,
  buildMannequin,
  buildMannequinMesh,
  deltoidBreadthCm,
  familyShape,
  fitRing,
  loopAround,
  loopLength,
  maleRingFits,
  mannequinAnchorsJson,
  meshRingCircumference,
  shapeForBody,
  slice,
  superellipsePerimeter,
  topology,
  type Mannequin,
  type Mesh,
} from './index';

const GIRTH_TOLERANCE = 0.005;
const sha = (m: Mesh) => createHash('sha256').update(Buffer.from(m.positions.buffer)).update(Buffer.from(m.indices.buffer)).digest('hex');
const v2 = (id: (typeof MALE_BODY_SHAPE_IDS)[number]) => {
  const mannequin = buildMannequin(familyShape('male', id)!, { maleShape: 'v2' });
  return { mannequin, mesh: buildMannequinMesh(mannequin) };
};

/** Vertices of one part. */
function partVertices(mesh: Mesh, part: string): [number, number, number][] {
  const k = mesh.partNames.indexOf(part);
  const out: [number, number, number][] = [];
  for (let i = 0; i < mesh.vertexPart.length; i++) if (mesh.vertexPart[i] === k) out.push([mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!]);
  return out;
}

/** Breadth (max − min x) and depth (max − min z) of the torso's loop on the mesh at height y. */
function torsoLoopExtent(mesh: Mesh, y: number): { breadth: number; depth: number; zFront: number; zBack: number; length: number } {
  const k = mesh.partNames.indexOf('torso');
  const loop = loopAround(slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] }, (t) => mesh.vertexPart[mesh.indices[3 * t]!] === k), [0, y, 0], [1, 0, 0], [0, 0, 1])!;
  const xs = loop.points.map((p) => p[0]);
  const zs = loop.points.map((p) => p[2]);
  return { breadth: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs), zFront: Math.max(...zs), zBack: Math.min(...zs), length: loopLength(loop) };
}

/** Front-view breadth of torso and legs at height y: twice the largest |x| of their loops in the horizontal plane there. */
function silhouetteBreadth(mesh: Mesh, y: number): number {
  const parts = ['torso', 'leg_l', 'leg_r'].map((p) => mesh.partNames.indexOf(p));
  const loops = slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] }, (t) => parts.includes(mesh.vertexPart[mesh.indices[3 * t]!]!));
  return 2 * Math.max(0, ...loops.flatMap((l) => l.points.map((p) => Math.abs(p[0]))));
}

describe('superellipse rings fitted to ANSUR II', () => {
  it('superellipsePerimeter is the ellipse at p = 2 and grows towards the rectangle', () => {
    expect(superellipsePerimeter(10, 10, 2, 4000)).toBeCloseTo(2 * Math.PI * 10, 2);
    expect(superellipsePerimeter(10, 5, 3)).toBeGreaterThan(superellipsePerimeter(10, 5, 2));
    expect(superellipsePerimeter(10, 5, 40, 8000)).toBeLessThan(60);
    expect(superellipsePerimeter(10, 5, 40, 8000)).toBeGreaterThan(57);
  });

  it('fits the waist and seat by their exponent alone and the chest by its exponent limit and a wider breadth', () => {
    for (const r of Object.values(MALE_SECTION_REFERENCE)) {
      const w = fitRing(r.waistBreadth, r.waistDepth, r.waistGirth, 4);
      expect(w.p).toBeGreaterThan(2.4);
      expect(w.p).toBeLessThan(3);
      expect(w.W).toBe(r.waistBreadth);
      expect(superellipsePerimeter(w.W / 2, w.D / 2, w.p)).toBeCloseTo(r.waistGirth, 3);
      const h = fitRing(r.hipBreadth, r.buttockDepth, r.hipGirth, 4);
      expect(h.p).toBeGreaterThan(3);
      expect(h.p).toBeLessThan(4);
      // ANSUR's chest breadth and depth cannot reach the chest girth as a superellipse with p ≤ CHEST_EXPONENT_LIMIT: the breadth grows.
      const c = fitRing(r.chestBreadth, r.chestDepth, r.chest);
      expect(c.p).toBe(CHEST_EXPONENT_LIMIT);
      expect(c.D).toBe(r.chestDepth);
      expect(c.W).toBeGreaterThan(r.chestBreadth);
      expect(superellipsePerimeter(c.W / 2, c.D / 2, c.p)).toBeCloseTo(r.chest, 3);
    }
  });

  it('holds the fits at the ends of the table and interpolates them by chest girth', () => {
    expect(maleRingFits(60)).toEqual(maleRingFits(90));
    expect(maleRingFits(200)).toEqual(maleRingFits(123));
    const mid = maleRingFits(94).waist.p;
    expect(mid).toBeGreaterThan(Math.min(maleRingFits(90).waist.p, maleRingFits(98).waist.p) - 1e-12);
    expect(mid).toBeLessThan(Math.max(maleRingFits(90).waist.p, maleRingFits(98).waist.p) + 1e-12);
  });
});

describe('the option leaves everything else alone', () => {
  it('a female shape with maleShape v2 is the same bytes as without it', () => {
    for (const id of BODY_SHAPE_IDS) {
      const shape = familyShape('female', id)!;
      for (const head of [undefined, 'neutral', 'neutral-v2'] as const) {
        expect(sha(buildMannequinMesh(buildMannequin(shape, { maleShape: 'v2' }), head ? { head } : {}))).toBe(sha(buildMannequinMesh(buildMannequin(shape), head ? { head } : {})));
      }
      expect(buildMannequin(shape, { maleShape: 'v2' }).maleShape).toBeUndefined();
    }
  });

  it('the default male body is v1 (no outlines) and maleShape v1 is the default', () => {
    for (const id of MALE_BODY_SHAPE_IDS) {
      const shape = familyShape('male', id)!;
      const m = buildMannequin(shape);
      expect(m.maleShape).toBeUndefined();
      expect(m.parts.every((p) => p.sections.every((s) => s.outline === undefined))).toBe(true);
      expect(sha(buildMannequinMesh(buildMannequin(shape, { maleShape: 'v1' })))).toBe(sha(buildMannequinMesh(m)));
    }
  });
});

describe.each(MALE_BODY_SHAPE_IDS)('male %s, shape v2', (id) => {
  const { mannequin, mesh } = v2(id);
  const v1 = buildMannequin(familyShape('male', id)!);
  const v1mesh = buildMannequinMesh(v1);
  const ref = MALE_REFERENCE[id];
  const sec = MALE_SECTION_REFERENCE[id];

  it('is watertight with five closed parts, also with both heads', () => {
    const t = topology(mesh);
    expect(t.watertight).toBe(true);
    expect(t.components).toBe(5);
    expect(t.triangles).toBeLessThanOrEqual(30000);
    for (const head of ['neutral', 'neutral-v2'] as const) {
      const h = topology(buildMannequinMesh(mannequin, { head }));
      expect(h.boundaryEdges + h.nonManifoldEdges + h.inconsistentEdges, head).toBe(0);
      expect(h.volumes.every((v) => v > 0), head).toBe(true);
      expect(h.components, head).toBe(6);
    }
  });

  it(`keeps every ring girth on the mesh within ${GIRTH_TOLERANCE * 100} % of the table, at the v1 ring heights`, () => {
    expect(mannequin.maleShape).toBe('v2');
    for (const r of mannequin.rings) {
      const old = v1.rings.find((x) => x.id === r.id)!;
      expect(r.circumferenceCm).toBe(old.circumferenceCm);
      expect(r.centre[1]).toBe(old.centre[1]);
      expect(mannequin.morphHeights[r.id]).toBe(v1.morphHeights[r.id]);
      const measured = meshRingCircumference(mesh, r)!;
      expect(Math.abs(measured / r.circumferenceCm - 1), r.id).toBeLessThan(GIRTH_TOLERANCE);
      const loop = loopAround(slice(mesh.positions, mesh.indices, { origin: r.centre, normal: r.normal }), r.centre, r.u, r.v)!;
      expect(Math.abs(loopLength(loop) / r.circumferenceCm - 1), r.id).toBeLessThan(GIRTH_TOLERANCE);
    }
    expect(mannequin.rings.map((r) => r.id)).toEqual([...ANCHOR_RINGS]);
    for (const r of Object.values(mannequinAnchorsJson(mannequin, mesh).rings)) expect(Math.abs(r.meshCircumferenceCm! / r.circumferenceCm - 1)).toBeLessThan(GIRTH_TOLERANCE);
  });

  it('keeps the lengths and the arm frames of v1; the deltoid cap adds at most 0.15 cm to the breadth over the deltoids', () => {
    expect(mannequin.lengths).toEqual(v1.lengths);
    expect(mannequin.arms).toEqual(v1.arms);
    const extra = deltoidBreadthCm(mannequin) - ref.bideltoid;
    expect(extra).toBeGreaterThanOrEqual(0);
    expect(extra).toBeLessThan(0.15);
    expect(mannequin.statureCm).toBe(v1.statureCm);
  });

  it('has a chest of ANSUR depth, not the v1 barrel: much shallower and about as broad at the same girth', () => {
    const y = mannequin.morphHeights.chest;
    const a = torsoLoopExtent(mesh, y);
    const b = torsoLoopExtent(v1mesh, y);
    // ANSUR chest depth at this size, plus at most the pectoral relief.
    expect(Math.abs(a.depth - sec.chestDepth)).toBeLessThan(1.5);
    expect(a.depth).toBeLessThan(b.depth - 3);
    expect(Math.abs(a.breadth - b.breadth)).toBeLessThan(2);
    // Waist and seat: ANSUR breadth (scaled to the table girth) within 1.5 cm.
    const w = torsoLoopExtent(mesh, mannequin.morphHeights.waist);
    expect(Math.abs(w.breadth - sec.waistBreadth * (ref.waist / sec.waistGirth))).toBeLessThan(1.5);
    const h = torsoLoopExtent(mesh, mannequin.morphHeights.hip);
    expect(Math.abs(h.breadth - sec.hipBreadth * (ref.hip / sec.hipGirth))).toBeLessThan(1.5);
    // The seat lies behind: more of the seat's depth is at the back than at the front.
    expect(-h.zBack).toBeGreaterThan(h.zFront + 2);
  });

  it('tapers from the deltoids to the seat more than v1 (front view)', () => {
    const hipY = mannequin.morphHeights.hip;
    const ratio = (m: Mannequin, me: Mesh) => deltoidBreadthCm(m) / silhouetteBreadth(me, hipY);
    expect(ratio(mannequin, mesh)).toBeGreaterThan(ratio(v1, v1mesh) + 0.05);
    // The lats: the torso is broader just under the armpit than at the waist.
    const ax = torsoLoopExtent(mesh, mannequin.morphHeights.chest + 2.5).breadth;
    expect(ax).toBeGreaterThan(torsoLoopExtent(mesh, mannequin.morphHeights.waist).breadth - (id === 'XXL' || id === 'XL' ? 4 : 0));
  });

  it('has a slanted neck base: the front of the torso reaches the neck lower than the back', () => {
    const { shoulder, neck } = mannequin.morphHeights;
    const y = shoulder + 0.5 * (neck - shoulder);
    const e = torsoLoopExtent(mesh, y);
    expect(-e.zBack).toBeGreaterThan(e.zFront + 1);
  });

  it('joins torso and legs with no ledge: the front-view breadth changes smoothly from the thigh ring to the seat', () => {
    const lo = mannequin.morphHeights.thigh;
    const hi = mannequin.morphHeights.hip;
    let prev = silhouetteBreadth(mesh, lo);
    for (let y = lo + 0.5; y <= hi; y += 0.5) {
      const b = silhouetteBreadth(mesh, y);
      expect(Math.abs(b - prev), `at ${y.toFixed(1)} cm`).toBeLessThan(0.8);
      prev = b;
    }
    // No part of the torso hangs below the crotch outside the thighs, and it ends above the thigh ring.
    const torso = partVertices(mesh, 'torso');
    expect(Math.min(...torso.map((p) => p[1]))).toBeGreaterThan(lo);
  });

  it('moves the legs in under the seat and keeps the arms off the torso at the chest, underbust and waist rings', () => {
    expect(mannequin.landmarks.legX).toBeLessThanOrEqual(v1.landmarks.legX + 1e-9);
    for (const r of mannequin.rings.filter((x) => x.part === 'leg_l')) expect(r.centre[0]).toBeCloseTo(mannequin.landmarks.legX, 9);
    for (const ringId of ['chest', 'underbust', 'waist'] as const) {
      const r = mannequin.rings.find((x) => x.id === ringId)!;
      const loops = slice(mesh.positions, mesh.indices, { origin: r.centre, normal: r.normal });
      const torso = loopAround(loops, r.centre, r.u, r.v)!;
      const maxX = Math.max(...torso.points.map((p) => Math.abs(p[0])));
      for (const l of loops.filter((x) => x !== torso)) expect(Math.min(...l.points.map((p) => Math.abs(p[0])))).toBeGreaterThan(maxX);
    }
  });

  it('torsoAt and legAt contain the outline (for collision), and the same shape gives the same bytes', () => {
    for (const s of mannequin.parts[0]!.sections) {
      const e = mannequin.torsoAt(s.centre[1])!;
      expect(e).not.toBeNull();
      const o = s.outline;
      if (!o) continue;
      for (let j = 0; j < o.length; j += 2) expect(Math.hypot(o[j]! / e.a, o[j + 1]! / e.b)).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(sha(buildMannequinMesh(v2(id).mannequin))).toBe(sha(mesh));
  });
});

describe('shape v2 for typed measurements', () => {
  it('builds closed bodies with exact rings across the range a shopper can type', () => {
    const inputs = [
      { family: 'male' as const },
      { family: 'male' as const, chest: 84, waist: 70, hip: 86, heightCm: 160 },
      { family: 'male' as const, chest: 101, waist: 92, hip: 99, heightCm: 188, shoulderCm: 46 },
      { family: 'male' as const, chest: 135, waist: 130, hip: 125, heightCm: 182 },
      { family: 'male' as const, chest: 100, waist: 76, hip: 104, heightCm: 176 },
    ];
    for (const input of inputs) {
      const m = buildMannequin(shapeForBody(input), { maleShape: 'v2' });
      const mesh = buildMannequinMesh(m);
      const t = topology(mesh);
      expect(t.boundaryEdges + t.nonManifoldEdges + t.inconsistentEdges, JSON.stringify(input)).toBe(0);
      expect(t.volumes.every((v) => v > 0)).toBe(true);
      for (const r of m.rings) expect(Math.abs(meshRingCircumference(mesh, r)! / r.circumferenceCm - 1), `${r.id} ${JSON.stringify(input)}`).toBeLessThan(GIRTH_TOLERANCE);
    }
  });
});
