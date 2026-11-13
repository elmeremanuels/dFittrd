/**
 * Review regressions for the measurement geometry (levels, contact between limbs and torso, side-view
 * arm depth, neck band, shoulder slope, mask → frame pixel scale).
 */
import { describe, expect, it } from 'vitest';
import { placeLevels } from '../crossSections';
import { SEG } from '../landmarks';
import { headTopRow, sampleLevels, samplesToFramePx, shoulderSlopeFromMask, type CategoryMask } from '../maskGeometry';
import { DEFAULT_ASPECT, SCAN_SIGMA_CM, ellipsePerimeter, measureScan } from '../measure';
import { POSE } from '../landmarks';
import type { Landmark, LevelSample, ViewMeasurement } from '../types';
import { FRAME, FRONT_WIDTHS_CM, HEEL_Y_PX, PX_PER_CM, SIDE_DEPTHS_CM, STATURE_CM, figure, paintMask, xPx, yPx } from './fixtures';

const ASPECT = FRAME.width / FRAME.height;
const cm = (px: number): number => px / PX_PER_CM;

function viewOf(kind: 'front' | 'side', lm: Landmark[], mask: CategoryMask, withLimits: boolean): ViewMeasurement {
  const samples = sampleLevels(mask, placeLevels(lm, ASPECT, 'left', withLimits ? { view: kind } : {}));
  return { view: kind, width: FRAME.width, height: FRAME.height, landmarks: lm, samples, headTopPx: headTopRow(mask, 0.5), heelPx: HEEL_Y_PX, tiltDeg: 0 };
}

/** Paint a horizontal run (cm coordinates) into a mask. */
function fillCm(mask: CategoryMask, x0Cm: number, x1Cm: number, hCm: number, cls: number): void {
  const y = Math.round(yPx(hCm));
  if (y < 0 || y >= mask.height) return;
  for (let x = Math.max(0, Math.round(xPx(x0Cm))); x <= Math.min(mask.width - 1, Math.round(xPx(x1Cm))); x++) mask.data[y * mask.width + x] = cls;
}

const sampleOf = (samples: readonly LevelSample[], level: string): LevelSample => samples.find((s) => s.level === level)!;

describe('neck level', () => {
  it('measures the neck, not the shoulder slope (was ≈ 97 cm on the fixture)', () => {
    const res = measureScan({
      heightCm: STATURE_CM,
      front: viewOf('front', figure(), paintMask(FRONT_WIDTHS_CM), true),
      side: viewOf('side', figure({ view: 'side' }), paintMask(SIDE_DEPTHS_CM, 'side'), true),
    });
    const expected = ellipsePerimeter(FRONT_WIDTHS_CM.neck / 2, SIDE_DEPTHS_CM.neck / 2);
    expect(Math.abs(res.girths.neck!.mean - expected)).toBeLessThan(3);
    expect(res.girths.neck!.widthCm).toBeLessThan(FRONT_WIDTHS_CM.neck + 1.5);
  });
});

describe('side-view arm depth', () => {
  it('does not take the torso/hip depth as upper-arm or wrist depth (was ≈ 54 / 57 cm)', () => {
    const res = measureScan({
      heightCm: STATURE_CM,
      front: viewOf('front', figure(), paintMask(FRONT_WIDTHS_CM), true),
      side: viewOf('side', figure({ view: 'side' }), paintMask(SIDE_DEPTHS_CM, 'side'), true),
    });
    const arm = res.girths.upperArm!;
    // painted arm 9 cm wide → ≈ 28 cm round; the population aspect is used instead of the side run
    expect(arm.aspect).toBeCloseTo(DEFAULT_ASPECT.upperArm, 2);
    expect(arm.mean).toBeLessThan(33);
    expect(arm.mean).toBeGreaterThan(24);
    expect(arm.sigma).toBeGreaterThan(SCAN_SIGMA_CM.upperArm); // inflated: depth is a population guess
    expect(res.girths.wrist!.mean).toBeLessThan(32);
    // torso levels still use the measured side depth
    expect(res.girths.waist!.aspect).toBeCloseTo(SIDE_DEPTHS_CM.waist / FRONT_WIDTHS_CM.waist, 1);
  });
});

