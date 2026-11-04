/**
 * Test vectors 1–16 from docs/research/taste-engine-spec.md, plus purity / persistence checks.
 */
import { mockGarment } from '@paskamer/schema';
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_COPY,
  AXES,
  EVENTS_RING_SIZE,
  SEEN_FOREVER,
  addPenalty,
  applyOnboardingVibes,
  applySwipe,
  dealNext,
  easeTotal,
  emptyState,
  featurize,
  hueBin,
  inferPassReasons,
  isSaveOutboxEntry,
  penalty,
  rankDeck,
  styleDna,
  styleMatch,
  tickPenalties,
  type DeckGarment,
  type FitResultLike,
  type GarmentPayload,
  type TasteState,
} from './index';

const WRAP = mockGarment('aalter-studio-1');
const SLIP = mockGarment('monochrome-02');
const JEANS = mockGarment('raw-denim-01');
const JACKET = mockGarment('indigo-04');

const FIT_M: FitResultLike = { recommendedSize: 'M', score: 1 };
const fitAll = (): FitResultLike => FIT_M;
const NOW = 1_762_200_000_000;

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

function withSwipes(state: TasteState, n: number, garment: DeckGarment = WRAP): TasteState {
  let s = state;
  for (let i = 0; i < n; i += 1) s = applySwipe(s, { ...garment, id: `${garment.id}-${i}` }, FIT_M, 'love', NOW + i).state;
  return s;
}

const near = (received: number, expected: number, tol = 0.001) => expect(Math.abs(received - expected)).toBeLessThanOrEqual(tol);

describe('fixtures used by the vectors', () => {
  it('match the spec identities', () => {
    expect(WRAP.styleTags).toEqual({ bohemian: 0.9, classic: 0.3 });
    expect(JACKET.styleTags).toEqual({ classic: 0.5, sporty: 0.3 });
    expect(JACKET.primaryColorHex).toBe('#1E2B4D');
    expect(JACKET.fabric.primary).toBe('denim');
    expect(JACKET.patternBlock).toBe('trucker');
    expect(JACKET.priceEur).toBe(150);
  });
});

describe('1. onboarding vibes', () => {
  it("['Bohemian','Avant-Garde'] → .75 on those axes, others .5", () => {
    const s = applyOnboardingVibes(emptyState(), ['Bohemian', 'Avant-Garde']);
    expect(s.profile.axes).toEqual({ bohemian: 0.75, minimal: 0.5, classic: 0.5, avantGarde: 0.75, sporty: 0.5 });
    expect(s.profile.explorationBonus).toBe(0);
  });
  it("['Eclectic'] → every axis .6 and explorationBonus .2", () => {
    const s = applyOnboardingVibes(emptyState(), ['Eclectic']);
    expect(s.profile.axes).toEqual({ bohemian: 0.6, minimal: 0.6, classic: 0.6, avantGarde: 0.6, sporty: 0.6 });
    expect(s.profile.explorationBonus).toBe(0.2);
  });
  it('is idempotent', () => {
    const once = applyOnboardingVibes(emptyState(), ['Bohemian', 'Eclectic']);
    const twice = applyOnboardingVibes(once, ['Bohemian', 'Eclectic']);
    expect(twice).toEqual(once);
    expect(once.profile.axes.bohemian).toBe(0.75);
    expect(once.profile.axes.minimal).toBe(0.6);
  });
  it('ignores unknown vibes and does not centre', () => {
    const s = applyOnboardingVibes(emptyState(), ['Goth', 'Sporty']);
    expect(s.profile.axes).toEqual({ bohemian: 0.5, minimal: 0.5, classic: 0.5, avantGarde: 0.5, sporty: 0.75 });
  });
});

