/**
 * Tables of fit-engine-spec.md §Step 1–3. Typed against @curtain/schema's closed vocabularies
 * (compile-time only — the engine has zero runtime imports, AGENTS.md rule 5 / D8).
 */
import type { Category, FitPointName, GirthBand, Point } from './types';

/** FIT_POINTS order of @curtain/schema (checked by constants.test.ts). */
export const POINTS: readonly FitPointName[] = ['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot', 'neck', 'sleeve'];

/**
 * Every point the engine can score, in `SizeFit.points` order: the fit points plus the garment body
 * `length` (men-3d-plan slice M2b), which is not a body measurement and so not a schema fit point.
 */
export const ENGINE_POINTS: readonly Point[] = [...POINTS, 'length'];

/** Order in which notes mention points (spec §Notes). The men's points (slice M2) come after the shoulders. */
export const NOTE_ORDER: readonly Point[] = ['bust', 'shoulder', 'neck', 'sleeve', 'length', 'waist', 'hip', 'thigh', 'inseam', 'foot'];

/** Point names as the notes print them. */
export const POINT_LABELS: Readonly<Record<Point, string>> = {
  bust: 'bust',
  shoulder: 'shoulders',
  waist: 'waist',
  hip: 'hips',
  thigh: 'thighs',
  inseam: 'inseam',
  foot: 'foot',
  neck: 'neck',
  sleeve: 'sleeve',
  length: 'length',
};

/** Point names in the notes of a men's fit (slice M2a: "chest", never "bust"; MT4). */
export const MENS_POINT_LABELS: Readonly<Record<Point, string>> = {
  ...POINT_LABELS,
  bust: 'chest',
  hip: 'seat',
  inseam: 'leg',
  length: 'body length',
};

/** Mirror of @curtain/schema CATEGORY_POINTS (spec §Step 1; parity test in constants.test.ts). */
export const CATEGORY_POINTS: Readonly<Record<Category, readonly Point[]>> = {
  top: ['bust', 'waist', 'hip', 'shoulder'],
  dress: ['bust', 'waist', 'hip', 'shoulder'],
  bottom: ['waist', 'hip', 'thigh', 'inseam'],
  outerwear: ['bust', 'waist', 'hip', 'shoulder'],
  shoes: ['foot'],
  accessory: [],
};

/** Mirror of @curtain/schema MENS_CATEGORY_POINTS (slice M2; parity test in constants.test.ts). */
export const MENS_CATEGORY_POINTS: Readonly<Record<Category, readonly Point[]>> = {
  top: ['bust', 'waist', 'shoulder'],
  dress: ['bust', 'waist', 'hip', 'shoulder'],
  bottom: ['waist', 'hip', 'thigh', 'inseam'],
  outerwear: ['bust', 'waist', 'hip', 'shoulder'],
  shoes: ['foot'],
  accessory: [],
};

export type EaseMap = Partial<Record<Point, number>>;

/**
 * Category default ease targets, cm, garment minus body (spec §Step 2 `CATEGORY_EASE`).
 * Shoes: 0.7 cm only when the user supplies a foot length; with a `footEu` size the ease is 0
 * (a shoe size is already a size) — see `easeTargetFor`.
 */
export const CATEGORY_EASE: Readonly<Record<Category, Readonly<EaseMap>>> = {
  top: { bust: 8, waist: 8, hip: 6, shoulder: 1 },
  dress: { bust: 6, waist: 4, hip: 6, shoulder: 1 },
  bottom: { waist: 2, hip: 5, thigh: 3, inseam: 0 },
  outerwear: { bust: 12, waist: 12, hip: 10, shoulder: 2 },
  shoes: { foot: 0.7 },
  accessory: {},
};

/** Foot ease when the user's foot is given as an EU size. */
export const SHOES_EASE_FOOT_EU = 0;

export interface BlockRule {
  ease: Readonly<EaseMap>;
  skip: readonly Point[];
  snugOk: boolean;
  /** Label printed in the `{Point} not checked: {label}` note. */
  label: string;
}

const block = (ease: EaseMap, skip: Point[] = [], snugOk = false, label = ''): BlockRule => ({
  ease,
  skip,
  snugOk,
  label,
});