describe('front-view contact limits', () => {
  it('leave a clean A-pose fixture unchanged', () => {
    const lm = figure();
    const mask = paintMask(FRONT_WIDTHS_CM);
    const plain = sampleLevels(mask, placeLevels(lm, ASPECT));
    const limited = sampleLevels(mask, placeLevels(lm, ASPECT, 'left', { view: 'front' }));
    for (const s of limited) {
      expect(s.contact).toBeUndefined();
      expect(s.px).toBeCloseTo(sampleOf(plain, s.level).px, 6);
    }
  });

  it('split thighs and knees that touch at the midline instead of measuring both legs', () => {
    const lm = figure();
    const mask = paintMask(FRONT_WIDTHS_CM);
    // legs together: one blob from −w to +w at every leg height (thighs and knees touch)
    for (let h = 30; h < 87; h += 0.25) {
      const w = h > 48 ? 13 + (FRONT_WIDTHS_CM.thigh - 13) * ((h - 48) / 44) : 13;
      fillCm(mask, -w, w, h, SEG.CLOTHES);
    }
    const plain = sampleLevels(mask, placeLevels(lm, ASPECT));
    const limited = sampleLevels(mask, placeLevels(lm, ASPECT, 'left', { view: 'front' }));
    // without the guard the thigh run spans both legs
    expect(cm(sampleOf(plain, 'thigh').px)).toBeGreaterThan(28);
    expect(cm(sampleOf(limited, 'thigh').px)).toBeGreaterThan(13);
    expect(cm(sampleOf(limited, 'thigh').px)).toBeLessThan(FRONT_WIDTHS_CM.thigh + 1.5);
    // knee: the inner gap is painted over, so one knee reads ≈ 15–16 cm instead of ≈ 31 cm for both
    expect(cm(sampleOf(plain, 'knee').px)).toBeGreaterThan(28);
    expect(cm(sampleOf(limited, 'knee').px)).toBeLessThan(17);
  });

  it('reject torso levels where an arm touches the torso instead of adding the arm width', () => {
    const lm = figure({ elbowX: 17 });
    const mask = paintMask(FRONT_WIDTHS_CM);
    // arms 12 cm thick along the landmark polyline shoulder → elbow → wrist: they press on the torso
    const chain = (side: 1 | -1): { x: number; h: number }[] => [
      { x: 20 * side, h: 142 },
      { x: 17 * side, h: 114 },
      { x: 23 * side, h: 88 },
    ];
    for (const side of [1, -1] as const) {
      const c = chain(side);
      for (let h = 88; h <= 142; h += 0.25) {
        const [a, b] = h >= 114 ? [c[1]!, c[0]!] : [c[2]!, c[1]!];
        const x = a.x + ((b.x - a.x) * (h - a.h)) / (b.h - a.h);
        fillCm(mask, x - 6, x + 6, h, SEG.BODY_SKIN);
      }
    }
    const plain = sampleLevels(mask, placeLevels(lm, ASPECT));
    expect(cm(sampleOf(plain, 'waist').px)).toBeGreaterThan(40); // torso + both arms

    const front = viewOf('front', lm, mask, true);
    expect(sampleOf(front.samples, 'waist').contact).toBe(true);
    expect(Number.isNaN(sampleOf(front.samples, 'waist').px)).toBe(true);
    expect(sampleOf(front.samples, 'bust').contact).toBe(true);

    const res = measureScan({ heightCm: STATURE_CM, front, side: viewOf('side', figure({ view: 'side' }), paintMask(SIDE_DEPTHS_CM, 'side'), true) });
    expect(res.girths.waist).toBeUndefined();
    expect(res.girths.bust).toBeUndefined();
    expect(res.warnings.some((w) => w.startsWith('waist') && w.includes('touches'))).toBe(true);
    // levels away from the contact are still measured
    expect(res.girths.knee).toBeDefined();
  });

  it('reject an upper-arm run that swallowed the torso', () => {
    const lm = figure({ elbowX: 17 });
    const mask = paintMask(FRONT_WIDTHS_CM);
    // fill the whole band at the upper-arm level: arm merged with the torso
    for (let h = 125; h <= 135; h += 0.25) fillCm(mask, -27, 27, h, SEG.CLOTHES);
    const limited = sampleLevels(mask, placeLevels(lm, ASPECT, 'left', { view: 'front' }));
    expect(sampleOf(limited, 'upperArm').contact).toBe(true);
  });
});

