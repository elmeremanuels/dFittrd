/**
 * Taste engine v1 types — docs/research/taste-engine-spec.md §Types.
 *
 * Wire types (SwipeEvent, SwipeAction, PassReason, TasteAxis, GarmentPayload) come from
 * `@curtain/schema` and are only re-exported here; nothing is redeclared (AGENTS.md: wire
 * types come from @curtain/schema only). Everything below is on-device state that never
 * leaves the phone except through `outbox` (swipe events + save markers, no body data).
 */
import type { GarmentPayload, PassReason, SwipeAction, SwipeEvent, TASTE_AXES, TasteAxis, WardrobeSizeUnknown } from '@curtain/schema';

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

/**
 * Size of a saved item when nothing told us the size (nothing fit, no measurements, a chart without
 * fit points): an explicit marker, never a guessed label (carry-over #24). Identical to
 * `WARDROBE_SIZE_UNKNOWN` in @curtain/schema, which `WardrobePutRequest.size` uses; cohort size
 * histograms skip it.
 */
export const UNKNOWN_SIZE = 'unknown' as const;
// Compile-time guard: the local marker must be exactly the schema's wardrobe marker.
const _unknownSizeMatchesSchema: WardrobeSizeUnknown = UNKNOWN_SIZE;
void _unknownSizeMatchesSchema;

/** Marker pushed to the outbox on `save` so the sync layer can mirror the wardrobe (§5). */
export interface SaveOutboxEntry {
  type: 'save';
  itemId: string;
  /** The item's shop when the garment carried one (`DeckGarment.shopId`). */
  shopId?: string;
  /** Size recommended at save time, or `UNKNOWN_SIZE`; the same convention as `WardrobePutRequest.size`. */
  size: string;
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
   * itemKey(shopId, itemId) → dealIndex at which it was swiped. Item ids are only unique within
   * one shop, so the key carries the shop (carry-over #22); a garment without `shopId` is keyed by
   * its bare id. Items swiped `pass` become eligible again RESURFACE_AFTER (200) deals later. Items
   * swiped love/save/less are stored as SEEN_FOREVER (-1) and never return.
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

/**
 * A garment the deck can deal. `id` is the shop-scoped external id; `shopId` namespaces it, so two
 * shops selling an item with the same id are two different cards (carry-over #22). Leave `shopId`
 * out only for a single-shop catalogue.
 */
export type DeckGarment = FeaturizableGarment & { id: string; shopId?: string };

/**
 * Separator between shop and item id in a seen-memory key. Shop ids are UUIDs (no ':'), so the
 * first ':' always ends the shop part, whatever the item id contains.
 */
export const ITEM_KEY_SEPARATOR = ':';

/** Seen-memory key of an item: `<shopId>:<itemId>`, or the bare item id without a shop. */
export function itemKey(shopId: string | null | undefined, itemId: string): string {
  return shopId ? `${shopId}${ITEM_KEY_SEPARATOR}${itemId}` : itemId;
}

/** `itemKey` of a deck garment. */
export function garmentKey(garment: Pick<DeckGarment, 'id' | 'shopId'>): string {
  return itemKey(garment.shopId, garment.id);
}

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
