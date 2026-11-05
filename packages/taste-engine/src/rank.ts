/**
 * rankDeck / dealNext — taste-engine-spec.md §rankDeck.
 *
 * Deterministic (no RNG): sort by score desc, ties by catalogue order. Every 5th deal
 * (dealIndex % 5 === 4) is an exploration deal; a diversity pass keeps two consecutive cards
 * from sharing the same (hue, category). Items passed ≥ 200 deals ago re-surface; loved/saved/
 * 'less' items never return. Catalogue ≤ a few thousand items → O(n log n) per re-rank.
 */
import { featurize, styleMatch } from './featurize';
import { penalty as penaltyOf, tickPenalties } from './penalty';
import { priceFit } from './profile';
import {
  AXES,
  EXPLORATION_EVERY,
  RESURFACE_AFTER,
  SEEN_FOREVER,
  type Axis,
  type AxisVector,
  type DeckGarment,
  type FitResultLike,
  type ItemFeatures,
  type TasteProfile,
  type TasteState,
} from './types';
import { dominantAxis, topAxis } from './util';

/** Weights of the base score (spec §rankDeck step 2). They sum to 1. */
export const BASE_WEIGHTS = Object.freeze({ style: 0.4, colour: 0.2, fabric: 0.1, cut: 0.1, fit: 0.15, price: 0.05 });

/** The caller's on-device fit function (`computeFit` from @curtain/fit-engine, or a cache in front of it). */
export type FitFor<G extends DeckGarment> = (garment: G) => FitResultLike | null;

export interface ScoredItem<G extends DeckGarment = DeckGarment> {
  garment: G;
  features: ItemFeatures;
  fit: FitResultLike;
  /** Weighted sum of styleMatch, affinities, fit score and price fit (0..1). */
  base: number;
  /** Penalty-memory deduction (≥ 0). */
  penalty: number;
  /** 1 when the item's dominant axis is among the least loved/saved axes so far. */
  novelty: 0 | 1;
  /** base − penalty + explorationBonus · novelty */
  score: number;
  /** Position in the input catalogue (tie-breaker). */
  catalogIndex: number;
}

export interface RankDeckResult<G extends DeckGarment = DeckGarment> {
  /** The next `n` cards in deal order (exploration + diversity rules applied from `state.dealIndex`). */
  deck: G[];
  /** Candidates excluded because nothing fits (`fitFor(g).recommendedSize === null`). */
  notInYourSize: number;
  /** Every eligible candidate, sorted by score (before the deal rules). */
  ranked: ScoredItem<G>[];
}

export interface DealNextResult<G extends DeckGarment = DeckGarment> {
  /** `dealIndex + 1` and penalty memory ticked — only when a card was dealt. */
  state: TasteState;
  /** The dealt card with its features, fit and score; null when the catalogue is exhausted. */
  card: ScoredItem<G> | null;
  notInYourSize: number;
}

/**
 * Candidate rule 1: never seen, or passed ≥ RESURFACE_AFTER (200) deals ago.
 * Loved / saved / 'less' items are stored as SEEN_FOREVER and never come back.
 */
export function isEligible(state: Pick<TasteState, 'seen' | 'dealIndex'>, itemId: string): boolean {
  const at = state.seen[itemId];
  if (at === undefined) return true;
  if (at === SEEN_FOREVER) return false;
  return state.dealIndex - at >= RESURFACE_AFTER;
}

/** Axes with the fewest love/save events so far (all of them on a fresh state). */
export function leastLovedAxes(loveCounts: Readonly<AxisVector>): Axis[] {
  let min = Infinity;
  for (const a of AXES) if (loveCounts[a] < min) min = loveCounts[a];
  return AXES.filter((a) => loveCounts[a] === min);
}

/** novelty = 1 iff the item's dominant axis (argmax v) is among the least loved/saved axes. */
export function noveltyOf(features: Pick<ItemFeatures, 'axes'>, loveCounts: Readonly<AxisVector>): 0 | 1 {
  const dom = dominantAxis(features.axes);
  if (!dom) return 0;
  return leastLovedAxes(loveCounts).includes(dom) ? 1 : 0;
}

/**
 * base = 0.40·styleMatch + 0.20·(colour+1)/2 + 0.10·(fabric+1)/2 + 0.10·(cut+1)/2 + 0.15·fit.score + 0.05·priceFit
 */
export function baseScore(profile: TasteProfile, f: ItemFeatures, fit: FitResultLike): number {
  const w = BASE_WEIGHTS;
  return (
    w.style * styleMatch(profile.axes, f.axes) +
    (w.colour * ((profile.colour[f.hue] ?? 0) + 1)) / 2 +
    (w.fabric * ((profile.fabric[f.fabric] ?? 0) + 1)) / 2 +
    (w.cut * ((profile.cut[f.cut] ?? 0) + 1)) / 2 +
    w.fit * (fit.score ?? 0) +
    w.price * priceFit(f.priceEur, profile.price.p80)
  );
}

