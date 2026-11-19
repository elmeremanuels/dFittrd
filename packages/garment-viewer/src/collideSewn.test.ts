/**
 * `makeCollider`'s `sewn` mode (men-3d-plan slice M3, a one-piece top with sewn sleeves): torso
 * cloth meets the drawn arm and its cap above the shoulder joint, and the top of the legs; without it
 * (every other bundle) nothing changes.
 */
import { describe, expect, it } from 'vitest';
import { buildBody, buildMannequin, familyShape, MALE_REFERENCE } from '@curtain/mannequin';
import { bodyField, IDENTITY_MORPH, makeCollider } from './body';

const m = buildMannequin(familyShape('male', 'M')!);
const field = bodyField(m, IDENTITY_MORPH);
const f = m.arms.left;

/** A point at distance s along the left arm's axis, r out along its u axis (the top of the arm). */
const onArm = (s: number, r: number): Float32Array => Float32Array.from([0, 1, 2].map((d) => f.joint[d]! + f.axis[d]! * s + f.u[d]! * r));

describe('sewn collision', () => {
  it('pushes torso cloth out of the arm cap above the shoulder joint only when sewn', () => {
    const chains = new Uint8Array(1); // body chain
    const p = onArm(-1, 2);
    expect(makeCollider(field, 0.35, chains)(Float32Array.from(p), 0)).toBe(false);
    const q = Float32Array.from(p);
    expect(makeCollider(field, 0.35, chains, undefined, true)(q, 0)).toBe(true);
    const r = [0, 1, 2].map((d) => q[d]! - f.joint[d]!);
    const s = r[0]! * f.axis[0] + r[1]! * f.axis[1] + r[2]! * f.axis[2];
    const radial = Math.hypot(...[0, 1, 2].map((d) => r[d]! - s * f.axis[d]!));
    const a0 = m.armAt(0, 1)!.a;
    // Outside the cone (radius a0·(1 + s/pole) along u) by at least the clearance.
    expect(radial).toBeGreaterThan(a0 * (1 + s / ((0.9 / 1.18) * a0)) + 0.35 - 1e-3);
  });

  it('lets a sleeve particle meet the arm above the armpit only when sewn; a particle outside is never moved', () => {
    const chains = Uint8Array.from([1]);
    const p = onArm(3, 1);
    expect(makeCollider(field, 0.35, chains)(Float32Array.from(p), 0)).toBe(false);
    expect(makeCollider(field, 0.35, chains, undefined, true)(Float32Array.from(p), 0)).toBe(true);
    const out = onArm(3, 12);
    const copy = Float32Array.from(out);
    expect(makeCollider(field, 0.35, chains, undefined, true)(copy, 0)).toBe(false);
    expect(Array.from(copy)).toEqual(Array.from(out));
  });

  it('keeps a leg’s rounded top above its last section when sewn (the hip ledge of a large body)', () => {
    const r = MALE_REFERENCE.XXL;
    const big = buildBody({ family: 'male', bust: r.chest, waist: r.waist, hip: r.hip, heightCm: r.stature, shoulderCm: r.shoulderWidth });
    const bigField = bodyField(big, IDENTITY_MORPH);
    let top = 0;
    for (let y = 60; y < 110; y += 0.05) if (big.legAt(y, 1)) top = y;
    const l = big.legAt(top, 1)!;
    const p = Float32Array.from([l.cx + l.a, top + 0.6, l.cz]);
    // The leg's top ring stands out of the hips here: outside the torso at that height.
    const t = big.torsoAt(top + 0.6)!;
    expect((p[0]! / t.a) ** 2 + (p[2]! / t.b) ** 2).toBeGreaterThan(1.05);
    expect(makeCollider(bigField, 0.35, new Uint8Array(1))(Float32Array.from(p), 0)).toBe(false);
    expect(makeCollider(bigField, 0.35, new Uint8Array(1), undefined, true)(Float32Array.from(p), 0)).toBe(true);
  });
});
