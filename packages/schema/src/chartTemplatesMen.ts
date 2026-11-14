/**
 * Men's body chart templates (photo-avatar plan, slice 3 "Men v1"): letter sizes XS–3XL, German /
 * Dutch numeric sizes 44–58, and jeans in waist/length inches (W/L).
 *
 * These are GENERIC templates. They are not any brand's chart and must not be shown as one. Each
 * cell is the median of published retailer or brand body charts (the mean when there are two),
 * rounded to 0.5 cm; a published range is stored as its midpoint. The sources and their numbers as
 * printed are below, each opened and read on 2026-11-13. A merchant with a chart of his own should
 * enter that chart instead; the template is for a shop that prints none.
 *
 * Stored keys: the chest goes in `bust` (the fit point keeps its name for every audience; the web
 * layer prints "Chest", see `audience.ts`) and the seat goes in `hip`.
 *
 * Source terms (read 2026-11-14, recorded per source in `terms`): NO source grants a licence for
 * commercial use of its chart. Nike and Arc'teryx license their site content for personal,
 * non-commercial use only; Rab forbids commercial use without authorisation; OTTO reserves
 * commercial text and data mining; the pages read at Swix, Lidl, BAUR and Outdoor Renner say
 * nothing on reuse; BCF's terms could not be read. The project rule "only sources that allow
 * commercial use" is therefore NOT met by these templates. Whether a table of body measurements
 * is a fact that may be reused anyway, and whether the source rows may be stored here verbatim
 * (database right), is a question for counsel (Naomi), together with the women's templates
 * (docs/research/size-chart-templates.md). Until she has answered, the three templates carry
 * `legalReview: 'pending'` and are not offered in any picker (`OFFERED_CHART_TEMPLATES`,
 * `chartTemplatesDto`, the WooCommerce asset). No public standard was used: EN 13402-3 and the
 * German size tables are sold, not published, and were not read.
 *
 * Known limits, also pinned in chartTemplatesMen.test.ts:
 *  - Letter sizes: the four sources are sports and outdoor brands and disagree widely from XL up
 *    (chest 121–142 cm at 3XL). XXL and 3XL are in `weakSizes`: a size is weak when it rests on
 *    fewer than three sources or when its sources differ by more than `MENS_WEAK_SPREAD_CM` on a
 *    girth. The 3XL row is no single source's body (Arc'teryx: chest 138, waist 128; Macpac:
 *    chest 121, waist 106).
 *  - 44–58: the chest and waist of OTTO, BAUR and the eBay guide are one and the same German table,
 *    so it counts once; with Lidl that makes two sources per cell, so every size is in `weakSizes`.
 *    The seat rests on BAUR and Lidl; BAUR prints the seat of size 52 identical to size 50
 *    (102–105, a misprint). BAUR's column steps 4 cm per size (50: 102–105, 54: 110–113), so 52
 *    is read as 106–109: an interpolation of ours, not a printed value. Without it the seat
 *    would step 2.5 cm and then 4.5 cm around size 52.
 *  - W/L: the two columns are in effect the inch label converted to cm. Outdoor Renner's waists
 *    equal OTTO's range midpoints within 0.5 cm, so the "two sources" are not independent, and
 *    W28, W29 and W33 rest on OTTO alone. OTTO's page pairs widths with lengths; reading its
 *    Schrittlänge as one value per length is our interpretation. Waist and inside leg only. No source prints a seat or thigh per W size, so a jeans chart
 *    from this template lets the fit engine check the waist and the inseam and nothing else.
 */
import type { GarmentAudience, SizeRow } from './garment';
import type { BodyChartTemplate, ChartPoint, ChartSourceReuse, ChartSourceRef, ChartSourceTerms } from './chartTemplates';

/** Date every source below was opened and read. */
export const MENS_CHART_SOURCES_ACCESSED = '2026-11-13';
/** Date the publishers' terms were read. */
export const MENS_CHART_TERMS_READ = '2026-11-14';
/** Sources that differ by more than this on any girth make a size weak (shown as an estimate). */
export const MENS_WEAK_SPREAD_CM = 10;

const terms = (url: string, reuse: ChartSourceReuse, says: string): ChartSourceTerms => ({ url, read: MENS_CHART_TERMS_READ, reuse, says });

