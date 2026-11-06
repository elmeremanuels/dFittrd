/**
 * "Import from description": many small shops print the garment's measurements and fabric in the
 * product description instead of a size chart ("Bust 120cm, Length 95cm", "Chest laid flat 56 cm",
 * "100% rayon"). For a one-size product that is its whole garment chart. This module reads the
 * description and proposes one; the merchant confirms in the admin before anything is written.
 *
 * Fabric uses the schema's text mappings (`parseFabricText` / `fabricFromText` →
 * `resolvedFabricToPayload`), so the library ids and stretch/drape defaults are the same as
 * everywhere else. Nothing is guessed silently: every number carries the sentence it came from.
 */
import {
  CM_PER_INCH,
  checkChart,
  fabricFromText,
  resolvedFabricToPayload,
  roundHalfCm,
  type Fabric,
  type LengthCm,
  type SizeRow,
} from '@curtain/schema';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', frac12: '½', deg: '°' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Description HTML as lines of plain text (one per paragraph, list item, heading, cell or <br>). */
export function descriptionLines(html: string | null | undefined): string[] {
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

function sentences(lines: readonly string[]): string[] {
  return lines.flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/)).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export type DescriptionPoint = 'bust' | 'waist' | 'hip' | 'length';

export interface DescriptionMeasurement {
  point: DescriptionPoint;
  /** All round (circumference) for bust/waist/hip, in cm; a straight length for `length`. */
  cm: number;
  /** The value was a flat width and was doubled. */
  doubled: boolean;
  /** The text describes the body it fits ("fits bust up to 110 cm"), not the garment. */
  fitsBody: boolean;
  evidence: string;
}

const POINT_WORDS: ReadonlyArray<[DescriptionPoint, RegExp]> = [
  ['bust', /\b(?:bust|chest|pit[- ]to[- ]pit|armpit[- ]to[- ]armpit|underarm)\b/i],
  ['waist', /\bwaist(?:band)?\b/i],
  ['hip', /\bhips?\b/i],
  ['length', /\blength\b/i],
];

