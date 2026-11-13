/**
 * Carry-over findings from docs/ENGINE-HANDOFF.md closed in the engine:
 * #22 item ids are namespaced by shop in the seen memory (penalty memory stays feature-based),
 * #24 an unknown size on save is the explicit marker, never null or a guessed label,
 * #20 items without fit points (accessories) get a neutral fit term in rankDeck.
 */
import { mockGarment } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import {
  BASE_WEIGHTS,
  NEUTRAL_FIT_SCORE,
  SEEN_FOREVER,
  UNKNOWN_SIZE,
  applySwipe,
  baseScore,
  dealNext,
  emptyState,
  featurize,
  garmentKey,
  isEligible,
  isSaveOutboxEntry,
  itemKey,
  neutralFitScore,
  penalty,
  rankDeck,
  type DeckGarment,
  type FitResultLike,
} from './index';

const SHOP_A = '00000000-0000-4000-8000-00000000000a';
const SHOP_B = '00000000-0000-4000-8000-00000000000b';
const NOW = 1_762_200_000_000;
const WRAP = mockGarment('aalter-studio-1');
const FIT_M: FitResultLike = { recommendedSize: 'M', score: 1 };

describe('#22 seen memory is keyed by shop and item', () => {
  const a: DeckGarment = { ...WRAP, shopId: SHOP_A };
  const b: DeckGarment = { ...WRAP, shopId: SHOP_B };

  it('itemKey joins shop and id; a garment without a shop keeps its bare id', () => {
    expect(itemKey(SHOP_A, 'x:1')).toBe(`${SHOP_A}:x:1`);
    expect(itemKey(null, 'x')).toBe('x');
    expect(garmentKey(a)).toBe(`${SHOP_A}:aalter-studio-1`);
    expect(garmentKey(WRAP)).toBe('aalter-studio-1');
  });

  it('a love in shop A does not hide the same item id in shop B', () => {
    const { state } = applySwipe(emptyState(), a, FIT_M, 'love', NOW);
    expect(state.seen[garmentKey(a)]).toBe(SEEN_FOREVER);
    expect(state.seen['aalter-studio-1']).toBeUndefined();
    expect(isEligible(state, garmentKey(a))).toBe(false);
    expect(isEligible(state, garmentKey(b))).toBe(true);
    const deck = rankDeck([a, b], state, () => FIT_M).deck;
    expect(deck).toHaveLength(1);
    expect(deck[0]?.shopId).toBe(SHOP_B);
    expect(dealNext([a, b], state, () => FIT_M).card?.garment.shopId).toBe(SHOP_B);
  });

  it('a pass resurfaces per shop', () => {
    const { state } = applySwipe({ ...emptyState(), dealIndex: 7 }, a, FIT_M, 'pass', NOW);
    expect(state.seen[garmentKey(a)]).toBe(7);
    expect(rankDeck([a, b], state, () => FIT_M).deck.map((g) => g.shopId)).toEqual([SHOP_B]);
  });

  it("the penalty memory stays feature-based: a 'less' in shop A still damps the same look in shop B", () => {
    const { state } = applySwipe(emptyState(), a, FIT_M, 'less', NOW);
    expect(state.penalties).toHaveLength(1);
    expect(penalty(state.penalties, featurize(b))).toBeGreaterThan(0);
  });

  it('the save marker carries the shop', () => {
    const { state } = applySwipe(emptyState(), a, FIT_M, 'save', NOW);
    expect(state.outbox.filter(isSaveOutboxEntry)).toEqual([{ type: 'save', itemId: 'aalter-studio-1', shopId: SHOP_A, size: 'M' }]);
  });
});

describe('#24 unknown size on save', () => {
  it('is the explicit marker when nothing was recommended or no fit was computed', () => {
    for (const fit of [null, { recommendedSize: null, score: null }] as const) {
      const { state } = applySwipe(emptyState(), WRAP, fit, 'save', NOW);
      const [marker] = state.outbox.filter(isSaveOutboxEntry);
      expect(marker?.size).toBe(UNKNOWN_SIZE);
      expect(marker?.size).not.toBe('ONE');
    }
    expect(UNKNOWN_SIZE).toBe('unknown');
  });

  it('keeps a real recommended size, including a chart that is literally "ONE"', () => {
    const { state } = applySwipe(emptyState(), WRAP, { recommendedSize: 'ONE', score: null }, 'save', NOW);
    expect(state.outbox.filter(isSaveOutboxEntry)[0]?.size).toBe('ONE');
  });
});

