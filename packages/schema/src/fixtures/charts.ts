/**
 * AU_WOMENS_BODY_CHART — the standard Australian women's body chart (sizes 6–20), for shops that
 * sell in AU sizes without publishing their own chart. Body measurements in cm (bust, waist, hip),
 * so `sizeChartType: 'body'`.
 *
 * AS 1344 (Standards Australia, size coding scheme for women's clothing) is the lineage, but the
 * 1997 edition was withdrawn on 30 June 2017 without a replacement and its tables are not public.
 * The chart is therefore the per-cell median of three Australian retailer body charts, each opened
 * and read on 2026-11-06; two more charts are kept for comparison only. Full write-up, spreads and
 * links: docs/research/au-size-chart.md.
 */
import type { SizeRow } from '../garment';

export const AU_WOMENS_SIZES = ['6', '8', '10', '12', '14', '16', '18', '20'] as const;
export type AuWomensSize = (typeof AU_WOMENS_SIZES)[number];

export type AuChartPoint = 'bust' | 'waist' | 'hip';
export const AU_CHART_POINTS: readonly AuChartPoint[] = ['bust', 'waist', 'hip'];

export interface AuChartSourceRow {
  size: AuWomensSize;
  bust: number;
  waist: number;
  hip: number;
}

export interface AuChartSource {
  id: string;
  publisher: string;
  url: string;
  /** Date the page was opened and read. */
  accessed: string;
  kind: 'retailer' | 'shop' | 'aggregator';
  /** True when the source feeds the median; false = comparison only. */
  inMedian: boolean;
  note: string;
  rows: readonly AuChartSourceRow[];
}

/** The charts as published; a published range (e.g. 85–90) is stored as its midpoint. */
export const AU_WOMENS_CHART_SOURCES: readonly AuChartSource[] = [
  {
    id: 'country-road',
    publisher: 'Country Road (AU)',
    url: 'https://www.countryroad.com.au/size-guide',
    accessed: '2026-11-06',
    kind: 'retailer',
    inMedian: true,
    note: 'Womens apparel body chart, single values. Size 4 (77.5/61/86.5) not used.',
    rows: [
      { size: '6', bust: 80, waist: 63.5, hip: 89 },
      { size: '8', bust: 85, waist: 68.5, hip: 94 },
      { size: '10', bust: 90, waist: 73.5, hip: 99 },
      { size: '12', bust: 95, waist: 79.5, hip: 104 },
      { size: '14', bust: 100, waist: 85.5, hip: 109 },
      { size: '16', bust: 105, waist: 91.5, hip: 114 },
    ],
  },
  {
    id: 'seed-heritage',
    publisher: 'Seed Heritage (AU)',
    url: 'https://www.seedheritage.com/size-chart-woman-clothing.html',
    accessed: '2026-11-06',
    kind: 'retailer',
    inMedian: true,
    note: 'Woman clothing chart in 5 cm ranges (e.g. size 8: bust 85-90, waist 65-70, hip 92-97); midpoints stored.',
    rows: [
      { size: '6', bust: 82.5, waist: 62.5, hip: 89.5 },
      { size: '8', bust: 87.5, waist: 67.5, hip: 94.5 },
      { size: '10', bust: 92.5, waist: 72.5, hip: 99.5 },
      { size: '12', bust: 97.5, waist: 77.5, hip: 104.5 },
      { size: '14', bust: 102.5, waist: 82.5, hip: 109.5 },
      { size: '16', bust: 107.5, waist: 87.5, hip: 114.5 },
      { size: '18', bust: 112.5, waist: 92.5, hip: 119.5 },
    ],
  },
  {
    id: 'blue-illusion',
    publisher: 'Blue Illusion (AU/NZ)',
    url: 'https://blueillusion.com/pages/size-guide',
    accessed: '2026-11-06',
    kind: 'retailer',
    inMedian: true,
    note: "Women's clothing body measurements, single values, sizes 6-20. The only opened source for size 20.",
    rows: [
      { size: '6', bust: 81, waist: 60, hip: 88 },
      { size: '8', bust: 85, waist: 64, hip: 92 },
      { size: '10', bust: 90, waist: 69, hip: 97 },
      { size: '12', bust: 95, waist: 74, hip: 102 },
      { size: '14', bust: 100, waist: 79, hip: 107 },
      { size: '16', bust: 105, waist: 84, hip: 112 },
      { size: '18', bust: 110, waist: 89, hip: 117 },
      { size: '20', bust: 115, waist: 94, hip: 122 },
    ],
  },
  {
    id: 'bohohippychic',
    publisher: 'Boho Hippy Chic (the validation shop)',
    url: 'https://bohohippychic.com.au/products/black-haven-midi-dress',
    accessed: '2026-11-06',
    kind: 'shop',
    inMedian: false,
    note: 'Printed in several product descriptions as "Australian/New Zealand sizing standards". Comparison only, so the standard stays independent of the shop it is tested on.',
    rows: [
      { size: '8', bust: 84, waist: 68, hip: 93 },
      { size: '10', bust: 89, waist: 73, hip: 98 },
      { size: '12', bust: 94, waist: 78, hip: 103 },
      { size: '14', bust: 99, waist: 83, hip: 108 },
      { size: '16', bust: 104, waist: 88, hip: 113 },
      { size: '18', bust: 109, waist: 93, hip: 118 },
    ],
  },
  {
    id: 'sizechart-com',
    publisher: 'SizeChart.com (aggregator)',
    url: 'https://sizechart.com/clothing/women/aus',
    accessed: '2026-11-06',
    kind: 'aggregator',
    inMedian: false,
    note: 'Aggregated AUS chart in ranges; midpoints stored. Consistently smaller than the retailers from size 10 up. Comparison only.',
    rows: [
      { size: '6', bust: 79.5, waist: 64, hip: 86.5 },
      { size: '8', bust: 83.5, waist: 68, hip: 90.5 },
      { size: '10', bust: 87, waist: 71, hip: 94 },
      { size: '12', bust: 90.5, waist: 74, hip: 98 },
      { size: '14', bust: 94, waist: 78.5, hip: 102 },
      { size: '16', bust: 99, waist: 84.5, hip: 106 },
      { size: '18', bust: 104.5, waist: 91, hip: 111 },
      { size: '20', bust: 107.5, waist: 95, hip: 116 },
    ],
  },
];

