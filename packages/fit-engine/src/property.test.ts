/** T16 purity + property tests: 1000 random bodies never throw, score ∈ [0,1] | null, inputs untouched. */
import { MOCK_GARMENTS, FIT_POINTS } from '@paskamer/schema';
import type { UserBody } from '@paskamer/schema';
import { describe, expect, it } from 'vitest';
import { computeFit } from './computeFit';
import { JEANS, REF, SLIP, WRAP, deepFreeze, rng } from './test/fixtures';
import { isPointFit, type FitGarment } from './types';

function randomBody(next: () => number): UserBody {
  const m: UserBody['measurements'] = {};
  const c: NonNullable<UserBody['confidence']> = {};
  const ranges: Record<string, [number, number]> = {
    bust: [60, 140],
    waist: [50, 130],
    hip: [70, 150],
    shoulder: [30, 55],
    thigh: [40, 80],
    inseam: [60, 95],
    footLengthCm: [20, 30],
    footEu: [34, 46],
  };
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    if (next() < 0.8) (m as Record<string, number>)[key] = Math.round((lo + next() * (hi - lo)) * 10) / 10;
  }
  for (const p of FIT_POINTS) if (next() < 0.5) c[p] = Math.round(next() * 100) / 100;
  const body: UserBody = { measurements: m };
  if (next() < 0.7) body.confidence = c;
  if (next() < 0.3) body.history = [{ brand: 'Aalter Studio', size: 'M', kept: next() < 0.5 }];
  return body;
}

function assertSane(result: ReturnType<typeof computeFit>, chartLength: number) {
  expect(result.perSize).toHaveLength(chartLength);
  for (const s of result.perSize) {
    if (s.score !== null) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.score)).toBe(true);
    }
    for (const p of s.points) {
      if (isPointFit(p)) {
        expect(Number.isFinite(p.gapCm)).toBe(true);
        expect(p.score).toBeGreaterThanOrEqual(0);
        expect(p.score).toBeLessThanOrEqual(1);
      }
    }
  }
  expect(result.confidence).toBeGreaterThanOrEqual(0);
  expect(result.confidence).toBeLessThanOrEqual(1);
  if (result.score !== null) {
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  }
  if (chartLength > 0) expect(result.closestSize).not.toBeNull();
  if (result.recommendedSize !== null) expect(result.closestSize).toBe(result.recommendedSize);
  expect(result.notes.length).toBeGreaterThan(0);
  if (result.fits) expect(result.recommendedSize).not.toBeNull();
}

describe('T16 purity', () => {
  it('deep-frozen inputs, two calls → equal results, inputs unchanged', () => {
    for (const g of [WRAP, SLIP, JEANS]) {
      const garment = deepFreeze(structuredClone(g));
      const user = deepFreeze(structuredClone(REF));
      const before = JSON.stringify({ garment, user });
      const a = computeFit(garment, user);
      const b = computeFit(garment, user);
      expect(a).toEqual(b);
      expect(JSON.stringify({ garment, user })).toBe(before);
    }
  });

  it('1000 random bodies × the three spec garments never throw and give sane scores', () => {
    const next = rng(20261104);
    const garments = [WRAP, SLIP, JEANS].map((g) => deepFreeze(structuredClone(g)));
    for (let i = 0; i < 1000; i++) {
      const body = deepFreeze(randomBody(next));
      const g = garments[i % garments.length]!;
      const r = computeFit(g, body);
      assertSane(r, g.sizeChart.length);
      const again = computeFit(g, body);
      expect(again).toEqual(r);
    }
  });

  it('1000 random bodies × every MOCK_GARMENTS fixture never throw (with and without sigma)', () => {
    const next = rng(42);
    const frozen = MOCK_GARMENTS.map((g) => deepFreeze(structuredClone(g)));
    expect(frozen.length).toBeGreaterThan(0);
    for (let i = 0; i < 1000; i++) {
      const g = frozen[i % frozen.length]!;
      const body = deepFreeze(randomBody(next));
      assertSane(computeFit(g, body), g.sizeChart.length);
      const sigma: Record<string, number> = {};
      for (const p of FIT_POINTS) if (next() < 0.6) sigma[p] = next() * 6;
      assertSane(computeFit(g, body, { sigma: deepFreeze(sigma) }), g.sizeChart.length);
    }
  });

  it('garbage garments do not throw', () => {
    const next = rng(7);
    const categories = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'hat', '', undefined];
    for (let i = 0; i < 300; i++) {
      const rows = Array.from({ length: Math.floor(next() * 4) }, (_, k) => ({
        size: next() < 0.9 ? `S${k}` : (undefined as unknown as string),
        bust: next() < 0.5 ? next() * 200 - 20 : undefined,
        waist: next() < 0.5 ? Number.NaN : next() * 100,
        hip: next() < 0.5 ? Infinity : 90,
        footEu: next() < 0.3 ? 38 : undefined,
      }));
      const g = {
        id: 'x',
        brand: next() < 0.5 ? 'B' : (undefined as unknown as string),
        category: categories[Math.floor(next() * categories.length)] as FitGarment['category'],
        patternBlock: next() < 0.5 ? 'wrap' : (undefined as unknown as string),
        fabric: next() < 0.8 ? { stretchPct: next() < 0.5 ? Number.NaN : next() * 120 - 20 } : (undefined as unknown as FitGarment['fabric']),
        ease: next() < 0.5 ? { bust: Number.NaN, waist: -30 } : undefined,
        sizeChart: next() < 0.9 ? rows : (undefined as unknown as FitGarment['sizeChart']),
        sizeChartType: next() < 0.5 ? 'body' : ('nonsense' as 'garment'),
        criticalFitPoints: next() < 0.5 ? (['waist', 'nose'] as FitGarment['criticalFitPoints']) : undefined,
        stretchZones: next() < 0.5 ? ['waist-tie', 42 as unknown as string] : undefined,
        trueToSizeScore: next() < 0.5 ? 7 : undefined,
        sizingNotes: next() < 0.5 ? (123 as unknown as string) : 'runs small',
      } as FitGarment;
      expect(() => computeFit(g, randomBody(next))).not.toThrow();
      expect(() => computeFit(g, { measurements: {} })).not.toThrow();
      expect(() => computeFit(g, undefined as unknown as UserBody)).not.toThrow();
    }
  });
});
