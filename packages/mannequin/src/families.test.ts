import { createHash } from 'node:crypto';
import { ANCHOR_RINGS, NOMINAL_RING_HEIGHTS, ellipseCircumference } from '@curtain/anchors';
import { describe, expect, it } from 'vitest';
import {
  BODY_FAMILIES,
  BODY_INPUT_LIMITS,
  BODY_SHAPE_IDS,
  FAMILY_BASE_SHAPE_ID,
  FEMALE_SHOULDER_REFERENCE,
  MALE_ASSUMPTIONS,
  MALE_BODY_SHAPE_IDS,
  MALE_LEVELS,
  MALE_REFERENCE,
  MALE_SOURCES,
  MOTION_CLIP,
  NOMINAL_LEVELS,
  TURNTABLE_HEIGHTS,
  armClearanceCm,
  bodyShape,
  buildBody,
  buildMannequin,
  buildMannequinMesh,
  deltoidBreadthCm,
  familyShape,
  familyShapeIds,
  levelWarp,
  loopAround,
  loopLength,
  mannequinAnchorsJson,
  meshRingCircumference,
  poseMesh,
  referenceMeasurements,
  sampleClip,
  shapeForBody,
  skinWeights,
  slice,
  topology,
  turntablePaths,
  vertexNormals,
  writeGlb,
  type BodyShape,
} from './index';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const glbOf = (shape: BodyShape, name = shape.id) => {
  const mesh = buildMannequinMesh(buildMannequin(shape));
  return writeGlb([{ name, positions: mesh.positions, normals: vertexNormals(mesh), indices: mesh.indices }], { scale: 0.01 });
};
const male = (id: (typeof MALE_BODY_SHAPE_IDS)[number]) => {
  const mannequin = buildMannequin(familyShape('male', id)!);
  return { mannequin, mesh: buildMannequinMesh(mannequin) };
};

/** Tolerances of the male family against its reference table (README §Male family). */
const GIRTH_TOLERANCE = 0.005; // 0.5 % of the table girth, measured on the mesh
const LENGTH_TOLERANCE_CM = 0.05;

describe('female family is untouched by the family API', () => {
  // sha256 of the .glb of each female shape as built before the male family was added (the parent of the commit that added it, 0c7510f, where packages/mannequin equals the base branch).
  const GLB_BEFORE = {
    XS: 'e2765fed8cb83151257be96be0130c3ca6e3c3696ca209edc8de2df8a8fd2f4f',
    M: 'f9019aa932cc823b2527a09d787e24cee881f5f530cb587632cfecbd81b7ead1',
    XXL: '56c321dfc7f1432bddd20151f3d9dd4d44356371a982339dd1f547657bbe390c',
  } as const;
  const ANCHORS_BEFORE = {
    XS: '1deca92ec76bde30eab11ce17efe6b58f1abbf9b15716c3eaa984a4b74727ac0',
    M: 'a2ff4c5deb6b3261149d5b21d77fd216d6f71aa4732be65a5c1ec65ad5378aba',
    XXL: '0e7d9a5bd54012361122548a9a972e37467c8e7460d54f325fed642dc9125436',
  } as const;

  it.each(BODY_SHAPE_IDS)('%s: same .glb and anchors.json bytes as before', (id) => {
    const m = buildMannequin(bodyShape(id));
    const mesh = buildMannequinMesh(m);
    expect(sha(glbOf(bodyShape(id)))).toBe(GLB_BEFORE[id]);
    const json = mannequinAnchorsJson(m, mesh);
    expect(sha(JSON.stringify(json))).toBe(ANCHORS_BEFORE[id]);
    expect('family' in json).toBe(false);
  });

  it('familyShape("female", id) is the v0 shape, and the default is the base shape of each family', () => {
    for (const id of BODY_SHAPE_IDS) expect(familyShape('female', id)).toBe(bodyShape(id));
    expect(familyShape('female')).toBe(bodyShape('M'));
    expect(familyShape('male')!.id).toBe(FAMILY_BASE_SHAPE_ID.male);
    expect(familyShapeIds('female')).toEqual([...BODY_SHAPE_IDS]);
    expect(familyShapeIds('male')).toEqual([...MALE_BODY_SHAPE_IDS]);
    expect(familyShape('female', 'L')).toBeUndefined();
    expect(familyShape('male', 'XS')).toBeUndefined();
    expect(familyShape('male', 'constructor')).toBeUndefined();
    expect([...BODY_FAMILIES]).toEqual(['female', 'male']);
    expect(bodyShape('M').family).toBe('female');
    expect(bodyShape('M').levels).toBeUndefined();
  });
});

