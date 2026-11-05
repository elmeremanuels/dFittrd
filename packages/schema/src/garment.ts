/**
 * GarmentPayload v1 — the per-item payload a shop sends to Curtain (handoff §3.1),
 * extended per docs/DECISIONS.md D6/D8 and docs/research/fit-engine-spec.md.
 *
 * This file is the single source of truth for the garment wire type. The fit engine,
 * the taste engine, the merchant plugins (via the exported JSON Schema) and the backend
 * all read this shape.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Handoff §3.1 `category`. */
export const GARMENT_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

/** Fit points read by `@curtain/fit-engine` (fit-engine-spec.md `Point`). */
export const FIT_POINTS = ['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot'] as const;
export type FitPoint = (typeof FIT_POINTS)[number];

/** Taste axes (taste-engine-spec.md `Axis`, fixed radar order). */
export const TASTE_AXES = ['bohemian', 'minimal', 'classic', 'avantGarde', 'sporty'] as const;
export type TasteAxis = (typeof TASTE_AXES)[number];

/**
 * Known fabric primaries: the eight from handoff §3.1 plus the ones the taste engine
 * featurises (jersey, technical, leather) and common blends. Unknown strings are accepted
 * (`string & {}` escape) so a merchant is never blocked by our vocabulary.
 */
export const FABRIC_PRIMARIES = [
  'linen',
  'cotton',
  'wool',
  'silk',
  'cashmere',
  'tencel',
  'modal',
  'denim',
  'jersey',
  'technical',
  'leather',
  'viscose',
  'polyester',
  'nylon',
  'elastane',
] as const;
export type FabricPrimary = (typeof FABRIC_PRIMARIES)[number] | (string & {});

/** Pattern blocks with rules in fit-engine-spec.md §Step 2. Unknown blocks fall back to category defaults. */
export const PATTERN_BLOCKS = [
  'wrap',
  'a-line',
  'fit-and-flare',
  'skater',
  'sheath',
  'bodycon',
  'column',
  'empire',
  'tent',
  'trapeze',
  'oversized',
  'boxy',
  'bias',
  'shirt',
  't-shirt',
  'straight',
  'wide-leg',
  'bootcut',
  'skinny',
  'slim',
] as const;
export type PatternBlock = (typeof PATTERN_BLOCKS)[number] | (string & {});

/** Stretch zones the fit engine maps to points (fit-engine-spec.md §Step 3). */
export const STRETCH_ZONES = [
  'waist-tie',
  'waistband',
  'side-panel',
  'back-panel',
  'cuff',
  'rib-hem',
  'stretch-knit',
] as const;
export type StretchZone = (typeof STRETCH_ZONES)[number] | (string & {});

/** Canonical `lengthCm` keys (handoff §3.1 names three; the rest are what plugins collect). */
export const LENGTH_KEYS = [
  'shoulder_to_hem',
  'shoulder_to_waist',
  'sleeve_length',
  'back_length',
  'inseam',
  'outseam',
  'rise',
  'waist_to_hem',
  'chest_width',
  'heel_height',
  'strap_drop',
] as const;
export type LengthKey = (typeof LENGTH_KEYS)[number];
export type LengthCm = Partial<Record<LengthKey, number>> & Record<string, number>;

export const DRAPE_LEVELS = ['stiff', 'structured', 'soft', 'fluid'] as const;

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

const unit = z.number().min(0).max(1);
const chartCm = z.number().min(0).max(300);

export const HexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'expected #RGB or #RRGGBB')
  .describe('CSS hex colour, #RRGGBB');
export type HexColor = z.infer<typeof HexColorSchema>;

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

export const GarmentCategorySchema = z.enum(GARMENT_CATEGORIES);
export const FitPointSchema = z.enum(FIT_POINTS);
export const TasteAxisSchema = z.enum(TASTE_AXES);