describe('2. featurize', () => {
  it('WRAP → bohemian .9, classic .3; orange / linen / wrap / relaxed', () => {
    const f = featurize(WRAP);
    expect(f.axes).toEqual({ bohemian: 0.9, classic: 0.3, minimal: 0, avantGarde: 0, sporty: 0 });
    expect(f.hue).toBe('orange');
    expect(f.fabric).toBe('linen');
    expect(f.cut).toBe('wrap');
    expect(f.silhouette).toBe('relaxed');
    expect(easeTotal(WRAP)).toBe(18);
    expect(f.priceEur).toBe(149);
  });
  it('JEANS → classic .6, minimal .3, sporty .3; blue', () => {
    const f = featurize(JEANS);
    expect(f.axes).toEqual({ classic: 0.6, minimal: 0.3, sporty: 0.3, bohemian: 0, avantGarde: 0 });
    expect(f.hue).toBe('blue');
  });
  it("'#EAEAEA' → white", () => {
    expect(hueBin('#EAEAEA')).toBe('white');
    expect(featurize(SLIP).hue).toBe('white');
  });
  it('infers the same axes from the block + fabric tables when styleTags are absent', () => {
    const { styleTags: _w, ...wrapNoTags } = WRAP;
    const { styleTags: _j, ...jeansNoTags } = JEANS;
    const { styleTags: _s, ...slipNoTags } = SLIP;
    expect(featurize(wrapNoTags).axes).toEqual(featurize(WRAP).axes);
    expect(featurize(jeansNoTags).axes).toEqual(featurize(JEANS).axes);
    expect(featurize(slipNoTags).axes).toEqual({ minimal: 0.8, classic: 0.4, bohemian: 0, avantGarde: 0, sporty: 0 });
  });
  it('uses block then category ease defaults when the garment omits ease', () => {
    const { ease: _e, ...wrapNoEase } = WRAP;
    expect(easeTotal(wrapNoEase)).toBe(18); // BLOCK_EASE.wrap = 6+4+8
    expect(easeTotal({ ...wrapNoEase, patternBlock: 'unknown-block' })).toBe(16); // dress category 6+4+6
    expect(featurize({ ...wrapNoEase, patternBlock: 'bodycon' }).silhouette).toBe('regular'); // 2+2+2 = 6
    expect(featurize({ ...wrapNoEase, patternBlock: 'oversized' }).silhouette).toBe('relaxed'); // 14+4+6 = 24
  });
  it('styleMatch is 0.5 for a zero vector and a dot/weight ratio otherwise', () => {
    expect(styleMatch(emptyState().profile.axes, { bohemian: 0, minimal: 0, classic: 0, avantGarde: 0, sporty: 0 })).toBe(0.5);
    near(styleMatch({ bohemian: 1, minimal: 0, classic: 0.5, avantGarde: 0, sporty: 0 }, { bohemian: 0.9, classic: 0.3 }), (0.9 + 0.15) / 1.2);
  });
});

describe('3. love WRAP from S0', () => {
  const { state, event } = applySwipe(emptyState(), WRAP, FIT_M, 'love', NOW);
  it('axes are centred (ηe = 0.18)', () => {
    const a = state.profile.axes;
    near(a.bohemian, 0.6188);
    near(a.classic, 0.5108);
    near(a.minimal, 0.4568);
    near(a.avantGarde, 0.4568);
    near(a.sporty, 0.4568);
  });
  it('affinities move by 2ηe = 0.36', () => {
    near(state.profile.colour.orange as number, 0.36);
    near(state.profile.fabric.linen as number, 0.36);
    near(state.profile.cut.wrap as number, 0.36);
    near(state.profile.silhouette.relaxed, 0.36);
  });
  it('counts the swipe and logs the event; outbox holds only the event', () => {
    expect(state.profile.swipeCount).toBe(1);
    expect(event).toMatchObject({ itemId: 'aalter-studio-1', action: 'love', sizeAtSwipe: 'M', fitScore: 1, at: NOW, dealIndex: 0 });
    expect(event.reasons).toBeUndefined();
    expect(state.events).toEqual([event]);
    expect(state.outbox).toEqual([event]);
    expect(state.outbox.some(isSaveOutboxEntry)).toBe(false);
    expect(state.seen['aalter-studio-1']).toBe(SEEN_FOREVER);
    expect(state.profile.price.lovedPrices).toEqual([149]);
    expect(state.profile.price.p80).toBeNull();
  });
});

describe('4. save WRAP from S0', () => {
  const { state } = applySwipe(emptyState(), WRAP, FIT_M, 'save', NOW);
  it('axes (ηe = 0.27)', () => {
    near(state.profile.axes.bohemian, 0.6782);
    near(state.profile.axes.classic, 0.5162);
    for (const a of ['minimal', 'avantGarde', 'sporty'] as const) near(state.profile.axes[a], 0.4352);
    near(state.profile.colour.orange as number, 0.54);
  });
  it('pushes a save marker to the outbox', () => {
    expect(state.outbox).toHaveLength(2);
    expect(state.outbox[1]).toEqual({ type: 'save', itemId: 'aalter-studio-1', size: 'M' });
    expect(state.outbox.filter(isSaveOutboxEntry)).toHaveLength(1);
  });
});