describe.each(MALE_BODY_SHAPE_IDS)('male %s', (id) => {
  const { mannequin, mesh } = male(id);
  const ref = MALE_REFERENCE[id];
  const shape = familyShape('male', id)!;

  it('is watertight: closed, manifold, consistently oriented, five positive-volume parts, inside the triangle budget', () => {
    const t = topology(mesh);
    expect(t.boundaryEdges).toBe(0);
    expect(t.nonManifoldEdges).toBe(0);
    expect(t.inconsistentEdges).toBe(0);
    expect(t.degenerateTriangles).toBe(0);
    expect(t.components).toBe(5);
    expect(t.eulerCharacteristics).toEqual([2, 2, 2, 2, 2]);
    expect(t.volumes.every((v) => v > 0)).toBe(true);
    expect(t.watertight).toBe(true);
    expect(t.triangles).toBeGreaterThanOrEqual(8000);
    expect(t.triangles).toBeLessThanOrEqual(20000);
  });

  it('carries the reference table in its rings', () => {
    const g = (ring: (typeof ANCHOR_RINGS)[number]) => shape.rings[ring].circumferenceCm;
    expect(shape.family).toBe('male');
    expect(shape.statureCm).toBe(ref.stature);
    expect(g('chest')).toBe(ref.chest);
    expect(g('waist')).toBe(ref.waist);
    expect(g('hip')).toBe(ref.hip);
    expect(g('neck')).toBe(ref.neck);
    expect(g('thigh')).toBe(ref.thigh);
    expect(g('knee')).toBe(ref.lowerThigh);
    expect(g('calf')).toBe(ref.calf);
    expect(g('ankle')).toBe(ref.ankle);
    expect(g('wrist')).toBe(ref.wrist);
    expect(Math.abs(g('upper_arm') - ref.bicepsFlexed * MALE_ASSUMPTIONS.relaxedOverFlexedBiceps)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(g('underbust') - (ref.chest + (ref.waist - ref.chest) * MALE_ASSUMPTIONS.underbustTowardsWaist))).toBeLessThanOrEqual(0.25);
    expect(shape.rings.chest.aspect).toBe(ref.chestAspect);
    expect(shape.rings.waist.aspect).toBe(ref.waistAspect);
    expect(shape.rings.hip.aspect).toBe(ref.hipAspect);
  });

  it(`has all 12 rings, each within ${GIRTH_TOLERANCE * 100} % of the table girth on the mesh`, () => {
    expect(mannequin.rings.map((r) => r.id)).toEqual([...ANCHOR_RINGS]);
    for (const r of mannequin.rings) {
      expect(r.circumferenceCm).toBe(shape.rings[r.id].circumferenceCm);
      expect(ellipseCircumference(r.a, r.b)).toBeCloseTo(r.circumferenceCm, 9);
      const measured = meshRingCircumference(mesh, r);
      expect(measured, r.id).not.toBeNull();
      expect(Math.abs(measured! / r.circumferenceCm - 1), r.id).toBeLessThan(GIRTH_TOLERANCE);
      // The same girth on the whole mesh (other parts in the plane): the smallest loop around the centre.
      const loop = loopAround(slice(mesh.positions, mesh.indices, { origin: r.centre, normal: r.normal }), r.centre, r.u, r.v);
      expect(loop, r.id).not.toBeNull();
      expect(Math.abs(loopLength(loop!) / r.circumferenceCm - 1), r.id).toBeLessThan(GIRTH_TOLERANCE);
    }
  });

  it('matches the table stature, inseam and breadth over the deltoids', () => {
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      top = Math.max(top, mesh.positions[i]!);
      bottom = Math.min(bottom, mesh.positions[i]!);
    }
    expect(Math.abs(top - ref.stature)).toBeLessThan(LENGTH_TOLERANCE_CM);
    expect(Math.abs(bottom)).toBeLessThan(LENGTH_TOLERANCE_CM);
    const inseam = mannequin.lengths.find((l) => l.id === 'inseam')!;
    expect(Math.abs(inseam.bodyLengthCm - ref.inseam)).toBeLessThan(LENGTH_TOLERANCE_CM);
    expect(Math.abs(mannequin.landmarks.crotch[1] - ref.inseam)).toBeLessThan(LENGTH_TOLERANCE_CM);
    expect(Math.abs(deltoidBreadthCm(mannequin) - ref.bideltoid)).toBeLessThan(LENGTH_TOLERANCE_CM);
    expect(referenceMeasurements(shape)).toEqual({ family: 'male', heightCm: ref.stature, chestCm: ref.chest, waistCm: ref.waist, hipCm: ref.hip, shoulderCm: ref.shoulderWidth, inseamCm: ref.inseam, neckCm: ref.neck });
  });

  it('puts the rings at the male levels and keeps the arms off the chest, underbust and waist rings', () => {
    const S = mannequin.statureCm;
    const y = (ring: 'hip' | 'waist' | 'chest' | 'knee' | 'shoulder') => mannequin.rings.find((r) => r.id === ring)!.centre[1];
    for (const k of ['hip', 'waist', 'chest', 'knee', 'shoulder'] as const) expect(y(k)).toBeCloseTo(MALE_LEVELS[k] * S, 9);
    // Above the shoulder ring the body keeps its nominal shares: the neck ring sits 20 % of the way to the top of the head.
    const neckShare = (NOMINAL_RING_HEIGHTS.neck - NOMINAL_RING_HEIGHTS.shoulder) / (1 - NOMINAL_RING_HEIGHTS.shoulder);
    expect(mannequin.rings.find((r) => r.id === 'neck')!.centre[1]).toBeCloseTo((MALE_LEVELS.shoulder + neckShare * (1 - MALE_LEVELS.shoulder)) * S, 9);
    const heights = ['ankle', 'calf', 'knee', 'thigh', 'hip', 'waist', 'underbust', 'chest', 'shoulder', 'neck'].map((k) => mannequin.morphHeights[k as 'hip']);
    for (let i = 1; i < heights.length; i++) expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    expect(mannequin.morphHeights.thigh).toBeLessThan(mannequin.landmarks.crotch[1]);
    for (const ringId of ['chest', 'underbust', 'waist'] as const) {
      const r = mannequin.rings.find((x) => x.id === ringId)!;
      const loops = slice(mesh.positions, mesh.indices, { origin: r.centre, normal: r.normal });
      const torso = loopAround(loops, r.centre, r.u, r.v)!;
      const maxX = Math.max(...torso.points.map((p) => Math.abs(p[0])));
      for (const l of loops.filter((x) => x !== torso)) expect(Math.min(...l.points.map((p) => Math.abs(p[0])))).toBeGreaterThan(maxX);
    }
  });

  it('writes anchors.json with the family and the measured girths', () => {
    const json = mannequinAnchorsJson(mannequin, mesh);
    expect(json.family).toBe('male');
    expect(json.shape).toBe(id);
    for (const r of Object.values(json.rings)) expect(Math.abs(r.meshCircumferenceCm! - r.circumferenceCm)).toBeLessThan(GIRTH_TOLERANCE * r.circumferenceCm + 1e-9);
    expect(json.rings.chest?.source).toBe('table');
    expect(json.rings.shoulder?.source).toBe('proportion');
    expect(json.rings.knee?.source).toBe('proportion');
  });
});

