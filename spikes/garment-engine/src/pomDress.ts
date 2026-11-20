/**
 * POM builder for a women's strap dress with an underbust seam and a gathered skirt (a babydoll): the
 * second garment of the tape route (docs/research/step3-serverdrape-spike.md §9.10 asked for a second
 * garment and a second stature before "route" is claimed; docs/reports/claude/dress-from-tape.md).
 * The flat measurements a shop can take with a tape become ONE welded mesh on the canonical female
 * mannequin: a bodice from a level top edge down to the underbust seam, a skirt gathered into that
 * seam, and two straps over the shoulders. No simulation, no pattern library, no photo.
 *
 * Construction (cm, mannequin space):
 * - **Bodice**: rows at constant height, each the body's cross-section offset outwards so that its
 *   girth is the tape's: `2 × bust width` from the top edge down to the body's bust line, then a
 *   straight line to `2 × seam width` at the seam. Never closer than `minEaseCm` to the body.
 * - **Where it hangs** is solved, not assumed: the top edge's height is the one at which a strap of the
 *   tape's length reaches from the front edge over the shoulder to the back edge. The seam's height is
 *   the one at which the path down the centre front from the top edge is the tape's bodice length; the
 *   hem's the one at which that path continued is the tape's length.
 * - **Skirt**: every row is a closed line of cloth whose length runs straight from the skirt's top
 *   edge (the gathered panel pulled flat, `2 × skirt top width`; the seam's own girth when the shop
 *   gives none) to the hem sweep. The cloth is longer than the line round the body it hangs on, so it
 *   is gathered finely at the seam and laid in `folds` soft folds below it: an envelope (the seam's girth at the top, `hemHullShare` of the sweep
 *   at the hem, never inside the body) plus an outward wave whose height is solved per row so that the
 *   row's cloth length is exact. The folds are a start shape and the rest shape of the cloth's bend;
 *   the drape on the device decides how they hang.
 * - **Straps**: one strip each, front edge to back edge over the shoulder at a fixed distance from the
 *   centre (half the neckline width), lying `strapEaseCm` off the body.
 *
 * What is measured where is what `measurePomDress` checks on the built mesh (the gate: every input
 * within 0.5 cm): bust = length of the top edge; seam = length of the seam ring; skirt top = cloth
 * length of the skirt's first row; hem = cloth length of the hem row; bodice length and length = the
 * path down the centre front; strap = the strap's centre line; neckline = straight distance between
 * the two straps' inner front corners.
 *
 * Every number in `POM_DRESS_ASSUMPTIONS` is an assumption [A], not measured on any garment.
 */
