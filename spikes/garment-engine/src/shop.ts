/**
 * Shop validation, step 1: from a Shopify shop's public `products.json` to GarmentPayload v1 drafts
 * the engine can be validated on, before anything is installed on the shop. Used for
 * bohohippychic.com.au (AU sizes, AUD), with the owner's consent, on public data only.
 *
 * Pure functions; the file I/O and downloads are in `shopCli.ts`. Everything read from the shop is
 * untrusted text: it is parsed, never executed, and every value taken from it is traceable to the
 * text in the output (`evidence`). Nothing is invented: a value the text does not give stays absent
 * and `completenessScore` says so.
 */
import {
  AU_WOMENS_BODY_CHART,
  CATEGORY_POINTS,
  GarmentPayloadDraftSchema,
  GarmentPayloadSchema,
  auWomensBodyChart,
  completenessScore,
  fabricFromText,
  inferCategory,
  resolveFabricText,
  resolvedFabricToPayload,
  type CompletenessResult,
  type Ease,
  type GarmentCategory,
  type GarmentPayloadDraft,
  type LengthCm,
  type SizeRow,
} from '@curtain/schema';
import { garmentFeatures, type GarmentFeatures } from './features';

// ---------------------------------------------------------------------------
// Shopify products.json (the public storefront endpoint), the fields we read
// ---------------------------------------------------------------------------

export interface ShopifyImage {
  id: number;
  position: number;
  src: string;
  width: number;
  height: number;
  alt?: string | null;
}

export interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  price: string;
  available?: boolean;
}

