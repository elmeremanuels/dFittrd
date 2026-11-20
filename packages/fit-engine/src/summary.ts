/**
 * UI helpers over a FitResult: a one-sentence summary, per-point gaps for the Path B renderer, and
 * the same gaps keyed by D15 anchor id for the 3D viewer.
 */
import { MENS_POINT_LABELS, NOTE_ORDER, POINT_LABELS as POINT_LABELS_DEFAULT } from './constants';
import { round1 } from './math';
import { TAPE_NOTES } from './pullOn';
import { isPointFit, type AnchorGaps, type FitAnchorId, type FitResult, type Point, type PointFit, type RenderGaps, type SizeFit, type WearBlock } from './types';

/**
 * The row of `size`, without relying on the first row that carries the label (finding #2). The
 * closest/recommended size is read through `closestIndex`; any other label must be unique in the
 * chart. A label that two rows share is ambiguous and yields `undefined`.
 */
function sizeFit(result: FitResult, size: string | null | undefined): SizeFit | undefined {
  if (size === null || size === undefined) return undefined;
  const i = result.closestIndex;
  if (size === result.closestSize && i !== undefined && result.perSize[i]?.size === size) return result.perSize[i];
  const matches = result.perSize.filter((s) => s.size === size);
  return matches.length === 1 ? matches[0] : undefined;
}

function usedInNoteOrder(fit: SizeFit | undefined): PointFit[] {
  if (!fit) return [];
  const used = fit.points.filter(isPointFit);
  return NOTE_ORDER.map((p) => used.find((u) => u.point === p)).filter((p): p is PointFit => p !== undefined);
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const CANNOT_CHECK = "We can't check the fit of this item yet.";

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
  const POINT_LABELS = result.mens ? MENS_POINT_LABELS : POINT_LABELS_DEFAULT;
  if (result.score === null || result.closestSize === null) return CANNOT_CHECK;
  // A row we cannot identify (duplicate size labels in an unvalidated chart) is never summarised.
  if (sizeFit(result, result.closestSize) === undefined) return CANNOT_CHECK;
  const tail = `(estimate, ${pct(result.confidence)} confidence)`;

  if (result.recommendedSize === null) {
    if (sizeFit(result, result.closestSize)?.pullOn?.status === 'blocked') return TAPE_NOTES.summaryNoneGoesOn(result.closestSize);
    const used = usedInNoteOrder(sizeFit(result, result.closestSize));
    let worst: PointFit | undefined;
    for (const p of used) if (worst === undefined || p.score < worst.score) worst = p;
    const where = worst ? `, ${worst.band} at the ${POINT_LABELS[worst.point]}` : '';
    return `No size fits well — the closest is ${result.closestSize}${where} (estimate).`;
  }

  const size = result.recommendedSize;
  const used = usedInNoteOrder(sizeFit(result, size));
  const issues = used.filter((p) => p.band !== 'good').map((p) => `${p.band} at the ${POINT_LABELS[p.point]}`);
  if (sizeFit(result, size)?.pullOn?.status === 'marginal') issues.push(TAPE_NOTES.summaryMarginal);
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
 * not in the result, or when two rows share its label and it is not the closest size.
 * Only used points appear; omitted and skipped points are absent.
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

/**
 * Fit point → D15 anchor id (`FIT_POINT_TO_ANCHOR` in `@curtain/anchors`; a test keeps them equal).
 * `foot` has no anchor: shoes have no garment mesh. The `shoulder` point is a width across the back,
 * so it is keyed `shoulder_width`, never the D15 `shoulder` ring, which is a girth (R1).
 */
export const FIT_POINT_ANCHORS: Readonly<Partial<Record<Point, FitAnchorId>>> = {
  bust: 'chest',
  waist: 'waist',
  hip: 'hip',
  shoulder: 'shoulder_width',
  thigh: 'thigh',
  inseam: 'inseam',
  neck: 'neck',
  sleeve: 'sleeve',
};

/**
 * Per-anchor gaps keyed by D15 id (decision D15, ENGINE-HANDOFF §Fitting step 2): exactly the
 * numbers of `fitGapsForRender(result, size)`, re-keyed (`bust` → `chest`, `shoulder` →
 * `shoulder_width`). No maths of its own:
 * the 3D viewer reads these and never computes fit a second time. `foot` is dropped. Same `null`
 * cases as `fitGapsForRender`.
 */
export function anchorGaps(result: FitResult, size?: string | null): AnchorGaps | null {
  const render = fitGapsForRender(result, size);
  if (render === null) return null;
  const out: AnchorGaps = { size: render.size, gaps: {}, bands: {}, easeTargets: {}, slackCm: {} };
  for (const point of Object.keys(render.gaps) as Point[]) {
    const anchor = FIT_POINT_ANCHORS[point];
    if (anchor === undefined) continue;
    out.gaps[anchor] = render.gaps[point];
    out.bands[anchor] = render.bands[point];
    out.easeTargets[anchor] = render.easeTargets[point];
    out.slackCm[anchor] = render.slackCm[point];
  }
  return out;
}

/**
 * The girth points a garment has to close round (or be pulled over): a size smaller than the body there, beyond what
 * its fabric gives, cannot be put on. Breadths (shoulder), lengths and the foot are left out: a garment short or narrow
 * there is still on the body.
 */
export const WEAR_POINTS: readonly Point[] = ['bust', 'waist', 'hip', 'thigh'];

/**
 * Where `size` cannot be worn on this body, read off the result (no maths of its own beyond `slackCm` of
 * `fitGapsForRender`): a `WEAR_POINTS` point the engine banded `tight` whose garment girth is smaller than the body
 * (negative slack: the body is larger than the garment by more than the stretch-adjusted limit the engine computed
 * from the product's fabric), or a pull-on check that is `blocked` (the stretched band is short of the hips by more
 * than its allowance). Returns the largest shortfall; `null` when the size goes on, however snug or loose, and when
 * the size is not in the result (the `null` cases of `fitGapsForRender`).
 *
 * A picture reads this and never decides it: a size with a block is not drawn on the body (the 3D view and the 2D
 * figure show the body alone and say why). `tight` with room left (the garment is larger than the body but has less
 * ease than the limit) is not a block: the garment closes.
 */
export function wearBlock(result: FitResult, size?: string | null): WearBlock | null {
  const target = size ?? result.recommendedSize ?? result.closestSize;
  const fit = sizeFit(result, target);
  if (!fit) return null;
  const labels = result.mens ? MENS_POINT_LABELS : POINT_LABELS_DEFAULT;
  let worst: WearBlock | null = null;
  for (const p of fit.points) {
    if (!isPointFit(p) || p.measure === 'length' || !WEAR_POINTS.includes(p.point) || p.band !== 'tight') continue;
    const slack = round1(p.gapCm + p.easeTarget);
    const anchor = FIT_POINT_ANCHORS[p.point];
    if (slack >= 0 || anchor === undefined) continue;
    if (!worst || -slack > worst.shortCm) worst = { reason: 'tight', point: p.point, anchor, label: labels[p.point], shortCm: round1(-slack) };
  }
  const pull = fit.pullOn;
  if (pull?.status === 'blocked') {
    const short = round1(Math.max(0, -pull.marginCm));
    if (!worst || short >= worst.shortCm) worst = { reason: 'pull-on', point: 'hip', anchor: 'hip', label: labels.hip, shortCm: short };
  }
  return worst;
}
