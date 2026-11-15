/**
 * Per-size garment tape measurements and the closure (docs/MERCHANT-MEASUREMENTS.md,
 * docs/research/step3-serverdrape-spike.md §8.8 and §9.2).
 *
 * A size chart says which BODY a size is cut for. It does not say how big the GARMENT is: how far
 * the waistband stretches, how wide the hem swings. These two optional fields carry that:
 *
 * - `closure`: how the garment is opened to get into it. `'pull-on'` means it is not opened at all,
 *   so the waistband has to pass the hips at the stretch the shop measured.
 * - `garmentTape`: per size, up to five tape numbers of the garment lying flat (waistband relaxed,
 *   waistband stretched, hip girth at a stated depth below the band, hem sweep, length), each with
 *   its provenance: measured by the shop, interpolated between two measured sizes, or extrapolated
 *   beyond them. A value that was not measured is never stored as measured.
 *
 * Both are optional on the payload. Absent means the behaviour from before they existed.
 */
import { z } from 'zod';

/** How a garment is opened to put it on. Only `'pull-on'` changes the fit engine's result. */
export const GARMENT_CLOSURES = ['pull-on', 'zip', 'button', 'drawstring', 'wrap', 'other'] as const;
export type GarmentClosure = (typeof GARMENT_CLOSURES)[number];
export const GarmentClosureSchema = z.enum(GARMENT_CLOSURES);

/** Where a tape value comes from. */
export const TAPE_PROVENANCES = ['measured', 'interpolated', 'extrapolated'] as const;
export type TapeProvenance = (typeof TAPE_PROVENANCES)[number];
export const TapeProvenanceSchema = z.enum(TAPE_PROVENANCES);

const tapeCm = z.number().positive().max(600);

export const TapeValueSchema = z
  .object({
    cm: tapeCm.describe('Full girth (flat width x 2) or length, cm'),
    provenance: TapeProvenanceSchema.describe(
      "'measured' = the shop measured this size; 'interpolated' = on the line between two measured sizes; 'extrapolated' = beyond the measured sizes",
    ),
  })
  .describe('One garment tape value with its provenance');
export type TapeValue = z.infer<typeof TapeValueSchema>;

export const TapeHipValueSchema = TapeValueSchema.extend({
  depthBelowBandCm: z
    .number()
    .min(0)
    .max(80)
    .optional()
    .describe('Distance below the top edge of the waistband at which the hip girth was measured, cm (the measuring list asks for 20)'),
}).describe('Garment hip girth with the depth below the band at which it was measured');
export type TapeHipValue = z.infer<typeof TapeHipValueSchema>;

/** The five per-size fields, in the order of the measuring list (A to E). */
export const GARMENT_TAPE_FIELDS = ['waistRelaxed', 'waistStretched', 'hip', 'hemSweep', 'length'] as const;
export type GarmentTapeField = (typeof GARMENT_TAPE_FIELDS)[number];

export const GarmentTapeRowSchema = z
  .object({
    size: z.string().min(1).max(16).describe('Size label, as in sizeChart'),
    waistRelaxed: TapeValueSchema.optional().describe('A: waistband girth, relaxed'),
    waistStretched: TapeValueSchema.optional().describe('B: waistband girth, stretched to its comfortable limit'),
    hip: TapeHipValueSchema.optional().describe('C: garment hip girth at a stated depth below the band'),
    hemSweep: TapeValueSchema.optional().describe('D: hem girth'),
    length: TapeValueSchema.optional().describe('E: top edge of the waistband to the hem'),
  })
  .refine((row) => row.waistRelaxed === undefined || row.waistStretched === undefined || row.waistStretched.cm >= row.waistRelaxed.cm, {
    path: ['waistStretched', 'cm'],
    message: 'The stretched waistband cannot be smaller than the relaxed waistband',
  })
  .describe('Garment tape measurements of one size, in cm');
export type GarmentTapeRow = z.infer<typeof GarmentTapeRowSchema>;

const labelKey = (label: string): string => label.trim().toUpperCase();

