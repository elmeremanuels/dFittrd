/**
 * The men's size chart columns in the merchant chart builders (men-3d-plan slice M2, "Not done":
 * the Shopify admin and WooCommerce mirrors). `@curtain/schema` already carries the columns on the
 * wire (`SizeRow.neck`, `sleeve`, `length`, `rise`, `axes`, and `GarmentPayload.sleeveConvention`);
 * this file is what a merchant surface needs on top:
 *
 *  - `wlAxesFromLabel`: a waist/leg size label ("32/34", "W32/L34", "32x34") as its two axes;
 *  - `checkChartColumns`: the plain-English check of those columns before a chart is written
 *    (W/L labels and pairs, the sleeve measuring point, plausible ranges);
 *  - `CHART_COLUMN_TEXT`: the builder's English catalogue for these columns (D21).
 *
 * The WooCommerce plugin has PHP twins (`Chart_Columns`); `CHART_COLUMN_CASES` are the shared cases
 * both must answer alike (packages/woocommerce-plugin/tests/chart-columns.test.php).
 *
 * Women's charts never carry these columns, so for them the check adds nothing.
 */
import { SLEEVE_CONVENTIONS, sizeLabelKey, type SizeRow, type SleeveConvention } from './garment';

/** Columns a men's chart may add to the women's ones, in table order. */
export const MENS_CHART_COLUMNS = ['neck', 'sleeve', 'length', 'rise'] as const;
export type MensChartColumn = (typeof MENS_CHART_COLUMNS)[number];

/**
 * Plausible ranges in cm [A, trade knowledge, not measured]: collar girth, sleeve length (per
 * measuring point: a short sleeve from the shoulder seam is 15 to 30 cm, a long one 55 to 70; from
 * the centre back neck add about half the shoulders), garment body length from the high shoulder
 * point, front rise of trousers.
 */
export const MENS_COLUMN_RANGES: Readonly<Record<MensChartColumn, readonly [number, number]>> = Object.freeze({
  neck: [30, 55],
  sleeve: [10, 100],
  length: [45, 100],
  rise: [15, 45],
});
export const SLEEVE_RANGES: Readonly<Record<SleeveConvention, readonly [number, number]>> = Object.freeze({
  shoulder_point: [10, 75],
  centre_back: [35, 100],
});

/** English catalogue of the men's columns in both builders (D21: one catalogue, one lookup). */
export const CHART_COLUMN_TEXT = Object.freeze({
  columns: Object.freeze({ chest: 'Chest', seat: 'Seat', neck: 'Neck', sleeve: 'Sleeve', length: 'Length', rise: 'Rise' }),
  sleeveConventionLegend: 'The sleeve is measured',
  sleeveConventions: Object.freeze({
    shoulder_point: 'from the shoulder seam to the cuff',
    centre_back: 'from the centre back of the neck, over the shoulder, to the cuff',
  } satisfies Record<SleeveConvention, string>),
  wlHint: 'Sizes are waist/leg, for example 32/34. Add a size as waist/leg.',
  help: Object.freeze({
    top: 'Chest and waist all round (2 × the flat width). Shoulder seam to seam. Length from the high shoulder point to the hem. Neck: the collar all round. Values are stored in cm.',
    bottom: 'Waist and seat all round (2 × the flat width), thigh all round. Rise from the crotch seam to the top of the waistband at the front. Inseam from the crotch to the hem. Values are stored in cm.',
  }),
});

const WL_LABEL = /^\s*W?\s*(\d{2})\s*[/xX]\s*L?\s*(\d{2})\s*$/i;

/** "32/34", "W32/L34", "w32 / l34", "32x34" → { waist: '32', leg: '34' }; anything else → null. */
export function wlAxesFromLabel(label: string): { waist: string; leg: string } | null {
  const m = WL_LABEL.exec(label);
  return m ? { waist: m[1]!, leg: m[2]! } : null;
}

/** Rows of a W/L chart with `axes` read from each label; a row whose label is not waist/leg is left without. */
export function withWlAxes(rows: readonly SizeRow[]): SizeRow[] {
  return rows.map((r) => {
    if (r.axes) return { ...r };
    const axes = wlAxesFromLabel(r.size);
    return axes ? { ...r, axes } : { ...r };
  });
}

/** A number as the message prints it (42, 42.5). */
function n(v: number): string {
  return String(v);
}

export const CHART_COLUMN_MESSAGES = Object.freeze({
  notWl: (size: string) => `Size ${size} is not a waist/leg size: write it as waist/leg, for example 32/34.`,
  axesMixed: () => 'Either every size has a waist and a leg (for example 32/34) or none has.',
  axesTwice: (waist: string, leg: string, a: string, b: string) => `Waist ${waist} with leg ${leg} appears twice (sizes ${a} and ${b}).`,
  sleeveNoConvention: () => 'The chart has a sleeve column: say where the sleeve is measured from, the shoulder seam or the centre back of the neck.',
  sleeveUnknown: (v: string) => `Unknown sleeve measuring point '${v}': choose the shoulder seam or the centre back of the neck.`,
  outOfRange: (size: string, col: string, v: number, lo: number, hi: number) => `Size ${size}: ${col} ${n(v)} cm is outside the usual ${lo}–${hi} cm.`,
});

export interface ChartColumnsInput {
  sizeChartType?: string;
  sizeChart?: readonly SizeRow[];
  /** As the merchant sent it; checked against `SLEEVE_CONVENTIONS`. */
  sleeveConvention?: unknown;
  /** The builder's W/L mode: every label must be waist/leg. */
  wl?: boolean;
}

