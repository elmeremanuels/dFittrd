/**
 * Which fit score a surface may show. The engine scores the size chart; for a pull-on garment it also checks that the
 * stretched waistband goes over the hips (`SizeFit.pullOn`). A size whose band does not (`blocked`) keeps its chart
 * score in the engine's output (0.999 is possible), and a number like "99%" next to "too small to pull on" would tell
 * the shopper the opposite of the advice. So no surface prints the score of a blocked size: every percentage on the
 * compare chips, the consumer app's size chips and FitPanel goes through these two functions.
 */
import type { FitResult, SizeFit } from '@curtain/fit-engine';

/** The score of one size as it may be shown, or null (no fit points, or its waistband does not pull on). */
export function shownSizeScore(s: Pick<SizeFit, 'score' | 'pullOn'>): number | null {
  if (s.pullOn?.status === 'blocked') return null;
  return s.score;
}

/** The size a FitResult's `score` belongs to (`closestSize`, at `closestIndex` when given). */
function scoredSize(fit: FitResult): SizeFit | undefined {
  const at = fit.closestIndex !== undefined ? fit.perSize[fit.closestIndex] : undefined;
  return at && at.size === fit.closestSize ? at : fit.perSize.find((s) => s.size === fit.closestSize);
}

/** FitResult.score as it may be shown, or null when the size it belongs to is blocked by the pull-on check. */
export function shownFitScore(fit: FitResult): number | null {
  const s = scoredSize(fit);
  if (s?.pullOn?.status === 'blocked') return null;
  return fit.score;
}

/** True when the size FitResult.score belongs to is blocked by the pull-on check. */
export function scoredSizeBlocked(fit: FitResult): boolean {
  return scoredSize(fit)?.pullOn?.status === 'blocked';
}