describe('5. pass with fit score 0.2', () => {
  const s0 = emptyState();
  const { state, event } = applySwipe(s0, WRAP, { recommendedSize: 'M', score: 0.2 }, 'pass', NOW);
  it("reasons ['fit'], profile unchanged except swipeCount", () => {
    expect(event.reasons).toEqual(['fit']);
    expect(state.profile).toEqual({ ...s0.profile, swipeCount: 1 });
    expect(state.seen).toEqual({ 'aalter-studio-1': 0 });
    expect(state.events[0]?.reasons).toEqual(['fit']);
  });
  it('fit reason also fires when nothing fits; price reason needs p80', () => {
    expect(inferPassReasons(s0.profile, featurize(WRAP), { recommendedSize: null, score: 0.9 })).toEqual(['fit']);
    expect(inferPassReasons(s0.profile, featurize(WRAP), null)).toEqual(['unknown']);
    const pricey = { ...s0.profile, price: { lovedPrices: [50, 50, 50, 50, 50], p80: 50 } };
    expect(inferPassReasons(pricey, featurize(WRAP), FIT_M)).toEqual(['price']);
    const { state: afterPrice } = applySwipe({ ...s0, profile: pricey }, WRAP, FIT_M, 'pass', NOW);
    expect(afterPrice.profile.axes).toEqual(s0.profile.axes);
    expect(afterPrice.profile.colour).toEqual({});
  });
  it("an 'unknown' pass updates every dimension at ηe/2", () => {
    const { state: st } = applySwipe(s0, WRAP, null, 'pass', NOW);
    near(st.profile.colour.orange as number, -2 * 0.06 * 1.5 * 0.5);
    expect(st.profile.axes.bohemian).toBeLessThan(0.5);
  });
});

describe('6. pass for colour', () => {
  const s0 = emptyState();
  const s = { ...s0, profile: { ...s0.profile, swipeCount: 12, colour: { blue: -0.3 } } };
  const { state, event } = applySwipe(s, JEANS, FIT_M, 'pass', NOW);
  it("reasons ['colour'], colour.blue → −0.48, axes unchanged", () => {
    expect(event.reasons).toEqual(['colour']);
    near(state.profile.colour.blue as number, -0.48);
    expect(state.profile.axes).toEqual(s0.profile.axes);
    expect(state.profile.fabric).toEqual({});
    expect(state.profile.cut).toEqual({});
  });
  it("a 'style' pass updates axes, cut and silhouette but not colour/fabric", () => {
    const styleState = { ...s0, profile: { ...s0.profile, swipeCount: 12, axes: { bohemian: 0.9, minimal: 0.1, classic: 0.1, avantGarde: 0.8, sporty: 0.1 } } };
    const { state: st, event: ev } = applySwipe(styleState, JEANS, FIT_M, 'pass', NOW);
    expect(ev.reasons).toEqual(['style']);
    expect(st.profile.colour).toEqual({});
    expect(st.profile.fabric).toEqual({});
    near(st.profile.cut.straight as number, -0.18);
    near(st.profile.silhouette.regular, -0.18);
    expect(st.profile.axes).not.toEqual(styleState.profile.axes);
  });
});

describe('7. less JEANS from S0', () => {
  const { state } = applySwipe(emptyState(), JEANS, FIT_M, 'less', NOW);
  it('axes (ηe = 0.30)', () => {
    near(state.profile.axes.classic, 0.392);
    near(state.profile.axes.minimal, 0.482);
    near(state.profile.axes.sporty, 0.482);
    near(state.profile.axes.bohemian, 0.572);
    near(state.profile.axes.avantGarde, 0.572);
  });
  it('affinities −0.6 and one penalty entry', () => {
    near(state.profile.colour.blue as number, -0.6);
    near(state.profile.fabric.denim as number, -0.6);
    near(state.profile.cut.straight as number, -0.6);
    expect(state.penalties).toEqual([{ hue: 'blue', fabric: 'denim', cut: 'straight', remainingCards: 50, strength: 1 }]);
    expect(state.seen['raw-denim-01']).toBe(SEEN_FOREVER);
  });
});

