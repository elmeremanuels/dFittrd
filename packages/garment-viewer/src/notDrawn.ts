/**
 * The one not-drawn rule of the 3D view, for every garment category.
 *
 * A size the fit engine says cannot be worn on this body is not draped and not drawn: the body is shown alone and the
 * host says why. The decision is the fit engine's (`wearBlock`, rule 4): a girth point it banded `tight` where the body
 * is larger than the garment by more than its fabric gives (bust or chest, waist, hips or seat, thigh), or a pull-on
 * band that does not stretch over the hips. This file only carries that answer to the view; it measures nothing and
 * knows no category. Before it the rule existed three times (sewn tops, tape-built trousers, the baked pull-on skirt)
 * and every other garment, a woven dress among them, was drawn stretched onto a body it does not close on.
 *
 * A size that is snug, roomy or loose, and one that is `tight` with room left, has no block and is drawn as before.
 */
import { wearBlock, type FitResult, type WearBlock } from '@curtain/fit-engine';
import { gradingLabel } from './bundleCheck';

/** Why a size is not drawn on this body: the fit engine's `WearBlock`, with the D15 anchor and the shortfall under the names the view has used since M3. */
export interface NotDrawn {
  /** D15 anchor of the point where the size does not go on (`chest`, `waist`, `hip`, `thigh`). */
  anchor: string;
  /** Body minus garment there, cm (pull-on: how far the stretched band is short of the hips). */
  bodyLargerCm: number;
  /** `tight`: does not close at the point. `pull-on`: the waistband does not stretch over the hips. */
  reason: WearBlock['reason'];
  /** The point as the size advice names it ("bust", "chest" on a men's fit, "hips", "seat"). */
  label: string;
}

/** The fit engine's block of one size as the view carries it; null when the size goes on (and when the result does not know the size). */
export function sizeNotDrawn(fit: FitResult | null | undefined, size: string): NotDrawn | null {
  if (!fit) return null;
  const b = wearBlock(fit, size);
  return b ? { anchor: b.anchor, bodyLargerCm: b.shortCm, reason: b.reason, label: b.label } : null;
}

/**
 * Every size of the bundle the fit engine blocks on this body, keyed by the bundle's own size label (`gradingLabel`:
 * the chart and the bundle may spell a size differently). A chart row the bundle does not have is skipped.
 */
export function notDrawnSizes(fit: FitResult | null | undefined, sizes: readonly string[]): Record<string, NotDrawn> {
  const out: Record<string, NotDrawn> = {};
  for (const row of fit?.perSize ?? []) {
    const label = gradingLabel(sizes, row.size);
    if (label === null || out[label]) continue;
    const r = sizeNotDrawn(fit, row.size);
    if (r) out[label] = r;
  }
  return out;
}
