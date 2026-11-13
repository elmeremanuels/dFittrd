/**
 * Penalty memory — handoff §5 'less like this' / taste-engine-spec.md §Penalty memory.
 * A `less` swipe penalises the item's (hue, fabric, cut) triple for the next 50 cards.
 */
import { PENALTY_CARDS, PENALTY_MAX_STRENGTH, type ItemFeatures, type PenaltyEntry } from './types';

export const PENALTY_FULL_MATCH = 0.35;
export const PENALTY_TWO_MATCH = 0.12;

/** Record a `less` on `f`: refresh an identical triple (+0.5 strength, cap 2) or push a new entry. */
export function addPenalty(penalties: readonly PenaltyEntry[], f: Pick<ItemFeatures, 'hue' | 'fabric' | 'cut'>): PenaltyEntry[] {
  let found = false;
  const next = penalties.map((p) => {
    if (p.hue === f.hue && p.fabric === f.fabric && p.cut === f.cut) {
      found = true;
      return { ...p, remainingCards: PENALTY_CARDS, strength: Math.min(PENALTY_MAX_STRENGTH, p.strength + 0.5) };
    }
    return p;
  });
  if (!found) next.push({ hue: f.hue, fabric: f.fabric, cut: f.cut, remainingCards: PENALTY_CARDS, strength: 1 });
  return next;
}

/** One deal happened: every entry loses a card; entries at 0 are dropped. */
export function tickPenalties(penalties: readonly PenaltyEntry[]): PenaltyEntry[] {
  const out: PenaltyEntry[] = [];
  for (const p of penalties) {
    const remainingCards = p.remainingCards - 1;
    if (remainingCards > 0) out.push({ ...p, remainingCards });
  }
  return out;
}

/** Σ over entries: all three match → 0.35·strength; exactly two → 0.12·strength; else 0. */
export function penalty(penalties: readonly PenaltyEntry[], f: Pick<ItemFeatures, 'hue' | 'fabric' | 'cut'>): number {
  let total = 0;
  for (const p of penalties) {
    const matches = (p.hue === f.hue ? 1 : 0) + (p.fabric === f.fabric ? 1 : 0) + (p.cut === f.cut ? 1 : 0);
    if (matches === 3) total += PENALTY_FULL_MATCH * p.strength;
    else if (matches === 2) total += PENALTY_TWO_MATCH * p.strength;
  }
  return total;
}
