import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildBody, familyShape } from './families';
import { HEAD_LEVELS } from './head';
import { buildHeadPartV3, earReliefV3, faceReliefV3, faceShadeV3, hairV3, lidsV3, FACE_LEVELS_V3, HAIR_SHADE, JAW_LIFT, V3_COLUMNS, V3_ROWS } from './headV3';
import { buildMannequinMesh, topology, triangleCount, vertexAt, vertexCount, vertexNormals, type Mesh } from './mesh';
import { buildMannequin, levelWarp } from './model';

const sha = (a: ArrayLike<number>) => createHash('sha256').update(Buffer.from(Float64Array.from(a).buffer)).digest('hex');
const partVertices = (mesh: Mesh, part: string): number[] => Array.from({ length: vertexCount(mesh) }, (_, i) => i).filter((i) => mesh.vertexPart[i] === mesh.partNames.indexOf(part));
const headTriangles = (mesh: Mesh): number => {
  const head = mesh.partNames.indexOf('head');
  return Array.from({ length: triangleCount(mesh) }, (_, k) => k).filter((k) => mesh.vertexPart[mesh.indices[3 * k]!] === head).length;
};

describe('head v3', () => {
  it('leaves head v2 as it was, byte for byte (the hashes of claude/garment-engine at 8658d21)', () => {
    const before = {
      female: ['695ab77d8c1f7d9eea9317d59b8a8f889dee9177aa1d9620a472fcdb29eccaf1', 'f9a57bcba75988ae2438d9dc381c7a3adedd3cde2c5d15e1806e865d1b350d28'],
      male: ['87108b8f5647a399747431ea9c5bbdc9e0e149cda02b6d6570ef9c4b80d50e96', 'fbda8b674f2a2fbc7c43fa5b701f6850200c83de451ca985360880ebd13a746c'],
    };
    for (const family of ['female', 'male'] as const) {
      const mesh = buildMannequinMesh(buildMannequin(familyShape(family)!), { head: 'neutral-v2' });
      expect([sha(mesh.positions), sha(mesh.shade!)]).toEqual(before[family]);
    }
  });

  it.each(['female', 'male'] as const)('%s: six closed parts, limbs as v2, a shade per vertex, at most 25k head triangles', (family) => {
    const m = buildMannequin(familyShape(family)!);
    const mesh = buildMannequinMesh(m, { head: 'neutral-v3' });
    const v2 = buildMannequinMesh(m, { head: 'neutral-v2' });
    expect(mesh.partNames).toEqual(['torso', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'head']);
    const t = topology(mesh);
    expect(t.watertight).toBe(true);
    expect(t.components).toBe(6);
    for (const part of ['torso', 'leg_l', 'arm_r']) expect(partVertices(mesh, part).flatMap((i) => vertexAt(mesh, i))).toEqual(partVertices(v2, part).flatMap((i) => vertexAt(v2, i)));
    expect(mesh.shade!.length).toBe(vertexCount(mesh));
    // The budget of the review: at most about 25k (v2: 46k).
    expect(headTriangles(mesh)).toBeLessThanOrEqual(25_000);
    expect(headTriangles(mesh)).toBeGreaterThan(20_000);
    expect(headTriangles(v2)).toBeGreaterThan(1.8 * headTriangles(mesh));
    // Hair, brows, lash line and iris are darker than the skin, never black; under the jaw at most JAW_LIFT lighter.
    const shades = partVertices(mesh, 'head').map((i) => mesh.shade![i]!);
    expect(Math.min(...shades)).toBeGreaterThan(0.4);
    expect(Math.min(...shades)).toBeLessThan(HAIR_SHADE + 1e-6);
    expect(Math.max(...shades)).toBeLessThanOrEqual(1 + JAW_LIFT + 1e-6);
  });

  it.each(['female', 'male'] as const)('%s: chin and skull top at the head levels; the hair adds at most 2 cm on top; as wide and deep as a head', (family) => {
    const m = buildMannequin(familyShape(family)!);
    const warp = levelWarp(m.shape.levels);
    const level = (f: number) => (warp ? warp(f) : f) * m.statureCm;
    const mesh = buildMannequinMesh(m, { head: 'neutral-v3' });
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
    expect(Math.max(...ys)).toBeGreaterThan(m.statureCm + 0.5);
    expect(Math.max(...ys)).toBeLessThan(m.statureCm + 2);
    expect(Math.min(...ys)).toBeLessThan(m.morphHeights.neck);
    const breadth = (Math.max(...xs) - Math.min(...xs)) / k;
    const depth = (Math.max(...zs) - Math.min(...zs)) / k;
    expect(breadth).toBeGreaterThan(15.5);
    expect(breadth).toBeLessThan(20.5);
    expect(depth).toBeGreaterThan(18.5);
    expect(depth).toBeLessThan(24.5);
  });

  it('under the chin no part of the front faces straight down (v2: steeper), and the neck below is as v2', () => {
    const steepest = (family: 'female' | 'male', head: 'neutral-v2' | 'neutral-v3'): number => {
      const m = buildMannequin(familyShape(family)!);
      const mesh = buildMannequinMesh(m, { head });
      const n = vertexNormals(mesh);
      const { chinY } = mesh.headLevels!;
      let low = 0;
      // The front of the head between the neck ring and the chin's front, within 2.5 cm of the middle.
      for (const i of partVertices(mesh, 'head')) {
        const [x, y, z] = vertexAt(mesh, i);
        if (y < m.morphHeights.neck || y > chinY + 2.5 || Math.abs(x) > 2.5 || z < 0) continue;
        low = Math.min(low, n[3 * i + 1]!);
      }
      return low;
    };
    for (const family of ['female', 'male'] as const) {
      const v3 = steepest(family, 'neutral-v3');
      expect(v3).toBeGreaterThan(-0.88);
      expect(v3).toBeGreaterThan(steepest(family, 'neutral-v2') + 0.04);
    }
  });

  it('bends rows onto the lid margins: in each eye column a vertex lies on the upper and on the lower lid curve', () => {
    const F = FACE_LEVELS_V3;
    for (const family of ['female', 'male'] as const) {
      const m = buildMannequin(familyShape(family)!);
      const torso = m.parts.find((p) => p.id === 'torso')!;
      const ring = torso.sections.reduce((best, s) => (Math.abs(s.centre[1] - m.morphHeights.neck) < Math.abs(best.centre[1] - m.morphHeights.neck) ? s : best));
      const male = family === 'male';
      // The plain grid (no hair) of the head part: V3_ROWS rows of V3_COLUMNS vertices.
      const head = buildHeadPartV3(m, { y: m.morphHeights.neck, a: ring.a, b: ring.b, cz: ring.centre[2] }, { bald: true });
      const k = (head.topY - head.chinY) / 22;
      let checked = 0;
      for (let c = 0; c < V3_COLUMNS; c++) {
        const col = Array.from({ length: V3_ROWS }, (_, r) => [head.positions[3 * (r * V3_COLUMNS + c)]!, head.positions[3 * (r * V3_COLUMNS + c) + 1]!, head.positions[3 * (r * V3_COLUMNS + c) + 2]!] as const);
        const inEye = col.filter(([x, y, z]) => z > 0 && Math.abs((y - head.chinY) / k - F.eyes) < 0.6 && Math.abs(Math.abs(x) / k - F.eyeX) < 0.45);
        if (inEye.length === 0) continue;
        const u = Math.abs(inEye[0]![0]) / k - F.eyeX;
        const { top, bottom } = lidsV3(u, male);
        const off = (target: number): number => Math.min(...col.map(([, y]) => Math.abs((y - head.chinY) / k - F.eyes - target)));
        // Within 0.05 cm (the relief moves a vertex a little along the normal); v2's rows missed the lids by up to half a row.
        expect(off(top)).toBeLessThan(0.05);
        expect(off(bottom)).toBeLessThan(0.05);
        checked++;
      }
      expect(checked).toBeGreaterThan(5);
    }
  });

  it('has quieter eyes than v2, an ear with a back, and a mirror-symmetric face', () => {
    const F = FACE_LEVELS_V3;
    for (const male of [false, true]) {
      // The opening is lower than v2's (0.52 / 0.46 above the eye centre at its middle).
      expect(lidsV3(0, male).top).toBeLessThan(male ? 0.42 : 0.46);
      // The upper lid covers the top of the iris (radius about 0.45): the iris shade ends at the lid.
      expect(faceShadeV3(F.eyeX, F.eyes + lidsV3(0, male).top + 0.12, male)).toBeGreaterThan(0.9);
      expect(faceShadeV3(F.eyeX, F.eyes, male)).toBeLessThan(0.85);
      expect(faceShadeV3(F.eyeX, F.eyes, male)).toBeGreaterThan(0.6);
      // The nose is the most forward point; lips stand out from the line between them.
      expect(faceReliefV3(0, F.noseTip, male)).toBeGreaterThan(1.5);
      expect(faceReliefV3(0, F.mouth + 0.36, male)).toBeGreaterThan(faceReliefV3(0, F.mouth, male) + 0.15);
      // The ear: most out at its back rim, a hollow in the middle; behind the rim it runs down into the skull
      // over about a centimetre (v2's ended within 2 mm, a wall); in front it ends at once.
      const hw = male ? 1.7 : 1.6;
      const rim = earReliefV3(0.9 * hw, 9.9, male);
      expect(rim).toBeGreaterThan(0.6);
      expect(earReliefV3(-0.1, 9.8, male)).toBeLessThan(rim - 0.3);
      expect(earReliefV3(1.3 * hw, 9.9, male)).toBeGreaterThan(0.35 * rim);
      expect(earReliefV3(1.3 * hw, 9.9, male)).toBeLessThan(rim);
      expect(earReliefV3(1.6 * hw, 9.9, male)).toBeLessThan(earReliefV3(1.3 * hw, 9.9, male));
      expect(earReliefV3(-1.25 * hw, 9.9, male)).toBeLessThan(0.05);
      for (const [x, y] of [[1.3, 9], [3, 11], [2, 5], [0.7, 2], [3.4, 12.6]] as const) {
        expect(faceReliefV3(-x, y, male)).toBeCloseTo(faceReliefV3(x, y, male), 12);
        expect(faceShadeV3(-x, y, male)).toBeCloseTo(faceShadeV3(x, y, male), 12);
      }
    }
  });

  it('has short hair: none on the face, fuller on the crown, fuller on the female head, darker than the skin', () => {
    for (const male of [false, true]) {
      expect(hairV3(0, 12, male).thickness).toBe(0);
      expect(hairV3(0, 12, male).cover).toBe(0);
      expect(hairV3(Math.PI, 3, male).thickness).toBe(0);
      const crown = hairV3(Math.PI / 2, 21.5, male);
      expect(crown.cover).toBe(1);
      expect(crown.thickness).toBeGreaterThan(0.6);
      expect(crown.thickness).toBeLessThan(2.2);
      expect(crown.tone).toBeLessThan(0.8);
      // Above the ear the side is hair; the ear itself (its middle) is not covered.
      expect(hairV3(Math.PI / 2, 15.5, male).cover).toBe(1);
      expect(hairV3(Math.PI / 2, 9.9, male).cover).toBe(0);
      // The top pole closes: the thickness at the very top does not depend on the angle.
      expect(hairV3(0.3, 22, male).thickness).toBeCloseTo(hairV3(2.5, 22, male).thickness, 9);
    }
    expect(hairV3(Math.PI / 2, 21, false).thickness).toBeGreaterThan(hairV3(Math.PI / 2, 21, true).thickness + 0.4);
    // The female hairline is lower on the forehead (a fringe) than the male one.
    const line = (male: boolean): number => {
      let y = 10;
      while (hairV3(-0.2, y, male).cover < 0.5) y += 0.01;
      return y;
    };
    expect(line(false)).toBeLessThan(line(true) - 1);
  });

  it('is deterministic, follows a typed height and stays closed on small and tall bodies', () => {
    const a = buildMannequinMesh(buildBody({ family: 'female', heightCm: 180 }), { head: 'neutral-v3' });
    const b = buildMannequinMesh(buildBody({ family: 'female', heightCm: 180 }), { head: 'neutral-v3' });
    expect(sha(a.positions)).toBe(sha(b.positions));
    expect(a.headLevels!.topY).toBeCloseTo(180, 6);
    for (const family of ['female', 'male'] as const) for (const heightCm of [130, 220]) expect(topology(buildMannequinMesh(buildBody({ family, heightCm }), { head: 'neutral-v3' })).watertight).toBe(true);
  });
});
