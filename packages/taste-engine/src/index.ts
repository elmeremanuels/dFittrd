/**
 * @paskamer/taste-engine — pure TypeScript swipe learning and colour harmony (handoff §5,
 * docs/research/taste-engine-spec.md). Zero runtime dependencies; wire types come from
 * @paskamer/schema. Every function returns new objects and never mutates its inputs.
 */
export type {
  Axis,
  AxisVector,
  DeckGarment,
  FeaturizableGarment,
  FitResultLike,
  GarmentPayload,
  HueBin,
  ItemFeatures,
  OutboxEntry,
  PassReason,
  PenaltyEntry,
  SaveOutboxEntry,
  Silhouette,
  SwipeAction,
  SwipeEvent,
  TasteProfile,
  TasteState,
} from './types';
export {
  AXES,
  EVENTS_RING_SIZE,
  EXPLORATION_EVERY,
  HUE_BINS,
  LOVED_PRICES_KEEP,
  PENALTY_CARDS,
  PENALTY_MAX_STRENGTH,
  RESURFACE_AFTER,
  SEEN_FOREVER,
  SILHOUETTES,
  WARM_UP_MULTIPLIER,
  WARM_UP_SWIPES,
  isSaveOutboxEntry,
} from './types';

export {
  BLOCK_EASE,
  CATEGORY_EASE,
  FABRIC_AXES,
  GIRTH_POINTS,
  PATTERN_BLOCK_AXES,
  axesOf,
  easeTotal,
  featurize,
  silhouetteFromEase,
  normaliseKey,
  styleMatch,
} from './featurize';
export type { GirthPoint } from './featurize';

export { hexToHsl, hueBin, hueBinFromHsl, parseHex, rgbToHsl } from './colour';
export type { Hsl, Rgb } from './colour';

export {
  ECLECTIC_VIBE,
  ONBOARDING_VIBES,
  VIBE_AXIS,
  applyOnboardingVibes,
  emptyProfile,
  emptyState,
  priceFit,
  pricePercentile80,
} from './profile';

export {
  LEARNING_RATE,
  SIGN,
  ackOutbox,
  applySwipe,
  dimensionsFor,
  drainOutbox,
  effectiveRate,
  inferPassReasons,
  updateAxes,
} from './swipe';
export type { ApplySwipeResult } from './swipe';

export { PENALTY_FULL_MATCH, PENALTY_TWO_MATCH, addPenalty, penalty, tickPenalties } from './penalty';

export {
  BASE_WEIGHTS,
  baseScore,
  dealNext,
  isEligible,
  isExplorationDeal,
  leastLovedAxes,
  noveltyOf,
  orderDeals,
  rankCandidates,
  rankDeck,
  scoreItem,
} from './rank';
export type { DealNextResult, FitFor, RankDeckResult, ScoredItem } from './rank';

export { ARCHETYPE_COPY, AXIS_LABELS, styleDna } from './styleDna';
export type { StyleDna, StyleDnaAxis } from './styleDna';

export {
  COLOUR_MATCH,
  SEASONS,
  SEASON_TABLE,
  UNDERTONES,
  chroma,
  colourChipLabel,
  colourMatch,
  colourMatchScore,
  deltaE2000,
  hexToLab,
  hueAngle,
  isSeason,
  isUndertone,
  nearestSwatch,
  paletteProximity,
  rgbToLab,
  undertoneAgreement,
} from './colourHarmony';
export type {
  ColourChipLabel,
  ColourMatch,
  Lab,
  PaletteSwatch,
  Season,
  SeasonDefinition,
  SeasonFamily,
  Undertone,
} from './colourHarmony';

export { clamp, dominantAxis, nearestRankPercentile, round4, topAxis } from './util';
