import { describe, expect, it } from 'vitest';
import { ellipseCircumference, ellipseFromCircumference, ellipseRingPoints, girthFromWidthDepth, scaleEllipseToCircumference } from './index';

/** Reference perimeter by numerical integration of √(a² cos² t + b² sin² t) (Simpson, 20 000 steps). */
function numericPerimeter(a: number, b: number): number {
  const n = 20000;
  const f = (t: number): number => Math.sqrt(a * a * Math.cos(t) ** 2 + b * b * Math.sin(t) ** 2);
  const h = (Math.PI / 2) / n;
  let s = f(0) + f(Math.PI / 2);
  for (let i = 1; i < n; i++) s += (i % 2 === 0 ? 2 : 4) * f(i * h);
  return 4 * (s * h) / 3;
}

describe('ellipseCircumference (Ramanujan II)', () => {
  it('is exact for a circle; close to 4a in the flat limit', () => {
    expect(ellipseCircumference(10, 10)).toBeCloseTo(2 * Math.PI * 10, 10);
    expect(Math.abs(ellipseCircumference(5, 0) - 20) / 20).toBeLessThan(0.005);
    expect(ellipseCircumference(0, 0)).toBe(0);
  });

  it('matches numerical integration within 1e-5 relative for body aspects (0.5..1), 1e-4 at 0.3', () => {
    for (const [a, b] of [
      [16, 11.5],
      [20, 10],
      [15, 14],
      [6, 6],
      [10, 9.5],
    ] as const) {
      const ref = numericPerimeter(a, b);
      expect(Math.abs(ellipseCircumference(a, b) - ref) / ref).toBeLessThan(1e-5);
    }
    const ref = numericPerimeter(22, 7);
    expect(Math.abs(ellipseCircumference(22, 7) - ref) / ref).toBeLessThan(1e-4);
  });

  it('is symmetric and homogeneous of degree one', () => {
    expect(ellipseCircumference(16, 11)).toBeCloseTo(ellipseCircumference(11, 16), 12);
    expect(ellipseCircumference(32, 22)).toBeCloseTo(2 * ellipseCircumference(16, 11), 10);
  });

  it('agrees with the capture formula (π(3(a+b) − √((3a+b)(a+3b))))', () => {
    const a = 15.3;
    const b = 10.1;
    expect(ellipseCircumference(a, b)).toBe(Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))));
  });

  it('returns NaN for invalid input', () => {
    expect(ellipseCircumference(-1, 2)).toBeNaN();
    expect(ellipseCircumference(1, Number.NaN)).toBeNaN();
    expect(ellipseCircumference(Number.POSITIVE_INFINITY, 2)).toBeNaN();
  });

  it('girthFromWidthDepth uses full axes', () => {
    expect(girthFromWidthDepth(32, 23)).toBe(ellipseCircumference(16, 11.5));
    expect(girthFromWidthDepth(-2, 4)).toBeNaN();
  });
});

describe('ellipseFromCircumference', () => {
  it('inverts ellipseCircumference and keeps the aspect', () => {
    for (const c of [30, 36.5, 74, 92, 101.2, 140]) {
      for (const aspect of [0.5, 0.72, 0.78, 0.95, 1, 1.4]) {
        const e = ellipseFromCircumference(c, aspect);
        expect(ellipseCircumference(e.a, e.b)).toBeCloseTo(c, 9);
        expect(e.b / e.a).toBeCloseTo(aspect, 12);
      }
    }
  });

  it('a circle from its circumference', () => {
    const e = ellipseFromCircumference(2 * Math.PI * 5, 1);
    expect(e.a).toBeCloseTo(5, 12);
    expect(e.b).toBeCloseTo(5, 12);
  });

  it('zero circumference → zero axes; invalid → NaN', () => {
    expect(ellipseFromCircumference(0, 0.7)).toEqual({ a: 0, b: 0 });
    for (const [c, k] of [
      [-1, 0.7],
      [90, 0],
      [90, -0.5],
      [Number.NaN, 0.7],
      [90, Number.POSITIVE_INFINITY],
    ] as const) {
      const e = ellipseFromCircumference(c, k);
      expect(e.a).toBeNaN();
      expect(e.b).toBeNaN();
    }
  });

  it('scaleEllipseToCircumference keeps the aspect and hits the target', () => {
    const e = scaleEllipseToCircumference({ a: 16, b: 11.5 }, 100);
    expect(ellipseCircumference(e.a, e.b)).toBeCloseTo(100, 9);
    expect(e.b / e.a).toBeCloseTo(11.5 / 16, 12);
    // Uniform scale: s = target / current.
    const s = 100 / ellipseCircumference(16, 11.5);
    expect(e.a).toBeCloseTo(16 * s, 10);
    expect(scaleEllipseToCircumference({ a: 0, b: 1 }, 50).a).toBeNaN();
  });
});

describe('ellipseRingPoints', () => {
  it('returns n points on the ellipse starting at the front centre', () => {
    const e = { a: 16, b: 11 };
    const pts = ellipseRingPoints(e, 8);
    expect(pts).toHaveLength(8);
    expect(pts[0]!.x).toBeCloseTo(0, 12);
    expect(pts[0]!.z).toBeCloseTo(11, 12);
    expect(pts[2]!.x).toBeCloseTo(16, 12);
    expect(pts[2]!.z).toBeCloseTo(0, 12);
    for (const p of pts) expect((p.x / e.a) ** 2 + (p.z / e.b) ** 2).toBeCloseTo(1, 12);
  });

  it('the polygon perimeter converges to the circumference', () => {
    const e = { a: 16, b: 11 };
    const pts = ellipseRingPoints(e, 2000);
    let per = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      per += Math.hypot(q.x - p.x, q.z - p.z);
    }
    expect(per / ellipseCircumference(e.a, e.b)).toBeCloseTo(1, 5);
  });

  it('invalid n or axes → []', () => {
    expect(ellipseRingPoints({ a: 1, b: 1 }, 0)).toEqual([]);
    expect(ellipseRingPoints({ a: 1, b: 1 }, 2.5)).toEqual([]);
    expect(ellipseRingPoints({ a: -1, b: 1 }, 4)).toEqual([]);
  });
});
