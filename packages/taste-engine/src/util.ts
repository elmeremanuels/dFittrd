import { AXES, type Axis, type AxisVector } from './types';

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Profile numbers are stored at 4 dp (spec: "Rounding: 4 dp for profile numbers"). */
export function round4(x: number): number {
  return Math.round((x + Number.EPSILON) * 1e4) / 1e4;
}

export function zeroAxes(): AxisVector {
  return { bohemian: 0, minimal: 0, classic: 0, avantGarde: 0, sporty: 0 };
}

export function fillAxes(v: number): AxisVector {
  return { bohemian: v, minimal: v, classic: v, avantGarde: v, sporty: v };
}

/** argmax in fixed axis order (first wins ties); null when every entry is ≤ 0. */
export function dominantAxis(v: Readonly<Partial<AxisVector>>): Axis | null {
  let best: Axis | null = null;
  let bestVal = 0;
  for (const a of AXES) {
    const x = v[a] ?? 0;
    if (x > bestVal) {
      bestVal = x;
      best = a;
    }
  }
  return best;
}

/** argmax of a full axis vector (first wins ties). */
export function topAxis(v: Readonly<AxisVector>): Axis {
  let best: Axis = AXES[0];
  for (const a of AXES) if (v[a] > v[best]) best = a;
  return best;
}

/** Nearest-rank percentile (p in 0..1) of a non-empty list. */
export function nearestRankPercentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] as number;
}
