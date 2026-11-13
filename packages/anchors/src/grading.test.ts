import { describe, expect, it } from 'vitest';
import {
  ANCHOR_CHAINS,
  ANCHOR_RINGS,
  NOMINAL_RING_HEIGHTS,
  anchorScale,
  ellipseCircumference,
  ellipseFromCircumference,
  gradeSizes,
  gradingMorph,
  monotoneProfile,
  scaleEllipseToCircumference,
  type AnchorValues,
} from './index';

const BASE_M: AnchorValues = { chest: 92, underbust: 78, waist: 74, hip: 100, shoulder_to_hem: 118, sleeve: 60 };
const TARGET_L: AnchorValues = { chest: 97, underbust: 83, waist: 79, hip: 105, shoulder_to_hem: 120, sleeve: 61 };

describe('anchorScale', () => {
  it('target / base for usable values, undefined otherwise', () => {
    expect(anchorScale(80, 100)).toBe(1.25);
    expect(anchorScale(undefined, 100)).toBeUndefined();
    expect(anchorScale(80, undefined)).toBeUndefined();
    expect(anchorScale(0, 100)).toBeUndefined();
    expect(anchorScale(80, 0)).toBeUndefined();
    expect(anchorScale(80, -3)).toBeUndefined();
    expect(anchorScale(Number.NaN, 100)).toBeUndefined();
    expect(anchorScale(80, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('monotoneProfile', () => {
  it('no knots → 1, one knot → constant', () => {
    expect(monotoneProfile([])(0.5)).toBe(1);
    const one = monotoneProfile([{ x: 0.6, y: 1.07 }]);
    expect(one(0)).toBe(1.07);
    expect(one(5)).toBe(1.07);
  });

  it('interpolates the knots exactly, in any input order', () => {
    const knots = [
      { x: 0.62, y: 1.05 },
      { x: 0.72, y: 1.02 },
      { x: 0.52, y: 1.08 },
      { x: 0.43, y: 1.03 },
    ];
    const f = monotoneProfile(knots);
    for (const k of knots) expect(f(k.x)).toBeCloseTo(k.y, 14);
  });

  it('clamps beyond the ends', () => {
    const f = monotoneProfile([
      { x: 1, y: 2 },
      { x: 2, y: 3 },
    ]);
    expect(f(-10)).toBe(2);
    expect(f(10)).toBe(3);
    expect(f(Number.NaN)).toBeNaN();
  });

  it('never leaves the range of the two neighbouring knots (no overshoot)', () => {
    const knots = [
      { x: 0, y: 1 },
      { x: 1, y: 1.2 },
      { x: 1.3, y: 1.21 },
      { x: 3, y: 0.9 },
      { x: 3.1, y: 1.4 },
      { x: 5, y: 1.4 },
    ];
    const f = monotoneProfile(knots);
    for (let k = 0; k < knots.length - 1; k++) {
      const lo = Math.min(knots[k]!.y, knots[k + 1]!.y);
      const hi = Math.max(knots[k]!.y, knots[k + 1]!.y);
      for (let i = 0; i <= 200; i++) {
        const x = knots[k]!.x + ((knots[k + 1]!.x - knots[k]!.x) * i) / 200;
        const v = f(x);
        expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(v).toBeLessThanOrEqual(hi + 1e-12);
      }
    }
  });

  it('is monotone on monotone data', () => {
    const f = monotoneProfile([
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: 5 },
      { x: 2.2, y: 5.01 },
      { x: 4, y: 9 },
    ]);
    let prev = -Infinity;
    for (let i = 0; i <= 400; i++) {
      const v = f(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it('is continuous with a continuous first derivative (C1), including at knots and ends', () => {
    const knots = [
      { x: 0.05, y: 1.01 },
      { x: 0.28, y: 1.03 },
      { x: 0.43, y: 1.06 },
      { x: 0.52, y: 1.05 },
      { x: 0.62, y: 1.07 },
      { x: 0.72, y: 1.054 },
    ];
    const f = monotoneProfile(knots);
    const eps = 1e-6;
    const slope = (x: number): number => (f(x + eps) - f(x - eps)) / (2 * eps);
    for (const { x } of knots) {
      expect(Math.abs(f(x + 1e-9) - f(x - 1e-9))).toBeLessThan(1e-7);
      const left = (f(x) - f(x - 1e-5)) / 1e-5;
      const right = (f(x + 1e-5) - f(x)) / 1e-5;
      expect(Math.abs(left - right)).toBeLessThan(1e-2);
    }
    // Zero end slopes join the constant extrapolation smoothly.
    expect(Math.abs(slope(0.05))).toBeLessThan(1e-3);
    expect(Math.abs(slope(0.72))).toBeLessThan(1e-3);
  });

  it('linear data with even spacing stays linear inside', () => {
    const f = monotoneProfile([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    expect(f(1.5)).toBeCloseTo(1.5, 12);
  });

  it('drops non-finite knots and keeps the first of duplicate positions', () => {
    const f = monotoneProfile([
      { x: 0, y: 1 },
      { x: Number.NaN, y: 9 },
      { x: 1, y: 2 },
      { x: 1, y: 7 },
      { x: 2, y: Number.POSITIVE_INFINITY },
    ]);
    expect(f(1)).toBe(2);
    expect(f(5)).toBe(2);
  });
});

describe('gradingMorph', () => {
  it('returns target / base per anchor', () => {
    const m = gradingMorph(BASE_M, TARGET_L);
    expect(m.scales).toEqual({ chest: 97 / 92, underbust: 83 / 78, waist: 79 / 74, hip: 105 / 100, shoulder_to_hem: 120 / 118, sleeve: 61 / 60 });
    expect(m.missing).toEqual([]);
  });

  it('scaling a ring ellipse by the scale reaches the target girth exactly', () => {
    const m = gradingMorph(BASE_M, TARGET_L);
    for (const ring of ['chest', 'underbust', 'waist', 'hip'] as const) {
      const e = ellipseFromCircumference(BASE_M[ring]!, 0.72);
      const s = m.scales[ring]!;
      expect(ellipseCircumference(e.a * s, e.b * s)).toBeCloseTo(TARGET_L[ring]!, 9);
      const direct = scaleEllipseToCircumference(e, TARGET_L[ring]!);
      expect(direct.a).toBeCloseTo(e.a * s, 10);
    }
  });

  it('lists anchors known on one side only as missing, in D15 order, and ignores anchors on neither side', () => {
    const m = gradingMorph({ chest: 92, waist: 74, inseam: 80, knee: 0 }, { chest: 96, hip: 104, knee: 40, inseam: 81 });
    expect(m.scales).toEqual({ chest: 96 / 92, inseam: 81 / 80 });
    expect(m.missing).toEqual(['waist', 'hip', 'knee']);
  });

  it('identity when target equals base: scale 1 everywhere on every chain', () => {
    const m = gradingMorph(BASE_M, BASE_M);
    for (const s of Object.values(m.scales)) expect(s).toBe(1);
    for (let h = 0; h <= 1; h += 0.01) {
      expect(m.girthScaleAt(h)).toBeCloseTo(1, 14);
      expect(m.girthScaleAt(h, 'arm')).toBe(1);
    }
  });

  it('girthScaleAt hits each ring at its nominal height and blends between neighbours', () => {
    const m = gradingMorph(BASE_M, TARGET_L);
    for (const ring of ['chest', 'underbust', 'waist', 'hip'] as const) {
      expect(m.girthScaleAt(NOMINAL_RING_HEIGHTS[ring])).toBeCloseTo(m.scales[ring]!, 14);
    }
    const mid = (NOMINAL_RING_HEIGHTS.waist + NOMINAL_RING_HEIGHTS.hip) / 2;
    const v = m.girthScaleAt(mid);
    expect(v).toBeGreaterThanOrEqual(Math.min(m.scales.waist!, m.scales.hip!));
    expect(v).toBeLessThanOrEqual(Math.max(m.scales.waist!, m.scales.hip!));
    // Above the top graded ring and below the bottom one: the end ring's scale.
    expect(m.girthScaleAt(0.95)).toBeCloseTo(m.scales.chest!, 14);
    expect(m.girthScaleAt(0.1)).toBeCloseTo(m.scales.hip!, 14);
  });

  it('length anchors take no part in the girth profile; the arm chain without arm rings is 1', () => {
    const m = gradingMorph({ chest: 90, sleeve: 50 }, { chest: 99, sleeve: 100 });
    expect(m.girthScaleAt(0.3)).toBeCloseTo(1.1, 14);
    expect(m.girthScaleAt(0.6, 'arm')).toBe(1);
  });

  it('arm chain interpolates upper_arm → wrist', () => {
    const m = gradingMorph({ upper_arm: 28, wrist: 15 }, { upper_arm: 30.8, wrist: 15.75 });
    expect(m.girthScaleAt(NOMINAL_RING_HEIGHTS.upper_arm, 'arm')).toBeCloseTo(1.1, 12);
    expect(m.girthScaleAt(NOMINAL_RING_HEIGHTS.wrist, 'arm')).toBeCloseTo(1.05, 12);
    const v = m.girthScaleAt(0.59, 'arm');
    expect(v).toBeGreaterThan(1.05);
    expect(v).toBeLessThan(1.1);
    // Arm rings never leak into the body chain.
    expect(m.girthScaleAt(0.6)).toBe(1);
  });

  it('custom heights replace the nominal table (e.g. mannequin cm)', () => {
    const heights = { chest: 126, waist: 108, hip: 92 };
    const m = gradingMorph({ chest: 90, waist: 70, hip: 100 }, { chest: 99, waist: 73.5, hip: 103 }, { heights });
    expect(m.girthScaleAt(126)).toBeCloseTo(1.1, 12);
    expect(m.girthScaleAt(108)).toBeCloseTo(1.05, 12);
    expect(m.girthScaleAt(92)).toBeCloseTo(1.03, 12);
    // A ring without a height is ignored by the profile but keeps its scale.
    const n = gradingMorph({ chest: 90, knee: 40 }, { chest: 99, knee: 44 }, { heights: { chest: 126 } });
    expect(n.scales.knee).toBeCloseTo(1.1, 12);
    expect(n.girthScaleAt(10)).toBeCloseTo(1.1, 12);
  });

  it('nominal heights strictly decrease down each chain and lie in (0, 1)', () => {
    for (const chain of Object.values(ANCHOR_CHAINS)) {
      for (let i = 1; i < chain.length; i++) expect(NOMINAL_RING_HEIGHTS[chain[i]!]).toBeLessThan(NOMINAL_RING_HEIGHTS[chain[i - 1]!]);
    }
    for (const r of ANCHOR_RINGS) {
      expect(NOMINAL_RING_HEIGHTS[r]).toBeGreaterThan(0);
      expect(NOMINAL_RING_HEIGHTS[r]).toBeLessThan(1);
    }
    // Every ring sits on exactly one chain.
    expect([...ANCHOR_CHAINS.body, ...ANCHOR_CHAINS.arm].sort()).toEqual([...ANCHOR_RINGS].sort());
  });

  it('does not mutate its inputs', () => {
    const base = Object.freeze({ ...BASE_M });
    const target = Object.freeze({ ...TARGET_L });
    expect(() => gradingMorph(base, target).girthScaleAt(0.5)).not.toThrow();
  });
});

describe('gradeSizes', () => {
  const sizes = [
    { size: 'S', target: { chest: 87, waist: 69, hip: 95 } },
    { size: 'M', target: { chest: 92, waist: 74, hip: 100 } },
    { size: 'L', target: { chest: 97, waist: 79, hip: 105 } },
  ];

  it('one morph per size in chart order; the base size is the identity', () => {
    const out = gradeSizes({ chest: 92, waist: 74, hip: 100 }, sizes);
    expect(out.map((s) => s.size)).toEqual(['S', 'M', 'L']);
    expect(out[1]!.scales).toEqual({ chest: 1, waist: 1, hip: 1 });
    expect(out[0]!.scales.chest).toBeCloseTo(87 / 92, 14);
    // Girth scale at any height grows with the size.
    for (const h of [0.45, 0.52, 0.57, 0.62, 0.67, 0.72]) {
      expect(out[0]!.girthScaleAt(h)).toBeLessThan(out[1]!.girthScaleAt(h));
      expect(out[1]!.girthScaleAt(h)).toBeLessThan(out[2]!.girthScaleAt(h));
    }
  });

  it('rejects duplicate size labels (trimmed, case-insensitive)', () => {
    expect(() => gradeSizes({ chest: 92 }, [...sizes, { size: 'M', target: { chest: 93 } }])).toThrow(/Duplicate size label "M"/);
    expect(() => gradeSizes({ chest: 92 }, [{ size: 'm', target: {} }, { size: ' M ', target: {} }])).toThrow(RangeError);
    expect(gradeSizes({ chest: 92 }, [])).toEqual([]);
  });
});
