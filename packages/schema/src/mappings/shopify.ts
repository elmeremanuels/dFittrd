/**
 * Shopify ↔ GarmentPayload mapping (docs/DECISIONS.md D6).
 *
 * Metafields live in the app-reserved namespace `$app:paskamer` so the shop stays the source
 * of truth. `SHOPIFY_METAFIELD_DEFINITIONS` is what the app creates on install
 * (`metafieldDefinitionCreate`), `fromShopifyProduct` normalises a GraphQL `Product` node plus
 * its metafields into a (partial) payload, and `toShopifyMetafields` builds the
 * `metafieldsSet` input for writing a payload back.
 */
import { z } from 'zod';
import { GARMENT_SCHEMA_VERSION, type GarmentCategory, type GarmentPayload } from '../garment';
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
  warn,
  type MappingWarning,
  type WarningSink,
} from './common';

export const SHOPIFY_METAFIELD_NAMESPACE = '$app:paskamer' as const;

export const SHOPIFY_METAFIELD_TYPES = [
  'single_line_text_field',
  'multi_line_text_field',
  'json',
  'number_decimal',
  'number_integer',
  'url',
  'color',
  'boolean',
  'list.single_line_text_field',
  'list.url',
] as const;
export type ShopifyMetafieldType = (typeof SHOPIFY_METAFIELD_TYPES)[number];

export type ShopifyMetafieldPath =
  | 'category'
  | 'subcategory'
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
  | 'colorways'
  | 'brand';

export interface ShopifyMetafieldDefinition {
  key: string;
  name: string;
  type: ShopifyMetafieldType;
  /** GarmentPayload path this metafield populates. */
  path: ShopifyMetafieldPath;
  description: string;
  /** Shown in the admin UI as required; enforced by completenessScore, not by Shopify. */
  heavy: boolean;
  /** Pin to the product page in admin (`pin: true` on the definition). */
  pin: boolean;
}

/** Definitions created on install. `ownerType: PRODUCT`, `access: { admin: MERCHANT_READ_WRITE, storefront: PUBLIC_READ }`. */
export const SHOPIFY_METAFIELD_DEFINITIONS: readonly ShopifyMetafieldDefinition[] = [
  {
    key: 'size_chart_type',
    name: 'Size chart type',
    type: 'single_line_text_field',
    path: 'sizeChartType',
    description: "'garment' = rows measured on the flat garment, 'body' = rows are the body each size is cut for.",
    heavy: true,
    pin: true,
  },
  {
    key: 'size_chart',
    name: 'Size chart (cm)',
    type: 'json',
    path: 'sizeChart',
    description: 'JSON array of rows: [{"size":"S","bust":88,"waist":68,"hip":96,"shoulder":37}]',
    heavy: true,
    pin: true,
  },
  {
    key: 'fabric',
    name: 'Fabric',
    type: 'json',
    path: 'fabric',
    description: 'JSON: {"primary":"linen","blend":[["linen",100]],"weightGsm":240,"stretchPct":2,"drape":0.78,"opacity":0.92,"sheen":0.15}',
    heavy: true,
    pin: true,
  },
  {
    key: 'flat_lay_photo',
    name: 'Flat-lay photo',
    type: 'url',
    path: 'flatLayPhoto',
    description: 'Garment laid flat on white. Input of the on-device render.',
    heavy: true,
    pin: true,
  },
  {
    key: 'category',
    name: 'Paskamer category',
    type: 'single_line_text_field',
    path: 'category',
    description: 'top | bottom | dress | outerwear | shoes | accessory. Inferred from product type when empty.',
    heavy: true,
    pin: true,
  },
  {
    key: 'pattern_block',
    name: 'Pattern block',
    type: 'single_line_text_field',
    path: 'patternBlock',
    description: 'wrap, a-line, sheath, bodycon, column, empire, bias, shirt, t-shirt, straight, wide-leg, skinny, slim, …',
    heavy: false,
    pin: true,
  },
  {
    key: 'ease',
    name: 'Designed ease (cm)',
    type: 'json',
    path: 'ease',
    description: 'Garment minus body per fit point: {"bust":6,"waist":4,"hip":8}',
    heavy: false,
    pin: true,
  },
  {
    key: 'length_cm',
    name: 'Lengths (cm)',
    type: 'json',
    path: 'lengthCm',
    description: '{"shoulder_to_hem":118,"shoulder_to_waist":41,"sleeve_length":0}',
    heavy: false,
    pin: true,
  },
  {
    key: 'sizing_notes',
    name: 'Sizing notes',
    type: 'multi_line_text_field',
    path: 'sizingNotes',
    description: "Freeform, e.g. 'runs small'. Parsed for a size bias.",
    heavy: false,
    pin: true,
  },
  {
    key: 'true_to_size_score',
    name: 'True-to-size score',
    type: 'number_decimal',
    path: 'trueToSizeScore',
    description: '0..1 from past return data.',
    heavy: false,
    pin: false,
  },
  {
    key: 'critical_fit_points',
    name: 'Critical fit points',
    type: 'list.single_line_text_field',
    path: 'criticalFitPoints',
    description: 'bust, waist, hip, shoulder, thigh, inseam, foot',
    heavy: false,
    pin: true,
  },
  {
    key: 'stretch_zones',
    name: 'Stretch zones',
    type: 'list.single_line_text_field',
    path: 'stretchZones',
    description: 'waist-tie, waistband, side-panel, back-panel, cuff, rib-hem, stretch-knit',
    heavy: false,
    pin: false,
  },
  {
    key: 'style_tags',
    name: 'Style tags',
    type: 'json',
    path: 'styleTags',
    description: '0..1 per axis: {"bohemian":0.9,"classic":0.3}',
    heavy: false,
    pin: false,
  },
  {
    key: 'primary_color_hex',
    name: 'Primary colour',
    type: 'color',
    path: 'primaryColorHex',
    description: '#RRGGBB. Falls back to the first colorway.',
    heavy: false,
    pin: false,
  },
  {
    key: 'colorways',
    name: 'Colorways',
    type: 'json',
    path: 'colorways',
    description: '[{"name":"Terracotta","hex":"#C97A4F","sku":"…","productPhotos":["https://…"]}]',
    heavy: false,
    pin: false,
  },
  {
    key: 'subcategory',
    name: 'Subcategory',
    type: 'single_line_text_field',
    path: 'subcategory',
    description: 'e.g. wrap-midi, slip, straight',
    heavy: false,
    pin: false,
  },
  {
    key: 'brand',
    name: 'Brand override',
    type: 'single_line_text_field',
    path: 'brand',
    description: 'Defaults to the product vendor.',
    heavy: false,
    pin: false,
  },
];

