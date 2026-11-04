/**
 * Shared helpers for the platform mappings: lenient coercion of merchant-entered values into the
 * typed GarmentPayload sub-structures. Every helper is total (never throws); invalid input yields
 * `undefined` plus a warning so the caller can surface it in the merchant console.
 */
import { z } from 'zod';
import {
  ColorwaySchema,
  EaseSchema,
  FIT_POINTS,
  FabricSchema,
  GARMENT_CATEGORIES,
  HexColorSchema,
  LengthCmSchema,
  SizeRowSchema,
  StyleTagsSchema,
  type Colorway,
  type Ease,
  type Fabric,
  type FitPoint,
  type GarmentCategory,
  type LengthCm,
  type SizeRow,
  type StyleTags,
} from '../garment';

export interface MappingWarning {
  /** Platform key (metafield key or meta key) that failed. */
  source: string;
  /** Payload path it was meant to populate. */
  path: string;
  message: string;
}

export type WarningSink = MappingWarning[] | ((w: MappingWarning) => void) | undefined;

export function warn(sink: WarningSink, w: MappingWarning): void {
  if (!sink) return;
  if (typeof sink === 'function') sink(w);
  else sink.push(w);
}

/** Parse a value that may be a JSON string, an already-parsed value, or a PHP-serialised scalar list. */
export function parseJsonish(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t === '') return undefined;
  if (/^[[{"]/.test(t) || /^-?\d+(\.\d+)?$/.test(t) || t === 'true' || t === 'false' || t === 'null') {
    try {
      return JSON.parse(t);
    } catch {
      return value;
    }
  }
  return value;
}

export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const t = value.trim().replace(',', '.');
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** `["a","b"]`, `a, b`, `a|b`, or a real array → trimmed string list. */
export function coerceStringList(value: unknown): string[] | undefined {
  const v = parseJsonish(value);
  if (Array.isArray(v)) {
    const out = v.map(coerceString).filter((s): s is string => s !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof v === 'string') {
    const out = v
      .split(/[,|;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return out.length ? out : undefined;
  }
  return undefined;
}

export function coerceHex(value: unknown): string | undefined {
  const s = coerceString(value);
  if (!s) return undefined;
  const withHash = s.startsWith('#') ? s : `#${s}`;
  const parsed = HexColorSchema.safeParse(withHash);
  if (!parsed.success) return undefined;
  const h = parsed.data;
  // Expand #RGB to #RRGGBB and upper-case for stable content hashes.
  if (h.length === 4) {
    const [r, g, b] = [h[1]!, h[2]!, h[3]!];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return h.toUpperCase();
}

export function coerceUrl(value: unknown): string | undefined {
  const s = coerceString(value);
  if (!s) return undefined;
  return z.url({ protocol: /^https?$/ }).safeParse(s).success ? s : undefined;
}

export function coerceUrlList(value: unknown): string[] | undefined {
  const list = coerceStringList(value);
  if (!list) return undefined;
  const urls = list.map(coerceUrl).filter((u): u is string => u !== undefined);
  return urls.length ? urls : undefined;
}

function validated<T>(schema: z.ZodType<T, unknown>, value: unknown, sink: WarningSink, source: string, path: string): T | undefined {
  if (value === undefined || value === null) return undefined;
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  warn(sink, {
    source,
    path,
    message: first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid value',
  });
  return undefined;
}

/** Size chart: JSON array of rows, or an object keyed by size label `{ "S": { bust: 88 } }`. */
export function coerceSizeChart(value: unknown, sink: WarningSink, source: string): SizeRow[] | undefined {
  let v = parseJsonish(value);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    v = Object.entries(v as Record<string, unknown>).map(([size, row]) =>
      row && typeof row === 'object' ? { size, ...(row as Record<string, unknown>) } : { size },
    );
  }
  if (!Array.isArray(v)) {
    if (v !== undefined) warn(sink, { source, path: 'sizeChart', message: 'expected a JSON array of size rows' });
    return undefined;
  }
  const rows = v.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const r = row as Record<string, unknown>;
    const out: Record<string, unknown> = { size: coerceString(r.size ?? r.label ?? r.name) };
    for (const p of [...FIT_POINTS.filter((x) => x !== 'foot'), 'footEu', 'footLengthCm'] as const) {
      const n = coerceNumber(r[p]);
      if (n !== undefined) out[p] = n;
    }
    // Common merchant aliases.
    if (out.bust === undefined) {
      const chest = coerceNumber(r.chest);
      if (chest !== undefined) out.bust = chest;
    }
    if (out.hip === undefined) {
      const hips = coerceNumber(r.hips);
      if (hips !== undefined) out.hip = hips;
    }
    if (out.footEu === undefined) {
      const eu = coerceNumber(r.eu);
      if (eu !== undefined) out.footEu = eu;
    }
    return out;
  });
  const parsed = validated(z.array(SizeRowSchema).min(1), rows, sink, source, 'sizeChart');
  return parsed;
}

export function coerceFabric(value: unknown, sink: WarningSink, source: string): Partial<Fabric> | undefined {
  const v = parseJsonish(value);
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    if (v !== undefined) warn(sink, { source, path: 'fabric', message: 'expected a JSON object' });
    return undefined;
  }
  const r = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const primary = coerceString(r.primary ?? r.fibre ?? r.fiber ?? r.material);
  if (primary) out.primary = primary.toLowerCase();
  for (const k of ['weightGsm', 'stretchPct', 'drape', 'opacity', 'sheen'] as const) {
    if (r[k] === undefined || r[k] === null || r[k] === '') continue;
    const n = coerceNumber(r[k]);
    if (n !== undefined) out[k] = n;
    else warn(sink, { source, path: `fabric.${k}`, message: `expected a number, got ${JSON.stringify(r[k])}` });
  }
  const gsm = coerceNumber(r.gsm ?? r.weight_gsm);
  if (out.weightGsm === undefined && gsm !== undefined) out.weightGsm = gsm;
  const stretch = coerceNumber(r.stretch ?? r.stretch_pct);
  if (out.stretchPct === undefined && stretch !== undefined) out.stretchPct = stretch;
  if (Array.isArray(r.blend)) {
    const blend = r.blend
      .map((b) => {
        if (Array.isArray(b) && b.length >= 2) return [coerceString(b[0]), coerceNumber(b[1])];
        if (b && typeof b === 'object') {
          const o = b as Record<string, unknown>;
          return [coerceString(o.fibre ?? o.fiber ?? o.name), coerceNumber(o.pct ?? o.percent ?? o.share)];
        }
        return [undefined, undefined];
      })
      .filter((t): t is [string, number] => typeof t[0] === 'string' && typeof t[1] === 'number');
    if (blend.length) out.blend = blend;
  }
  return validated(FabricSchema.partial(), out, sink, source, 'fabric');
}

export function coerceEase(value: unknown, sink: WarningSink, source: string): Ease | undefined {
  const v = parseJsonish(value);
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    if (v !== undefined) warn(sink, { source, path: 'ease', message: 'expected a JSON object keyed by fit point' });
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const key = k === 'hips' ? 'hip' : k === 'chest' ? 'bust' : k;
    if (!(FIT_POINTS as readonly string[]).includes(key)) continue;
    const n = coerceNumber(raw);
    if (n !== undefined) out[key] = n;
  }
  return validated(EaseSchema, out, sink, source, 'ease');
}

export function coerceLengthCm(value: unknown, sink: WarningSink, source: string): LengthCm | undefined {
  const v = parseJsonish(value);
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    if (v !== undefined) warn(sink, { source, path: 'lengthCm', message: 'expected a JSON object keyed by length name' });
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = coerceNumber(raw);
    if (n !== undefined) out[k.trim().toLowerCase().replace(/[\s-]+/g, '_')] = n;
  }
  return validated(LengthCmSchema, out, sink, source, 'lengthCm');
}

