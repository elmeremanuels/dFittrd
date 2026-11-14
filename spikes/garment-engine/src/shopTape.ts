/**
 * Shop tape measurements of a garment (data/<shop>/tape/<handle>.json) and what of them a
 * GarmentPayload v1 can carry. The tape gives five numbers PER SIZE (band relaxed, band stretched,
 * garment hip, hem sweep, length); the payload has no per-size garment measurement next to a body
 * chart, so only ONE single number goes in, through an existing field, as the mean over the MEASURED
 * sizes (never an interpolated size):
 *
 * - `lengthCm.waist_to_hem`: band to hem, flat (the measured lengths differ by 1 cm).
 *
 * `ease.hip` (garment hip minus the chart's body hip) could hold a mean too, but it is LEFT OUT: the
 * measured values are uneven (the pilot skirt: 18 / 23 / 17 cm), so one number misstates the garment
 * hip of single sizes by several cm and grades it with the body chart's step instead of the
 * garment's. `hipEaseIfOneNumber` reports what the mean would do per size; the entry's `tape` note
 * carries it. Per-size targets are read from the tape file itself.
 *
 * The elastic band (relaxed / stretched), the hem sweep and the per-size values stay in the tape
 * file, which the entry names beside the payload (`tape`), like `baseSize` and `features`.
 * The waist gets NO ease from the tape: the band is elastic, and the schema's `ease.waist` is one
 * garment-minus-body number, not a relaxed-to-stretched range.
 */
import { completenessScore, type CompletenessResult, type GarmentPayloadDraft, type LengthCm, type SizeRow } from '@curtain/schema';

export const TAPE_FORMAT = 'curtain.spike.tapeMeasurements';

export interface TapeSizeRow {
  waistRelaxedCm: number;
  waistStretchedCm: number;
  hipCm: number;
  hemSweepCm: number;
  lengthCm: number;
}

export interface TapeFile {
  format: typeof TAPE_FORMAT;
  formatVersion: 1;
  product: string;
  productId?: string;
  source: string;
  method: string;
  measuredSizes: string[];
  notMeasuredSizes: string[];
  sizes: Record<string, TapeSizeRow>;
  transcriptionNotes?: string[];
}

const TAPE_KEYS = ['waistRelaxedCm', 'waistStretchedCm', 'hipCm', 'hemSweepCm', 'lengthCm'] as const;

/** A tape file read back as data: every measured size has its five positive numbers, nothing else is trusted. */
export function parseTape(value: unknown): TapeFile {
  const v = value as Partial<TapeFile> | null;
  if (!v || v.format !== TAPE_FORMAT || v.formatVersion !== 1) throw new Error(`not a ${TAPE_FORMAT} v1 file`);
  if (typeof v.product !== 'string' || !Array.isArray(v.measuredSizes) || !Array.isArray(v.notMeasuredSizes) || !v.sizes || typeof v.sizes !== 'object') throw new Error('tape file: product, measuredSizes, notMeasuredSizes and sizes are required');
  const keys = Object.keys(v.sizes);
  if (keys.length !== v.measuredSizes.length || v.measuredSizes.some((s) => !keys.includes(s))) throw new Error('tape file: sizes must hold exactly the measuredSizes');
  if (v.notMeasuredSizes.some((s) => keys.includes(s))) throw new Error('tape file: a size listed as not measured has values');
  for (const size of keys) {
    const row = v.sizes[size] as Partial<TapeSizeRow>;
    for (const k of TAPE_KEYS) if (typeof row[k] !== 'number' || !Number.isFinite(row[k]) || row[k] <= 0) throw new Error(`tape file: AU ${size} ${k} must be a positive number`);
    if (row.waistStretchedCm! <= row.waistRelaxedCm!) throw new Error(`tape file: AU ${size} stretched band is not larger than the relaxed band`);
  }
  return v as TapeFile;
}

const mean1 = (xs: readonly number[]): number => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