export interface ShopifyOption {
  name: string;
  position?: number;
  values: string[];
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  tags: string[];
  options: ShopifyOption[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

export const SHOP = {
  domain: 'bohohippychic.com.au',
  brand: 'Boho Hippy Chic',
  currency: 'AUD',
} as const;

/** The apparel collections (Shopify `product_type`) validated, one product each. */
export const SHOP_APPAREL_TYPES = ['Dresses', 'Tops', 'Pants', 'Skirts', 'Jackets & Knits'] as const;
export type ShopApparelType = (typeof SHOP_APPAREL_TYPES)[number];

/** Grading starts from AU 12 for every size-ranged product (the middle of the shop's 8–16 range). */
export const SHOP_BASE_AU_SIZE = '12';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Description HTML as lines of plain text (one per paragraph, list item, heading, table cell or <br>). */
export function htmlToLines(html: string | null | undefined): string[] {
  if (!html) return [];
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|div|tr|td|th|ul|ol|table)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

/** Description as one line of text. */
export function htmlToText(html: string | null | undefined): string {
  return htmlToLines(html).join(' ');
}

/** Lines split further into sentences. */
function sentences(lines: readonly string[]): string[] {
  return lines.flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Size option
// ---------------------------------------------------------------------------

export type SizeOffer =
  | { kind: 'au-numeric'; sizes: string[] }
  | { kind: 'au-range'; ranges: Array<{ label: string; au: [number, number] }>; unresolved: string[] }
  | { kind: 'free'; label: string; fitsAu?: [number, number] }
  | { kind: 'other'; sizes: string[] };

const FREE_LABEL = /^(default title|one ?size|free ?size|os)$/i;
const AU_NUMERIC = /^\d{1,2}$/;

function fitsAuRange(text: string): [number, number] | undefined {
  const m = /(?:free\s*size|fits?|one\s*size)[^0-9]{0,40}?(\d{1,2})\s*(?:to|-|–)\s*(\d{1,2})(?!\d)/i.exec(text);
  if (!m) return undefined;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return lo < hi ? [lo, hi] : undefined;
}

/** What sizes the product is sold in, read from the Size option and, for S-M style ranges, the description. */
export function parseSizeOffer(p: ShopifyProduct): SizeOffer {
  const text = htmlToText(p.body_html);
  const sizeOpt = p.options.find((o) => /size/i.test(o.name));
  const values = (sizeOpt ?? p.options[0])?.values.map((v) => v.trim()) ?? [];
  if (values.length === 0 || (values.length === 1 && FREE_LABEL.test(values[0]!))) {
    const fits = fitsAuRange(text);
    return fits ? { kind: 'free', label: values[0] ?? 'Default Title', fitsAu: fits } : { kind: 'free', label: values[0] ?? 'Default Title' };
  }
  if (values.every((v) => AU_NUMERIC.test(v))) {
    return { kind: 'au-numeric', sizes: [...values].sort((a, b) => Number(a) - Number(b)) };
  }
  if (values.every((v) => /^[A-Z]{1,3}\s*[-/]\s*[A-Z]{1,3}$/i.test(v))) {
    const ranges: Array<{ label: string; au: [number, number] }> = [];
    const unresolved: string[] = [];
    for (const label of values) {
      const esc = label.replace(/\s*[-/]\s*/, '\\s*[-/]\\s*');
      // "S-M Fits Australian Size 8 to 12", "S/M (8–14)"; the shop sometimes glues the next label on ("12M-L").
      const m = new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])[^0-9]{0,40}?(\\d{1,2})\\s*(?:to|-|–)\\s*(\\d{1,2})(?!\\d)`, 'i').exec(text);
      if (m && Number(m[1]) < Number(m[2])) ranges.push({ label, au: [Number(m[1]), Number(m[2])] });
      else unresolved.push(label);
    }
    ranges.sort((a, b) => a.au[0] - b.au[0]);
    return { kind: 'au-range', ranges, unresolved };
  }
  return { kind: 'other', sizes: values };
}

// ---------------------------------------------------------------------------
// Measurements printed in the description
// ---------------------------------------------------------------------------

export type MeasureKey = 'bust' | 'waist' | 'hip' | 'length';

export interface PrintedTable {
  layout: 'size-per-row' | 'size-per-column';
  rows: Array<{ size: string } & Partial<Record<MeasureKey, number>>>;
  /** The text the table was read from. */
  evidence: string;
}

const HEADER_KEY: Record<string, MeasureKey> = { bust: 'bust', chest: 'bust', waist: 'waist', hip: 'hip', hips: 'hip', length: 'length' };
const NUM = '(\\d{2,3}(?:\\.\\d)?)\\s*(?:cm)?';

/** "Size Bust Length 8 94cm 90cm 10 98cm 90cm …" */
function sizePerRowTable(text: string): PrintedTable | undefined {
  const head = /\bSize\s+((?:(?:Bust|Chest|Waist|Hips?|Length)\s+){1,4})/i.exec(text);
  if (!head) return undefined;
  const cols = head[1]!.trim().split(/\s+/).map((c) => HEADER_KEY[c.toLowerCase()]!);
  const rowRe = new RegExp(`^(\\d{1,2})\\s+${cols.map(() => NUM).join('\\s+')}\\s*`, 'i');
  let rest = text.slice(head.index + head[0].length);
  const rows: PrintedTable['rows'] = [];
  for (let m = rowRe.exec(rest); m; m = rowRe.exec(rest)) {
    const row: PrintedTable['rows'][number] = { size: m[1]! };
    cols.forEach((c, i) => (row[c] = Number(m![i + 2])));
    rows.push(row);
    rest = rest.slice(m[0].length);
  }
  if (rows.length < 2) return undefined;
  return { layout: 'size-per-row', rows, evidence: text.slice(head.index, text.length - rest.length).trim() };
}

/** "Measurement (cm) AU 8 AU 10 AU 12 … Waist 94 110 112 … Hips 110 … Length 97 …" */
function sizePerColumnTable(text: string): PrintedTable | undefined {
  const head = /((?:\bAU\s*\d{1,2}\s+){2,10})/i.exec(text);
  if (!head) return undefined;
  const sizes = [...head[1]!.matchAll(/AU\s*(\d{1,2})/gi)].map((m) => m[1]!);
  const rows: PrintedTable['rows'] = sizes.map((size) => ({ size }));
  let rest = text.slice(head.index + head[0].length);
  const lineRe = new RegExp(`^(Bust|Chest|Waist|Hips?|Length)\\s+${sizes.map(() => NUM).join('\\s+')}\\s*`, 'i');
  let found = 0;
  for (let m = lineRe.exec(rest); m; m = lineRe.exec(rest)) {
    const key = HEADER_KEY[m[1]!.toLowerCase()]!;
    sizes.forEach((_, i) => (rows[i]![key] = Number(m![i + 2])));
    found++;
    rest = rest.slice(m[0].length);
  }
  if (found === 0) return undefined;
  return { layout: 'size-per-column', rows, evidence: text.slice(head.index, text.length - rest.length).trim() };
}

/** A size table printed in the description, if any. */
export function parsePrintedTable(text: string): PrintedTable | undefined {
  return sizePerRowTable(text) ?? sizePerColumnTable(text);
}

export interface FlatMeasurements {
  /** Chest circumference, cm (stated, or 2 × the flat width). */
  chestCm?: number;
  lengthCm?: number;
  evidence: string[];
}

/** Flat measurements of a one-size garment: "Chest laid flat … 51 cm", "Chest 124cm circumference", "Length 60cm". */
export function parseFlatMeasurements(text: string): FlatMeasurements | undefined {
  const out: FlatMeasurements = { evidence: [] };
  const circ = /(\d{2,3})\s*cm\s*(?:\(|)\s*(?:circumference|circumfrence|around)|(?:circumference|circumfrence|\(cir\))[^0-9]{0,20}(\d{2,3})\s*cm|chest\s*(\d{2,3})\s*cm\s*circum/i.exec(text);
  if (circ) {
    out.chestCm = Number(circ[1] ?? circ[2] ?? circ[3]);
    out.evidence.push(circ[0]);
  } else {
    const flat = /chest[^0-9]{0,40}?(?:laid\s*flat|flat)[^0-9]{0,30}?(\d{2,3})\s*cm/i.exec(text);
    if (flat) {
      out.chestCm = Number(flat[1]) * 2;
      out.evidence.push(flat[0]);
    }
  }
  const len = /length(?:\s*from\s*shoulder)?[^0-9a-z]{0,5}(?:approx\.?\s*)?(\d{2,3})\s*cm/i.exec(text);
  if (len) {
    out.lengthCm = Number(len[1]);
    out.evidence.push(len[0]);
  }
  return out.evidence.length ? out : undefined;
}

/**
 * Is a printed table a restated body chart or garment measurements? Shops print both without saying
 * which. A table within 3 cm (mean) of the AU body chart on its girths is a body chart; otherwise the
 * numbers are taken as garment measurements. A heuristic, logged in the output.
 */
export function classifyPrintedTable(t: PrintedTable): { kind: 'body' | 'garment' | 'unknown'; meanAbsDiffCm?: number } {
  const diffs: number[] = [];
  for (const row of t.rows) {
    const body = AU_WOMENS_BODY_CHART.find((r) => r.size === row.size);
    if (!body) continue;
    for (const k of ['bust', 'waist', 'hip'] as const) {
      const v = row[k];
      const b = body[k];
      if (v !== undefined && b !== undefined) diffs.push(Math.abs(v - b));
    }
  }
  if (diffs.length === 0) return { kind: 'unknown' };
  const mean = Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10;
  return { kind: mean <= 3 ? 'body' : 'garment', meanAbsDiffCm: mean };
}

/** Size-to-size steps in a printed column that no grading would produce (> 10 cm, or a decrease). */
export function implausibleSteps(t: PrintedTable): string[] {
  const out: string[] = [];
  for (const k of ['bust', 'waist', 'hip', 'length'] as const) {
    for (let i = 1; i < t.rows.length; i++) {
      const a = t.rows[i - 1]![k];
      const b = t.rows[i]![k];
      if (a === undefined || b === undefined) continue;
      const step = b - a;
      if (step < 0 || (k !== 'length' && step > 10)) out.push(`${k} ${t.rows[i - 1]!.size}→${t.rows[i]!.size}: ${a} → ${b} cm`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fabric
// ---------------------------------------------------------------------------

const STYLING = /\b(pair|pairs|paired|style it|styled|team|layer(?:ed)? (?:it )?(?:over|with)|wear (?:it )?with|perfect (?:layered )?with|go-to|matching)\b/i;
const FIBRE_WORD = /\b(rayon|viscose|cotton|linen|polyester|nylon|acrylic|wool|silk|elastane|spandex|lyocell|tencel|modal|hemp|bamboo)\b/i;

/**
 * The sentence that states the fabric. Descriptions also name fabrics in styling advice ("pair it
 * with denim"), so the order is: a "Fabric:"/"Material:" label, a percentage composition, a
 * "crafted/made from" sentence, then any other sentence naming a fibre; styling sentences never count.
 */
export function fabricStatement(lines: readonly string[]): string | undefined {
  const all = sentences(lines);
  const label = all.map((s) => /\b(?:fabric|material)s?\s*:\s*(.+)$/i.exec(s)?.[1]).find((s) => s && FIBRE_WORD.test(s));
  if (label) return label;
  const tiers: Array<(s: string) => boolean> = [
    (s) => /\d\s*%\s*[a-z]/i.test(s) && FIBRE_WORD.test(s),
    (s) => /\b(crafted|made|cut)\s+(?:in|from)\b/i.test(s) && FIBRE_WORD.test(s),
    (s) => FIBRE_WORD.test(s),
  ];
  for (const ok of tiers) {
    const hit = all.find((s) => ok(s) && !STYLING.test(s));
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Category, block, notes
// ---------------------------------------------------------------------------

const BLOCK_RULES: ReadonlyArray<[RegExp, string, string]> = [
  [/baby\s?doll/i, 'empire', 'babydoll'],
  [/palazzo|wide[- ]leg/i, 'wide-leg', 'palazzo'],
  [/maxi skirt/i, 'a-line', 'maxi-skirt'],
  [/\bskirt\b/i, 'a-line', 'skirt'],
  [/blouse|shirt/i, 'shirt', 'blouse'],
  [/cardi(gan)?\b/i, 'oversized', 'cardigan'],
  [/\bknit\b/i, 'oversized', 'knit'],
];

export function patternBlockFor(p: ShopifyProduct): { patternBlock?: string; subcategory?: string } {
  const hay = `${p.title} ${p.tags.join(' ')}`;
  for (const [re, patternBlock, subcategory] of BLOCK_RULES) if (re.test(hay)) return { patternBlock, subcategory };
  return {};
}

const SIZING_NOTE = /true to size|runs? (?:small|large|big)|cut oversize|size (?:up|down)|relaxed fit|shrinkage|fits? australian size/i;

export function sizingNotesFrom(lines: readonly string[]): string | undefined {
  const notes = sentences(lines).filter((s) => SIZING_NOTE.test(s) && !STYLING.test(s));
  if (!notes.length) return undefined;
  const joined = notes.join(' ');
  return joined.length > 500 ? `${joined.slice(0, 497)}...` : joined;
}

const ELASTIC_WAIST = /elastic(?:ated)?\s+(?:drawstring\s+)?waist(?:band)?|drawstring\s+waist|waistband\s+with\s+(?:adjustable\s+)?drawstring|shirring/i;

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface ShopPayloadResult {
  handle: string;
  productType: string;
  /** GarmentPayload v1 draft: every field the shop data supports, nothing invented. */
  payload: GarmentPayloadDraft;
  /** v2 field (ENGINE-HANDOFF "Garment data"), kept beside the v1 payload. */
  baseSize?: string;
  priceAud: number;
  completeness: CompletenessResult;
  /** Issues against the full GarmentPayload v1 schema (the draft passes; these are what an active product still needs). */
  fullSchemaIssues: string[];
  /** Where each value came from. */
  evidence: Record<string, string>;
  warnings: string[];
  /** Sleeve style, front closure and neckline from the description's own words (`features.ts`); beside the payload, which has no field for them. */
  features: GarmentFeatures;
}

function roundHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

/** Body rows for S-M style ranges: the mean of the AU chart rows the range covers. */
function rangeBodyRows(ranges: ReadonlyArray<{ label: string; au: [number, number] }>): SizeRow[] {
  return ranges.map(({ label, au }) => {
    const covered = AU_WOMENS_BODY_CHART.filter((r) => Number(r.size) >= au[0] && Number(r.size) <= au[1]);
    const row: SizeRow = { size: label };
    for (const k of ['bust', 'waist', 'hip'] as const) {
      const vals = covered.map((r) => r[k]).filter((v): v is number => v !== undefined);
      if (vals.length) row[k] = roundHalf(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    return row;
  });
}

function lengthKeyFor(category: GarmentCategory, subcategory: string | undefined): string {
  if (category === 'bottom') return subcategory === 'palazzo' ? 'outseam' : 'waist_to_hem';
  return 'shoulder_to_hem';
}

/** Build the GarmentPayload v1 draft for one shop product. */
export function buildShopPayload(p: ShopifyProduct): ShopPayloadResult {
  const lines = htmlToLines(p.body_html);
  const text = lines.join(' ');
  const evidence: Record<string, string> = {};
  const warnings: string[] = [];

  const category = inferCategory(p.product_type, p.title);
  evidence.category = `inferCategory("${p.product_type}") → ${category ?? 'none'}`;
  const { patternBlock, subcategory } = patternBlockFor(p);
  if (patternBlock) evidence.patternBlock = `title/tags keyword → ${patternBlock}`;

  const payload: GarmentPayloadDraft = {
    schemaVersion: 1,
    id: String(p.id),
    brand: p.vendor || SHOP.brand,
    name: p.title,
    productUrl: `https://${SHOP.domain}/products/${p.handle}`,
    productPhotos: p.images.slice(0, 20).map((i) => i.src),
  };
  if (category) payload.category = category;
  if (subcategory) payload.subcategory = subcategory;
  if (patternBlock) payload.patternBlock = patternBlock;

  // Fabric
  const statement = fabricStatement(lines);
  if (statement) {
    const resolved = fabricFromText(statement);
    const named = resolveFabricText(statement);
    if (resolved && named) {
      payload.fabric = resolvedFabricToPayload(resolved);
      // `blend` only when the text states the composition: "rayon" alone is not "100% rayon" (a
      // "rayon blend" exists too). The library still resolves the single fibre at 100% for the
      // weight/stretch/drape defaults; that share is a default, never a payload value.
      if (!named.blend) delete payload.fabric.blend;
      evidence.fabric = `"${statement}" → ${named.primary}${named.blend ? ` ${JSON.stringify(named.blend)}` : ' (composition not stated: no blend; the library defaults treat it as a single fibre)'}; weight/stretch/drape/opacity/sheen from the fabric library v${resolved.libraryVersion} (${resolved.provenance.drape})`;
      if (!named.blend) warnings.push(`fabric composition not stated (only "${named.primary}" named): blend left out; weight/stretch/drape use the single-fibre library default`);
      if (resolved.unknown.length) warnings.push(`fabric names not in the library: ${resolved.unknown.join(', ')}`);
      if (/\bknit\b/i.test(text) && !resolved.construction) {
        warnings.push('the product is a knit but the fabric library has no generic sweater-knit construction; stretch and drape come from the fibres alone and understate a knit');
      }
    } else warnings.push(`fabric statement "${statement}" names nothing in the fabric library`);
  } else warnings.push('no fabric statement in the description');

  // Size chart
  const offer = parseSizeOffer(p);
  let baseSize: string | undefined;
  let bodyBase: SizeRow | undefined;
  if (offer.kind === 'au-numeric') {
    const chart = auWomensBodyChart(offer.sizes);
    const missing = offer.sizes.filter((s) => !chart.some((r) => r.size === s));
    if (missing.length) warnings.push(`AU sizes outside the AU chart (6–20): ${missing.join(', ')}`);
    if (chart.length) {
      payload.sizeChartType = 'body';
      payload.sizeChart = chart;
      evidence.sizeChart = `Size option ${JSON.stringify(offer.sizes)} → AU_WOMENS_BODY_CHART rows`;
    }
    if (offer.sizes.includes(SHOP_BASE_AU_SIZE)) {
      baseSize = SHOP_BASE_AU_SIZE;
      bodyBase = chart.find((r) => r.size === baseSize);
      evidence.baseSize = `AU ${SHOP_BASE_AU_SIZE}, the default base size for size-ranged items (not stated by the shop)`;
    }
  } else if (offer.kind === 'au-range') {
    if (offer.ranges.length) {
      const rows = rangeBodyRows(offer.ranges);
      payload.sizeChartType = 'body';
      payload.sizeChart = rows;
      evidence.sizeChart = `Size option ${offer.ranges.map((r) => `${r.label} = AU ${r.au[0]}–${r.au[1]}`).join(', ')} (from the description) → mean of the AU_WOMENS_BODY_CHART rows each range covers`;
      const base = offer.ranges.find((r) => r.au[0] <= Number(SHOP_BASE_AU_SIZE) && Number(SHOP_BASE_AU_SIZE) <= r.au[1]);
      if (base) {
        baseSize = base.label;
        bodyBase = rows.find((r) => r.size === base.label);
        evidence.baseSize = `${base.label}, the range that holds AU ${SHOP_BASE_AU_SIZE} (not stated by the shop)`;
      }
    }
    if (offer.unresolved.length) warnings.push(`size labels without an AU range in the text: ${offer.unresolved.join(', ')}`);
  } else if (offer.kind === 'free') {
    const flat = parseFlatMeasurements(text);
    if (flat?.chestCm !== undefined) {
      payload.sizeChartType = 'garment';
      payload.sizeChart = [{ size: 'ONE', bust: flat.chestCm }];
      baseSize = 'ONE';
      evidence.sizeChart = `one size; flat measurements "${flat.evidence.join('" / "')}" → garment chart`;
      if (flat.lengthCm !== undefined && category) payload.lengthCm = { [lengthKeyFor(category, subcategory)]: flat.lengthCm } as LengthCm;
    } else {
      warnings.push(`one size (${offer.label}) without a chest measurement in the text: no size chart, the product stays incomplete`);
    }
    if (offer.fitsAu) evidence.fitsAu = `fits AU ${offer.fitsAu[0]}–${offer.fitsAu[1]} (text)`;
  } else {
    warnings.push(`size labels the AU chart cannot map: ${offer.sizes.join(', ')}`);
  }

  // Printed table: garment measurements become ease and lengths at the base size.
  const table = parsePrintedTable(text);
  if (table) {
    const cls = classifyPrintedTable(table);
    evidence.printedTable = `${table.layout}: "${table.evidence}" → ${cls.kind}${cls.meanAbsDiffCm !== undefined ? ` (mean |Δ| vs AU body chart ${cls.meanAbsDiffCm} cm)` : ''}`;
    const steps = implausibleSteps(table);
    if (steps.length) warnings.push(`printed table has steps no grading produces: ${steps.join('; ')}`);
    const elastic = ELASTIC_WAIST.test(text);
    const baseRow = baseSize ? table.rows.find((r) => r.size === baseSize) : undefined;
    if (cls.kind === 'garment' && baseRow && bodyBase && payload.sizeChartType === 'body') {
      const ease: Ease = {};
      for (const k of ['bust', 'waist', 'hip'] as const) {
        const g = baseRow[k];
        const b = bodyBase[k];
        if (g === undefined || b === undefined) continue;
        if (k === 'waist' && elastic) {
          warnings.push(`printed waist ${g} cm at AU ${baseSize} not used as ease: the waist is elastic and the text does not say relaxed or stretched`);
          continue;
        }
        if (k === 'waist' && steps.some((s) => s.startsWith('waist'))) continue;
        ease[k] = Math.round((g - b) * 10) / 10;
      }
      if (Object.keys(ease).length) {
        payload.ease = ease;
        evidence.ease = `printed garment measurement at AU ${baseSize} minus AU_WOMENS_BODY_CHART AU ${baseSize}`;
      }
    }
    if (cls.kind !== 'body' && baseRow?.length !== undefined && category) {
      payload.lengthCm = { [lengthKeyFor(category, subcategory)]: baseRow.length } as LengthCm;
      evidence.lengthCm = `printed Length at AU ${baseSize}: ${baseRow.length} cm`;
    }
  }

  if (ELASTIC_WAIST.test(text) && category === 'bottom') {
    payload.stretchZones = ['waistband'];
    evidence.stretchZones = `"${ELASTIC_WAIST.exec(text)![0]}" in the text`;
  }

  const notes = sizingNotesFrom(lines);
  if (notes) payload.sizingNotes = notes;

  if (category && payload.sizeChart && payload.sizeChartType === 'body') {
    const pts = CATEGORY_POINTS[category];
    if (pts.includes('shoulder')) warnings.push('the AU body chart has no shoulder width; the shoulder fit point is skipped');
  }

  const price = Number(p.variants[0]?.price);
  warnings.push(`price is ${Number.isFinite(price) ? price : '?'} ${SHOP.currency}; priceEur is left out (no exchange rate is assumed)`);

  const draft = GarmentPayloadDraftSchema.safeParse(payload);
  if (!draft.success) warnings.push(`draft schema: ${draft.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const full = GarmentPayloadSchema.safeParse(payload);
  const fullSchemaIssues = full.success ? [] : full.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

  const out: ShopPayloadResult = {
    handle: p.handle,
    productType: p.product_type,
    payload,
    priceAud: price,
    completeness: completenessScore(payload),
    fullSchemaIssues,
    evidence,
    warnings,
    features: garmentFeatures(text, category),
  };
  if (baseSize) out.baseSize = baseSize;
  return out;
}

// ---------------------------------------------------------------------------
// Candidate ranking (text criteria; the back view is judged on the images, see shopImages.ts)
// ---------------------------------------------------------------------------

export interface CandidateScore {
  handle: string;
  productType: string;
  /** Sizes 8–16 offered, or a size option the text maps to AU sizes. */
  sizes: boolean;
  images: number;
  fabric: boolean;
  /** Garment measurements printed (a table that is not the AU body chart, or flat measurements). */
  garmentMeasurements: boolean;
  /** Sort key: criteria in order of preference. */
  rank: [number, number, number, number, number];
}

export function scoreCandidate(p: ShopifyProduct): CandidateScore {
  const offer = parseSizeOffer(p);
  const sizes =
    (offer.kind === 'au-numeric' && ['8', '10', '12', '14', '16'].every((s) => offer.sizes.includes(s))) ||
    (offer.kind === 'au-range' && offer.ranges.length > 0 && offer.unresolved.length === 0);
  const lines = htmlToLines(p.body_html);
  const text = lines.join(' ');
  const statement = fabricStatement(lines);
  const fabric = statement !== undefined && resolveFabricText(statement) !== undefined;
  const table = parsePrintedTable(text);
  const garmentMeasurements = (table !== undefined && classifyPrintedTable(table).kind === 'garment') || parseFlatMeasurements(text)?.chestCm !== undefined;
  return {
    handle: p.handle,
    productType: p.product_type,
    sizes,
    images: p.images.length,
    fabric,
    garmentMeasurements,
    rank: [sizes ? 1 : 0, p.images.length >= 3 ? 1 : 0, fabric ? 1 : 0, garmentMeasurements ? 1 : 0, p.images.length],
  };
}

export function rankCandidates(products: readonly ShopifyProduct[], productType: string): CandidateScore[] {
  return products
    .filter((p) => p.product_type === productType)
    .map(scoreCandidate)
    .sort((a, b) => {
      for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i]! - a.rank[i]!;
      return a.handle.localeCompare(b.handle);
    });
}
