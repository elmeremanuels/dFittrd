/**
 * The merchant's "Garment measurements" form (docs/MERCHANT-MEASUREMENTS.md): what a shop types
 * in, how it is checked, and how the sizes it did not measure are filled.
 *
 * Both admin surfaces use this: the Shopify admin through the api (`/shopify/products/:id/garment-tape`),
 * the WooCommerce plugin through its PHP twin (`includes/class-garment-tape.php`), which must give
 * the same errors, warnings and filled tape for the cases in `tests/fixtures/garment-tape.json`
 * (written from `GARMENT_TAPE_FORM_CASES` by the plugin's export script).
 *
 * The shop types five numbers per size it measured (A to E, girths doubled, cm), marks which sizes
 * those are, states once at which depth below the band the hip was measured, and picks the closure.
 * The other sizes are filled by `fillGarmentTape` and labelled `interpolated` ("estimated") or
 * `extrapolated` ("rough estimate"). Errors stop a save; warnings do not.
 *
 * Every sentence a merchant reads is in `GARMENT_TAPE_MESSAGES` (D21: one English catalogue).
 * Nothing here concerns a shopper: no body measurement goes in or comes out (AGENTS.md rule 4).
 */
import { z } from 'zod';
import {
  GARMENT_TAPE_FIELDS,
  GarmentClosureSchema,
  fillGarmentTape,
  type GarmentClosure,
  type GarmentTape,
  type GarmentTapeField,
  type MeasuredTapeRow,
  type TapeChartRow,
} from './garmentTape';

/** Largest girth or length a tape value may have (the schema's bound), cm. */
export const TAPE_MAX_CM = 600;
/** Largest hip depth below the band, cm (the schema's bound). */
export const TAPE_MAX_DEPTH_CM = 80;
/** The depth the measuring list asks for, cm. */
export const TAPE_HIP_DEPTH_CM = 20;
/**
 * Below these a doubled girth is not an adult garment, and the number is most likely the flat
 * width that was not doubled (a waistband lies 33 to 40 cm flat). Warning only.
 */
export const TAPE_FLAT_WIDTH_HINT_CM: Readonly<Record<'waistRelaxed' | 'waistStretched' | 'hip' | 'hemSweep', number>> = Object.freeze({
  waistRelaxed: 45,
  waistStretched: 45,
  hip: 55,
  hemSweep: 55,
});

/** The plain-number input keys of a measured row, per field (A to E). */
export const TAPE_INPUT_KEYS: Readonly<Record<GarmentTapeField, 'waistRelaxedCm' | 'waistStretchedCm' | 'hipCm' | 'hemSweepCm' | 'lengthCm'>> = Object.freeze({
  waistRelaxed: 'waistRelaxedCm',
  waistStretched: 'waistStretchedCm',
  hip: 'hipCm',
  hemSweep: 'hemSweepCm',
  length: 'lengthCm',
});

// ---------------------------------------------------------------------------
// The English catalogue (D21)
// ---------------------------------------------------------------------------

/** Field names as the form shows them (letters of the measuring list). */
export const TAPE_FIELD_LABELS: Readonly<Record<GarmentTapeField, string>> = Object.freeze({
  waistRelaxed: 'A (waistband, relaxed)',
  waistStretched: 'B (waistband, stretched)',
  hip: 'C (hip)',
  hemSweep: 'D (hem)',
  length: 'E (length)',
});

export const TAPE_CLOSURE_LABELS: Readonly<Record<GarmentClosure, string>> = Object.freeze({
  'pull-on': 'Pull-on (elastic band, nothing to open)',
  zip: 'Zip',
  button: 'Buttons',
  drawstring: 'Drawstring (opens wider when loosened)',
  wrap: 'Wrap',
  other: 'Something else',
});

/** How a filled value is labelled in the form, and for the shopper. */
export const TAPE_PROVENANCE_LABELS = Object.freeze({ measured: 'measured', interpolated: 'estimated', extrapolated: 'rough estimate' });

/** A number as a merchant typed it: 94, 94.5 (the shortest form, as JavaScript prints it). */
export const formatTapeCm = (v: number): string => String(v);

const list = (xs: readonly string[]): string => xs.join(', ');

