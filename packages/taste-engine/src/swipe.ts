/**
 * applySwipe / inferPassReasons — taste-engine-spec.md §applySwipe.
 * Pure: returns a new TasteState; the input is never mutated.
 */
import { featurize, styleMatch } from './featurize';
import { addPenalty } from './penalty';
import { pricePercentile80 } from './profile';
import {
  AXES,
  EVENTS_RING_SIZE,
  LOVED_PRICES_KEEP,
  SEEN_FOREVER,
  WARM_UP_MULTIPLIER,
  WARM_UP_SWIPES,
  type DeckGarment,
  type FitResultLike,
  type ItemFeatures,
  type OutboxEntry,
  type PassReason,
  type SwipeAction,
  type SwipeEvent,
  type TasteProfile,
  type TasteState,
} from './types';
import { clamp, dominantAxis, round4 } from './util';

/** Learning rate η per action (also exported by @curtain/schema as SWIPE_LEARNING_RATE). */
export const LEARNING_RATE: Readonly<Record<SwipeAction, number>> = Object.freeze({ love: 0.12, save: 0.18, pass: 0.06, less: 0.2 });
export const SIGN: Readonly<Record<SwipeAction, 1 | -1>> = Object.freeze({ love: 1, save: 1, pass: -1, less: -1 });

/** ηe = η · 1.5 while swipeCount < 20. */
export function effectiveRate(action: SwipeAction, swipeCount: number): number {
  return LEARNING_RATE[action] * (swipeCount < WARM_UP_SWIPES ? WARM_UP_MULTIPLIER : 1);
}

/**
 * Pass reasons, evaluated in order; several may apply; `['unknown']` when none does.
 * - fit: a fit result exists and nothing fits (recommendedSize null) or score < 0.5. A null score
 *   with a size ("No fit points for this item": accessories, one-size charts) means the fit was
 *   never evaluated, so the pass is NOT attributed to fit.
 * - price: p80 known and price > 1.25·p80
 * - colour: swipeCount ≥ 10 and colour[hue] ≤ −0.2
 * - style: swipeCount ≥ 10 and styleMatch < 0.35
 */
export function inferPassReasons(profile: TasteProfile, f: ItemFeatures, fit: FitResultLike | null): PassReason[] {
  const reasons: PassReason[] = [];
  if (fit && (fit.recommendedSize === null || (fit.score !== null && fit.score < 0.5))) reasons.push('fit');
  if (profile.price.p80 !== null && f.priceEur > 1.25 * profile.price.p80) reasons.push('price');
  if (profile.swipeCount >= 10 && (profile.colour[f.hue] ?? 0) <= -0.2) reasons.push('colour');
  if (profile.swipeCount >= 10 && styleMatch(profile.axes, f.axes) < 0.35) reasons.push('style');
  return reasons.length ? reasons : ['unknown'];
}

type Dim = 'axes' | 'colour' | 'fabric' | 'cut' | 'silhouette';
const ALL_DIMS: readonly Dim[] = ['axes', 'colour', 'fabric', 'cut', 'silhouette'];

/** Which profile dimensions a swipe touches, and the rate multiplier (0.5 for an unknown pass). */
export function dimensionsFor(action: SwipeAction, reasons: readonly PassReason[]): { dims: ReadonlySet<Dim>; rateMul: number } {
  if (action !== 'pass') return { dims: new Set(ALL_DIMS), rateMul: 1 };
  if (reasons.includes('unknown')) return { dims: new Set(ALL_DIMS), rateMul: 0.5 };
  const dims = new Set<Dim>();
  if (reasons.includes('colour')) dims.add('colour');
  if (reasons.includes('style')) {
    dims.add('axes');
    dims.add('cut');
    dims.add('silhouette');
  }
  // reasons ⊆ {fit, price}: the user did not reject the style → no profile change.
  return { dims, rateMul: 1 };
}

/** axes[a] += sign·ηe·v[a] (v[a] > 0), clamp, then centre so the mean is 0.5, clamp, round 4 dp. */
export function updateAxes(axes: Readonly<Record<string, number>>, v: Readonly<Partial<Record<string, number>>>, signedRate: number) {
  const next = { ...axes } as Record<(typeof AXES)[number], number>;
  for (const a of AXES) {
    const w = v[a] ?? 0;
    if (w > 0) next[a] = clamp(next[a] + signedRate * w, 0, 1);
  }
  let mean = 0;
  for (const a of AXES) mean += next[a];
  mean /= AXES.length;
  const shift = mean - 0.5;
  for (const a of AXES) next[a] = round4(clamp(next[a] - shift, 0, 1));
  return next;
}