const TERMS = {
  nike: terms(
    'https://agreementservice.svs.nike.com/rest/agreement?agreementType=termsOfUse&country=AU&language=en&uxId=com.nike.unite&requestType=redirect',
    'personal-only',
    'NIKE Terms of Use: content “is owned by NIKE or our licensors and is protected by copyright, trademark, patent and other laws”; the licence to use the services is “for your own personal, noncommercial use”; data mining, robots and scraping are prohibited.',
  ),
  arcteryx: terms(
    'https://arcteryx.com/no/en/help/terms-of-use',
    'personal-only',
    'Terms of Use: “All Content on the Website is owned by Arc’teryx”; content may be viewed, printed and downloaded “for personal and non-commercial use only”; all other uses are “strictly prohibited, unless authorized in writing by Arc’teryx”.',
  ),
  swix: terms(
    'https://swixsport.com/us/info/terms-and-conditions',
    'silent',
    'Terms and Conditions (terms of sale of Brav, owner of the Swix brand): nothing on ownership or reuse of website content.',
  ),
  bcf: terms(
    'https://www.bcf.com.au/customer-service/terms.html',
    'not-read',
    'Terms and Conditions | BCF Australia: the page was found but its terms text could not be read (the page is too long for the reader used). Footer of the chart page: “© 2026 BCF Australia”. The chart is Macpac’s; Macpac’s own terms were not read.',
  ),
  otto: terms(
    'https://www.otto.de/shoppages/service/impressum',
    'tdm-reserved',
    'Impressum: “© 1995 bis 2026 OTTO”; “Nutzungsvorbehalt i.S.d. § 44b Abs. 3 UrhG (Text und Data Mining)”: use of the site’s content for commercial text and data mining, AI training included, “ist nicht gestattet”. Nothing else on reuse.',
  ),
  lidl: terms(
    'https://www.lidl.de/c/impressum/s10005238',
    'silent',
    'Impressum and “Gesetzliche Zusatzinformationen” (s10005186): nothing on copyright or reuse of website content. The AGB Onlineshop were not read.',
  ),
  baur: terms(
    'https://www.baur.de/service-hilfe/ueber-uns/impressum',
    'silent',
    'Impressum and AGB (/service-hilfe/ueber-uns/agb): nothing on copyright or reuse of website content. Footer: “© BAUR Versand, 96222 Burgkunstadt”.',
  ),
  ebay: terms(
    'https://www.ebay.de/help/policies/member-behaviour-policies/user-agreement?id=4259',
    'silent',
    'eBay AGB: in the part read (the first 100 000 of about 135 000 characters) nothing on rights in eBay’s own content; the rest was not read.',
  ),
  rab: terms(
    'https://rab.equipment/uk/terms-of-use',
    'commercial-prohibited',
    'Terms of Use 3.3: “You must not make commercial use of or publish any content displayed on our website without our prior authorisation.” 3.4: own content “may be copied for personal use only”.',
  ),
  outdoorRenner: terms(
    'https://www.outdoor-renner.de/impressum/',
    'silent',
    'Impressum and AGB (/agb/): nothing on copyright or reuse of website content. The table is Maier Sports’s; Maier Sports’ own terms were not read.',
  ),
} as const;

type Cells = Partial<Record<ChartPoint, number>>;

/** One source chart as published, in cm (ranges → midpoint, inches × 2.54). */
export interface MensChartSourceData extends ChartSourceRef {
  rows: ReadonlyArray<{ size: string } & Cells>;
}

const mid = (a: number, b: number) => (a + b) / 2;
const half = (v: number) => Math.round(v * 2) / 2;

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Per size and point: the median of the sources that carry the cell and count for that point
 * (`inMedian`, and `points` when a source counts for some points only). `counts[size]` is the
 * smallest number of sources behind any of the size's cells.
 */
