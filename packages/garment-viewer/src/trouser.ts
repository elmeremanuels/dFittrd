/**
 * Trousers built from the shop's tape (the POM chino of men-3d-plan slices M3/M4; spikes/garment-engine `pomChino.ts`).
 * Such a bundle says so in anchors.json (`builder: 'pom-chino-…'`); every other bundle is untouched by this file.
 *
 * Two things differ from a reconstructed bottom, both read from the fit engine (rule 4: the viewer computes no fit):
 * - **Where the waist is read.** The fit engine reads a men's trouser waist at the worn height, between the natural
 *   waist and the seat by the front rise; its slack is the waistband against the body *there*. The avatar's waist ring
 *   is the natural waist. `wornBodyRings` hands the placement the body girth the fit engine used (the band's graded
 *   girth less the slack), so a band with room keeps its own girth and a band under tension is laid on the body it meets.
 * - **The band and the seat meet the body.** A vertex of the base mesh that lies inside the canonical body is exempt from
 *   collision for good (`insideCanonical`: the mannequin's limbs overlap its torso, and a reconstruction may cut into the
 *   body). A waistband built to the tape of the body's own size lies on the body, so half its vertices start a few mm
 *   inside and would stay there, with the body showing through the band. For a tape-built trouser the exemption holds
 *   only below the hip ring, where the two legs' sections overlap at the centre and the cloth has to pass between them
 *   (`trouserNoCollide`).
 * - **The band is tilted** (lower at the front), and `slideWaistband` reads a band as the cloth within 2 cm of the highest
 *   point: on a tilted band that is the back only. `slideTrouserBand` is the same rule read on the band's own plane.
 * - **A size too small is not drawn.** As for the sewn tee (`sewnNotDrawn`): when the fit engine bands the waist or the
 *   seat `tight` with the body larger than the garment (the placed loop is `open`), or the thigh, the size is not draped
 *   and not drawn, and the reason is handed up. Before this a bottom's band was laid on the body whatever its size.
 */
import type { AnchorRing } from '@curtain/anchors';
import type { AnchorGaps, FitResult } from '@curtain/fit-engine';
import type { Mannequin, Mesh } from '@curtain/mannequin';
import type { GarmentAnchorsJson } from './bundle';
import { sample, type BodyField } from './collide';
import type { GradingJson } from './core/grading';
import { topEdgePlane } from './core/waistband';
import { BAND_HOLD_CM, BAND_SEARCH_CM, hullPerimeter, type BandSlide } from './engine';
import { gapsForSize, placeGarment, sizeEntry } from './fitting';

/** anchors.json `builder` of a tape-built trouser. */
export const TAPE_TROUSER_BUILDER = 'pom-chino-';

export function isTapeTrouser(anchors: Pick<GarmentAnchorsJson, 'category' | 'builder'>): boolean {
  return anchors.category === 'bottom' && typeof anchors.builder === 'string' && anchors.builder.startsWith(TAPE_TROUSER_BUILDER);
}

/**
 * The avatar's rings with the waist read where the fit engine read it for this size: the graded waistband less the
 * fit engine's slack. Unchanged when the fit has no waist gap or the grading no waist.
 */
export function wornBodyRings(grading: GradingJson, size: string, gaps: AnchorGaps | null, rings: Readonly<Partial<Record<AnchorRing, number>>>): Readonly<Partial<Record<AnchorRing, number>>> {
  const slack = gaps?.slackCm.waist;
  const band = sizeEntry(grading, size).targets.waist;
  if (slack === undefined || band === undefined) return rings;
  return { ...rings, waist: band - slack };
}

/** The anchor where a tape-built trouser does not go on this body in this size, and by how much the body is larger, cm; null when it goes on. */
export function trouserNotDrawn(bundle: { anchors: Pick<GarmentAnchorsJson, 'category' | 'builder'>; grading: GradingJson }, rings: Readonly<Partial<Record<AnchorRing, number>>>, fit: FitResult, size: string): { anchor: string; bodyLargerCm: number } | null {
  if (!isTapeTrouser(bundle.anchors)) return null;
  const gaps = gapsForSize(fit, size);
  const placement = placeGarment(bundle.grading, size, gaps, wornBodyRings(bundle.grading, size, gaps, rings));
  let worst: { anchor: string; slackCm: number } | null = null;
  for (const a of placement.anchors) if (a.state === 'open' && (!worst || a.slackCm < worst.slackCm)) worst = { anchor: a.anchor, slackCm: a.slackCm };
  // The thigh has no placed loop (the legs are not morphed to the body), but a leg the fit engine calls tight on a larger thigh does not go on either.
  const thigh = gaps?.slackCm.thigh;
  if (thigh !== undefined && thigh < 0 && gaps?.bands.thigh === 'tight' && (!worst || thigh < worst.slackCm)) worst = { anchor: 'thigh', slackCm: thigh };
  return worst ? { anchor: worst.anchor, bodyLargerCm: Math.round(-worst.slackCm * 10) / 10 } : null;
}

/** The collision exemption of a tape-built trouser: `inside` (`insideCanonical` of the base mesh) kept only below the hip ring. */
export function trouserNoCollide(m: Pick<Mannequin, 'morphHeights'>, inside: Uint8Array, positions: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(inside.length);
  for (let i = 0; i < out.length; i++) out[i] = inside[i] === 1 && positions[3 * i + 1]! < m.morphHeights.hip ? 1 : 0;
  return out;
}

const ellipsePerimeter = (a: number, b: number): number => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

/**
 * `slideWaistband` for a tilted band: the band is the cloth within 2 cm under its top edge's plane (`topEdgePlane`), its
 * girth their hull seen from above, and the body's girth is read at the plane's height on the body axis less 2 cm. A band
 * larger than the body there is lowered to where the body fills it, exactly as `slideWaistband` does. Mutates `start`.
 */
export function slideTrouserBand(field: BodyField, start: Float32Array, indices: ArrayLike<number>, clearanceCm: number): BandSlide {
  const plane = topEdgePlane({ positions: start, indices } as unknown as Pick<Mesh, 'positions' | 'indices'>);
  const n = start.length / 3;
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  if (!plane) return { bandGirthCm: 0, bodyAtBandCm: 0, bodyAtRestCm: 0, dropCm: 0, pastHips: false };
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) if (start[3 * i + 1]! >= plane.a + plane.b * start[3 * i]! + plane.c * start[3 * i + 2]! - 2) pts.push([start[3 * i]!, start[3 * i + 2]!]);
  const band = hullPerimeter(pts);
  const yb = plane.a - 2;
  const e = new Float32Array(4);
  const body = (y: number): number => (sample(field.torso, y, e) ? ellipsePerimeter(e[2]! + clearanceCm, e[3]! + clearanceCm) : NaN);
  const at = body(yb);
  let drop = 0, rest = at, pastHips = false;
  if (Number.isFinite(at) && band > at + BAND_HOLD_CM) {
    let best = -Infinity, bestY = yb, found = false;
    for (let y = yb; y >= yb - BAND_SEARCH_CM; y -= 0.25) {
      const g = body(y);
      if (!Number.isFinite(g)) break;
      if (g > best) { best = g; bestY = y; }
      if (g + BAND_HOLD_CM >= band) { drop = yb - y; rest = g; found = true; break; }
    }
    if (!found) { drop = yb - bestY; rest = best; pastHips = true; }
    for (let i = 0; i < n; i++) start[3 * i + 1] = start[3 * i + 1]! - drop;
  }
  return { bandGirthCm: r1(band), bodyAtBandCm: r1(at), bodyAtRestCm: r1(rest), dropCm: r1(drop), pastHips };
}
