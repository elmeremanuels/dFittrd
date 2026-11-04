/** UI helpers over a FitResult: a one-sentence summary and per-point gaps for the Path B renderer. */
import { NOTE_ORDER, POINT_LABELS } from './constants';
import { round1 } from './math';
import { isPointFit, type FitResult, type PointFit, type RenderGaps, type SizeFit } from './types';

function sizeFit(result: FitResult, size: string | null | undefined): SizeFit | undefined {
  if (size === null || size === undefined) return undefined;
  return result.perSize.find((s) => s.size === size);
}

function usedInNoteOrder(fit: SizeFit | undefined): PointFit[] {
  if (!fit) return [];
  const used = fit.points.filter(isPointFit);
  return NOTE_ORDER.map((p) => used.find((u) => u.point === p)).filter((p): p is PointFit => p !== undefined);
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * One short English sentence for the UI. Every sentence says "estimate" (AGENTS.md rule 3) and
 * carries the confidence. Examples:
 * - `Size M fits you well (estimate, 84% confidence).`
 * - `Size M should fit — snug at the waist (estimate, 77% confidence).`
 * - `Size M is the closest, but it may be tight at the hips (estimate, 70% confidence).`
 * - `No size fits well — the closest is L, tight at the bust (estimate).`
 * - `We can't check the fit of this item yet.`
 */
export function fitSummary(result: FitResult): string {
  if (result.score === null || result.closestSize === null) return "We can't check the fit of this item yet.";
  const tail = `(estimate, ${pct(result.confidence)} confidence)`;

  if (result.recommendedSize === null) {
    const used = usedInNoteOrder(sizeFit(result, result.closestSize));
    let worst: PointFit | undefined;
    for (const p of used) if (worst === undefined || p.score < worst.score) worst = p;
    const where = worst ? `, ${worst.band} at the ${POINT_LABELS[worst.point]}` : '';
    return `No size fits well — the closest is ${result.closestSize}${where} (estimate).`;
  }

  const size = result.recommendedSize;
  const used = usedInNoteOrder(sizeFit(result, size));
  const issues = used.filter((p) => p.band !== 'good').map((p) => `${p.band} at the ${POINT_LABELS[p.point]}`);
  if (!result.fits) {
    const tight = used.filter((p) => p.band === 'tight').map((p) => `tight at the ${POINT_LABELS[p.point]}`);
    const list = (tight.length > 0 ? tight : issues).join(', ');
    return list.length > 0
      ? `Size ${size} is the closest, but it may be ${list} ${tail}.`
      : `Size ${size} is the closest, but the fit is uncertain ${tail}.`;
  }
  if (issues.length === 0) return `Size ${size} fits you well ${tail}.`;
  return `Size ${size} should fit — ${issues.join(', ')} ${tail}.`;
}

/**
 * Per-point gaps for the Path B renderer (D4: "per-point ease from the fit result").
 * `size` defaults to the recommended size, else the closest. Returns `null` when that size is
 * not in the result. Only used points appear; omitted and skipped points are absent.
 */
export function fitGapsForRender(result: FitResult, size?: string | null): RenderGaps | null {
  const target = size ?? result.recommendedSize ?? result.closestSize;
  const fit = sizeFit(result, target);
  if (!fit || target === null || target === undefined) return null;
  const out: RenderGaps = { size: target, gaps: {}, bands: {}, easeTargets: {}, slackCm: {} };
  for (const p of fit.points) {
    if (!isPointFit(p)) continue;
    out.gaps[p.point] = p.gapCm;
    out.bands[p.point] = p.band;
    out.easeTargets[p.point] = p.easeTarget;
    out.slackCm[p.point] = round1(p.gapCm + p.easeTarget);
  }
  return out;
}