export const SHOPIFY_METAFIELD_BY_KEY: Readonly<Record<string, ShopifyMetafieldDefinition>> = Object.fromEntries(
  SHOPIFY_METAFIELD_DEFINITIONS.map((d) => [d.key, d]),
);

// ---------------------------------------------------------------------------
// Input shapes (subset of the Admin GraphQL Product node, tolerant of nodes/edges)
// ---------------------------------------------------------------------------

const ShopifyMetafieldSchema = z.object({
  namespace: z.string().optional(),
  key: z.string(),
  type: z.string().optional(),
  value: z.string().nullable().optional(),
  jsonValue: z.unknown().optional(),
});
export type ShopifyMetafield = z.infer<typeof ShopifyMetafieldSchema>;

const connection = <T extends z.ZodTypeAny>(node: T) =>
  z
    .object({
      nodes: z.array(node).optional(),
      edges: z.array(z.object({ node })).optional(),
    })
    .optional()
    .nullable();

const ImageNode = z.object({ url: z.string().optional(), src: z.string().optional(), originalSrc: z.string().optional() });
const MoneyNode = z.object({ amount: z.union([z.string(), z.number()]), currencyCode: z.string() });

export const ShopifyProductNodeSchema = z.object({
  id: z.string(),
  handle: z.string().optional().nullable(),
  title: z.string(),
  vendor: z.string().optional().nullable(),
  productType: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  onlineStoreUrl: z.string().optional().nullable(),
  category: z.object({ name: z.string().optional().nullable(), fullName: z.string().optional().nullable() }).optional().nullable(),
  featuredImage: ImageNode.optional().nullable(),
  images: connection(ImageNode),
  media: connection(z.object({ image: ImageNode.optional().nullable() })),
  priceRangeV2: z.object({ minVariantPrice: MoneyNode }).optional().nullable(),
  priceRange: z.object({ minVariantPrice: MoneyNode }).optional().nullable(),
  variants: connection(
    z.object({
      price: z.union([z.string(), z.number()]).optional().nullable(),
      selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    }),
  ),
  metafields: connection(ShopifyMetafieldSchema),
});
export type ShopifyProductNode = z.input<typeof ShopifyProductNodeSchema>;

