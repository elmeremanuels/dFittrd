/**
 * Grading morph (docs/ENGINE-HANDOFF.md §Stage 6 and §Fitting step 1).
 *
 * The pipeline reconstructs a garment once, at its base size. Every other size is a deformation:
 * per anchor the size chart gives a target circumference or length, and the mesh is scaled smoothly
 * between neighbouring rings. Per size only the per-anchor targets are stored; the device applies
 * this morph. The same function runs in the worker (to check the result) and in the browser.
 *
 * Ring scale `s = target / base`. Because an ellipse's circumference is homogeneous of degree one in
 * its axes, scaling a ring's cross-section by `s` (aspect kept) gives exactly the target girth.
 * Between rings the scale follows a monotone cubic (Fritsch–Carlson) through the rings' heights: it is
 * C1, passes exactly through every ring's scale, and never overshoots the scales of the two
 * neighbouring rings, so a hem between waist and hip can never grade outside what those rings say.
 */
import { ANCHOR_IDS, type AnchorId, type AnchorRing, type AnchorValues } from './vocabulary';

/** Ring chains along which girth scales are interpolated. */
export type AnchorChain = 'body' | 'arm';

/** Rings per chain, top to bottom. The leg rings continue the torso chain (one value per height). */
export const ANCHOR_CHAINS: Readonly<Record<AnchorChain, readonly AnchorRing[]>> = {
  body: ['neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle'],
  arm: ['upper_arm', 'wrist'],
};

/**
 * Nominal height of each ring above the floor as a fraction of stature, for an adult standing with
 * the arms hanging. Approximate drafting proportions; the canonical mannequin supplies its own
 * heights (`MorphOptions.heights`) once it exists.
 */
export const NOMINAL_RING_HEIGHTS: Readonly<Record<AnchorRing, number>> = {
  neck: 0.84,
  shoulder: 0.8,
  chest: 0.72,
  underbust: 0.68,
  waist: 0.62,
  hip: 0.52,
  thigh: 0.43,
  knee: 0.28,
  calf: 0.19,
  ankle: 0.05,
  upper_arm: 0.7,
  wrist: 0.48,
};

export interface MorphOptions {
  /**
   * Ring heights to interpolate along, in any unit (fraction of stature, cm on the mannequin…);
   * `girthScaleAt` is then queried in the same unit. When given it replaces the nominal table
   * entirely: a ring without a finite height here takes no part in the interpolation.
   */
  heights?: Readonly<Partial<Record<AnchorRing, number>>>;
}

export interface GradingMorph {
  /** `target / base` per anchor where both are finite and positive. */
  scales: Partial<Record<AnchorId, number>>;
  /** Anchors with a value on one side only (or an unusable value): not graded, logged as an estimate upstream. */
  missing: AnchorId[];
  /**
   * Girth scale at a height along a chain (default `'body'`): the ring scale at a ring, a smooth
   * monotone blend between neighbouring rings, the end ring's scale beyond the ends, and `1` when
   * the chain has no graded ring.
   */
  girthScaleAt(height: number, chain?: AnchorChain): number;
}

export interface SizeTarget {
  size: string;
  /** Target circumferences and lengths of this size, cm. */
  target: AnchorValues;
}

export type SizeMorph = GradingMorph & { size: string };

const usable = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** `target / base`, or `undefined` when either value is missing, non-finite or not positive. */
export function anchorScale(base: number | undefined, target: number | undefined): number | undefined {
  return usable(base) && usable(target) ? target / base : undefined;
}

export interface Knot {
  /** Position (height). */
  x: number;
  /** Value at that position. */
  y: number;
}

/**
 * Monotone piecewise-cubic Hermite interpolant (Fritsch–Carlson) through the knots, with zero slope
 * at both ends and constant extrapolation, so the result is C1 everywhere. Knots may come in any
 * order; non-finite knots are dropped and of knots at the same `x` the first is kept.
 */
