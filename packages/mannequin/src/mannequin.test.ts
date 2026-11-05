import { createHash } from 'node:crypto';
import { ANCHOR_RINGS, NOMINAL_RING_HEIGHTS, ellipseCircumference, gradingMorph } from '@curtain/anchors';
import { describe, expect, it } from 'vitest';
import {
  BODY_SHAPE_IDS,
  bodyShape,
  buildMannequin,
  buildMannequinMesh,
  loopAround,
  loopLength,
  mannequinAnchorsJson,
  meshRingCircumference,
  polygonCompensation,
  polygonPerimeter,
  slice,
  stations,
  topology,
  vertexNormals,
  writeGlb,
} from './index';

const build = (id: (typeof BODY_SHAPE_IDS)[number]) => {
  const mannequin = buildMannequin(bodyShape(id));
  return { mannequin, mesh: buildMannequinMesh(mannequin) };
};

const glbOf = (id: (typeof BODY_SHAPE_IDS)[number]) => {
  const { mesh } = build(id);
  return writeGlb([{ name: id, positions: mesh.positions, normals: vertexNormals(mesh), indices: mesh.indices }], { scale: 0.01 });
};

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

describe.each(BODY_SHAPE_IDS)('mannequin %s', (id) => {
  const { mannequin, mesh } = build(id);

  it('is watertight: closed, manifold, consistently oriented, five positive-volume parts', () => {
    const t = topology(mesh);
    expect(t.boundaryEdges).toBe(0);
    expect(t.nonManifoldEdges).toBe(0);
    expect(t.inconsistentEdges).toBe(0);
    expect(t.degenerateTriangles).toBe(0);
    expect(t.components).toBe(5);
    expect(t.eulerCharacteristics).toEqual([2, 2, 2, 2, 2]);
    expect(t.volumes.every((v) => v > 0)).toBe(true);
    expect(t.watertight).toBe(true);
  });

  it('stays inside the 8–20k triangle budget', () => {
    const t = topology(mesh);
    expect(t.triangles).toBeGreaterThanOrEqual(8000);
    expect(t.triangles).toBeLessThanOrEqual(20000);
  });

  it('has all 12 anchor rings, each within 1% of the table girth on the mesh', () => {
    expect(mannequin.rings.map((r) => r.id)).toEqual([...ANCHOR_RINGS]);
    for (const r of mannequin.rings) {
      expect(r.circumferenceCm).toBe(bodyShape(id).rings[r.id].circumferenceCm);
      expect(ellipseCircumference(r.a, r.b)).toBeCloseTo(r.circumferenceCm, 9);
      const measured = meshRingCircumference(mesh, r);
      expect(measured).not.toBeNull();
      expect(Math.abs(measured! / r.circumferenceCm - 1)).toBeLessThan(0.01);
    }
  });

  it('finds every ring on the whole mesh too (smallest loop around the centre, other parts in the plane)', () => {
    for (const r of mannequin.rings) {
      const loop = loopAround(slice(mesh.positions, mesh.indices, { origin: r.centre, normal: r.normal }), r.centre, r.u, r.v);
      expect(loop, r.id).not.toBeNull();
      expect(Math.abs(loopLength(loop!) / r.circumferenceCm - 1)).toBeLessThan(0.01);
    }
  });

  it('places the body rings at the nominal heights of @curtain/anchors and keeps the limbs off the torso rings', () => {
    for (const r of mannequin.rings.filter((x) => x.part !== 'arm_l')) expect(r.centre[1]).toBeCloseTo(NOMINAL_RING_HEIGHTS[r.id] * mannequin.statureCm, 9);
    // At chest, underbust and waist height the arms are outside the torso (the torso loop is clean).
    for (const id of ['chest', 'underbust', 'waist'] as const) {
      const r = mannequin.rings.find((x) => x.id === id)!;
      const loops = slice(mesh.positions, mesh.indices, { origin: r.centre, normal: r.normal });
      const torso = loopAround(loops, r.centre, r.u, r.v)!;
      const maxX = Math.max(...torso.points.map((p) => Math.abs(p[0])));
      const armLoops = loops.filter((l) => l !== torso);
      for (const l of armLoops) expect(Math.min(...l.points.map((p) => Math.abs(p[0])))).toBeGreaterThan(maxX);
    }
  });

  it('exposes morph heights that drive @curtain/anchors grading through the mannequin rings', () => {
    const base = { chest: 92, waist: 74 };
    const morph = gradingMorph(base, { chest: 96, waist: 78 }, { heights: mannequin.morphHeights });
    expect(morph.girthScaleAt(mannequin.morphHeights.chest)).toBeCloseTo(96 / 92, 12);
    expect(morph.girthScaleAt(mannequin.morphHeights.waist)).toBeCloseTo(78 / 74, 12);
  });

  it('has length lines with positive body lengths in a sensible order', () => {
    const L = Object.fromEntries(mannequin.lengths.map((l) => [l.id, l.bodyLengthCm]));
    expect(Object.keys(L).sort()).toEqual(['inseam', 'rise', 'shoulder_to_hem', 'shoulder_to_waist', 'sleeve', 'waist_to_hem']);
    expect(L.shoulder_to_waist!).toBeGreaterThan(25);
    expect(L.shoulder_to_hem!).toBeGreaterThan(L.waist_to_hem!);
    expect(L.inseam! + L.rise!).toBeCloseTo(L.waist_to_hem!, 9);
    expect(L.sleeve!).toBeGreaterThan(45);
  });

  it('writes anchors.json with the measured girths', () => {
    const json = mannequinAnchorsJson(mannequin, mesh);
    expect(Object.keys(json.rings)).toEqual([...ANCHOR_RINGS]);
    for (const r of Object.values(json.rings)) expect(Math.abs(r.meshCircumferenceCm! - r.circumferenceCm)).toBeLessThan(0.01 * r.circumferenceCm + 1e-9);
    expect(json.rings.chest?.source).toBe('table');
    expect(json.rings.thigh?.source).toBe('proportion');
    expect(json.mesh.triangles).toBe(mesh.indices.length / 3);
  });
});

