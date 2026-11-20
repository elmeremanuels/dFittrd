/**
 * GarmentPayload v1 — the per-item payload a shop sends to Curtain (handoff §3.1),
 * extended per docs/DECISIONS.md D6/D8 and docs/research/fit-engine-spec.md.
 *
 * This file is the single source of truth for the garment wire type. The fit engine,
 * the taste engine, the merchant plugins (via the exported JSON Schema) and the backend
 * all read this shape.
 */
import { z } from 'zod';
import { GarmentClosureSchema, GarmentTapeSchema } from './garmentTape';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Handoff §3.1 `category`. */
export const GARMENT_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

/**
 * Who a garment is cut for (photo-avatar plan, slice 3 "Men v1"). Optional on the payload: absent
 * means "not specified" and keeps the behaviour from before the field existed (the women's figure
 * and the "Bust" label). The mappings fill it from shop data with a merchant override
 * (`mappings/audience.ts`). It changes labels and which figure is drawn, never the fit maths.
 *
 * Decision D20 (13 Nov 2026): no men's product goes live with a 2D figure only. Until the male 3D
 * pipeline works, the web layer shows "Men's clothing: coming soon" for `audience: 'men'` in place
 * of the Try it on flow. So a wrong `men` (the inference reads text and can be wrong) now hides
 * the flow for that product; the merchant override is the fix. This package only carries the
 * value; the gate is one server helper (apps/api/src/services/readiness.ts, plan slice M0), behind
 * a server flag that is off by default.
 */
export const GARMENT_AUDIENCES = ['women', 'men', 'unisex'] as const;
export type GarmentAudience = (typeof GARMENT_AUDIENCES)[number];

/**
 * Fit points read by `@curtain/fit-engine` (fit-engine-spec.md `Point`). Each is also a body
 * measurement (`body.ts` builds the stored and engine keys from this list), so only body-side points
 * belong here. `neck` and `sleeve` were added for menswear (men-3d-plan slice M2): `neck` is the EN
 * neck girth, `sleeve` is the body's EN arm length (shoulder over the bent elbow to the wrist). The
 * first seven keep their order. Garment-only lengths are in `GARMENT_LENGTH_POINTS`.
 */
export const FIT_POINTS = ['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot', 'neck', 'sleeve'] as const;
export type FitPoint = (typeof FIT_POINTS)[number];

/**
 * Garment lengths a size chart may carry that are NOT body measurements (men-3d-plan slice M2b):
 * `length` = body length of a top from the high shoulder point, `rise` = front rise of trousers. They
 * never enter a stored body profile (`BODY_MEASUREMENT_KEYS` is built from `FIT_POINTS` only).
 */
export const GARMENT_LENGTH_POINTS = ['length', 'rise'] as const;
export type GarmentLengthPoint = (typeof GARMENT_LENGTH_POINTS)[number];

/**
 * Where a chart's sleeve length is measured from (men-3d-plan slice M2b). `shoulder_point`: from the
 * shoulder seam to the cuff; `centre_back`: from the centre back neck over the shoulder to the cuff.
 * A chart with a sleeve column and no declared convention gets no sleeve score.
 */
export const SLEEVE_CONVENTIONS = ['shoulder_point', 'centre_back'] as const;
export type SleeveConvention = (typeof SLEEVE_CONVENTIONS)[number];

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
  // Men's tops (men-3d-plan slice M2a): `shirt` reads as a tailored shirt for men.
  'shirt-slim',
  'shirt-classic',
  'knit',
  'sweatshirt',
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

/** Largest size chart: a full W/L grid (11 waists × 3 lengths) plus room. Was 30 before slice M2b. */
export const SIZE_CHART_MAX_ROWS = 60;
/** Longest size label. Was 16 before slice M2b. */
export const SIZE_LABEL_MAX = 24;

export const HexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'expected #RGB or #RRGGBB')
  .describe('CSS hex colour, #RRGGBB');
