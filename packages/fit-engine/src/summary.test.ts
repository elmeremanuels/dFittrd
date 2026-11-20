import { describe, expect, it } from 'vitest';
import { computeFit } from './computeFit';
import { fitGapsForRender, fitSummary, wearBlock } from './summary';
import { PILOT_PULL_ON_SKIRT } from '@curtain/schema';
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

describe('wearBlock: where a size cannot be worn (the not-drawn rule of every picture reads this)', () => {
  // A woven dress on a garment chart, the bust only: 1.5 % stretch, so the tight limit is about 2.4 cm under the ease target.
  const WOVEN: FitGarment = {
    id: 'woven-dress',
    brand: 'b',
    category: 'dress',
    patternBlock: 'babydoll',
    fabric: { stretchPct: 1.5 },
    sizeChartType: 'garment',
    sizeChart: [
      { size: '8', bust: 92 },
      { size: '12', bust: 102 },
      { size: '16', bust: 112 },
    ],
  };
  const bust = (cm: number) => ({ measurements: { bust: cm, waist: cm - 18, hip: cm + 9 } });

  it('names the point and the shortfall when the body is larger than the garment by more than its fabric gives', () => {
    const r = computeFit(WOVEN, bust(105));
    // 105 cm in a 92 cm bust: 13 cm short. In the 102 cm one: 3 cm short, still more than 1.5 % of woven cloth gives.
    expect(wearBlock(r, '8')).toEqual({ reason: 'tight', point: 'bust', anchor: 'chest', label: 'bust', shortCm: 13 });
    expect(wearBlock(r, '12')).toEqual({ reason: 'tight', point: 'bust', anchor: 'chest', label: 'bust', shortCm: 3 });
    expect(wearBlock(r, '16')).toBeNull();
    // The same numbers as the gaps the pictures already read: no second fit.
    expect(fitGapsForRender(r, '8')?.slackCm.bust).toBe(-13);
    expect(fitGapsForRender(r, '8')?.bands.bust).toBe('tight');
  });

  it('a size that is tight with room left, snug, good, roomy or loose is not blocked', () => {
    for (const cm of [80, 85, 90, 94, 98, 100, 101]) {
      const r = computeFit(WOVEN, bust(cm));
      const g = fitGapsForRender(r, '12')!;
      expect(g.slackCm.bust!, `bust ${cm}`).toBeGreaterThanOrEqual(0);
      expect(wearBlock(r, '12'), `bust ${cm}: ${g.bands.bust}`).toBeNull();
    }
    // 101 cm in the 102 cm bust: the engine calls it tight (under the ease limit), but the dress still closes.
    expect(fitGapsForRender(computeFit(WOVEN, bust(101)), '12')?.bands.bust).toBe('tight');
  });

  it('defaults to the size the result shows, and is null for a size the result does not have', () => {
    const r = computeFit(WOVEN, bust(120));
    expect(r.closestSize).toBe('16');
    expect(wearBlock(r)).toMatchObject({ point: 'bust', shortCm: 8 });
    expect(wearBlock(r, '20')).toBeNull();
    expect(wearBlock(computeFit({ ...WOVEN, sizeChart: [] }, bust(90)))).toBeNull();
  });

  it('reports the largest shortfall of several points; shoulders and lengths never block', () => {
    const r = computeFit(WRAP, { measurements: { bust: 112, waist: 96, hip: 120, shoulder: 44 } });
    const g = fitGapsForRender(r, 'XS')!;
    const short = (['bust', 'waist', 'hip'] as const).map((p) => ({ p, s: g.slackCm[p]! })).sort((a, b) => a.s - b.s)[0]!;
    expect(wearBlock(r, 'XS')).toMatchObject({ reason: 'tight', point: short.p, shortCm: -short.s });
    // The shoulder alone too narrow: the engine bands it tight, the garment is still on the body.
    const wide = computeFit(WRAP, { measurements: { ...REF.measurements, shoulder: 52 } });
    expect(fitGapsForRender(wide, 'M')?.bands.shoulder).toBe('tight');
    expect(wearBlock(wide, 'M')).toBeNull();
  });

  it('a men’s fit names the chest and the seat', () => {
    const tee: FitGarment = { ...WOVEN, id: 'tee', category: 'top', audience: 'men', sizeChart: [{ size: 'S', bust: 96 }, { size: 'XL', bust: 120 }] };
    const r = computeFit(tee, { measurements: { bust: 116, waist: 100, hip: 110 } });
    expect(r.mens).toBe(true);
    expect(wearBlock(r, 'S')).toMatchObject({ reason: 'tight', point: 'bust', anchor: 'chest', label: 'chest', shortCm: 20 });
    expect(wearBlock(r, 'XL')).toBeNull();
  });

  it('a pull-on band that does not stretch over the hips blocks the size at the hips; one that only just passes does not', () => {
    // The pilot skirt on the chart line (bust 89, waist 71.5, hip 98): AU 8's band stretches to 94 cm, 4 cm short.
    const r = computeFit(PILOT_PULL_ON_SKIRT, { measurements: { bust: 89, waist: 71.5, hip: 98 } });
    expect(r.perSize.find((s) => s.size === '8')?.pullOn).toMatchObject({ status: 'blocked', marginCm: -4 });
    expect(wearBlock(r, '8')).toEqual({ reason: 'pull-on', point: 'hip', anchor: 'hip', label: 'hips', shortCm: 4 });
    expect(r.perSize.find((s) => s.size === '10')?.pullOn?.status).not.toBe('blocked');
    expect(wearBlock(r, '10')).toBeNull();
    // Every size that is blocked by the band is blocked here, and nothing else on this body.
    for (const s of r.perSize) expect(wearBlock(r, s.size) !== null, s.size).toBe(s.pullOn?.status === 'blocked' || s.points.some((p) => !('omitted' in p) && p.band === 'tight' && p.gapCm + p.easeTarget < 0 && ['bust', 'waist', 'hip', 'thigh'].includes(p.point)));
  });
});
