/**
 * Garment-side inputs of the size-ring overlay (route R5, docs/research/shortcut-to-step3.md §4)
 * that the size chart does not carry: the girth of an elastic waistband (relaxed and stretched)
 * and the hem sweep. Neither is measured for any product yet, so every value here is labelled by
 * its source and the overlay prints that label next to the ring:
 *
 * - `measured`: a tape measurement of the real garment (none yet).
 * - `assumed`: a placeholder we picked. It is NOT a measurement and the ring says so.
 *
 * These numbers only move the drawn rings. The size advice and every tight / good / loose word come
 * from @curtain/fit-engine alone (sizing only via the fit engine).
 *
 * TO PLUG IN THE REAL PILOT SKIRT NUMBERS: fill in `PILOT_SKIRT_TAPE` below (one sample size is
 * enough; the other sizes are graded with the chart's own steps) and run `pnpm --filter @curtain/web test`.
 */
import type { GarmentPayload, SizeRow } from '@curtain/schema';

export type RingSource = 'measured' | 'assumed';

/** Girth per size label, cm. */
export type PerSize = Readonly<Record<string, number>>;

export interface BandInput {
  source: RingSource;
  relaxedCm: PerSize;
  stretchedCm: PerSize;
}

export interface HemInput {
  source: RingSource;
  sweepCm: PerSize;
}

export interface GarmentRingInputs {
  band?: BandInput;
  hem?: HemInput;
}

/** One tape measurement of one sample of the garment, cm. */
export interface TapeMeasurement {
  /** Label of the sample that was measured, as the chart prints it (e.g. '12'). */
  sampleSize: string;
  /** Waistband laid flat, not pulled, doubled to a girth. */
  bandRelaxedCm: number;
  /** Waistband pulled to its comfortable maximum, doubled to a girth. */
  bandStretchedCm: number;
  /** Hem laid flat, doubled to a girth. Leave undefined when not measured. */
  hemSweepCm?: number;
}

// ---------------------------------------------------------------------------
// FOUNDER: the pilot skirt's tape measurements go here (Crimson Wildflower Maxi Skirt).
// Example: { sampleSize: '12', bandRelaxedCm: 70, bandStretchedCm: 98, hemSweepCm: 240 }
// While this is null, the overlay draws the ASSUMED band and hem sweep below.
// ---------------------------------------------------------------------------
export const PILOT_SKIRT_TAPE: TapeMeasurement | null = null;

/**
 * ASSUMED waistband girths for the pilot skirt's size 12, cm: a sweep of plausible values for a
 * smocked / elastic viscose band (chart body waist of size 12 is 77.5 cm). Not measured. `mid` is
 * what the overlay draws until `PILOT_SKIRT_TAPE` is filled in; `low` and `high` bracket it
 * (docs/research/step3-rings-usertest.md lists what each does to the three test bodies).
 */
export const ASSUMED_BAND_SCENARIOS = {
  low: { relaxedCm: 64, stretchedCm: 88 },
  mid: { relaxedCm: 69, stretchedCm: 96 },
  high: { relaxedCm: 74, stretchedCm: 104 },
} as const satisfies Record<string, { relaxedCm: number; stretchedCm: number }>;
export type BandScenario = keyof typeof ASSUMED_BAND_SCENARIOS;
export const ASSUMED_BAND_SAMPLE_SIZE = '12';

/**
 * ASSUMED hem sweep of the pilot skirt's size 12, cm (an A-line viscose maxi; not measured). The 3D
 * proxy's lowest graded ring (grading.json, about 102 cm at size 12) is NOT used: it is narrower
 * than the hips, which no A-line maxi is, because the generated mesh clings (docs/REFINEMENT.md R3).
 */
export const ASSUMED_HEM_SCENARIOS = { low: 160, mid: 200, high: 240 } as const;

/**
 * `sampleCm` measured on `sampleSize`, graded to every chart size with the chart's own step at
 * `point` (size 14 = sample + (chart14 − chart12)). Sizes without a chart value are left out.
 */
export function gradeFromSample(chart: readonly SizeRow[], sampleSize: string, sampleCm: number, point: 'waist' | 'hip'): PerSize {
  const base = chart.find((r) => r.size === sampleSize)?.[point];
  const out: Record<string, number> = {};
  if (base === undefined) return out;
  for (const r of chart) {
    const v = r[point];
    if (v !== undefined) out[r.size] = Math.round((sampleCm + (v - base)) * 10) / 10;
  }
  return out;
}

/** The band of an assumed scenario, graded over `chart` from size 12. */
export function assumedBand(chart: readonly SizeRow[], scenario: BandScenario = 'mid'): BandInput {
  const s = ASSUMED_BAND_SCENARIOS[scenario];
  return {
    source: 'assumed',
    relaxedCm: gradeFromSample(chart, ASSUMED_BAND_SAMPLE_SIZE, s.relaxedCm, 'waist'),
    stretchedCm: gradeFromSample(chart, ASSUMED_BAND_SAMPLE_SIZE, s.stretchedCm, 'waist'),
  };
}

/** The ring inputs from a tape measurement (band graded on the waist steps, hem on the hip steps). */
export function inputsFromTape(chart: readonly SizeRow[], tape: TapeMeasurement): GarmentRingInputs {
  return {
    band: {
      source: 'measured',
      relaxedCm: gradeFromSample(chart, tape.sampleSize, tape.bandRelaxedCm, 'waist'),
      stretchedCm: gradeFromSample(chart, tape.sampleSize, tape.bandStretchedCm, 'waist'),
    },
    ...(tape.hemSweepCm !== undefined ? { hem: { source: 'measured' as const, sweepCm: gradeFromSample(chart, tape.sampleSize, tape.hemSweepCm, 'hip') } } : {}),
  };
}

/** The pilot skirt's inputs: the tape when filled in, else the assumed band and hem sweep. */
export function pilotSkirtInputs(chart: readonly SizeRow[], tape: TapeMeasurement | null = PILOT_SKIRT_TAPE, scenario: BandScenario = 'mid'): GarmentRingInputs {
  const measured = tape ? inputsFromTape(chart, tape) : {};
  return {
    band: measured.band ?? assumedBand(chart, scenario),
    hem: measured.hem ?? { source: 'assumed', sweepCm: gradeFromSample(chart, ASSUMED_BAND_SAMPLE_SIZE, ASSUMED_HEM_SCENARIOS[scenario], 'hip') },
  };
}

/** Product ids of the pilot skirt: the shop's product id and the demo's external id. */
const PILOT_SKIRT_IDS = new Set(['10894387020081', 'crimson-wildflower-maxi-skirt']);

/**
 * Ring inputs of `garment`, or `null` when we hold none. A garment with an elastic waist
 * (`waistband` stretch zone) and no inputs still gets its waist ring, marked "band not measured".
 */
export function ringInputsFor(garment: Pick<GarmentPayload, 'id' | 'sizeChart'>): GarmentRingInputs | null {
  if (PILOT_SKIRT_IDS.has(garment.id)) return pilotSkirtInputs(garment.sizeChart);
  return null;
}