export type ShopifyMetafieldsInput = ReadonlyArray<ShopifyMetafield> | Readonly<Record<string, unknown>>;

/** `gid://shopify/Product/123` → `123` (the shop-scoped external id we store). */
export function shopifyExternalId(gid: string): string {
  const m = /\/Product\/(\d+)(?:\?.*)?$/.exec(gid);
  return m ? m[1]! : gid;
}

function nodesOf<T>(c: { nodes?: T[] | undefined; edges?: { node: T }[] | undefined } | null | undefined): T[] {
  if (!c) return [];
  if (c.nodes) return c.nodes;
  if (c.edges) return c.edges.map((e) => e.node);
  return [];
}

/** Flatten metafields (array or record) into key → raw value, filtering to our namespace. */
export function indexShopifyMetafields(input: ShopifyMetafieldsInput | undefined): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!input) return out;
  if (Array.isArray(input)) {
    for (const raw of input as ReadonlyArray<unknown>) {
      const mf = ShopifyMetafieldSchema.safeParse(raw);
      if (!mf.success) continue;
      const { namespace, key, value, jsonValue } = mf.data;
      if (namespace && namespace !== SHOPIFY_METAFIELD_NAMESPACE && namespace !== 'paskamer') continue;
      const k = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
      out.set(k, jsonValue !== undefined ? jsonValue : value);
    }
  } else {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const k = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
      out.set(k, value);
    }
  }
  return out;
}

export interface FromShopifyOptions {
  /** Collects mapping warnings (invalid JSON, unknown category, non-EUR price…). */
  warnings?: WarningSink;
  /** Fallback brand when the product has no vendor and no brand metafield (usually the shop name). */
  defaultBrand?: string;
}

/**
 * Normalise a Shopify product + metafields into a partial GarmentPayload. Identity fields
 * (id, name, brand) come from the product node; everything else from `$app:paskamer` metafields.
 * The result is a draft: pass it to `completenessScore` / `GarmentPayloadSchema.safeParse`.
 */