export type HexColor = z.infer<typeof HexColorSchema>;

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

export const GarmentCategorySchema = z.enum(GARMENT_CATEGORIES);
export const GarmentAudienceSchema = z.enum(GARMENT_AUDIENCES);
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
  'Primary fibre or construction: a fabric library id (cotton, lyocell as "tencel", satin, …) or another v1 value. Known values drive drape/texture defaults; unknown values are accepted.',
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
    size: z.string().min(1).max(SIZE_LABEL_MAX).describe('Label as the shop prints it: XS, M, 28, 38, ONE, 32/34'),
    bust: chartCm.optional(),
    waist: chartCm.optional(),
    hip: chartCm.optional(),
    shoulder: chartCm.optional(),
    thigh: chartCm.optional(),
    inseam: chartCm.optional(),
    footEu: z.number().min(15).max(55).optional().describe('EU shoe size, e.g. 38'),
    footLengthCm: z.number().min(8).max(40).optional().describe('Insole / foot length in cm'),
    neck: chartCm.optional().describe('Collar / neck girth, cm (garment: the collar; body: the EN neck girth)'),
    sleeve: chartCm.optional().describe('Sleeve length, cm (garment: as declared by sleeveConvention; body: EN arm length)'),
    length: chartCm.optional().describe('Garment body length from the high shoulder point to the hem, cm (garment charts only)'),
    rise: chartCm.optional().describe('Front rise of trousers, cm (garment charts only): sets where the waistband sits'),
    axes: z
      .object({
        waist: z.string().min(1).max(8).describe('Girth axis label, e.g. 32 of 32/34'),
        leg: z.string().min(1).max(8).describe('Length axis label, e.g. 34 of 32/34'),
      })
      .optional()
      .describe('Two-dimensional size (W/L): the fit engine picks the waist and the leg on their own'),
  })
  .describe(
    'One row of the size chart, in cm. Whether the numbers are garment or body measurements is declared by sizeChartType.',
  );
export type SizeRow = z.infer<typeof SizeRowSchema>;

/**
 * Comparison key of a size label: trimmed and upper-cased, so `M`, `m` and ` M ` are one size.
 * The fit engine and the grading step read the chart per label, so two rows may never share one.
 */
export function sizeLabelKey(label: string): string {
  return label.trim().toUpperCase();
}

/** Labels that occur more than once in a chart (as first written, in chart order, each once). */
export function duplicateSizeLabels(rows: readonly { size: string }[]): string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = sizeLabelKey(row.size);
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key);
      out.push(row.size);
    }
    seen.add(key);
  }
  return out;
}

/** A size chart: 1–60 rows in ascending size order, each with its own label. */
export const SizeChartSchema = z
  .array(SizeRowSchema)
  .min(1)
  .max(SIZE_CHART_MAX_ROWS)
  .superRefine((rows, ctx) => {
    // Two-dimensional charts: all rows or none carry axes, and every waist × leg pair once.
    const withAxes = rows.filter((r) => r.axes !== undefined).length;
    if (withAxes > 0 && withAxes < rows.length) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Either every row of the size chart has axes (waist and leg) or none has' });
    }
    const pairs = new Map<string, number>();
    rows.forEach((row, i) => {
      if (!row.axes) return;
      const key = `${sizeLabelKey(row.axes.waist)}\u0000${sizeLabelKey(row.axes.leg)}`;
      const j = pairs.get(key);
      if (j !== undefined) {
        ctx.addIssue({ code: 'custom', path: [i, 'axes'], message: `Waist ${row.axes.waist} with leg ${row.axes.leg} occurs twice (rows ${j + 1} and ${i + 1})` });
      } else pairs.set(key, i);
    });
    const first = new Map<string, number>();
    rows.forEach((row, i) => {
      const key = sizeLabelKey(row.size);
      const j = first.get(key);
      if (j === undefined) {
        first.set(key, i);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: [i, 'size'],
        message: `Duplicate size label "${row.size}" (rows ${j + 1} and ${i + 1}): every row of the size chart needs its own label`,
      });
    });
  })
  .describe('Ascending size order; every label unique (compared trimmed and case-insensitively). W/L charts carry axes on every row.');

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

