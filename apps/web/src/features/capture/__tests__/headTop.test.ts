/**
 * Carry-over #16: the head top used for the scale must be the skull, not the top of the hair.
 * Synthetic masks: the fixture figure (stature 170 cm to the skull) with its head repainted as face
 * skin from the chin to the hairline and hair on top, from none (bald) to a 10 cm bun.
 */
import { describe, expect, it } from 'vitest';
import { placeLevels } from '../crossSections';
import { SEG } from '../landmarks';
import { VERTEX_ABOVE_HAIRLINE_RATIO, headTopRow, headTopWithoutHair, sampleLevels, type CategoryMask } from '../maskGeometry';
import { SCAN_PRIOR_SIGMA_CM, measureScan, priorShare, scaleCmPerPx } from '../measure';
import type { ViewMeasurement } from '../types';
import { FRAME, FRONT_WIDTHS_CM, HEEL_Y_PX, PX_PER_CM, SIDE_DEPTHS_CM, STATURE_CM, figure, paintMask, xPx, yPx } from './fixtures';

const CHIN_CM = 151;
/** Hairline such that the skull vertex (STATURE_CM) sits VERTEX_ABOVE_HAIRLINE_RATIO of the face above it. */
const HAIRLINE_CM = (STATURE_CM + VERTEX_ABOVE_HAIRLINE_RATIO * CHIN_CM) / (1 + VERTEX_ABOVE_HAIRLINE_RATIO);
const SKULL_ROW = yPx(STATURE_CM);

/** The fixture mask with the head repainted: face skin chin → hairline, skull hair up to 170 cm, plus `volumeCm` of hair above it. */
function headMask(view: 'front' | 'side', volumeCm: number, opts: { bald?: boolean; noFace?: boolean } = {}): CategoryMask {
  const mask = paintMask(view === 'front' ? FRONT_WIDTHS_CM : SIDE_DEPTHS_CM, view);
  const { width, data } = mask;
  const paint = (hCm: number, wCm: number, cls: number): void => {
    const y = Math.round(yPx(hCm));
    for (let x = Math.max(0, Math.round(xPx(-wCm / 2))); x <= Math.min(width - 1, Math.round(xPx(wCm / 2))); x++) data[y * width + x] = cls;
  };
  // clear the fixture's head
  for (let h = CHIN_CM; h <= STATURE_CM + 15; h += 0.25) paint(h, 30, SEG.BACKGROUND);
  for (let h = CHIN_CM; h <= STATURE_CM; h += 0.25) {
    const face = h <= HAIRLINE_CM;
    if (opts.noFace) paint(h, 15, SEG.HAIR);
    else if (face) paint(h, 15, SEG.FACE_SKIN);
    else paint(h, 15, opts.bald ? SEG.FACE_SKIN : SEG.HAIR);
  }
  if (!opts.bald) for (let h = STATURE_CM; h <= STATURE_CM + volumeCm; h += 0.25) paint(h, 16 - (h - STATURE_CM), SEG.HAIR);
  return mask;
}

function view(kind: 'front' | 'side', mask: CategoryMask, headTopPx: number): ViewMeasurement {
  const lm = figure({ view: kind });
  const samples = sampleLevels(mask, placeLevels(lm, FRAME.width / FRAME.height));
  return { view: kind, width: FRAME.width, height: FRAME.height, landmarks: lm, samples, headTopPx, heelPx: HEEL_Y_PX, tiltDeg: 0 };
}

describe('headTopWithoutHair (#16)', () => {
  it('finds the skull under any hair volume, where the first person row moves with the hair', () => {
    for (const volume of [0.5, 2, 6, 10]) {
      const mask = headMask('front', volume);
      const top = headTopWithoutHair(mask, 0.5);
      expect(top.method).toBe('face-proportion');
      expect(Math.abs(top.row - SKULL_ROW)).toBeLessThanOrEqual(1.5);
      expect(top.personTop).toBe(headTopRow(mask, 0.5));
      expect(SKULL_ROW - top.personTop).toBeGreaterThanOrEqual(volume * PX_PER_CM - 1.5);
    }
  });

  it('uses the first person row when there is no hair on top, or no face to measure', () => {
    const bald = headMask('front', 0, { bald: true });
    expect(headTopWithoutHair(bald, 0.5)).toMatchObject({ method: 'no-hair', row: headTopRow(bald, 0.5) });
    const back = headMask('front', 4, { noFace: true });
    expect(headTopWithoutHair(back, 0.5)).toMatchObject({ method: 'person-top', row: headTopRow(back, 0.5) });
    const empty: CategoryMask = { width: 4, height: 4, data: new Uint8Array(16) };
    expect(headTopWithoutHair(empty, 0.5).row).toBe(-1);
  });

  it('never goes above the hair or below the hairline (short hair over a tall forehead)', () => {
    // 1 cm of hair above a hairline only 1 cm below the skull: the proportion would point above the hair
    const rows = ['.....', '..1..', '..3..', '..3..', '..3..', '..3..', '..3..', '..3..', '..3..', '..3..', '..3..', '.222.'];
    const data = new Uint8Array(rows.length * 5);
    rows.forEach((r, y) => [...r].forEach((c, x) => (data[y * 5 + x] = c === '.' ? 0 : Number(c))));
    const top = headTopWithoutHair({ width: 5, height: rows.length, data }, 0.5);
    expect(top.row).toBe(1);
  });

  it('removes the scale bias: girths match the hairless figure, where the hair top reads them low', () => {
    const volume = 6;
    const front = headMask('front', volume);
    const side = headMask('side', volume);
    const truthScale = 1 / PX_PER_CM;
    const oldScale = scaleCmPerPx(STATURE_CM, headTopRow(front, 0.5), HEEL_Y_PX);
    const newScale = scaleCmPerPx(STATURE_CM, headTopWithoutHair(front, 0.5).row, HEEL_Y_PX);
    expect(oldScale / truthScale - 1).toBeLessThan(-0.03); // 6 cm of hair → about 3.4 % low
    expect(Math.abs(newScale / truthScale - 1)).toBeLessThan(0.002);

    const measure = (top: (m: CategoryMask) => number) =>
      measureScan({ heightCm: STATURE_CM, front: view('front', front, top(front)), side: view('side', side, top(side)) });
    const truth = measureScan({ heightCm: STATURE_CM, front: view('front', front, SKULL_ROW), side: view('side', side, SKULL_ROW) });
    const withHair = measure((m) => headTopRow(m, 0.5));
    const fixed = measure((m) => headTopWithoutHair(m, 0.5).row);
    for (const level of ['bust', 'waist', 'hip'] as const) {
      const t = truth.girths[level]!.mean;
      expect(withHair.girths[level]!.mean / t - 1).toBeLessThan(-0.025);
      expect(Math.abs(fixed.girths[level]!.mean / t - 1)).toBeLessThan(0.005);
    }
  });
});

describe('prior weight (#17)', () => {
  it('is one named constant; the prior share follows from it', () => {
    expect(SCAN_PRIOR_SIGMA_CM).toBe(4);
    expect(priorShare(SCAN_PRIOR_SIGMA_CM)).toBeCloseTo(0.5, 12);
    expect(priorShare(3.4)).toBeCloseTo(16 / (16 + 3.4 * 3.4), 12);
    expect(priorShare(2.2)).toBeGreaterThan(priorShare(3.9));
  });
});