export function fromShopifyProduct(
  productNode: ShopifyProductNode,
  metafields?: ShopifyMetafieldsInput,
  options: FromShopifyOptions = {},
): Partial<GarmentPayload> {
  const sink = options.warnings;
  const parsed = ShopifyProductNodeSchema.safeParse(productNode);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    warn(sink, { source: 'product', path: '(root)', message: first ? `${first.path.join('.')}: ${first.message}` : 'invalid product node' });
    return {};
  }
  const p = parsed.data;
  const mf = indexShopifyMetafields(metafields ?? nodesOf(p.metafields));
  const get = (key: string) => mf.get(key);

  const out: Partial<GarmentPayload> = { schemaVersion: GARMENT_SCHEMA_VERSION };
  out.id = shopifyExternalId(p.id);
  out.name = p.title.trim();
  const brand = coerceString(get('brand')) ?? coerceString(p.vendor) ?? options.defaultBrand;
  if (brand) out.brand = brand;

  const explicitCategory = coerceString(get('category'));
  const category: GarmentCategory | undefined = inferCategory(
    explicitCategory,
    p.productType ?? undefined,
    p.category?.fullName ?? undefined,
    p.category?.name ?? undefined,
    p.title,
  );
  if (category) out.category = category;
  else if (explicitCategory) warn(sink, { source: 'category', path: 'category', message: `unknown category '${explicitCategory}'` });

  const subcategory = coerceString(get('subcategory'));
  if (subcategory) out.subcategory = subcategory;

  // Price — only EUR is accepted; other currencies are reported, not converted.
  const money = p.priceRangeV2?.minVariantPrice ?? p.priceRange?.minVariantPrice;
  if (money) {
    const amount = coerceNumber(money.amount);
    if (amount !== undefined && money.currencyCode.toUpperCase() === 'EUR') out.priceEur = amount;
    else if (amount !== undefined) warn(sink, { source: 'priceRangeV2', path: 'priceEur', message: `price is in ${money.currencyCode}, not EUR` });
  } else {
    const first = nodesOf(p.variants)[0];
    const amount = coerceNumber(first?.price);
    if (amount !== undefined) out.priceEur = amount;
  }

  const url = coerceUrl(p.onlineStoreUrl);
  if (url) out.productUrl = url;

  // Photos: explicit metafield list → product images → featured image.
  const images = [
    ...nodesOf(p.images).map((i) => i.url ?? i.src ?? i.originalSrc),
    ...nodesOf(p.media).map((m) => m.image?.url ?? m.image?.src),
  ]
    .map(coerceUrl)
    .filter((u): u is string => u !== undefined);
  const featured = coerceUrl(p.featuredImage?.url ?? p.featuredImage?.src);
  const photos = Array.from(new Set([...(featured ? [featured] : []), ...images]));
  if (photos.length) out.productPhotos = photos.slice(0, 20);

  const flat = coerceUrl(get('flat_lay_photo'));
  if (flat) out.flatLayPhoto = flat;
  else if (get('flat_lay_photo') !== undefined) warn(sink, { source: 'flat_lay_photo', path: 'flatLayPhoto', message: 'not an absolute http(s) URL' });

  const sizeChartType = coerceString(get('size_chart_type'))?.toLowerCase();
  if (sizeChartType === 'garment' || sizeChartType === 'body') out.sizeChartType = sizeChartType;
  else if (sizeChartType) warn(sink, { source: 'size_chart_type', path: 'sizeChartType', message: "expected 'garment' or 'body'" });

  const sizeChart = coerceSizeChart(get('size_chart'), sink, 'size_chart');
  if (sizeChart) out.sizeChart = sizeChart;

  const fabric = coerceFabric(get('fabric'), sink, 'fabric');
  if (fabric) out.fabric = fabric as GarmentPayload['fabric'];

  const block = coerceString(get('pattern_block'));
  if (block) out.patternBlock = block.toLowerCase();

  const ease = coerceEase(get('ease'), sink, 'ease');
  if (ease) out.ease = ease;
  const lengthCm = coerceLengthCm(get('length_cm'), sink, 'length_cm');
  if (lengthCm) out.lengthCm = lengthCm;

  const notes = coerceString(get('sizing_notes'));
  if (notes) out.sizingNotes = notes.slice(0, 500);

  const tts = coerceUnit(get('true_to_size_score'));
  if (tts !== undefined) out.trueToSizeScore = tts;
  else if (get('true_to_size_score') !== undefined) warn(sink, { source: 'true_to_size_score', path: 'trueToSizeScore', message: 'expected 0..1' });

  const critical = coerceFitPoints(get('critical_fit_points'));
  if (critical) out.criticalFitPoints = critical;
  const zones = coerceStringList(get('stretch_zones'));
  if (zones) out.stretchZones = zones.map((z) => z.toLowerCase());
  const styleTags = coerceStyleTags(get('style_tags'), sink, 'style_tags');
  if (styleTags) out.styleTags = styleTags;

  const colorways = coerceColorways(get('colorways'), sink, 'colorways');
  if (colorways) out.colorways = colorways;
  const hex = coerceHex(get('primary_color_hex')) ?? colorways?.[0]?.hex;
  if (hex) out.primaryColorHex = hex;

  return compact(out);
}

// ---------------------------------------------------------------------------
// Writing back
// ---------------------------------------------------------------------------

export interface ShopifyMetafieldSetInput {
  ownerId: string;
  namespace: typeof SHOPIFY_METAFIELD_NAMESPACE;
  key: string;
  type: ShopifyMetafieldType;
  value: string;
}

/** Build `metafieldsSet` inputs for every mapped field present on the payload. */
export function toShopifyMetafields(payload: Partial<GarmentPayload>, ownerId: string): ShopifyMetafieldSetInput[] {
  const out: ShopifyMetafieldSetInput[] = [];
  for (const def of SHOPIFY_METAFIELD_DEFINITIONS) {
    const value = payload[def.path];
    if (value === undefined || value === null) continue;
    let serialised: string;
    switch (def.type) {
      case 'json':
      case 'list.single_line_text_field':
      case 'list.url':
        serialised = JSON.stringify(value);
        break;
      default:
        serialised = String(value);
    }
    out.push({ ownerId, namespace: SHOPIFY_METAFIELD_NAMESPACE, key: def.key, type: def.type, value: serialised });
  }
  return out;
}

export type { MappingWarning };