describe('male family', () => {
  it('grows from S to XXL at every ring and in stature', () => {
    for (let i = 1; i < MALE_BODY_SHAPE_IDS.length; i++) {
      const a = familyShape('male', MALE_BODY_SHAPE_IDS[i - 1]!)!;
      const b = familyShape('male', MALE_BODY_SHAPE_IDS[i]!)!;
      for (const ring of ANCHOR_RINGS) expect(b.rings[ring].circumferenceCm, ring).toBeGreaterThan(a.rings[ring].circumferenceCm);
      expect(b.statureCm).toBeGreaterThan(a.statureCm);
    }
  });

  it('has the chest girths of the EN 13402-3:2004 reproduction inside their letter intervals, waist at drop −12 and the associated neck girth', () => {
    // The values were read from Wikipedia's reproduction of the 2004 edition, not from the standard.
    expect(MALE_SOURCES.en).toContain('as reproduced in the Wikipedia article');
    expect(MALE_SOURCES.en).toContain('2004');
    const interval = { S: [86, 94], M: [94, 102], L: [102, 110], XL: [110, 118], XXL: [118, 129] } as const;
    for (const id of MALE_BODY_SHAPE_IDS) {
      const r = MALE_REFERENCE[id];
      expect(r.chest).toBeGreaterThan(interval[id][0]);
      expect(r.chest).toBeLessThan(interval[id][1]);
      expect(r.waist - r.chest).toBe(-12);
    }
    // Neck 37 ↔ chest 88, +1 cm per 4 cm of chest up to chest 120, then 1.5 cm per 6 cm.
    expect(MALE_BODY_SHAPE_IDS.map((id) => MALE_REFERENCE[id].neck)).toEqual([37.5, 39.5, 41.5, 43.5, 45.75]);
  });

  it('differs from the female family the way the table says: taller, longer legs, less waist, no bust', () => {
    const m = buildMannequin(familyShape('male')!);
    const f = buildMannequin(familyShape('female')!);
    const width = (x: typeof m, ring: 'hip' | 'waist' | 'shoulder' | 'chest') => 2 * x.rings.find((r) => r.id === ring)!.a;
    expect(m.statureCm).toBeGreaterThan(f.statureCm);
    expect(m.landmarks.crotch[1] / m.statureCm).toBeGreaterThan(f.landmarks.crotch[1] / f.statureCm);
    // Clearly less waist: waist / hip width 0.89 against 0.73.
    expect(width(m, 'waist') / width(m, 'hip')).toBeGreaterThan(width(f, 'waist') / width(f, 'hip') + 0.1);
    // No bust: from chest to underbust the male girth drops by under 6 cm, the female by over 10.
    expect(m.shape.rings.chest.circumferenceCm - m.shape.rings.underbust.circumferenceCm).toBeLessThan(6);
    expect(f.shape.rings.chest.circumferenceCm - f.shape.rings.underbust.circumferenceCm).toBeGreaterThan(10);
  });

  it('has a shoulder ring wider than the hip ring in every size, but is NOT broad-shouldered: over the deltoids it is no narrower against the hip than the female v0, no more', () => {
    for (const id of MALE_BODY_SHAPE_IDS) {
      const x = buildMannequin(familyShape('male', id)!);
      const w = (ring: 'hip' | 'shoulder') => 2 * x.rings.find((r) => r.id === ring)!.a;
      // 5 to 10 % wider: a box, not a V. This is the measured state of the figure, not a target.
      expect(w('shoulder') / w('hip'), id).toBeGreaterThan(1.04);
      expect(w('shoulder') / w('hip'), id).toBeLessThan(1.15);
    }
    const m = buildMannequin(familyShape('male')!);
    const f = buildMannequin(familyShape('female')!);
    const ratio = (x: typeof m) => deltoidBreadthCm(x) / (2 * x.rings.find((r) => r.id === 'hip')!.a);
    // 1.35 against 1.34: the families are not told apart by shoulder against hip. The bound below only
    // says "not smaller"; a V-shaped torso needs non-elliptical sections and then a real margin here.
    expect(ratio(m)).toBeGreaterThanOrEqual(ratio(f));
    expect(ratio(m) - ratio(f)).toBeLessThan(0.05);
  });

  it('builds the same bytes every time and different bytes per size and per family', () => {
    const hashes = MALE_BODY_SHAPE_IDS.map((id) => sha(glbOf(familyShape('male', id)!)));
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(sha(glbOf(familyShape('male', 'M')!))).toBe(hashes[1]);
    expect(hashes[1]).not.toBe(sha(glbOf(bodyShape('M'))));
  });
});

