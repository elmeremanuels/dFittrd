/**
 * WooCommerce ↔ GarmentPayload mapping (docs/DECISIONS.md D6).
 *
 * The PHP plugin stores every §3.1 field as post meta under the `_curtain_` prefix (underscore
 * = hidden from the generic custom-fields box) and pushes the normalised payload on save. The
 * backend uses `fromWooMeta` to normalise a REST `product` object (+ its meta) when it reads the
 * plugin's signed fallback endpoint, and the plugin's JSON Schema validation uses the same key
 * list (`WOO_META_KEYS`) to build its meta box.
 */
import { z } from 'zod';
import { GARMENT_SCHEMA_VERSION, type GarmentPayload } from '../garment';
import {
  coerceColorways,
  coerceEase,
  coerceFabric,
  coerceFitPoints,
  coerceHex,
  coerceLengthCm,
  coerceNumber,
  coerceSizeChart,
  coerceString,
  coerceStringList,
  coerceStyleTags,
  coerceUnit,
  coerceUrl,
  compact,
  inferCategory,
  parseJsonish,
  warn,
  type WarningSink,
} from './common';

export const WOO_META_PREFIX = '_curtain_' as const;

export type WooMetaKind = 'string' | 'text' | 'json' | 'number' | 'list' | 'url' | 'color' | 'enum';

export type WooMetaPath =
  | 'category'
  | 'subcategory'
  | 'brand'
  | 'sizeChartType'
  | 'sizeChart'
  | 'fabric'
  | 'patternBlock'
  | 'ease'
  | 'lengthCm'
  | 'sizingNotes'
  | 'trueToSizeScore'
  | 'criticalFitPoints'
  | 'stretchZones'
  | 'styleTags'
  | 'flatLayPhoto'
  | 'primaryColorHex'
  | 'colorways';

export interface WooMetaKey {
  key: `${typeof WOO_META_PREFIX}${string}`;
  path: WooMetaPath;
  kind: WooMetaKind;
  label: string;
  description: string;
  heavy: boolean;
  /** Allowed values for `enum` kinds. */
  options?: readonly string[];
}

/** Meta box fields, in display order. */
export const WOO_META_KEYS: readonly WooMetaKey[] = [
  { key: '_curtain_category', path: 'category', kind: 'enum', label: 'Category', description: 'Inferred from the WooCommerce product categories when empty.', heavy: true, options: ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'] },
  { key: '_curtain_size_chart_type', path: 'sizeChartType', kind: 'enum', label: 'Size chart type', description: "'garment' = rows measured on the flat garment, 'body' = body the size is cut for.", heavy: true, options: ['garment', 'body'] },
  { key: '_curtain_size_chart', path: 'sizeChart', kind: 'json', label: 'Size chart (cm)', description: 'JSON array of rows, ascending.', heavy: true },
  { key: '_curtain_fabric', path: 'fabric', kind: 'json', label: 'Fabric', description: 'primary, blend, weightGsm, stretchPct, drape, opacity, sheen', heavy: true },
  { key: '_curtain_flat_lay_photo', path: 'flatLayPhoto', kind: 'url', label: 'Flat-lay photo', description: 'Media-library image of the garment laid flat on white.', heavy: true },
  { key: '_curtain_pattern_block', path: 'patternBlock', kind: 'string', label: 'Pattern block', description: 'wrap, a-line, sheath, …', heavy: false },
  { key: '_curtain_ease', path: 'ease', kind: 'json', label: 'Designed ease (cm)', description: '{"bust":6,"waist":4,"hip":8}', heavy: false },
  { key: '_curtain_length_cm', path: 'lengthCm', kind: 'json', label: 'Lengths (cm)', description: '{"shoulder_to_hem":118}', heavy: false },
  { key: '_curtain_sizing_notes', path: 'sizingNotes', kind: 'text', label: 'Sizing notes', description: "'runs small', 'true to size', …", heavy: false },
  { key: '_curtain_true_to_size_score', path: 'trueToSizeScore', kind: 'number', label: 'True-to-size score', description: '0..1', heavy: false },
  { key: '_curtain_critical_fit_points', path: 'criticalFitPoints', kind: 'list', label: 'Critical fit points', description: 'bust, waist, hip, shoulder, thigh, inseam, foot', heavy: false },
  { key: '_curtain_stretch_zones', path: 'stretchZones', kind: 'list', label: 'Stretch zones', description: 'waist-tie, waistband, …', heavy: false },
  { key: '_curtain_style_tags', path: 'styleTags', kind: 'json', label: 'Style tags', description: '0..1 per taste axis', heavy: false },
  { key: '_curtain_primary_color_hex', path: 'primaryColorHex', kind: 'color', label: 'Primary colour', description: '#RRGGBB', heavy: false },
  { key: '_curtain_colorways', path: 'colorways', kind: 'json', label: 'Colorways', description: '[{"name":"…","hex":"#…"}]', heavy: false },
  { key: '_curtain_subcategory', path: 'subcategory', kind: 'string', label: 'Subcategory', description: 'e.g. wrap-midi', heavy: false },
  { key: '_curtain_brand', path: 'brand', kind: 'string', label: 'Brand', description: 'Defaults to the Brand attribute / brand taxonomy / shop name.', heavy: false },
];

export const WOO_META_BY_KEY: Readonly<Record<string, WooMetaKey>> = Object.fromEntries(WOO_META_KEYS.map((k) => [k.key, k]));

// ---------------------------------------------------------------------------
// Input shapes (subset of the WC REST API v3 product)
// ---------------------------------------------------------------------------

const WooMetaDataSchema = z.object({ key: z.string(), value: z.unknown() });

export const WooProductSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  slug: z.string().optional(),
  permalink: z.string().optional().nullable(),
  type: z.string().optional(),
  status: z.string().optional(),
  price: z.union([z.string(), z.number()]).optional().nullable(),
  regular_price: z.union([z.string(), z.number()]).optional().nullable(),
  images: z.array(z.object({ src: z.string().optional(), alt: z.string().optional() })).optional(),
  categories: z.array(z.object({ id: z.number().optional(), name: z.string(), slug: z.string().optional() })).optional(),
  brands: z.array(z.object({ id: z.number().optional(), name: z.string(), slug: z.string().optional() })).optional(),
  attributes: z.array(z.object({ name: z.string(), slug: z.string().optional(), options: z.array(z.string()).optional() })).optional(),
  meta_data: z.array(WooMetaDataSchema).optional(),
});
export type WooProduct = z.input<typeof WooProductSchema>;