export const GarmentTapeSchema = z
  .array(GarmentTapeRowSchema)
  .min(1)
  .max(30)
  .superRefine((rows, ctx) => {
    const first = new Map<string, number>();
    rows.forEach((row, i) => {
      const key = labelKey(row.size);
      const j = first.get(key);
      if (j === undefined) {
        first.set(key, i);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: [i, 'size'],
        message: `Duplicate size label "${row.size}" (rows ${j + 1} and ${i + 1}): every size has one row of tape measurements`,
      });
    });
  })
  .describe(
    'Garment tape measurements per size (flat, girths doubled), each value with its provenance. Sizes are matched to sizeChart by label (trimmed, case-insensitive).',
  );
export type GarmentTape = z.infer<typeof GarmentTapeSchema>;

// ---------------------------------------------------------------------------
// Filling the sizes the shop did not measure
// ---------------------------------------------------------------------------

/** What the shop measured on one size: plain numbers, cm. Leave out what was not measured. */
export interface MeasuredTapeRow {
  size: string;
  waistRelaxedCm?: number;
  waistStretchedCm?: number;
  hipCm?: number;
  /** Depth below the top edge of the band at which `hipCm` was measured. */
  hipDepthBelowBandCm?: number;
  hemSweepCm?: number;
  lengthCm?: number;
}

/** The chart rows `fillGarmentTape` reads: label and, for the position on the line, waist and hip. */
export interface TapeChartRow {
  size: string;
  waist?: number | undefined;
  hip?: number | undefined;
}

const INPUT_KEY: Record<GarmentTapeField, keyof MeasuredTapeRow> = {
  waistRelaxed: 'waistRelaxedCm',
  waistStretched: 'waistStretchedCm',
  hip: 'hipCm',
  hemSweep: 'hemSweepCm',
  length: 'lengthCm',
};

/** The chart column that places a size on the line: the band on the waist steps, the rest on the hip steps. */
const POSITION_POINT: Record<GarmentTapeField, 'waist' | 'hip'> = {
  waistRelaxed: 'waist',
  waistStretched: 'waist',
  hip: 'hip',
  hemSweep: 'hip',
  length: 'hip',
};

const round1 = (v: number): number => Math.round(v * 10) / 10;
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * One value per chart size from the values measured on some sizes. THE RULE (the one the spike
 * uses: apps/web/src/render/ringInputs.ts `fillSizes`, serverdrape/band_model.py `tape_value`):
 *
 * - a measured size keeps its measured value (`measured`);
 * - a size between two measured sizes lies on the straight line between the nearest measured size
 *   below and the nearest above it (`interpolated`);
 * - a size outside the measured sizes continues the straight line through the TWO NEAREST measured
 *   sizes (`extrapolated`), e.g. AU 16 = AU 14 + (AU 14 − AU 10) / 2;
 * - with one measured size only, the other sizes step with the chart's own step (`extrapolated`).
 *
 * The position of a size on the line is its chart value (waist for the two band fields, hip for
 * the others); the row index when any chart row lacks that value. Nothing is smoothed or corrected.
 */
function fillField(
  chart: readonly TapeChartRow[],
  measured: ReadonlyMap<string, MeasuredTapeRow>,
  field: GarmentTapeField,
): (TapeValue | undefined)[] {
  const point = POSITION_POINT[field];
  const byChart = chart.every((r) => isPositive(r[point]));
  const x = (i: number): number => (byChart ? (chart[i]![point] as number) : i);
  const known: { i: number; v: number }[] = [];
  chart.forEach((row, i) => {
    const v = measured.get(labelKey(row.size))?.[INPUT_KEY[field]];
    if (isPositive(v)) known.push({ i, v });
  });
  if (known.length === 0) return chart.map(() => undefined);
  return chart.map((_, i): TapeValue | undefined => {
    const own = known.find((k) => k.i === i);
    if (own) return { cm: own.v, provenance: 'measured' };
    let cm: number;
    let provenance: TapeProvenance;
    if (known.length === 1) {
      const k = known[0]!;
      cm = round1(k.v + (byChart ? x(i) - x(k.i) : 0));
      provenance = 'extrapolated';
    } else {
      const below = known.filter((k) => k.i < i);
      const above = known.filter((k) => k.i > i);
      const between = below.length > 0 && above.length > 0;
      const [a, b] = between
        ? [below[below.length - 1]!, above[0]!]
        : below.length > 0
          ? [below[below.length - 2]!, below[below.length - 1]!]
          : [above[0]!, above[1]!];
      const span = x(b.i) - x(a.i);
      // Two chart rows with the same value cannot place a size: fall back to the nearer sample.
      cm = span === 0 ? a.v : round1(a.v + ((b.v - a.v) * (x(i) - x(a.i))) / span);
      provenance = between ? 'interpolated' : 'extrapolated';
    }
    // A line that leaves the positive range says nothing about a garment: no value.
    return isPositive(cm) ? { cm, provenance } : undefined;
  });
}