describe('male M with the shared camera paths, rig and motion clip', () => {
  const { mannequin, mesh } = male('M');

  it('gets turntables that look at the body and a skin whose weights sum to one', () => {
    const paths = turntablePaths(mannequin, { frames: 8 });
    expect(paths.map((p) => p.heightCm)).toEqual(paths.map((p) => TURNTABLE_HEIGHTS[p.id] * mannequin.statureCm));
    const skin = skinWeights(mannequin, mesh);
    for (let v = 0; v < mesh.positions.length / 3; v++) expect(skin.weights[2 * v]! + skin.weights[2 * v + 1]!).toBeCloseTo(1, 9);
  });

  it('keeps every part closed through the motion clip and the rest pose in place', () => {
    const skin = skinWeights(mannequin, mesh);
    const rest = poseMesh(mannequin, mesh, skin, { joints: {} });
    for (let i = 0; i < rest.length; i++) expect(rest[i]!).toBeCloseTo(mesh.positions[i]!, 9);
    for (const t of [1.5, 3, 4.5]) {
      const posed = poseMesh(mannequin, mesh, skin, sampleClip(MOTION_CLIP, t));
      expect(posed.every((x) => Number.isFinite(x))).toBe(true);
      const topo = topology({ ...mesh, positions: posed });
      expect(topo.boundaryEdges).toBe(0);
      expect(topo.volumes.every((v) => v > 0)).toBe(true);
    }
  });
});