/**
 * The fabric of a draft (D24 point 4, D25 point 1): every part is optional, and validated when it
 * is present. A product whose fabric has only a name is a valid draft; size advice then assumes
 * 0 % stretch (`sizeAdviceGarment`). `GarmentPayloadSchema` keeps the complete `FabricSchema`.
 */
export const FabricDraftSchema = FabricSchema.partial().describe(
  'Fabric of a draft: every part optional, validated when present. Size advice assumes 0 % stretch when stretchPct is absent.',
);
export type FabricDraft = z.infer<typeof FabricDraftSchema>;

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
    audience: GarmentAudienceSchema.optional().describe(
      "Who the garment is cut for: 'women', 'men' or 'unisex'. Optional; absent = not specified (the women's figure and the \"Bust\" label, as before the field existed). The chest measurement is stored in the 'bust' fit point for every audience.",
    ),
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
    sizeChart: SizeChartSchema,
    sleeveConvention: z
      .enum(SLEEVE_CONVENTIONS)
      .optional()
      .describe("Where the chart's sleeve column is measured from: 'shoulder_point' (shoulder seam to cuff) or 'centre_back' (centre back neck to cuff). Without it the sleeve column is not scored."),
    sizingNotes: z.string().max(500).optional().describe("Freeform, e.g. 'runs small'; parsed for a size bias"),
    trueToSizeScore: unit.optional().describe('From past return / fit data; default 0.8 in the fit engine'),

    // Fit-engine hints
    criticalFitPoints: z.array(FitPointSchema).max(FIT_POINTS.length).optional(),
    stretchZones: z.array(StretchZoneSchema).max(10).optional(),

    // Garment tape measurements (docs/MERCHANT-MEASUREMENTS.md). Both optional: absent = the
    // behaviour from before the fields existed.
    closure: GarmentClosureSchema.optional().describe(
      "How the garment is opened to put it on. 'pull-on' = not opened at all (elastic band, no zip, no drawstring): the stretched waistband has to pass the hips. Absent = not specified, no pull-on check.",
    ),
    garmentTape: GarmentTapeSchema.optional(),

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
 * Identity is required; every other field is optional but validated when present, and so is every
 * part of the fabric (`FabricDraftSchema`). The backend stores the draft; `completenessScore` says
 * what is missing and `sizeAdviceGarment` whether it can be sized.
 */
export const GarmentPayloadDraftSchema = GarmentPayloadSchema.partial()
  .extend({ fabric: FabricDraftSchema.optional() })
  .required({
    id: true,
    name: true,
    brand: true,
  })
  .meta({
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

/**
 * Fit points the engine checks for a men's garment (men-3d-plan slice M2; `audience: 'men'`, or
 * `'unisex'` worn on the male body). Tops: chest, waist (men's tees score the belly) and shoulder; the
 * seat is not checked on a top. Bottoms: waist, seat, thigh and inseam, where the inseam is a length.
 * `neck`, `sleeve` and the garment `length` are added per garment, only when the chart has the column.
 * Other categories keep `CATEGORY_POINTS`.
 */
export const MENS_CATEGORY_POINTS: Record<GarmentCategory, readonly FitPoint[]> = {
  top: ['bust', 'waist', 'shoulder'],
  dress: ['bust', 'waist', 'hip', 'shoulder'],
  bottom: ['waist', 'hip', 'thigh', 'inseam'],
  outerwear: ['bust', 'waist', 'hip', 'shoulder'],
  shoes: ['foot'],
  accessory: [],
};
