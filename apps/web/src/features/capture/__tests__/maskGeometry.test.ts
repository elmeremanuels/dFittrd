import { describe, expect, it } from 'vitest';
import { placeLevels } from '../crossSections';
import { SEG } from '../landmarks';
import { coverageOnRun, headTopRow, median, medianMask, runAt, sampleLevels, type CategoryMask } from '../maskGeometry';
import { FRAME, FRONT_WIDTHS_CM, PX_PER_CM, STATURE_CM, figure, paintMask, yPx } from './fixtures';

function tiny(rows: string[]): CategoryMask {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8Array(width * height);
  rows.forEach((r, y) => [...r].forEach((c, x) => (data[y * width + x] = c === '.' ? 0 : Number(c))));
  return { width, height, data };
}

describe('maskGeometry', () => {
  it('runAt finds the run containing x, or the nearest one', () => {
    const m = tiny(['..44..222..']);
    expect(runAt(m, 3, 0)).toEqual({ start: 2, end: 3 });
    expect(runAt(m, 7, 0)).toEqual({ start: 6, end: 8 });
    expect(runAt(m, 5, 0)).toEqual({ start: 6, end: 8 }); // gap: nearest foreground pixel (6)
    expect(runAt(m, 4, 0)).toEqual({ start: 2, end: 3 }); // tie at distance 1 → left first
    expect(runAt(m, 3, 5)).toBeNull();
  });

  it('coverageOnRun = clothes / (clothes + skin)', () => {
    const m = tiny(['4422']);
    expect(coverageOnRun(m, 0, 0, 3)).toBe(0.5);
    expect(coverageOnRun(tiny(['1111']), 0, 0, 3)).toBe(0); // hair only → nothing classified
  });

  it('headTopRow returns the first person row near the nose column', () => {
    const m = tiny(['.....', '..1..', '..3..', '.333.']);
    expect(headTopRow(m, 0.5)).toBe(1);
    expect(headTopRow(tiny(['.....']), 0.5)).toBe(-1);
  });

  it('median handles odd, even and NaN', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([Number.NaN, 5])).toBe(5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('medianMask takes the majority per pixel (person vs background, then class)', () => {
    const a = tiny(['42']);
    const b = tiny(['4.']);
    const c = tiny(['.2']);
    const m = medianMask([a, b, c]);
    expect([...m.data]).toEqual([4, 2]);
    expect(medianMask([a])).toBe(a);
  });

  it('samples torso widths on the torso blob (not the arms) and limb widths on one limb', () => {
    const lm = figure();
    const mask = paintMask(FRONT_WIDTHS_CM);
    const samples = sampleLevels(mask, placeLevels(lm, FRAME.width / FRAME.height));
    const px = Object.fromEntries(samples.map((s) => [s.level, s.px]));
    const cm = (v: number): number => v / PX_PER_CM;
    // the 62.5 % level sits ~0.75 cm above the painted narrowest point → slightly wider than 26
    expect(Math.abs(cm(px.waist!) - FRONT_WIDTHS_CM.waist)).toBeLessThan(1.5);
    expect(cm(px.hip!)).toBeGreaterThan(30);
    expect(cm(px.bust!)).toBeGreaterThan(28);
    expect(cm(px.bust!)).toBeLessThan(40);
    expect(cm(px.thigh!)).toBeLessThan(FRONT_WIDTHS_CM.thigh + 2);
    expect(cm(px.thigh!)).toBeGreaterThan(FRONT_WIDTHS_CM.thigh - 4);
    expect(cm(px.upperArm!)).toBeLessThan(FRONT_WIDTHS_CM.arm + 3);
    const cov = Object.fromEntries(samples.map((s) => [s.level, s.coverage]));
    expect(cov.waist).toBe(1); // shirt
    expect(cov.calf).toBe(0); // bare skin
  });

  it('headTopRow on the painted figure lands on the hair line (≈ stature)', () => {
    const mask = paintMask(FRONT_WIDTHS_CM);
    const top = headTopRow(mask, 0.5);
    expect(top).toBeCloseTo(yPx(STATURE_CM), -1);
    expect(mask.data[top * mask.width + mask.width / 2]).toBe(SEG.HAIR);
  });
});
