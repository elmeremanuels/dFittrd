/**
 * Size chart templates for the merchant chart builder (Shopify admin, WooCommerce later).
 *
 * Two kinds, always explicit (`sizeChartType`, fit-engine test T14):
 *  - **body** templates: the body each size is cut for (bust, waist, hip in cm). AU, UK, EU and US
 *    women's numeric sizes. A merchant who sells to a regional standard and prints no chart of her
 *    own assigns one of these. Each is the per-cell median of retailer charts that were opened and
 *    read on 2026-11-06 (mean for two sources); write-up and links:
 *    docs/research/size-chart-templates.md. AU comes from `AU_WOMENS_BODY_CHART`
 *    (docs/research/au-size-chart.md).
 *  - **garment** templates: the size labels and the points to measure; the merchant fills the
 *    numbers per size from the finished garment (circumference, i.e. 2 × a flat width).
 *
 * Unit conversion is here too: the builder accepts inches and stores centimetres.
 */
import { z } from 'zod';
import { FabricSchema, LengthCmSchema, SizeChartSchema, SizeRowSchema, duplicateSizeLabels, type GarmentPayload, type SizeRow } from './garment';
import { AU_WOMENS_BODY_CHART, AU_WOMENS_CHART_SOURCES } from './fixtures/charts';

export type ChartRegion = 'AU' | 'UK' | 'EU' | 'US';
export type ChartKind = 'body' | 'garment';
export type ChartUnit = 'cm' | 'in';
/** Points a chart row can carry (SizeRow keys measured in cm). */
export const CHART_POINTS = ['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam'] as const;
export type ChartPoint = (typeof CHART_POINTS)[number];
export type BodyChartPoint = 'bust' | 'waist' | 'hip';
const BODY_POINTS: readonly BodyChartPoint[] = ['bust', 'waist', 'hip'];

export const CM_PER_INCH = 2.54;
/** Date every source below was opened and read. */
export const CHART_SOURCES_ACCESSED = '2026-11-06';

export interface ChartSourceRef {
  id: string;
  publisher: string;
  url: string;
  accessed: string;
  /** How the source prints its numbers; ranges are stored as their midpoint. */
  form: 'single' | 'range' | 'inches';
  /** False = read for comparison only, not in the median. */
  inMedian: boolean;
  note?: string;
}

/** One source chart as published, converted to cm (ranges → midpoint). */
export interface ChartSourceData extends ChartSourceRef {
  rows: ReadonlyArray<{ size: string; bust: number; waist: number; hip: number }>;
}

interface TemplateBase {
  id: string;
  kind: ChartKind;
  label: string;
  /** One line for the template picker. */
  description: string;
  /** Every size label the template knows, ascending. */
  sizes: readonly string[];
  /** Labels preselected in the builder. */
  defaultSizes: readonly string[];
}

export interface BodyChartTemplate extends TemplateBase {
  kind: 'body';
  region: ChartRegion;
  /** Body measurements in cm, one row per label in `sizes`. */
  rows: readonly SizeRow[];
  sources: readonly ChartSourceRef[];
  /** Labels resting on fewer than three sources: shown as "weakly sourced" in the builder. */
  weakSizes: readonly string[];
}

export interface GarmentChartTemplate extends TemplateBase {
  kind: 'garment';
  /** Points the merchant measures on the finished garment (circumferences in cm). */
  points: readonly ChartPoint[];
}

