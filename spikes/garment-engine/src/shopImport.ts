/**
 * Shop-agnostic import of a public Shopify catalogue into GarmentPayload v1 drafts (refinement P4:
 * validate the pipeline outside Bohohippychic). `shop.ts` is the first, AU-only importer (it reads
 * sizes, charts and fabric from Bohohippychic's description text); this module holds the parts that
 * differ per shop as data (`ShopAdapter`) and the parsers that a second shop needed:
 *
 * - the shop's OWN printed body chart (a size-guide page) per size system, numeric and letter sizes,
 *   instead of a fixed AU chart;
 * - the product page's "Fabric & care" composition, the size the model wears (the photographed size,
 *   stated by the shop) and a "wearing length", each checked before it is used;
 * - category mapping from `product_type` and structured tags (`product-type:wide leg trousers`);
 * - a second size option (Regular / Petite length) that a body chart cannot express.
 *
 * Pure functions; downloads and file I/O live in `shopImportCli.ts`. Everything read from a shop is
 * untrusted text: parsed, never executed, and every value taken from it carries its source text in
 * `evidence`. Nothing is invented: a value the shop does not give stays absent and a warning says so.
 */
import {
  CATEGORY_POINTS,
  GarmentPayloadDraftSchema,
  GarmentPayloadSchema,
  completenessScore,
  fabricFromText,
  resolveFabricText,
  resolvedFabricToPayload,
  type CompletenessResult,
  type GarmentCategory,
  type GarmentPayloadDraft,
  type LengthCm,
  type SizeRow,
} from '@curtain/schema';
import { garmentFeatures, type GarmentFeatures } from './features';
import { htmlToLines, type ShopifyProduct } from './shop';

// ---------------------------------------------------------------------------
// Adapter: what differs per shop
// ---------------------------------------------------------------------------

export type SizeSystem = 'AU' | 'UK' | 'EU' | 'US';

/** One row of a letter-size chart: the numeric sizes the shop says the letter covers. */
export interface LetterSizeRow extends SizeRow {
  covers: string[];
}

/** The shop's own body chart, as printed on its size guide (cm). */
export interface ShopBodyChart {
  system: SizeSystem;
  /** Numeric sizes ("4", "6", …), body measurements per size. */
  numeric: SizeRow[];
  /** Letter sizes (XS–XL) with the numeric sizes each covers, when the shop prints them. */
  letter: LetterSizeRow[];
  /** Body inside leg per trouser length ("regular" → 79), cm. */
  insideLeg: Record<string, number>;
  /** Where the chart was read, and when. */
  source: { url: string; accessed: string; note: string };
  /** Problems found in the printed chart itself. */
  defects: string[];
}

export interface CategoryMapping {
  category: GarmentCategory;
  /** Bottoms: 'skirt' or 'trousers' (the proxy kind reads "skirt" from the subcategory). */
  kind?: 'skirt' | 'trousers';
}

export interface ShopAdapter {
  id: string;
  domain: string;
  brand: string;
  currency: string;
  /** Who chose the shop and on what terms (printed in products.json). */
  status: string;
  chart: ShopBodyChart;
  /** Shopify product_type → category; types not listed are not apparel this importer handles. */
  productTypes: Readonly<Record<string, CategoryMapping>>;
}