export function monotoneProfile(knots: readonly Knot[]): (x: number) => number {
  const pts = knots
    .filter((k) => Number.isFinite(k.x) && Number.isFinite(k.y))
    .map((k, i) => ({ ...k, i }))
    .sort((p, q) => p.x - q.x || p.i - q.i)
    .filter((k, i, arr) => i === 0 || k.x !== arr[i - 1]!.x);
  const n = pts.length;
  if (n === 0) return () => 1;
  if (n === 1) {
    const only = pts[0]!.y;
    return () => only;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const h: number[] = [];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(xs[k + 1]! - xs[k]!);
    d.push((ys[k + 1]! - ys[k]!) / h[k]!);
  }
  // Interior slopes: weighted harmonic mean of the neighbouring secants (Fritsch–Butland), zero at
  // a local extremum. |m| ≤ 3·min(|d|) keeps every segment monotone. End slopes are zero.
  const m: number[] = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    const d0 = d[k - 1]!;
    const d1 = d[k]!;
    if (d0 * d1 <= 0) continue;
    const w1 = 2 * h[k]! + h[k - 1]!;
    const w2 = h[k]! + 2 * h[k - 1]!;
    m[k] = (w1 + w2) / (w1 / d0 + w2 / d1);
  }
  return (x: number): number => {
    if (Number.isNaN(x)) return Number.NaN;
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]!) k++;
    const hk = h[k]!;
    const t = (x - xs[k]!) / hk;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[k]! +
      (t3 - 2 * t2 + t) * hk * m[k]! +
      (-2 * t3 + 3 * t2) * ys[k + 1]! +
      (t3 - t2) * hk * m[k + 1]!
    );
  };
}

/**
 * Per-anchor scale factors from the base size to one target size, and the smooth girth scale along
 * the body height between neighbouring rings.
 */
export function gradingMorph(base: AnchorValues, target: AnchorValues, options: MorphOptions = {}): GradingMorph {
  const scales: Partial<Record<AnchorId, number>> = {};
  const missing: AnchorId[] = [];
  for (const id of ANCHOR_IDS) {
    const b = base[id];
    const t = target[id];
    if (b === undefined && t === undefined) continue;
    const s = anchorScale(b, t);
    if (s === undefined) missing.push(id);
    else scales[id] = s;
  }
  const heights: Readonly<Partial<Record<AnchorRing, number>>> = options.heights ?? NOMINAL_RING_HEIGHTS;
  const profiles = {} as Record<AnchorChain, (x: number) => number>;
  for (const chain of Object.keys(ANCHOR_CHAINS) as AnchorChain[]) {
    const knots: Knot[] = [];
    for (const ring of ANCHOR_CHAINS[chain]) {
      const y = scales[ring];
      const x = heights[ring];
      if (y !== undefined && typeof x === 'number' && Number.isFinite(x)) knots.push({ x, y });
    }
    profiles[chain] = monotoneProfile(knots);
  }
  return {
    scales,
    missing,
    girthScaleAt: (height: number, chain: AnchorChain = 'body') => (profiles[chain] ?? profiles.body)(height),
  };
}

/**
 * One morph per size, in chart order. Throws a `RangeError` on a duplicate size label (trimmed,
 * case-insensitive): grading reads
 * the chart per label, so two rows with one label would make the asset ambiguous (finding #2).
 */
export function gradeSizes(base: AnchorValues, sizes: readonly SizeTarget[], options: MorphOptions = {}): SizeMorph[] {
  const seen = new Set<string>();
  for (const { size } of sizes) {
    // Same rule as the schema's size-chart check: labels compare trimmed and case-insensitively.
    const key = size.trim().toUpperCase();
    if (seen.has(key)) throw new RangeError(`Duplicate size label "${size}": every size in a chart needs its own label.`);
    seen.add(key);
  }
  return sizes.map(({ size, target }) => ({ size, ...gradingMorph(base, target, options) }));
}
