import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape } from './shapes';
import { buildBody, familyShape } from './families';
import { faceRelief, FACE_LEVELS, HEAD_LEVELS } from './head';
import { earRelief, faceReliefV2, faceShadeV2, FACE_LEVELS_V2 } from './headV2';
import { buildMannequinMesh, topology, triangleCount, vertexAt, vertexCount, type Mesh } from './mesh';
import { buildMannequin, levelWarp } from './model';

const sha = (a: ArrayLike<number>) => createHash('sha256').update(Buffer.from(Float64Array.from(a).buffer)).digest('hex');
const partVertices = (mesh: Mesh, part: string): number[] => Array.from({ length: vertexCount(mesh) }, (_, i) => i).filter((i) => mesh.vertexPart[i] === mesh.partNames.indexOf(part));

describe('head v2', () => {
  it('leaves the neutral head (v1) and the default mesh as they were, byte for byte', () => {
    // The hashes of the `neutral` mesh before head v2 existed (claude/garment-engine at 41c1c16).
    const before = {
      female: ['3bb84798af1f0455111f721502648b87a4ba30435a2d71f7650fe55ef428c670', '83c81cc18de3a98c90016ba58cb1ba43b34656851dbe3ed49c8f5b9fac5bc1ef'],
      male: ['a22cfa61cdb017aa4e049b3caa7b7605387a25a4ea554db6d31db8dcdcb6c752', '6bfef242d5b82b1f05ef7dd60d33770b87479d1457447fbf0373c9813c13bc42'],
    };
    for (const [family, shape] of [['female', bodyShape(BASE_SHAPE_ID)], ['male', familyShape('male')!]] as const) {
      const mesh = buildMannequinMesh(buildMannequin(shape), { head: 'neutral' });
      expect([sha(mesh.positions), sha(mesh.indices)]).toEqual(before[family]);
      expect(mesh.shade).toBeUndefined();
      expect(mesh.headLevels).toBeUndefined();
      expect(buildMannequinMesh(buildMannequin(shape)).shade).toBeUndefined();
    }
  });

  it.each(['female', 'male'] as const)('%s: six closed, outward-facing parts; limbs as in the default mesh; a shade per vertex', (family) => {
    const m = buildMannequin(familyShape(family)!);
    const mesh = buildMannequinMesh(m, { head: 'neutral-v2' });
    const egg = buildMannequinMesh(m);
    expect(mesh.partNames).toEqual(['torso', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'head']);
    const t = topology(mesh);
    expect(t.watertight).toBe(true);
    expect(t.components).toBe(6);
    for (const part of ['leg_l', 'leg_r', 'arm_l', 'arm_r']) expect(partVertices(mesh, part).flatMap((i) => vertexAt(mesh, i))).toEqual(partVertices(egg, part).flatMap((i) => vertexAt(egg, i)));
    expect(mesh.shade!.length).toBe(vertexCount(mesh));
    const head = new Set(partVertices(mesh, 'head'));
    let darkest = 1;
    for (let i = 0; i < mesh.shade!.length; i++) {
      if (!head.has(i)) expect(mesh.shade![i]).toBe(1);
      darkest = Math.min(darkest, mesh.shade![i]!);
    }
    // Brows, lash line and iris are darker than the skin, never black.
    expect(darkest).toBeLessThan(0.8);
    expect(darkest).toBeGreaterThan(0.45);
    // Triangle budget: the v2 head is about 46k triangles (v1: 15.8k).
    const headTris = Array.from({ length: triangleCount(mesh) }, (_, k) => k).filter((k) => head.has(mesh.indices[3 * k]!)).length;
    expect(headTris).toBeGreaterThan(30_000);
    expect(headTris).toBeLessThan(50_000);
  });

  it.each(['female', 'male'] as const)('%s: chin and top at the head levels, mirror-symmetric, as wide and deep as a head', (family) => {
    const m = buildMannequin(familyShape(family)!);
    const warp = levelWarp(m.shape.levels);
    const level = (f: number) => (warp ? warp(f) : f) * m.statureCm;
    const mesh = buildMannequinMesh(m, { head: 'neutral-v2' });
    expect(mesh.headLevels!.chinY).toBeCloseTo(level(HEAD_LEVELS.chin), 9);
    expect(mesh.headLevels!.topY).toBeCloseTo(m.statureCm, 9);
    const k = (m.statureCm - level(HEAD_LEVELS.chin)) / 22;
    const xs: number[] = [], zs: number[] = [], ys: number[] = [];
    for (const i of partVertices(mesh, 'head')) {
      const [x, y, z] = vertexAt(mesh, i);
      ys.push(y);
      if (y < mesh.headLevels!.chinY) continue;
      xs.push(x);
      zs.push(z);
    }
    expect(Math.max(...ys)).toBeCloseTo(m.statureCm, 6);
    // The tube reaches below the neck ring, into the torso.
    expect(Math.min(...ys)).toBeLessThan(m.morphHeights.neck);
    const breadth = (Math.max(...xs) - Math.min(...xs)) / k;
    const depth = (Math.max(...zs) - Math.min(...zs)) / k;
    expect(breadth).toBeGreaterThan(15);
    expect(breadth).toBeLessThan(18.5);
    expect(depth).toBeGreaterThan(18);
    expect(depth).toBeLessThan(22.5);
    expect(Math.abs(Math.max(...xs) + Math.min(...xs))).toBeLessThan(0.02);
  });

  it('no neck seam: from the neck ring to the chin the head is the neck, just outside the torso; below the ring it is inside it', () => {
    for (const family of ['female', 'male'] as const) {
      const m = buildMannequin(familyShape(family)!);
      const mesh = buildMannequinMesh(m, { head: 'neutral-v2' });
      const half = (part: string, lo: number, hi: number): number => {
        let w = 0;
        for (const i of partVertices(mesh, part)) {
          const [x, y] = vertexAt(mesh, i);
          if (y >= lo && y <= hi) w = Math.max(w, Math.abs(x));
        }
        return w;
      };
      const ring = m.morphHeights.neck, chin = mesh.headLevels!.chinY;
      // Between the ring and the chin the torso's neck is inside the head's tube, by less than 2 mm.
      const tube = half('head', ring + 1, chin - 1), neck = half('torso', ring + 1, chin - 1);
      expect(tube).toBeGreaterThan(neck);
      expect(tube - neck).toBeLessThan(0.6);
      // At the end of the tube, about 2 cm below the ring, the torso is wider (the shoulders' flare): the tube ends inside it.
      const end = Math.min(...partVertices(mesh, 'head').map((i) => vertexAt(mesh, i)[1]).filter((y) => y > ring - 3.5));
      expect(end).toBeLessThan(ring - 1.5);
      expect(half('head', end, end + 0.3)).toBeLessThan(m.torsoAt(end + 0.15)!.a);
    }
  });

  it('has open eyes, brows, a nose without a shelf under it, lips and ears', () => {
    const F = FACE_LEVELS_V2;
    for (const male of [false, true]) {
      // The eyeball shows inside the opening, below the upper lid's margin.
      const ball = faceReliefV2(F.eyeX, F.eyes, male);
      const lid = faceReliefV2(F.eyeX, F.eyes + (male ? 0.62 : 0.68), male);
      expect(lid).toBeGreaterThan(ball - 0.6);
      expect(faceReliefV2(F.eyeX, F.eyes, male)).toBeGreaterThan(faceReliefV2(F.eyeX + 1.8, F.eyes, male) - 0.4);
      // The iris and the brows are shaded; the forehead and the cheek are not.
      expect(faceShadeV2(F.eyeX, F.eyes, male)).toBeLessThan(0.8);
      expect(faceShadeV2(F.eyeX, F.eyes + (male ? 1.44 : 1.83), male)).toBeLessThan(0.8);
      expect(faceShadeV2(0, 15, male)).toBeCloseTo(1, 6);
      expect(faceShadeV2(4.5, 8.5, male)).toBeCloseTo(1, 6);
      // The nose is the most forward point of the face.
      expect(faceReliefV2(0, F.noseTip, male)).toBeGreaterThan(1.5);
      // Lips stand out from the line between them.
      expect(faceReliefV2(0, F.mouth + 0.36, male)).toBeGreaterThan(faceReliefV2(0, F.mouth, male) + 0.15);
      expect(faceReliefV2(0, F.mouth - 0.48, male)).toBeGreaterThan(faceReliefV2(0, F.mouth, male) + 0.15);
      // An ear stands out from the side of the head, most at its back rim, with a hollow in the middle.
      expect(earRelief(1.35, 10.5, male)).toBeGreaterThan(0.6);
      expect(earRelief(-0.1, 9.8, male)).toBeLessThan(earRelief(1.35, 10.5, male) - 0.3);
      expect(earRelief(3, 10, male)).toBe(0);
      for (const [x, y] of [[1.3, 9], [3, 11], [2, 5], [0.7, 2], [3.4, 12.6]] as const) {
        expect(faceReliefV2(-x, y, male)).toBeCloseTo(faceReliefV2(x, y, male), 12);
        expect(faceShadeV2(-x, y, male)).toBeCloseTo(faceShadeV2(x, y, male), 12);
      }
    }
    // Under the nose: v1's height fell by up to 2.7 cm per cm of height (a shelf that read as a moustache); v2's falls at most half as fast.
    const steepest = (f: (y: number) => number, lo: number, hi: number): number => {
      let s = 0;
      for (let y = lo; y < hi; y += 0.02) s = Math.max(s, (f(y + 0.02) - f(y)) / 0.02);
      return s;
    };
    for (const male of [false, true]) {
      const v1 = steepest((y) => faceRelief(0, y, male), FACE_LEVELS.noseBase - 1, FACE_LEVELS.noseTip - 0.1);
      const v2 = steepest((y) => faceReliefV2(0, y, male), F.noseBase - 1, F.noseTip - 0.1);
      expect(v1).toBeGreaterThan(2);
      expect(v2).toBeLessThan(0.55 * v1);
    }
  });

  it('the male and the female head differ in jaw and brow', () => {
    const F = FACE_LEVELS_V2;
    const jaw = (family: 'female' | 'male'): number => {
      const m = buildMannequin(familyShape(family)!);
      const mesh = buildMannequinMesh(m, { head: 'neutral-v2' });
      const { chinY, topY } = mesh.headLevels!;
      const k = (topY - chinY) / 22;
      let w = 0;
      for (const i of partVertices(mesh, 'head')) {
        const [x, y] = vertexAt(mesh, i);
        const u = (y - chinY) / k;
        if (u > 2.5 && u < 4) w = Math.max(w, Math.abs(x) / k);
      }
      return w;
    };
    expect(jaw('male')).toBeGreaterThan(jaw('female') + 0.6);
    // A heavier brow ridge on the male head; higher brows on the female one.
    expect(faceReliefV2(1.5, F.brow - 0.15, true)).toBeGreaterThan(faceReliefV2(1.5, F.brow - 0.15, false) + 0.2);
    const browTop = (male: boolean): number => {
      let best = 0, at = 0;
      for (let y = F.eyes + 1; y < F.eyes + 3; y += 0.01) {
        const d = 1 - faceShadeV2(F.eyeX, y, male);
        if (d > best) [best, at] = [d, y];
      }
      return at;
    };
    expect(browTop(false)).toBeGreaterThan(browTop(true) + 0.2);
  });

  it('is deterministic and follows a typed height', () => {
    const a = buildMannequinMesh(buildBody({ family: 'female', heightCm: 180 }), { head: 'neutral-v2' });
    const b = buildMannequinMesh(buildBody({ family: 'female', heightCm: 180 }), { head: 'neutral-v2' });
    expect(sha(a.positions)).toBe(sha(b.positions));
    expect(a.headLevels!.topY).toBeCloseTo(180, 6);
    expect(topology(a).watertight).toBe(true);
  });
});
