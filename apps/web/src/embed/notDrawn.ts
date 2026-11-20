/**
 * The not-drawn rule in the embed: one reading of the embed's own FitResult for the 3D view and the 2D figure.
 *
 * `wearBlock` of `@curtain/fit-engine` says where the size on screen cannot be worn on the shopper's body (a girth the
 * fabric cannot give at, a waistband that does not pass the hips). The 3D viewer gets the same FitResult and applies the
 * same reader (`packages/garment-viewer/src/notDrawn.ts`), so the picture and this sentence cannot disagree. Nothing
 * here decides a fit (rule 4).
 */
import { wearBlock, type FitResult } from '@curtain/fit-engine';
import type { GarmentPayload } from '@curtain/schema';
import { pointLabelFor } from './aboutYou';
import { embedStrings } from './strings';
import { lengthText, type Units } from './units';

/** Why the size on screen is not drawn, as the pictures carry it. */
export interface NotDrawnNote {
  reason: 'tight' | 'pull-on';
  /** Fit point (`bust`, `waist`, `hip`, `thigh`) and its D15 anchor. */
  point: string;
  anchor: string;
  /** Body minus garment at the point, cm; null when only the fact is known (a viewer that states no number). */
  shortCm: number | null;
}

/** The size advice's block of `size` (null: the size goes on and is drawn). */
export function notDrawnNote(fit: FitResult | null | undefined, size: string | null | undefined): NotDrawnNote | null {
  if (!fit || !size) return null;
  const b = wearBlock(fit, size);
  return b ? { reason: b.reason, point: b.point, anchor: b.anchor, shortCm: b.shortCm } : null;
}

const ANCHOR_POINT: Readonly<Record<string, string>> = { chest: 'bust', waist: 'waist', hip: 'hip', thigh: 'thigh' };

/** A block the mounted viewer reports for a size (`GarmentView.source`), for a view whose answer the embed's own reading does not have. */
export function notDrawnFromViewer(v: { anchor: string; bodyLargerCm?: number; reason?: 'tight' | 'pull-on' } | null | undefined): NotDrawnNote | null {
  if (!v) return null;
  return { reason: v.reason ?? 'tight', point: ANCHOR_POINT[v.anchor] ?? v.anchor, anchor: v.anchor, shortCm: typeof v.bodyLargerCm === 'number' ? v.bodyLargerCm : null };
}

/** The one sentence under a picture that does not draw the size: the point, and that the size advice decided. */
export function notDrawnSentence(note: NotDrawnNote, size: string, audience: GarmentPayload['audience'] | undefined, units: Units): string {
  return embedStrings().view3d.notDrawn(size, {
    reason: note.reason,
    where: pointLabelFor(note.point, audience).toLowerCase(),
    short: note.shortCm !== null && note.shortCm > 0 ? lengthText(note.shortCm, units) : null,
  });
}