/** `<number> <unit>`, with a range ("110-120cm") read as its midpoint. Units: cm, mm, inches, in, ". */
const VALUE = /(\d{1,3}(?:[.,]\d)?)(?:\s*(?:-|–|to)\s*(\d{1,3}(?:[.,]\d)?))?\s*(cm|mm|centimet(?:er|re)s?|inch(?:es)?|in\b|")/gi;

function num(s: string): number {
  return Number(s.replace(',', '.'));
}

/**
 * Every bust/waist/hip/length measurement in the text. A clause is the text between a point word
 * and the next point word (or the end of the sentence), so "Bust 120cm, Length 95cm" gives two values. Flat cues ("laid flat",
 * "pit to pit", "across") double bust/waist/hip; "fits … up to" marks the body it fits.
 */
export function parseDescriptionMeasurements(text: string): DescriptionMeasurement[] {
  const out: DescriptionMeasurement[] = [];
  const seen = new Set<DescriptionPoint>();
  // Split into clauses at each point word, keeping the word with its clause.
  const marker = /\b(bust|chest|pit[- ]to[- ]pit|armpit[- ]to[- ]armpit|underarm|waist(?:band)?|hips?|length)\b/gi;
  const starts: number[] = [];
  for (let m = marker.exec(text); m; m = marker.exec(text)) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    let clause = text.slice(starts[i], starts[i + 1] ?? text.length);
    // A clause runs to the end of its sentence.
    clause = clause.split(/(?<=[.;!?])\s|\n/)[0]!;
    const point = POINT_WORDS.find(([, re]) => re.test(clause.slice(0, 24)))?.[0];
    if (!point || seen.has(point)) continue;
    VALUE.lastIndex = 0;
    const v = VALUE.exec(clause);
    if (!v) continue;
    let value = v[2] ? (num(v[1]!) + num(v[2])) / 2 : num(v[1]!);
    const unit = v[3]!.toLowerCase();
    if (unit === 'mm') value /= 10;
    else if (unit !== 'cm' && !unit.startsWith('centimet')) value *= CM_PER_INCH;
    // Up to 40 characters before the point word count ("Laid flat, pit to pit 55 cm"), but never
    // past an earlier measurement, whose cue belongs to that measurement.
    const before = text.slice(Math.max(0, starts[i]! - 40), starts[i]).replace(/^[\s\S]*\d\s*(?:cm|mm|inch(?:es)?|in\b|")?/i, '');
    const context = (before + clause).toLowerCase();
    const flatCue = /laid flat|lying flat|\bflat\b|pit[- ]to[- ]pit|armpit[- ]to[- ]armpit|\bacross\b|side to side/.test(context);
    const roundCue = /circumference|circumfrence|all round|all around|\baround\b|\bround\b/.test(context);
    const fitsBody = /\bfits?\b|\bsuits?\b|\bup to\b/.test(context) && point !== 'length';
    const doubled = point !== 'length' && flatCue && !roundCue;
    if (doubled) value *= 2;
    if (point === 'length' && (value < 20 || value > 200)) continue;
    if (point !== 'length' && (value < 40 || value > 260)) continue;
    seen.add(point);
    out.push({ point, cm: roundHalfCm(value), doubled, fitsBody, evidence: clause.trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fabric
// ---------------------------------------------------------------------------

const FIBRE_WORD = /\b(rayon|viscose|cotton|linen|polyester|nylon|acrylic|wool|silk|elastane|spandex|lycra|lyocell|tencel|modal|hemp|bamboo|cashmere|denim|jersey|chiffon|satin|crepe|velvet|knit)\b/i;
/** Styling advice that names fabrics without describing this garment. */
const STYLING = /\b(pair(?:ed)?|style|team|wear it|layer|goes with|with your|over (?:a|your))\b/i;

/** The sentence that states the fabric: a "Fabric:"/"Material:" label, a % composition, "made from", then any sentence naming a fibre. */
export function fabricStatement(lines: readonly string[]): string | undefined {
  const all = sentences(lines);
  const label = all.map((s) => /\b(?:fabric|material|composition)s?\s*:\s*(.+)$/i.exec(s)?.[1]).find((s) => s && FIBRE_WORD.test(s));
  if (label) return label.trim();
  const tiers: Array<(s: string) => boolean> = [
    (s) => /\d\s*%\s*[a-z]/i.test(s) && FIBRE_WORD.test(s),
    (s) => /\b(crafted|made|cut|woven|knitted)\s+(?:in|from|of)\b/i.test(s) && FIBRE_WORD.test(s),
    (s) => FIBRE_WORD.test(s),
  ];
  for (const ok of tiers) {
    const hit = all.find((s) => ok(s) && !STYLING.test(s));
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// One size
// ---------------------------------------------------------------------------

const SIZE_OPTION = /^(size|sizes|maat|taille|größe|grösse|groesse)$/i;
const ONE_SIZE_LABEL = /^(one[\s-]?size(?:\s+fits\s+(?:all|most))?|os|o\/s|free[\s-]?size|osfa|osfm|universal)$/i;

export interface ProductOptionsInput {
  options?: ReadonlyArray<{ name: string; optionValues?: ReadonlyArray<{ name: string }> | null; values?: ReadonlyArray<string> | null }> | null;
  variants?: { nodes?: ReadonlyArray<{ selectedOptions?: ReadonlyArray<{ name: string; value: string }> }> } | null;
}

/**
 * Is the product sold in one size? True when the size option has a single one-size value, or when
 * there is no size option at all (a single default variant). Returns the label the chart row uses.
 */
export function oneSizeLabel(p: ProductOptionsInput): { oneSize: boolean; label: string | null } {
  const opts = p.options ?? [];
  const size = opts.find((o) => SIZE_OPTION.test(o.name.trim()));
  if (size) {
    const values = (size.optionValues?.map((v) => v.name) ?? size.values ?? []).map((v) => v.trim()).filter(Boolean);
    if (values.length === 1) return { oneSize: true, label: ONE_SIZE_LABEL.test(values[0]!) ? 'ONE' : values[0]!.slice(0, 16) };
    return { oneSize: false, label: null };
  }
  const variants = p.variants?.nodes ?? [];
  const sizeValues = new Set(variants.flatMap((v) => (v.selectedOptions ?? []).filter((o) => SIZE_OPTION.test(o.name)).map((o) => o.value)));
  if (sizeValues.size > 1) return { oneSize: false, label: null };
  const onlyDefault = opts.length === 0 || opts.every((o) => o.name === 'Title');
  return onlyDefault ? { oneSize: true, label: 'ONE' } : { oneSize: false, label: null };
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

export interface DescriptionImportInput extends ProductOptionsInput {
  title: string;
  descriptionHtml?: string | null;
}

export interface DescriptionImportProposal {
  oneSize: boolean;
  sizeLabel: string | null;
  proposal: { sizeChartType: 'body' | 'garment'; sizeChart: SizeRow[] } | null;
  lengthCm?: LengthCm;
  fabric?: Fabric;
  fabricStatement?: string;
  evidence: string[];
  warnings: string[];
}

/**
 * The chart and fabric the description supports. A chart is proposed only for one-size products
 * (a multi-size product prints one set of numbers for which size?); the fabric is proposed either way.
 */
export function proposeFromDescription(p: DescriptionImportInput): DescriptionImportProposal {
  const lines = descriptionLines(p.descriptionHtml);
  const text = lines.join('\n');
  const { oneSize, label } = oneSizeLabel(p);
  const out: DescriptionImportProposal = { oneSize, sizeLabel: label, proposal: null, evidence: [], warnings: [] };

  const statement = fabricStatement(lines);
  if (statement) {
    const resolved = fabricFromText(statement);
    if (resolved) {
      out.fabric = resolvedFabricToPayload(resolved);
      out.fabricStatement = statement;
      out.evidence.push(`fabric: “${statement}”`);
      if (resolved.unknown.length) out.warnings.push(`Fabric words not in the library: ${resolved.unknown.join(', ')}.`);
    }
  }

  const measured = parseDescriptionMeasurements(text);
  const girths = measured.filter((m) => m.point !== 'length');
  const length = measured.find((m) => m.point === 'length');
  for (const m of measured) out.evidence.push(`${m.point}: “${m.evidence}” → ${m.cm} cm${m.doubled ? ' (flat width × 2)' : ''}`);

  if (!oneSize) {
    if (girths.length) out.warnings.push('The product has several sizes, so one set of description measurements cannot be a chart. Pick a template or enter a garment chart per size.');
    return out;
  }
  if (!girths.length) {
    out.warnings.push('No bust, waist or hip measurement found in the description. Enter the garment measurements by hand.');
    if (length) out.lengthCm = { shoulder_to_hem: length.cm };
    return out;
  }
  const row: SizeRow = { size: label ?? 'ONE' };
  for (const m of girths) row[m.point as 'bust' | 'waist' | 'hip'] = m.cm;
  const body = girths.every((m) => m.fitsBody);
  if (girths.some((m) => m.fitsBody) && !body) out.warnings.push('Some numbers describe the body it fits and some the garment; check the chart type.');
  out.proposal = { sizeChartType: body ? 'body' : 'garment', sizeChart: [row] };
  if (body) out.warnings.push('The description says what body the piece fits (“fits up to …”), so this is proposed as a body chart.');
  if (length) out.lengthCm = { shoulder_to_hem: length.cm };
  const check = checkChart(out.proposal);
  out.warnings.push(...check.warnings, ...check.errors);
  return out;
}