/** Pattern-block overrides (spec §Step 2 `BLOCKS`). Unknown blocks → `UNKNOWN_BLOCK`. */
export const BLOCKS: Readonly<Record<string, BlockRule>> = {
  wrap: block({ bust: 6, waist: 4, hip: 8 }),
  'a-line': block({ waist: 3 }, ['hip'], false, 'A-line hem flares freely'),
  'fit-and-flare': block({ waist: 3 }, ['hip'], false, 'flared hem flares freely'),
  skater: block({ waist: 3 }, ['hip'], false, 'flared hem flares freely'),
  sheath: block({ bust: 4, waist: 3, hip: 4 }, [], true),
  bodycon: block({ bust: 2, waist: 2, hip: 2 }, [], true),
  column: block({ bust: 5, waist: 4, hip: 5 }),
  empire: block({}, ['waist', 'hip'], false, 'empire line hangs from the bust'),
  tent: block({ bust: 10 }, ['waist', 'hip'], false, 'tent shape hangs from the bust'),
  trapeze: block({ bust: 10 }, ['waist', 'hip'], false, 'trapeze shape hangs from the bust'),
  oversized: block({ bust: 14, shoulder: 4 }, ['waist', 'hip'], false, 'oversized cut hangs loose'),
  boxy: block({ bust: 12, shoulder: 3 }, ['waist', 'hip'], false, 'boxy cut hangs loose'),
  bias: block({ bust: 4, hip: 4 }, ['waist'], false, 'bias cut skims the waist'),
  shirt: block({ bust: 10, shoulder: 1.5 }, ['waist', 'hip'], false, 'shirt cut hangs loose'),
  't-shirt': block({ bust: 6, shoulder: 1 }, ['waist', 'hip'], true, 't-shirt hangs loose'),
  straight: block({}, ['thigh'], false, 'straight leg does not grip the thigh'),
  'wide-leg': block({ hip: 6 }, ['thigh'], false, 'straight leg does not grip the thigh'),
  bootcut: block({}),
  skinny: block({ hip: 2, thigh: 1 }, [], true),
  slim: block({ hip: 3, thigh: 2 }, [], true),
  // Blocks named for men's tops (slice M2a). Outside a men's fit they read as an unknown block, as
  // they did before M2 (no women's ease was ever sourced for them; review of men-m2, 19 Nov 2026).
  'shirt-slim': block({}),
  'shirt-classic': block({}),
  knit: block({}),
  sweatshirt: block({}),
};

export const UNKNOWN_BLOCK: BlockRule = block({});

export function blockRule(patternBlock: string | undefined): BlockRule {
  if (!patternBlock) return UNKNOWN_BLOCK;
  const key = patternBlock.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BLOCKS, key) ? (BLOCKS[key] as BlockRule) : UNKNOWN_BLOCK;
}

/** `stretchZones` → points (spec §Step 3). `'all'` = every point. */
export const ZONE_POINTS: Readonly<Record<string, readonly Point[] | 'all'>> = {
  'waist-tie': ['waist'],
  waistband: ['waist'],
  'side-panel': ['waist'],
  'back-panel': ['bust'],
  cuff: ['shoulder'],
  'rib-hem': ['hip'],
  'stretch-knit': 'all',
};

/** Tight-limit shift and upper-edge shift for a point in a stretch zone, cm. */
export const ZONE_SHIFT_CM = 4;

export interface BandSlack {
  good: number;
  loose: number;
}
export const DEFAULT_SLACK: Readonly<BandSlack> = { good: 2, loose: 4 };
export const SHOES_SLACK: Readonly<BandSlack> = { good: 0.5, loose: 1.0 };

/** Beyond `E + loose + LOOSE_FAR_CM` a loose point scores 0 instead of 0.2. */
export const LOOSE_FAR_CM = 4;

export const BAND_SCORES: Readonly<Record<GirthBand, number>> = { tight: 0, snug: 0.7, good: 1, roomy: 0.6, loose: 0.2 };
export const SNUG_OK_SCORE = 1;
export const LOOSE_FAR_SCORE = 0;

/** Stretch (%) at or above which snug scores 1.0 regardless of block. */
export const SNUG_OK_STRETCH_PCT = 15;
/** Stretch (%) at which the ease target reaches 0: `E = E0 × max(0, 1 − stretch / 40)`. */
export const EASE_STRETCH_DIVISOR = 40;
/** Tight limit `T = max(TIGHT_FLOOR, −(TIGHT_BASE + TIGHT_PER_STRETCH × stretch))`. */
export const TIGHT_BASE_CM = 2;
export const TIGHT_PER_STRETCH_PCT = 0.25;
export const TIGHT_FLOOR_CM = -12;

export const DEFAULT_CONFIDENCE = 0.8;
export const DEFAULT_TRUE_TO_SIZE = 0.8;
/** Below this best score nothing fits. */
export const NOTHING_FITS_BELOW = 0.3;
/** A size is wearable when no point is tight and its score is at least this. */
export const WEARABLE_MIN_SCORE = 0.4;
/** Notes flag a point whose confidence is below this. */
export const LOW_CONFIDENCE_BELOW = 0.7;
export const CRITICAL_PENALTY = 0.5;
export const NON_CRITICAL_PENALTY = 0.75;
export const CRITICAL_WEIGHT = 2;

// ---------------------------------------------------------------------------
// Men's fit (men-3d-plan slices M2a and M2b)
//
// Every number below says where it comes from: [S] a source, [A] assumed by us (to be calibrated on
// at least three real merchant charts per block before a men's product ships, plan §4).
// ---------------------------------------------------------------------------

