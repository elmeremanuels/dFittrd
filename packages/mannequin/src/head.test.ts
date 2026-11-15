import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BODY_SHAPE_IDS, bodyShape } from './shapes';
import { buildBody, familyShape, familyShapeIds } from './families';
import { FACE_LEVELS, HEAD_LEVELS, buildHeadPart, faceRelief } from './head';
import { buildMannequinMesh, topology, vertexAt, vertexCount } from './mesh';
import { buildMannequin, levelWarp } from './model';
import type { BodyFamily } from './shapes';

const all: [BodyFamily, string][] = (['female', 'male'] as const).flatMap((f) => familyShapeIds(f).map((id) => [f, id] as [BodyFamily, string]));
const sha = (a: ArrayLike<number>) => createHash('sha256').update(Buffer.from(Float64Array.from(a).buffer)).digest('hex');

describe('neutral standard head', () => {
  it('leaves the default mesh alone: no option and head "egg" give the same five parts and bytes', () => {
    for (const id of BODY_SHAPE_IDS) {
      const m = buildMannequin(bodyShape(id));
      const a = buildMannequinMesh(m);
      const b = buildMannequinMesh(m, { head: 'egg' });
      expect(a.partNames).toEqual(['torso', 'leg_l', 'leg_r', 'arm_l', 'arm_r']);
      expect(sha(b.positions)).toBe(sha(a.positions));
      expect(b.indices).toEqual(a.indices);
    }
  });

  it.each(all)('%s %s: six closed, manifold, outward-facing parts; only the torso above the neck changes', (family, id) => {
    const m = buildMannequin(familyShape(family, id)!);
    const egg = buildMannequinMesh(m);
    const mesh = buildMannequinMesh(m, { head: 'neutral' });
    expect(mesh.partNames).toEqual(['torso', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'head']);
    const t = topology(mesh);
    expect(t.watertight).toBe(true);
    expect(t.components).toBe(6);
    // Legs and arms are the same vertices as in the default mesh.
    for (const part of ['leg_l', 'leg_r', 'arm_l', 'arm_r']) {
      const pick = (x: typeof mesh) => Array.from({ length: vertexCount(x) }, (_, i) => i).filter((i) => x.vertexPart[i] === x.partNames.indexOf(part)).flatMap((i) => vertexAt(x, i));
      expect(pick(mesh)).toEqual(pick(egg));
    }
  });

  it.each(['female', 'male'] as const)('%s: chin and top at the head levels, as wide and deep as a head, mirror-symmetric', (family) => {
    const m = buildMannequin(familyShape(family)!);
    const warp = levelWarp(m.shape.levels);
    const level = (f: number) => (warp ? warp(f) : f) * m.statureCm;
    const head = buildHeadPart(m);
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < head.positions.length; i += 3) {
      xs.push(head.positions[i]!);
      ys.push(head.positions[i + 1]!);
      zs.push(head.positions[i + 2]!);
    }
    expect(Math.min(...ys)).toBeCloseTo(level(HEAD_LEVELS.chin), 6);
    expect(Math.max(...ys)).toBeCloseTo(m.statureCm, 6);
    const k = (m.statureCm - level(HEAD_LEVELS.chin)) / 22;
    // Breadth with the ears 15 to 18.5 cm, depth with the nose 18 to 22.5 cm on the unit head.
    const breadth = (Math.max(...xs) - Math.min(...xs)) / k;
    const depth = (Math.max(...zs) - Math.min(...zs)) / k;
    expect(breadth).toBeGreaterThan(15);
    expect(breadth).toBeLessThan(18.5);
    expect(depth).toBeGreaterThan(18);
    expect(depth).toBeLessThan(22.5);
    expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 6);
    // The neck column of the torso ends inside the head.
    const mesh = buildMannequinMesh(m, { head: 'neutral' });
    const torsoTop = Math.max(...Array.from({ length: vertexCount(mesh) }, (_, i) => i).filter((i) => mesh.vertexPart[i] === 0).map((i) => mesh.positions[3 * i + 1]!));
    expect(torsoTop).toBeGreaterThan(level(HEAD_LEVELS.chin) + 4 * k);
    expect(torsoTop).toBeLessThan(level(HEAD_LEVELS.chin) + 12 * k);
  });

  it('has a face: the nose is the most forward point, the eye sockets are hollows, the lips stand out from the line between them', () => {
    const F = FACE_LEVELS;
    for (const male of [false, true]) {
      expect(faceRelief(0, F.noseTip, male)).toBeGreaterThan(1.4);
      expect(faceRelief(3.2, F.eyes + 0.9, male)).toBeLessThan(-0.1);
      expect(faceRelief(3.2, F.eyes + 0.9, male)).toBeLessThan(faceRelief(3.2, F.brow + 0.5, male) - 0.2);
      expect(faceRelief(0, F.mouth + 0.42, male)).toBeGreaterThan(faceRelief(0, F.mouth, male) + 0.2);
      expect(faceRelief(0, F.mouth - 0.52, male)).toBeGreaterThan(faceRelief(0, F.mouth, male) + 0.2);
      for (const [x, y] of [[1.3, 9], [3, 11], [2, 5], [0.7, 2]] as const) expect(faceRelief(-x, y, male)).toBe(faceRelief(x, y, male));
    }
    const m = buildMannequin(familyShape('female')!);
    const head = buildHeadPart(m);
    let nose = 0;
    for (let i = 0; i < head.positions.length; i += 3) if (head.positions[i + 2]! > head.positions[nose + 2]!) nose = i;
    const k = (m.statureCm - HEAD_LEVELS.chin * m.statureCm) / 22;
    expect(Math.abs(head.positions[nose]!)).toBeLessThan(0.5);
    expect((head.positions[nose + 1]! - HEAD_LEVELS.chin * m.statureCm) / k).toBeGreaterThan(F.noseBase);
    expect((head.positions[nose + 1]! - HEAD_LEVELS.chin * m.statureCm) / k).toBeLessThan(F.noseTip + 1);
  });

  it('is deterministic and follows a typed height', () => {
    const a = buildHeadPart(buildBody({ family: 'female', heightCm: 180 }));
    const b = buildHeadPart(buildBody({ family: 'female', heightCm: 180 }));
    expect(sha(a.positions)).toBe(sha(b.positions));
    expect(Math.max(...a.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(180, 6);
  });
});