describe('levelWarp', () => {
  it('is null without levels, the identity at the nominal levels, and linear between given levels', () => {
    expect(levelWarp(undefined)).toBeNull();
    expect(levelWarp({})).toBeNull();
    const same = levelWarp({ ...NOMINAL_LEVELS })!;
    for (const f of [0, 0.1, 0.3, 0.455, 0.5, 0.7, 0.9, 1]) expect(same(f)).toBeCloseTo(f, 12);
    const w = levelWarp({ crotch: 0.48, chest: 0.74 })!;
    expect(w(0)).toBe(0);
    expect(w(1)).toBe(1);
    expect(w(NOMINAL_LEVELS.crotch)).toBeCloseTo(0.48, 12);
    expect(w(NOMINAL_LEVELS.chest)).toBeCloseTo(0.74, 12);
    expect(w(NOMINAL_LEVELS.crotch / 2)).toBeCloseTo(0.24, 12);
    expect(w((NOMINAL_LEVELS.crotch + NOMINAL_LEVELS.chest) / 2)).toBeCloseTo(0.61, 12);
  });

  it('rejects levels that do not rise', () => {
    expect(() => levelWarp({ crotch: 0.6, hip: 0.5 })).toThrow(RangeError);
    expect(() => levelWarp({ chest: 1.2 })).toThrow(RangeError);
    expect(() => levelWarp({ knee: Number.NaN })).toThrow(RangeError);
  });
});

