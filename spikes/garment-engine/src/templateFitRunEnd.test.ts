/**
 * The body hem scan (`runEnd` with `OPENING`): an opening in the garment above the hem (a side slit from the waistband,
 * as run 15's maxi skirt shows at one hip in the generated frames) must not end the column, or the hem is interpolated
 * from it and a slit is cut up the side of the fitted skirt.
 */
import { describe, expect, it } from 'vitest';
import { OPENING, runEnd } from './templateFit';

/** A downward scan (start 100 cm, 0.5 cm steps) from runs of [present, cm]. */
function scan(runs: [boolean, number][]): { start: number; step: number; present: boolean[] } {
  const present: boolean[] = [];
  for (const [p, cm] of runs) for (let k = 0; k < Math.round(cm / 0.5); k++) present.push(p);
  return { start: 100, step: -0.5, present };
}

describe('runEnd: hem scan past openings', () => {
  it('a waistband, a 16.5 cm side opening and the skirt below: the hem is the skirt\'s, not the waistband\'s', () => {
    // Run 15's column at 94°: cloth 1–10.5 cm below the waist, nothing for 16.5 cm, cloth down to 93 cm below the waist.
    const s = scan([[false, 1], [true, 10], [false, 16.5], [true, 66], [false, 6]]);
    expect(runEnd(s, 2, 25)).toBeCloseTo(100 - 10.5, 5); // the old rule: ends under the waistband
    expect(runEnd(s, 2, 25, OPENING)).toBeCloseTo(100 - 93, 5);
  });

  it('stray samples below the hem do not extend it (shorter than minRunCm)', () => {
    const s = scan([[true, 80], [false, 1.5], [true, 0.5], [false, 3], [true, 1], [false, 10]]);
    // The 1.5 cm gap is within gapCm: the 0.5 cm sample joins; the 1 cm run after a 3 cm gap is too short to be cloth below an opening.
    expect(runEnd(s, 2, 25, OPENING)).toBeCloseTo(100 - 81.5, 5);
  });

  it('a gap longer than maxCm ends the garment, and nothing changes without a gap', () => {
    const far = scan([[true, 40], [false, OPENING.maxCm + 5], [true, 20], [false, 5]]);
    expect(runEnd(far, 2, 25, OPENING)).toBeCloseTo(100 - 39.5, 5);
    const plain = scan([[true, 60], [false, 10]]);
    expect(runEnd(plain, 2, 25, OPENING)).toBe(runEnd(plain, 2, 25));
  });

  it('nothing within searchCm is still NaN (the column is filled from its neighbours)', () => {
    expect(runEnd(scan([[false, 30], [true, 50]]), 2, 25, OPENING)).toBeNaN();
  });
});