import { topology, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';

/** A strap dress's flat measurements of one size, cm (widths are half girths, the garment laid flat). */
export interface PomDressRow {
  size: string;
  /** Flat width of the bodice at its top edge, side seam to side seam (under the arms). */
  bustWidthCm: number;
  /** Flat width along the underbust seam, lying as it falls. */
  seamWidthCm: number;
  /** Flat width of the skirt panel just under the seam with its gathers pulled flat; absent = not gathered (the seam's width). */
  skirtTopWidthCm?: number;
  /** Flat width along the hem edge (half the hem sweep). */
  hemWidthCm: number;
  /** Centre front, top edge of the bodice to the hem. */
  lengthCm: number;
  /** Centre front, top edge of the bodice to the underbust seam. */
  bodiceLengthCm: number;
  /** One strap, from where it leaves the front edge to where it meets the back edge. */
  strapLengthCm: number;
  /** Straight distance between the two straps' inner edges where they leave the front edge. */
  necklineWidthCm: number;
}

export const POM_DRESS_KEYS = ['bustWidthCm', 'seamWidthCm', 'skirtTopWidthCm', 'hemWidthCm', 'lengthCm', 'bodiceLengthCm', 'strapLengthCm', 'necklineWidthCm'] as const;
export type PomDressKey = (typeof POM_DRESS_KEYS)[number];

/** What the builder needs and no tape gives: all assumed [A]. */
export const POM_DRESS_ASSUMPTIONS = {
  /** Least distance of the bodice off the body (a tighter tape value is flagged, the built girth is then larger). */
  minEaseCm: 0.5,
  /** Least distance of the skirt's envelope off the body below the seam. */
  skirtMinEaseCm: 1,
  /** The skirt's first row lies this far under the seam ring (the gathering stitch). */
  seamGapCm: 0.8,
  /** Soft folds round the skirt, and the depth under the seam over which the gathers run into them. */
  folds: 24,
  gatherBlendCm: 8,
  /** The line round the outside of the hanging hem, as a share of the hem sweep (the rest is in the folds). */
  hemHullShare: 0.72,
  /** Strap width, and how far the strap lies off the body. */
  strapWidthCm: 1.5,
  strapEaseCm: 0.4,
  /** The top edge is level all round: the back as high as the front, no sweetheart dip. */
  topEdge: 'level',
  /** The straps meet the back edge as far apart as they leave the front edge. */
  backStrapSpacing: 'as front',
} as const;

export interface PomDressOptions {
  /** Columns round the bodice (the skirt has twice as many), and the row spacing, cm. */
  bodiceColumns?: number;
  rowStepCm?: number;
}

export interface PomDressBuild {
  mesh: Mesh;
  row: PomDressRow;
  /** Vertex ids of the closed rings: the bodice's top edge, the seam, the skirt's first row, the hem. */
  topEdge: number[];
  seam: number[];
  skirtTop: number[];
  hem: number[];
  /** The centre front line, top edge to hem (the seam vertex is at `centreFrontSeamAt`). */
  centreFront: number[];
  centreFrontSeamAt: number;
  /** Each strap's inner and outer edge, front corner to back corner (left, right). */
  straps: [{ inner: number[]; outer: number[] }, { inner: number[]; outer: number[] }];
  levels: { topY: number; bustLineY: number; seamY: number; hemY: number };
  /** Rows where the tape is tighter than the least ease off this body (height, girth asked, girth built). */
  tight: { y: number; askedCm: number; builtCm: number }[];
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------------------
// The body's cross-section as a convex hull, and its offset (as `pomTee.ts`, kept apart from it)
// ---------------------------------------------------------------------------

type P2 = [number, number];

function hull2(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: P2, a: P2, b: P2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let k = p.length - 1; k >= 0; k--) { const q = p[k]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

const perimeter = (h: readonly P2[]): number => h.reduce((s, a, i) => s + Math.hypot(h[(i + 1) % h.length]![0] - a[0], h[(i + 1) % h.length]![1] - a[1]), 0);

/** Convex hull (x, z) of the body at height y: torso and, where there are legs, both legs. */
function bodyHull(m: Mannequin, y: number): P2[] {
  const pts: P2[] = [];
  const add = (e: { cx: number; cz: number; a: number; b: number } | null): void => {
    if (!e) return;
    for (let k = 0; k < 96; k++) {
      const t = (2 * Math.PI * k) / 96;
      pts.push([e.cx + e.a * Math.cos(t), e.cz + e.b * Math.sin(t)]);
    }
  };
  add(m.torsoAt(y));
  add(m.legAt(y, 1));
  add(m.legAt(y, -1));
  return hull2(pts);
}

function polyDistance(h: readonly P2[], x: number, z: number): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!, b = h[(i + 1) % h.length]!;
    const ex = b[0] - a[0], ez = b[1] - a[1];
    if (ex * (z - a[1]) - ez * (x - a[0]) < 0) inside = false;
    const t = clamp01(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez));
    best = Math.min(best, Math.hypot(x - a[0] - t * ex, z - a[1] - t * ez));
  }
  return inside ? 0 : best;
}

/** Point on the hull offset by d along azimuth θ from the vertical axis (0 = +x, the wearer's left; π/2 = +z, the front). */
function hullRay(h: readonly P2[], d: number, theta: number): P2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  let lo = 0, hi = 120;
  for (let it = 0; it < 44; it++) {
    const mid = (lo + hi) / 2;
    if (polyDistance(h, mid * c, mid * s) <= d) lo = mid;
    else hi = mid;
  }
  return [lo * c, lo * s];
}

/** Ascending stations from `from` to `to` (both included) about `step` apart, through every `required` height. */
function rowsBetween(from: number, to: number, step: number, required: readonly number[]): number[] {
  const knots = [from, ...[...required].sort((a, b) => a - b), to];
  const out: number[] = [from];
  for (let k = 1; k < knots.length; k++) {
    const a = knots[k - 1]!, b = knots[k]!;
    const n = Math.max(1, Math.round((b - a) / step));
    for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / n);
  }
  return out;
}

