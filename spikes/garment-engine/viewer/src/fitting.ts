/**
 * Fitting on the device (docs/ENGINE-HANDOFF.md §Fitting, steps 1–3 and 5) for the spike viewer.
 *
 * Rule 4: the viewer never computes fit. Size advice, per-anchor gaps, bands and slack come from
 * `@curtain/fit-engine` (`computeFit` → `anchorGaps`); this module only turns those numbers into
 * geometry (where each garment loop sits) and colour (the heat map), and words them. Whether a
 * loop "does not close" is the fit engine's `tight` band, which it derived from the product's own
 * stretch; the display fabric preset (linen, silk) never changes it (R2).
 */
import { BREADTH_RING, gradingMorph, isAnchorBreadth, isAnchorRing, monotoneProfile, type AnchorRing, type AnchorValues, type GradingMorph, type Knot } from '@curtain/anchors';
import { anchorGaps, computeFit, type AnchorGaps, type Band, type FitAnchorId, type FitResult } from '@curtain/fit-engine';
import type { GarmentPayload } from '@curtain/schema';
import type { GradingJson } from '../../src/grading';
import { userBody, type BodyMeasurements } from './body';

/** One fit-engine run for this body and garment; every size's gaps are read from it. */
export function fitForBody(payload: GarmentPayload, meas: BodyMeasurements): FitResult {
  return computeFit(payload, userBody(meas));
}

/** Per-anchor gaps of one size, exactly as the fit engine hands them out. */
export function gapsForSize(result: FitResult, size: string): AnchorGaps | null {
  return anchorGaps(result, size);
}

/**
 * Anchors whose garment loop is placed from the fit engine's slack. `shoulder_width` is a breadth,
 * not a ring with a loop, so its gap only colours the heat map (at the shoulder ring's height).
 */
export const PLACED_ANCHORS = ['chest', 'waist', 'hip'] as const satisfies readonly (FitAnchorId & AnchorRing)[];
export type PlacedAnchor = (typeof PLACED_ANCHORS)[number];

/**
 * Handoff §Fitting step 3: room (slack ≥ 0), stretched onto the body (negative slack the fit engine
 * still accepts), or open (negative slack in the fit engine's `tight` band: does not close).
 */
export type LoopState = 'room' | 'stretched' | 'open';

export interface AnchorPlacement {
  anchor: PlacedAnchor;
  /** Garment girth of this size from grading.json, cm. */
  gradedCm: number;
  /** Avatar ring girth, cm. */
  bodyCm: number;
  /** Fit engine: garment − body, cm. */
  slackCm: number;
  /** Where the loop sits: body + slack, or on the body when the slack is negative. */
  placedCm: number;
  state: LoopState;
  /** The fit engine's band at this anchor (the source of `state`). */
  band: Band | undefined;
}

