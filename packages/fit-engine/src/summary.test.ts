import { describe, expect, it } from 'vitest';
import { computeFit } from './computeFit';
import { fitGapsForRender, fitSummary } from './summary';
import { REF, WRAP } from './test/fixtures';
import type { FitGarment } from './types';

describe('fitSummary', () => {
  it('good fit', () => {
    expect(fitSummary(computeFit(WRAP, REF))).toBe('Size M fits you well (estimate, 84% confidence).');
  });
  it('fit with issues', () => {
    const r = computeFit(
      { ...WRAP, sizingNotes: undefined, stretchZones: [] },
      { measurements: { bust: 88, waist: 76, hip: 96, shoulder: 38 }, confidence: { waist: 0.3 } },
    );
    expect(r.confidence).toBe(0.653);
    expect(fitSummary(r)).toBe('Size L should fit — roomy at the bust (estimate, 65% confidence).');
  });
  it('nothing fits', () => {
    const r = computeFit(WRAP, { measurements: { bust: 112, waist: 96, hip: 120, shoulder: 44 } });
    expect(fitSummary(r)).toBe('No size fits well — the closest is L, tight at the bust (estimate).');
  });
  it('recommended but not wearable', () => {
    // M scores 0.698 (waist tight) but is the best size when L is removed from the chart.
    const r = computeFit(
      { ...WRAP, sizingNotes: undefined, stretchZones: [], sizeChart: WRAP.sizeChart.slice(0, 3) },
      { measurements: { bust: 88, waist: 76, hip: 96, shoulder: 38 }, confidence: { waist: 0.3 } },
    );
    expect(r.recommendedSize).toBe('M');
    expect(r.fits).toBe(false);
    expect(fitSummary(r)).toMatch(/^Size M is the closest, but it may be tight at the waist \(estimate, \d+% confidence\)\.$/);
  });
  it('no fit points', () => {
    const belt: FitGarment = {
      id: 'b',
      brand: 'b',
      category: 'accessory',
      patternBlock: 'belt',
      fabric: { stretchPct: 0 },
      sizeChart: [{ size: 'ONE' }],
    };
    expect(fitSummary(computeFit(belt, REF))).toBe("We can't check the fit of this item yet.");
  });
});

describe('fitGapsForRender', () => {
  const r = computeFit(WRAP, REF);
  it('defaults to the recommended size and lists used points only', () => {
    expect(fitGapsForRender(r)).toEqual({
      size: 'M',
      gaps: { bust: 4.3, waist: 2.2, hip: 4.4, shoulder: 0 },
      bands: { bust: 'good', waist: 'good', hip: 'good', shoulder: 'good' },
      easeTargets: { bust: 5.7, waist: 3.8, hip: 7.6, shoulder: 1 },
      slackCm: { bust: 10, waist: 6, hip: 12, shoulder: 1 },
    });
  });
  it('accepts an explicit size and omits unused points', () => {
    const r10 = computeFit(WRAP, { measurements: { bust: 88, waist: 70, shoulder: 38 } });
    const g = fitGapsForRender(r10, 'XS');
    expect(g?.size).toBe('XS');
    expect(g?.gaps).toEqual({ bust: -3.7, waist: -5.8, shoulder: -2 });
    expect(g?.gaps.hip).toBeUndefined();
  });
  it('returns null for an unknown size or an empty chart', () => {
    expect(fitGapsForRender(r, 'XXL')).toBeNull();
    expect(fitGapsForRender(computeFit({ ...WRAP, sizeChart: [] }, REF))).toBeNull();
  });
  it('falls back to the closest size when nothing fits', () => {
    const none = computeFit(WRAP, { measurements: { bust: 112, waist: 96, hip: 120, shoulder: 44 } });
    expect(fitGapsForRender(none)?.size).toBe('L');
  });
});