/** Meta as an array of `{key, value}` (REST meta_data) or a plain `{ _curtain_x: value }` record (get_post_meta). */
export type WooMetaInput = ReadonlyArray<{ key: string; value: unknown }> | Readonly<Record<string, unknown>>;

export function indexWooMeta(input: WooMetaInput | undefined): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!input) return out;
  const entries: Array<[string, unknown]> = Array.isArray(input)
    ? (input as ReadonlyArray<{ key: string; value: unknown }>).map((m) => [m.key, m.value])
    : Object.entries(input as Record<string, unknown>);
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.startsWith(WOO_META_PREFIX) ? rawKey : `${WOO_META_PREFIX}${rawKey}`;
    // get_post_meta(…, false) wraps every stored value (scalars and JSON strings alike) in a
    // one-element array; unwrap that. A real one-element list of strings parses identically.
    const value = Array.isArray(rawValue) && rawValue.length === 1 && typeof rawValue[0] === 'string' ? rawValue[0] : rawValue;
    out.set(key, value);
  }
  return out;
}

export interface FromWooOptions {
  warnings?: WarningSink;
  /** The shop's currency as reported by `GET /wc/v3/settings/general` (`woocommerce_currency`). Default EUR. */
  currency?: string;
  /** Fallback brand (the shop name). */
  defaultBrand?: string;
}

/**
 * Normalise a WooCommerce REST product (+ its `_curtain_*` meta) into a partial GarmentPayload.
 * `meta` may be omitted when the product object carries `meta_data`.
 */