export function coerceStyleTags(value: unknown, sink: WarningSink, source: string): StyleTags | undefined {
  const v = parseJsonish(value);
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    if (v !== undefined) warn(sink, { source, path: 'styleTags', message: 'expected a JSON object keyed by taste axis' });
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const key = k === 'avant-garde' || k === 'avantgarde' ? 'avantGarde' : k;
    const n = coerceNumber(raw);
    if (n !== undefined) out[key] = Math.max(0, Math.min(1, n));
  }
  return validated(StyleTagsSchema, out, sink, source, 'styleTags');
}

export function coerceColorways(value: unknown, sink: WarningSink, source: string): Colorway[] | undefined {
  const v = parseJsonish(value);
  if (!Array.isArray(v)) {
    if (v !== undefined) warn(sink, { source, path: 'colorways', message: 'expected a JSON array of colorways' });
    return undefined;
  }
  const rows = v.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const r = c as Record<string, unknown>;
    const out: Record<string, unknown> = { name: coerceString(r.name ?? r.label), hex: coerceHex(r.hex ?? r.color ?? r.colour) };
    const sku = coerceString(r.sku);
    if (sku) out.sku = sku;
    const photos = coerceUrlList(r.productPhotos ?? r.photos ?? r.images);
    if (photos) out.productPhotos = photos;
    const flat = coerceUrl(r.flatLayPhoto ?? r.flat_lay);
    if (flat) out.flatLayPhoto = flat;
    return out;
  });
  return validated(z.array(ColorwaySchema).min(1), rows, sink, source, 'colorways');
}

