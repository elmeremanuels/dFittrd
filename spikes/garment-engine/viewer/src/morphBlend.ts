/**
 * R2 spike (docs/research/step3-serverdrape-spike.md): the device half of "server drapes per size, the phone blends".
 * Per size the bundle carries the drape on the middle grid body (t = 0) and two morph targets, the drapes on the grid
 * bodies at t = -1 and t = +1 minus that base. The shopper's body gives one axis value t (here: where the shopper's hip
 * sits on the size chart, computed on the device; nothing about the body leaves it, D3), and the morph weights are
 * piecewise linear: t < 0 blends towards the t = -1 drape, t > 0 towards the t = +1 drape. Outside [-1, 1] the weights
 * are clamped (no extrapolation: the server would need another grid body).
 *
 * `linear` is the one-target alternative measured in the spike: a single slope (D(+1) - D(-1)) / 2 times t.
 * Pure: no DOM, no three.js.
 */
export type MorphBasis = 'piecewise' | 'linear';

/** Morph weights for axis value t: piecewise → [w(t=-1 target), w(t=+1 target)], linear → [t]. */
export function morphWeights(t: number, basis: MorphBasis = 'piecewise'): number[] {
  const c = Math.max(-1, Math.min(1, t));
  if (basis === 'linear') return [c];
  return [Math.max(0, -c), Math.max(0, c)];
}

/** Axis value of a shopper body from its hip girth along the chart line (hip = hipAtZero + hipPerUnit * t). */
export function axisFromHip(hipCm: number, hipAtZero = 104, hipPerUnit = 10): number {
  return (hipCm - hipAtZero) / hipPerUnit;
}

/** base + Σ w_k · target_k, per float. */
export function blend(base: ArrayLike<number>, targets: readonly ArrayLike<number>[], weights: readonly number[]): Float32Array {
  const out = Float32Array.from(base);
  targets.forEach((tg, k) => {
    const w = weights[k] ?? 0;
    if (w === 0) return;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + w * tg[i]!;
  });
  return out;
}
