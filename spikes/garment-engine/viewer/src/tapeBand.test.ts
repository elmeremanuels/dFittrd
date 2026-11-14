/**
 * The waistband data file against the tape file it was filled from (spike only: the data lives in the spike).
 * `data/bohohippychic/tape/<handle>.json` is the single source of truth; `waistbands.json` repeats the measured sizes so
 * the viewer and `sizes-drape.ts` read one file. This keeps the two in step and pins the rule for sizes nobody measured.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bandFor, waistbandFromFile, type BandFileEntry } from './engine';
import type { SpikeBundle } from './bundle';

const data = (f: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/bohohippychic/${f}`, import.meta.url)), 'utf8'));
type TapeSize = { waistRelaxedCm: number; waistStretchedCm: number; hipCm: number; hemSweepCm: number; lengthCm: number };
const tape = data('tape/crimson-wildflower-maxi-skirt.json') as { product: string; measuredSizes: string[]; notMeasuredSizes: string[]; sizes: Record<string, TapeSize> };
const bands = data('waistbands.json') as { products: Record<string, BandFileEntry & { measuredSizes?: string[]; notMeasuredSizes?: string[] }> };
/** The skirt's size ladder (grading.json of the run 17d bundle: AU 8-16, base 12, one step per size). */
const ladder = { baseSize: '12', sizes: ['8', '10', '12', '14', '16'].map((size, k) => ({ size, step: k - 2, targets: {}, sources: {} })) } as unknown as SpikeBundle['grading'];

describe('waistbands.json against the shop tape (crimson wildflower maxi skirt)', () => {
  const entry = bands.products[tape.product]!;
  it('holds exactly the measured sizes, with the tape numbers', () => {
    expect(Object.keys(entry.sizes ?? {}).sort()).toEqual([...tape.measuredSizes].sort());
    expect(Object.keys(tape.sizes).sort()).toEqual([...tape.measuredSizes].sort());
    for (const size of tape.measuredSizes) expect(entry.sizes![size]).toEqual(tape.sizes[size]);
    expect(entry.measuredSizes).toEqual(tape.measuredSizes);
    expect(entry.notMeasuredSizes).toEqual(tape.notMeasuredSizes);
  });
  it('gives the measured sizes their own band and labels the others interpolated or extrapolated', () => {
    const spec = waistbandFromFile(entry, ladder);
    expect(spec.assumed).toBe(false);
    for (const size of tape.measuredSizes) expect(bandFor(spec, ladder, size)).toEqual({ relaxedCm: tape.sizes[size]!.waistRelaxedCm, stretchedCm: tape.sizes[size]!.waistStretchedCm, source: 'measured' });
    for (const size of tape.notMeasuredSizes) expect(bandFor(spec, ladder, size).source).not.toBe('measured');
    expect(bandFor(spec, ladder, '12')).toEqual({ relaxedCm: 75.5, stretchedCm: 105, source: 'interpolated' });
    expect(bandFor(spec, ladder, '16')).toEqual({ relaxedCm: 84.5, stretchedCm: 115, source: 'extrapolated' });
  });
  it('still refuses the product that nobody measured', () => {
    expect(() => waistbandFromFile(bands.products['rosewater-palazzo-pants'], ladder)).toThrow(/no measured band yet/);
  });
});