// ---------------------------------------------------------------------------
// Size guide page → body chart
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The text of every `<p>` of a page, in order (page builders put one table cell per paragraph). */
export function paragraphCells(html: string): string[] {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  const out: string[] = [];
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = decode(m[1]!.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

const isNum = (s: string | undefined): boolean => s !== undefined && /^\d{1,3}(?:\.\d)?$/.test(s);

/**
 * A numeric size table printed as page-builder cells: "UK SIZE | 4 | 6 | EU | 32 | 34 | US | 0 | 2 |
 * BUST | 78 | 82 | WAIST | … | HIPS | …", then blocks of further sizes WITHOUT labels, each block
 * as UK…, EU…, US…, BUST…, WAIST…, HIPS… for the same k sizes. k is read from the UK sizes, which
 * continue the previous block in steps of 2.
 */
export function parseNumericSizeTable(cells: readonly string[], start: number): { rows: Array<SizeRow & { eu: string; us: string }>; end: number } | undefined {
  if (!/^UK SIZE$/i.test(cells[start] ?? '')) return undefined;
  const labels = ['EU', 'US', 'BUST', 'WAIST', 'HIPS'];
  let i = start + 1;
  const first: string[][] = [[]];
  for (const label of labels) {
    while (isNum(cells[i])) first[first.length - 1]!.push(cells[i++]!);
    if ((cells[i] ?? '').toUpperCase() !== label) return undefined;
    first.push([]);
    i++;
  }
  while (isNum(cells[i]) && first[5]!.length < first[0]!.length) first[5]!.push(cells[i++]!);
  const k0 = first[0]!.length;
  if (k0 === 0 || first.some((c) => c.length !== k0)) return undefined;
  const cols: string[][] = first.map((c) => [...c]);
  for (;;) {
    let k = 0;
    let last = Number(cols[0]![cols[0]!.length - 1]);
    while (isNum(cells[i + k]) && Number(cells[i + k]) === last + 2) {
      last += 2;
      k++;
    }
    if (k === 0) break;
    const block = cells.slice(i, i + 6 * k);
    if (block.length < 6 * k || !block.every(isNum)) break;
    for (let c = 0; c < 6; c++) cols[c]!.push(...block.slice(c * k, (c + 1) * k));
    i += 6 * k;
  }
  const rows = cols[0]!.map((size, r) => ({ size, eu: cols[1]![r]!, us: cols[2]![r]!, bust: Number(cols[3]![r]), waist: Number(cols[4]![r]), hip: Number(cols[5]![r]) }));
  return { rows, end: i };
}

/** A letter-size table: "SIZE | XS | S | … | UK SIZE | 4-6 | 8-10 | … | EU SIZE | … | US SIZE | … | BUST | … | WAIST | … | HIPS | …". */
export function parseLetterSizeTable(cells: readonly string[], start: number): { rows: Array<LetterSizeRow & { eu: string; us: string }>; end: number } | undefined {
  if (!/^SIZE$/i.test(cells[start] ?? '')) return undefined;
  let i = start + 1;
  const letters: string[] = [];
  while (/^(?:X{0,3}S|M|X{0,3}L)$/i.test(cells[i] ?? '')) letters.push(cells[i++]!);
  const k = letters.length;
  if (k === 0) return undefined;
  const take = (label: RegExp): string[] | undefined => {
    if (!label.test(cells[i] ?? '')) return undefined;
    const vals = cells.slice(i + 1, i + 1 + k);
    i += 1 + k;
    return vals.length === k ? vals : undefined;
  };
  const uk = take(/^UK SIZE$/i);
  const eu = take(/^EU SIZE$/i);
  const us = take(/^US SIZE$/i);
  const bust = take(/^BUST$/i);
  const waist = take(/^WAIST$/i);
  const hip = take(/^HIPS$/i);
  if (!uk || !eu || !us || !bust || !waist || !hip || ![...bust, ...waist, ...hip].every(isNum)) return undefined;
  const rows = letters.map((size, r) => {
    const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(uk[r]!);
    const covers = m ? numericRange(Number(m[1]), Number(m[2])) : [];
    return { size, covers, eu: eu[r]!, us: us[r]!, bust: Number(bust[r]), waist: Number(waist[r]), hip: Number(hip[r]) };
  });
  return { rows, end: i };
}

function numericRange(lo: number, hi: number): string[] {
  const out: string[] = [];
  for (let s = lo; s <= hi; s += 2) out.push(String(s));
  return out;
}

/** "SHORT | REGULAR | LONG | 74 | 79 | 84" (cm; the inches table has values under 50). */
export function parseInsideLeg(cells: readonly string[]): Record<string, number> {
  for (let i = 0; i + 3 < cells.length; i++) {
    if (!/^SHORT$/i.test(cells[i]!) || !/^REGULAR$/i.test(cells[i + 1]!) || !/^LONG$/i.test(cells[i + 2]!)) continue;
    // The values may follow a label cell ("BODY MEASUREMENT OF INSIDE LEG - CROTCH TO FLOOR").
    let j = i + 3;
    while (j < i + 5 && cells[j] !== undefined && !isNum(cells[j])) j++;
    const v = cells.slice(j, j + 3);
    if (v.every(isNum) && v.every((x) => Number(x) >= 50)) return { short: Number(v[0]), regular: Number(v[1]), long: Number(v[2]) };
  }
  return {};
}

/**
 * The body chart of a size guide page in cm. The page prints each table in inches and in cm; the cm
 * table is the one whose bust values are all at least 60. Problems in the printed chart (labels that
 * contradict each other, rows that do not grow) go to `defects`; nothing is corrected silently.
 */
export function parseSizeGuide(cells: readonly string[], source: ShopBodyChart['source']): ShopBodyChart {
  const defects: string[] = [];
  let numeric: Array<SizeRow & { eu: string; us: string }> = [];
  let letter: Array<LetterSizeRow & { eu: string; us: string }> = [];
  const letterTables: Array<Array<LetterSizeRow & { eu: string; us: string }>> = [];
  for (let i = 0; i < cells.length; i++) {
    const n = parseNumericSizeTable(cells, i);
    if (n && n.rows.every((r) => (r.bust ?? 0) >= 60) && !numeric.length) numeric = n.rows;
    const l = parseLetterSizeTable(cells, i);
    if (l) {
      letterTables.push(l.rows);
      if (l.rows.every((r) => (r.bust ?? 0) >= 60) && !letter.length) letter = l.rows;
    }
  }
  if (!numeric.length) defects.push('no numeric cm table found on the size guide');
  for (let r = 1; r < numeric.length; r++) {
    for (const k of ['bust', 'waist', 'hip'] as const) {
      const step = numeric[r]![k]! - numeric[r - 1]![k]!;
      if (step <= 0 || step > 10) defects.push(`numeric ${k} ${numeric[r - 1]!.size}→${numeric[r]!.size}: ${numeric[r - 1]![k]} → ${numeric[r]![k]} cm`);
    }
  }
  for (const r of letter) {
    const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(r.eu);
    if (!m || Number(m[1]) >= Number(m[2])) defects.push(`letter ${r.size}: EU range printed as "${r.eu}"`);
    // Which numeric row the letter row repeats (the shop's letter chart is a copy of one numeric row).
    const same = numeric.find((n) => n.bust === r.bust && n.waist === r.waist && n.hip === r.hip);
    if (same && r.covers.length && same.size !== r.covers[r.covers.length - 1]) defects.push(`letter ${r.size} (UK ${r.covers.join('-')}) repeats the body of UK ${same.size}, not the top of its range`);
    if (!same) defects.push(`letter ${r.size} matches no numeric row`);
  }
  // The inch and cm copies of the letter table must name the same US sizes.
  if (letterTables.length >= 2) {
    const [a, b] = letterTables;
    a!.forEach((r, j) => {
      const o = b![j];
      if (o && o.size === r.size && o.us !== r.us) defects.push(`letter ${r.size}: US size "${r.us}" in one table, "${o.us}" in the other`);
    });
  }
  return {
    system: 'UK',
    numeric: numeric.map(({ size, bust, waist, hip }) => ({ size, bust, waist, hip })),
    letter: letter.map(({ size, covers, bust, waist, hip }) => ({ size, covers, bust, waist, hip })),
    insideLeg: parseInsideLeg(cells),
    source,
    defects,
  };
}

// ---------------------------------------------------------------------------
// Product page: fabric composition, the model's size, the wearing length
// ---------------------------------------------------------------------------

export interface ProductPageFacts {
  /** "100% Cotton" from "Fabric Main: 100% Cotton". */
  fabricMain?: string;
  /** Other fabric parts ("Lining: 100% Cotton"). */
  fabricOther: string[];
  /** The size the model wears (the photographed size), as the shop prints it. */
  modelSize?: { system: SizeSystem; size: string };
  modelHeight?: string;
  wearingLengthCm?: number;
  evidence: Record<string, string>;
}

/**
 * Where a product page prints the facts of ITS OWN product. A Shopify theme page also carries other
 * products (shop-the-look and cross-sell drawers, each with its own model size and wearing length):
 * on nobodyschild.com the matching top's "Wearing length is: 53cm" sits on the skirt's page. So the
 * facts are read only inside these blocks, never from the whole page.
 */
export interface ProductPageMarkers {
  /** Class of the element holding "Model's height is … she wears a UK size 8. Wearing length is: …". */
  modelSize: string;
  /** Class of the element holding "Fabric Main: …". */
  fabric: string;
}

export const DEFAULT_PAGE_MARKERS: ProductPageMarkers = { modelSize: 'product-page__details--model-size', fabric: 'accordion-fabric-and-care' };

/** The text of the element that carries `cls`: from its opening tag to its own closing tag (nesting of the same tag name counted), at most `maxChars` of HTML. */
function blockText(html: string, cls: string, maxChars: number): string | undefined {
  const re = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*class="[^"]*\\b${cls.replace(/[-]/g, '\\-')}\\b[^"]*"[^>]*>`, 'i');
  const m = re.exec(html);
  if (!m) return undefined;
  const tag = m[1]!.toLowerCase();
  const start = m.index + m[0].length;
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  tags.lastIndex = start;
  let depth = 1;
  let end = Math.min(html.length, start + maxChars);
  for (let t = tags.exec(html); t && t.index < start + maxChars; t = tags.exec(html)) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) {
      end = t.index;
      break;
    }
  }
  return htmlToLines(html.slice(start, end)).join(' ');
}

/** The facts a product page prints outside products.json, read inside the product's own blocks. Text only; the page is never rendered. */
export function parseProductPage(html: string, markers: ProductPageMarkers = DEFAULT_PAGE_MARKERS): ProductPageFacts {
  const clean = html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, ' ');
  const out: ProductPageFacts = { fabricOther: [], evidence: {} };
  const fabricBlock = blockText(clean, markers.fabric, 3000);
  const fabric = fabricBlock ? /\bFabric\s+(Main:\s*.*?)(?=\s+Excludes\b|\s+Washcare\b|\s+Item\b|$)/.exec(fabricBlock) : null;
  if (fabric) {
    const parts = fabric[1]!.split(/\s*\|\s*|\s+(?=(?:Main|Lining|Trim|Contrast|Binding|Pocket(?:ing)?|Body|Sleeves?):)/);
    for (const part of parts) {
      const m = /^(\w+):\s*(.*)$/.exec(part.trim());
      if (!m) continue;
      const value = m[2]!.replace(/[|\s]+$/, '').trim();
      if (m[1] === 'Main') out.fabricMain = value;
      else if (value) out.fabricOther.push(`${m[1]}: ${value}`);
    }
    out.evidence.fabric = `"Fabric ${fabric[1]!.trim()}"`;
  } else out.evidence.fabric = fabricBlock ? 'fabric block without "Main:"' : `no "${markers.fabric}" block on the page`;
  const modelBlock = blockText(clean, markers.modelSize, 600);
  if (!modelBlock) {
    out.evidence.modelSize = `no "${markers.modelSize}" block on the page`;
    return out;
  }
  const model = /Models?['’]?s? height is ([^-–]{2,12}?)\s*[-–]\s*she wears an? (UK|EU|US|AU) size (\d{1,2}|X{0,3}S|M|X{0,3}L)\b/i.exec(modelBlock);
  if (model) {
    out.modelHeight = model[1]!.trim();
    out.modelSize = { system: model[2]!.toUpperCase() as SizeSystem, size: model[3]!.toUpperCase() };
    out.evidence.modelSize = `"${model[0]}"`;
  }
  const len = /Wearing length is:?\s*(\d{2,3}(?:\.\d)?)\s*cm/i.exec(modelBlock);
  if (len) {
    out.wearingLengthCm = Number(len[1]);
    out.evidence.wearingLength = `"${len[0]}"`;
  } else {
    const bare = /Wearing length is:?\s*(\S{0,8})/i.exec(modelBlock);
    if (bare) out.evidence.wearingLength = `"${bare[0]}" (no length in cm: not used)`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Category, subcategory, length band
// ---------------------------------------------------------------------------

export function tagValues(p: Pick<ShopifyProduct, 'tags'>, key: string): string[] {
  const k = `${key.toLowerCase()}:`;
  return p.tags.filter((t) => t.toLowerCase().startsWith(k)).map((t) => t.slice(k.length).trim().toLowerCase());
}

export type LengthBandTag = 'mini' | 'midi' | 'midaxi' | 'maxi' | 'cropped' | 'regular';

/** The length band the shop tags (`length:midi`) or names in the title; undefined when neither says. */
export function lengthBand(p: Pick<ShopifyProduct, 'tags' | 'title'>): LengthBandTag | undefined {
  const tag = tagValues(p, 'length').find((v) => /^(mini|midi|midaxi|maxi|cropped|regular)$/.test(v));
  if (tag) return tag as LengthBandTag;
  const t = /\b(midaxi|maxi|midi|mini)\b/i.exec(p.title);
  return t ? (t[1]!.toLowerCase() as LengthBandTag) : undefined;
}

export interface CategoryResult {
  category: GarmentCategory;
  subcategory?: string;
  patternBlock?: string;
  evidence: string;
}

/** Category from the adapter's product_type table; subcategory and pattern block from tags and the title. */
export function categoryFor(p: ShopifyProduct, adapter: Pick<ShopAdapter, 'productTypes'>): CategoryResult | undefined {
  const map = adapter.productTypes[p.product_type];
  if (!map) return undefined;
  const words = `${p.title} ${tagValues(p, 'product-type').join(' ')} ${htmlToLines(p.body_html).join(' ')}`.toLowerCase();
  const band = lengthBand(p);
  const out: CategoryResult = { category: map.category, evidence: `product_type "${p.product_type}" → ${map.category}${map.kind ? ` (${map.kind})` : ''}` };
  if (map.category === 'bottom') {
    if (map.kind === 'skirt') {
      out.subcategory = band && /^(mini|midi|midaxi|maxi)$/.test(band) ? `${band}-skirt` : 'skirt';
      if (/\ba-line\b/.test(words)) out.patternBlock = 'a-line';
    } else {
      if (/\bwide[- ]leg\b/.test(words)) {
        out.subcategory = 'wide-leg-trousers';
        out.patternBlock = 'wide-leg';
      } else if (/\bbarrel\b/.test(words)) out.subcategory = 'barrel-leg-trousers';
      else if (/\bstraight\b/.test(words)) {
        out.subcategory = 'straight-trousers';
        out.patternBlock = 'straight';
      } else out.subcategory = 'trousers';
    }
  } else if (map.category === 'dress') {
    out.subcategory = band && /^(mini|midi|midaxi|maxi)$/.test(band) ? `${band}-dress` : 'dress';
    if (/\bshift\b/.test(words)) out.patternBlock = 'shift';
    else if (/\bwrap\b/.test(words)) out.patternBlock = 'wrap';
    else if (/\bslip\b/.test(words)) out.patternBlock = 'slip';
  } else if (map.category === 'top') {
    if (/\bblouse\b/.test(words)) out.subcategory = 'blouse';
    else if (/\bshirt\b/.test(words)) {
      out.subcategory = 'shirt';
      out.patternBlock = 'shirt';
    } else out.subcategory = 'top';
  } else if (map.category === 'outerwear') {
    if (/\bcardigan|cardi\b/.test(words)) out.subcategory = 'cardigan';
    else if (/\bcoat\b/.test(words)) out.subcategory = 'coat';
    else out.subcategory = 'jacket';
  }
  if (band) out.evidence += `; length band "${band}" (${tagValues(p, 'length').length ? 'length tag' : 'title'})`;
  return out;
}

// ---------------------------------------------------------------------------
// Wearing length: which payload key, and is it plausible?
// ---------------------------------------------------------------------------

/** Plausible garment lengths (cm) per category and band: shoulder to hem for dresses, tops and outerwear, waist to hem for skirts. */
const LENGTH_RANGES: ReadonlyArray<{ category: GarmentCategory; kind?: 'skirt' | 'trousers'; band?: LengthBandTag; range: [number, number] }> = [
  { category: 'dress', band: 'mini', range: [70, 100] },
  { category: 'dress', band: 'midi', range: [95, 135] },
  { category: 'dress', band: 'midaxi', range: [105, 140] },
  { category: 'dress', band: 'maxi', range: [120, 160] },
  { category: 'dress', range: [70, 160] },
  { category: 'top', range: [35, 85] },
  { category: 'outerwear', range: [40, 125] },
  { category: 'bottom', kind: 'skirt', band: 'mini', range: [30, 55] },
  { category: 'bottom', kind: 'skirt', band: 'midi', range: [60, 92] },
  { category: 'bottom', kind: 'skirt', band: 'midaxi', range: [70, 95] },
  { category: 'bottom', kind: 'skirt', band: 'maxi', range: [80, 110] },
  { category: 'bottom', kind: 'skirt', range: [30, 110] },
];

/**
 * The payload key and plausibility of a shop's "wearing length". Trousers are never given one: a
 * trouser "wearing length" can be the outseam, the inseam or neither, and the shop does not say.
 */
export function wearingLengthUse(
  lengthCm: number,
  c: Pick<CategoryResult, 'category' | 'subcategory'>,
  band: LengthBandTag | undefined,
): { key?: 'shoulder_to_hem' | 'waist_to_hem'; ok: boolean; reason: string } {
  const kind = c.category === 'bottom' ? (/skirt/.test(c.subcategory ?? '') ? 'skirt' : 'trousers') : undefined;
  if (kind === 'trousers') return { ok: false, reason: `trousers: a "wearing length" of ${lengthCm} cm does not say outseam or inseam; not used` };
  const key = kind === 'skirt' ? 'waist_to_hem' : 'shoulder_to_hem';
  const rule = LENGTH_RANGES.find((r) => r.category === c.category && r.kind === kind && r.band === band) ?? LENGTH_RANGES.find((r) => r.category === c.category && r.kind === kind && r.band === undefined);
  if (!rule) return { key, ok: false, reason: `no plausibility range for ${c.category}` };
  const [lo, hi] = rule.range;
  const where = `${c.category}${kind ? ` (${kind})` : ''}${band && rule.band ? `, ${band}` : ''}`;
  if (lengthCm < lo || lengthCm > hi) return { key, ok: false, reason: `${lengthCm} cm is outside ${lo}–${hi} cm for a ${where}: not used (a shop data error until the shop confirms it)` };
  return { key, ok: true, reason: `${lengthCm} cm within ${lo}–${hi} cm for a ${where}` };
}

// ---------------------------------------------------------------------------
// Size option against the shop's chart
// ---------------------------------------------------------------------------

export interface SizeOfferResult {
  kind: 'numeric' | 'letter' | 'one-size' | 'unmapped';
  sizes: string[];
  /** Offered sizes the shop's chart has no row for. */
  missing: string[];
  /** Other options that change the fit (e.g. Length: Regular, Petite). */
  extraOptions: Array<{ name: string; values: string[] }>;
}

export function sizeOffer(p: ShopifyProduct, chart: ShopBodyChart): SizeOfferResult {
  const sizeOpt = p.options.find((o) => /size/i.test(o.name));
  const values = sizeOpt?.values.map((v) => v.trim()) ?? [];
  const extraOptions = p.options.filter((o) => o !== sizeOpt && !/colou?r|title/i.test(o.name)).map((o) => ({ name: o.name, values: [...o.values] }));
  if (!values.length || (values.length === 1 && /^(one size|default title|os)$/i.test(values[0]!))) return { kind: 'one-size', sizes: values, missing: [], extraOptions };
  if (values.every((v) => /^\d{1,2}$/.test(v))) {
    return { kind: 'numeric', sizes: values, missing: values.filter((v) => !chart.numeric.some((r) => r.size === v)), extraOptions };
  }
  if (values.every((v) => /^(?:X{0,3}S|M|X{0,3}L)$/i.test(v))) {
    return { kind: 'letter', sizes: values, missing: values.filter((v) => !chart.letter.some((r) => r.size === v.toUpperCase())), extraOptions };
  }
  return { kind: 'unmapped', sizes: values, missing: values, extraOptions };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface ImportPayloadResult {
  handle: string;
  productType: string;
  payload: GarmentPayloadDraft;
  /** v2 field beside the v1 payload: the size the shop photographed, when it says so. */
  baseSize?: string;
  baseSizeSource?: 'shop' | 'ours';
  price: { amount: number; currency: string };
  completeness: CompletenessResult;
  fullSchemaIssues: string[];
  evidence: Record<string, string>;
  warnings: string[];
  features: GarmentFeatures;
}

/** Tag phrases that state construction, as text the feature parser reads ("sleeve-length:long sleeve" → "long sleeve"). */
function tagPhrases(p: ShopifyProduct): string[] {
  return ['sleeve-length', 'neckline', 'fastening'].flatMap((k) => tagValues(p, k).map((v) => (k === 'neckline' && v === 'v-neck' ? 'v-neck neckline' : v)));
}

/** Build the GarmentPayload v1 draft for one product of an adapted shop. `page` is its product page, when downloaded. */
export function buildImportPayload(p: ShopifyProduct, adapter: ShopAdapter, page?: ProductPageFacts): ImportPayloadResult {
  const evidence: Record<string, string> = {};
  const warnings: string[] = [];
  const lines = htmlToLines(p.body_html);
  const text = lines.join(' ');
  const cat = categoryFor(p, adapter);
  const payload: GarmentPayloadDraft = {
    schemaVersion: 1,
    id: String(p.id),
    brand: p.vendor || adapter.brand,
    name: p.title,
    productUrl: `https://${adapter.domain}/products/${p.handle}`,
    productPhotos: p.images.slice(0, 20).map((i) => i.src),
  };
  if (cat) {
    payload.category = cat.category;
    if (cat.subcategory) payload.subcategory = cat.subcategory;
    if (cat.patternBlock) payload.patternBlock = cat.patternBlock;
    evidence.category = cat.evidence;
  } else warnings.push(`product_type "${p.product_type}" is not mapped to a category for ${adapter.id}`);

  // Fabric: the product page's composition; else only the fabric-group tag, which names a family, not a composition.
  if (page?.fabricMain) {
    const resolved = fabricFromText(page.fabricMain);
    const named = resolveFabricText(page.fabricMain);
    if (resolved && named) {
      payload.fabric = resolvedFabricToPayload(resolved);
      if (!named.blend) delete payload.fabric.blend;
      evidence.fabric = `product page ${page.evidence.fabric} → ${named.primary}${named.blend ? ` ${JSON.stringify(named.blend)}` : ''}; weight/stretch/drape/opacity/sheen from the fabric library v${resolved.libraryVersion}`;
      if (resolved.unknown.length) warnings.push(`fabric names not in the fabric library: ${resolved.unknown.join(', ')}`);
      if (page.fabricOther.length) warnings.push(`other fabric parts not modelled (payload has one fabric): ${page.fabricOther.join('; ')}`);
    } else warnings.push(`fabric "${page.fabricMain}" names nothing in the fabric library`);
  } else {
    const groups = tagValues(p, 'fabric-group');
    warnings.push(`no composition${page ? ' on the product page' : ' (product page not downloaded)'}; fabric-group tag ${groups.length ? `"${groups.join(', ')}"` : 'absent'} is a family, not a composition: fabric left out`);
  }

  // Size chart: the shop's own printed body chart, restricted to the sizes offered.
  const offer = sizeOffer(p, adapter.chart);
  const chart = adapter.chart;
  let rows: SizeRow[] = [];
  if (offer.kind === 'numeric') rows = chart.numeric.filter((r) => offer.sizes.includes(r.size));
  else if (offer.kind === 'letter') rows = chart.letter.filter((r) => offer.sizes.map((s) => s.toUpperCase()).includes(r.size)).map(({ size, bust, waist, hip }) => ({ size, bust, waist, hip }));
  if (offer.missing.length) warnings.push(`sizes without a row in the shop's chart: ${offer.missing.join(', ')}`);
  if (offer.kind === 'one-size' || offer.kind === 'unmapped') warnings.push(`size option ${JSON.stringify(offer.sizes)} cannot be mapped to the shop's chart: no size chart`);
  if (rows.length) {
    payload.sizeChartType = 'body';
    payload.sizeChart = rows;
    evidence.sizeChart = `the shop's printed ${chart.system} body chart (${chart.source.url}, read ${chart.source.accessed}) restricted to ${offer.kind} sizes ${offer.sizes.join(',')}`;
  }
  if (cat?.category === 'bottom' && !/skirt/.test(cat.subcategory ?? '') && payload.sizeChart) {
    const len = tagValues(p, 'length').find((v) => v in chart.insideLeg);
    if (len) {
      const leg = chart.insideLeg[len]!;
      payload.sizeChart = payload.sizeChart.map((r) => ({ ...r, inseam: leg }));
      evidence.inseam = `length tag "${len}" → the shop's body inside leg ${leg} cm (same for every size; the chart has no inside leg per size)`;
    } else warnings.push('trousers without a length tag: no inside leg in the chart');
  }
  for (const o of offer.extraOptions) {
    warnings.push(`second option "${o.name}" (${o.values.join(', ')}): the chart is one body per size, so ${o.values.slice(1).join('/') || 'other'} lengths are not modelled`);
  }

  // Base size: the size the model wears, when the shop prints it.
  let baseSize: string | undefined;
  let baseSizeSource: 'shop' | 'ours' | undefined;
  const model = page?.modelSize;
  if (model && model.system === chart.system && payload.sizeChart) {
    if (offer.kind === 'numeric' && payload.sizeChart.some((r) => r.size === model.size)) {
      baseSize = model.size;
      evidence.baseSize = `${page!.evidence.modelSize}: the photographed size, stated by the shop`;
    } else if (offer.kind === 'letter' && offer.sizes.map((s) => s.toUpperCase()).includes(model.size)) {
      baseSize = model.size;
      evidence.baseSize = `${page!.evidence.modelSize}: the photographed size, stated by the shop (a letter size, labelled "${model.system} size")`;
    } else if (offer.kind === 'letter') {
      const l = chart.letter.find((r) => r.covers.includes(model.size) && offer.sizes.map((s) => s.toUpperCase()).includes(r.size));
      if (l) {
        baseSize = l.size;
        evidence.baseSize = `${page!.evidence.modelSize} → ${l.size} (the shop's letter chart: ${l.size} = ${chart.system} ${l.covers.join('-')}); the shop does not say which letter size was photographed`;
        warnings.push(`base size ${l.size} is inferred from the model's ${chart.system} ${model.size}; the product is sold in letter sizes`);
      }
    }
    if (baseSize) baseSizeSource = 'shop';
  }
  if (!baseSize && payload.sizeChart?.length) {
    baseSize = payload.sizeChart[Math.floor((payload.sizeChart.length - 1) / 2)]!.size;
    baseSizeSource = 'ours';
    evidence.baseSize = `${baseSize}, the middle of the offered range (our default, not stated by the shop)`;
  }

  // Wearing length.
  if (page?.wearingLengthCm !== undefined && cat) {
    const use = wearingLengthUse(page.wearingLengthCm, cat, lengthBand(p));
    if (use.ok && use.key) {
      payload.lengthCm = { [use.key]: page.wearingLengthCm } as LengthCm;
      evidence.lengthCm = `${page.evidence.wearingLength} → ${use.key} (${use.reason}); assumed measured at the model's size, which the shop does not say`;
    } else warnings.push(`wearing length: ${use.reason}`);
  } else if (page && page.wearingLengthCm === undefined) warnings.push(`no wearing length in cm on the product page${page.evidence.wearingLength ? ` (${page.evidence.wearingLength})` : ''}`);

  // Elastic waist / shirring.
  const elastic = /elasticated|elastic|shirred/i;
  if (cat?.category === 'bottom' && (elastic.test(text) || tagValues(p, 'fastening').includes('elasticated'))) {
    payload.stretchZones = ['waistband'];
    evidence.stretchZones = `"${(elastic.exec(text) ?? ['fastening:elasticated'])[0]}" (description or fastening tag)`;
  }
  if (cat && cat.category !== 'bottom' && /shirred (?:bodice|waist)/i.test(text)) warnings.push(`"${/shirred (?:bodice|waist)/i.exec(text)![0]}": a shirred zone stretches, but the payload has no stretch zone for a bodice; the fit engine treats it as the fabric's stretch`);

  const sizeTip = lines.find((l) => /size tip|true to size|size (?:up|down)|usual size/i.test(l));
  if (sizeTip) payload.sizingNotes = sizeTip;

  if (cat && payload.sizeChart && CATEGORY_POINTS[cat.category].includes('shoulder')) warnings.push("the shop's body chart has no shoulder width; the shoulder fit point is skipped");
  const colour = tagValues(p, 'colour').concat(tagValues(p, 'colour-group'));
  warnings.push(`colour is only named (${colour.length ? colour.join(', ') : 'none'}): primaryColorHex left out (no name-to-hex guess)`);
  const price = Number(p.variants[0]?.price);
  warnings.push(`price is ${Number.isFinite(price) ? price : '?'} ${adapter.currency}; priceEur is left out (no exchange rate is assumed)`);

  const draft = GarmentPayloadDraftSchema.safeParse(payload);
  if (!draft.success) warnings.push(`draft schema: ${draft.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const full = GarmentPayloadSchema.safeParse(payload);
  const out: ImportPayloadResult = {
    handle: p.handle,
    productType: p.product_type,
    payload,
    price: { amount: price, currency: adapter.currency },
    completeness: completenessScore(payload),
    fullSchemaIssues: full.success ? [] : full.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    evidence,
    warnings,
    features: garmentFeatures([text, ...tagPhrases(p)].join('. '), cat?.category),
  };
  if (baseSize) {
    out.baseSize = baseSize;
    out.baseSizeSource = baseSizeSource!;
  }
  return out;
}