function bump<K extends string>(rec: Readonly<Partial<Record<K, number>>>, key: K, delta: number): Partial<Record<K, number>> {
  return { ...rec, [key]: round4(clamp((rec[key] ?? 0) + delta, -1, 1)) };
}

export interface ApplySwipeResult {
  state: TasteState;
  event: SwipeEvent;
}

/**
 * Apply one swipe. `fit` is the on-device fit result for the card (null when none was computed).
 * `now` is epoch milliseconds. The returned event is also in `state.events` and `state.outbox`.
 * `save` additionally pushes `{type:'save', itemId, size}` to the outbox; the caller adds the
 * item to the wardrobe. `love` never touches the wardrobe (handoff §5).
 */
export function applySwipe(
  state: TasteState,
  garment: DeckGarment,
  fit: FitResultLike | null,
  action: SwipeAction,
  now: number,
): ApplySwipeResult {
  const f = featurize(garment);
  const profile = state.profile;
  const reasons = action === 'pass' ? inferPassReasons(profile, f, fit) : undefined;
  const { dims, rateMul } = dimensionsFor(action, reasons ?? []);
  const rate = effectiveRate(action, profile.swipeCount) * rateMul;
  const signed = SIGN[action] * rate;

  let axes = profile.axes;
  let colour = profile.colour;
  let fabric = profile.fabric;
  let cut = profile.cut;
  let silhouette = profile.silhouette;
  if (dims.has('axes')) axes = updateAxes(axes, f.axes, signed);
  if (dims.has('colour')) colour = bump(colour, f.hue, 2 * signed);
  if (dims.has('fabric')) fabric = bump(fabric, f.fabric, 2 * signed);
  if (dims.has('cut')) cut = bump(cut, f.cut, 2 * signed);
  if (dims.has('silhouette')) silhouette = bump(silhouette, f.silhouette, 2 * signed) as TasteProfile['silhouette'];

  let price = profile.price;
  let loveCounts = state.loveCounts;
  if (action === 'love' || action === 'save') {
    const lovedPrices = [...price.lovedPrices, f.priceEur].slice(-LOVED_PRICES_KEEP);
    price = { lovedPrices, p80: pricePercentile80(lovedPrices) };
    const dom = dominantAxis(f.axes);
    if (dom) loveCounts = { ...loveCounts, [dom]: loveCounts[dom] + 1 };
  }

  const penalties = action === 'less' ? addPenalty(state.penalties, f) : state.penalties;

  const sizeAtSwipe = fit?.recommendedSize ?? null;
  const event: SwipeEvent = {
    itemId: garment.id,
    action,
    at: now,
    sizeAtSwipe,
    fitScore: fit?.score ?? null,
    ...(reasons ? { reasons } : {}),
    dealIndex: state.dealIndex,
  };

  const outbox: OutboxEntry[] = [...state.outbox, event];
  if (action === 'save') outbox.push({ type: 'save', itemId: garment.id, size: sizeAtSwipe });

  const events = [...state.events, event];
  if (events.length > EVENTS_RING_SIZE) events.splice(0, events.length - EVENTS_RING_SIZE);

  const next: TasteState = {
    profile: { ...profile, axes, colour, fabric, cut, silhouette, price, swipeCount: profile.swipeCount + 1 },
    penalties,
    events,
    seen: { ...state.seen, [garment.id]: action === 'pass' ? state.dealIndex : SEEN_FOREVER },
    dealIndex: state.dealIndex,
    outbox,
    loveCounts,
  };
  return { state: next, event };
}

/** Take everything out of the outbox (after a successful sync). */
export function drainOutbox(state: TasteState): { state: TasteState; entries: OutboxEntry[] } {
  return { state: { ...state, outbox: [] }, entries: [...state.outbox] };
}

/** Remove the first `count` outbox entries (after a partial sync). */
export function ackOutbox(state: TasteState, count: number): TasteState {
  return { ...state, outbox: state.outbox.slice(Math.max(0, count)) };
}