/** Open string with the known values listed as `enum` hints in the JSON Schema. */
function openVocabulary<T extends readonly string[]>(known: T, description: string) {
  return z
    .string()
    .min(1)
    .max(64)
    .meta({ description, examples: [...known] });
}

export const FabricPrimarySchema: z.ZodType<FabricPrimary, string> = openVocabulary(
  FABRIC_PRIMARIES,
  'Primary fibre. Known values drive drape/texture defaults; unknown values are accepted.',
);
export const PatternBlockSchema: z.ZodType<PatternBlock, string> = openVocabulary(
  PATTERN_BLOCKS,
  'Pattern block / silhouette. Known values have fit-engine ease and skip rules; unknown values use category defaults.',
);
export const StretchZoneSchema: z.ZodType<StretchZone, string> = openVocabulary(
  STRETCH_ZONES,
  'Garment zone with extra stretch or adjustability (ties, ribbing, panels).',
);

// ---------------------------------------------------------------------------
// Sub-objects
// ---------------------------------------------------------------------------

export const SizeRowSchema = z
  .object({
    size: z.string().min(1).max(16).describe('Label as the shop prints it: XS, M, 28, 38, ONE'),
    bust: chartCm.optional(),
    waist: chartCm.optional(),
    hip: chartCm.optional(),
    shoulder: chartCm.optional(),
    thigh: chartCm.optional(),
    inseam: chartCm.optional(),
    footEu: z.number().min(15).max(55).optional().describe('EU shoe size, e.g. 38'),
    footLengthCm: z.number().min(8).max(40).optional().describe('Insole / foot length in cm'),
  })
  .describe(
    'One row of the size chart, in cm. Whether the numbers are garment or body measurements is declared by sizeChartType.',
  );
export type SizeRow = z.infer<typeof SizeRowSchema>;

export const FabricSchema = z
  .object({
    primary: FabricPrimarySchema,
    blend: z
      .array(z.tuple([z.string().min(1).max(64), z.number().min(0).max(100)]))
      .max(8)
      .optional()
      .describe('[["linen", 100]] or [["cotton", 98], ["elastane", 2]] — percentages'),
    weightGsm: z.number().positive().max(2000).optional().describe('Fabric weight, g/m²'),
    stretchPct: z.number().min(0).max(100).describe('0 = non-stretch, 30 = jersey'),
    drape: unit.describe('0 = stiff, 1 = fluid'),
    opacity: unit.optional().describe('0 = sheer, 1 = opaque'),
    sheen: unit.optional().describe('0 = matte, 1 = shiny'),
  })
  .describe('Fabric construction (handoff §3.1)');
export type Fabric = z.infer<typeof FabricSchema>;

export const EaseSchema = z
  .partialRecord(FitPointSchema, z.number().min(-20).max(60))
  .describe('Designed ease per fit point: garment minus body, cm. Negative = negative ease (stretch garments).');
export type Ease = z.infer<typeof EaseSchema>;

export const LengthCmSchema: z.ZodType<LengthCm, Record<string, number>> = z
  .record(z.string().min(1).max(64), z.number().min(0).max(400))
  .meta({
    description: 'Measured garment lengths in cm, keyed by point. Canonical keys are listed in examples.',
    examples: [{ shoulder_to_hem: 118, shoulder_to_waist: 41, sleeve_length: 0 }],
  });

export const StyleTagsSchema = z
  .partialRecord(TasteAxisSchema, unit)
  .describe('Merchant style tags, 0..1 per taste axis. When present the taste engine uses them instead of inferring from block + fabric.');
export type StyleTags = z.infer<typeof StyleTagsSchema>;

export const ColorwaySchema = z.object({
  name: z.string().min(1).max(64),
  hex: HexColorSchema,
  sku: z.string().max(64).optional(),
  productPhotos: z.array(httpUrl).max(20).optional(),
  flatLayPhoto: httpUrl.optional(),
});
export type Colorway = z.infer<typeof ColorwaySchema>;

