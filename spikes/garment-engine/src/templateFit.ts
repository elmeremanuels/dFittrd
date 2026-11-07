/**
 * Stage 4t, template fit (CPU, no GPU, no learned model): the product's control proxy, remeshed
 * into cylindrical grids (a body tube around the torso axis and, when the turntable shows sleeves,
 * one tube per arm), fitted to the turntable's garment masks with the known cameras. The
 * alternative to stage 4's 2DGS + TSDF reconstruction (run 14: 22 % of its vertices inside the
 * mannequin, holes in the bodice, a ragged hem); both stay.
 *
 * Every vertex lives on a fixed ray (from the body axis, or from the arm axis for a sleeve) and
 * moves only along it: p = origin + s · direction. Per ray:
 *
 *   1. admissible interval [sLo, sHi]: from where the ray leaves the mannequin plus
 *      `clearanceCm` (signed distance to mannequin.glb, `bodySdf.ts`) to where it would enter
 *      another body part; a ray that leaves the body only far beyond its own part's surface (the
 *      arm overlapping the torso of the v0 mannequin) is `blocked` and its vertex trimmed: that is
 *      the armhole, which the sleeve tube covers;
 *   2. visual-hull carving: a point is carved when more than `tau` training views see "no garment"
 *      where it projects (background, or mannequin visible and behind the point); occluded views
 *      (mannequin in front of the point) say nothing. The hull radius is the first carved point
 *      from sLo outwards, refined by bisection; a ray carved at sLo is empty (neckline, below the
 *      hem, beyond the cuff). This is carving where the proxy is too big and expansion where it is
 *      too small;
 *   3. extents first: per column the hem (body) or the cuff (sleeve) is found on a fine profile,
 *      smoothed round the garment, and the grid is built to end exactly there, so the hem edge is
 *      a clean line that follows the masks' lowest garment rows per angle instead of a staircase;
 *   4. regularised solve: s minimises Σ w (s − hull)² + λ Σ (s − s_neighbour)² over the grid (a
 *      Laplacian on the radial offsets), Jacobi iterations with the hard constraint s ∈ [sLo, sHi]
 *      applied after every sweep, until the largest change is below `toleranceCm`. Where a ray has
 *      no evidence the template proxy holds it.
 *
 * Output: one welded mesh (body + sleeves as separate open tubes that overlap at the armhole),
 * outward triangles, and a render copy with a UV seam per tube (cylindrical charts) for the bake.
 */
import { type Mannequin, type Mesh, type Side, type Vec3 } from '@curtain/mannequin';
import { buildBodySdf, MIN_CLEARANCE_CM, type BodySdf } from './bodySdf';
import type { Mask } from './evalPng';
import { cleanMask, DEFAULT_CLEANUP, morph, project, rasterize, type MaskCleanup, type PinholeCamera } from './views';

export const TEMPLATE_FIT_VERSION = 'stage4t-template-fit-0.1.0';

export interface FitViews {
  cameras: PinholeCamera[];
  /** Garment masks (visible garment, 1 = garment), one per camera, same order. */
  masks: Mask[];
  /** Indices into `cameras` used to fit; the rest is held out for the report. */
  train: number[];
  holdout: number[];
  /** RGB frames (8-bit, w×h×3), one per camera: classify non-garment pixels as background or mannequin by colour. Without them, our own mannequin render decides. */
  frames?: (Uint8Array | null)[];
  pixelClasses?: PixelClasses;
}

export interface TemplateFitOptions {
  clearanceCm: number;
  /** A point is carved when more than this many training views see no garment there (default 2 % of the views, at least 1). */
  tau?: number;
  /** A view says nothing about a point when the mannequin is this much in front of it (cm). */
  occlusionMarginCm: number;
  /** Columns round the body tube and round each sleeve. */
  bodyColumns: number;
  sleeveColumns: number;
  /** Target spacing between rows along the body profile and along the sleeve, cm. */
  rowSpacingCm: number;
  sleeveRowSpacingCm: number;
  /** Smoothness weight of the radial Laplacian. */
  lambda: number;
  maxIterations: number;
  toleranceCm: number;
  /** A ray whose body exit lies further than this beyond its own part's surface is blocked by another part (armhole). */
  blockedCm: number;
  /** Mask clean-up before carving. */
  cleanup: MaskCleanup;
  /** Silhouette-matching rounds after the hull (0 = hull only). */
  silhouetteRounds: number;
  /** Garment category: a bottom has no shoulder or sleeves. */
  category: 'dress' | 'top' | 'outerwear' | 'bottom';
  /** Fit sleeves when the masks show them (default true). */
  sleeves: boolean;
}

export const DEFAULT_FIT_OPTIONS: TemplateFitOptions = {
  clearanceCm: MIN_CLEARANCE_CM,
  occlusionMarginCm: 1,
  bodyColumns: 88,
  sleeveColumns: 24,
  rowSpacingCm: 1.4,
  sleeveRowSpacingCm: 1.4,
  lambda: 3,
  maxIterations: 600,
  toleranceCm: 0.001,
  blockedCm: 2,
  cleanup: DEFAULT_CLEANUP,
  silhouetteRounds: 6,
  category: 'dress',
  sleeves: true,
};

// ---------------------------------------------------------------------------
// Evidence: carving against the training views
// ---------------------------------------------------------------------------

interface Evidence {
  n: number;
  width: number;
  height: number;
  /** Per view 12 numbers: R (9), t (3); then fx, fy, cx, cy in `intr`. */
  rt: Float64Array;
  intr: Float64Array;
  /** Per view and pixel: 0 no information (garment, or unclassified), 1 background, 2 mannequin visible (carves points in front of it). */
  code: Uint8Array[];
  /** Cleaned garment masks. */
  garment: Uint8Array[];
  /** Camera centres, 3 per view, cm. */
  centres: Float64Array;
  bodyDepth: Float32Array[];
  tau: number;
  margin: number;
}

/** What a non-garment pixel shows, from its colour (low saturation: studio background light, mannequin mid-grey). */
export interface PixelClasses {
  /** Background when the brightest channel is at least this and the saturation at most `maxSat`. */
  backgroundMin: number;
  /** Mannequin when the brightest channel is at most this and the saturation at most `maxSat`. */
  mannequinMax: number;
  maxSat: number;
}

/** Run 14's frames: background about 237, mannequin about 110 (95th percentile 128), both with saturation ≤ 8. */
export const DEFAULT_PIXEL_CLASSES: PixelClasses = { backgroundMin: 205, mannequinMax: 150, maxSat: 14 };

/** Mannequin pixels within this ring (px) round our own arm render say nothing: the generated arms are not exactly where ours are. */
export const ARM_ZONE_PX = 10;

/** Indices of the triangles of the body mesh that belong to its arms (the two components furthest from the axis). */
export function armTriangles(body: Mesh): Uint8Array {
  const nv = body.positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const idx = body.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]!);
    parent[find(idx[t + 1]!)] = a;
    parent[find(idx[t + 2]!)] = a;
  }
  const sumX = new Map<number, { s: number; n: number }>();
  for (let i = 0; i < nv; i++) {
    const r = find(i);
    const e = sumX.get(r) ?? { s: 0, n: 0 };
    e.s += Math.abs(body.positions[3 * i]!);
    e.n++;
    sumX.set(r, e);
  }
  const roots = [...sumX.entries()].sort((a, b) => b[1].s / b[1].n - a[1].s / a[1].n);
  const arms = new Set(roots.length >= 3 ? roots.slice(0, 2).map(([r]) => r) : []);
  const out = new Uint8Array(idx.length / 3);
  for (let t = 0; t < out.length; t++) out[t] = arms.has(find(idx[3 * t]!)) ? 1 : 0;
  return out;
}