describe('shapeForBody', () => {
  it('without measurements is the base shape of the family, byte for byte', () => {
    for (const family of BODY_FAMILIES) {
      const base = familyShape(family)!;
      const s = shapeForBody({ family });
      expect(s.id).toBe('custom');
      expect(s.family).toBe(family);
      expect(s.rings).toEqual(base.rings);
      expect(s.statureCm).toBe(base.statureCm);
      expect(sha(glbOf(s, base.id))).toBe(sha(glbOf(base)));
    }
  });

  it('with the measurements of a table size is that size', () => {
    for (const family of BODY_FAMILIES) {
      for (const id of familyShapeIds(family)) {
        const shape = familyShape(family, id)!;
        const ref = referenceMeasurements(shape);
        const s = shapeForBody({ family, heightCm: ref.heightCm, shoulderCm: ref.shoulderCm, chest: ref.chestCm, waist: ref.waistCm, hip: ref.hipCm });
        for (const ring of ANCHOR_RINGS) {
          expect(s.rings[ring].circumferenceCm, `${family} ${id} ${ring}`).toBeCloseTo(shape.rings[ring].circumferenceCm, 9);
          expect(s.rings[ring].aspect).toBeCloseTo(shape.rings[ring].aspect, 12);
        }
        expect(s.statureCm).toBe(shape.statureCm);
        expect(buildMannequin(s).landmarks.crotch[1]).toBeCloseTo(buildMannequin(shape).landmarks.crotch[1], 9);
      }
    }
  });

  it('takes the typed girths, height and shoulder width, and stays closed with exact rings', () => {
    for (const family of BODY_FAMILIES) {
      const input = { family, heightCm: 188, shoulderCm: referenceMeasurements(familyShape(family)!).shoulderCm + 3, bust: 104, waist: 97, hip: 103 };
      const m = buildBody(input);
      const mesh = buildMannequinMesh(m);
      expect(topology(mesh).watertight).toBe(true);
      expect(m.statureCm).toBe(188);
      expect(m.shape.rings.chest.circumferenceCm).toBe(104);
      expect(m.shape.rings.waist.circumferenceCm).toBe(97);
      expect(m.shape.rings.hip.circumferenceCm).toBe(103);
      for (const r of m.rings) expect(Math.abs(meshRingCircumference(mesh, r)! / r.circumferenceCm - 1), r.id).toBeLessThan(GIRTH_TOLERANCE);
      // 3 cm more shoulder width than the table's at this chest girth: the shoulder ring is 3 cm wider than without it.
      const plain = buildBody({ ...input, shoulderCm: undefined });
      const a = (x: typeof m) => x.rings.find((r) => r.id === 'shoulder')!.a;
      expect(2 * (a(m) - a(plain))).toBeCloseTo(3 + referenceMeasurements(familyShape(family)!).shoulderCm - shoulderAt(family, 104), 6);
      expect(deltoidBreadthCm(m) - deltoidBreadthCm(plain)).toBeCloseTo(2 * (a(m) - a(plain)), 9);
    }
  });

  it('scales the inseam with the height and reads `chest` before `bust`', () => {
    const short = buildBody({ family: 'male', heightCm: 165 });
    const tall = buildBody({ family: 'male', heightCm: 195 });
    expect(tall.landmarks.crotch[1] / short.landmarks.crotch[1]).toBeCloseTo(195 / 165, 9);
    expect(short.shape.rings.chest.circumferenceCm).toBe(98);
    expect(shapeForBody({ family: 'male', chest: 110, bust: 90 }).rings.chest.circumferenceCm).toBe(110);
    expect(shapeForBody({ family: 'female', bust: 88 }).rings.chest.circumferenceCm).toBe(88);
  });

  it('ignores values that are not positive finite numbers and bounds a wild shoulder width (0.75–1.35 of the table ring, never into the chest)', () => {
    const base = familyShape('male')!;
    const s = shapeForBody({ family: 'male', heightCm: Number.NaN, chest: -3, waist: Infinity, hip: 0, shoulderCm: Number.NaN });
    expect(s.rings).toEqual(base.rings);
    expect(s.statureCm).toBe(base.statureCm);
    expect(shapeForBody({ family: 'nonsense' as 'male' }).family).toBe('female');
    const width = (shape: BodyShape) => 2 * buildMannequin(shape).rings.find((r) => r.id === 'shoulder')!.a;
    expect(width(shapeForBody({ family: 'male', shoulderCm: 500 })) / width(base)).toBeCloseTo(1.35, 9);
    // Narrow: 0.75 of the table's ring, or wider when the arms would otherwise cut into the chest (male M: 0.87).
    const narrow = shapeForBody({ family: 'male', shoulderCm: 1 });
    expect(width(narrow) / width(base)).toBeGreaterThanOrEqual(0.75);
    expect(width(narrow) / width(base)).toBeLessThan(0.9);
    expect(armClearanceCm(buildMannequin(narrow))).toBeCloseTo(0.5, 6);
    const narrowF = shapeForBody({ family: 'female', shoulderCm: 1 });
    expect(width(narrowF) / width(familyShape('female')!)).toBeGreaterThanOrEqual(0.75);
    expect(armClearanceCm(buildMannequin(narrowF))).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it('builds a closed body with exact rings across the range a shopper can type, arms outside the torso', () => {
    const typed = [
      [76, 60, 82, 150, undefined], [84, 70, 110, 160, undefined], [120, 124, 118, 172, undefined], [150, 140, 150, 205, undefined],
      // Belly larger than chest, narrow typed shoulders, a 3XL / 4XL chest, a large seat.
      [98, 120, undefined, undefined, undefined], [98, 130, 110, undefined, undefined], [98, 86, 96, 174, 30], [110, 125, 130, 165, 36], [140, 150, 150, 170, undefined], [100, 100, 140, 170, undefined],
    ] as const;
    for (const family of BODY_FAMILIES) {
      for (const [chest, waist, hip, heightCm, shoulderCm] of typed) {
        const label = `${family} ${chest}/${waist}/${hip}/${heightCm}/${shoulderCm}`;
        const m = buildBody({ family, chest, waist, hip, heightCm, shoulderCm });
        const mesh = buildMannequinMesh(m);
        expect(topology(mesh).watertight, label).toBe(true);
        for (const ring of ANCHOR_RINGS) expect(m.shape.rings[ring].circumferenceCm, `${label} ${ring}`).toBeGreaterThan(0);
        for (const r of m.rings) expect(Math.abs(meshRingCircumference(mesh, r)! / r.circumferenceCm - 1), `${label} ${r.id}`).toBeLessThan(GIRTH_TOLERANCE);
        // No torso section deeper than wide, and none outside the table's own range of depth / width.
        const rows = familyShapeIds(family).map((id) => familyShape(family, id)!);
        for (const ring of ['chest', 'underbust', 'waist', 'hip'] as const) {
          const aspects = rows.map((s) => s.rings[ring].aspect);
          expect(m.shape.rings[ring].aspect, `${label} ${ring}`).toBeGreaterThanOrEqual(Math.min(...aspects) - 1e-12);
          expect(m.shape.rings[ring].aspect, `${label} ${ring}`).toBeLessThanOrEqual(Math.max(...aspects) + 1e-12);
          expect(m.shape.rings[ring].aspect).toBeLessThan(1);
        }
        // Arms: outside the torso at the chest, underbust and waist rings, on the sections and on the mesh.
        expect(armClearanceCm(m), label).toBeGreaterThanOrEqual(0.5 - 1e-9);
        for (const ringId of ['chest', 'underbust', 'waist'] as const) {
          const r = m.rings.find((x) => x.id === ringId)!;
          const loops = slice(mesh.positions, mesh.indices, { origin: r.centre, normal: r.normal });
          const torso = loopAround(loops, r.centre, r.u, r.v)!;
          const maxX = Math.max(...torso.points.map((p) => Math.abs(p[0])));
          for (const l of loops.filter((x) => x !== torso)) expect(Math.min(...l.points.map((p) => Math.abs(p[0]))), `${label} ${ringId}`).toBeGreaterThan(maxX);
        }
      }
    }
  });

  it('holds typed girths and height inside BODY_INPUT_LIMITS and does not extrapolate stature or depth / width', () => {
    for (const family of BODY_FAMILIES) {
      const ids = familyShapeIds(family);
      const small = familyShape(family, ids[0]!)!;
      const large = familyShape(family, ids[ids.length - 1]!)!;
      const [lo, hi] = BODY_INPUT_LIMITS.girthRatio;
      const tiny = shapeForBody({ family, chest: 1, waist: 1, hip: 1, heightCm: 20 });
      const huge = shapeForBody({ family, chest: 400, waist: 400, hip: 400, heightCm: 400 });
      for (const ring of ['chest', 'waist', 'hip'] as const) {
        expect(tiny.rings[ring].circumferenceCm).toBeCloseTo(lo * small.rings[ring].circumferenceCm, 9);
        expect(huge.rings[ring].circumferenceCm).toBeCloseTo(hi * large.rings[ring].circumferenceCm, 9);
        expect(tiny.rings[ring].aspect).toBe(small.rings[ring].aspect);
        expect(huge.rings[ring].aspect).toBe(large.rings[ring].aspect);
      }
      expect(tiny.statureCm).toBe(BODY_INPUT_LIMITS.heightCm[0]);
      expect(huge.statureCm).toBe(BODY_INPUT_LIMITS.heightCm[1]);
      // Without a typed height the stature stays at the nearest table size beyond the table.
      expect(shapeForBody({ family, chest: 400 }).statureCm).toBe(large.statureCm);
      expect(shapeForBody({ family, chest: 1 }).statureCm).toBe(small.statureCm);
      for (const s of [tiny, huge]) {
        const m = buildMannequin(s);
        expect(topology(buildMannequinMesh(m)).watertight).toBe(true);
        for (const ring of ANCHOR_RINGS) expect(s.rings[ring].circumferenceCm).toBeGreaterThan(0);
        expect(armClearanceCm(m)).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
    }
  });

  it('reads shoulderCm as biacromial breadth in both families: the measured width gives the default figure', () => {
    expect(referenceMeasurements(familyShape('female')!).shoulderCm).toBe(FEMALE_SHOULDER_REFERENCE.M);
    expect(FEMALE_SHOULDER_REFERENCE).toEqual({ XS: 35.5, M: 36.5, XXL: 38 });
    for (const family of BODY_FAMILIES) {
      const base = familyShape(family)!;
      const typed = shapeForBody({ family, shoulderCm: referenceMeasurements(base).shoulderCm });
      expect(typed.rings.shoulder.circumferenceCm).toBeCloseTo(base.rings.shoulder.circumferenceCm, 9);
    }
    // The reference is not the ring: the female v0 shoulder ring is 42.1 cm wide at M.
    expect(2 * buildMannequin(familyShape('female')!).rings.find((r) => r.id === 'shoulder')!.a).toBeGreaterThan(FEMALE_SHOULDER_REFERENCE.M + 5);
  });
});

/** The table's shoulder width at a chest girth (linear between the two sizes around it), for the test above. */
function shoulderAt(family: 'female' | 'male', chest: number): number {
  const rows = familyShapeIds(family).map((id) => referenceMeasurements(familyShape(family, id)!));
  let i = 1;
  while (i < rows.length - 1 && chest > rows[i]!.chestCm) i++;
  const t = (chest - rows[i - 1]!.chestCm) / (rows[i]!.chestCm - rows[i - 1]!.chestCm);
  return rows[i - 1]!.shoulderCm + (rows[i]!.shoulderCm - rows[i - 1]!.shoulderCm) * t;
}