/** Score one garment against the state (no eligibility check). */
export function scoreItem<G extends DeckGarment>(state: TasteState, garment: G, fit: FitResultLike, catalogIndex = 0): ScoredItem<G> {
  const features = featurize(garment);
  const base = baseScore(state.profile, features, fit);
  const pen = penaltyOf(state.penalties, features);
  const novelty = noveltyOf(features, state.loveCounts);
  return { garment, features, fit, base, penalty: pen, novelty, score: base - pen + state.profile.explorationBonus * novelty, catalogIndex };
}

/** Candidates (rules 1–2), scored (rules 2–3) and sorted (rule 4). */
export function rankCandidates<G extends DeckGarment>(
  catalog: readonly G[],
  state: TasteState,
  fitFor: FitFor<G>,
): { ranked: ScoredItem<G>[]; notInYourSize: number } {
  const ranked: ScoredItem<G>[] = [];
  let notInYourSize = 0;
  catalog.forEach((garment, catalogIndex) => {
    if (!isEligible(state, garment.id)) return;
    const fit = fitFor(garment);
    if (!fit || fit.recommendedSize === null) {
      notInYourSize += 1;
      return;
    }
    ranked.push(scoreItem(state, garment, fit, catalogIndex));
  });
  ranked.sort((a, b) => b.score - a.score || a.catalogIndex - b.catalogIndex);
  return { ranked, notInYourSize };
}

/** Exploration deal: dealIndex 4, 9, 14, … (the 5th, 10th, … card). */
export function isExplorationDeal(dealIndex: number): boolean {
  return dealIndex % EXPLORATION_EVERY === EXPLORATION_EVERY - 1;
}

function sameHueAndCategory(a: ScoredItem, b: ScoredItem): boolean {
  return a.features.hue === b.features.hue && a.garment.category === b.garment.category;
}

/**
 * Rule 5 — turn a ranked list into deal order for the next `n` deals starting at `state.dealIndex`:
 * - exploration deal → best item whose dominant axis ≠ the user's top axis (falls back to the top item);
 * - otherwise the top item;
 * - diversity: when the pick shares (hue, category) with the previously dealt card, the next item in
 *   rank order is dealt instead and the pick keeps its position for the following deal.
 */
export function orderDeals<G extends DeckGarment>(ranked: readonly ScoredItem<G>[], state: TasteState, n: number): ScoredItem<G>[] {
  const remaining = [...ranked];
  const out: ScoredItem<G>[] = [];
  const userTop = topAxis(state.profile.axes);
  let prev: ScoredItem<G> | null = null;
  for (let k = 0; k < n && remaining.length > 0; k += 1) {
    let i = 0;
    if (isExplorationDeal(state.dealIndex + k)) {
      const j = remaining.findIndex((it) => dominantAxis(it.features.axes) !== userTop);
      if (j >= 0) i = j;
    }
    if (prev && i + 1 < remaining.length && sameHueAndCategory(remaining[i] as ScoredItem, prev)) i += 1;
    const [pick] = remaining.splice(i, 1) as [ScoredItem<G>];
    out.push(pick);
    prev = pick;
  }
  return out;
}

/**
 * rankDeck(catalog, state, fitFor, n) → the next `n` cards in deal order plus `notInYourSize`.
 * Pure; re-run after every swipe.
 */
export function rankDeck<G extends DeckGarment>(
  catalog: readonly G[],
  state: TasteState,
  fitFor: FitFor<G>,
  n: number = catalog.length,
): RankDeckResult<G> {
  const { ranked, notInYourSize } = rankCandidates(catalog, state, fitFor);
  const deck = orderDeals(ranked, state, Math.max(0, n)).map((it) => it.garment);
  return { deck, notInYourSize, ranked };
}

/**
 * Deal one card: the first card of `rankDeck(...)`, then `dealIndex += 1` and every penalty entry
 * loses one card (entries at 0 are dropped). When nothing can be dealt the state is returned as-is.
 */
export function dealNext<G extends DeckGarment>(catalog: readonly G[], state: TasteState, fitFor: FitFor<G>): DealNextResult<G> {
  const { ranked, notInYourSize } = rankCandidates(catalog, state, fitFor);
  const [card] = orderDeals(ranked, state, 1);
  if (!card) return { state, card: null, notInYourSize };
  return {
    state: { ...state, dealIndex: state.dealIndex + 1, penalties: tickPenalties(state.penalties) },
    card,
    notInYourSize,
  };
}