/** Length of the closed line through the vertices `ids` in order. */
export function ringLength(positions: ArrayLike<number>, ids: readonly number[]): number {
  let len = 0;
  for (let k = 0; k < ids.length; k++) {
    const a = ids[k]!, b = ids[(k + 1) % ids.length]!;
    len += Math.hypot(positions[3 * a]! - positions[3 * b]!, positions[3 * a + 1]! - positions[3 * b + 1]!, positions[3 * a + 2]! - positions[3 * b + 2]!);
  }
  return len;
}

/** Length of the open line through the vertices `ids` in order. */
export function pathLength(positions: ArrayLike<number>, ids: readonly number[]): number {
  let len = 0;
  for (let k = 1; k < ids.length; k++) {
    const a = ids[k - 1]!, b = ids[k]!;
    len += Math.hypot(positions[3 * a]! - positions[3 * b]!, positions[3 * a + 1]! - positions[3 * b + 1]!, positions[3 * a + 2]! - positions[3 * b + 2]!);
  }
  return len;
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

export function buildPomDress(m: Mannequin, row: PomDressRow, options: PomDressOptions = {}): PomDressBuild {
  const A = POM_DRESS_ASSUMPTIONS;
  const NB = options.bodiceColumns ?? 72;
  if (NB % 4 !== 0) throw new Error('pomDress: bodiceColumns must be a multiple of 4');
  const NS = 2 * NB;
  const rowStep = options.rowStepCm ?? 1.6;
  const tight: PomDressBuild['tight'] = [];
  const gBust = 2 * row.bustWidthCm, gSeam = 2 * row.seamWidthCm, sweep = 2 * row.hemWidthCm;
  const skirtTop = 2 * (row.skirtTopWidthCm ?? row.seamWidthCm);
  if (skirtTop < gSeam - 1e-6) throw new Error('pomDress: the skirt top is shorter than the seam it is gathered into');
  const bustLineY = m.morphHeights.chest;
  const dTheta = (2 * Math.PI) / NB;

  /** The body's hull at y offset so that its girth is `want`; never closer than `least`. */
  const ringAt = (y: number, want: number, least: number, record = false): { h: P2[]; d: number; girth: number } => {
    const h = bodyHull(m, y);
    const P = perimeter(h);
    let d = (want - P) / (2 * Math.PI);
    if (d < least) {
      if (record) tight.push({ y: Math.round(y * 10) / 10, askedCm: Math.round(want * 10) / 10, builtCm: Math.round((P + 2 * Math.PI * least) * 10) / 10 });
      d = least;
    }
    return { h, d, girth: P + 2 * Math.PI * d };
  };

  // ---- the straps decide where the top edge is -------------------------------------------------------
  const xIn = row.necklineWidthCm / 2, xOut = xIn + A.strapWidthCm;
  /** The body's surface at distance x from the centre and height y, front (sign 1) or back, `ease` off it; null above the shoulder there. */
  const surfaceZ = (x: number, y: number, sign: 1 | -1, ease: number): number | null => {
    const e = m.torsoAt(y);
    if (!e) return null;
    const u = (x - e.cx) / (e.a + ease);
    if (Math.abs(u) >= 1) return null;
    return e.cz + sign * (e.b + ease) * Math.sqrt(1 - u * u);
  };
  /** The azimuth in the front-left (sign 1) or back-left quadrant at which the top row is x from the centre. */
  const azimuthFor = (top: { h: P2[]; d: number }, x: number, sign: 1 | -1): number => {
    let lo = 0.02, hi = Math.PI / 2 - 0.02;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (hullRay(top.h, top.d, sign * mid)[0] > x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  /** One strap edge at distance x: the line from the front corner over the shoulder to the back corner. */
  const strapEdge = (x: number, topY: number, zFront: number, zBack: number): Vec3[] => {
    const easeAt = (z: number, sign: 1 | -1): number => {
      let lo = 0, hi = 8;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        const s = surfaceZ(x, topY, sign, mid);
        if (s !== null && sign * s < sign * z) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const e0f = easeAt(zFront, 1), e0b = easeAt(zBack, -1);
    const side = (sign: 1 | -1, e0: number, z0: number): Vec3[] => {
      const pts: Vec3[] = [[x, topY, z0]];
      for (let y = topY + 0.05; y < topY + 40; y += 0.05) {
        const z = surfaceZ(x, y, sign, lerp(e0, A.strapEaseCm, smooth((y - topY) / 3)));
        if (z === null) break;
        pts.push([x, y, z]);
      }
      return pts;
    };
    const f = side(1, e0f, zFront), b = side(-1, e0b, zBack);
    // Over the top: both sides end where the body is x wide; join them through the midpoint of their last points.
    const fl = f[f.length - 1]!, bl = b[b.length - 1]!;
    return [...f, [x, Math.max(fl[1], bl[1]) + 0.05, (fl[2] + bl[2]) / 2] as Vec3, ...b.reverse()];
  };
  const polyLen = (p: readonly Vec3[]): number => p.reduce((s, q, i) => (i ? s + dist(p[i - 1]!, q) : 0), 0);
  const strapsAt = (topY: number): { top: ReturnType<typeof ringAt>; thF: [number, number]; thB: [number, number]; inner: Vec3[]; outer: Vec3[]; length: number } => {
    const top = ringAt(topY, gBust, A.minEaseCm);
    const thF: [number, number] = [azimuthFor(top, xIn, 1), azimuthFor(top, xOut, 1)];
    const thB: [number, number] = [azimuthFor(top, xIn, -1), azimuthFor(top, xOut, -1)];
    const z = (th: number, sign: 1 | -1): number => hullRay(top.h, top.d, sign * th)[1];
    const inner = strapEdge(xIn, topY, z(thF[0], 1), z(thB[0], -1));
    const outer = strapEdge(xOut, topY, z(thF[1], 1), z(thB[1], -1));
    return { top, thF, thB, inner, outer, length: (polyLen(inner) + polyLen(outer)) / 2 };
  };
  // A lower top edge needs a longer strap: bisect the top edge's height for the tape's strap length.
  let yLo = bustLineY - 6, yHi = m.morphHeights.shoulder - 1;
  if (strapsAt(yLo).length < row.strapLengthCm) throw new Error(`pomDress: a ${row.strapLengthCm} cm strap puts the top edge more than 6 cm under the bust line`);
  if (strapsAt(yHi).length > row.strapLengthCm) throw new Error(`pomDress: a ${row.strapLengthCm} cm strap is too short to reach over the shoulder`);
  for (let it = 0; it < 40; it++) {
    const mid = (yLo + yHi) / 2;
    if (strapsAt(mid).length > row.strapLengthCm) yLo = mid;
    else yHi = mid;
  }
  const topY = (yLo + yHi) / 2;
  const strap = strapsAt(topY);

  // ---- column azimuths: uniform, with the four strap corners moved onto their exact place ------------
  const ang = Array.from({ length: NB }, (_, c) => c * dTheta);
  const q = NB / 4;
  /** Column index of an azimuth in the front-left quadrant, kept clear of the side (0) and the centre (q). */
  const colOf = (th: number): number => Math.min(q - 2, Math.max(2, Math.round(th / dTheta)));
  const cIn = colOf(strap.thF[0]);
  const cOut = Math.min(cIn - 1, colOf(strap.thF[1]));
  const cInB = colOf(strap.thB[0]);
  const cOutB = Math.min(cInB - 1, colOf(strap.thB[1]));
  // Front left c, front right NB/2 − c, back left NB − c, back right NB/2 + c.
  ang[cIn] = strap.thF[0]; ang[NB / 2 - cIn] = Math.PI - strap.thF[0];
  ang[cOut] = strap.thF[1]; ang[NB / 2 - cOut] = Math.PI - strap.thF[1];
  ang[NB - cInB] = 2 * Math.PI - strap.thB[0]; ang[NB / 2 + cInB] = Math.PI + strap.thB[0];
  ang[NB - cOutB] = 2 * Math.PI - strap.thB[1]; ang[NB / 2 + cOutB] = Math.PI + strap.thB[1];
  const skirtAng = Array.from({ length: NS }, (_, j) => (j % 2 === 0 ? ang[j / 2]! : (ang[(j - 1) / 2]! + (j === NS - 1 ? 2 * Math.PI : ang[(j + 1) / 2]!)) / 2));
  const CF = q; // the centre front column (azimuth π/2)

  // ---- solve the seam's and the hem's height for the two lengths --------------------------------------
  const girthAt = (y: number, seamY: number): number => (y >= bustLineY ? gBust : lerp(gSeam, gBust, clamp01((y - seamY) / Math.max(1e-6, bustLineY - seamY))));
  const bodiceYs = (seamY: number): number[] => rowsBetween(seamY, topY, rowStep, [bustLineY].filter((y) => y > seamY + 0.5 && y < topY - 0.5));
  const cfBodice = (seamY: number): number => {
    const ys = bodiceYs(seamY);
    let len = 0, prev: P2 | null = null, prevY = 0;
    for (const y of ys) {
      const r = ringAt(y, girthAt(y, seamY), A.minEaseCm);
      const p = hullRay(r.h, r.d, Math.PI / 2);
      if (prev) len += Math.hypot(p[0] - prev[0], y - prevY, p[1] - prev[1]);
      prev = p;
      prevY = y;
    }
    return len;
  };
  let seamY = topY - row.bodiceLengthCm;
  for (let it = 0; it < 6; it++) {
    const got = cfBodice(seamY);
    if (Math.abs(got - row.bodiceLengthCm) < 0.005) break;
    seamY -= row.bodiceLengthCm - got;
  }
  if (seamY >= bustLineY - 1) throw new Error('pomDress: the bodice ends above the bust line; this builder needs an underbust seam');

  /** One skirt row: the envelope's hull at y and the fold height that makes the row's cloth length `cloth`. */
  const skirtRow = (y: number, t: number, y0: number, record = false): P2[] => {
    const cloth = lerp(skirtTop, sweep, t);
    const env = ringAt(y, Math.min(cloth, lerp(gSeam, A.hemHullShare * sweep, t)), t === 0 ? A.minEaseCm : A.skirtMinEaseCm);
    // Only cloth that is itself shorter than the line round the body is "tight"; the envelope is an assumption.
    if (record && cloth < env.girth - 1e-6) tight.push({ y: Math.round(y * 10) / 10, askedCm: Math.round(cloth * 10) / 10, builtCm: Math.round(env.girth * 10) / 10 });
    const base = skirtAng.map((th) => hullRay(env.h, env.d, th));
    // At the seam the cloth is gathered: a fine zigzag, every second vertex out (a steep, deep fold there would lever the
    // seam open under the skirt's weight). Over `gatherBlendCm` it runs into the soft folds: an outward wave, lowest (on
    // the envelope) at the centre front and back.
    const blend = smooth((y0 - y) / A.gatherBlendCm);
    const w = skirtAng.map((th, j) => lerp(j % 2, (1 - Math.cos(A.folds * (th - Math.PI / 2))) / 2, blend));
    const at = (amp: number): P2[] => base.map((p, j) => [p[0] + amp * w[j]! * Math.cos(skirtAng[j]!), p[1] + amp * w[j]! * Math.sin(skirtAng[j]!)] as P2);
    if (perimeter(base) >= cloth) return base;
    let lo = 0, hi = 40;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (perimeter(at(mid)) < cloth) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2);
  };

  const assemble = (hemY: number, record: boolean): Omit<PomDressBuild, 'row' | 'tight' | 'levels'> => {
    const pos: number[] = [];
    const add = (p: Vec3): number => {
      pos.push(p[0], p[1], p[2]);
      return pos.length / 3 - 1;
    };
    const tris: number[] = [];
    const quad = (a: number, b: number, c: number, d: number): void => {
      tris.push(a, b, c, a, c, d);
    };
    // Bodice rows, seam (row 0) to top edge.
    const ys = bodiceYs(seamY);
    const bodice: number[][] = ys.map((y) => {
      const r = ringAt(y, girthAt(y, seamY), A.minEaseCm, record);
      return ang.map((th) => {
        const [x, z] = hullRay(r.h, r.d, th);
        return add([x, y, z]);
      });
    });
    for (let r = 0; r + 1 < bodice.length; r++) for (let c = 0; c < NB; c++) quad(bodice[r]![c]!, bodice[r]![(c + 1) % NB]!, bodice[r + 1]![(c + 1) % NB]!, bodice[r + 1]![c]!);
    // Skirt rows, first row (under the seam) to hem.
    const y0 = seamY - A.seamGapCm;
    const n = Math.max(2, Math.round((y0 - hemY) / rowStep));
    const skirt: number[][] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const y = lerp(y0, hemY, t);
      skirt.push(skirtRow(y, t, y0, record).map(([x, z]) => add([x, y, z])));
    }
    for (let k = 0; k + 1 < skirt.length; k++) for (let j = 0; j < NS; j++) quad(skirt[k + 1]![j]!, skirt[k + 1]![(j + 1) % NS]!, skirt[k]![(j + 1) % NS]!, skirt[k]![j]!);
    // The gathering stitch: every seam vertex takes two skirt vertices.
    const seam = bodice[0]!, first = skirt[0]!;
    for (let c = 0; c < NB; c++) {
      const s0 = seam[c]!, s1 = seam[(c + 1) % NB]!;
      const a = first[2 * c]!, b = first[2 * c + 1]!, d = first[(2 * c + 2) % NS]!;
      tris.push(a, b, s0, b, s1, s0, b, d, s1);
    }
    // Straps: left (x > 0) and right, inner and outer edge resampled by length to the same number of rows.
    const top = bodice[bodice.length - 1]!;
    const resample = (line: readonly Vec3[], rows: number): Vec3[] => {
      const acc = [0];
      for (let i = 1; i < line.length; i++) acc.push(acc[i - 1]! + dist(line[i - 1]!, line[i]!));
      const total = acc[acc.length - 1]!;
      const out: Vec3[] = [];
      let j = 0;
      for (let i = 0; i <= rows; i++) {
        const want = (total * i) / rows;
        while (j < acc.length - 2 && acc[j + 1]! < want) j++;
        const t = clamp01((want - acc[j]!) / Math.max(1e-9, acc[j + 1]! - acc[j]!));
        out.push([lerp(line[j]![0], line[j + 1]![0], t), lerp(line[j]![1], line[j + 1]![1], t), lerp(line[j]![2], line[j + 1]![2], t)]);
      }
      return out;
    };
    const rows = Math.max(4, Math.round(strap.length / rowStep));
    const innerPts = resample(strap.inner, rows), outerPts = resample(strap.outer, rows);
    const straps = ([1, -1] as const).map((side) => {
      const fIn = top[side === 1 ? cIn : NB / 2 - cIn]!, fOut = top[side === 1 ? cOut : NB / 2 - cOut]!;
      const bIn = top[side === 1 ? NB - cInB : NB / 2 + cInB]!, bOut = top[side === 1 ? NB - cOutB : NB / 2 + cOutB]!;
      const inner = [fIn], outer = [fOut];
      for (let i = 1; i < rows; i++) {
        inner.push(add([side * innerPts[i]![0], innerPts[i]![1], innerPts[i]![2]]));
        outer.push(add([side * outerPts[i]![0], outerPts[i]![1], outerPts[i]![2]]));
      }
      inner.push(bIn);
      outer.push(bOut);
      for (let i = 0; i < rows; i++) quad(inner[i]!, outer[i]!, outer[i + 1]!, inner[i + 1]!);
      return { inner, outer };
    }) as PomDressBuild['straps'];
    const positions = Float64Array.from(pos);
    const mesh: Mesh = { positions, indices: Uint32Array.from(orientOutward(positions, tris, bustLineY)), vertexPart: new Uint8Array(pos.length / 3), partNames: ['body'] };
    const centreFront = [...bodice.map((r) => r[CF]!).reverse(), ...skirt.map((r) => r[2 * CF]!)];
    return { mesh, topEdge: top, seam, skirtTop: first, hem: skirt[skirt.length - 1]!, centreFront, centreFrontSeamAt: bodice.length - 1, straps };
  };

  // The centre front lies in a fold's valley (on the envelope) in every row, so the hem's height is solved on that one
  // line; the mesh is assembled once.
  const envelopeGirth = (t: number): number => Math.min(lerp(skirtTop, sweep, t), lerp(gSeam, A.hemHullShare * sweep, t));
  const cfLength = (hemY: number): number => {
    const y0 = seamY - A.seamGapCm;
    const n = Math.max(2, Math.round((y0 - hemY) / rowStep));
    const seamRing = ringAt(seamY, gSeam, A.minEaseCm);
    let prev: P2 = hullRay(seamRing.h, seamRing.d, Math.PI / 2), prevY = seamY, len = row.bodiceLengthCm;
    for (let k = 0; k <= n; k++) {
      const t = k / n, y = lerp(y0, hemY, t);
      const env = ringAt(y, envelopeGirth(t), t === 0 ? A.minEaseCm : A.skirtMinEaseCm);
      const p = hullRay(env.h, env.d, Math.PI / 2);
      len += Math.hypot(p[0] - prev[0], y - prevY, p[1] - prev[1]);
      prev = p;
      prevY = y;
    }
    return len;
  };
  let hemY = topY - row.lengthCm;
  for (let it = 0; it < 8; it++) {
    const got = cfLength(hemY);
    if (Math.abs(got - row.lengthCm) < 0.005) break;
    hemY -= row.lengthCm - got;
  }
  const built = assemble(hemY, true);
  const seen = new Set<number>();
  return { ...built, row, levels: { topY, bustLineY, seamY, hemY }, tight: tight.filter((x) => (seen.has(x.y) ? false : (seen.add(x.y), true))) };
}

/**
 * Consistent winding over the welded mesh (neighbouring triangles run a shared edge in opposite
 * directions), then flipped as a whole when the bodice at the bust line faces inwards.
 */
function orientOutward(pos: Float64Array, tris: number[], bustLineY: number): number[] {
  const T = tris.length / 3;
  const edgeTris = new Map<string, number[]>();
  const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const k = key(tris[3 * t + e]!, tris[3 * t + ((e + 1) % 3)]!);
    (edgeTris.get(k) ?? edgeTris.set(k, []).get(k)!).push(t);
  }
  const done = new Uint8Array(T);
  const runs = (t: number, a: number, b: number): boolean => {
    for (let e = 0; e < 3; e++) if (tris[3 * t + e] === a && tris[3 * t + ((e + 1) % 3)] === b) return true;
    return false;
  };
  done[0] = 1;
  const stack = [0];
  while (stack.length) {
    const t = stack.pop()!;
    for (let e = 0; e < 3; e++) {
      const a = tris[3 * t + e]!, b = tris[3 * t + ((e + 1) % 3)]!;
      for (const u of edgeTris.get(key(a, b))!) {
        if (u === t || done[u]) continue;
        if (runs(u, a, b)) {
          const tmp = tris[3 * u + 1]!;
          tris[3 * u + 1] = tris[3 * u + 2]!;
          tris[3 * u + 2] = tmp;
        }
        done[u] = 1;
        stack.push(u);
      }
    }
  }
  let score = 0;
  for (let t = 0; t < T; t++) {
    const P = (i: number): Vec3 => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!];
    const a = P(tris[3 * t]!), b = P(tris[3 * t + 1]!), c = P(tris[3 * t + 2]!);
    if (Math.abs(a[1] - bustLineY) > 3) continue;
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    score += nx * a[0] + nz * a[2];
  }
  if (score < 0) for (let t = 0; t < T; t++) {
    const tmp = tris[3 * t + 1]!;
    tris[3 * t + 1] = tris[3 * t + 2]!;
    tris[3 * t + 2] = tmp;
  }
  return tris;
}

