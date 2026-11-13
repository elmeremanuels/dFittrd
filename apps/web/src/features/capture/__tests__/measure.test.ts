import { describe, expect, it } from 'vitest';
import { placeLevels } from '../crossSections';
import { headTopRow, sampleLevels } from '../maskGeometry';
import { DEFAULT_ASPECT, SCAN_SIGMA_CM, coverageQuality, ellipsePerimeter, girthFromWidthDepth, measureScan, scaleCmPerPx } from '../measure';
import type { ViewMeasurement } from '../types';
import { FRAME, FRONT_WIDTHS_CM, HEEL_Y_PX, SIDE_DEPTHS_CM, STATURE_CM, figure, paintMask } from './fixtures';

describe('ellipsePerimeter (Ramanujan)', () => {
  it('matches a circle exactly and the known 3:2 ellipse', () => {
    expect(ellipsePerimeter(10, 10)).toBeCloseTo(2 * Math.PI * 10, 6);
    // exact perimeter of a=3, b=2 ellipse is 15.8654…
    expect(ellipsePerimeter(3, 2)).toBeCloseTo(15.8654, 3);
    expect(ellipsePerimeter(0, 0)).toBe(0);
    expect(Number.isNaN(ellipsePerimeter(-1, 2))).toBe(true);
  });
});

describe('scaleCmPerPx', () => {
  it('derives cm per pixel from stature and the head-top → heel span, tilt corrected', () => {
    expect(scaleCmPerPx(170, 100, 780)).toBeCloseTo(170 / 680, 9);
    // a 10° lean shortens the projected span: the scale must shrink by cos(10°)
    expect(scaleCmPerPx(170, 100, 780, 10)).toBeCloseTo((170 / 680) * Math.cos((10 * Math.PI) / 180), 9);
    expect(Number.isNaN(scaleCmPerPx(170, 780, 100))).toBe(true);
    expect(Number.isNaN(scaleCmPerPx(0, 100, 780))).toBe(true);
  });
});

describe('girthFromWidthDepth', () => {
  it('uses measured depth when present and a default aspect otherwise', () => {
    const g = girthFromWidthDepth('waist', 28, 22);
    expect(g.mean).toBeCloseTo(ellipsePerimeter(14, 11), 6);
    expect(g.sigma).toBe(SCAN_SIGMA_CM.waist);
    expect(g.aspect).toBeCloseTo(22 / 28, 6);
    const noSide = girthFromWidthDepth('waist', 28);
    expect(noSide.depthCm).toBeCloseTo(28 * DEFAULT_ASPECT.waist, 6);
    expect(noSide.sigma).toBeGreaterThan(SCAN_SIGMA_CM.waist);
  });
});

describe('coverageQuality', () => {
  it('drops with clothing coverage', () => {
    expect(coverageQuality([0, 0])).toBe(1);
    expect(coverageQuality([1, 1])).toBeCloseTo(0.6, 9);
    expect(coverageQuality([])).toBe(0.5);
  });
});

function view(kind: 'front' | 'side', widths: typeof FRONT_WIDTHS_CM): ViewMeasurement {
  const lm = figure({ view: kind === 'front' ? 'front' : 'side' });
  const mask = paintMask(widths, kind);
  const samples = sampleLevels(mask, placeLevels(lm, FRAME.width / FRAME.height));
  const headTopPx = headTopRow(mask, 0.5);
  return { view: kind, width: FRAME.width, height: FRAME.height, landmarks: lm, samples, headTopPx, heelPx: HEEL_Y_PX, tiltDeg: 0 };
}

describe('measureScan (synthetic figure)', () => {
  it('recovers the painted waist girth within 2.5 cm from front + side', () => {
    const res = measureScan({ heightCm: STATURE_CM, front: view('front', FRONT_WIDTHS_CM), side: view('side', SIDE_DEPTHS_CM) });
    const expected = ellipsePerimeter(FRONT_WIDTHS_CM.waist / 2, SIDE_DEPTHS_CM.waist / 2);
    // −1 cm clothing allowance at full coverage; the level sits ~0.75 cm above the painted narrowest point
    expect(Math.abs(res.girths.waist!.mean - (expected - 1))).toBeLessThan(2.5);
    expect(Math.abs(res.girths.waist!.mean - expected)).toBeLessThan(3);
    expect(res.girths.waist!.sigma).toBeCloseTo(Math.sqrt(9 + 1), 1);
    expect(res.girths.hip!.mean).toBeGreaterThan(res.girths.waist!.mean);
    expect(res.warnings.filter((w) => w.includes('side'))).toEqual([]);
    expect(res.quality).toBeGreaterThan(0.5);
    expect(res.lengths.stature).toBe(STATURE_CM);
    expect(res.lengths.inseam).toBeGreaterThan(60);
    expect(res.lengths.inseam).toBeLessThan(95);
    expect(res.lengths.biacromialBreadth).toBeCloseTo(40, 0);
    expect(res.posture.waistToHip).toBeLessThan(1);
    expect(res.posture.forwardLeanDeg).toBe(0);
  });

  it('falls back to population depth ratios and inflates sigma without a side view', () => {
    const res = measureScan({ heightCm: STATURE_CM, front: view('front', FRONT_WIDTHS_CM), side: null });
    expect(res.warnings.some((w) => w.includes('no side view'))).toBe(true);
    expect(res.girths.waist!.sigma).toBeGreaterThan(3.5);
    expect(res.girths.waist!.aspect).toBeCloseTo(DEFAULT_ASPECT.waist, 2);
    expect(res.quality).toBeLessThan(0.9);
  });

  it('blends bust/waist/hip means with the population prior when weight is known', () => {
    const noPrior = measureScan({ heightCm: STATURE_CM, front: view('front', FRONT_WIDTHS_CM), side: view('side', SIDE_DEPTHS_CM) });
    const withPrior = measureScan({ heightCm: STATURE_CM, weightKg: 95, sex: 'female', front: view('front', FRONT_WIDTHS_CM), side: view('side', SIDE_DEPTHS_CM) });
    // a 95 kg prior pulls the slim painted waist up
    expect(withPrior.girths.waist!.mean).toBeGreaterThan(noPrior.girths.waist!.mean);
    expect(withPrior.girths.waist!.sigma).toBe(noPrior.girths.waist!.sigma); // sigma is the published table, not the formal blend
    expect(withPrior.girths.knee!.mean).toBe(noPrior.girths.knee!.mean); // non-prior levels untouched
  });

  it('reports a failure when the scale cannot be established', () => {
    const f = view('front', FRONT_WIDTHS_CM);
    const res = measureScan({ heightCm: STATURE_CM, front: { ...f, headTopPx: f.heelPx } });
    expect(res.girths).toEqual({});
    expect(res.quality).toBe(0);
  });
});