export const GARMENT_TAPE_MESSAGES = {
  noChart: () => 'Add a size chart first: the garment measurements are entered per size of the chart.',
  unknownSize: (size: string) => `Size ${size} is not in this product's size chart. Use the size labels of the chart.`,
  duplicateSize: (size: string) => `Size ${size} is entered twice. Keep one row per size.`,
  emptyMeasured: (size: string) => `Size ${size} is marked as measured but has no numbers. Enter its numbers, or untick "measured".`,
  notANumber: (size: string, field: GarmentTapeField | 'hipDepth') =>
    `Size ${size}, ${field === 'hipDepth' ? 'hip depth below the band' : TAPE_FIELD_LABELS[field]}: this is not a number. Write centimetres, for example 94 or 94.5.`,
  outOfRange: (size: string, field: GarmentTapeField, v: number) =>
    `Size ${size}, ${TAPE_FIELD_LABELS[field]}: ${formatTapeCm(v)} cm is not a garment measurement. Enter a number above 0 and at most ${TAPE_MAX_CM} cm.`,
  depthOutOfRange: (size: string, v: number) => `Size ${size}: the hip depth below the band (${formatTapeCm(v)} cm) must be between 0 and ${TAPE_MAX_DEPTH_CM} cm. We ask for ${TAPE_HIP_DEPTH_CM} cm.`,
  stretchedBelowRelaxed: (size: string, stretched: number, relaxed: number) =>
    `Size ${size}: the stretched waistband (${formatTapeCm(stretched)} cm) is smaller than the relaxed waistband (${formatTapeCm(relaxed)} cm). Check the two measurements.`,
  unknownClosure: () => 'Choose how the garment closes from the list.',
  looksFlat: (size: string, field: GarmentTapeField, v: number) =>
    `Size ${size}, ${TAPE_FIELD_LABELS[field]}: ${formatTapeCm(v)} cm looks like the flat width. Widths are measured flat and then doubled: write the width x 2.`,
  hipNoDepth: (sizes: readonly string[]) =>
    `The hip (C) of size ${list(sizes)} has no distance below the band. A hip number without its distance cannot be compared: write the distance (we ask for ${TAPE_HIP_DEPTH_CM} cm).`,
  hipDepthMixed: () => 'The hip (C) was measured at different distances below the band. The estimated sizes get no hip distance; measure every size at the same distance.',
  notBottom: (category: string) =>
    `These five numbers are for skirts and trousers with a waistband. This product's category is "${category}": they are stored, but the size advice uses them only for bottoms.`,
  noClosure: () => 'Say how the garment closes. For a pull-on garment the stretched waistband (B) has to go over the hips, and the size advice checks that.',
  pullOnNoStretch: () => 'This garment is pull-on, but no size has a stretched waistband (B). Without it the size advice cannot check that the garment goes over the hips.',
  fewSizes: (n: number, want: number) =>
    `${n === 1 ? 'Only 1 size is' : `Only ${n} sizes are`} measured. Measure at least ${want}: the smallest, the largest and one in between. Every other size is estimated from the measured ones.`,
  edgeUnmeasured: (size: string) =>
    `Size ${size} lies outside the measured sizes: its numbers are a rough estimate, and the size advice is more careful with it. Measuring size ${size} makes them exact.`,
  notIncreasing: (field: GarmentTapeField, larger: string, v: number, smaller: string, u: number) =>
    `${TAPE_FIELD_LABELS[field]}: size ${larger} (${formatTapeCm(v)} cm) is smaller than size ${smaller} (${formatTapeCm(u)} cm). Larger sizes are usually larger; check the numbers.`,
} as const;

// ---------------------------------------------------------------------------
// Check and fill
// ---------------------------------------------------------------------------

export const TAPE_ISSUE_CODES = [
  'no_chart',
  'unknown_size',
  'duplicate_size',
  'empty_measured',
  'not_a_number',
  'out_of_range',
  'depth_out_of_range',
  'stretched_below_relaxed',
  'unknown_closure',
  'looks_flat',
  'hip_no_depth',
  'hip_depth_mixed',
  'not_bottom',
  'no_closure',
  'pull_on_no_stretch',
  'few_sizes',
  'edge_unmeasured',
  'not_increasing',
] as const;
export type TapeIssueCode = (typeof TAPE_ISSUE_CODES)[number];