export interface ChartColumnsCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Errors (blocking): in W/L mode a label that is not waist/leg; outside it, some rows with axes and
 * some without; a waist × leg pair twice; a garment chart with a sleeve column and no (or an
 * unknown) measuring point. Warnings: a men's column outside its usual range. Body charts need no
 * sleeve measuring point (their sleeve is the arm length).
 */
export function checkChartColumns(input: ChartColumnsInput): ChartColumnsCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = input.sizeChart ?? [];
  const M = CHART_COLUMN_MESSAGES;

  if (input.wl) {
    for (const r of rows) if (!r.axes) errors.push(M.notWl(r.size));
  } else {
    const withAxes = rows.filter((r) => r.axes !== undefined).length;
    if (withAxes > 0 && withAxes < rows.length) errors.push(M.axesMixed());
  }
  const pairs = new Map<string, string>();
  for (const r of rows) {
    if (!r.axes) continue;
    const key = `${sizeLabelKey(r.axes.waist)}\u0000${sizeLabelKey(r.axes.leg)}`;
    const first = pairs.get(key);
    if (first !== undefined) errors.push(M.axesTwice(r.axes.waist, r.axes.leg, first, r.size));
    else pairs.set(key, r.size);
  }

  const hasSleeve = rows.some((r) => typeof r.sleeve === 'number');
  const conv = input.sleeveConvention;
  const known = typeof conv === 'string' && (SLEEVE_CONVENTIONS as readonly string[]).includes(conv) ? (conv as SleeveConvention) : undefined;
  if (conv !== undefined && conv !== null && conv !== '' && !known) errors.push(M.sleeveUnknown(String(conv)));
  else if (hasSleeve && input.sizeChartType === 'garment' && !known) errors.push(M.sleeveNoConvention());

  for (const r of rows) {
    for (const col of MENS_CHART_COLUMNS) {
      const v = r[col];
      if (typeof v !== 'number') continue;
      const [lo, hi] = col === 'sleeve' && known && input.sizeChartType === 'garment' ? SLEEVE_RANGES[known] : MENS_COLUMN_RANGES[col];
      if (v < lo || v > hi) warnings.push(M.outOfRange(r.size, col, v, lo, hi));
    }
  }
  return { errors, warnings };
}

/** Shared cases: the TypeScript check and the PHP `Chart_Columns::check` must give the same answer. */
export const CHART_COLUMN_CASES: ReadonlyArray<{ name: string; input: ChartColumnsInput }> = Object.freeze([
  { name: "a women's body chart: nothing to say", input: { sizeChartType: 'body', sizeChart: [{ size: '8', bust: 85, waist: 67.5, hip: 94 }, { size: '10', bust: 90, waist: 72.5, hip: 99 }] } },
  {
    name: "a men's tee with neck and sleeve from the shoulder seam",
    input: { sizeChartType: 'garment', sleeveConvention: 'shoulder_point', sizeChart: [{ size: 'S', bust: 98, shoulder: 43.5, length: 70, sleeve: 20, neck: 42 }, { size: 'M', bust: 106, shoulder: 44, length: 72, sleeve: 21, neck: 43 }] },
  },
  { name: 'a sleeve column and no measuring point', input: { sizeChartType: 'garment', sizeChart: [{ size: 'S', bust: 98, sleeve: 20 }, { size: 'M', bust: 106, sleeve: 21 }] } },
  { name: 'an unknown measuring point', input: { sizeChartType: 'garment', sleeveConvention: 'armpit', sizeChart: [{ size: 'S', bust: 98, sleeve: 20 }] } },
  { name: 'a body chart sleeve (arm length) needs no measuring point', input: { sizeChartType: 'body', sizeChart: [{ size: 'M', bust: 98, sleeve: 64.5 }] } },
  { name: 'a centre-back sleeve of 20 cm is too short', input: { sizeChartType: 'garment', sleeveConvention: 'centre_back', sizeChart: [{ size: 'M', bust: 106, sleeve: 20 }, { size: 'L', bust: 114, sleeve: 42.5 }] } },
  { name: 'a flat collar and a rise of 60 cm', input: { sizeChartType: 'garment', sizeChart: [{ size: '32/32', waist: 83.5, neck: 21, rise: 60, axes: { waist: '32', leg: '32' } }] } },
  {
    name: 'a W/L chino chart, every label waist/leg',
    input: {
      sizeChartType: 'garment',
      wl: true,
      sizeChart: withWlAxes([
        { size: '30/30', waist: 78.5, hip: 99, rise: 26, inseam: 76 },
        { size: '30/32', waist: 78.5, hip: 99, rise: 26, inseam: 81 },
        { size: 'W32/L30', waist: 83.5, hip: 104, rise: 26.5, inseam: 76 },
        { size: '32x32', waist: 83.5, hip: 104, rise: 26.5, inseam: 81 },
      ]),
    },
  },
  { name: 'a W/L chart with a label that is not waist/leg', input: { sizeChartType: 'garment', wl: true, sizeChart: withWlAxes([{ size: '32/32', waist: 83.5 }, { size: '33', waist: 86 }, { size: 'M', waist: 88 }]) } },
  { name: 'some rows with axes, some without', input: { sizeChartType: 'garment', sizeChart: [{ size: '32/32', waist: 83.5, axes: { waist: '32', leg: '32' } }, { size: '34', waist: 88.5 }] } },
  { name: 'a waist and leg pair twice', input: { sizeChartType: 'garment', wl: true, sizeChart: withWlAxes([{ size: '32/32', waist: 83.5 }, { size: 'W32/L32', waist: 84 }, { size: '34/32', waist: 88.5 }]) } },
]);
