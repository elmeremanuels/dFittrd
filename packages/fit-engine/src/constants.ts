/**
 * Tables of fit-engine-spec.md §Step 1–3. Typed against @curtain/schema's closed vocabularies
 * (compile-time only — the engine has zero runtime imports, AGENTS.md rule 5 / D8).
 */
import type { Band, Category, Point } from './types';

/** FIT_POINTS order of @curtain/schema (checked by constants.test.ts). */
export const POINTS: readonly Point[] = ['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot'];

/** Order in which notes mention points (spec §Notes). */
export const NOTE_ORDER: readonly Point[] = ['bust', 'shoulder', 'waist', 'hip', 'thigh', 'inseam', 'foot'];

/** Point names as the notes print them. */
export const POINT_LABELS: Readonly<Record<Point, string>> = {
  bust: 'bust',
  shoulder: 'shoulders',
  waist: 'waist',
  hip: 'hips',
  thigh: 'thighs',
  inseam: 'inseam',
  foot: 'foot',
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

export const BAND_SCORES: Readonly<Record<Band, number>> = { tight: 0, snug: 0.7, good: 1, roomy: 0.6, loose: 0.2 };
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