export const TapeIssueSchema = z.object({
  code: z.enum(TAPE_ISSUE_CODES),
  size: z.string().optional(),
  field: z.enum([...GARMENT_TAPE_FIELDS, 'hipDepth', 'closure']).optional(),
  message: z.string(),
});
export type TapeIssue = z.infer<typeof TapeIssueSchema>;

/** A measured row as a form sends it: an empty input is `null` or left out. */
export type MeasuredTapeInputRow = { size: string } & { [K in Exclude<keyof MeasuredTapeRow, 'size'>]?: number | null | undefined };

export interface GarmentTapeFormInput {
  /** The product's category; a non-bottom gets a warning (the engine reads the tape for bottoms only). */
  category?: string | null | undefined;
  /** The product's size chart (labels, and waist / hip to place the estimated sizes). */
  chart: readonly TapeChartRow[];
  /** `null` / absent = not said. A string outside `GARMENT_CLOSURES` is an error. */
  closure?: string | null | undefined;
  /** Only the sizes the shop measured. */
  measured: readonly MeasuredTapeInputRow[];
}

export interface GarmentTapeCheck {
  ok: boolean;
  errors: TapeIssue[];
  warnings: TapeIssue[];
  /** Measured sizes in chart order. */
  measuredSizes: string[];
  /** The filled tape (every chart size something can be said about); absent with errors or without a measured size. */
  garmentTape?: GarmentTape;
  closure?: GarmentClosure;
}

const key = (s: string): string => s.trim().toUpperCase();
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Check the form and fill the tape. Order of the issues is part of the contract (the PHP twin
 * gives the same list): errors per measured row in input order, then the closure; warnings per
 * row, then for the garment.
 */
