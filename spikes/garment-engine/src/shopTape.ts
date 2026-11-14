/**
 * Shop tape measurements of a garment (data/<shop>/tape/<handle>.json) and what of them a
 * GarmentPayload v1 can carry. The tape gives five numbers PER SIZE (band relaxed, band stretched,
 * garment hip, hem sweep, length); the payload has no per-size garment measurement next to a body
 * chart, so only two single numbers go in, both through existing fields and both the mean over the
 * MEASURED sizes (never an interpolated size):
 *
 * - `lengthCm.waist_to_hem`: band to hem, flat;
 * - `ease.hip`: garment hip minus the chart's body hip (body charts only).
 *
 * The elastic band (relaxed / stretched), the hem sweep and the per-size values stay in the tape
 * file, which the entry names beside the payload (`tape`), like `baseSize` and `features`.
 * The waist gets NO ease from the tape: the band is elastic, and the schema's `ease.waist` is one
 * garment-minus-body number, not a relaxed-to-stretched range.
 */
import { completenessScore, type CompletenessResult, type Ease, type GarmentPayloadDraft, type LengthCm } from '@curtain/schema';

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

  const chart = payload.sizeChart ?? [];
  const hipEases = rows.map((r) => {
    const body = chart.find((c) => c.size === r.size)?.hip;
    return body === undefined ? undefined : Math.round((r.hipCm - body) * 10) / 10;
  });
  if (payload.sizeChartType === 'body' && hipEases.every((e): e is number => e !== undefined)) {
    const hip = mean1(hipEases);
    payload.ease = { ...(payload.ease ?? {}), hip } as Ease;
    inPayload['ease.hip'] = `${hip} cm: mean of garment hip minus chart body hip, ${hipEases.join(', ')} cm (${sizesText}); the steps are uneven and are not corrected`;
    evidence.ease = `shop tape (${file}): garment hip ${rows.map((r) => r.hipCm).join(' / ')} cm minus the chart's body hip at ${sizesText} = ${hipEases.join(' / ')} cm; one number for all sizes, the mean ${hip} cm. No waist ease: the band is elastic (relaxed ${rows.map((r) => r.waistRelaxedCm).join(' / ')}, stretched ${rows.map((r) => r.waistStretchedCm).join(' / ')} cm) and ease.waist is one number, not a range`;
  }

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
        'garment hip per size (ease.hip is one number for all sizes; sizeChart is the body chart and sizeChartType allows only one chart)',
        'length per size (lengthCm holds one number per key)',
        'which sizes were measured and which are interpolated or extrapolated',
      ],
    },
  };
}
