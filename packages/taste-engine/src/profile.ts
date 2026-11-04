/**
 * Fresh state, onboarding vibes and price helpers — taste-engine-spec.md.
 */
import { AXES, type Axis, type TasteProfile, type TasteState } from './types';
import { clamp, fillAxes, nearestRankPercentile, round4, zeroAxes } from './util';

export function emptyProfile(): TasteProfile {
  return {
    version: 1,
    axes: fillAxes(0.5),
    silhouette: { fitted: 0, regular: 0, relaxed: 0, oversized: 0 },
    colour: {},
    fabric: {},
    cut: {},
    price: { lovedPrices: [], p80: null },
    swipeCount: 0,
    explorationBonus: 0,
  };
}

/** `S0` from the test vectors: axes 0.5, affinities empty, swipeCount 0, dealIndex 0. */
export function emptyState(): TasteState {
  return {
    profile: emptyProfile(),
    penalties: [],
    events: [],
    seen: {},
    dealIndex: 0,
    outbox: [],
    loveCounts: zeroAxes(),
  };
}

/** Onboarding vibe chips → axis. 'Eclectic' is handled separately. */
export const VIBE_AXIS: Readonly<Record<string, Axis>> = Object.freeze({
  Bohemian: 'bohemian',
  Minimal: 'minimal',
  Classic: 'classic',
  'Avant-Garde': 'avantGarde',
  Sporty: 'sporty',
});
export const ECLECTIC_VIBE = 'Eclectic';
export const ONBOARDING_VIBES = Object.freeze([...Object.keys(VIBE_AXIS), ECLECTIC_VIBE]);

/**
 * Each selected vibe axis = 0.75 (others untouched, i.e. 0.5 on a fresh profile).
 * 'Eclectic' → every axis = max(axis, 0.6) and explorationBonus = 0.2. No centring. Idempotent.
 * Unknown vibe strings are ignored.
 */
export function applyOnboardingVibes(state: TasteState, vibes: readonly string[]): TasteState {
  const axes = { ...state.profile.axes };
  let explorationBonus = state.profile.explorationBonus;
  for (const vibe of vibes) {
    const axis = VIBE_AXIS[vibe];
    if (axis) axes[axis] = 0.75;
    else if (vibe === ECLECTIC_VIBE) {
      for (const a of AXES) axes[a] = Math.max(axes[a], 0.6);
      explorationBonus = Math.max(explorationBonus, 0.2);
    }
  }
  for (const a of AXES) axes[a] = round4(clamp(axes[a], 0, 1));
  return { ...state, profile: { ...state.profile, axes, explorationBonus: round4(clamp(explorationBonus, 0, 0.3)) } };
}

/** Nearest-rank 80th percentile once ≥ 5 loved prices exist, else null. */
export function pricePercentile80(lovedPrices: readonly number[]): number | null {
  return lovedPrices.length >= 5 ? nearestRankPercentile(lovedPrices, 0.8) : null;
}

/** priceFit term of the base score: 0.5 without p80; 1 at/below p80; linear to 0 at 2·p80. */
export function priceFit(priceEur: number, p80: number | null): number {
  if (p80 === null) return 0.5;
  if (priceEur <= p80) return 1;
  if (p80 <= 0) return 0;
  return Math.max(0, 1 - (priceEur - p80) / p80);
}