/**
 * `garmentTape` for every size of the chart, from the sizes the shop measured. Measured values are
 * kept as written; the other sizes are filled by the rule above and labelled `interpolated` or
 * `extrapolated`. Each field is filled on its own, so a field measured on fewer sizes is filled
 * from fewer samples. Sizes that are not in the chart are ignored; a chart size for which nothing
 * can be said gets no row.
 *
 * The hip depth is copied to a filled size only when every measured size states the same depth.
 * A filled size whose stretched band would come out smaller than its relaxed band loses both
 * (the line is not trusted there). Pure: the inputs are not changed.
 */
export function fillGarmentTape(chart: readonly TapeChartRow[], measured: readonly MeasuredTapeRow[]): GarmentTape {
  const bySize = new Map<string, MeasuredTapeRow>();
  for (const row of measured) if (row && typeof row.size === 'string') bySize.set(labelKey(row.size), row);

  const columns = Object.fromEntries(GARMENT_TAPE_FIELDS.map((f) => [f, fillField(chart, bySize, f)])) as Record<
    GarmentTapeField,
    (TapeValue | undefined)[]
  >;

  const depths = chart
    .map((row) => bySize.get(labelKey(row.size)))
    .filter((m): m is MeasuredTapeRow => m !== undefined && isPositive(m.hipCm))
    .map((m) => m.hipDepthBelowBandCm);
  const sharedDepth =
    depths.length > 0 && depths.every((d) => typeof d === 'number' && Number.isFinite(d) && d >= 0 && d === depths[0]) ? depths[0] : undefined;

  const out: GarmentTapeRow[] = [];
  chart.forEach((chartRow, i) => {
    const row: GarmentTapeRow = { size: chartRow.size };
    let relaxed = columns.waistRelaxed[i];
    let stretched = columns.waistStretched[i];
    if (relaxed && stretched && stretched.cm < relaxed.cm && (relaxed.provenance !== 'measured' || stretched.provenance !== 'measured')) {
      relaxed = undefined;
      stretched = undefined;
    }
    if (relaxed) row.waistRelaxed = relaxed;
    if (stretched) row.waistStretched = stretched;
    const hip = columns.hip[i];
    if (hip) {
      const own = bySize.get(labelKey(chartRow.size))?.hipDepthBelowBandCm;
      const depth = hip.provenance === 'measured' ? own : sharedDepth;
      row.hip = typeof depth === 'number' && Number.isFinite(depth) && depth >= 0 ? { ...hip, depthBelowBandCm: depth } : hip;
    }
    const hem = columns.hemSweep[i];
    if (hem) row.hemSweep = hem;
    const length = columns.length[i];
    if (length) row.length = length;
    if (Object.keys(row).length > 1) out.push(row);
  });
  return out;
}

/** The worst provenance among tape values: extrapolated over interpolated over measured. */
export function worstTapeProvenance(values: readonly (TapeProvenance | undefined)[]): TapeProvenance | undefined {
  let worst: TapeProvenance | undefined;
  for (const v of values) {
    if (v === undefined) continue;
    if (worst === undefined || TAPE_PROVENANCES.indexOf(v) > TAPE_PROVENANCES.indexOf(worst)) worst = v;
  }
  return worst;
}