export function coerceFitPoints(value: unknown): FitPoint[] | undefined {
  const list = coerceStringList(value);
  if (!list) return undefined;
  const out = list
    .map((s) => s.toLowerCase())
    .map((s) => (s === 'hips' ? 'hip' : s === 'chest' ? 'bust' : s === 'shoulders' ? 'shoulder' : s))
    .filter((s): s is FitPoint => (FIT_POINTS as readonly string[]).includes(s));
  return out.length ? Array.from(new Set(out)) : undefined;
}

export function coerceUnit(value: unknown): number | undefined {
  const n = coerceNumber(value);
  if (n === undefined) return undefined;
  // Accept percentages ("92" or "92%") for 0..1 fields.
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return scaled >= 0 && scaled <= 1 ? scaled : undefined;
}

/** Keyword table for inferring the category from a product type / taxonomy path / category name. */
const CATEGORY_KEYWORDS: ReadonlyArray<[GarmentCategory, RegExp]> = [
  ['shoes', /\b(shoes?|sneakers?|boots?|heels?|sandals?|loafers?|footwear|trainers?|pumps?|mules?|schoenen|laarzen)\b/i],
  ['outerwear', /\b(coats?|jackets?|blazers?|outerwear|parkas?|trench|puffer|anoraks?|gilets?|overcoat|jas|jassen|mantel)\b/i],
  ['dress', /\b(dress(es)?|gowns?|jumpsuits?|rompers?|playsuits?|jurk(en)?)\b/i],
  ['bottom', /\b(pants|trousers?|jeans|skirts?|shorts|leggings?|chinos?|culottes?|joggers?|bottoms?|broek(en)?|rok(ken)?)\b/i],
  ['top', /\b(tops?|shirts?|t-shirts?|tees?|blouses?|sweaters?|knitwear|cardigans?|hoodies?|sweatshirts?|tanks?|camis?|bodysuits?|polos?|jumpers?|pullovers?|vests?|trui(en)?|bloes)\b/i],
  ['accessory', /\b(accessor(y|ies)|belts?|bags?|hats?|caps?|scarves|scarf|gloves?|jewell?ery|sunglasses|socks|tights|wallets?|riem(en)?|tas(sen)?|sjaal)\b/i],
];

export function inferCategory(...hints: Array<string | undefined | null>): GarmentCategory | undefined {
  for (const hint of hints) {
    if (!hint) continue;
    const h = hint.trim().toLowerCase();
    if ((GARMENT_CATEGORIES as readonly string[]).includes(h)) return h as GarmentCategory;
    // Taxonomy paths: match the most specific (last) segment first.
    const segments = h.split(/\s*[>/]\s*/).reverse();
    for (const seg of segments) {
      for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(seg)) return cat;
    }
  }
  return undefined;
}

/** Remove undefined-valued keys so partial payloads hash and compare cleanly. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}