export type ChartTemplate = BodyChartTemplate | GarmentChartTemplate;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Nearest 0.5 (half up), the precision the charts are published in. */
export function roundHalfCm(v: number): number {
  return Math.round(v * 2) / 2;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const mid = (a: number, b: number) => (a + b) / 2;
const inch = (v: number) => v * CM_PER_INCH;

/** Per size and point: the median of the in-median sources (mean when two), rounded to 0.5 cm. */
export function chartFromSources(sizes: readonly string[], sources: readonly ChartSourceData[]): { rows: SizeRow[]; counts: Record<string, number> } {
  const used = sources.filter((s) => s.inMedian);
  const rows: SizeRow[] = [];
  const counts: Record<string, number> = {};
  for (const size of sizes) {
    const have = used.map((s) => s.rows.find((r) => r.size === size)).filter((r): r is NonNullable<typeof r> => r !== undefined);
    counts[size] = have.length;
    if (!have.length) continue;
    const row: SizeRow = { size };
    for (const p of BODY_POINTS) row[p] = roundHalfCm(median(have.map((r) => r[p])));
    rows.push(row);
  }
  return { rows, counts };
}

// ---------------------------------------------------------------------------
// Sources (opened and read on 2026-11-06; numbers as printed, converted to cm)
// ---------------------------------------------------------------------------

export const UK_WOMENS_CHART_SOURCES: readonly ChartSourceData[] = [
  {
    id: 'kite',
    publisher: 'Kite Clothing (UK)',
    url: 'https://kite-clothing.com/pages/womenswear-sizing',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Body measurements, UK 6–20, ranges (midpoint used).',
    rows: [
      { size: '6', bust: mid(75, 79), waist: mid(57, 61), hip: mid(83, 87) },
      { size: '8', bust: mid(80, 84), waist: mid(62, 66), hip: mid(88, 92) },
      { size: '10', bust: mid(85, 89), waist: mid(67, 71), hip: mid(93, 97) },
      { size: '12', bust: mid(90, 94), waist: mid(72, 76), hip: mid(98, 102) },
      { size: '14', bust: mid(95, 99), waist: mid(77, 81), hip: mid(103, 107) },
      { size: '16', bust: mid(100, 104), waist: mid(82, 86), hip: mid(108, 113) },
      { size: '18', bust: mid(105, 110), waist: mid(87, 92), hip: mid(114, 119) },
      { size: '20', bust: mid(111, 115), waist: mid(93, 97), hip: mid(120, 123) },
    ],
  },
  {
    id: 'seasalt',
    publisher: 'Seasalt Cornwall (UK)',
    url: 'https://www.seasaltcornwall.com/size-guide',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'single',
    inMedian: true,
    note: 'Women’s size guide, UK 8–28, single values. Sizes 22+ not used.',
    rows: [
      { size: '8', bust: 83, waist: 66, hip: 93 },
      { size: '10', bust: 88, waist: 71, hip: 98 },
      { size: '12', bust: 93, waist: 76, hip: 103 },
      { size: '14', bust: 98, waist: 81, hip: 108 },
      { size: '16', bust: 104, waist: 87, hip: 114 },
      { size: '18', bust: 110, waist: 93, hip: 120 },
      { size: '20', bust: 116, waist: 99, hip: 126 },
    ],
  },
  {
    id: 'hobbs',
    publisher: 'Hobbs London (UK)',
    url: 'https://www.hobbs.com/size-guide',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'single',
    inMedian: true,
    note: 'Women’s clothing (regular, not petite), UK 6–22, “full hip”. Also prints the international label equivalents used for the EU/US templates.',
    rows: [
      { size: '6', bust: 81.5, waist: 63.5, hip: 88.5 },
      { size: '8', bust: 84, waist: 66, hip: 91 },
      { size: '10', bust: 89, waist: 71, hip: 96 },
      { size: '12', bust: 95, waist: 77, hip: 102 },
      { size: '14', bust: 101, waist: 83, hip: 108.5 },
      { size: '16', bust: 107, waist: 89, hip: 114 },
      { size: '18', bust: 113, waist: 95, hip: 120 },
      { size: '20', bust: 119, waist: 101, hip: 126 },
    ],
  },
];

/** German numbering (DE/AT/NL/Nordics). FR/ES/BE labels are DE + 2, IT + 4 (Hobbs' conversion table). */
export const EU_WOMENS_CHART_SOURCES: readonly ChartSourceData[] = [
  {
    id: 'otto',
    publisher: 'OTTO (DE)',
    url: 'https://www.otto.de/shoppages/groessentabellen_damen',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Normalgrößen 32–50. Bust from “Kleider, Blazer, Jacken und Mäntel”, waist from “Hosen und Röcke”; hip identical in both. Ranges (midpoint used).',
    rows: [
      { size: '32', bust: mid(74, 77), waist: mid(61, 63), hip: mid(84, 87) },
      { size: '34', bust: mid(78, 81), waist: mid(64, 66), hip: mid(88, 91) },
      { size: '36', bust: mid(82, 85), waist: mid(67, 70), hip: mid(92, 95) },
      { size: '38', bust: mid(86, 89), waist: mid(71, 74), hip: mid(96, 98) },
      { size: '40', bust: mid(90, 93), waist: mid(75, 78), hip: mid(99, 101) },
      { size: '42', bust: mid(94, 97), waist: mid(79, 82), hip: mid(102, 104) },
      { size: '44', bust: mid(98, 102), waist: mid(83, 87), hip: mid(105, 108) },
      { size: '46', bust: mid(103, 107), waist: mid(88, 93), hip: mid(109, 112) },
    ],
  },
  {
    id: 'lidl',
    publisher: 'Lidl (DE)',
    url: 'https://www.lidl.de/c/lidl-groessentabelle/s10005239',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Damen Oberteile, Konfektionsgröße 32–50, ranges (midpoint used).',
    rows: [
      { size: '32', bust: mid(74, 78), waist: mid(60, 64), hip: mid(82, 87) },
      { size: '34', bust: mid(78, 82), waist: mid(64, 67), hip: mid(87, 91) },
      { size: '36', bust: mid(82, 86), waist: mid(67, 71), hip: mid(91, 95) },
      { size: '38', bust: mid(86, 90), waist: mid(71, 74), hip: mid(95, 99) },
      { size: '40', bust: mid(90, 94), waist: mid(74, 78), hip: mid(99, 102) },
      { size: '42', bust: mid(94, 98), waist: mid(78, 83), hip: mid(102, 105) },
      { size: '44', bust: mid(98, 102), waist: mid(83, 88), hip: mid(105, 108) },
      { size: '46', bust: mid(102, 107), waist: mid(88, 93), hip: mid(108, 112) },
    ],
  },
];

/** US misses numeric sizes. */
export const US_WOMENS_CHART_SOURCES: readonly ChartSourceData[] = [
  {
    id: 'nike',
    publisher: 'Nike (US)',
    url: 'https://www.nike.com/size-fit/womens-numeric',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'inches',
    inMedian: true,
    note: 'Women’s numeric, body measurements in inches (× 2.54). Sizes 00, 0 and 18+ not used.',
    rows: [
      { size: '2', bust: inch(31), waist: inch(24.5), hip: inch(34) },
      { size: '4', bust: inch(32.5), waist: inch(26), hip: inch(35.5) },
      { size: '6', bust: inch(34), waist: inch(27.5), hip: inch(37) },
      { size: '8', bust: inch(35.5), waist: inch(29), hip: inch(38.5) },
      { size: '10', bust: inch(37), waist: inch(30.5), hip: inch(40) },
      { size: '12', bust: inch(38.5), waist: inch(32), hip: inch(41.5) },
      { size: '14', bust: inch(41), waist: inch(34), hip: inch(43.5) },
      { size: '16', bust: inch(43.5), waist: inch(36), hip: inch(45.5) },
    ],
  },
  {
    id: 'talbots',
    publisher: 'Talbots (US)',
    url: 'https://www.talbots.com/size-charts/size-charts.html',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'inches',
    inMedian: true,
    note: 'The per-size “Haven Well Within” table (the Misses table pairs sizes 4–6, 8–10, …, with the same numbers), inches × 2.54.',
    rows: [
      { size: '2', bust: inch(33), waist: inch(26), hip: inch(36) },
      { size: '4', bust: inch(34), waist: inch(27), hip: inch(37) },
      { size: '6', bust: inch(35), waist: inch(28), hip: inch(38) },
      { size: '8', bust: inch(36), waist: inch(29), hip: inch(39) },
      { size: '10', bust: inch(37), waist: inch(30), hip: inch(40) },
      { size: '12', bust: inch(38.5), waist: inch(31.5), hip: inch(41.5) },
      { size: '14', bust: inch(40), waist: inch(33), hip: inch(43) },
      { size: '16', bust: inch(41.5), waist: inch(34.5), hip: inch(44.5) },
    ],
  },
  {
    id: 'lands-end',
    publisher: 'Lands’ End (US brand, UK site)',
    url: 'https://www.landsend.co.uk/Dresses/co/size-chart-women-dresses.html',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Women’s dresses, regular, cm with the US label per column (US 4–18); waist and hip ranges (midpoint used). No US 2.',
    rows: [
      { size: '4', bust: 86, waist: mid(70, 72), hip: 94 },
      { size: '6', bust: 89, waist: mid(72, 75), hip: 97 },
      { size: '8', bust: 91, waist: mid(75, 77), hip: 99 },
      { size: '10', bust: 94, waist: mid(77, 80), hip: 102 },
      { size: '12', bust: 98, waist: mid(81, 84), hip: mid(105, 108) },
      { size: '14', bust: 101, waist: mid(85, 88), hip: mid(109, 112) },
      { size: '16', bust: 107, waist: mid(89, 93), hip: mid(113, 117) },
    ],
  },
  {
    id: 'sizeguide-net',
    publisher: 'sizeguide.net',
    url: 'https://sizeguide.net/size-guide-women-size-chart.html',
    accessed: CHART_SOURCES_ACCESSED,
    form: 'inches',
    inMedian: false,
    note: 'Aggregator, comparison only (not a retailer).',
    rows: [
      { size: '2', bust: inch(32.5), waist: inch(24), hip: inch(34.5) },
      { size: '6', bust: inch(34.5), waist: inch(26), hip: inch(36.5) },
      { size: '10', bust: inch(36.5), waist: inch(28), hip: inch(38.5) },
      { size: '14', bust: inch(39.5), waist: inch(31), hip: inch(41.5) },
    ],
  },
];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function bodyTemplate(
  base: Omit<BodyChartTemplate, 'kind' | 'rows' | 'sources' | 'weakSizes'>,
  sources: readonly ChartSourceData[],
): BodyChartTemplate {
  const { rows, counts } = chartFromSources(base.sizes, sources);
  return Object.freeze({
    ...base,
    kind: 'body' as const,
    rows: Object.freeze(rows.map((r) => Object.freeze(r))),
    sources: sources.map(({ rows: _rows, ...ref }) => ref),
    weakSizes: base.sizes.filter((s) => (counts[s] ?? 0) < 3),
  });
}

const AU_TEMPLATE_SIZES = AU_WOMENS_BODY_CHART.map((r) => r.size);
const AU_COUNTS = new Map(AU_TEMPLATE_SIZES.map((s) => [s, AU_WOMENS_CHART_SOURCES.filter((src) => src.inMedian && src.rows.some((r) => r.size === s)).length]));

export const AU_WOMENS_BODY_TEMPLATE: BodyChartTemplate = Object.freeze({
  id: 'au-womens-body',
  kind: 'body' as const,
  region: 'AU' as const,
  label: 'Australia — women’s body chart (AU 6–20)',
  description: 'Body measurements per AU size, median of Country Road, Seed Heritage and Blue Illusion. For shops selling in AU sizes without their own chart.',
  sizes: AU_TEMPLATE_SIZES,
  defaultSizes: AU_TEMPLATE_SIZES.filter((s) => Number(s) >= 8),
  rows: AU_WOMENS_BODY_CHART,
  sources: AU_WOMENS_CHART_SOURCES.map((s) => ({
    id: s.id,
    publisher: s.publisher,
    url: s.url,
    accessed: s.accessed,
    form: /range/i.test(s.note) ? ('range' as const) : ('single' as const),
    inMedian: s.inMedian,
    note: s.note,
  })),
  weakSizes: AU_TEMPLATE_SIZES.filter((s) => (AU_COUNTS.get(s) ?? 0) < 3),
});

export const UK_WOMENS_BODY_TEMPLATE: BodyChartTemplate = bodyTemplate(
  {
    id: 'uk-womens-body',
    region: 'UK',
    label: 'United Kingdom — women’s body chart (UK 6–20)',
    description: 'Body measurements per UK size, median of Kite, Seasalt and Hobbs.',
    sizes: ['6', '8', '10', '12', '14', '16', '18', '20'],
    defaultSizes: ['8', '10', '12', '14', '16', '18'],
  },
  UK_WOMENS_CHART_SOURCES,
);

export const EU_WOMENS_BODY_TEMPLATE: BodyChartTemplate = bodyTemplate(
  {
    id: 'eu-womens-body',
    region: 'EU',
    label: 'Europe (DE/NL numbering) — women’s body chart (32–46)',
    description: 'Body measurements per German size, mean of OTTO and Lidl. French/Spanish labels are 2 higher (use the FR template), Italian 4 higher.',
    sizes: ['32', '34', '36', '38', '40', '42', '44', '46'],
    defaultSizes: ['34', '36', '38', '40', '42', '44'],
  },
  EU_WOMENS_CHART_SOURCES,
);

/** The same bodies as the EU template with FR/ES/BE labels (DE + 2). */
export const EU_FR_WOMENS_BODY_TEMPLATE: BodyChartTemplate = Object.freeze({
  ...EU_WOMENS_BODY_TEMPLATE,
  id: 'eu-fr-womens-body',
  label: 'Europe (FR/ES/BE numbering) — women’s body chart (34–48)',
  description: 'The EU body chart with French/Spanish labels (German size + 2).',
  sizes: EU_WOMENS_BODY_TEMPLATE.sizes.map((s) => String(Number(s) + 2)),
  defaultSizes: EU_WOMENS_BODY_TEMPLATE.defaultSizes.map((s) => String(Number(s) + 2)),
  rows: Object.freeze(EU_WOMENS_BODY_TEMPLATE.rows.map((r) => Object.freeze({ ...r, size: String(Number(r.size) + 2) }))),
  weakSizes: EU_WOMENS_BODY_TEMPLATE.weakSizes.map((s) => String(Number(s) + 2)),
});

export const US_WOMENS_BODY_TEMPLATE: BodyChartTemplate = bodyTemplate(
  {
    id: 'us-womens-body',
    region: 'US',
    label: 'United States — women’s body chart (US 2–16)',
    description: 'Body measurements per US misses size, median of Nike, Talbots and Lands’ End.',
    sizes: ['2', '4', '6', '8', '10', '12', '14', '16'],
    defaultSizes: ['2', '4', '6', '8', '10', '12', '14'],
  },
  US_WOMENS_CHART_SOURCES,
);

export const BODY_CHART_TEMPLATES: readonly BodyChartTemplate[] = [
  AU_WOMENS_BODY_TEMPLATE,
  UK_WOMENS_BODY_TEMPLATE,
  EU_WOMENS_BODY_TEMPLATE,
  EU_FR_WOMENS_BODY_TEMPLATE,
  US_WOMENS_BODY_TEMPLATE,
];

export const GARMENT_CHART_TEMPLATES: readonly GarmentChartTemplate[] = [
  {
    id: 'garment-au-dress-top',
    kind: 'garment',
    label: 'Garment measurements — dresses & tops, AU 8–16',
    description: 'Measure each finished size: bust and waist all round (2 × the flat width), hip when the style is fitted there.',
    sizes: ['8', '10', '12', '14', '16'],
    defaultSizes: ['8', '10', '12', '14', '16'],
    points: ['bust', 'waist', 'hip'],
  },
  {
    id: 'garment-letter-top',
    kind: 'garment',
    label: 'Garment measurements — tops & outerwear, XS–XL',
    description: 'Bust (chest) all round and shoulder seam to seam, per letter size.',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    defaultSizes: ['XS', 'S', 'M', 'L', 'XL'],
    points: ['bust', 'shoulder'],
  },
  {
    id: 'garment-letter-bottom',
    kind: 'garment',
    label: 'Garment measurements — bottoms, XS–XL',
    description: 'Waist and hip all round, thigh all round, inseam, per letter size.',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    defaultSizes: ['XS', 'S', 'M', 'L', 'XL'],
    points: ['waist', 'hip', 'thigh', 'inseam'],
  },
  {
    id: 'garment-one-size',
    kind: 'garment',
    label: 'Garment measurements — one size',
    description: 'One row for a one-size piece (kaftans, ponchos, free-size knits): the bust all round is the key number.',
    sizes: ['ONE'],
    defaultSizes: ['ONE'],
    points: ['bust', 'waist', 'hip'],
  },
];

export const CHART_TEMPLATES: readonly ChartTemplate[] = [...BODY_CHART_TEMPLATES, ...GARMENT_CHART_TEMPLATES];

export function chartTemplateById(id: string): ChartTemplate | undefined {
  return CHART_TEMPLATES.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export function toCm(value: number, unit: ChartUnit): number {
  return unit === 'in' ? value * CM_PER_INCH : value;
}

export function fromCm(cm: number, unit: ChartUnit): number {
  return unit === 'in' ? cm / CM_PER_INCH : cm;
}

/** Convert every measured point of a chart between units; cm results are rounded to 0.5, inches to 0.25. */
export function convertChart(rows: readonly SizeRow[], from: ChartUnit, to: ChartUnit): SizeRow[] {
  if (from === to) return rows.map((r) => ({ ...r }));
  return rows.map((r) => {
    const out: SizeRow = { ...r };
    for (const p of CHART_POINTS) {
      const v = r[p];
      if (typeof v !== 'number') continue;
      const cm = toCm(v, from);
      out[p] = to === 'cm' ? roundHalfCm(cm) : Math.round(fromCm(cm, 'in') * 4) / 4;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Building and checking a chart
// ---------------------------------------------------------------------------

export interface ChartInput {
  sizeChartType: ChartKind;
  sizeChart: SizeRow[];
}

/**
 * A body template as a chart for the given labels (default: the template's `defaultSizes`).
 * Unknown labels are ignored; the template's order is kept.
 */
export function chartFromBodyTemplate(t: BodyChartTemplate, sizes: readonly string[] = t.defaultSizes): ChartInput {
  const want = new Set(sizes.map((s) => s.trim().toUpperCase()));
  return { sizeChartType: 'body', sizeChart: t.rows.filter((r) => want.has(r.size.toUpperCase())).map((r) => ({ ...r })) };
}

/**
 * A garment template filled in by the merchant: `values[size][point]` in `unit`. Every size the
 * merchant left completely empty is dropped; the check below reports it.
 */
export function chartFromGarmentTemplate(
  t: GarmentChartTemplate,
  values: Readonly<Record<string, Partial<Record<ChartPoint, number | null | undefined>>>>,
  unit: ChartUnit = 'cm',
  sizes: readonly string[] = t.defaultSizes,
): ChartInput {
  const rows: SizeRow[] = [];
  for (const size of sizes) {
    const v = values[size] ?? {};
    const row: SizeRow = { size };
    let any = false;
    for (const p of t.points) {
      const n = v[p];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
        row[p] = roundHalfCm(toCm(n, unit));
        any = true;
      }
    }
    if (any) rows.push(row);
  }
  return { sizeChartType: 'garment', sizeChart: rows };
}

export interface ChartCheck {
  ok: boolean;
  /** Blocking: the chart cannot be written. */
  errors: string[];
  /** Shown to the merchant, not blocking. */
  warnings: string[];
}

/** Plausible ranges in cm (circumferences, except shoulder width and inseam length). */
const PLAUSIBLE: Record<ChartPoint, [number, number]> = {
  bust: [60, 200],
  waist: [45, 200],
  hip: [65, 210],
  shoulder: [28, 60],
  thigh: [35, 110],
  inseam: [40, 100],
};

/**
 * What the builder shows before a write: schema validity (1–30 rows, unique labels), at least one
 * measurement per row, plausible ranges (a number that looks like a flat half-width is called out),
 * and points that shrink from one size to the next.
 */
export function checkChart(input: { sizeChartType?: string; sizeChart?: readonly SizeRow[] }): ChartCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (input.sizeChartType !== 'body' && input.sizeChartType !== 'garment') errors.push("Choose whether the chart is body measurements or garment measurements.");
  const rows = input.sizeChart ?? [];
  if (!rows.length) errors.push('The chart has no sizes.');
  const dups = duplicateSizeLabels(rows);
  if (dups.length) errors.push(`Size labels appear twice: ${dups.join(', ')}.`);
  if (rows.length) {
    const parsed = SizeChartSchema.safeParse(rows);
    if (!parsed.success && !dups.length) errors.push(`The chart is not valid: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
  }
  for (const r of rows) {
    const measured = CHART_POINTS.filter((p) => typeof r[p] === 'number');
    if (!measured.length) errors.push(`Size ${r.size} has no measurements.`);
    for (const p of measured) {
      const v = r[p] as number;
      const [lo, hi] = PLAUSIBLE[p];
      if (v < lo && (p === 'bust' || p === 'waist' || p === 'hip') && v * 2 >= PLAUSIBLE[p][0]) {
        warnings.push(`Size ${r.size}: ${p} ${v} cm looks like a flat width. Enter the measurement all round (2 × ${v} = ${v * 2} cm).`);
      } else if (v < lo || v > hi) warnings.push(`Size ${r.size}: ${p} ${v} cm is outside the usual ${lo}–${hi} cm.`);
    }
  }
  for (const p of CHART_POINTS) {
    let prev: { size: string; v: number } | undefined;
    for (const r of rows) {
      const v = r[p];
      if (typeof v !== 'number') continue;
      if (prev && v < prev.v) warnings.push(`${p} gets smaller from size ${prev.size} (${prev.v}) to ${r.size} (${v}): sizes must be in ascending order.`);
      prev = { size: r.size, v };
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** The payload fields a chart writes (the `$app:curtain` `size_chart_type` + `size_chart` metafields). */
export function chartPayload(input: ChartInput): Pick<GarmentPayload, 'sizeChartType' | 'sizeChart'> {
  return { sizeChartType: input.sizeChartType, sizeChart: input.sizeChart.map((r) => ({ ...r })) };
}

/**
 * A chart as the builder sends it: a body template (+ the labels to keep), or rows the merchant
 * typed (any template, garment or body) with their unit. Resolve with `resolveChartSpec`.
 */
export const ChartUnitSchema = z.enum(['cm', 'in']);
export const ChartSpecSchema = z.union([
  z.object({ templateId: z.string().min(1).max(64), sizes: z.array(z.string().min(1).max(16)).min(1).max(30).optional() }).strict(),
  z
    .object({
      sizeChartType: z.enum(['body', 'garment']),
      sizeChart: z.array(SizeRowSchema).min(1).max(30),
      unit: ChartUnitSchema.optional(),
    })
    .strict(),
]);
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export class ChartSpecError extends Error {}

/** Spec → chart in cm. Throws `ChartSpecError` for an unknown template or a garment template without numbers. */
export function resolveChartSpec(spec: ChartSpec): ChartInput {
  if ('templateId' in spec) {
    const t = chartTemplateById(spec.templateId);
    if (!t) throw new ChartSpecError(`unknown chart template '${spec.templateId}'`);
    if (t.kind === 'garment') throw new ChartSpecError(`'${t.id}' is a garment template: send the measured rows (sizeChartType 'garment') instead`);
    return chartFromBodyTemplate(t, spec.sizes ?? t.defaultSizes);
  }
  return { sizeChartType: spec.sizeChartType, sizeChart: convertChart(spec.sizeChart, spec.unit ?? 'cm', 'cm') };
}

// ---------------------------------------------------------------------------
// Wire types of the chart builder (Shopify admin ↔ apps/api)
// ---------------------------------------------------------------------------

const ShopifyNumericId = (kind: string) =>
  z
    .string()
    .regex(new RegExp(`^(?:gid://shopify/${kind}/)?\\d{1,20}$`), `expected a ${kind} id or gid`);

/** Which products a chart goes to. `products` comes from the App Bridge resource picker. */
export const ProductSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('collection'), collectionId: ShopifyNumericId('Collection') }),
  z.object({ kind: z.literal('tag'), tag: z.string().trim().min(1).max(255) }),
  z.object({ kind: z.literal('productType'), productType: z.string().trim().min(1).max(255) }),
  z.object({ kind: z.literal('products'), productIds: z.array(ShopifyNumericId('Product')).min(1).max(250) }),
]);
export type ProductSelector = z.infer<typeof ProductSelectorSchema>;

export const ChartPreviewRequestSchema = z.object({ selector: ProductSelectorSchema });
export const ChartPreviewResponseSchema = z.object({
  count: z.number().int().min(0),
  /** `AT_LEAST` when Shopify capped the count. */
  precision: z.enum(['EXACT', 'AT_LEAST']),
  /** Up to 5 matching products, so the merchant sees what the selection means. */
  sample: z.array(z.object({ id: z.string(), title: z.string(), hasChart: z.boolean() })),
});

export const ChartAssignRequestSchema = z.object({
  selector: ProductSelectorSchema,
  chart: ChartSpecSchema,
  /** Replace a chart a product already has (default: skip those products). */
  overwrite: z.boolean().default(false),
  /** Continue a large selection: the `nextCursor` of the previous call. */
  cursor: z.string().min(1).max(512).nullable().optional(),
});
export type ChartAssignRequest = z.infer<typeof ChartAssignRequestSchema>;

export const ChartAssignResponseSchema = z.object({
  written: z.array(z.string()),
  skipped: z.array(z.object({ id: z.string(), title: z.string(), reason: z.string() })),
  failed: z.array(z.object({ id: z.string(), message: z.string() })),
  /** Product sync jobs queued for the written products (the shop stays the source of truth). */
  syncQueued: z.number().int().min(0),
  nextCursor: z.string().nullable(),
  chart: z.object({ sizeChartType: z.enum(['body', 'garment']), sizeChart: z.array(SizeRowSchema) }),
  warnings: z.array(z.string()),
});
export type ChartAssignResponse = z.infer<typeof ChartAssignResponseSchema>;

const TemplateSourceSchema = z.object({
  id: z.string(),
  publisher: z.string(),
  url: z.string(),
  accessed: z.string(),
  form: z.enum(['single', 'range', 'inches']),
  inMedian: z.boolean(),
  note: z.string().optional(),
});

export const ChartTemplateDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['body', 'garment']),
  label: z.string(),
  description: z.string(),
  sizes: z.array(z.string()),
  defaultSizes: z.array(z.string()),
  region: z.enum(['AU', 'UK', 'EU', 'US']).optional(),
  rows: z.array(SizeRowSchema).optional(),
  sources: z.array(TemplateSourceSchema).optional(),
  weakSizes: z.array(z.string()).optional(),
  points: z.array(z.enum(CHART_POINTS)).optional(),
});
export const ChartTemplatesResponseSchema = z.object({ templates: z.array(ChartTemplateDtoSchema) });

/** Templates as plain JSON for the wire (the frozen constants copied). */
export function chartTemplatesDto(): z.infer<typeof ChartTemplatesResponseSchema> {
  return { templates: CHART_TEMPLATES.map((t) => JSON.parse(JSON.stringify(t)) as z.infer<typeof ChartTemplateDtoSchema>) };
}

export const ProductChartImportResponseSchema = z.object({
  productId: z.string(),
  title: z.string(),
  /** The product is sold in one size only: the description's flat measurements make its garment chart. */
  oneSize: z.boolean(),
  sizeLabel: z.string().nullable(),
  proposal: z.object({ sizeChartType: z.enum(['body', 'garment']), sizeChart: z.array(SizeRowSchema) }).nullable(),
  lengthCm: LengthCmSchema.optional(),
  fabric: FabricSchema.optional(),
  /** The sentence the fabric was read from. */
  fabricStatement: z.string().optional(),
  evidence: z.array(z.string()),
  warnings: z.array(z.string()),
  /** The product already has a chart (a confirm overwrites it). */
  hasChart: z.boolean(),
});

export const ProductChartWriteRequestSchema = z.object({
  sizeChartType: z.enum(['body', 'garment']),
  sizeChart: z.array(SizeRowSchema).min(1).max(30),
  unit: ChartUnitSchema.optional(),
  fabric: FabricSchema.optional(),
  lengthCm: LengthCmSchema.optional(),
});
export const ProductChartWriteResponseSchema = z.object({ productId: z.string(), written: z.array(z.string()), syncQueued: z.boolean(), warnings: z.array(z.string()) });

export const ProductChecklistResponseSchema = z.object({
  productId: z.string(),
  title: z.string(),
  status: z.enum(['active', 'incomplete']),
  score: z.number().min(0).max(1),
  items: z.array(z.object({ key: z.string(), label: z.string(), done: z.boolean(), required: z.boolean(), hint: z.string() })),
  /** Storefront page with the "Try it on" button (the preview URL while the product is unpublished). */
  previewUrl: z.string().nullable(),
  adminUrl: z.string(),
});

export const ONBOARDING_STEPS = ['connect', 'template', 'assign', 'themeBlock', 'test'] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];
export const OnboardingUpdateRequestSchema = z.object({
  templateId: z.string().min(1).max(64).optional(),
  themeBlockConfirmed: z.boolean().optional(),
  tested: z.boolean().optional(),
});
export const OnboardingResponseSchema = z.object({
  steps: z.array(z.object({ key: z.enum(ONBOARDING_STEPS), label: z.string(), done: z.boolean(), detail: z.string() })),
  next: z.enum(ONBOARDING_STEPS).nullable(),
  state: z.object({ templateId: z.string().nullable(), themeBlockConfirmed: z.boolean(), tested: z.boolean() }),
});