export interface Placement {
  size: string;
  /** Ring targets of this size (grading.json). */
  graded: AnchorValues;
  /** The same rings after placement. */
  placed: AnchorValues;
  anchors: AnchorPlacement[];
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function sizeEntry(grading: GradingJson, size: string): GradingJson['sizes'][number] {
  const key = size.trim().toUpperCase();
  const entry = grading.sizes.find((s) => s.size.trim().toUpperCase() === key);
  if (!entry) throw new Error(`size ${size} is not in grading.json of ${grading.productId}`);
  return entry;
}

/**
 * Step 2–3: put each fit anchor's loop at body + slack. A negative slack pulls the loop onto the
 * body (tension); when the fit engine bands that anchor `tight` (beyond the stretch-adjusted limit
 * it computed from the product's fabric) the loop is marked `open`. Rings without a fit-engine gap
 * keep their graded girth (scale 1), so the placement only moves the garment where the fit engine
 * says something.
 */
export function placeGarment(grading: GradingJson, size: string, gaps: AnchorGaps | null, bodyRings: Readonly<Partial<Record<AnchorRing, number>>>): Placement {
  const entry = sizeEntry(grading, size);
  const graded: AnchorValues = {};
  for (const id of Object.keys(grading.morph.heights) as AnchorRing[]) {
    const v = entry.targets[id];
    if (v !== undefined) graded[id] = v;
  }
  const placed: AnchorValues = { ...graded };
  const anchors: AnchorPlacement[] = [];
  for (const anchor of PLACED_ANCHORS) {
    const slack = gaps?.slackCm[anchor];
    const g = graded[anchor];
    const b = bodyRings[anchor];
    if (slack === undefined || g === undefined || b === undefined) continue;
    const band = gaps?.bands[anchor];
    const state: LoopState = slack >= 0 ? 'room' : band === 'tight' ? 'open' : 'stretched';
    const placedCm = slack >= 0 ? b + slack : b;
    placed[anchor] = placedCm;
    anchors.push({ anchor, gradedCm: g, bodyCm: b, slackCm: slack, placedCm, state, band });
  }
  return { size: entry.size, graded, placed, anchors };
}

/** The radial morph from the graded garment to its placed loops (same morph as grading, `@curtain/anchors`). */
export function placementMorph(p: Placement, heights: Readonly<Partial<Record<AnchorRing, number>>>): GradingMorph {
  return gradingMorph(p.graded, p.placed, { heights });
}

const LABEL: Readonly<Record<FitAnchorId, string>> = { chest: 'chest', waist: 'waist', hip: 'hip', shoulder_width: 'shoulders', thigh: 'thigh', inseam: 'inseam' };

export interface FitLine {
  anchor: FitAnchorId;
  band: Band | undefined;
  /** `tension` when the gap is negative, `room` when positive. */
  tone: 'tension' | 'room' | 'even' | 'strain';
  text: string;
}

/** The text under the viewer: the fit engine's per-anchor gaps in words, plus the loop states of step 3. */
export function fitLines(gaps: AnchorGaps | null, placement: Placement | null): FitLine[] {
  if (!gaps) return [];
  const lines: FitLine[] = [];
  for (const anchor of Object.keys(gaps.gaps) as FitAnchorId[]) {
    const gap = gaps.gaps[anchor]!;
    const band = gaps.bands[anchor];
    const where = LABEL[anchor];
    const p = placement?.anchors.find((a) => a.anchor === anchor);
    if (p?.state === 'open') {
      lines.push({ anchor, band, tone: 'strain', text: `Does not close at the ${where}: the body is ${round1(-p.slackCm)} cm larger than the garment, more than its fabric gives (tight).` });
      continue;
    }
    const tone = gap > 0 ? 'room' : gap < 0 ? 'tension' : 'even';
    const amount = `${round1(Math.abs(gap))} cm`;
    let text = gap > 0 ? `${amount} more room at the ${where}` : gap < 0 ? `${amount} tighter at the ${where}` : `Right on the intended ease at the ${where}`;
    text += band ? ` (${band})` : '';
    if (p?.state === 'stretched') text += `; stretched ${round1(-p.slackCm)} cm over the body`;
    lines.push({ anchor, band, tone, text: `${text}.` });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Heat map (handoff §Fitting step 5): colour per area from the same gap numbers
// ---------------------------------------------------------------------------

export interface HeatField {
  /** Interpolated fit-engine gap at a body height (cm) and how much it applies there (0..1). */
  at(y: number): { gapCm: number; weight: number };
  knots: Knot[];
}

/**
 * Gaps placed at their ring heights and blended with the same monotone profile as the grading
 * morph; beyond the outermost anchors the colour fades out over `fadeCm`. A breadth
 * (`shoulder_width`) sits at the height of the ring it is measured at (`BREADTH_RING`); lengths
 * have no height and are left out.
 */
export function heatField(gaps: AnchorGaps | null, heights: Readonly<Partial<Record<AnchorRing, number>>>, fadeCm = 14): HeatField {
  const knots: Knot[] = [];
  for (const anchor of Object.keys(gaps?.gaps ?? {}) as FitAnchorId[]) {
    const ring = isAnchorRing(anchor) ? anchor : isAnchorBreadth(anchor) ? BREADTH_RING[anchor] : undefined;
    const h = ring === undefined ? undefined : heights[ring];
    const g = gaps!.gaps[anchor];
    if (typeof h === 'number' && typeof g === 'number') knots.push({ x: h, y: g });
  }
  const profile = monotoneProfile(knots);
  const lo = Math.min(...knots.map((k) => k.x));
  const hi = Math.max(...knots.map((k) => k.x));
  return {
    knots,
    at(y) {
      if (knots.length === 0) return { gapCm: 0, weight: 0 };
      const d = y < lo ? lo - y : y > hi ? y - hi : 0;
      return { gapCm: profile(y), weight: Math.max(0, 1 - d / fadeCm) };
    },
  };
}

/** Diverging scale: tension (negative gap) red, room (positive gap) blue, the intended ease near-white. */
const STOPS: readonly [number, readonly [number, number, number]][] = [
  [-8, [0.7, 0.09, 0.17]],
  [-3, [0.94, 0.54, 0.38]],
  [0, [0.97, 0.95, 0.92]],
  [3, [0.4, 0.66, 0.81]],
  [8, [0.13, 0.4, 0.67]],
];
export const HEAT_NEUTRAL: readonly [number, number, number] = [0.8, 0.78, 0.75];

export function heatColor(gapCm: number, weight = 1): [number, number, number] {
  const g = Math.max(STOPS[0]![0], Math.min(STOPS[STOPS.length - 1]![0], gapCm));
  let k = 0;
  while (k < STOPS.length - 2 && g > STOPS[k + 1]![0]) k++;
  const [x0, c0] = STOPS[k]!;
  const [x1, c1] = STOPS[k + 1]!;
  const t = (g - x0) / (x1 - x0);
  const w = Math.max(0, Math.min(1, weight));
  return [0, 1, 2].map((j) => {
    const c = c0[j]! + (c1[j]! - c0[j]!) * t;
    return HEAT_NEUTRAL[j]! + (c - HEAT_NEUTRAL[j]!) * w;
  }) as [number, number, number];
}

/** Vertex colours (rgb floats) of the garment: body-chain vertices by height, sleeves neutral. */
export function heatColors(positions: ArrayLike<number>, chains: Uint8Array, field: HeatField, out: Float32Array = new Float32Array(positions.length)): Float32Array {
  for (let i = 0; i < chains.length; i++) {
    const c = chains[i] === 0 ? field.at(positions[3 * i + 1]!) : { gapCm: 0, weight: 0 };
    const rgb = heatColor(c.gapCm, c.weight);
    out[3 * i] = rgb[0];
    out[3 * i + 1] = rgb[1];
    out[3 * i + 2] = rgb[2];
  }
  return out;
}