export function checkGarmentTapeInput(input: GarmentTapeFormInput): GarmentTapeCheck {
  const M = GARMENT_TAPE_MESSAGES;
  const errors: TapeIssue[] = [];
  const warnings: TapeIssue[] = [];
  const chart = input.chart.filter((r) => r && typeof r.size === 'string' && r.size.trim() !== '');
  const chartIndex = new Map(chart.map((r, i) => [key(r.size), i]));
  const measuredRows = input.measured.filter((r) => r && typeof r.size === 'string' && r.size.trim() !== '');

  if (measuredRows.length > 0 && chart.length === 0) errors.push({ code: 'no_chart', message: M.noChart() });

  const seen = new Set<string>();
  const kept: { row: MeasuredTapeInputRow; at: number }[] = [];
  for (const row of measuredRows) {
    const size = row.size.trim();
    const k = key(size);
    if (chart.length > 0 && !chartIndex.has(k)) {
      errors.push({ code: 'unknown_size', size, message: M.unknownSize(size) });
      continue;
    }
    if (seen.has(k)) {
      errors.push({ code: 'duplicate_size', size, message: M.duplicateSize(size) });
      continue;
    }
    seen.add(k);
    const values = GARMENT_TAPE_FIELDS.filter((f) => row[TAPE_INPUT_KEYS[f]] !== undefined && row[TAPE_INPUT_KEYS[f]] !== null);
    if (values.length === 0) {
      errors.push({ code: 'empty_measured', size, message: M.emptyMeasured(size) });
      continue;
    }
    let bad = false;
    for (const f of values) {
      const v: unknown = row[TAPE_INPUT_KEYS[f]];
      if (!isNum(v)) {
        errors.push({ code: 'not_a_number', size, field: f, message: M.notANumber(size, f) });
        bad = true;
      } else if (v <= 0 || v > TAPE_MAX_CM) {
        errors.push({ code: 'out_of_range', size, field: f, message: M.outOfRange(size, f, v) });
        bad = true;
      }
    }
    const depth: unknown = row.hipDepthBelowBandCm;
    if (depth !== undefined && depth !== null) {
      if (!isNum(depth)) {
        errors.push({ code: 'not_a_number', size, field: 'hipDepth', message: M.notANumber(size, 'hipDepth') });
        bad = true;
      } else if (depth < 0 || depth > TAPE_MAX_DEPTH_CM) {
        errors.push({ code: 'depth_out_of_range', size, field: 'hipDepth', message: M.depthOutOfRange(size, depth) });
        bad = true;
      }
    }
    const a = row.waistRelaxedCm;
    const b = row.waistStretchedCm;
    if (!bad && isNum(a) && isNum(b) && b < a) {
      errors.push({ code: 'stretched_below_relaxed', size, field: 'waistStretched', message: M.stretchedBelowRelaxed(size, b, a) });
      bad = true;
    }
    if (!bad) kept.push({ row: { ...row, size: chart.length > 0 ? chart[chartIndex.get(k)!]!.size : size }, at: chartIndex.get(k) ?? kept.length });
  }

  let closure: GarmentClosure | undefined;
  if (input.closure !== undefined && input.closure !== null && input.closure !== '') {
    const c = GarmentClosureSchema.safeParse(input.closure);
    if (c.success) closure = c.data;
    else errors.push({ code: 'unknown_closure', field: 'closure', message: M.unknownClosure() });
  }

  // ---- warnings ----
  kept.sort((x, y) => x.at - y.at);
  for (const { row } of kept) {
    for (const f of ['waistRelaxed', 'waistStretched', 'hip', 'hemSweep'] as const) {
      const v = row[TAPE_INPUT_KEYS[f]];
      if (isNum(v) && v < TAPE_FLAT_WIDTH_HINT_CM[f]) warnings.push({ code: 'looks_flat', size: row.size, field: f, message: M.looksFlat(row.size, f, v) });
    }
  }
  const hips = kept.filter(({ row }) => isNum(row.hipCm));
  const noDepth = hips.filter(({ row }) => !isNum(row.hipDepthBelowBandCm)).map(({ row }) => row.size);
  if (noDepth.length > 0) warnings.push({ code: 'hip_no_depth', field: 'hipDepth', message: M.hipNoDepth(noDepth) });
  const depths = new Set(hips.filter(({ row }) => isNum(row.hipDepthBelowBandCm)).map(({ row }) => row.hipDepthBelowBandCm));
  if (depths.size > 1) warnings.push({ code: 'hip_depth_mixed', field: 'hipDepth', message: M.hipDepthMixed() });

  const anyMeasured = kept.length > 0;
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  if (anyMeasured && category !== '' && category !== 'bottom') warnings.push({ code: 'not_bottom', message: M.notBottom(category) });
  if (anyMeasured && closure === undefined && !errors.some((e) => e.code === 'unknown_closure')) warnings.push({ code: 'no_closure', field: 'closure', message: M.noClosure() });
  if (closure === 'pull-on' && anyMeasured && !kept.some(({ row }) => isNum(row.waistStretchedCm))) {
    warnings.push({ code: 'pull_on_no_stretch', field: 'waistStretched', message: M.pullOnNoStretch() });
  }
  if (anyMeasured && chart.length > 0) {
    const want = Math.min(3, chart.length);
    if (kept.length < want) warnings.push({ code: 'few_sizes', message: M.fewSizes(kept.length, want) });
    const measuredKeys = new Set(kept.map(({ row }) => key(row.size)));
    const edges = chart.length > 1 ? [chart[0]!, chart[chart.length - 1]!] : [];
    for (const edge of edges) {
      if (!measuredKeys.has(key(edge.size))) warnings.push({ code: 'edge_unmeasured', size: edge.size, message: M.edgeUnmeasured(edge.size) });
    }
    for (const f of GARMENT_TAPE_FIELDS) {
      let prev: MeasuredTapeInputRow | undefined;
      for (const { row } of kept) {
        const v = row[TAPE_INPUT_KEYS[f]];
        if (!isNum(v)) continue;
        const u = prev?.[TAPE_INPUT_KEYS[f]];
        if (prev && isNum(u) && v < u) warnings.push({ code: 'not_increasing', size: row.size, field: f, message: M.notIncreasing(f, row.size, v, prev.size, u) });
        prev = row;
      }
    }
  }

  const ok = errors.length === 0;
  const out: GarmentTapeCheck = { ok, errors, warnings, measuredSizes: kept.map(({ row }) => row.size) };
  if (closure !== undefined) out.closure = closure;
  if (ok && anyMeasured && chart.length > 0) {
    const tape = fillGarmentTape(chart, kept.map(({ row }) => cleanRow(row)));
    if (tape.length > 0) out.garmentTape = tape;
  }
  return out;
}

