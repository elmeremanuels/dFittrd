/**
 * apps/web cannot import from spikes, so `PILOT_SKIRT_TAPE` is a copy of the shop's tape file.
 * This test reads the tape file by path and fails when the copy drifts from it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PILOT_SKIRT_TAPE, pilotSkirtInputs, type TapeSize } from '@/render/ringInputs';

const TAPE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'spikes', 'garment-engine', 'data', 'bohohippychic', 'tape', 'crimson-wildflower-maxi-skirt.json');

interface TapeFile {
  format: string;
  product: string;
  measuredSizes: string[];
  notMeasuredSizes: string[];
  sizes: Record<string, { waistRelaxedCm: number; waistStretchedCm: number; hipCm: number; hemSweepCm: number; lengthCm: number }>;
}

/** The AU chart of the pilot skirt (the shop's body chart, cm). */
const CHART = [
  { size: '8', bust: 85, waist: 67.5, hip: 94 },
  { size: '10', bust: 90, waist: 72.5, hip: 99 },
  { size: '12', bust: 95, waist: 77.5, hip: 104 },
  { size: '14', bust: 100, waist: 82.5, hip: 109 },
  { size: '16', bust: 105, waist: 87.5, hip: 114 },
];

describe('PILOT_SKIRT_TAPE is the shop\'s tape file', () => {
  it('the tape file is in the repo', () => {
    expect(existsSync(TAPE_FILE)).toBe(true);
  });
  const file = JSON.parse(readFileSync(TAPE_FILE, 'utf8')) as TapeFile;

  it('holds exactly the measured sizes, with the same five numbers each', () => {
    expect(file.format).toBe('curtain.spike.tapeMeasurements');
    expect(file.product).toBe('crimson-wildflower-maxi-skirt');
    expect(PILOT_SKIRT_TAPE).not.toBeNull();
    const copy = PILOT_SKIRT_TAPE!.sizes;
    expect(Object.keys(copy).sort()).toEqual([...file.measuredSizes].sort());
    expect(Object.keys(file.sizes).sort()).toEqual([...file.measuredSizes].sort());
    for (const size of file.measuredSizes) {
      const f = file.sizes[size]!;
      const expected: TapeSize = { bandRelaxedCm: f.waistRelaxedCm, bandStretchedCm: f.waistStretchedCm, hipCm: f.hipCm, hemSweepCm: f.hemSweepCm, lengthCm: f.lengthCm };
      expect(copy[size], `AU ${size}`).toEqual(expected);
    }
  });

  it('never presents a size the shop did not measure as measured', () => {
    const inputs = pilotSkirtInputs(CHART);
    expect(inputs.measuredSizes).toEqual(file.measuredSizes);
    for (const size of file.measuredSizes) for (const input of [inputs.band, inputs.hip, inputs.hem]) expect(input!.source[size], `AU ${size}`).toBe('measured');
    for (const size of file.notMeasuredSizes) {
      for (const input of [inputs.band, inputs.hip, inputs.hem]) expect(['interpolated', 'extrapolated'], `AU ${size}`).toContain(input!.source[size]);
      expect(PILOT_SKIRT_TAPE!.sizes[size]).toBeUndefined();
    }
    expect(inputs.band!.source['12']).toBe('interpolated');
    expect(inputs.band!.source['16']).toBe('extrapolated');
  });
});