// ---------------------------------------------------------------------------
// Tape: what the shop's measurements are on a mesh with this builder's vertex lists
// ---------------------------------------------------------------------------

/** The dress's own tape: every input measurement taken on `positions` (the built mesh, or the same mesh graded or draped). */
export function measurePomDress(positions: ArrayLike<number>, b: Pick<PomDressBuild, 'topEdge' | 'seam' | 'skirtTop' | 'hem' | 'centreFront' | 'centreFrontSeamAt' | 'straps'>): PomDressRow {
  const [l, r] = b.straps;
  const P = (i: number): Vec3 => [positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!];
  return {
    size: '',
    bustWidthCm: ringLength(positions, b.topEdge) / 2,
    seamWidthCm: ringLength(positions, b.seam) / 2,
    skirtTopWidthCm: ringLength(positions, b.skirtTop) / 2,
    hemWidthCm: ringLength(positions, b.hem) / 2,
    lengthCm: pathLength(positions, b.centreFront),
    bodiceLengthCm: pathLength(positions, b.centreFront.slice(0, b.centreFrontSeamAt + 1)),
    strapLengthCm: (pathLength(positions, l.inner) + pathLength(positions, l.outer)) / 2,
    necklineWidthCm: dist(P(l.inner[0]!), P(r.inner[0]!)),
  };
}

/** Built minus asked, per input measurement given, cm. */
export function pomDressErrors(asked: PomDressRow, got: PomDressRow): Partial<Record<PomDressKey, number>> {
  const out: Partial<Record<PomDressKey, number>> = {};
  for (const k of POM_DRESS_KEYS) {
    const a = asked[k] ?? (k === 'skirtTopWidthCm' ? asked.seamWidthCm : undefined), g = got[k];
    if (typeof a === 'number' && typeof g === 'number') out[k] = g - a;
  }
  return out;
}

export { topology };