function buildEvidence(views: FitViews, body: Mesh, opt: TemplateFitOptions): Evidence {
  const ids = views.train;
  const n = ids.length;
  const rt = new Float64Array(n * 12);
  const intr = new Float64Array(n * 4);
  const centres = new Float64Array(n * 3);
  const code: Uint8Array[] = [];
  const garment: Uint8Array[] = [];
  const bodyDepth: Float32Array[] = [];
  const arm = armTriangles(body);
  const cls = views.pixelClasses ?? DEFAULT_PIXEL_CLASSES;
  let width = 0, height = 0;
  ids.forEach((v, k) => {
    const cam = views.cameras[v]!;
    const mask = views.masks[v]!;
    if (mask.width !== cam.width || mask.height !== cam.height) throw new Error(`view ${v}: mask ${mask.width}×${mask.height}, camera ${cam.width}×${cam.height}`);
    width = cam.width;
    height = cam.height;
    rt.set(cam.R, 12 * k);
    rt.set(cam.t, 12 * k + 9);
    intr.set([cam.fx, cam.fy, cam.cx, cam.cy], 4 * k);
    centres.set(cam.centre, 3 * k);
    const clean = cleanMask(mask, opt.cleanup).data;
    const r = rasterize(cam, [{ positions: body.positions, indices: body.indices, id: 1 }]);
    // The ring round our own arms (not the arms themselves): a grey pixel there may be the generated
    // arm where ours is not, with our torso behind it, and would carve cloth that the arm hides.
    const ownArm = Uint8Array.from(r.tri, (t, i) => (r.ids[i] === 1 && t >= 0 && arm[t] ? 1 : 0));
    const grown = morph({ width, height, data: ownArm }, ARM_ZONE_PX, true).data;
    const armMask = Uint8Array.from(grown, (g, i) => (g && !ownArm[i] ? 1 : 0));
    const rgb = views.frames?.[v];
    const c = new Uint8Array(width * height);
    for (let i = 0; i < c.length; i++) {
      if (clean[i]) continue;
      if (rgb) {
        const R = rgb[3 * i]!, G = rgb[3 * i + 1]!, B = rgb[3 * i + 2]!;
        const mx = Math.max(R, G, B), sat = mx - Math.min(R, G, B);
        if (sat <= cls.maxSat && mx >= cls.backgroundMin) c[i] = 1;
        else if (sat <= cls.maxSat && mx <= cls.mannequinMax) c[i] = Number.isFinite(r.depth[i]!) && !armMask[i] ? 2 : 0;
      } else c[i] = Number.isFinite(r.depth[i]!) ? (armMask[i] ? 0 : 2) : 1;
    }
    code.push(c);
    garment.push(clean);
    bodyDepth.push(r.depth);
  });
  const tau = opt.tau ?? Math.max(1, Math.round(0.05 * n));
  return { n, width, height, rt, intr, code, garment, centres, bodyDepth, tau, margin: opt.occlusionMarginCm };
}

/** Number of training views that carve the point, counting up to `limit + 1` at most. */
function carveCount(e: Evidence, x: number, y: number, z: number, limit: number): number {
  let carved = 0;
  const { rt, intr, width: W, height: H } = e;
  for (let k = 0; k < e.n; k++) {
    const o = 12 * k;
    const zc = rt[o + 6]! * x + rt[o + 7]! * y + rt[o + 8]! * z + rt[o + 11]!;
    if (zc <= 0) continue;
    const xc = rt[o]! * x + rt[o + 1]! * y + rt[o + 2]! * z + rt[o + 9]!;
    const yc = rt[o + 3]! * x + rt[o + 4]! * y + rt[o + 5]! * z + rt[o + 10]!;
    const u = (intr[4 * k]! * xc) / zc + intr[4 * k + 2]!;
    const v = (intr[4 * k + 1]! * yc) / zc + intr[4 * k + 3]!;
    if (u < 0 || v < 0 || u >= W || v >= H) continue;
    const i = (v | 0) * W + (u | 0);
    const c = e.code[k]![i]!;
    if (c === 0) continue;
    if (c === 2 && e.bodyDepth[k]![i]! < zc - e.margin) continue; // the mannequin hides the point here
    carved++;
    if (carved > limit) return carved;
  }
  return carved;
}

/**
 * Views that say anything about a surface point with outward direction `d` (garment there, or
 * carving it), weighted by how squarely they face it (cos² of `d` and the direction to the camera;
 * views behind the surface weigh 0), and the weighted share that carves it. A face-on view sees
 * whether cloth is there; a view from the side sees the garment's other parts behind the point (a
 * V-neck opening is "garment" from the side), so it says little.
 */
function carveStats(e: Evidence, x: number, y: number, z: number, d: readonly number[]): { carved: number; informative: number; views: number } {
  let carved = 0, informative = 0, views = 0;
  const { rt, intr, width: W, height: H } = e;
  for (let k = 0; k < e.n; k++) {
    const cen = 3 * k;
    const cx = e.centres[cen]! - x, cy = e.centres[cen + 1]! - y, cz = e.centres[cen + 2]! - z;
    const cos = (cx * d[0]! + cy * d[1]! + cz * d[2]!) / Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cos <= 0.05) continue;
    const wv = cos * cos;
    const o = 12 * k;
    const zc = rt[o + 6]! * x + rt[o + 7]! * y + rt[o + 8]! * z + rt[o + 11]!;
    if (zc <= 0) continue;
    const xc = rt[o]! * x + rt[o + 1]! * y + rt[o + 2]! * z + rt[o + 9]!;
    const yc = rt[o + 3]! * x + rt[o + 4]! * y + rt[o + 5]! * z + rt[o + 10]!;
    const u = (intr[4 * k]! * xc) / zc + intr[4 * k + 2]!;
    const v = (intr[4 * k + 1]! * yc) / zc + intr[4 * k + 3]!;
    if (u < 0 || v < 0 || u >= W || v >= H) continue;
    const i = (v | 0) * W + (u | 0);
    if (e.garment[k]![i]) {
      informative += wv;
      views++;
      continue;
    }
    const c = e.code[k]![i]!;
    if (c === 0) continue;
    if (c === 2 && e.bodyDepth[k]![i]! < zc - e.margin) continue;
    carved += wv;
    informative += wv;
    views++;
  }
  return { carved, informative, views };
}

/** Facing-weighted vote at a point: present unless at least half of the weight carves it (needs `MIN_INFORMATIVE` views, else `fallback`). */
function votePresent(e: Evidence, p: readonly number[], d: readonly number[], fallback: boolean): boolean {
  const st = carveStats(e, p[0]!, p[1]!, p[2]!, d);
  return st.views >= MIN_INFORMATIVE ? st.carved * 2 < st.informative : fallback;
}