export function mensChartFromSources(
  sizes: readonly string[],
  points: readonly ChartPoint[],
  sources: readonly MensChartSourceData[],
): { rows: SizeRow[]; counts: Record<string, number>; spread: Record<string, Partial<Record<ChartPoint, number>>> } {
  const rows: SizeRow[] = [];
  const counts: Record<string, number> = {};
  const spread: Record<string, Partial<Record<ChartPoint, number>>> = {};
  for (const size of sizes) {
    const row: SizeRow = { size };
    let least = Infinity;
    spread[size] = {};
    for (const p of points) {
      const values = sources
        .filter((s) => s.inMedian && (s.points === undefined || s.points.includes(p)))
        .map((s) => s.rows.find((r) => r.size === size)?.[p])
        .filter((v): v is number => typeof v === 'number');
      least = Math.min(least, values.length);
      if (!values.length) continue;
      row[p] = half(median(values));
      spread[size]![p] = Math.max(...values) - Math.min(...values);
    }
    counts[size] = Number.isFinite(least) ? least : 0;
    if (Object.keys(row).length > 1) rows.push(row);
  }
  return { rows, counts, spread };
}

// ---------------------------------------------------------------------------
// Letter sizes XS–3XL: chest, waist, seat
// ---------------------------------------------------------------------------

export const MENS_LETTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] as const;

export const MENS_LETTER_CHART_SOURCES: readonly MensChartSourceData[] = [
  {
    id: 'nike',
    terms: TERMS.nike,
    publisher: 'Nike',
    url: 'https://www.nike.com/au/size-fit/mens-tops-alpha',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Men’s tops, body measurements, ranges (midpoint used), read with the page’s centimetre toggle on. The page’s static HTML carries the inch table only (XS 31.5–35 in chest); a fetch on 2026-11-14 returned that table, which converts to within about 1 cm of the stored values (S 88.9–95.3 against 88–96). The cm view was not re-opened in a browser on that date. XXS and 4XL not used.',
    rows: [
      { size: 'XS', bust: mid(80, 88), waist: mid(65, 73), hip: mid(80, 88) },
      { size: 'S', bust: mid(88, 96), waist: mid(73, 81), hip: mid(88, 96) },
      { size: 'M', bust: mid(96, 104), waist: mid(81, 89), hip: mid(96, 104) },
      { size: 'L', bust: mid(104, 112), waist: mid(89, 97), hip: mid(104, 112) },
      { size: 'XL', bust: mid(112, 124), waist: mid(97, 109), hip: mid(112, 120) },
      { size: 'XXL', bust: mid(124, 136), waist: mid(109, 121), hip: mid(120, 128) },
      { size: '3XL', bust: mid(136, 148), waist: mid(121, 133), hip: mid(128, 136) },
    ],
  },
  {
    id: 'arcteryx',
    terms: TERMS.arcteryx,
    publisher: 'Arc’teryx',
    url: 'https://arcteryx.com/no/en/help/sizing/mens/tops',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'single',
    inMedian: true,
    note: 'Men’s tops, body measurements in cm, single values. XXS not used; the page labels 3XL “XXXL”.',
    rows: [
      { size: 'XS', bust: 92, waist: 76, hip: 90 },
      { size: 'S', bust: 97, waist: 81, hip: 95 },
      { size: 'M', bust: 102, waist: 86, hip: 100 },
      { size: 'L', bust: 110, waist: 94, hip: 108 },
      { size: 'XL', bust: 118, waist: 102, hip: 116 },
      { size: 'XXL', bust: 128, waist: 112, hip: 126 },
      { size: '3XL', bust: 138, waist: 128, hip: 142 },
    ],
  },
  {
    id: 'swix',
    terms: TERMS.swix,
    publisher: 'Swix',
    url: 'https://swixsport.com/us/article/find-your-size/mens-clothing',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'single',
    inMedian: true,
    note: 'Men’s clothing, body measurements in cm, single values, S–3XL (no XS).',
    rows: [
      { size: 'S', bust: 94, waist: 80, hip: 94 },
      { size: 'M', bust: 100, waist: 86, hip: 100 },
      { size: 'L', bust: 106, waist: 92, hip: 106 },
      { size: 'XL', bust: 112, waist: 98, hip: 112 },
      { size: 'XXL', bust: 118, waist: 104, hip: 118 },
      { size: '3XL', bust: 124, waist: 110, hip: 124 },
    ],
  },
  {
    id: 'macpac',
    terms: TERMS.bcf,
    publisher: 'Macpac (chart on the BCF retailer site)',
    url: 'https://www.bcf.com.au/size-charts/sizechart-macpac-mens.html',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Men’s, body measurements in cm, ranges (midpoint used). The page labels XXL “2XL”.',
    rows: [
      { size: 'XS', bust: mid(88, 92), waist: mid(74, 78), hip: mid(88, 92) },
      { size: 'S', bust: mid(93, 98), waist: mid(79, 83), hip: mid(93, 98) },
      { size: 'M', bust: mid(99, 103), waist: mid(84, 88), hip: mid(99, 103) },
      { size: 'L', bust: mid(104, 108), waist: mid(89, 93), hip: mid(104, 108) },
      { size: 'XL', bust: mid(109, 113), waist: mid(94, 98), hip: mid(109, 113) },
      { size: 'XXL', bust: mid(114, 118), waist: mid(99, 103), hip: mid(114, 118) },
      { size: '3XL', bust: mid(119, 123), waist: mid(104, 108), hip: mid(119, 123) },
    ],
  },
  {
    id: 'rab',
    terms: TERMS.rab,
    publisher: 'Rab',
    url: 'https://rab.equipment/uk/help/sizing-guide-mens',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'single',
    inMedian: false,
    note: 'Comparison only: chest and waist, no seat. A slimmer waist per size than the four above.',
    rows: [
      { size: 'XS', bust: 90, waist: 71 },
      { size: 'S', bust: 94, waist: 76 },
      { size: 'M', bust: 102, waist: 81 },
      { size: 'L', bust: 109, waist: 86 },
      { size: 'XL', bust: 117, waist: 91 },
      { size: 'XXL', bust: 122, waist: 96 },
      { size: '3XL', bust: 129.5, waist: 104 },
    ],
  },
];

