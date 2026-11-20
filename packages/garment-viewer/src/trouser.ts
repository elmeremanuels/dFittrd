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
 * - **The seams do not stretch.** A trouser hangs from its band by its seams: the rises carry the two legs at the crotch
 *   point. As plain cloth edges they stretched 0.6 to 3.4 cm in the drape and the crotch seam hung 3.8 to 4.6 cm under the
 *   body, with edges on it stretched 37 to 59 %. `trouserSeams` hands the drape the seams the bundle names
 *   (`anchors.seams`), which may then stretch by its `stretchPct` at most.
 * - **The leg tops are joined to the torso.** On a body of ellipses (male shape v1) the legs end 2 to 3 cm above the
 *   crotch with a section wider than the torso's there: a ledge at hip height, with nothing to collide with at its edge.
 *   A trouser's cloth is drawn across that edge and the body showed through it as a row of specks. `trouserField` widens
 *   the torso's ellipses to hold the leg tops, easing back to the torso over `LEG_TOP_FILLET_CM` above them. A body with
 *   drawn outlines (v2) has no ledge.
 * - **The seat bridges the hollow between the buttocks.** A body with drawn outlines (male shape v2) has a hollow at the
 *   centre back, 2 to 3 cm deep and a hand wide at the seat (its cleft and the pinch towards the crotch). The builder lays
 *   the seat's rows and the centre back seam on the body's hull there, as a tape and a woven seat lie; against the drawn
 *   outline the seam sank into the hollow in the drape, and what it gained in length let the crotch point drop 1 to 2.5 cm.
 *   `trouserField` hands the drape the torso with that hollow bridged from the hip ring up, easing back to the drawn
 *   outline below it and towards the waist (`bridgeSeatHollow`).
 * - **A size too small is not drawn.** As for the sewn tee (`sewnNotDrawn`): when the fit engine bands the waist or the
 *   seat `tight` with the body larger than the garment (the placed loop is `open`), or the thigh, the size is not draped
 *   and not drawn, and the reason is handed up. Before this a bottom's band was laid on the body whatever its size.
 */
import type { AnchorRing } from '@curtain/anchors';
import type { AnchorGaps, FitResult } from '@curtain/fit-engine';
import type { Mannequin, Mesh } from '@curtain/mannequin';
import type { GarmentAnchorsJson } from './bundle';
import { polarGirth, sample, type BodyField, type Table } from './collide';
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
  // The drawn outline where the body has one (male shape v2), else the ellipse.
  const polar = field.torso.polar;
  const body = (y: number): number => (polar ? polarGirth(polar, y, clearanceCm) : sample(field.torso, y, e) ? ellipsePerimeter(e[2]! + clearanceCm, e[3]! + clearanceCm) : NaN);
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

export interface TrouserSeams {
  paths: number[][];
  /** Shares, not percent. */
  stretch: number;
  grain?: { paths: number[][]; stretch: number; shorten?: number };
}

/** The seams a tape-built trouser names (anchors.json `seams`), or null: paths of welded vertex ids and the stretch they are allowed, as a share. */
export function trouserSeams(anchors: Pick<GarmentAnchorsJson, 'category' | 'builder' | 'seams'>, vertices: number): TrouserSeams | null {
  if (!isTapeTrouser(anchors)) return null;
  const s = anchors.seams;
  if (!s || !Array.isArray(s.paths) || !(s.stretchPct >= 0)) return null;
  const valid = (list: unknown): number[][] => (Array.isArray(list) ? (list as unknown[]).filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && p.every((i) => Number.isInteger(i) && i >= 0 && i < vertices)) : []);
  const paths = valid(s.paths);
  if (!paths.length) return null;
  const share = (pct: number): number => Math.min(pct, 20) / 100;
  const g = s.grain;
  const grainPaths = g && g.stretchPct >= 0 ? valid(g.paths) : [];
  return { paths, stretch: share(s.stretchPct), ...(g && grainPaths.length ? { grain: { paths: grainPaths, stretch: share(g.stretchPct), ...(typeof g.shortenPct === 'number' && g.shortenPct >= 0 ? { shorten: share(g.shortenPct) } : {}) } } : {}) };
}

/** Above the leg tops the widened torso eases back to the drawn torso over this height, cm. */
export const LEG_TOP_FILLET_CM = 3;
/** The most the joined section is widened beyond the leg's outermost point, as a factor. */
export const LEG_TOP_WIDEN = 1.1;

const fields = new WeakMap<BodyField, BodyField>();

/** Below the hip ring the bridged hollow eases back to the drawn outline over this height, cm (under the seat the seam hangs free of the body). */
export const SEAT_BRIDGE_BELOW_CM = 3;
/** … and above it between these shares of the way from the hip ring to the waist ring (the band reads the drawn body). */
export const SEAT_BRIDGE_FADE: readonly [number, number] = [0.4, 0.65];

/**
 * The collision field a tape-built trouser is draped against (see the file header): on a body of ellipses `field` with the
 * torso holding the leg tops; on a body with drawn outlines `field` with the hollow at the centre back of the seat bridged,
 * which needs the body's hip and waist heights (without them that body's field is handed back as it is).
 */