const MIN_INFORMATIVE = 4;
/** Predicted triangles of the grid before trimming: aim, and the band outside which spacing and columns are rescaled. */
const TRIANGLE_TARGET = { aim: 12600, low: 9500, high: 14400 };
/** Share of the median outline offset applied per silhouette round (damps the alternation between rounds). */
const SIL_GAIN = 0.7;
/** Rows within this distance of the hem or a cuff follow the surface above them (cm), with a slope of at most `EDGE_SLOPE` cm per cm. */
const EDGE_FREE_CM = 5;
const EDGE_SLOPE = 0.8;
/** Largest distance of a sleeve column's end from the median cuff, cm. */
const CUFF_SPREAD_CM = 3;

// ---------------------------------------------------------------------------
// Rays
// ---------------------------------------------------------------------------

interface Ray {
  o: Vec3;
  d: Vec3;
  /** Distance to the own part's analytic surface along the ray (null: none). */
  own: number | null;
  /** The garment goes round every body part this ray crosses (a skirt round both legs): admissible from the last exit, not the first. */
  lastExit?: boolean;
}

interface RayRange {
  lo: number;
  hi: number;
  blocked: boolean;
}

function rayRange(sdf: BodySdf, ray: Ray, clearance: number, maxExtent: number, blockedCm: number): RayRange {
  const step = 0.25;
  const at = (s: number): number => sdf.at(ray.o[0] + s * ray.d[0], ray.o[1] + s * ray.d[1], ray.o[2] + s * ray.d[2]);
  const refine = (a: number, b: number): number => {
    // at(a) < clearance ≤ at(b)
    for (let k = 0; k < 6; k++) {
      const m = (a + b) / 2;
      if (at(m) < clearance) a = m;
      else b = m;
    }
    return b;
  };
  const limit = (ray.own ?? 0) + 40;
  let lo: number;
  if (ray.lastExit) {
    let last = 0;
    let inside = at(0) < clearance;
    for (let s = step; s <= limit; s += step) {
      const nowInside = at(s) < clearance;
      if (inside && !nowInside) last = refine(s - step, s);
      inside = nowInside;
    }
    lo = last;
  } else {
    let s = 0;
    while (s < limit && at(s) < clearance) s += step;
    if (s >= limit) return { lo: s, hi: s, blocked: true };
    lo = s > 0 ? refine(Math.max(0, s - step), s) : 0;
  }
  const blocked = ray.own !== null && lo > ray.own + blockedCm;
  let t = lo;
  while (t < lo + maxExtent && at(t + step) >= clearance) t += step;
  return { lo, hi: Math.max(lo, t), blocked };
}

/** Hull along a ray: −1 = empty (carved at its first admissible point), else the outermost uncarved distance before the first carved one. */
function hullAlong(e: Evidence, ray: Ray, r: RayRange): { s: number; capped: boolean } {
  if (r.blocked) return { s: -1, capped: false };
  const p = (s: number): [number, number, number] => [ray.o[0] + s * ray.d[0], ray.o[1] + s * ray.d[1], ray.o[2] + s * ray.d[2]];
  const carved = (s: number): boolean => {
    const [x, y, z] = p(s);
    return carveCount(e, x, y, z, e.tau) > e.tau;
  };
  if (carved(r.lo)) return { s: -1, capped: false };
  const step = 0.5;
  let prev = r.lo;
  for (let s = r.lo + step; s <= r.hi + 1e-9; s += step) {
    if (carved(s)) {
      let a = prev, b = s;
      for (let k = 0; k < 4; k++) {
        const m = (a + b) / 2;
        if (carved(m)) b = m;
        else a = m;
      }
      return { s: (a + b) / 2, capped: false };
    }
    prev = s;
  }
  return { s: r.hi, capped: true };
}

/** Distance along a horizontal ray from the ellipse centre to an axis-aligned ellipse (a along x, b along z). */
function ellipseRadius(a: number, b: number, dx: number, dz: number): number {
  return 1 / Math.sqrt((dx * dx) / (a * a) + (dz * dz) / (b * b));
}

function bodyRay(m: Mannequin, y: number, theta: number): Ray {
  const t = m.torsoAt(y);
  const d: Vec3 = [Math.sin(theta), 0, Math.cos(theta)];
  const cx = t?.cx ?? 0, cz = t?.cz ?? 0;
  // Only the arms can block a body ray (the v0 mannequin's arms overlap its torso); below the hip the
  // legs overlap the torso and the skirt simply goes round them.
  const own = t && y > m.morphHeights.waist ? ellipseRadius(t.a, t.b, d[0], d[2]) : null;
  return { o: [cx, y, cz], d, own, lastExit: y < m.morphHeights.hip };
}

function sleeveRay(m: Mannequin, side: Side, s: number, phi: number): Ray {
  const f = side === 1 ? m.arms.left : m.arms.right;
  const o: Vec3 = [f.joint[0] + f.axis[0] * s, f.joint[1] + f.axis[1] * s, f.joint[2] + f.axis[2] * s];
  const cu = Math.cos(phi), sv = Math.sin(phi);
  const d: Vec3 = [cu * f.u[0] + sv * f.v[0], cu * f.u[1] + sv * f.v[1], cu * f.u[2] + sv * f.v[2]];
  const a = m.armAt(s, side);
  return { o, d, own: a ? ellipseRadius(a.a, a.b, cu, sv) : null };
}

// ---------------------------------------------------------------------------
// Extents: hem per body column, cuff per sleeve column
// ---------------------------------------------------------------------------

const circularSmooth = (v: number[], medianHalf: number, meanHalf: number): number[] => {
  const n = v.length;
  const med = v.map((_, i) => {
    const w: number[] = [];
    for (let k = -medianHalf; k <= medianHalf; k++) w.push(v[(i + k + n) % n]!);
    w.sort((a, b) => a - b);
    return w[medianHalf]!;
  });
  return med.map((_, i) => {
    let s = 0;
    for (let k = -meanHalf; k <= meanHalf; k++) s += med[(i + k + n) % n]!;
    return s / (2 * meanHalf + 1);
  });
};

/** Fills NaN entries of a circular array by linear interpolation between the nearest known neighbours. */
const fillCircular = (v: number[]): number[] => {
  const n = v.length;
  const known = v.map((x, i) => (Number.isFinite(x) ? i : -1)).filter((i) => i >= 0);
  if (known.length === 0) return v;
  return v.map((x, i) => {
    if (Number.isFinite(x)) return x;
    let a = i, b = i, da = 0, db = 0;
    while (!Number.isFinite(v[(a + n) % n]!)) { a--; da++; }
    while (!Number.isFinite(v[b % n]!)) { b++; db++; }
    return (v[(a + n) % n]! * db + v[b % n]! * da) / (da + db);
  });
};

interface ProfileScan {
  /** Along the scan (heights going down, or distances along the arm going out): present or not. */
  start: number;
  step: number;
  present: boolean[];
}

