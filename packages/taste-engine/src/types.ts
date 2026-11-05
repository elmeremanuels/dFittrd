/**
 * Taste engine v1 types — docs/research/taste-engine-spec.md §Types.
 *
 * Wire types (SwipeEvent, SwipeAction, PassReason, TasteAxis, GarmentPayload) come from
 * `@curtain/schema` and are only re-exported here; nothing is redeclared (AGENTS.md: wire
 * types come from @curtain/schema only). Everything below is on-device state that never
 * leaves the phone except through `outbox` (swipe events + save markers, no body data).
 */
import type { GarmentPayload, PassReason, SwipeAction, SwipeEvent, TASTE_AXES, TasteAxis } from '@curtain/schema';

export type { SwipeEvent, SwipeAction, PassReason, GarmentPayload };

/** TasteRadial axes in fixed display order. Identical to `TASTE_AXES` from @curtain/schema. */
export type Axis = TasteAxis;
export const AXES = ['bohemian', 'minimal', 'classic', 'avantGarde', 'sporty'] as const satisfies readonly Axis[];
// Compile-time guard: the local tuple must be exactly the schema's TASTE_AXES (same order).
const _axesMatchSchema: typeof TASTE_AXES = AXES;
void _axesMatchSchema;

export type Silhouette = 'fitted' | 'regular' | 'relaxed' | 'oversized';
export const SILHOUETTES = ['fitted', 'regular', 'relaxed', 'oversized'] as const satisfies readonly Silhouette[];

export type HueBin =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'neutral-light'
  | 'neutral-dark'
  | 'black'
  | 'white';
export const HUE_BINS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'neutral-light',
  'neutral-dark',
  'black',
  'white',
] as const satisfies readonly HueBin[];

export type AxisVector = Record<Axis, number>;

export interface TasteProfile {
  version: 1;
  /** 0..1 per axis, init 0.5. Centred after every axis update (mean stays 0.5). */
  axes: AxisVector;
  /** -1..1 per silhouette, init 0. */
  silhouette: Record<Silhouette, number>;
  /** -1..1 per hue bin, absent = 0. */
  colour: Partial<Record<HueBin, number>>;
  /** -1..1 per fabric primary, absent = 0. */
  fabric: Partial<Record<string, number>>;
  /** patternBlock → -1..1, absent = 0. */
  cut: Partial<Record<string, number>>;
  price: {
    /** Prices (EUR) of loved/saved items, last 50. */
    lovedPrices: number[];
    /** Nearest-rank 80th percentile of lovedPrices once there are ≥ 5 entries, else null. */
    p80: number | null;
  };
  swipeCount: number;
  /** 0..0.3, init 0; 'Eclectic' onboarding sets 0.2. */
  explorationBonus: number;
}

export interface PenaltyEntry {
  hue: HueBin;
  fabric: string;
  cut: string;
  /** Decremented on every deal; the entry is dropped at 0. */
  remainingCards: number;
  /** 1 on first 'less', +0.5 per repeat, capped at 2. */
  strength: number;
}

/** Marker pushed to the outbox on `save` so the sync layer can mirror the wardrobe (§5). */
export interface SaveOutboxEntry {
  type: 'save';
  itemId: string;
  size: string | null;
}

export type OutboxEntry = SwipeEvent | SaveOutboxEntry;

export function isSaveOutboxEntry(e: OutboxEntry): e is SaveOutboxEntry {
  return (e as SaveOutboxEntry).type === 'save';
}

export interface TasteState {
  profile: TasteProfile;
  penalties: PenaltyEntry[];
  /** Ring buffer, max EVENTS_RING_SIZE (500), oldest first. */
  events: SwipeEvent[];
  /**
   * itemId → dealIndex at which it was swiped. Items swiped `pass` become eligible again
   * RESURFACE_AFTER (200) deals later. Items swiped love/save/less are stored as
   * SEEN_FOREVER (-1) and never return.
   */
  seen: Record<string, number>;
  /** Number of cards dealt so far (one per card shown). */
  dealIndex: number;
  /** Entries waiting to be synced to POST /v1/swipes (events) and the wardrobe (save markers). */
  outbox: OutboxEntry[];
  /**
   * love/save events per dominant item axis (argmax of the item's axis vector). Drives the
   * exploration-bonus novelty term in rankDeck without needing the catalogue or the event ring.
   */
  loveCounts: AxisVector;
}

export interface ItemFeatures {
  axes: AxisVector;
  silhouette: Silhouette;
  hue: HueBin;
  fabric: string;
  cut: string;
  priceEur: number;
}

/**
 * The subset of the fit engine's FitResult the taste engine reads. `@curtain/fit-engine`'s
 * `FitResult` is structurally assignable to it; the taste engine deliberately does not depend
 * on that package.
 */
export interface FitResultLike {
  recommendedSize: string | null;
  score: number | null;
}

/**
 * The garment fields `featurize` reads. A full `GarmentPayload` is assignable; the deck
 * functions additionally need `id`.
 */
export type FeaturizableGarment = Pick<GarmentPayload, 'category' | 'priceEur' | 'primaryColorHex' | 'patternBlock'> & {
  fabric: Pick<GarmentPayload['fabric'], 'primary'>;
  ease?: GarmentPayload['ease'];
  styleTags?: GarmentPayload['styleTags'];
};

export type DeckGarment = FeaturizableGarment & { id: string };

export const EVENTS_RING_SIZE = 500;
export const LOVED_PRICES_KEEP = 50;
export const PENALTY_CARDS = 50;
export const PENALTY_MAX_STRENGTH = 2;
export const RESURFACE_AFTER = 200;
/** `seen` value for items that never return (love/save/less). */
export const SEEN_FOREVER = -1;
export const WARM_UP_SWIPES = 20;
export const WARM_UP_MULTIPLIER = 1.5;
export const EXPLORATION_EVERY = 5;