// ---------------------------------------------------------------------------
// GarmentPayload v1
// ---------------------------------------------------------------------------

export const GARMENT_SCHEMA_VERSION = 1 as const;

export const GarmentPayloadSchema = z
  .object({
    schemaVersion: z.literal(GARMENT_SCHEMA_VERSION),

    // Identity
    id: z.string().min(1).max(128).describe('Shop-scoped product id (external id)'),
    brand: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    category: GarmentCategorySchema,
    subcategory: z.string().min(1).max(64).optional().describe('e.g. wrap-midi, slip, straight'),
    priceEur: z.number().min(0).max(1_000_000),
    productUrl: httpUrl.optional().describe('Canonical product page'),

    // Visuals
    primaryColorHex: HexColorSchema,
    colorways: z.array(ColorwaySchema).max(40).optional(),
    productPhotos: z.array(httpUrl).max(20).optional().describe('For colour grading and texture sampling'),
    flatLayPhoto: httpUrl.optional().describe('Garment laid flat on white — the input of the on-device render'),

    // Construction
    fabric: FabricSchema,

    // Pattern / fit
    patternBlock: PatternBlockSchema,
    ease: EaseSchema.optional(),
    lengthCm: LengthCmSchema.optional(),
    sizeChartType: z
      .enum(['garment', 'body'])
      .describe(
        "REQUIRED: 'garment' = the rows are the finished garment measured flat; 'body' = the rows are the body each size is cut for. Fit-engine test T14 shows the same chart yields a different size depending on this.",
      ),
    sizeChart: z.array(SizeRowSchema).min(1).max(30).describe('Ascending size order'),
    sizingNotes: z.string().max(500).optional().describe("Freeform, e.g. 'runs small'; parsed for a size bias"),
    trueToSizeScore: unit.optional().describe('From past return / fit data; default 0.8 in the fit engine'),

    // Fit-engine hints
    criticalFitPoints: z.array(FitPointSchema).max(7).optional(),
    stretchZones: z.array(StretchZoneSchema).max(10).optional(),

    // Taste-engine hints
    styleTags: StyleTagsSchema.optional(),
  })
  .meta({
    title: 'Curtain GarmentPayload v1',
    description: 'Per-item garment payload a shop sends to Curtain (handoff §3.1, extended).',
  });

export type GarmentPayload = z.infer<typeof GarmentPayloadSchema>;
export type GarmentPayloadInput = z.input<typeof GarmentPayloadSchema>;

/**
 * Draft payload: what a plugin may upsert before the merchant has filled everything in.
 * Identity is required; every other field is optional but validated when present. The backend
 * stores drafts with status `incomplete` and `completenessScore` says what is missing.
 */
export const GarmentPayloadDraftSchema = GarmentPayloadSchema.partial().required({
  id: true,
  name: true,
  brand: true,
}).meta({
  title: 'Curtain GarmentPayload v1 (draft)',
  description: 'Partial garment payload accepted by the merchant upsert/validate routes.',
});
export type GarmentPayloadDraft = z.infer<typeof GarmentPayloadDraftSchema>;

/** Parse helpers (throwing). */
export function parseGarmentPayload(input: unknown): GarmentPayload {
  return GarmentPayloadSchema.parse(input);
}

/** Safe parse returning zod's result (no throw). */
export function safeParseGarmentPayload(input: unknown) {
  return GarmentPayloadSchema.safeParse(input);
}

/** Fit points that the fit engine checks for a category by default (fit-engine-spec.md §Step 1). */
export const CATEGORY_POINTS: Record<GarmentCategory, readonly FitPoint[]> = {
  top: ['bust', 'waist', 'hip', 'shoulder'],
  dress: ['bust', 'waist', 'hip', 'shoulder'],
  bottom: ['waist', 'hip', 'thigh', 'inseam'],
  outerwear: ['bust', 'waist', 'hip', 'shoulder'],
  shoes: ['foot'],
  accessory: [],
};