describe('8. penalty lifecycle', () => {
  const { state } = applySwipe(emptyState(), JEANS, FIT_M, 'less', NOW);
  const catalog = [WRAP, SLIP, JACKET];
  it('after 49 deals remainingCards is 1; after the 50th the entry is gone', () => {
    let s = state;
    for (let i = 0; i < 49; i += 1) s = dealNext(catalog, s, fitAll).state;
    expect(s.penalties[0]?.remainingCards).toBe(1);
    expect(s.dealIndex).toBe(49);
    s = dealNext(catalog, s, fitAll).state;
    expect(s.penalties).toEqual([]);
  });
  it('swipes do not decrement, deals do', () => {
    const { state: s } = applySwipe(state, WRAP, FIT_M, 'love', NOW);
    expect(s.penalties[0]?.remainingCards).toBe(50);
    let p = state.penalties;
    for (let i = 0; i < 20; i += 1) p = tickPenalties(p);
    expect(p[0]?.remainingCards).toBe(30);
  });
  it('a second less on the same triple refreshes to 50 and strength 1.5; cap at 2', () => {
    let p = state.penalties;
    for (let i = 0; i < 20; i += 1) p = tickPenalties(p);
    expect(p[0]?.remainingCards).toBe(30);
    const f = featurize(JEANS);
    p = addPenalty(p, f);
    expect(p).toEqual([{ hue: 'blue', fabric: 'denim', cut: 'straight', remainingCards: 50, strength: 1.5 }]);
    p = addPenalty(addPenalty(p, f), f);
    expect(p[0]?.strength).toBe(2);
    expect(p).toHaveLength(1);
  });
  it('a different triple is a separate entry', () => {
    const p = addPenalty(state.penalties, featurize(JACKET));
    expect(p).toHaveLength(2);
  });
});

describe('9. penalty scoring', () => {
  const entry = applySwipe(emptyState(), JEANS, FIT_M, 'less', NOW).state.penalties;
  it('3-match 0.35, 2-match 0.12, otherwise 0', () => {
    near(penalty(entry, featurize(JEANS)), 0.35);
    near(penalty(entry, { hue: 'blue', fabric: 'denim', cut: 'wide-leg' }), 0.12);
    expect(penalty(entry, featurize(WRAP))).toBe(0);
  });
  it('scales with strength 1.5 → 0.525 / 0.18', () => {
    const strong = entry.map((p) => ({ ...p, strength: 1.5 }));
    near(penalty(strong, featurize(JEANS)), 0.525);
    near(penalty(strong, { hue: 'blue', fabric: 'denim', cut: 'wide-leg' }), 0.18);
  });
});

describe('10. rankDeck on S0', () => {
  const catalog = [WRAP, SLIP, JEANS];
  it('every base = 0.575 → catalogue order, notInYourSize 0', () => {
    const r = rankDeck(catalog, emptyState(), fitAll, 3);
    for (const it of r.ranked) near(it.base, 0.575);
    expect(r.deck.map((g) => g.id)).toEqual(['aalter-studio-1', 'monochrome-02', 'raw-denim-01']);
    expect(r.notInYourSize).toBe(0);
  });
  it('JEANS with recommendedSize null is excluded and counted', () => {
    const r = rankDeck(catalog, emptyState(), (g) => (g.id === 'raw-denim-01' ? { recommendedSize: null, score: 0 } : FIT_M), 3);
    expect(r.deck.map((g) => g.id)).toEqual(['aalter-studio-1', 'monochrome-02']);
    expect(r.notInYourSize).toBe(1);
  });
  it('defaults n to the catalogue size and respects smaller n', () => {
    expect(rankDeck(catalog, emptyState(), fitAll).deck).toHaveLength(3);
    expect(rankDeck(catalog, emptyState(), fitAll, 2).deck).toHaveLength(2);
  });
});

describe('11. rankDeck after test 7', () => {
  const { state } = applySwipe(emptyState(), JEANS, FIT_M, 'less', NOW);
  const r = rankDeck([WRAP, SLIP, JEANS, JACKET], state, fitAll, 4);
  const byId = Object.fromEntries(r.ranked.map((it) => [it.garment.id, it]));
  it('JEANS excluded (seen), JACKET 0.4553 − 0.12 = 0.3353, WRAP 0.5858', () => {
    expect(byId['raw-denim-01']).toBeUndefined();
    near(byId['indigo-04']?.base as number, 0.4553);
    near(byId['indigo-04']?.penalty as number, 0.12);
    near(byId['indigo-04']?.score as number, 0.3353);
    near(byId['aalter-studio-1']?.score as number, 0.5858);
    expect(r.deck.map((g) => g.id)).toEqual(['aalter-studio-1', 'monochrome-02', 'indigo-04']);
    expect(r.notInYourSize).toBe(0);
  });
});

