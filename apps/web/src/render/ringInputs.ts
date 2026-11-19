/**
 * Garment-side inputs of the size-ring overlay (route R5, docs/research/shortcut-to-step3.md §4)
 * that the size chart does not carry: the girth of an elastic waistband (relaxed and stretched),
 * the garment's own hip girth and the hem sweep. Every value carries its source PER SIZE and the
 * overlay prints it next to the ring:
 *
 * - `measured`: a tape measurement of the real garment in that size.
 * - `interpolated`: that size was not measured; the value lies on the straight line between the
 *   nearest measured size below and above it. Shoppers read "estimated".
 * - `extrapolated`: that size was not measured and lies outside the measured sizes; the value
 *   continues the straight line through the two nearest measured sizes. It is the weaker of the two,
 *   so shoppers read "rough estimate".
 * - `assumed`: a placeholder we picked. It is NOT a measurement and the ring says so.
 *
 * These numbers only move the drawn rings and their labels. The size advice and every tight / good /
 * loose word come from @curtain/fit-engine alone (sizing only via the fit engine).
 *
 * The pilot skirt's tape (`PILOT_SKIRT_TAPE`) is a COPY of
 * spikes/garment-engine/data/bohohippychic/tape/crimson-wildflower-maxi-skirt.json (apps/web cannot
 * import from spikes); src/__tests__/ringTape.test.ts fails when the two drift apart.
 */
import type { GarmentPayload, SizeRow } from '@curtain/schema';
import { appStrings } from '@/strings';

export type RingSource = 'measured' | 'interpolated' | 'extrapolated' | 'assumed';

/** Girth per size label, cm. */
export type PerSize = Readonly<Record<string, number>>;
/** Where each size's value comes from. */
export type PerSizeSource = Readonly<Record<string, RingSource>>;

export interface BandInput {
  source: PerSizeSource;
  relaxedCm: PerSize;
  stretchedCm: PerSize;
  /** Pull-on bands must stretch over the hips; `closureSource` says whether that was checked. */
  closure: Closure;
  closureSource: 'measured' | 'assumed';
}

export interface HipInput {
  source: PerSizeSource;
  /** The garment's own girth at its hip line (flat width x 2), cm. */
  girthCm: PerSize;
  /** Distance below the band at which the hip was measured, cm; null when the measurer did not say. */
  belowBandCm: number | null;
}

export interface HemInput {
  source: PerSizeSource;
  sweepCm: PerSize;
}

export interface GarmentRingInputs {
  band?: BandInput;
  hip?: HipInput;
  hem?: HemInput;
  /** Size labels that were tape-measured, in chart order (empty when everything is assumed). */
  measuredSizes?: readonly string[];
}

/** The source of `size` in an input (sizes without a value count as assumed). */
export function sourceAt(input: { source: PerSizeSource } | undefined, size: string): RingSource {
  return input?.source[size] ?? 'assumed';
}

/**
 * What a chip prints: "estimated" for a size between measured sizes (interpolated), "rough estimate"
 * for a size beyond them (extrapolated: nothing measured on its far side holds the number in place).
 */
export function sourceWord(source: RingSource): string {
  return appStrings().shared.rings.sourceWord[source];
}

/** The full wording of a source, for the sentence under a ring and for screen readers. */
export function sourceSentence(source: RingSource, measuredSizes: readonly string[] = []): string {
  return appStrings().shared.rings.sourceSentence[source](measuredSizes);
}

/** The tape measurements of one size of the garment, cm. Every girth is the flat width x 2. */
export interface TapeSize {
  /** Waistband laid flat, not pulled, doubled to a girth. */
  bandRelaxedCm: number;
  /** Waistband pulled to its comfortable maximum, doubled to a girth. */
  bandStretchedCm: number;
  /** The garment laid flat at its hip line, doubled to a girth. */
  hipCm?: number;
  /** Hem laid flat, doubled to a girth. */
  hemSweepCm?: number;
  /** Waistband to hem, flat. Not drawn as a ring; kept so the copy matches the tape file. */
  lengthCm?: number;
}

/** Tape measurements of a garment: one entry per MEASURED size, keyed by the chart's size label. */
export interface TapeMeasurements {
  sizes: Readonly<Record<string, TapeSize>>;
  /**
   * 'pull-on' (no zip or button: the stretched band has to pass over the hips) or 'zip'. Leave
   * undefined when not checked; the overlay then assumes pull-on (the shop lists no closure).
   */
  closure?: Closure;
  /** How far below the band the hip was measured, cm. Leave undefined when the measurer did not say. */
  hipBelowBandCm?: number;
}

export type Closure = 'pull-on' | 'zip';