/** Only the numeric fields that are set (no `null`s), in a fixed key order. */
function cleanRow(row: MeasuredTapeInputRow): MeasuredTapeRow {
  const out: MeasuredTapeRow = { size: row.size };
  for (const f of GARMENT_TAPE_FIELDS) {
    const v = row[TAPE_INPUT_KEYS[f]];
    if (isNum(v)) out[TAPE_INPUT_KEYS[f]] = v;
  }
  if (isNum(row.hipDepthBelowBandCm)) out.hipDepthBelowBandCm = row.hipDepthBelowBandCm;
  return out;
}

/** The sizes the shop measured, back from a stored tape: what the form shows as typed. */
export function measuredFromGarmentTape(tape: GarmentTape | undefined | null): MeasuredTapeRow[] {
  if (!tape) return [];
  const out: MeasuredTapeRow[] = [];
  for (const row of tape) {
    const m: MeasuredTapeRow = { size: row.size };
    for (const f of GARMENT_TAPE_FIELDS) {
      const v = row[f];
      if (v && v.provenance === 'measured') m[TAPE_INPUT_KEYS[f]] = v.cm;
    }
    if (row.hip?.provenance === 'measured' && row.hip.depthBelowBandCm !== undefined) m.hipDepthBelowBandCm = row.hip.depthBelowBandCm;
    if (Object.keys(m).length > 1) out.push(m);
  }
  return out;
}

/**
 * A stored tape against the product's current chart: rows for sizes the chart no longer has are
 * dropped, and every estimate is filled again from the measured values (a chart that changed since
 * the form was saved moves the estimates with it). Measured values are kept as they are.
 */
export function refillGarmentTape(chart: readonly TapeChartRow[], tape: GarmentTape): { garmentTape: GarmentTape | undefined; droppedSizes: string[] } {
  const labels = new Set(chart.map((r) => key(r.size)));
  const droppedSizes = tape.filter((r) => !labels.has(key(r.size))).map((r) => r.size);
  const measured = measuredFromGarmentTape(tape.filter((r) => labels.has(key(r.size))));
  if (measured.length === 0) return { garmentTape: undefined, droppedSizes };
  let filled: GarmentTape;
  try {
    filled = fillGarmentTape(chart, measured);
  } catch {
    return { garmentTape: undefined, droppedSizes };
  }
  return { garmentTape: filled.length > 0 ? filled : undefined, droppedSizes };
}

// ---------------------------------------------------------------------------
// Wire shapes (the Shopify admin's form route)
// ---------------------------------------------------------------------------

const tapeNumber = z.number().nullable().optional();

export const MeasuredTapeRowSchema = z.object({
  size: z.string().min(1).max(16),
  waistRelaxedCm: tapeNumber,
  waistStretchedCm: tapeNumber,
  hipCm: tapeNumber,
  hipDepthBelowBandCm: tapeNumber,
  hemSweepCm: tapeNumber,
  lengthCm: tapeNumber,
});

/** PUT /shopify/products/:id/garment-tape. `dryRun: true` checks and fills without writing (the form's live estimates). */
export const GarmentTapeWriteRequestSchema = z.object({
  closure: z.string().max(32).nullable(),
  measured: z.array(MeasuredTapeRowSchema).max(30),
  dryRun: z.boolean().optional(),
});
export type GarmentTapeWriteRequest = z.infer<typeof GarmentTapeWriteRequestSchema>;

export const GarmentTapeFormResponseSchema = z.object({
  productId: z.string(),
  category: z.string().nullable(),
  /** The chart's size labels, in order (the form's rows). */
  sizes: z.array(z.string()),
  closure: GarmentClosureSchema.nullable(),
  measured: z.array(MeasuredTapeRowSchema),
  garmentTape: z.array(z.unknown()).nullable(),
  errors: z.array(TapeIssueSchema),
  warnings: z.array(TapeIssueSchema),
  /** Metafield keys written (empty on a dry run or when nothing changed). */
  written: z.array(z.string()),
  syncQueued: z.boolean(),
});
export type GarmentTapeFormResponse = z.infer<typeof GarmentTapeFormResponseSchema>;