/** One chart size under a single `ease.hip` number: what the payload would say against what the tape says. */
export interface HipEaseRow {
  size: string;
  /** 'measured', or how the tape value of an unmeasured size was filled in. */
  source: 'measured' | 'interpolated' | 'extrapolated';
  /** Garment hip by the tape, cm (measured, or the straight line through the nearest measured sizes). */
  tapeHipCm: number;
  /** Chart body hip + the mean ease, cm. */
  oneNumberHipCm: number;
  /** oneNumberHipCm − tapeHipCm, cm. */
  errorCm: number;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * What ONE `ease.hip` (the mean of garment hip minus chart hip over the measured sizes) would make
 * of every chart size, against the tape. Unmeasured sizes: on the straight line between the nearest
 * measured sizes on either side (interpolated), or continuing the line through the two nearest
 * measured sizes (extrapolated); position on the line = the chart's body hip. Same rule as
 * apps/web/src/render/ringInputs.ts `fillSizes`. `null` when a measured size has no chart hip.
 */
export function hipEaseIfOneNumber(tape: TapeFile, chart: readonly SizeRow[]): { meanEaseCm: number; perSizeEaseCm: number[]; rows: HipEaseRow[] } | null {
  const known = tape.measuredSizes.map((size) => ({ size, x: chart.find((c) => c.size === size)?.hip, v: tape.sizes[size]!.hipCm }));
  if (known.length === 0 || !known.every((k): k is { size: string; x: number; v: number } => k.x !== undefined)) return null;
  known.sort((a, b) => a.x - b.x);
  const perSizeEaseCm = tape.measuredSizes.map((size) => round1(tape.sizes[size]!.hipCm - chart.find((c) => c.size === size)!.hip!));
  const meanEaseCm = mean1(perSizeEaseCm);
  const rows: HipEaseRow[] = [];
  for (const row of chart) {
    if (row.hip === undefined) continue;
    const x = row.hip;
    const own = known.find((k) => k.size === row.size);
    let tapeHipCm: number;
    let source: HipEaseRow['source'];
    if (own) {
      tapeHipCm = own.v;
      source = 'measured';
    } else if (known.length === 1) {
      tapeHipCm = round1(known[0]!.v + (x - known[0]!.x));
      source = 'extrapolated';
    } else {
      const below = known.filter((k) => k.x < x);
      const above = known.filter((k) => k.x > x);
      const between = below.length > 0 && above.length > 0;
      const [a, b] = between ? [below[below.length - 1]!, above[0]!] : below.length > 0 ? [below[below.length - 2]!, below[below.length - 1]!] : [above[0]!, above[1]!];
      tapeHipCm = round1(a.v + ((b.v - a.v) * (x - a.x)) / (b.x - a.x));
      source = between ? 'interpolated' : 'extrapolated';
    }
    const oneNumberHipCm = round1(x + meanEaseCm);
    rows.push({ size: row.size, source, tapeHipCm, oneNumberHipCm, errorCm: round1(oneNumberHipCm - tapeHipCm) });
  }
  return { meanEaseCm, perSizeEaseCm, rows };
}

export interface TapeEntryNote {
  /** Path of the tape file, relative to the shop's data directory. */
  file: string;
  measuredSizes: string[];
  notMeasuredSizes: string[];
  /** What went into the payload, and by which rule. */
  inPayload: Record<string, string>;
  /** What GarmentPayload v1 cannot carry (stays in the tape file only). */
  notInPayload: string[];
}

export interface TapeApplicable {
  payload: GarmentPayloadDraft;
  completeness: CompletenessResult;
  evidence: Record<string, string>;
  tape?: TapeEntryNote;
}

/**
 * The shop entry with the tape's payload-carriable numbers put in (a new object; `entry` is not
 * changed). Idempotent: applying the same tape twice gives the same entry.
 */
export function applyTape<T extends TapeApplicable>(entry: T, tape: TapeFile, file: string): T {
  const rows = tape.measuredSizes.map((size) => ({ size, ...tape.sizes[size]! }));
  const sizesText = `AU ${tape.measuredSizes.join(', ')}`;
  const payload: GarmentPayloadDraft = { ...entry.payload };
  const evidence = { ...entry.evidence };
  const inPayload: Record<string, string> = {};

  const lengths = rows.map((r) => r.lengthCm);
  const length = mean1(lengths);
  payload.lengthCm = { ...(payload.lengthCm ?? {}), waist_to_hem: length } as LengthCm;
  inPayload['lengthCm.waist_to_hem'] = `${length} cm: mean of the tape lengths ${lengths.join(', ')} cm (${sizesText})`;
  evidence.lengthCm = `shop tape (${file}): band to hem ${lengths.join(' / ')} cm at ${sizesText}; one number for all sizes, the mean ${length} cm`;

  // ease.hip is NOT written (see the file header): say what one number would have done, per size.
  const one = payload.sizeChartType === 'body' ? hipEaseIfOneNumber(tape, payload.sizeChart ?? []) : null;
  const signed = (v: number): string => `${v > 0 ? '+' : ''}${v}`;
  const hipNote = one
    ? `garment hip per size. ease.hip (one garment-minus-body number for all sizes) is left out: garment hip minus chart hip is ${one.perSizeEaseCm.join(' / ')} cm at ${sizesText}, uneven and not corrected; their mean ${one.meanEaseCm} cm would put the garment hip at ${one.rows.map((r) => `${r.oneNumberHipCm} (AU ${r.size}: ${signed(r.errorCm)} cm against the tape's ${r.tapeHipCm}${r.source === 'measured' ? '' : `, ${r.source}`})`).join(', ')}; sizeChart is the body chart and sizeChartType allows only one chart`
    : 'garment hip per size (ease.hip is one number for all sizes; sizeChart is the body chart and sizeChartType allows only one chart)';

  return {
    ...entry,
    payload,
    completeness: completenessScore(payload),
    evidence,
    tape: {
      file,
      measuredSizes: [...tape.measuredSizes],
      notMeasuredSizes: [...tape.notMeasuredSizes],
      inPayload,
      notInPayload: [
        'waistband relaxed and stretched girth per size (GarmentPayload v1 has no field for an elastic range)',
        'hem sweep per size (lengthCm holds lengths, not girths; no hem girth field)',
        hipNote,
        'length per size (lengthCm holds one number per key)',
        'which sizes were measured and which are interpolated or extrapolated',
      ],
    },
  };
}