describe('12. exploration', () => {
  const s = { ...applyOnboardingVibes(emptyState(), ['Bohemian']), dealIndex: 4 };
  const catalog = [WRAP, SLIP, JEANS];
  it('the 5th deal is the best item whose dominant axis ≠ bohemian', () => {
    const top = rankDeck(catalog, { ...s, dealIndex: 3 }, fitAll, 1);
    expect(top.deck[0]?.id).toBe('aalter-studio-1');
    expect(top.ranked[0]?.score).toBeGreaterThan(top.ranked[1]?.score as number);
    const dealt = dealNext(catalog, s, fitAll);
    expect(dealt.card?.garment.id).toBe('monochrome-02');
    expect(dealt.state.dealIndex).toBe(5);
    expect(rankDeck(catalog, s, fitAll, 3).deck.map((g) => g.id)).toEqual(['monochrome-02', 'aalter-studio-1', 'raw-denim-01']);
  });
  it('falls back to the top item when every candidate shares the top axis', () => {
    expect(dealNext([WRAP], s, fitAll).card?.garment.id).toBe('aalter-studio-1');
  });
  it('explorationBonus lifts items of the least-loved axes', () => {
    const eclectic = applyOnboardingVibes(emptyState(), ['Eclectic']);
    const loved = withSwipes(eclectic, 3, WRAP); // bohemian loved 3×
    const r = rankDeck([WRAP, SLIP, JEANS], loved, fitAll);
    const bohemianItem = r.ranked.find((it) => it.garment.id === 'aalter-studio-1');
    const minimalItem = r.ranked.find((it) => it.garment.id === 'monochrome-02');
    expect(bohemianItem?.novelty).toBe(0);
    expect(minimalItem?.novelty).toBe(1);
    near((minimalItem?.score as number) - (minimalItem?.base as number), 0.2);
  });
});

describe('13. diversity', () => {
  it('two orange dresses ranked 1–2 and a blue top 3 → dress, top, dress', () => {
    const dressB: GarmentPayload = { ...WRAP, id: 'orange-dress-2' };
    const blueTop: GarmentPayload = { ...SLIP, id: 'blue-top', primaryColorHex: '#1E2B4D' };
    const r = rankDeck([WRAP, dressB, blueTop], emptyState(), fitAll, 3);
    expect(r.ranked.map((it) => it.garment.id)).toEqual(['aalter-studio-1', 'orange-dress-2', 'blue-top']);
    expect(r.deck.map((g) => g.id)).toEqual(['aalter-studio-1', 'blue-top', 'orange-dress-2']);
  });
  it('does not defer when the categories differ', () => {
    const orangeTop: GarmentPayload = { ...SLIP, id: 'orange-top', primaryColorHex: '#C97A4F' };
    const r = rankDeck([WRAP, orangeTop, SLIP], emptyState(), fitAll, 3);
    expect(r.deck.map((g) => g.id)).toEqual(['aalter-studio-1', 'orange-top', 'monochrome-02']);
  });
});

describe('14. re-surfacing', () => {
  const s10 = { ...emptyState(), dealIndex: 10 };
  const passed = applySwipe(s10, WRAP, FIT_M, 'pass', NOW).state;
  const loved = applySwipe(s10, SLIP, FIT_M, 'love', NOW).state;
  it('a pass at dealIndex 10 is excluded at 150 and eligible at 210', () => {
    expect(rankDeck([WRAP], { ...passed, dealIndex: 150 }, fitAll).deck).toEqual([]);
    expect(rankDeck([WRAP], { ...passed, dealIndex: 209 }, fitAll).deck).toEqual([]);
    expect(rankDeck([WRAP], { ...passed, dealIndex: 210 }, fitAll).deck.map((g) => g.id)).toEqual(['aalter-studio-1']);
  });
  it('a loved item is never re-dealt', () => {
    expect(rankDeck([SLIP], { ...loved, dealIndex: 100_000 }, fitAll).deck).toEqual([]);
  });
});