describe('#20 items without fit points get a neutral fit term', () => {
  // Same look for every card, so only the fit term differs.
  const garments: DeckGarment[] = [0.2, 0.4, 0.6, 0.8, 1].map((_, i) => ({ ...WRAP, id: `dress-${i}` }));
  const scores = [0.2, 0.4, 0.6, 0.8, 1];
  const belt: DeckGarment = { ...WRAP, id: 'belt-1' };
  const fitFor = (g: DeckGarment): FitResultLike => (g.id === 'belt-1' ? { recommendedSize: 'ONE', score: null } : { recommendedSize: 'M', score: scores[Number(g.id.slice(-1))] as number });

  it('neutralFitScore is the mean of the scored fits, or the midpoint when none is scored', () => {
    expect(neutralFitScore([FIT_M, { recommendedSize: 'S', score: 0.5 }, { recommendedSize: 'ONE', score: null }, { recommendedSize: null, score: 0 }, null])).toBe(0.75);
    expect(neutralFitScore([{ recommendedSize: 'ONE', score: null }])).toBe(NEUTRAL_FIT_SCORE);
    expect(neutralFitScore([])).toBe(NEUTRAL_FIT_SCORE);
    expect(NEUTRAL_FIT_SCORE).toBe(0.5);
  });

  it('an accessory ranks with the average scored item, not below all of them', () => {
    const r = rankDeck([belt, ...garments], emptyState(), fitFor);
    const order = r.ranked.map((it) => it.garment.id);
    const at = order.indexOf('belt-1');
    // mean fit 0.6 → between the 0.8 and the 0.4 items (tie with the 0.6 item, broken by catalogue order)
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(order.length - 1);
    const beltItem = r.ranked[at]!;
    const mid = r.ranked.find((it) => it.garment.id === 'dress-2')!;
    expect(beltItem.base).toBeCloseTo(mid.base, 10);
    // The old behaviour (fit term 0) put it last.
    const f = featurize(belt);
    expect(baseScore(emptyState().profile, f, { recommendedSize: 'ONE', score: null }, 0)).toBeLessThan(Math.min(...r.ranked.filter((it) => it.garment.id !== 'belt-1').map((it) => it.base)));
  });

  it('over many decks an accessory is not systematically ranked below scored items', () => {
    let below = 0;
    let above = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const s = scores.map((_, i) => ((seed * 37 + i * 101) % 100) / 100);
      const ff = (g: DeckGarment): FitResultLike => (g.id === 'belt-1' ? { recommendedSize: 'ONE', score: null } : { recommendedSize: 'M', score: s[Number(g.id.slice(-1))] as number });
      const r = rankDeck([...garments, belt], emptyState(), ff);
      const beltBase = r.ranked.find((it) => it.garment.id === 'belt-1')!.base;
      for (const it of r.ranked) {
        if (it.garment.id === 'belt-1') continue;
        if (it.base > beltBase + 1e-12) below += 1;
        else if (it.base < beltBase - 1e-12) above += 1;
      }
    }
    // Mean-centred: the accessory sits below about half of the scored items and above the rest.
    const share = below / (below + above);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
  });

  it('a deck with no scored item at all (no measurements) gives every card the same fit term', () => {
    const r = rankDeck([belt, ...garments], emptyState(), () => ({ recommendedSize: 'unknown', score: null }));
    const bases = new Set(r.ranked.map((it) => it.base.toFixed(12)));
    expect(bases.size).toBe(1);
    expect(r.ranked[0]!.base).toBeCloseTo(baseScore(emptyState().profile, featurize(belt), { recommendedSize: 'M', score: NEUTRAL_FIT_SCORE }), 12);
    expect(BASE_WEIGHTS.fit * NEUTRAL_FIT_SCORE).toBeCloseTo(0.075, 12);
  });
});
