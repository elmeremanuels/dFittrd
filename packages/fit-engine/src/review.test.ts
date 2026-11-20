/**
 * Review regressions (2026-11-04 skeptical pass). Each case is a behaviour the spec vectors did
 * not pin down and where the first implementation gave a wrong answer; see README §Spec deviations.
 */
import type { UserBody } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { computeFit } from './computeFit';
import { fitGapsForRender, fitSummary } from './summary';
import { deepFreeze } from './test/fixtures';
import { isPointFit, type FitGarment, type SizeFit } from './types';

const point = (f: SizeFit, p: string) => {
  const x = f.points.find((q) => q.point === p);
  if (!x || !isPointFit(x)) throw new Error(`point ${p} not used in ${f.size}`);
  return x;
};

describe('tie band never prefers an unwearable size over a wearable one', () => {
  // dress, no skips, garment chart, ease {6,4,6,1}, stretch 0, tts 0 → δ = 0.2.
  // S: waist tight (gap −4), the rest exactly on target → 0.75 × 0.75 = 0.5625, not wearable.
  // M: three roomy points + shoulder good → 0.7, wearable. Both are in the tie band; Σ|gap| is
  // 4 for S and 25 for M, so a naive closest-ease pick returns S.
  const g: FitGarment = deepFreeze({
    id: 'tie-wearable',
    brand: 'Review',
    category: 'dress',
    patternBlock: 'mystery',
    fabric: { primary: 'cotton', stretchPct: 0, drape: 0.5 },
    ease: { bust: 6, waist: 4, hip: 6, shoulder: 1 },
    sizeChartType: 'garment',
    sizeChart: [
      { size: 'S', bust: 94, waist: 70, hip: 102, shoulder: 39 },
      { size: 'M', bust: 103, waist: 81, hip: 111, shoulder: 39 },
    ],
    trueToSizeScore: 0,
  });
  const user: UserBody = deepFreeze({ measurements: { bust: 88, waist: 70, hip: 96, shoulder: 38 } });

  it('scores S 0.5625 (tight waist) and M 0.7 (roomy)', () => {
    const r = computeFit(g, user);
    const s = r.perSize.find((x) => x.size === 'S')!;
    const m = r.perSize.find((x) => x.size === 'M')!;
    expect(s.score).toBe(0.563);
    expect(s.wearable).toBe(false);
    expect(point(s, 'waist').band).toBe('tight');
    expect(m.score).toBe(0.7);
    expect(m.wearable).toBe(true);
  });

  it('recommends the wearable M, not the closer-by-gap but tight S', () => {
    const r = computeFit(g, user);
    expect(r.recommendedSize).toBe('M');
    expect(r.fits).toBe(true);
    expect(r.tieBreak).toBeNull();
    expect(r.notes).toEqual(['Roomy at the bust', 'Roomy at the waist', 'Roomy at the hips']);
    expect(fitSummary(r)).toMatch(/^Size M should fit — roomy at the bust, roomy at the waist, roomy at the hips \(estimate, \d+% confidence\)\.$/);
  });

  it("'runs large' (bias −1) still cannot pull the recommendation onto the tight S", () => {
    const r = computeFit({ ...g, sizingNotes: 'runs large' }, user);
    expect(r.recommendedSize).toBe('M');
    expect(r.fits).toBe(true);
  });

  it('a kept-history entry for the tight size does not override wearability either', () => {
    const r = computeFit(g, { ...user, history: [{ brand: 'Review', size: 'S', kept: true }] });
    expect(r.recommendedSize).toBe('M');
  });

  it('when no candidate is wearable the usual tie-break still runs over every candidate', () => {
    // Both sizes tight at the waist: S −4 (score 0.5625) and M −3 (score 0.5625 too) → closest-ease.
    const both: FitGarment = { ...g, sizeChart: [g.sizeChart[0]!, { size: 'M', bust: 94, waist: 71, hip: 102, shoulder: 39 }] };
    const r = computeFit(both, user);
    expect(r.perSize.map((s) => s.wearable)).toEqual([false, false]);
    expect(r.recommendedSize).toBe('M');
    expect(r.tieBreak).toBe('closest-ease');
    expect(r.fits).toBe(false);
  });
});

describe('closest size compares mean |gap|, not Σ|gap|, when sizes use different point counts', () => {
  // P is 10 cm too small at four points; Q is 20 cm too small at the only point it lists.
  // Σ|gap| (40 vs 20) would call Q the closest; per point P is clearly closer.
  const g: FitGarment = deepFreeze({
    id: 'closest-mean',
    brand: 'Review',
    category: 'dress',
    patternBlock: 'mystery',
    fabric: { primary: 'cotton', stretchPct: 0, drape: 0.5 },
    ease: { bust: 0, waist: 0, hip: 0, shoulder: 0 },
    sizeChartType: 'garment',
    sizeChart: [
      { size: 'P', bust: 90, waist: 70, hip: 90, shoulder: 30 },
      { size: 'Q', bust: 80 },
    ],
  });
  const user: UserBody = deepFreeze({ measurements: { bust: 100, waist: 80, hip: 100, shoulder: 40 } });

  it('nothing fits and P is the closest', () => {
    const r = computeFit(g, user);
    expect(r.perSize.map((s) => s.score)).toEqual([0, 0]);
    expect(r.recommendedSize).toBeNull();
    expect(r.closestSize).toBe('P');
    expect(r.notes[0]).toBe('No size fits well — closest is P, tight at the bust');
    expect(fitGapsForRender(r)?.size).toBe('P');
  });

  it('with equal point counts the ordering is unchanged (lower index wins ties)', () => {
    const eq: FitGarment = { ...g, sizeChart: [{ size: 'P', bust: 80 }, { size: 'Q', bust: 80 }] };
    expect(computeFit(eq, user).closestSize).toBe('P');
  });
});
