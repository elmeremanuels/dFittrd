import { describe, expect, it } from 'vitest';
import { buildMannequinMesh, loopAround, loopLength, slice, type Vec3 } from '@curtain/mannequin';
import { measureRing } from './anchoring';
import { fixtureMannequin as m, reconstructedDress, syntheticDress } from './evalFixtures';
import { densifyLoop, pointsOfPart, tapeGirth } from './tape';

const C: Vec3 = [0, 100, 0];
const U: Vec3 = [1, 0, 0];
const V: Vec3 = [0, 0, 1];
/** Ellipse a × b round C in the XZ plane, `n` points, with radial `noise(θ)` cm, from θ0 to θ1. */
function ellipse(a: number, b: number, n: number, noise = (_t: number) => 0, t0 = 0, t1 = 2 * Math.PI): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / n;
    const r = (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t)) + noise(t);
    return [C[0] + r * Math.cos(t), C[1], C[2] + r * Math.sin(t)];
  });
}
const perimeter = (a: number, b: number): number => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); // Ramanujan

describe('tapeGirth', () => {
  it('equals the perimeter of a smooth convex section', () => {
    const t = tapeGirth(ellipse(17, 12, 400), C, U, V)!;
    expect(Math.abs(t.girthCm - perimeter(17, 12)) / perimeter(17, 12)).toBeLessThan(0.005);
    expect(t.coverage).toBe(1);
  });

  it('ignores reconstruction ripples that make the polyline far too long', () => {
    const rippled = ellipse(17, 12, 1200, (t) => 1.2 * Math.sin(40 * t));
    const poly = loopLength({ points: rippled, closed: true });
    const t = tapeGirth(rippled, C, U, V)!;
    expect(poly - perimeter(17, 12)).toBeGreaterThan(15); // the first method's error on run 14's hip was of this kind
    expect(Math.abs(t.girthCm - perimeter(17, 12))).toBeLessThan(2.5); // at most the ripple's outward amplitude
  });

  it('bridges a small hole, refuses an open front and too little cloth', () => {
    const hole = ellipse(17, 12, 400, undefined, 0.05, 2 * Math.PI); // ~3° missing
    expect(tapeGirth(hole, C, U, V)).not.toBeNull();
    const front = ellipse(17, 12, 400, undefined, Math.PI / 2 + 0.25, Math.PI / 2 - 0.25 + 2 * Math.PI); // 6 cm open at +Z
    const r = tapeGirth(front, C, U, V);
    expect(r).toBeNull();
    expect(tapeGirth(ellipse(17, 12, 100, undefined, 0, Math.PI), C, U, V)).toBeNull();
  });

  it('bridges a stretch where the cloth belongs to another body part (a tape under the arm)', () => {
    const all = ellipse(17, 12, 400);
    const own = all.filter((p) => Math.abs(p[0]) < 15); // the sides were assigned to the arms
    expect(tapeGirth(own, C, U, V)).toBeNull(); // judged on its own points: two wide gaps
    const t = tapeGirth(own, C, U, V, {}, all)!;
    expect(Math.abs(t.girthCm - perimeter(17, 12))).toBeLessThan(2);
  });

  it('bridges an outerwear front opening only at the front and only when asked (fronts laid closed)', () => {
    // A cardigan at the chest: an ellipse with 70-110 degrees (the front, +v) missing: an 8 cm wide V.
    const open = ellipse(17, 12, 400, () => 0, (110 * Math.PI) / 180, ((70 + 360) * Math.PI) / 180);
    expect(tapeGirth(open, C, U, V)).toBeNull();
    const t = tapeGirth(open, C, U, V, { frontOpeningCm: 30 })!;
    expect(t.frontGapCm!).toBeGreaterThan(6);
    expect(t.frontGapCm!).toBeLessThan(10);
    expect(t.maxGapCm).toBe(0);
    expect(t.coverage).toBe(1);
    // Bridged by the radius interpolated across the gap (as any bridged hole): the closed garment's girth within 0.5 cm.
    const closed = tapeGirth(ellipse(17, 12, 400), C, U, V)!.girthCm;
    expect(Math.abs(t.girthCm - closed)).toBeLessThan(0.5);
    // The same gap at the back is not a front opening; nor is one wider than the limit.
    const back = ellipse(17, 12, 400, () => 0, (290 * Math.PI) / 180, ((250 + 360) * Math.PI) / 180);
    expect(tapeGirth(back, C, U, V, { frontOpeningCm: 30 })).toBeNull();
    expect(tapeGirth(open, C, U, V, { frontOpeningCm: 5 })).toBeNull();
  });

  it('densifies a loop so a long edge is not a gap', () => {
    const d = densifyLoop({ points: [[0, 0, 0], [2, 0, 0], [2, 0, 2]], closed: true }, 0.5);
    expect(d.points.length).toBe(4 + 4 + 6);
    expect(d.points[1]).toEqual([0.5, 0, 0]);
  });
});

describe('measureRing with the tape', () => {
  it('gives the loop length on the smooth synthetic dress at the torso rings', () => {
    const dress = syntheticDress();
    const body = buildMannequinMesh(m);
    for (const id of ['chest', 'waist', 'hip'] as const) {
      const ring = m.rings.find((r) => r.id === id)!;
      const loop = measureRing(dress, ring)!;
      const tape = measureRing(dress, ring, { girth: 'tape', body })!;
      expect(Math.abs(tape.circumferenceCm - loop.circumferenceCm), id).toBeLessThan(0.6);
      expect(tape.tape!.loopLengthCm).toBeCloseTo(loop.circumferenceCm, 6);
    }
  });

  it('measures the sleeve, not the torso, at the upper arm, and keeps the arms out of the chest', () => {
    const dress = reconstructedDress();
    const body = buildMannequinMesh(m);
    const arm = m.rings.find((r) => r.id === 'upper_arm')!;
    const t = measureRing(dress, arm, { girth: 'tape', body })!;
    expect(t.circumferenceCm).toBeGreaterThan(arm.circumferenceCm);
    expect(t.circumferenceCm).toBeLessThan(arm.circumferenceCm * 2);
    const chest = m.rings.find((r) => r.id === 'chest')!;
    const loops = slice(body.positions, body.indices, { origin: chest.centre, normal: chest.normal });
    const own = loopAround(loops, chest.centre, chest.u, chest.v)!;
    const armPts = loops.filter((l) => l !== own).flatMap((l) => l.points);
    expect(pointsOfPart([{ points: armPts, closed: false }], loops, own)).toEqual([]);
  });
});