// ---------------------------------------------------------------------------
// German / Dutch numeric sizes 44–58: chest, waist, seat
// ---------------------------------------------------------------------------

export const MENS_EU_SIZES = ['44', '46', '48', '50', '52', '54', '56', '58'] as const;

export const MENS_EU_CHART_SOURCES: readonly MensChartSourceData[] = [
  {
    id: 'otto',
    terms: TERMS.otto,
    publisher: 'OTTO (DE)',
    url: 'https://www.otto.de/shoppages/groessentabellen_herren',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Herren, “Anzüge”, Normale Größen: Brustumfang and Bundumfang, ranges (midpoint used). No seat on the page. Sizes 40, 42 and 60+ not used.',
    rows: [
      { size: '44', bust: mid(86, 89), waist: mid(74, 77) },
      { size: '46', bust: mid(90, 93), waist: mid(78, 81) },
      { size: '48', bust: mid(94, 97), waist: mid(82, 85) },
      { size: '50', bust: mid(98, 101), waist: mid(86, 89) },
      { size: '52', bust: mid(102, 105), waist: mid(90, 94) },
      { size: '54', bust: mid(106, 109), waist: mid(95, 99) },
      { size: '56', bust: mid(110, 113), waist: mid(100, 104) },
      { size: '58', bust: mid(114, 117), waist: mid(105, 109) },
    ],
  },
  {
    id: 'lidl',
    terms: TERMS.lidl,
    publisher: 'Lidl (DE)',
    url: 'https://www.lidl.de/c/groessentabelle-herren/s10048945',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Herren, Konfektionsgröße 44–70. Chest and waist from “Oberteile”, waist (identical) and seat from “Unterteile”; ranges (midpoint used).',
    rows: [
      { size: '44', bust: mid(86, 90), waist: mid(71, 75), hip: mid(92, 95) },
      { size: '46', bust: mid(90, 94), waist: mid(75, 80), hip: mid(95, 98) },
      { size: '48', bust: mid(94, 98), waist: mid(80, 85), hip: mid(98, 101) },
      { size: '50', bust: mid(98, 102), waist: mid(85, 90), hip: mid(101, 104) },
      { size: '52', bust: mid(102, 106), waist: mid(90, 95), hip: mid(104, 107) },
      { size: '54', bust: mid(106, 110), waist: mid(95, 100), hip: mid(107, 110) },
      { size: '56', bust: mid(110, 114), waist: mid(100, 105), hip: mid(110, 113) },
      { size: '58', bust: mid(114, 119), waist: mid(105, 110), hip: mid(113, 116) },
    ],
  },
  {
    id: 'baur',
    terms: TERMS.baur,
    publisher: 'BAUR (DE), magazine',
    url: 'https://www.baur.de/magazin/anzug-groessentabelle',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    points: ['hip'],
    note: 'Normalgröße 44–62 with Hüftumfang, ranges (midpoint used). Counts for the seat only: its chest and waist are the OTTO table again. Size 52 prints the seat of size 50 (102–105, a misprint); it is read as 106–109, interpolated by us from the 4 cm step of the column (50: 102–105, 54: 110–113).',
    rows: [
      { size: '44', bust: mid(86, 89), waist: mid(74, 77), hip: mid(90, 93) },
      { size: '46', bust: mid(90, 93), waist: mid(78, 81), hip: mid(94, 97) },
      { size: '48', bust: mid(94, 97), waist: mid(82, 85), hip: mid(98, 101) },
      { size: '50', bust: mid(98, 101), waist: mid(86, 89), hip: mid(102, 105) },
      { size: '52', bust: mid(102, 105), waist: mid(90, 94), hip: mid(106, 109) },
      { size: '54', bust: mid(106, 109), waist: mid(95, 99), hip: mid(110, 113) },
      { size: '56', bust: mid(110, 113), waist: mid(100, 104), hip: mid(114, 117) },
      { size: '58', bust: mid(114, 117), waist: mid(105, 109), hip: mid(118, 121) },
    ],
  },
  {
    id: 'ebay-de',
    terms: TERMS.ebay,
    publisher: 'eBay.de size guide',
    url: 'https://pages.ebay.de/themes/Groessentabelle_Herren/index.html',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: false,
    note: 'Comparison only (a marketplace guide): Normale Größen, chest and waist identical to OTTO.',
    rows: [
      { size: '44', bust: mid(86, 89), waist: mid(74, 77) },
      { size: '50', bust: mid(98, 101), waist: mid(86, 89) },
      { size: '58', bust: mid(114, 117), waist: mid(105, 109) },
    ],
  },
];