// ---------------------------------------------------------------------------
// The pilot skirt's tape measurements (Crimson Wildflower Maxi Skirt), measured by the shop on
// AU 8, 10 and 14 (notebook page of 13 Nov 2026). AU 12 and 16 were NOT measured: `fillSizes`
// interpolates 12 and extrapolates 16, and labels them so. The uneven hip steps (112, 122, 126) are
// the shop's numbers and are not corrected. Closure and the hip measuring height were not stated.
// Source of truth: spikes/garment-engine/data/bohohippychic/tape/crimson-wildflower-maxi-skirt.json.
// Set this to null to fall back to the ASSUMED band and hem sweep below.
// ---------------------------------------------------------------------------
export const PILOT_SKIRT_TAPE: TapeMeasurements | null = {
  sizes: {
    '8': { bandRelaxedCm: 67, bandStretchedCm: 94, hipCm: 112, hemSweepCm: 230, lengthCm: 103 },
    '10': { bandRelaxedCm: 71, bandStretchedCm: 100, hipCm: 122, hemSweepCm: 248, lengthCm: 103 },
    '14': { bandRelaxedCm: 80, bandStretchedCm: 110, hipCm: 126, hemSweepCm: 260, lengthCm: 104 },
  },
};

/**
 * ASSUMED waistband girths for the pilot skirt's size 12, cm: a sweep of plausible values for a
 * smocked / elastic viscose band. Not measured. Chart body of size 12: waist 77.5, hip 104 cm.
 *
 * The skirt is assumed pull-on (the shop lists no zip; "comfortable stretch at the waist",
 * stretch zone `waistband`), so the STRETCHED band has to pass over the hips: every scenario
 * stretches to at least the chart hip of the same size (low = 104 = chart hip, a band that only
 * just clears a chart-hip body). `mid` is what the overlay draws when `PILOT_SKIRT_TAPE` is
 * null; `low` and `high` bracket it. `bandSweep()` and docs/research/step3-rings-usertest.md show what
 * each does to the three test bodies (stretch at the waist and clearance over the hips).
 */
export const ASSUMED_BAND_SCENARIOS = {
  low: { relaxedCm: 66, stretchedCm: 104 },
  mid: { relaxedCm: 70, stretchedCm: 110 },
  high: { relaxedCm: 74, stretchedCm: 116 },
} as const satisfies Record<string, { relaxedCm: number; stretchedCm: number }>;
/** ASSUMED closure of the pilot skirt: the tape page does not state it. */
export const ASSUMED_CLOSURE: Closure = 'pull-on';
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

const allSizes = (chart: readonly SizeRow[], source: RingSource): PerSizeSource => Object.fromEntries(chart.map((r) => [r.size, source]));

