/**
 * Collision against the drawn outline of a body whose sections are not ellipses (the male shape v2,
 * `Table.polar`): cloth is pushed out to the body that is drawn, not to the ellipse round it; a v1
 * body's field carries no outline and collides as before.
 */
import { describe, expect, it } from 'vitest';
import { buildBody, buildMannequin, familyShape, MALE_REFERENCE, polarRadius } from '@curtain/mannequin';
import { bodyField, IDENTITY_MORPH, liftField, makeCollider } from './body';
import { polarGirth, pushOutOfPolar, samplePolar } from './collide';

const v1 = buildMannequin(familyShape('male', 'M')!);
const m = buildMannequin(familyShape('male', 'M')!, { maleShape: 'v2' });
const field = bodyField(m, IDENTITY_MORPH);
const body = new Uint8Array(1);

describe('collision with the drawn outline (male shape v2)', () => {
  it('only a body with outlines carries them', () => {
    const f1 = bodyField(v1, IDENTITY_MORPH);
    expect(f1.torso.polar).toBeUndefined();
    expect(f1.legs[0].polar).toBeUndefined();
    expect(f1.arms[0].polar).toBeUndefined();
    expect(field.torso.polar).toBeDefined();
    expect(field.legs[1].polar).toBeDefined();
    expect(field.arms[1].polar).toBeDefined();
  });

  it('the table is the outline: radius, girth (the chest ring’s, where the ellipse is 3 cm longer), and a lifted field moves with it', () => {
    const y = m.morphHeights.chest;
    const o = m.outlines!.torso(y)!;
    const out = new Float32Array(4);
    for (const phi of [0, 0.7, 1.6, 3.1, 4.4]) {
      expect(samplePolar(field.torso.polar!, y, o.cx + Math.cos(phi), o.cz + Math.sin(phi), out)).toBe(true);
      expect(out[2]).toBeCloseTo(polarRadius(o.r, phi), 1);
    }
    const chest = m.rings.find((r) => r.id === 'chest')!.circumferenceCm;
    expect(Math.abs(polarGirth(field.torso.polar!, y) - chest)).toBeLessThan(0.6);
    expect(polarGirth(field.torso.polar!, y, 0.35)).toBeGreaterThan(polarGirth(field.torso.polar!, y) + 2);
    expect(polarGirth(field.torso.polar!, m.statureCm + 10)).toBeNaN();
    const up = liftField(field, 5);
    expect(samplePolar(up.torso.polar!, y + 5, 30, 0, out)).toBe(true);
    expect(out[2]).toBeCloseTo(polarRadius(o.r, 0), 1);
    expect(pushOutOfPolar(field.torso.polar!, m.statureCm + 10, 0, 0, 0.35, out)).toBeNull();
  });

  it('pushes a point inside the body out to the outline plus the clearance, and leaves alone a point that is outside the body but inside the ellipse round it', () => {
    const y = m.morphHeights.hip;
    const o = m.outlines!.torso(y)!;
    const e = m.torsoAt(y)!;
    const collide = makeCollider(field, 0.35, body);
    // Straight in front of the seat: the seat lies behind, so the ellipse (centred, symmetric) reaches well in front of the body.
    const front = polarRadius(o.r, Math.PI / 2);
    expect(e.b - front).toBeGreaterThan(2);
    const between = Float32Array.from([0, y, o.cz + front + 1]);
    expect((between[2]! - e.cz) / e.b).toBeLessThan(1);
    expect(collide(between, 0)).toBe(false);
    const inside = Float32Array.from([0, y, o.cz + front - 2]);
    expect(collide(inside, 0)).toBe(true);
    expect(inside[2]! - o.cz).toBeCloseTo(front + 0.35, 1);
    // The same point against the v1 body's ellipse is pushed, as before.
    const t = v1.torsoAt(v1.morphHeights.hip)!;
    const p = Float32Array.from([0, v1.morphHeights.hip, t.cz + t.b - 1]);
    expect(makeCollider(bodyField(v1, IDENTITY_MORPH), 0.35, body)(p, 0)).toBe(true);
    expect(p[2]! - t.cz).toBeCloseTo(t.b + 0.35, 2);
  });

  it('a sewn sleeve meets the drawn arm, its deltoid included, and torso cloth the cap above the joint', () => {
    const r = MALE_REFERENCE.XL;
    const big = buildBody({ family: 'male', bust: r.chest, waist: r.waist, hip: r.hip, heightCm: r.stature, shoulderCm: r.shoulderWidth }, { maleShape: 'v2' });
    const f = big.arms.left;
    const bf = bodyField(big, IDENTITY_MORPH);
    const s = 5;
    const o = big.outlines!.arm(s, 1)!;
    // On the outer side (+u on the left arm) the deltoid stands out of the plain arm.
    const outer = o.cx + polarRadius(o.r, 0);
    const at = (rad: number): Float32Array => Float32Array.from([0, 1, 2].map((d) => f.joint[d]! + f.axis[d]! * s + f.u[d]! * rad));
    const p = at(outer - 0.5);
    expect(makeCollider(bf, 0.35, Uint8Array.from([1]), undefined, true)(p, 0)).toBe(true);
    const d = [0, 1, 2].map((k) => p[k]! - f.joint[k]!);
    expect(d[0]! * f.u[0] + d[1]! * f.u[1] + d[2]! * f.u[2]).toBeGreaterThan(outer + 0.35 - 0.05);
    const clear = at(outer + 1);
    const copy = Float32Array.from(clear);
    expect(makeCollider(bf, 0.35, Uint8Array.from([1]), undefined, true)(copy, 0)).toBe(false);
    expect(Array.from(copy)).toEqual(Array.from(clear));
    // Torso cloth just above the joint, inside the cap: moved only when sewn.
    const cap = big.outlines!.arm(-1, 1)!;
    const q = Float32Array.from([0, 1, 2].map((k) => f.joint[k]! - f.axis[k]! + f.u[k]! * cap.cx + f.v[k]! * (cap.cz + 0.5 * polarRadius(cap.r, Math.PI / 2))));
    expect(makeCollider(bf, 0.35, body, undefined, true)(Float32Array.from(q), 0)).toBe(true);
  });
});