/** End of the contiguous garment run: first present sample from the start, then until a gap longer than `gapCm`. NaN when nothing is present within `searchCm`. */
function runEnd(scan: ProfileScan, gapCm: number, searchCm: number): number {
  const { present, step, start } = scan;
  const dir = Math.sign(step);
  let first = -1;
  for (let i = 0; i < present.length && Math.abs(i * step) <= searchCm; i++) if (present[i]) { first = i; break; }
  if (first < 0) return NaN;
  let last = first;
  let gap = 0;
  for (let i = first + 1; i < present.length; i++) {
    if (present[i]) {
      last = i;
      gap = 0;
    } else {
      gap += Math.abs(step);
      if (gap > gapCm) break;
    }
  }
  return start + dir * Math.abs(step) * last;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

interface PartGrid {
  name: 'body' | 'sleeve_l' | 'sleeve_r';
  rows: number;
  cols: number;
  /** First vertex index of this part. */
  offset: number;
  /** v coordinate (0 top / shoulder end … 1 hem / cuff) per vertex of the part. */
  v: Float64Array;
}

export interface FitIteration {
  /** `hull` (first solve) or `silhouette <round>`. */
  stage: string;
  /** Jacobi sweeps until the largest change fell below the tolerance. */
  iteration: number;
  maxChangeCm: number;
}

export interface SilhouetteRound {
  round: number;
  /** Mean IoU of the garment-only render with the (cleaned) masks over the training views, before this round's update. */
  trainSilhouetteIouBefore: number;
  /** Vertices on the outline in at least `SIL_MIN_VIEWS` training views (they got a new target). */
  outlineVertices: number;
  meanMoveCm: number;
}

/** Silhouette rounds: how far (px) to look for the mask's outline, how many views a vertex needs, the largest move per round (cm). */
const SIL_SEARCH_PX = 40;
const SIL_MIN_VIEWS = 2;
const SIL_MAX_STEP_CM = 3;

export interface TemplateFitReport {
  version: typeof TEMPLATE_FIT_VERSION;
  options: Omit<TemplateFitOptions, 'cleanup'> & { tau: number; cleanup: MaskCleanup };
  trainViews: number;
  holdoutViews: number;
  /** Template vertices per part before trimming, and kept. */
  parts: { name: string; rows: number; cols: number; vertices: number; kept: number; hemOrCuff: { min: number; max: number; mean: number } | null }[];
  sleeves: { left: boolean; right: boolean; reason: string };
  /** Rays: blocked by another body part (armhole), empty (carved at the body), capped at the next body part, with no hull (filled by smoothness). */
  rays: { total: number; blocked: number; empty: number; capped: number; filled: number };
  /** Hull minus template (proxy) radius over rays with both, cm: how far carving/expansion moved it. */
  moveFromTemplateCm: { mean: number; p5: number; p95: number } | null;
  /** Jacobi sweeps over all solves. */
  iterations: number;
  /** Every solve reached the tolerance. */
  converged: boolean;
  /** Per solve: sweeps and the last largest change. */
  convergence: FitIteration[];
  silhouetteRounds: SilhouetteRound[];
  /** Mean |s − hull| over rays with a hull after the solve, cm (data residual). */
  dataResidualCm: number;
  /** Vertices with signed distance below the clearance after the solve (should be 0) and below 0 (inside). */
  belowClearance: number;
  insideBody: number;
  timingsMs: Record<string, number>;
}

export interface RenderMesh {
  /** cm, mannequin space; vertices of the welded mesh plus duplicates on each tube's UV seam. */
  positions: Float64Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Render vertex → welded vertex. */
  remap: Uint32Array;
  /** Atlas chart rectangles [u0, v0, u1, v1] per part, in UV space (v down, glTF convention). */
  charts: Record<string, [number, number, number, number]>;
}

export interface TemplateFitResult {
  /** Welded garment mesh (cm, mannequin space), outward triangles; `vertexPart` 0 body, 1 sleeve_l, 2 sleeve_r. */
  mesh: Mesh;
  render: RenderMesh;
  report: TemplateFitReport;
  /** Ray of every welded vertex (origin, direction), for diagnostics. */
}

/** Atlas layout: body chart on top, the two sleeves side by side below (with gutters), UV v pointing down. */
export const ATLAS_CHARTS: Record<'body' | 'sleeve_l' | 'sleeve_r', [number, number, number, number]> = {
  body: [0.004, 0.004, 0.996, 0.676],
  sleeve_l: [0.004, 0.684, 0.496, 0.996],
  sleeve_r: [0.504, 0.684, 0.996, 0.996],
};

export interface FitInputs {
  mannequin: Mannequin;
  /** mannequin.glb as a mesh, cm. */
  body: Mesh;
  /** Precomputed signed distance to `body` (built when absent). */
  sdf?: BodySdf;
  /** The control proxy (closed volume) the template starts from; null = mannequin + 1.5 cm. */
  proxy: Mesh | null;
  proxySdf?: BodySdf;
  views: FitViews;
  options?: Partial<TemplateFitOptions>;
}

const percentile = (xs: number[], q: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
};

export function fitTemplate(inp: FitInputs): TemplateFitResult {
  const opt: TemplateFitOptions = { ...DEFAULT_FIT_OPTIONS, ...inp.options };
  const m = inp.mannequin;
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string): void => {
    const t = performance.now();
    timings[k] = Math.round(t - t0);
    t0 = t;
  };
  const sdf = inp.sdf ?? buildBodySdf(inp.body);
  const proxySdf = inp.proxy ? inp.proxySdf ?? buildBodySdf(inp.proxy, { bandCm: 3 }) : null;
  lap('sdf');
  const ev = buildEvidence(inp.views, inp.body, opt);
  lap('evidence');
  const h = m.morphHeights;
  const isBottom = opt.category === 'bottom';
  const C = opt.bodyColumns;
  const theta = (c: number): number => (2 * Math.PI * c) / C;

  // --- 1. Body extents: hem per column (scan from the chest, or the waist for a bottom, downwards).
  const yScanTop = isBottom ? h.waist : h.chest;
  const yFloor = 2;
  const scanStep = -0.5;
  const hemRaw: number[] = [];
  // Each sample is voted on at the radius of the garment just above it (the skirt continued downwards),
  // so the hem is where most views stop seeing cloth: the median hem of frames that disagree.
  const along = (ray: Ray, t: number): number[] => [ray.o[0] + t * ray.d[0], ray.o[1] + t * ray.d[1], ray.o[2] + t * ray.d[2]];
  for (let c = 0; c < C; c++) {
    const present: boolean[] = [];
    let rPrev = NaN;
    for (let y = yScanTop; y >= yFloor; y += scanStep) {
      const ray = bodyRay(m, y, theta(c));
      const range = rayRange(sdf, ray, opt.clearanceCm, 35, opt.blockedCm);
      if (range.blocked) {
        present.push(true);
        continue;
      }
      const hs = hullAlong(ev, ray, range).s;
      const test = Number.isFinite(rPrev) ? Math.min(range.hi, Math.max(range.lo, rPrev)) : range.lo;
      present.push(votePresent(ev, along(ray, test), ray.d, hs >= 0));
      if (hs >= 0) rPrev = hs;
    }
    hemRaw.push(runEnd({ start: yScanTop, step: scanStep, present }, 2, 25));
  }
  const hem = circularSmooth(fillCircular(hemRaw), 4, 2);
  if (!hem.every(Number.isFinite)) throw new Error('stage 4t: no garment found below the chest in any column (masks or cameras wrong?)');
  lap('hem');

  // --- 2. Sleeve extents: cuff per column.
  const sleeveSides: Side[] = [];
  const cuffs = new Map<Side, number[]>();
  const sleeveNotes: string[] = [];
  const armLen = m.arms.left.upperArmCm + m.arms.left.forearmCm;
  if (opt.sleeves && !isBottom) {
    for (const side of [1, -1] as Side[]) {
      const Cs = opt.sleeveColumns;
      const raw: number[] = [];
      for (let c = 0; c < Cs; c++) {
        const phi = (2 * Math.PI * c) / Cs;
        const present: boolean[] = [];
        let rPrev = NaN;
        for (let s = 3; s <= armLen; s += 0.5) {
          const ray = sleeveRay(m, side, s, phi);
          const range = rayRange(sdf, ray, opt.clearanceCm, 18, opt.blockedCm);
          if (range.blocked) {
            present.push(false);
            continue;
          }
          const hs = hullAlong(ev, ray, range).s;
          const test = Number.isFinite(rPrev) ? Math.min(range.hi, Math.max(range.lo, rPrev)) : range.lo;
          present.push(votePresent(ev, along(ray, test), ray.d, hs >= 0));
          if (hs >= 0) rPrev = hs;
        }
        raw.push(runEnd({ start: 3, step: 0.5, present }, 2, 6));
      }
      const known = raw.filter(Number.isFinite);
      const name = side === 1 ? 'left' : 'right';
      // A sleeve: garment round most of the arm and reaching past the shoulder cap.
      if (known.length >= 0.4 * Cs && percentile(known, 0.5) > 8) {
        sleeveSides.push(side);
        // A cuff is close to square to the arm. Columns facing the front or back of the forearm see the
        // skirt behind it as "garment" in the side views and run long; hold every column within
        // CUFF_SPREAD_CM of the median.
        const med = percentile(known, 0.5);
        cuffs.set(side, circularSmooth(fillCircular(raw).map((x) => Math.min(med + CUFF_SPREAD_CM, Math.max(med - CUFF_SPREAD_CM, x))), 2, 1));
      } else sleeveNotes.push(`${name}: no sleeve (${known.length}/${Cs} columns with garment, median end ${known.length ? percentile(known, 0.5).toFixed(1) : '—'} cm)`);
    }
  }
  lap('cuffs');

  // --- 3. Grid. Body rows: equal arc length along the torso profile from the neck down to ySplit, then
  // per column to the hem; sleeve rows evenly from the shoulder joint to the cuff. Row spacing and
  // column counts are scaled together until the grid lands inside the triangle budget.
  const yTop = isBottom ? h.waist + 3 : h.neck;
  const ySplit = Math.min(Math.max(...hem) + 2, yTop - 5);
  const prof = (y: number): number => {
    const t = m.torsoAt(y) ?? m.torsoAt(h.hip)!;
    return (t.a + t.b) / 2;
  };
  const resample = (v: number[], n: number): number[] => Array.from({ length: n }, (_, i) => {
    const x = (i * v.length) / n;
    const k = Math.floor(x), f = x - k;
    return v[k % v.length]! * (1 - f) + v[(k + 1) % v.length]! * f;
  });
  const layout = (rowSpacing: number, sleeveRowSpacing: number, cols: number, sleeveCols: number) => {
    const rowsY: number[] = [yTop];
    let acc = 0;
    let prevR = prof(yTop);
    for (let y = yTop - 0.05; y > ySplit; y -= 0.05) {
      const r = prof(y);
      acc += Math.hypot(0.05, r - prevR);
      prevR = r;
      if (acc >= rowSpacing) {
        rowsY.push(y);
        acc = 0;
      }
    }
    if (rowsY[rowsY.length - 1]! - ySplit < rowSpacing / 2) rowsY.pop();
    rowsY.push(ySplit);
    const lowRows = Math.max(1, Math.ceil((ySplit - Math.min(...hem)) / rowSpacing));
    const sleeveRows = sleeveSides.map((side) => Math.max(3, Math.ceil(Math.max(...cuffs.get(side)!) / sleeveRowSpacing) + 1));
    const predicted = 2 * ((rowsY.length + lowRows - 1) * cols + sleeveRows.reduce((n, r) => n + (r - 1) * sleeveCols, 0));
    return { rowsY, lowRows, sleeveRows, cols, sleeveCols, rowSpacing, sleeveRowSpacing, predicted };
  };
  let lay = layout(opt.rowSpacingCm, opt.sleeveRowSpacingCm, C, opt.sleeveColumns);
  for (let k = 0; k < 4 && (lay.predicted > TRIANGLE_TARGET.high || lay.predicted < TRIANGLE_TARGET.low); k++) {
    const f = Math.sqrt(lay.predicted / TRIANGLE_TARGET.aim);
    lay = layout(lay.rowSpacing * f, lay.sleeveRowSpacing * f, Math.max(32, Math.round(lay.cols / f / 8) * 8), Math.max(12, Math.round(lay.sleeveCols / f / 4) * 4));
  }
  const { rowsY, lowRows } = lay;
  const BC = lay.cols;
  const hemG = BC === C ? hem : resample(hem, BC);
  const thetaG = (c: number): number => (2 * Math.PI * c) / BC;
  const R = rowsY.length + lowRows;
  const yAt = (r: number, c: number): number => (r < rowsY.length ? rowsY[r]! : ySplit - ((r - rowsY.length + 1) / lowRows) * (ySplit - hemG[c]!));

  const parts: PartGrid[] = [];
  const rays: Ray[] = [];
  const vCoord: number[] = [];
  const bodyLen = yTop - Math.min(...hem);
  parts.push({ name: 'body', rows: R, cols: BC, offset: 0, v: new Float64Array(0) });
  for (let r = 0; r < R; r++) for (let c = 0; c < BC; c++) {
    const y = yAt(r, c);
    rays.push(bodyRay(m, y, thetaG(c)));
    vCoord.push((yTop - y) / bodyLen);
  }
  sleeveSides.forEach((side, si) => {
    const Cs = lay.sleeveCols;
    const cuff = Cs === opt.sleeveColumns ? cuffs.get(side)! : resample(cuffs.get(side)!, Cs);
    const maxCuff = Math.max(...cuff);
    const Rs = lay.sleeveRows[si]!;
    const offset = rays.length;
    parts.push({ name: side === 1 ? 'sleeve_l' : 'sleeve_r', rows: Rs, cols: Cs, offset, v: new Float64Array(0) });
    for (let r = 0; r < Rs; r++) for (let c = 0; c < Cs; c++) {
      const sAlong = (r / (Rs - 1)) * cuff[c]!;
      rays.push(sleeveRay(m, side, sAlong, (2 * Math.PI * c) / Cs));
      vCoord.push(sAlong / maxCuff);
    }
  });
  const N = rays.length;
  lap('grid');

  // --- 4. Per vertex: admissible range, template radius (proxy), hull.
  const lo = new Float64Array(N), hi = new Float64Array(N), hull = new Float64Array(N), s0 = new Float64Array(N);
  const blocked = new Uint8Array(N), empty = new Uint8Array(N), capped = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const ray = rays[i]!;
    const isSleeve = i >= parts[0]!.rows * parts[0]!.cols;
    const range = rayRange(sdf, ray, opt.clearanceCm, isSleeve ? 18 : 35, opt.blockedCm);
    lo[i] = range.lo;
    hi[i] = range.hi;
    blocked[i] = range.blocked ? 1 : 0;
    // Template: where the ray leaves the proxy volume (the proxy is closed), else 1.5 cm off the body.
    let tpl = range.lo + 1.5;
    if (proxySdf && proxySdf.at(...(ray.o as [number, number, number])) < 0) {
      let s = 0;
      while (s < 60 && proxySdf.at(ray.o[0] + s * ray.d[0], ray.o[1] + s * ray.d[1], ray.o[2] + s * ray.d[2]) < 0) s += 0.25;
      if (s < 60) tpl = s;
    }
    s0[i] = Math.min(range.hi, Math.max(range.lo, tpl));
    const hh = hullAlong(ev, ray, range);
    hull[i] = hh.s;
    capped[i] = hh.capped ? 1 : 0;
    // Presence by the median vote at the hull (or the template where the hull is empty).
    const testS = hh.s >= 0 ? hh.s : s0[i]!;
    empty[i] = !range.blocked && !votePresent(ev, [ray.o[0] + testS * ray.d[0], ray.o[1] + testS * ray.d[1], ray.o[2] + testS * ray.d[2]], ray.d, hh.s >= 0) ? 1 : 0;
  }
  lap('carve');

  // --- 5. Presence on the grid and clean-up.
  const present = new Uint8Array(N);
  for (let i = 0; i < N; i++) present[i] = blocked[i] || empty[i] ? 0 : 1;
  // The rows below the split were built inside the found hem/cuff: keep them unless blocked (no staircase at the edge).
  const body = parts[0]!;
  for (let r = rowsY.length; r < body.rows; r++) for (let c = 0; c < body.cols; c++) {
    const i = r * body.cols + c;
    if (!blocked[i]) present[i] = 1;
  }
  for (const p of parts.slice(1)) for (let r = Math.floor(p.rows / 3); r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
    const i = p.offset + r * p.cols + c;
    if (!blocked[i]) present[i] = 1;
  }
  const neighbours = (p: PartGrid, i: number): number[] => {
    const k = i - p.offset;
    const r = Math.floor(k / p.cols), c = k % p.cols;
    const out = [p.offset + r * p.cols + ((c + 1) % p.cols), p.offset + r * p.cols + ((c - 1 + p.cols) % p.cols)];
    if (r > 0) out.push(i - p.cols);
    if (r < p.rows - 1) out.push(i + p.cols);
    return out;
  };
  const partOf = (i: number): PartGrid => {
    for (let k = parts.length - 1; k >= 0; k--) if (i >= parts[k]!.offset) return parts[k]!;
    return parts[0]!;
  };
  const filled = new Uint8Array(N);
  for (const p of parts) {
    const n = p.rows * p.cols;
    // Small interior holes (not blocked, not touching the first or last row) are mask noise: fill them.
    const seen = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const i = p.offset + k;
      if (present[i] || seen[k]) continue;
      const region: number[] = [];
      let edge = false;
      let anyBlocked = false;
      const stack = [i];
      seen[k] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        region.push(j);
        const rj = Math.floor((j - p.offset) / p.cols);
        if (rj === 0 || rj === p.rows - 1) edge = true;
        if (blocked[j]) anyBlocked = true;
        for (const q of neighbours(p, j)) {
          if (present[q] || seen[q - p.offset]) continue;
          seen[q - p.offset] = 1;
          stack.push(q);
        }
      }
      if (!edge && !anyBlocked && region.length <= 24) for (const j of region) { present[j] = 1; filled[j] = 1; }
    }
    // Spikes: present vertices with fewer than two present neighbours, repeatedly.
    for (let pass = 0; pass < 4; pass++) {
      for (let k = 0; k < n; k++) {
        const i = p.offset + k;
        if (present[i] && neighbours(p, i).filter((q) => present[q]).length < 2) present[i] = 0;
      }
    }
    // Islands: keep only the largest present component of the part.
    const comp = new Int32Array(n).fill(-1);
    const sizes: number[] = [];
    for (let k = 0; k < n; k++) {
      if (!present[p.offset + k] || comp[k]! >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [p.offset + k];
      comp[k] = id;
      while (stack.length) {
        const j = stack.pop()!;
        size++;
        for (const q of neighbours(p, j)) {
          if (!present[q] || comp[q - p.offset]! >= 0) continue;
          comp[q - p.offset] = id;
          stack.push(q);
        }
      }
      sizes.push(size);
    }
    const best = sizes.indexOf(Math.max(...sizes, 0));
    for (let k = 0; k < n; k++) if (present[p.offset + k] && comp[k] !== best) present[p.offset + k] = 0;
  }
  lap('presence');

  // --- 6. Regularised solve, then silhouette rounds.
  // Grid triangles (grid vertex ids) of quads with ≥ 3 kept corners, in the winding order a, d, cc, b.
  const gridTris: number[] = [];
  const gridTriPart: number[] = [];
  parts.forEach((p, pi) => {
    for (let r = 0; r < p.rows - 1; r++) for (let c = 0; c < p.cols; c++) {
      const a = p.offset + r * p.cols + c;
      const b = p.offset + r * p.cols + ((c + 1) % p.cols);
      const cc = p.offset + (r + 1) * p.cols + ((c + 1) % p.cols);
      const d = p.offset + (r + 1) * p.cols + c;
      const kept = [a, d, cc, b].filter((q) => present[q]);
      if (kept.length === 4) {
        gridTris.push(a, d, cc, a, cc, b);
        gridTriPart.push(pi, pi);
      } else if (kept.length === 3) {
        gridTris.push(kept[0]!, kept[1]!, kept[2]!);
        gridTriPart.push(pi);
      }
    }
  });
  const w = new Float64Array(N);
  const target = new Float64Array(N);
  const moves: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!present[i]) continue;
    if (hull[i]! >= 0) {
      target[i] = hull[i]!;
      w[i] = capped[i] ? 0.15 : 1;
      if (!capped[i]) moves.push(hull[i]! - s0[i]!);
    } else {
      // No hull (the vote keeps it, a filled hole, or the rows kept inside the hem): the template holds it weakly.
      target[i] = s0[i]!;
      w[i] = 0.05;
    }
  }
  const s = Float64Array.from(target);
  for (let i = 0; i < N; i++) s[i] = Math.min(hi[i]!, Math.max(lo[i]!, s[i]!));
  const next = new Float64Array(N);
  const convergence: FitIteration[] = [];
  let iterations = 0;
  let converged = true;
  const nb: number[][] = [];
  for (let i = 0; i < N; i++) nb.push(present[i] ? neighbours(partOf(i), i).filter((q) => present[q]) : []);
  const solve = (stage: string): void => {
    let done = false;
    for (let it = 1; it <= opt.maxIterations; it++) {
      let maxChange = 0;
      for (let i = 0; i < N; i++) {
        if (!present[i]) continue;
        const list = nb[i]!;
        let avg = 0;
        for (const q of list) avg += s[q]!;
        const lam = list.length ? opt.lambda : 0;
        avg = list.length ? avg / list.length : 0;
        let v = (w[i]! * target[i]! + lam * avg) / (w[i]! + lam || 1);
        v = Math.min(hi[i]!, Math.max(lo[i]!, v));
        next[i] = v;
        maxChange = Math.max(maxChange, Math.abs(v - s[i]!));
      }
      for (let i = 0; i < N; i++) if (present[i]) s[i] = next[i]!;
      iterations++;
      if (maxChange < opt.toleranceCm || it === opt.maxIterations) {
        convergence.push({ stage, iteration: it, maxChangeCm: Math.round(maxChange * 1e5) / 1e5 });
        done = maxChange < opt.toleranceCm;
        break;
      }
    }
    if (!done) converged = false;
  };
  // The last EDGE_FREE_CM before the hem and the cuffs: frames disagree most there (a swinging tier,
  // a gathered cuff), and the hull pulls the edge in (a balloon hem). Those rows follow the surface
  // above them instead: linear extrapolation down each column, after every solve.
  const free = new Uint8Array(N);
  const extrapolate = (): void => {
    for (const p of parts) {
      for (let c = 0; c < p.cols; c++) {
        const col: number[] = [];
        for (let r = 0; r < p.rows; r++) col.push(p.offset + r * p.cols + c);
        const along = col.map((i) => (p.name === 'body' ? -rays[i]!.o[1] : Math.hypot(rays[i]!.o[0] - rays[col[0]!]!.o[0], rays[i]!.o[1] - rays[col[0]!]!.o[1], rays[i]!.o[2] - rays[col[0]!]!.o[2])));
        const end = along[along.length - 1]!;
        let a = -1;
        for (let r = col.length - 1; r >= 0; r--) if (end - along[r]! > EDGE_FREE_CM && present[col[r]!]) { a = r; break; }
        if (a < 1 || !present[col[a - 1]!]) continue;
        const ia = col[a]!, ib = col[a - 1]!;
        const slope = Math.max(-EDGE_SLOPE, Math.min(EDGE_SLOPE, (s[ia]! - s[ib]!) / Math.max(1e-6, along[a]! - along[a - 1]!)));
        for (let r = a + 1; r < col.length; r++) {
          const i = col[r]!;
          if (!present[i]) continue;
          free[i] = 1;
          s[i] = Math.min(hi[i]!, Math.max(lo[i]!, s[ia]! + slope * (along[r]! - along[a]!)));
        }
      }
    }
  };
  solve('hull');
  extrapolate();

  // Silhouette rounds: where a vertex lies on the rendered garment's outline in a training view, the
  // mask's outline along the same image direction says how far to move it (in or out). The median over
  // the views where it is on the outline becomes its new target: frames that disagree (a generated
  // video is not exactly consistent) are averaged instead of intersected as the hull does.
  const rounds: SilhouetteRound[] = [];
  const posAll = new Float64Array(N * 3);
  const q = new Float64Array(3), q2 = new Float64Array(3);
  for (let round = 1; round <= opt.silhouetteRounds; round++) {
    for (let i = 0; i < N; i++) {
      const ray = rays[i]!;
      posAll[3 * i] = ray.o[0] + s[i]! * ray.d[0];
      posAll[3 * i + 1] = ray.o[1] + s[i]! * ray.d[1];
      posAll[3 * i + 2] = ray.o[2] + s[i]! * ray.d[2];
    }
    const deltas: number[][] = Array.from({ length: N }, () => []);
    let iouSum = 0;
    for (let k = 0; k < ev.n; k++) {
      const cam = inp.views.cameras[inp.views.train[k]!]!;
      const r = rasterize(cam, [{ positions: posAll, indices: gridTris, id: 1 }]);
      const W = ev.width, H = ev.height;
      const garment = ev.garment[k]!, code = ev.code[k]!;
      let inter = 0, uni = 0;
      for (let p = 0; p < W * H; p++) {
        const a1 = r.ids[p] === 1, b1 = garment[p] === 1;
        if (a1 && b1) inter++;
        if (a1 || b1) uni++;
      }
      iouSum += uni ? inter / uni : 0;
      const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? -1 : (y | 0) * W + (x | 0));
      for (let i = 0; i < N; i++) {
        if (!present[i]) continue;
        const ray = rays[i]!;
        project(cam, posAll[3 * i]!, posAll[3 * i + 1]!, posAll[3 * i + 2]!, q);
        project(cam, posAll[3 * i]! + ray.d[0], posAll[3 * i + 1]! + ray.d[1], posAll[3 * i + 2]! + ray.d[2], q2);
        const gx = q2[0]! - q[0]!, gy = q2[1]! - q[1]!;
        const g = Math.hypot(gx, gy); // px per cm along the ray
        if (g < 0.6 * (cam.fx / q[2]!)) continue; // the ray points too much towards the camera
        const ux = gx / g, uy = gy / g;
        const out = at(q[0]! + 2 * ux, q[1]! + 2 * uy), inn = at(q[0]! - 2 * ux, q[1]! - 2 * uy), here = at(q[0]!, q[1]!);
        if (out < 0 || inn < 0 || here < 0) continue;
        if (r.ids[out] !== 0 || r.ids[inn] !== 1) continue; // not on the outline along its ray
        let delta: number | null = null;
        if (garment[here]) {
          for (let t = 0.5; t <= SIL_SEARCH_PX; t += 0.5) {
            const j = at(q[0]! + t * ux, q[1]! + t * uy);
            if (j < 0) break;
            if (!garment[j]) {
              if (code[j] === 1) delta = t;
              break;
            }
          }
        } else if (code[here] === 1) {
          delta = -SIL_SEARCH_PX;
          for (let t = 0.5; t <= SIL_SEARCH_PX; t += 0.5) {
            const j = at(q[0]! - t * ux, q[1]! - t * uy);
            if (j < 0) break;
            if (garment[j]) {
              delta = -t;
              break;
            }
          }
        }
        if (delta !== null) deltas[i]!.push(delta / g);
      }
    }
    let moved = 0, contour = 0;
    for (let i = 0; i < N; i++) {
      const d = deltas[i]!;
      if (!present[i] || free[i] || d.length < SIL_MIN_VIEWS) continue;
      d.sort((x, y) => x - y);
      const med = d[d.length >> 1]!;
      const step = Math.max(-SIL_MAX_STEP_CM, Math.min(SIL_MAX_STEP_CM, SIL_GAIN * med));
      target[i] = Math.min(hi[i]!, Math.max(lo[i]!, s[i]! + step));
      w[i] = 1;
      moved += Math.abs(step);
      contour++;
    }
    rounds.push({ round, trainSilhouetteIouBefore: Math.round((iouSum / ev.n) * 10000) / 10000, outlineVertices: contour, meanMoveCm: contour ? Math.round((moved / contour) * 1000) / 1000 : 0 });
    solve(`silhouette ${round}`);
    extrapolate();
    if (contour && moved / contour < 0.03) break;
  }
  lap('solve');

  // --- 7. Mesh: kept vertices, triangles of quads with ≥ 3 kept corners, outward.
  const newIndex = new Int32Array(N).fill(-1);
  const pos: number[] = [];
  const vpart: number[] = [];
  let residual = 0, residualN = 0, below = 0, inside = 0;
  for (let i = 0; i < N; i++) {
    if (!present[i]) continue;
    const ray = rays[i]!;
    const x = ray.o[0] + s[i]! * ray.d[0], y = ray.o[1] + s[i]! * ray.d[1], z = ray.o[2] + s[i]! * ray.d[2];
    newIndex[i] = pos.length / 3;
    pos.push(x, y, z);
    vpart.push(parts.indexOf(partOf(i)));
    if (hull[i]! >= 0 && !capped[i]) {
      residual += Math.abs(s[i]! - hull[i]!);
      residualN++;
    }
    const d = sdf.at(x, y, z);
    if (d < opt.clearanceCm - 0.02) below++;
    if (d < 0) inside++;
  }
  const tris: number[] = [];
  const uvTris: { part: number; corners: [number, number, number] }[] = [];
  for (let t = 0; t < gridTris.length; t += 3) {
    const corners: [number, number, number] = [gridTris[t]!, gridTris[t + 1]!, gridTris[t + 2]!];
    tris.push(newIndex[corners[0]]!, newIndex[corners[1]]!, newIndex[corners[2]]!);
    uvTris.push({ part: gridTriPart[t / 3]!, corners });
  }
  // Orientation, per part (the grids run differently round the body and round an arm): the triangles face along the rays (outwards).
  const dotSum = new Float64Array(parts.length);
  for (let t = 0; t < tris.length; t += 3) {
    const [ia, ib, ic] = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
    const A = [pos[3 * ia]!, pos[3 * ia + 1]!, pos[3 * ia + 2]!], B = [pos[3 * ib]!, pos[3 * ib + 1]!, pos[3 * ib + 2]!], Cc = [pos[3 * ic]!, pos[3 * ic + 1]!, pos[3 * ic + 2]!];
    const u = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!], v = [Cc[0]! - A[0]!, Cc[1]! - A[1]!, Cc[2]! - A[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const tri = uvTris[t / 3]!;
    const d = rays[tri.corners[0]]!.d;
    dotSum[tri.part] = dotSum[tri.part]! + Math.sign(n[0]! * d[0] + n[1]! * d[1] + n[2]! * d[2]);
  }
  for (let t = 0; t < tris.length; t += 3) {
    const tri = uvTris[t / 3]!;
    if (dotSum[tri.part]! >= 0) continue;
    const tmp = tris[t + 1]!;
    tris[t + 1] = tris[t + 2]!;
    tris[t + 2] = tmp;
    tri.corners = [tri.corners[0], tri.corners[2], tri.corners[1]];
  }
  const positions = Float64Array.from(pos);
  const mesh: Mesh = { positions, indices: Uint32Array.from(tris), vertexPart: Uint8Array.from(vpart), partNames: parts.map((p) => p.name) };

  // --- 8. Render mesh with a UV seam per tube (column `cols` duplicates column 0 at u = 1).
  const rpos: number[] = [];
  const ruv: number[] = [];
  const rmap: number[] = [];
  const rIndex = new Map<string, number>();
  const charts: RenderMesh['charts'] = {};
  for (const p of parts) charts[p.name] = ATLAS_CHARTS[p.name];
  const renderVertex = (i: number, seam: boolean): number => {
    const key = `${i}:${seam ? 1 : 0}`;
    let r = rIndex.get(key);
    if (r !== undefined) return r;
    const p = partOf(i);
    const k = i - p.offset;
    const row = Math.floor(k / p.cols), col = k % p.cols;
    const [u0, v0, u1, v1] = ATLAS_CHARTS[p.name];
    const u = (seam ? p.cols : col) / p.cols;
    const vv = p.name === 'body' ? vCoord[i]! : row / (p.rows - 1);
    r = rpos.length / 3;
    rIndex.set(key, r);
    const wi = newIndex[i]!;
    rpos.push(positions[3 * wi]!, positions[3 * wi + 1]!, positions[3 * wi + 2]!);
    ruv.push(u0 + u * (u1 - u0), v0 + vv * (v1 - v0));
    rmap.push(wi);
    return r;
  };
  const rtris: number[] = [];
  for (const { corners } of uvTris) {
    const p = partOf(corners[0]);
    const cols = corners.map((i) => (i - p.offset) % p.cols);
    // A triangle that spans the seam (columns cols−1 and 0): its column-0 corners use the u = 1 copy.
    const spans = cols.some((c) => c === p.cols - 1) && cols.some((c) => c === 0);
    for (let k = 0; k < 3; k++) rtris.push(renderVertex(corners[k]!, spans && cols[k] === 0));
  }
  lap('mesh');

  const nonEmptyHem = hem.filter(Number.isFinite);
  const report: TemplateFitReport = {
    version: TEMPLATE_FIT_VERSION,
    options: { ...opt, tau: ev.tau, cleanup: opt.cleanup },
    trainViews: inp.views.train.length,
    holdoutViews: inp.views.holdout.length,
    parts: parts.map((p) => {
      let kept = 0;
      for (let k = 0; k < p.rows * p.cols; k++) kept += present[p.offset + k]!;
      const ext = p.name === 'body' ? nonEmptyHem : cuffs.get(p.name === 'sleeve_l' ? 1 : -1) ?? [];
      return { name: p.name, rows: p.rows, cols: p.cols, vertices: p.rows * p.cols, kept, hemOrCuff: ext.length ? { min: round2(Math.min(...ext)), max: round2(Math.max(...ext)), mean: round2(ext.reduce((a, b) => a + b, 0) / ext.length) } : null };
    }),
    sleeves: { left: sleeveSides.includes(1), right: sleeveSides.includes(-1), reason: sleeveNotes.join('; ') || (opt.sleeves && !isBottom ? 'sleeves found in the masks' : 'not fitted for this category') },
    rays: { total: N, blocked: sum(blocked), empty: sum(empty), capped: sum(capped), filled: sum(filled) },
    moveFromTemplateCm: moves.length ? { mean: round2(moves.reduce((a, b) => a + b, 0) / moves.length), p5: round2(percentile(moves, 0.05)), p95: round2(percentile(moves, 0.95)) } : null,
    iterations,
    converged,
    convergence,
    silhouetteRounds: rounds,
    dataResidualCm: residualN ? Math.round((residual / residualN) * 1000) / 1000 : 0,
    belowClearance: below,
    insideBody: inside,
    timingsMs: timings,
  };
  return { mesh, render: { positions: Float64Array.from(rpos), uvs: Float32Array.from(ruv), indices: Uint32Array.from(rtris), remap: Uint32Array.from(rmap), charts }, report };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const sum = (a: Uint8Array): number => a.reduce((n, x) => n + x, 0);

/** Render-mesh positions from welded positions (after calibration or a drape: same vertex order). */
export function renderPositions(render: Pick<RenderMesh, 'remap'>, welded: ArrayLike<number>): Float64Array {
  const out = new Float64Array(render.remap.length * 3);
  for (let r = 0; r < render.remap.length; r++) {
    const w = render.remap[r]!;
    out[3 * r] = welded[3 * w]!;
    out[3 * r + 1] = welded[3 * w + 1]!;
    out[3 * r + 2] = welded[3 * w + 2]!;
  }
  return out;
}

export { project };