const roundHalf = (v: number) => Math.round(v * 2) / 2;

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Values every source gives for one size and point. */
export function auChartSourceValues(size: AuWomensSize, point: AuChartPoint, opts: { inMedianOnly?: boolean } = {}): number[] {
  const out: number[] = [];
  for (const src of AU_WOMENS_CHART_SOURCES) {
    if (opts.inMedianOnly && !src.inMedian) continue;
    const row = src.rows.find((r) => r.size === size);
    if (row) out.push(row[point]);
  }
  return out;
}

export interface AuChartCellSpread {
  size: AuWomensSize;
  point: AuChartPoint;
  /** Number of median sources that give this cell. */
  n: number;
  min: number;
  max: number;
  /** min/max over every source, comparison sources included. */
  allMin: number;
  allMax: number;
}

/** Per size and point: the spread between the sources (see docs/research/au-size-chart.md). */
export const AU_WOMENS_BODY_CHART_SPREAD: readonly AuChartCellSpread[] = AU_WOMENS_SIZES.flatMap((size) =>
  AU_CHART_POINTS.map((point) => {
    const used = auChartSourceValues(size, point, { inMedianOnly: true });
    const all = auChartSourceValues(size, point);
    return { size, point, n: used.length, min: Math.min(...used), max: Math.max(...used), allMin: Math.min(...all), allMax: Math.max(...all) };
  }),
);

/**
 * The AU women's body chart: per size and point, the median of the median sources, rounded to
 * 0.5 cm. Sizes 8–16 rest on three retailers, 6 on three, 18 on two (mean), 20 on one.
 */
export const AU_WOMENS_BODY_CHART: readonly SizeRow[] = Object.freeze(
  AU_WOMENS_SIZES.map((size) => {
    const row: SizeRow = { size };
    for (const point of AU_CHART_POINTS) row[point] = roundHalf(median(auChartSourceValues(size, point, { inMedianOnly: true })));
    return Object.freeze(row);
  }),
);

/** The chart restricted to the given AU size labels, in chart order. Unknown labels are ignored. */
export function auWomensBodyChart(sizes: readonly string[]): SizeRow[] {
  const want = new Set(sizes.map((s) => s.trim()));
  return AU_WOMENS_BODY_CHART.filter((r) => want.has(r.size)).map((r) => ({ ...r }));
}