/** Men's pattern-block families the engine knows (plan §4 "Men's eases"). */
export type MensBlockId =
  | 'tee'
  | 'knit'
  | 'shirt-slim'
  | 'shirt-tailored'
  | 'shirt-classic'
  | 'chino-slim'
  | 'chino-regular'
  | 'jeans-slim'
  | 'jeans-regular';

/**
 * Men's eases, cm, garment minus body (plan §4 table). Tee and knit: [A]. Shirt chest tailored 21.5
 * and classic 26: [S] Paul Fredrick dress-shirt fit guide (one retailer; that the figures are girths
 * is inferred, plan §1), every other shirt value [A]. Chinos and jeans: [A]. Lengths (inseam,
 * sleeve, body length) have no ease: see the offsets below.
 */
export const MENS_BLOCKS: Readonly<Record<MensBlockId, BlockRule>> = {
  tee: block({ bust: 8, waist: 8, shoulder: 1 }),
  knit: block({ bust: 10, waist: 10, shoulder: 1.5 }),
  'shirt-slim': block({ bust: 14, waist: 10, shoulder: 1, neck: 1.5 }),
  'shirt-tailored': block({ bust: 21.5, waist: 16, shoulder: 1, neck: 1.5 }),
  'shirt-classic': block({ bust: 26, waist: 22, shoulder: 1, neck: 1.5 }),
  'chino-slim': block({ waist: 2, hip: 4, thigh: 4 }),
  'chino-regular': block({ waist: 2, hip: 6, thigh: 6 }),
  'jeans-slim': block({ waist: 2, hip: 3, thigh: 3 }),
  'jeans-regular': block({ waist: 2, hip: 5, thigh: 5 }),
};

/** Pattern block → men's top family. `shirt` reads as tailored [A: the middle of the three]. Others: tee. */
export const MENS_TOP_BLOCKS: Readonly<Record<string, MensBlockId>> = {
  't-shirt': 'tee',
  tee: 'tee',
  knit: 'knit',
  sweatshirt: 'knit',
  shirt: 'shirt-tailored',
  'shirt-tailored': 'shirt-tailored',
  'shirt-slim': 'shirt-slim',
  'shirt-classic': 'shirt-classic',
};

/** Trouser blocks read as slim for men; every other bottom block is regular. */
export const MENS_SLIM_BOTTOM_BLOCKS: readonly string[] = ['slim', 'skinny', 'tapered'];

/**
 * A garment chart's seam-to-seam shoulder is compared with the body's biacromial breadth plus this,
 * cm [A, M] (plan §4 "Shoulder": "about 3.5 cm"). Body charts are compared as they are.
 */
export const MENS_SHOULDER_SEAM_OFFSET_CM = 3.5;

/**
 * A garment inseam is compared with the inside leg minus this, cm [A] (plan §4 "Inseam": the hem
 * sits above the floor; calibrate). Body charts compare inside leg with inside leg.
 */
export const MENS_INSEAM_HEM_OFFSET_CM = 3;

/**
 * Target garment body length (high shoulder point to hem) of a men's top as a share of stature [A]:
 * 0.41 × 174 cm = 71.3 cm for the male M. No source read; to be calibrated.
 */
export const MENS_TOP_LENGTH_PER_HEIGHT = 0.41;

/** A neck (collar) point's ease when neither the garment nor the block gives one, cm [A] (the men's shirt value). */
export const NECK_DEFAULT_EASE_CM = 1.5;

/**
 * Length bands, cm [A] (plan §4 "Lengths are not girths"): within ±good fits, beyond ±fail fails.
 * Fabric stretch never changes a length.
 */
export const LENGTH_SLACK: Readonly<{ good: number; fail: number }> = { good: 2, fail: 4 };
/** Score of a length between `good` and `fail` cm off [A, the `roomy` score]; beyond `fail` it scores 0 and is not wearable. */
export const LENGTH_NEAR_SCORE = 0.6;

/**
 * The neck is a narrow girth (plan §4 table: ±1 cm [A]): tight below −1, snug −1..0, good 0..1,
 * roomy 1..2, loose above 2 (cm from the collar target).
 */
export const NECK_SLACK: Readonly<{ tight: number; good: number; loose: number }> = { tight: 1, good: 1, loose: 2 };

/**
 * Worn waist of men's trousers (plan §4 "Worn waist" [A, M]): the waistband is compared with the body
 * girth at the height it sits, interpolated between the natural waist and the seat by the chart's
 * front rise: a rise of `atWaist` cm or more sits at the natural waist, `atSeat` cm or less at the
 * seat girth. Both numbers are assumed (no source read): calibrate on real charts.
 */
export const WORN_WAIST_RISE_CM: Readonly<{ atWaist: number; atSeat: number }> = { atWaist: 30, atSeat: 18 };

