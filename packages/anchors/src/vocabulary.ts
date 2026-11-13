/**
 * The one anchor vocabulary (docs/DECISIONS.md D15, docs/ENGINE-HANDOFF.md §Anchor vocabulary).
 *
 * Body scan, fit engine, garment asset and renderer all name body places with these ids, so the size
 * advice and the picture come from the same numbers. Rings are girths (closed loops around the
 * body, cm); lengths are distances along the body (cm); breadths are straight widths across the
 * body at a ring's height (cm).
 *
 * `shoulder` (ring) and `shoulder_width` (breadth) are different things: the ring is the girth of
 * the torso at the shoulder line (~100 cm), the breadth the distance from one shoulder point to the
 * other across the back (~40 cm), which is what size charts and the fit point `shoulder` mean (R1).
 */

/** The 12 rings the scan measures, top to bottom with the arm rings last (D15 order). */
export const ANCHOR_RINGS = [
  'neck',
  'shoulder',
  'chest',
  'underbust',
  'waist',
  'hip',
  'thigh',
  'knee',
  'calf',
  'ankle',
  'upper_arm',
  'wrist',
] as const;
export type AnchorRing = (typeof ANCHOR_RINGS)[number];

/** Length anchors (D15). Same spelling as the canonical `lengthCm` keys, except `sleeve` (`sleeve_length`). */
export const ANCHOR_LENGTHS = ['shoulder_to_waist', 'shoulder_to_hem', 'waist_to_hem', 'sleeve', 'inseam', 'rise'] as const;
export type AnchorLength = (typeof ANCHOR_LENGTHS)[number];

/** Breadth anchors: straight widths across the body, each taken at the height of a ring (`BREADTH_RING`). */
export const ANCHOR_BREADTHS = ['shoulder_width'] as const;
export type AnchorBreadth = (typeof ANCHOR_BREADTHS)[number];

/** The ring whose height a breadth is measured at (where a renderer places its value). */
export const BREADTH_RING: Readonly<Record<AnchorBreadth, AnchorRing>> = { shoulder_width: 'shoulder' };

/** Every anchor id: the rings first, then the lengths, then the breadths. */
export const ANCHOR_IDS = [...ANCHOR_RINGS, ...ANCHOR_LENGTHS, ...ANCHOR_BREADTHS] as const;
export type AnchorId = AnchorRing | AnchorLength | AnchorBreadth;

/** A value per anchor (cm). Absent anchors are simply not known. */
export type AnchorValues = Partial<Record<AnchorId, number>>;

const RING_SET: ReadonlySet<string> = new Set(ANCHOR_RINGS);
const LENGTH_SET: ReadonlySet<string> = new Set(ANCHOR_LENGTHS);
const BREADTH_SET: ReadonlySet<string> = new Set(ANCHOR_BREADTHS);

export function isAnchorRing(value: unknown): value is AnchorRing {
  return typeof value === 'string' && RING_SET.has(value);
}

export function isAnchorLength(value: unknown): value is AnchorLength {
  return typeof value === 'string' && LENGTH_SET.has(value);
}

export function isAnchorBreadth(value: unknown): value is AnchorBreadth {
  return typeof value === 'string' && BREADTH_SET.has(value);
}

export function isAnchorId(value: unknown): value is AnchorId {
  return isAnchorRing(value) || isAnchorLength(value) || isAnchorBreadth(value);
}

/** Garment categories (same values as `GARMENT_CATEGORIES` in `@curtain/schema`; a test keeps them equal). */
export type AnchorCategory = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory';

export interface AnchorSubset {
  rings: readonly AnchorRing[];
  lengths: readonly AnchorLength[];
  breadths: readonly AnchorBreadth[];
}

const UPPER_RINGS = ['neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'upper_arm', 'wrist'] as const satisfies readonly AnchorRing[];
const UPPER_LENGTHS = ['shoulder_to_waist', 'shoulder_to_hem', 'sleeve'] as const satisfies readonly AnchorLength[];

/**
 * The anchors a garment of each category is built against (handoff: "a garment uses the subset its
 * category needs"). Every subset contains the anchors of the fit engine's default points for that
 * category. Shoes and accessories have no garment mesh and stay on today's flow, so they are empty.
 */
export const CATEGORY_ANCHORS: Readonly<Record<AnchorCategory, AnchorSubset>> = {
  top: { rings: UPPER_RINGS, lengths: UPPER_LENGTHS, breadths: ['shoulder_width'] },
  outerwear: { rings: UPPER_RINGS, lengths: UPPER_LENGTHS, breadths: ['shoulder_width'] },
  dress: {
    rings: ['neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'thigh', 'knee', 'upper_arm', 'wrist'],
    lengths: ['shoulder_to_waist', 'shoulder_to_hem', 'waist_to_hem', 'sleeve'],
    breadths: ['shoulder_width'],
  },
  bottom: {
    rings: ['waist', 'hip', 'thigh', 'knee', 'calf', 'ankle'],
    lengths: ['waist_to_hem', 'inseam', 'rise'],
    breadths: [],
  },
  shoes: { rings: [], lengths: [], breadths: [] },
  accessory: { rings: [], lengths: [], breadths: [] },
};

/** Rings, lengths and breadths of a category as one list (D15 order). Unknown categories → `[]`. */
export function anchorsForCategory(category: string): AnchorId[] {
  if (!Object.prototype.hasOwnProperty.call(CATEGORY_ANCHORS, category)) return [];
  const subset = CATEGORY_ANCHORS[category as AnchorCategory];
  return [...subset.rings, ...subset.lengths, ...subset.breadths];
}