/** The band of an assumed scenario, graded over `chart` from size 12. */
export function assumedBand(chart: readonly SizeRow[], scenario: BandScenario = 'mid'): BandInput {
  const s = ASSUMED_BAND_SCENARIOS[scenario];
  return {
    source: allSizes(chart, 'assumed'),
    relaxedCm: gradeFromSample(chart, ASSUMED_BAND_SAMPLE_SIZE, s.relaxedCm, 'waist'),
    stretchedCm: gradeFromSample(chart, ASSUMED_BAND_SAMPLE_SIZE, s.stretchedCm, 'waist'),
    closure: ASSUMED_CLOSURE,
    closureSource: 'assumed',
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * One value per chart size from the values measured on some sizes. THE RULE:
 *
 * - a measured size keeps its measured value (`measured`);
 * - a size between two measured sizes lies on the straight line between the nearest measured size
 *   below and the nearest above it (`interpolated`);
 * - a size outside the measured sizes continues the straight line through the TWO NEAREST measured
 *   sizes (`extrapolated`), e.g. AU 16 = AU 14 + (AU 14 − AU 10) / 2;
 * - with one measured size only, the other sizes step with the chart's own step at `point`
 *   (`extrapolated`).
 *
 * The position of a size on the line is its chart value at `point` (the AU chart steps 5 cm per
 * size, so that is the same as counting sizes); the row index when a chart row lacks the value.
 * Sizes that are not in the chart are ignored. Nothing is smoothed or corrected.
 */
export function fillSizes(chart: readonly SizeRow[], measured: Readonly<Record<string, number | undefined>>, point: 'waist' | 'hip'): { cm: PerSize; source: PerSizeSource } {
  const byChart = chart.every((r) => r[point] !== undefined);
  const x = (i: number): number => (byChart ? (chart[i]![point] as number) : i);
  const known = chart.map((r, i) => ({ i, v: measured[r.size] })).filter((k): k is { i: number; v: number } => k.v !== undefined);
  const cm: Record<string, number> = {};
  const source: Record<string, RingSource> = {};
  if (known.length === 0) return { cm, source };
  chart.forEach((row, i) => {
    const own = known.find((k) => k.i === i);
    if (own) {
      cm[row.size] = own.v;
      source[row.size] = 'measured';
      return;
    }
    if (known.length === 1) {
      const k = known[0]!;
      // one sample: the chart's own step (or nothing to step with: the sample's value)
      cm[row.size] = round1(k.v + (byChart ? x(i) - x(k.i) : 0));
      source[row.size] = 'extrapolated';
      return;
    }
    const below = known.filter((k) => k.i < i);
    const above = known.filter((k) => k.i > i);
    const between = below.length > 0 && above.length > 0;
    const [a, b] = between ? [below[below.length - 1]!, above[0]!] : below.length > 0 ? [below[below.length - 2]!, below[below.length - 1]!] : [above[0]!, above[1]!];
    cm[row.size] = round1(a.v + ((b.v - a.v) * (x(i) - x(a.i))) / (x(b.i) - x(a.i)));
    source[row.size] = between ? 'interpolated' : 'extrapolated';
  });
  return { cm, source };
}

/** The ring inputs from tape measurements: band on the waist steps, hip and hem on the hip steps. */
export function inputsFromTape(chart: readonly SizeRow[], tape: TapeMeasurements): GarmentRingInputs {
  const pick = (key: keyof TapeSize): Record<string, number | undefined> => Object.fromEntries(Object.entries(tape.sizes).map(([size, t]) => [size, t[key]]));
  const relaxed = fillSizes(chart, pick('bandRelaxedCm'), 'waist');
  const stretched = fillSizes(chart, pick('bandStretchedCm'), 'waist');
  const hip = fillSizes(chart, pick('hipCm'), 'hip');
  const hem = fillSizes(chart, pick('hemSweepCm'), 'hip');
  const has = (f: { cm: PerSize }): boolean => Object.keys(f.cm).length > 0;
  return {
    measuredSizes: chart.map((r) => r.size).filter((size) => tape.sizes[size] !== undefined),
    ...(has(relaxed) && has(stretched)
      ? { band: { source: relaxed.source, relaxedCm: relaxed.cm, stretchedCm: stretched.cm, closure: tape.closure ?? ASSUMED_CLOSURE, closureSource: tape.closure ? ('measured' as const) : ('assumed' as const) } }
      : {}),
    ...(has(hip) ? { hip: { source: hip.source, girthCm: hip.cm, belowBandCm: tape.hipBelowBandCm ?? null } } : {}),
    ...(has(hem) ? { hem: { source: hem.source, sweepCm: hem.cm } } : {}),
  };
}

/** The pilot skirt's inputs: the tape when filled in, else the assumed band and hem sweep. */
export function pilotSkirtInputs(chart: readonly SizeRow[], tape: TapeMeasurements | null = PILOT_SKIRT_TAPE, scenario: BandScenario = 'mid'): GarmentRingInputs {
  const measured = tape ? inputsFromTape(chart, tape) : {};
  return {
    measuredSizes: measured.measuredSizes ?? [],
    band: measured.band ?? assumedBand(chart, scenario),
    ...(measured.hip ? { hip: measured.hip } : {}),
    hem: measured.hem ?? { source: allSizes(chart, 'assumed'), sweepCm: gradeFromSample(chart, ASSUMED_BAND_SAMPLE_SIZE, ASSUMED_HEM_SCENARIOS[scenario], 'hip') },
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

/** One body in one size under a band input: how far the band stretches and whether it clears the hips. */
export interface BandSweepRow {
  size: string;
  relaxedCm: number;
  stretchedCm: number;
  /** (body waist − relaxed) / (stretched − relaxed), 0-1; below 0 the band does not grip, above 1 it cannot close. */
  waistStretch: number;
  /** Stretched band minus body hip, cm (pull-on: below 0 it does not pass over the hips). */
  hipClearanceCm: number;
}

/**
 * The band of `size` on a body (waist and hip girths, cm). Garment physics of the band input only:
 * the size advice and its tight / good / loose words still come from the fit engine alone.
 */
export function bandSweep(band: Pick<BandInput, 'relaxedCm' | 'stretchedCm'>, size: string, body: { waist: number; hip: number }): BandSweepRow | null {
  const relaxed = band.relaxedCm[size];
  const stretched = band.stretchedCm[size];
  if (relaxed === undefined || stretched === undefined || stretched <= relaxed) return null;
  return {
    size,
    relaxedCm: relaxed,
    stretchedCm: stretched,
    waistStretch: Math.round(((body.waist - relaxed) / (stretched - relaxed)) * 100) / 100,
    hipClearanceCm: Math.round((stretched - body.hip) * 10) / 10,
  };
}