// ---------------------------------------------------------------------------
// Jeans W/L: waist and inside leg
// ---------------------------------------------------------------------------

export const MENS_JEANS_WAISTS = ['28', '29', '30', '32', '33', '34', '36', '38', '40', '42', '44'] as const;
export const MENS_JEANS_LENGTHS = ['30', '32', '34'] as const;

/** Body waist per W size (rows labelled `W28`) and inside leg per L size (rows labelled `L32`). */
export const MENS_JEANS_CHART_SOURCES: readonly MensChartSourceData[] = [
  {
    id: 'otto-jeans',
    terms: TERMS.otto,
    publisher: 'OTTO (DE)',
    url: 'https://www.otto.de/shoppages/groessentabellen_herren',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'range',
    inMedian: true,
    note: 'Herren Jeans, Normale / Schlanke / Untersetzte Größen: Bundumfang per width (range, midpoint used) and Schrittlänge per length (76, 81, 86; 91 for length 36, not used). No width 31 on the page.',
    rows: [
      { size: 'W28', waist: mid(70, 72) },
      { size: 'W29', waist: mid(72.5, 74.5) },
      { size: 'W30', waist: mid(75, 77) },
      { size: 'W32', waist: mid(80, 82) },
      { size: 'W33', waist: mid(82.5, 84.5) },
      { size: 'W34', waist: mid(85, 87) },
      { size: 'W36', waist: mid(90, 92) },
      { size: 'W38', waist: mid(95.5, 97.5) },
      { size: 'W40', waist: mid(100.5, 102.5) },
      { size: 'W42', waist: mid(105.5, 107.5) },
      { size: 'W44', waist: mid(110.5, 112.5) },
      { size: 'L30', inseam: 76 },
      { size: 'L32', inseam: 81 },
      { size: 'L34', inseam: 86 },
    ],
  },
  {
    id: 'outdoor-renner',
    terms: TERMS.outdoorRenner,
    publisher: 'Outdoor Renner (DE), Maier Sports table',
    url: 'https://www.outdoor-renner.de/groessentabelle-herren/',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'single',
    inMedian: true,
    points: ['waist'],
    note: 'W (inch) → Bundweite in cm, single values, W30–W46 in steps of two.',
    rows: [
      { size: 'W30', waist: 76 },
      { size: 'W32', waist: 81 },
      { size: 'W34', waist: 86 },
      { size: 'W36', waist: 91 },
      { size: 'W38', waist: 97 },
      { size: 'W40', waist: 102 },
      { size: 'W42', waist: 107 },
      { size: 'W44', waist: 112 },
    ],
  },
  {
    id: 'rab-legs',
    terms: TERMS.rab,
    publisher: 'Rab',
    url: 'https://rab.equipment/uk/help/sizing-guide-mens',
    accessed: MENS_CHART_SOURCES_ACCESSED,
    form: 'single',
    inMedian: true,
    points: ['inseam'],
    note: 'Men’s legwear: inside leg Short 76 cm / 30 in, Regular 81 cm / 32 in, Long 86 cm / 34 in.',
    rows: [
      { size: 'L30', inseam: 76 },
      { size: 'L32', inseam: 81 },
      { size: 'L34', inseam: 86 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const MEN: GarmentAudience = 'men';
const PENDING = 'pending' as const;

/** Weak = fewer than three sources behind a cell, or sources more than `MENS_WEAK_SPREAD_CM` apart on a point. */
function weakSize(size: string, chart: ReturnType<typeof mensChartFromSources>): boolean {
  return (chart.counts[size] ?? 0) < 3 || Object.values(chart.spread[size] ?? {}).some((d) => d > MENS_WEAK_SPREAD_CM);
}
const GIRTHS: readonly ChartPoint[] = ['bust', 'waist', 'hip'];

function refs(sources: readonly MensChartSourceData[]): ChartSourceRef[] {
  return sources.map(({ rows: _rows, ...ref }) => ref);
}

function freezeRows(rows: readonly SizeRow[]): readonly SizeRow[] {
  return Object.freeze(rows.map((r) => Object.freeze({ ...r })));
}

const letter = mensChartFromSources(MENS_LETTER_SIZES, GIRTHS, MENS_LETTER_CHART_SOURCES);

export const MENS_LETTER_BODY_TEMPLATE: BodyChartTemplate = Object.freeze({
  id: 'mens-letter-body',
  kind: 'body' as const,
  region: 'INT' as const,
  audience: MEN,
  generic: true,
  points: GIRTHS,
  label: 'Men — letter sizes (XS–3XL), generic body chart',
  description: 'Generic template, not a brand’s chart: chest, waist and seat per letter size, median of Nike, Arc’teryx, Swix and Macpac. The brands differ by more than 10 cm at XXL and 3XL: those two are rough estimates.',
  sizes: [...MENS_LETTER_SIZES],
  defaultSizes: ['S', 'M', 'L', 'XL', 'XXL'],
  rows: freezeRows(letter.rows),
  sources: refs(MENS_LETTER_CHART_SOURCES),
  weakSizes: MENS_LETTER_SIZES.filter((s) => weakSize(s, letter)),
  legalReview: PENDING,
});

const eu = mensChartFromSources(MENS_EU_SIZES, GIRTHS, MENS_EU_CHART_SOURCES);

export const MENS_EU_BODY_TEMPLATE: BodyChartTemplate = Object.freeze({
  id: 'eu-mens-body',
  kind: 'body' as const,
  region: 'EU' as const,
  audience: MEN,
  generic: true,
  points: GIRTHS,
  label: 'Men — Europe (DE/NL numbering) 44–58, generic body chart',
  description: 'Generic template, not a brand’s chart: chest, waist and seat per German size, mean of OTTO and Lidl (seat: BAUR and Lidl; BAUR’s size 52 seat is a misprint and is interpolated). Regular sizes only, no short or long sizes.',
  sizes: [...MENS_EU_SIZES],
  defaultSizes: ['46', '48', '50', '52', '54', '56'],
  rows: freezeRows(eu.rows),
  sources: refs(MENS_EU_CHART_SOURCES),
  weakSizes: MENS_EU_SIZES.filter((s) => weakSize(s, eu)),
  legalReview: PENDING,
});

const jeansWaist = mensChartFromSources(MENS_JEANS_WAISTS.map((w) => `W${w}`), ['waist'], MENS_JEANS_CHART_SOURCES);
const jeansLength = mensChartFromSources(MENS_JEANS_LENGTHS.map((l) => `L${l}`), ['inseam'], MENS_JEANS_CHART_SOURCES);

/** `32/34`: waist 32 in, length 34 in. */
export function jeansSizeLabel(waist: string | number, length: string | number): string {
  return `${waist}/${length}`;
}

/** `'32/34'`, `'W32/L34'`, `'W32 L34'`, `'32x34'` → `{ waist: 32, length: 34 }`; anything else → `undefined`. */
export function parseJeansSize(label: string): { waist: number; length: number } | undefined {
  const m = /^\s*W?\s*(\d{2})\s*(?:\/|x|×|-|\s)\s*L?\s*(\d{2})\s*$/i.exec(label);
  if (!m) return undefined;
  const waist = Number(m[1]);
  const length = Number(m[2]);
  return waist >= 24 && waist <= 56 && length >= 26 && length <= 40 ? { waist, length } : undefined;
}

/**
 * Every waist × length the template offers, ascending by waist and then by length. The schema
 * allows 30 rows per chart: all eleven waists come in length 32, lengths 30 and 34 for waists
 * 28–38 (27 labels). Length 36 is left out (one source, and the row limit).
 */
const JEANS_SHORT_LONG_WAISTS = new Set(['28', '29', '30', '32', '33', '34', '36', '38']);

function jeansRows(): SizeRow[] {
  const rows: SizeRow[] = [];
  for (const w of MENS_JEANS_WAISTS) {
    const waist = jeansWaist.rows.find((r) => r.size === `W${w}`)?.waist;
    for (const l of MENS_JEANS_LENGTHS) {
      if (l !== '32' && !JEANS_SHORT_LONG_WAISTS.has(w)) continue;
      const inseam = jeansLength.rows.find((r) => r.size === `L${l}`)?.inseam;
      if (waist === undefined || inseam === undefined) continue;
      rows.push({ size: jeansSizeLabel(w, l), waist, inseam });
    }
  }
  return rows;
}

const jeans = jeansRows();
const jeansWeak = (label: string): boolean => {
  const s = parseJeansSize(label);
  return !s || (jeansWaist.counts[`W${s.waist}`] ?? 0) < 3 || (jeansLength.counts[`L${s.length}`] ?? 0) < 3;
};

export const MENS_JEANS_WL_BODY_TEMPLATE: BodyChartTemplate = Object.freeze({
  id: 'mens-jeans-wl-body',
  kind: 'body' as const,
  region: 'INT' as const,
  audience: MEN,
  generic: true,
  points: ['waist', 'inseam'] as const,
  label: 'Men — jeans W/L (waist 28–44, length 30–34), generic body chart',
  description: 'Generic template, not a brand’s chart: body waist per W size and inside leg per L size, in effect the inch label in cm (OTTO, Maier Sports, Rab; widths 28, 29 and 33 from OTTO alone). Waist and inside leg only: no seat, no thigh.',
  sizes: jeans.map((r) => r.size),
  defaultSizes: jeans.map((r) => r.size).filter((label) => {
    const s = parseJeansSize(label)!;
    return s.length === 32 || (s.waist % 2 === 0 && s.waist >= 30 && s.waist <= 36);
  }),
  rows: freezeRows(jeans),
  sources: refs(MENS_JEANS_CHART_SOURCES),
  weakSizes: jeans.map((r) => r.size).filter(jeansWeak),
  legalReview: PENDING,
});

export const MENS_BODY_CHART_TEMPLATES: readonly BodyChartTemplate[] = [MENS_LETTER_BODY_TEMPLATE, MENS_EU_BODY_TEMPLATE, MENS_JEANS_WL_BODY_TEMPLATE];

/** Largest disagreement between the sources per size and point, in cm (how rough a cell is). */
export const MENS_CHART_SOURCE_SPREAD: Readonly<Record<string, Readonly<Record<string, Partial<Record<ChartPoint, number>>>>>> = Object.freeze({
  [MENS_LETTER_BODY_TEMPLATE.id]: letter.spread,
  [MENS_EU_BODY_TEMPLATE.id]: eu.spread,
});
