/**
 * Review regressions (2026-11-04 skeptical pass). Behaviours the sixteen spec vectors do not pin
 * down and where the first implementation gave a wrong answer; see README §Spec deviations.
 */
import { mockGarment } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import {
  applyOnboardingVibes,
  applySwipe,
  emptyState,
  featurize,
  inferPassReasons,
  penalty,
  rankDeck,
  type DeckGarment,
  type FitResultLike,
} from './index';

const WRAP = mockGarment('aalter-studio-1');
const JEANS = mockGarment('raw-denim-01');
const NOW = 1_762_200_000_000;
const near = (received: number, expected: number, tol = 0.001) => expect(Math.abs(received - expected)).toBeLessThanOrEqual(tol);

describe('a pass on an item whose fit was never scored is not a fit rejection', () => {
  // Accessories (and any chart without fit points) come back from the fit engine with
  // recommendedSize = first chart size and score = null ("No fit points for this item").
  const belt: DeckGarment = { ...WRAP, id: 'belt-1', category: 'accessory', patternBlock: 'belt', priceEur: 59 };
  const unscored: FitResultLike = { recommendedSize: 'ONE', score: null };

  it("infers ['unknown'] on a fresh profile, not ['fit']", () => {
    expect(inferPassReasons(emptyState().profile, featurize(belt), unscored)).toEqual(['unknown']);
    // A real fit rejection still fires.
    expect(inferPassReasons(emptyState().profile, featurize(belt), { recommendedSize: 'ONE', score: 0.2 })).toEqual(['fit']);
    expect(inferPassReasons(emptyState().profile, featurize(belt), { recommendedSize: null, score: null })).toEqual(['fit']);
  });

  it('so the pass teaches the profile (ηe/2 on every dimension)', () => {
    const { state, event } = applySwipe(emptyState(), belt, unscored, 'pass', NOW);
    expect(event.reasons).toEqual(['unknown']);
    expect(event.fitScore).toBeNull();
    expect(event.sizeAtSwipe).toBe('ONE');
    near(state.profile.colour.orange as number, -2 * 0.06 * 1.5 * 0.5);
    near(state.profile.fabric.linen as number, -0.09);
    expect(state.profile.axes.bohemian).toBeLessThan(0.5);
  });
});

describe('pattern block and fabric lookups are case- and whitespace-insensitive (as in the fit engine)', () => {
  const shouty: DeckGarment = { ...WRAP, id: 'shouty', patternBlock: ' Wrap ', fabric: { ...WRAP.fabric, primary: 'LINEN' } };
  const { styleTags: _drop, ...untagged } = shouty;

  it('featurize gives the same axes, silhouette and keys as the lower-case garment', () => {
    const a = featurize({ ...untagged });
    const { styleTags: _d2, ...plain } = WRAP;
    const b = featurize(plain);
    expect(a.axes).toEqual(b.axes);
    expect(a.silhouette).toBe('relaxed');
    expect(a.cut).toBe('wrap');
    expect(a.fabric).toBe('linen');
  });

  it("so a 'less' on the shouty item and a later lower-case item share one penalty triple", () => {
    const { state } = applySwipe(emptyState(), shouty, { recommendedSize: 'M', score: 1 }, 'less', NOW);
    expect(state.penalties).toEqual([{ hue: 'orange', fabric: 'linen', cut: 'wrap', remainingCards: 50, strength: 1 }]);
    near(penalty(state.penalties, featurize(WRAP)), 0.35);
    near(state.profile.cut.wrap as number, -0.6);
    expect(state.profile.cut.Wrap).toBeUndefined();
  });

  it('and the deck ranks both spellings identically', () => {
    const s = applySwipe(emptyState(), JEANS, { recommendedSize: '28', score: 1 }, 'love', NOW).state;
    const r = rankDeck([{ ...untagged, id: 'a' }, { ...WRAP, id: 'b' }], s, () => ({ recommendedSize: 'M', score: 1 }));
    expect(r.ranked[0]?.score).toBe(r.ranked[1]?.score);
  });
});

describe('onboarding vibe chips tolerate casing and surrounding whitespace', () => {
  it("'bohemian' / ' AVANT-GARDE ' / 'eclectic' map like the canonical labels", () => {
    const a = applyOnboardingVibes(emptyState(), ['bohemian', ' AVANT-GARDE ', 'eclectic']);
    const b = applyOnboardingVibes(emptyState(), ['Bohemian', 'Avant-Garde', 'Eclectic']);
    expect(a).toEqual(b);
    expect(a.profile.axes.bohemian).toBe(0.75);
    expect(a.profile.axes.minimal).toBe(0.6);
    expect(a.profile.explorationBonus).toBe(0.2);
  });
});