describe('shoulder slope', () => {
  it('is no longer the saturated ear→shoulder angle (always 45°)', () => {
    const res = measureScan({ heightCm: STATURE_CM, front: viewOf('front', figure(), paintMask(FRONT_WIDTHS_CM), true) });
    expect(res.posture.shoulderSlopeDeg).toBeUndefined();
    const withSlope = measureScan({ heightCm: STATURE_CM, front: { ...viewOf('front', figure(), paintMask(FRONT_WIDTHS_CM), true), shoulderSlopeDeg: 19.96 } });
    expect(withSlope.posture.shoulderSlopeDeg).toBe(20);
  });

  it('is traced from the mask contour: flat shoulders ≈ 0°, a 20° trapezius ≈ 20°', () => {
    const lm = figure();
    expect(shoulderSlopeFromMask(paintMask(FRONT_WIDTHS_CM), lm, FRAME)).toBeLessThan(1);

    const mask = paintMask(FRONT_WIDTHS_CM);
    // clear the painted flat shoulder block above 140 cm and repaint a sloped contour
    for (let h = 140; h < 150; h += 0.25) fillCm(mask, -19, 19, h, SEG.BACKGROUND);
    const tan = Math.tan((20 * Math.PI) / 180);
    for (let h = 120; h < 150; h += 0.25) {
      for (let x = 5.5; x <= 19; x += 0.25) {
        const top = 150 - (x - 5.5) * tan;
        if (h <= top) {
          fillCm(mask, x - 0.25, x, h, SEG.CLOTHES);
          fillCm(mask, -x, -x + 0.25, h, SEG.CLOTHES);
        }
      }
    }
    for (let h = 140; h < 158; h += 0.25) fillCm(mask, -5.5, 5.5, h, SEG.BODY_SKIN); // neck
    // ±2°: one mask row is 0.25 cm over an 8 cm baseline (≈ 1.8°)
    expect(Math.abs(shoulderSlopeFromMask(mask, lm, FRAME) - 20)).toBeLessThan(2);
    // hair falling onto the shoulders (above the contour) is ignored
    for (let h = 146; h < 152; h += 0.25) {
      const y = Math.round(yPx(h));
      for (let x = Math.round(xPx(6)); x <= Math.round(xPx(18)); x++) if (mask.data[y * mask.width + x] === SEG.BACKGROUND) mask.data[y * mask.width + x] = SEG.HAIR;
    }
    expect(Math.abs(shoulderSlopeFromMask(mask, lm, FRAME) - 20)).toBeLessThan(2);
    // no contour → NaN
    expect(Number.isNaN(shoulderSlopeFromMask({ width: FRAME.width, height: FRAME.height, data: new Uint8Array(FRAME.width * FRAME.height) }, lm, FRAME))).toBe(true);
    expect(lm[POSE.NOSE]).toBeDefined();
  });
});

describe('mask → frame pixels', () => {
  it('rescales widths measured on a smaller mask to frame pixels', () => {
    const s: LevelSample[] = [{ level: 'waist', px: 50, coverage: 1 }];
    expect(samplesToFramePx(s, 256, 480)[0]!.px).toBeCloseTo(50 * (480 / 256), 9);
    expect(samplesToFramePx(s, 480, 480)[0]!.px).toBe(50);
    expect(samplesToFramePx(s, 480, 480)[0]).not.toBe(s[0]);
  });
});