export function trouserField(field: BodyField, heights?: { hip: number; waist: number }): BodyField {
  if (field.torso.polar && !heights) return field;
  let hit = fields.get(field);
  if (!hit) fields.set(field, (hit = field.torso.polar ? bridgeSeatHollow(field, heights!) : joinLegTops(field)));
  return hit;
}

/** Convex hull (counter-clockwise) of 2D points. */
function hull2(pts: readonly [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let k = p.length - 1; k >= 0; k--) { const q = p[k]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/**
 * The torso's drawn outlines with the hollow at the centre back bridged: from the centre back outwards, to where the
 * outline meets its own hull again (the crest of each buttock), the radius is the hull's. Only the back, and only round
 * the seat: the front and the sides stay the drawn body, as do the legs.
 */
function bridgeSeatHollow(field: BodyField, heights: { hip: number; waist: number }): BodyField {
  const polar = field.torso.polar!;
  const n = polar.n, stride = n + 3;
  const data = Float32Array.from(polar.data);
  const top0 = heights.hip + SEAT_BRIDGE_FADE[0] * (heights.waist - heights.hip), top1 = heights.hip + SEAT_BRIDGE_FADE[1] * (heights.waist - heights.hip);
  const back = Math.round((3 * n) / 4);
  for (let k = 0; k < data.length / stride; k++) {
    if (data[k * stride] !== 1) continue;
    const y = polar.lo + k * polar.stepCm;
    const w = y < heights.hip ? 1 - (heights.hip - y) / SEAT_BRIDGE_BELOW_CM : y <= top0 ? 1 : 1 - (y - top0) / Math.max(1e-6, top1 - top0);
    if (!(w > 0)) continue;
    const at = k * stride + 3;
    const pts: [number, number][] = [];
    for (let j = 0; j < n; j++) pts.push([polar.data[at + j]! * Math.cos((2 * Math.PI * j) / n), polar.data[at + j]! * Math.sin((2 * Math.PI * j) / n)]);
    const h = hull2(pts);
    /** The hull along the ray j from the outline's centre. */
    const onHull = (j: number): number => {
      const dx = Math.cos((2 * Math.PI * j) / n), dz = Math.sin((2 * Math.PI * j) / n);
      let best = 0;
      for (let i = 0; i < h.length; i++) {
        const p = h[i]!, q = h[(i + 1) % h.length]!;
        const ex = q[0] - p[0], ez = q[1] - p[1];
        const det = ex * dz - ez * dx;
        if (Math.abs(det) < 1e-12) continue;
        const t = (ex * p[1] - ez * p[0]) / det, u = (dx * p[1] - dz * p[0]) / det;
        if (u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
      }
      return best;
    };
    for (const dir of [1, -1]) for (let c = dir === 1 ? 0 : 1; c < n / 4; c++) {
      const j = (back + dir * c + n) % n;
      const r = polar.data[at + j]!, R = onHull(j);
      if (R <= r + 0.02) break;
      data[at + j] = r + (R - r) * w;
    }
  }
  return { ...field, torso: { ...field.torso, polar: { ...polar, data } } };
}

function joinLegTops(field: BodyField): BodyField {
  const leg: Table = field.legs[0];
  let top = leg.data.length / 5 - 1;
  while (top >= 0 && leg.data[5 * top] !== 1) top--;
  if (top < 0) return field;
  const legHi = leg.lo + top * leg.stepCm;
  const t = field.torso;
  const data = Float32Array.from(t.data);
  const e = new Float32Array(4);
  for (let k = 0; k < data.length / 5; k++) {
    if (data[5 * k] !== 1) continue;
    const y = t.lo + k * t.stepCm;
    if (y > legHi + LEG_TOP_FILLET_CM) break;
    // The leg's section at this height, or its topmost one above it.
    if (!sample(leg, Math.min(y, legHi - 1e-3), e)) continue;
    const w = y <= legHi ? 1 : 1 - (y - legHi) / LEG_TOP_FILLET_CM;
    const dx = Math.abs(e[0]! - data[5 * k + 1]!), dz = e[1]! - data[5 * k + 2]!;
    let a = Math.max(data[5 * k + 3]!, dx + e[2]!);
    const b = Math.max(data[5 * k + 4]!, Math.abs(dz) + e[3]!);
    // An ellipse through the leg's outermost and foremost points still cuts the leg's corners: it is widened by what
    // they stand out (at most `LEG_TOP_WIDEN`); the depth stays, so the centre front and back, where the crotch seam
    // runs, do not move.
    let grow = 1;
    for (let j = 0; j < 32; j++) {
      const phi = (2 * Math.PI * j) / 32;
      grow = Math.max(grow, Math.hypot((dx + e[2]! * Math.cos(phi)) / a, (dz + e[3]! * Math.sin(phi)) / b));
    }
    a *= Math.min(grow, LEG_TOP_WIDEN);
    data[5 * k + 3] = data[5 * k + 3]! + (a - data[5 * k + 3]!) * w;
    data[5 * k + 4] = data[5 * k + 4]! + (b - data[5 * k + 4]!) * w;
  }
  return { ...field, torso: { ...t, data } };
}