export function fromWooMeta(product: WooProduct, meta?: WooMetaInput, options: FromWooOptions = {}): Partial<GarmentPayload> {
  const sink = options.warnings;
  const parsed = WooProductSchema.safeParse(product);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    warn(sink, { source: 'product', path: '(root)', message: first ? `${first.path.join('.')}: ${first.message}` : 'invalid product' });
    return {};
  }
  const p = parsed.data;
  const mf = indexWooMeta(meta ?? p.meta_data);
  const get = (key: `${typeof WOO_META_PREFIX}${string}`) => mf.get(key);

  const out: Partial<GarmentPayload> = { schemaVersion: GARMENT_SCHEMA_VERSION };
  out.id = String(p.id);
  out.name = p.name.trim();

  const brandAttr = p.attributes?.find((a) => /^(pa_)?brand$/i.test(a.slug ?? '') || /^brand$/i.test(a.name))?.options?.[0];
  const brand = coerceString(get('_curtain_brand')) ?? p.brands?.[0]?.name ?? coerceString(brandAttr) ?? options.defaultBrand;
  if (brand) out.brand = brand;

  const explicitCategory = coerceString(get('_curtain_category'));
  const category = inferCategory(explicitCategory, ...(p.categories ?? []).map((c) => c.name), p.name);
  if (category) out.category = category;
  else if (explicitCategory) warn(sink, { source: '_curtain_category', path: 'category', message: `unknown category '${explicitCategory}'` });

  const subcategory = coerceString(get('_curtain_subcategory'));
  if (subcategory) out.subcategory = subcategory;

  const currency = (options.currency ?? 'EUR').toUpperCase();
  const amount = coerceNumber(p.price) ?? coerceNumber(p.regular_price);
  if (amount !== undefined) {
    if (currency === 'EUR') out.priceEur = amount;
    else warn(sink, { source: 'price', path: 'priceEur', message: `price is in ${currency}, not EUR` });
  }

  const url = coerceUrl(p.permalink);
  if (url) out.productUrl = url;

  const photos = (p.images ?? []).map((i) => coerceUrl(i.src)).filter((u): u is string => u !== undefined);
  if (photos.length) out.productPhotos = Array.from(new Set(photos)).slice(0, 20);

  const flatRaw = get('_curtain_flat_lay_photo');
  // The meta box may store an attachment object `{ id, url }` or just the URL.
  const flatCandidate = typeof flatRaw === 'object' && flatRaw !== null ? (flatRaw as Record<string, unknown>).url ?? (flatRaw as Record<string, unknown>).src : flatRaw;
  const flat = coerceUrl(flatCandidate);
  if (flat) out.flatLayPhoto = flat;
  else if (flatRaw !== undefined && flatRaw !== '') warn(sink, { source: '_curtain_flat_lay_photo', path: 'flatLayPhoto', message: 'not an absolute http(s) URL' });

  const sizeChartType = coerceString(get('_curtain_size_chart_type'))?.toLowerCase();
  if (sizeChartType === 'garment' || sizeChartType === 'body') out.sizeChartType = sizeChartType;
  else if (sizeChartType) warn(sink, { source: '_curtain_size_chart_type', path: 'sizeChartType', message: "expected 'garment' or 'body'" });

  const sizeChart = coerceSizeChart(get('_curtain_size_chart'), sink, '_curtain_size_chart');
  if (sizeChart) out.sizeChart = sizeChart;

  const fabric = coerceFabric(get('_curtain_fabric'), sink, '_curtain_fabric');
  if (fabric) out.fabric = fabric as GarmentPayload['fabric'];

  const block = coerceString(get('_curtain_pattern_block'));
  if (block) out.patternBlock = block.toLowerCase();

  const ease = coerceEase(get('_curtain_ease'), sink, '_curtain_ease');
  if (ease) out.ease = ease;
  const lengthCm = coerceLengthCm(get('_curtain_length_cm'), sink, '_curtain_length_cm');
  if (lengthCm) out.lengthCm = lengthCm;

  const notes = coerceString(get('_curtain_sizing_notes'));
  if (notes) out.sizingNotes = notes.slice(0, 500);

  const ttsRaw = get('_curtain_true_to_size_score');
  const tts = coerceUnit(parseJsonish(ttsRaw));
  if (tts !== undefined) out.trueToSizeScore = tts;
  else if (ttsRaw !== undefined && ttsRaw !== '') warn(sink, { source: '_curtain_true_to_size_score', path: 'trueToSizeScore', message: 'expected 0..1' });

  const critical = coerceFitPoints(get('_curtain_critical_fit_points'));
  if (critical) out.criticalFitPoints = critical;
  const zones = coerceStringList(get('_curtain_stretch_zones'));
  if (zones) out.stretchZones = zones.map((z) => z.toLowerCase());
  const styleTags = coerceStyleTags(get('_curtain_style_tags'), sink, '_curtain_style_tags');
  if (styleTags) out.styleTags = styleTags;

  const colorways = coerceColorways(get('_curtain_colorways'), sink, '_curtain_colorways');
  if (colorways) out.colorways = colorways;
  const hex = coerceHex(get('_curtain_primary_color_hex')) ?? colorways?.[0]?.hex;
  if (hex) out.primaryColorHex = hex;

  return compact(out);
}

/** Serialise a payload into `{ key, value }` meta rows for `update_post_meta` / the REST `meta_data` array. */
export function toWooMeta(payload: Partial<GarmentPayload>): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const def of WOO_META_KEYS) {
    const value = payload[def.path];
    if (value === undefined || value === null) continue;
    const serialised = def.kind === 'json' || def.kind === 'list' ? JSON.stringify(value) : String(value);
    out.push({ key: def.key, value: serialised });
  }
  return out;
}