describe('15. persistence round-trip', () => {
  it('JSON round-trips deep-equal and events never exceed 500', () => {
    let s = applyOnboardingVibes(emptyState(), ['Bohemian']);
    const catalog = [WRAP, SLIP, JEANS, JACKET];
    const actions = ['love', 'pass', 'save', 'less'] as const;
    for (let i = 0; i < 520; i += 1) {
      const g = { ...(catalog[i % 4] as GarmentPayload), id: `item-${i}` };
      s = dealNext([g], s, fitAll).state;
      s = applySwipe(s, g, i % 7 === 0 ? null : { recommendedSize: 'M', score: (i % 10) / 10 }, actions[i % 4] as (typeof actions)[number], NOW + i).state;
    }
    expect(s.events.length).toBe(EVENTS_RING_SIZE);
    expect(s.events[0]?.itemId).toBe('item-20');
    expect(s.profile.price.lovedPrices.length).toBeLessThanOrEqual(50);
    expect(s.profile.price.p80).not.toBeNull();
    const copy = JSON.parse(JSON.stringify(s)) as TasteState;
    expect(copy).toEqual(s);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s));
  });
});

describe('16. purity', () => {
  it('applySwipe leaves frozen inputs unchanged, returns a new object, and is deterministic', () => {
    const s0 = deepFreeze(emptyState());
    const g = deepFreeze({ ...WRAP });
    const fit = deepFreeze({ recommendedSize: 'M', score: 1 });
    const snapshot = JSON.stringify(s0);
    const a = applySwipe(s0, g, fit, 'love', NOW);
    const b = applySwipe(s0, g, fit, 'love', NOW);
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(a.state).not.toBe(s0);
    expect(a.state.profile).not.toBe(s0.profile);
    expect(a).toEqual(b);
    expect(a.state.profile.swipeCount).toBe(1);
  });
  it('rankDeck / dealNext / applyOnboardingVibes do not mutate frozen inputs', () => {
    const s = deepFreeze(applySwipe(emptyState(), JEANS, FIT_M, 'less', NOW).state);
    const catalog = deepFreeze([WRAP, SLIP, JACKET]);
    expect(() => rankDeck(catalog, s, fitAll, 3)).not.toThrow();
    expect(() => dealNext(catalog, s, fitAll)).not.toThrow();
    expect(() => applyOnboardingVibes(s, ['Eclectic'])).not.toThrow();
    expect(dealNext(catalog, s, fitAll)).toEqual(dealNext(catalog, s, fitAll));
  });
});

describe('style DNA', () => {
  it('fixed axis order, archetype copy and swipe subtitle', () => {
    const s = applySwipe(applyOnboardingVibes(emptyState(), ['Minimal']), SLIP, FIT_M, 'love', NOW).state;
    const dna = styleDna(s.profile);
    expect(dna.axes.map((a) => a.axis)).toEqual([...AXES]);
    expect(dna.archetype).toBe('minimal');
    expect(dna.archetypeLabel).toBe(ARCHETYPE_COPY.minimal);
    expect(dna.percent).toBe(Math.round(s.profile.axes.minimal * 100));
    expect(dna.subtitle).toBe('Refined by 1 swipes');
    expect(styleDna(emptyState().profile)).toMatchObject({ archetype: 'bohemian', archetypeLabel: 'Free Spirit', percent: 50, subtitle: 'Refined by 0 swipes' });
  });
});

describe('warm-up and price memory', () => {
  it('drops the ×1.5 multiplier at 20 swipes and computes p80 from 5 loved prices', () => {
    const warm = withSwipes(emptyState(), 20);
    expect(warm.profile.swipeCount).toBe(20);
    const before = warm.profile.colour.orange as number;
    const after = applySwipe(warm, { ...WRAP, id: 'x', primaryColorHex: '#1E2B4D' }, FIT_M, 'love', NOW).state;
    near((after.profile.colour.blue as number) - 0, 0.24); // 2·0.12, no warm-up
    expect(after.profile.colour.orange).toBe(before);
    const prices = [10, 20, 30, 40, 50];
    let s = emptyState();
    prices.forEach((p, i) => {
      s = applySwipe(s, { ...WRAP, id: `p${i}`, priceEur: p }, FIT_M, 'love', NOW).state;
    });
    expect(s.profile.price.p80).toBe(40);
    expect(applySwipe(s, { ...WRAP, id: 'p5', priceEur: 40 }, FIT_M, 'love', NOW).state.profile.price.p80).toBe(40);
  });
});
