/** Rounding and normal-distribution helpers. Pure. */

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** A finite number strictly greater than 0, else `undefined` ("not provided", spec §Step 4). */
export function positive(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined;
}

/** A finite number, else `fallback`. */
export function finite(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

/**
 * erf(x) — Abramowitz & Stegun 7.1.26 (|error| ≤ 1.5e-7), more than enough for band
 * probabilities reported to 3 dp.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF Φ(z). */
export function normalCdf(z: number): number {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** P(a < X ≤ b) for X ~ N(mean, sigma²). */
export function normalMass(mean: number, sigma: number, a: number, b: number): number {
  const lo = a === -Infinity ? 0 : normalCdf((a - mean) / sigma);
  const hi = b === Infinity ? 1 : normalCdf((b - mean) / sigma);
  return Math.max(0, hi - lo);
}