describe('shapes', () => {
  it('grow from XS to XXL at every ring', () => {
    for (const ring of ANCHOR_RINGS) {
      const g = BODY_SHAPE_IDS.map((id) => bodyShape(id).rings[ring].circumferenceCm);
      expect(g[0]!).toBeLessThan(g[1]!);
      expect(g[1]!).toBeLessThan(g[2]!);
    }
  });
});

describe('determinism', () => {
  it('builds the same bytes for the same shape (same input → same hash)', () => {
    for (const id of BODY_SHAPE_IDS) expect(sha(glbOf(id))).toBe(sha(glbOf(id)));
    const a = build('M');
    const b = build('M');
    expect(sha(JSON.stringify(mannequinAnchorsJson(a.mannequin, a.mesh)))).toBe(sha(JSON.stringify(mannequinAnchorsJson(b.mannequin, b.mesh))));
  });

  it('gives different bytes for different shapes', () => {
    expect(sha(glbOf('XS'))).not.toBe(sha(glbOf('XXL')));
  });
});

describe('helpers', () => {
  it('polygon compensation makes the inscribed polygon as long as the ellipse', () => {
    for (const [a, b, n] of [[10, 7, 48], [5, 5, 24], [20, 10, 32]] as const) {
      const k = polygonCompensation(a, b, n);
      expect(k).toBeGreaterThan(1);
      expect(polygonPerimeter(a * k, b * k, n)).toBeCloseTo(ellipseCircumference(a, b), 9);
    }
  });

  it('stations include every required value exactly and run in the asked direction', () => {
    const up = stations(0, 10, 1, [3.3, 7.05]);
    expect(up).toContain(3.3);
    expect(up).toContain(7.05);
    expect(up[0]).toBe(0);
    expect(up[up.length - 1]).toBe(10);
    expect([...up].sort((p, q) => p - q)).toEqual(up);
    const down = stations(10, 0, 1, [3.3]);
    expect(down[0]).toBe(10);
    expect(down).toContain(3.3);
  });
});
