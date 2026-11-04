/**
 * Band classification (fit-engine-spec.md §Step 4) and the sigma-aware extension (decision D5).
 */
import { BAND_SCORES, LOOSE_FAR_CM, LOOSE_FAR_SCORE, SNUG_OK_SCORE } from './constants';
import { normalMass } from './math';
import type { Band, BandEdges, BandProbabilities, BandResult } from './types';

/**
 * Deterministic band and point score for a gap (cm):
 *
 * | condition                      | band  | score                              |
 * |--------------------------------|-------|------------------------------------|
 * | gap < T                        | tight | 0                                  |
 * | T ≤ gap < 0                    | snug  | 1.0 if snugOk else 0.7             |
 * | 0 ≤ gap ≤ E + good             | good  | 1.0                                |
 * | E + good < gap ≤ E + loose     | roomy | 0.6                                |
 * | gap > E + loose                | loose | 0.2 if gap ≤ E + loose + 4, else 0 |
 */
export function bandFor(gap: number, edges: BandEdges): BandResult {
  const { tightLimit, easeTarget, goodSlack, looseSlack, snugOk } = edges;
  if (gap < tightLimit) return { band: 'tight', score: BAND_SCORES.tight };
  if (gap < 0) return { band: 'snug', score: snugOk ? SNUG_OK_SCORE : BAND_SCORES.snug };
  if (gap <= easeTarget + goodSlack) return { band: 'good', score: BAND_SCORES.good };
  if (gap <= easeTarget + looseSlack) return { band: 'roomy', score: BAND_SCORES.roomy };
  return { band: 'loose', score: gap <= easeTarget + looseSlack + LOOSE_FAR_CM ? BAND_SCORES.loose : LOOSE_FAR_SCORE };
}

export interface ProbabilisticBand extends BandResult {
  probabilities: BandProbabilities;
}

/**
 * Sigma-aware band: with the user's measurement uncertain by σ (cm), the true gap is
 * ~ N(gap, σ²) and each band gets a probability mass. The point score is the expected band
 * score (the far-loose tail scores 0 as in the deterministic table), the reported band is the
 * most probable one. σ ≤ 0 (or non-finite) falls back to `bandFor` with a one-hot distribution,
 * so the deterministic result is reproduced exactly.
 */
export function bandForWithSigma(gap: number, sigma: number, edges: BandEdges): ProbabilisticBand {
  if (!(sigma > 0) || !Number.isFinite(sigma)) {
    const det = bandFor(gap, edges);
    const probabilities: BandProbabilities = { tight: 0, snug: 0, good: 0, roomy: 0, loose: 0 };
    probabilities[det.band] = 1;
    return { ...det, probabilities };
  }
  const { tightLimit, easeTarget, goodSlack, looseSlack, snugOk } = edges;
  const goodEdge = easeTarget + goodSlack;
  const looseEdge = easeTarget + looseSlack;
  const farEdge = looseEdge + LOOSE_FAR_CM;

  // Half-open intervals; measure-zero boundary differences do not matter for a continuous law.
  const pTight = normalMass(gap, sigma, -Infinity, tightLimit);
  const pSnug = normalMass(gap, sigma, tightLimit, 0);
  const pGood = normalMass(gap, sigma, 0, goodEdge);
  const pRoomy = normalMass(gap, sigma, goodEdge, looseEdge);
  const pLooseNear = normalMass(gap, sigma, looseEdge, farEdge);
  const pLooseFar = normalMass(gap, sigma, farEdge, Infinity);

  const probabilities: BandProbabilities = {
    tight: pTight,
    snug: pSnug,
    good: pGood,
    roomy: pRoomy,
    loose: pLooseNear + pLooseFar,
  };
  const score =
    pTight * BAND_SCORES.tight +
    pSnug * (snugOk ? SNUG_OK_SCORE : BAND_SCORES.snug) +
    pGood * BAND_SCORES.good +
    pRoomy * BAND_SCORES.roomy +
    pLooseNear * BAND_SCORES.loose +
    pLooseFar * LOOSE_FAR_SCORE;

  let band: Band = 'good';
  let best = -1;
  for (const b of ['tight', 'snug', 'good', 'roomy', 'loose'] as const) {
    if (probabilities[b] > best) {
      best = probabilities[b];
      band = b;
    }
  }
  return { band, score: Math.min(1, Math.max(0, score)), probabilities };
}
