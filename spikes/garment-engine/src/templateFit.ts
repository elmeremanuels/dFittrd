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
 * Output: one welded mesh (body + sleeves as separate open tubes; each sleeve starts with a shoulder
 * cap, `SHOULDER_CAP`, that closes over the arm cap and overlaps the bodice), exact 4 mm clearance,
 * outward triangles, and a render copy with a UV seam per tube (cylindrical charts) for the bake.
 *
 * Trousers (`legs`, 0.3.0): the body tube is the seat, from the waist to just below the crotch, and
 * each leg is its own tube round the mannequin's leg axis (rays horizontal from the leg centre), with
 * its hem found per column on the masks like a cuff. One tube round both legs (what a skirt is) can
 * only carve the gap between the legs from outside: the rays start beyond the far leg, so the inner
 * leg surfaces and the crotch never existed and a trouser became a skirt.
 * Open fronts: a front opening is rays carved down to the body (mannequin visible between the fronts);
 * the region touches the neckline row, so the noise-hole fill leaves it open.
 */
import { type Mannequin, type Mesh, type Side, type Vec3 } from '@curtain/mannequin';
import { buildBodySdf, MIN_CLEARANCE_CM, type BodySdf } from './bodySdf';
import { armpitDistance } from './garment';
import { distancesToMesh } from './meshDistance';
import type { Mask } from './evalPng';
import { cleanMask, DEFAULT_CLEANUP, morph, pixelsPerCm, project, rasterize, type MaskCleanup, type PinholeCamera } from './views';

export const TEMPLATE_FIT_VERSION = 'stage4t-template-fit-0.3.0';

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
  /**
   * The control each frame was generated from (stage 2 follows the exporter's control render), one per
   * camera: `mannequin` where the control shows the mannequin or the proxy (control/mask), `proxy` where
   * it shows the proxy (control/proxy_mask). Only for frames generated from that control; a render of a
   * known garment (the synthetic frames) has none. See `CONTROL_CAP`.
   */
  control?: ({ mannequin: Mask; proxy: Mask } | null)[];
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
  /** Trousers: the body tube ends at the crotch and each leg is fitted as its own tube (default false: a bottom is a skirt). */
  legs: boolean;
  /**
   * Where the depth comes from. `hull` (default): the visual hull of the training views, which needs
   * views from the side (the turntable). `template`: the predicted route's two-view fit (front and back
   * stills only, docs/PREDICTION-ENGINE.md §4.5): front and back views see width, outline, hem and
   * cuffs but nothing about depth (their visual hull is a slab, open towards the cameras), so every
   * ring keeps the template's cross-section, scaled along the views' lateral axis to the width the masks
   * show on each side (`TwoViewReport`); the hull only bounds it. The carving threshold defaults to 0
   * (a point outside any view's silhouette is outside the garment).
   */
  depthPrior: 'hull' | 'template';
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
  legs: false,
  depthPrior: 'hull',
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
  /** Per view (or null): pixels whose non-garment content the control dictates on the sleeve head (`CONTROL_CAP`). */
  dictated: (Uint8Array | null)[];
  /** Radius (px, mean over the views with a control) the bare cap zone was grown by. */
  dictatedRadiusPx: number;
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

/**
 * The arm cap a sleeveless control leaves bare. A shop product's control proxy has no sleeve shell
 * when the product gives no sleeve length (`proxy.ts`), and the v0 mannequin's arm cap stands out
 * above the proxy's shoulder line; the generated video follows the control there and shows a grey
 * cap at the outer shoulder top even on a garment with sleeves (run 14). Where a frame shows that,
 * its pixels say nothing about the cloth: on the sleeve head (`Ray.head`), a non-garment pixel is
 * left out of the evidence where the frame's control shows the bare mannequin on our arm's cap (the
 * arm from its start pole down to the armpit, `armpitDistance`), grown by the clearance plus
 * `mismatchCm` (the generated cap's outline against ours: run 14's training frames show background
 * inside our cap on 3.6 % of its 1 px rim and on 0.1 % at 2 px), and never over the control's proxy.
 * A mannequin pixel there does not carve the hull; neither it nor background counts in the presence
 * vote, and a head point whose vote the control left without `MIN_INFORMATIVE` views is kept (the
 * sleeve was found). Everywhere else (outside that zone, where the control shows the proxy, on any
 * frame without a control, on the synthetic renders) mannequin and background carve as on the rest
 * of the garment. A garment cut open over the cap (cold-shoulder) is therefore found where the
 * control covers the cap (a proxy with sleeves) and not where it leaves the cap bare: those frames
 * hold no evidence of it.
 */
export const CONTROL_CAP = { mismatchCm: 0.3 };

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

/** 1 for the triangles of the body mesh on an arm's cap: arm triangles whose centre lies above the armpit along the arm (`CONTROL_CAP`). */
export function armCapTriangles(m: Mannequin, body: Mesh): Uint8Array {
  const arm = armTriangles(body);
  const head = armpitDistance(m);
  const P = body.positions, I = body.indices;
  const out = new Uint8Array(I.length / 3);
  for (let t = 0; t < out.length; t++) {
    if (!arm[t]) continue;
    const c = [0, 1, 2].map((d) => (P[3 * I[3 * t]! + d]! + P[3 * I[3 * t + 1]! + d]! + P[3 * I[3 * t + 2]! + d]!) / 3);
    const f = c[0]! >= 0 ? m.arms.left : m.arms.right;
    out[t] = (c[0]! - f.joint[0]) * f.axis[0] + (c[1]! - f.joint[1]) * f.axis[1] + (c[2]! - f.joint[2]) * f.axis[2] <= head ? 1 : 0;
  }
  return out;
}

function buildEvidence(views: FitViews, body: Mesh, m: Mannequin, opt: TemplateFitOptions): Evidence {
  const ids = views.train;
  const n = ids.length;
  const rt = new Float64Array(n * 12);
  const intr = new Float64Array(n * 4);
  const centres = new Float64Array(n * 3);
  const code: Uint8Array[] = [];
  const garment: Uint8Array[] = [];
  const bodyDepth: Float32Array[] = [];
  const arm = armTriangles(body);
  const capTri = views.control ? armCapTriangles(m, body) : null;
  const dictated: (Uint8Array | null)[] = [];
  let radiusSum = 0, radiusViews = 0;
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
    const clean = cleanMask(mask, pixelsPerCm(cam), opt.cleanup).data;
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
    const ctl = views.control?.[v];
    if (ctl && capTri) {
      if (ctl.mannequin.width !== width || ctl.mannequin.height !== height || ctl.proxy.width !== width || ctl.proxy.height !== height) throw new Error(`view ${v}: control masks are not ${width}×${height}`);
      const bare = Uint8Array.from(r.tri, (t, i) => (t >= 0 && capTri[t] && ctl.mannequin.data[i] && !ctl.proxy.data[i] ? 1 : 0));
      const radius = Math.max(1, Math.round((opt.clearanceCm + CONTROL_CAP.mismatchCm) * pixelsPerCm(cam)));
      radiusSum += radius;
      radiusViews++;
      const grown = morph({ width, height, data: bare }, radius, true).data;
      dictated.push(Uint8Array.from(grown, (g, i) => (g && !ctl.proxy.data[i] ? 1 : 0)));
    } else dictated.push(null);
  });
  const tau = opt.tau ?? (opt.depthPrior === 'template' ? 0 : Math.max(1, Math.round(0.05 * n)));
  return { n, width, height, rt, intr, code, garment, centres, bodyDepth, dictated, dictatedRadiusPx: radiusViews ? radiusSum / radiusViews : 0, tau, margin: opt.occlusionMarginCm };
}

/** Number of training views that carve the point, counting up to `limit + 1` at most. On the sleeve head (`head`) a mannequin pixel the control dictates does not carve (`CONTROL_CAP`); background does. */
function carveCount(e: Evidence, x: number, y: number, z: number, limit: number, head = false): number {
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
    if (c === 0 || (c === 2 && head && e.dictated[k]?.[i])) continue;
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
 * V-neck opening is "garment" from the side), so it says little. On the sleeve head (`head`), a
 * non-garment pixel the control dictates is left out and counted in `dictated` (`CONTROL_CAP`).
 */
function carveStats(e: Evidence, x: number, y: number, z: number, d: readonly number[], head = false): { carved: number; informative: number; views: number; dictated: number } {
  let carved = 0, informative = 0, views = 0, dictated = 0;
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
    if (head && e.dictated[k]?.[i]) {
      dictated++;
      continue;
    }
    if (c === 2 && e.bodyDepth[k]![i]! < zc - e.margin) continue;
    carved += wv;
    informative += wv;
    views++;
  }
  return { carved, informative, views, dictated };
}

/**
 * Facing-weighted vote at a point: present unless at least half of the weight carves it (needs
 * `MIN_INFORMATIVE` views, else `fallback`; on the sleeve head, present when the control's bare cap
 * took the views that were missing: `CONTROL_CAP`). `byControl` says the control decided.
 */
function votePresent(e: Evidence, p: readonly number[], d: readonly number[], fallback: boolean, head = false): { present: boolean; byControl: boolean } {
  const st = carveStats(e, p[0]!, p[1]!, p[2]!, d, head);
  if (st.views >= MIN_INFORMATIVE) return { present: st.carved * 2 < st.informative, byControl: false };
  if (head && st.dictated > 0 && st.views + st.dictated >= MIN_INFORMATIVE) return { present: true, byControl: true };
  return { present: fallback, byControl: false };
}

const MIN_INFORMATIVE = 4;
/** Predicted triangles of the grid before trimming: aim, and the band outside which spacing and columns are rescaled. */
const TRIANGLE_TARGET = { aim: 12600, low: 9500, high: 14400 };
/** Share of the median outline offset applied per silhouette round (damps the alternation between rounds). */
const SIL_GAIN = 0.7;
/** Rows within this distance of the hem or a cuff follow the surface above them (cm), with a slope of at most `EDGE_SLOPE` cm per cm. */
const EDGE_FREE_CM = 5;
const EDGE_SLOPE = 0.8;
/**
 * Largest interior hole (grid vertices) filled as mask noise. About 2 × 2 cells (≈ 3 × 3 cm on the
 * default grid), the same size as the mask clean-up's 12 cm² (views.ts `DEFAULT_CLEANUP`), so an
 * opening the cleaned masks still show (a keyhole of 10 × 5 cm is about 20 vertices) stays open.
 */
const NOISE_HOLE_VERTICES = 4;
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
  /** Sleeve head (the cap rows and the sleeve up to the upper-arm ring): where the control's bare arm cap is left out of the evidence (`CONTROL_CAP`). */
  head?: boolean;
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
    return carveCount(e, x, y, z, e.tau, ray.head === true) > e.tau;
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

/** A trouser-leg ray: horizontal, from the mannequin leg's centre at `legTop − s`. */
function legRay(m: Mannequin, side: Side, legTop: number, s: number, phi: number): Ray {
  const y = legTop - s;
  const l = m.legAt(y, side) ?? m.legAt(Math.min(legTop, Math.max(1, y)), side);
  const cx = l?.cx ?? side * m.landmarks.legX, cz = l?.cz ?? 0;
  const d: Vec3 = [Math.sin(phi), 0, Math.cos(phi)];
  return { o: [cx, y, cz], d, own: l ? ellipseRadius(l.a, l.b, d[0], d[2]) : null };
}

function sleeveRay(m: Mannequin, side: Side, s: number, phi: number): Ray {
  const f = side === 1 ? m.arms.left : m.arms.right;
  const o: Vec3 = [f.joint[0] + f.axis[0] * s, f.joint[1] + f.axis[1] * s, f.joint[2] + f.axis[2] * s];
  const cu = Math.cos(phi), sv = Math.sin(phi);
  const d: Vec3 = [cu * f.u[0] + sv * f.v[0], cu * f.u[1] + sv * f.v[1], cu * f.u[2] + sv * f.v[2]];
  const a = m.armAt(s, side);
  return { o, d, own: a ? ellipseRadius(a.a, a.b, cu, sv) : null };
}

/**
 * The shoulder over the sleeve head. Body rays are horizontal and sleeve rays square to the arm, so
 * near the top of the arm's cap both run parallel to the cloth: body rays there pass through the
 * cap and are blocked (the armhole), sleeve rays start at the shoulder joint. Nothing covered the
 * cap's top and the side of it facing the neck (run 14: a bare patch the size of the upper arm in
 * every render). The sleeve tube therefore starts with `rows` cap rows whose rays fan out from the
 * shoulder joint, tilted from square-to-the-arm (the sleeve's first row, α = 0) towards the
 * shoulder (against the arm axis, α = `maxDeg`): close to the shoulder's normal, so the vertices
 * land on the shoulder surface instead of sliding along it. The fan stops short of the pole and
 * overlaps the body tube there.
 *
 * Evidence on the head: a sleeveless control leaves the arm cap bare in the frames even on a
 * garment with sleeves (run 14); those pixels are left out (`CONTROL_CAP`). Everywhere else the cap
 * rows are carved like any other ray, and a garment without sleeves gets no sleeve tube at all.
 */
export const SHOULDER_CAP = { maxDeg: 88, rows: 6, maxExtentCm: 6 };

function capRay(m: Mannequin, side: Side, alpha: number, phi: number): Ray {
  const f = side === 1 ? m.arms.left : m.arms.right;
  const cu = Math.cos(phi), sv = Math.sin(phi);
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const d: Vec3 = [0, 1, 2].map((k) => ca * (cu * f.u[k]! + sv * f.v[k]!) - sa * f.axis[k]!) as Vec3;
  const a0 = m.armAt(0, side);
  // The arm's cap: its section at the joint, closed by a pole about 0.76 of that radius above it.
  const own = a0 ? 1 / Math.sqrt(((ca * cu) / a0.a) ** 2 + ((ca * sv) / a0.b) ** 2 + (sa / (0.76 * a0.a)) ** 2) : null;
  return { o: [...f.joint] as Vec3, d, own, head: true };
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

type PartName = 'body' | 'sleeve_l' | 'sleeve_r' | 'leg_l' | 'leg_r';

interface PartGrid {
  name: PartName;
  rows: number;
  cols: number;
  /** First vertex index of this part. */
  offset: number;
  /** v coordinate (0 top / shoulder end … 1 hem / cuff) per vertex of the part. */
  v: Float64Array;
  /** Sleeves and legs: the side and the cuff or hem (distance along the arm, or down from the leg top) per column. */
  side?: Side;
  cuff?: number[];
  /** Sleeves: rows of the shoulder cap before the first row square to the arm (`SHOULDER_CAP`). */
  capRows?: number;
}

const isSleeve = (p: PartGrid): boolean => p.name === 'sleeve_l' || p.name === 'sleeve_r';

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
  /** Trousers: one tube per leg found in the masks (`fitted`: the option was on). */
  legs: { left: boolean; right: boolean; fitted: boolean };
  /** Rays: blocked by another body part (armhole), empty (carved at the body), capped at the next body part, with no hull (filled by smoothness), body rays ended at a fitted sleeve, rays of the shoulder caps (`SHOULDER_CAP`), vertices moved out to the clearance by the exact distance (`pushToClearance`: of them inside the mannequin, and still below the clearance after its passes). */
  rays: { total: number; blocked: number; empty: number; capped: number; filled: number; sleeveClamped: number; shoulderCap: number; exactClearancePushed: number; exactClearanceInside: number; exactClearanceUnresolved: number };
  /** The control's bare arm cap (`CONTROL_CAP`): training views with a control, the zone's radius (px, mean), sleeve-head rays whose presence the control decided (kept at the clearance), and of those on the cap rows. */
  controlCap: { views: number; radiusPx: number; decided: number; decidedCapRows: number };
  /** `depthPrior: 'template'` only (else null): how the template's cross-sections were scaled to the masks. */
  twoView: TwoViewReport | null;
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
/** Trousers: a short seat chart on top, the two long legs side by side below. */
export const ATLAS_CHARTS_TROUSERS: Record<'body' | 'leg_l' | 'leg_r', [number, number, number, number]> = {
  body: [0.004, 0.004, 0.996, 0.246],
  leg_l: [0.004, 0.254, 0.496, 0.996],
  leg_r: [0.504, 0.254, 0.996, 0.996],
};
const chartOf = (name: PartName): [number, number, number, number] =>
  name === 'leg_l' || name === 'leg_r' ? ATLAS_CHARTS_TROUSERS[name] : name === 'body' ? ATLAS_CHARTS.body : ATLAS_CHARTS[name];

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

/**
 * Exact clearance. The solve keeps the clearance on the grid SDF (trilinear, 0.25 cm cells), which
 * reads a few tenths of a millimetre optimistic near the surface and most in the crease between the
 * arm cap and the torso, where the shoulder caps land (run 14: 3.3 mm by the exact distance). Every
 * point `idx` (at `s[i]` along `rays[i]`) whose exact distance to the mannequin's triangles is below
 * `clearanceCm`, or that lies inside the mannequin (the SDF's sign: the exact search stops at
 * `clearanceCm + 1`), moves out along its ray: by the shortfall when it is outside, by its depth plus the
 * clearance when it is inside, and is checked again, up to 8 passes. Mutates `s`;
 * returns the points moved, how many of them started inside, and how many are still below the
 * clearance at the end (a ray that runs back into the body; 0 expected).
 */
export function pushToClearance(rays: readonly { o: readonly number[]; d: readonly number[] }[], s: Float64Array, idx: readonly number[], body: Pick<Mesh, 'positions' | 'indices'>, sdf: BodySdf, clearanceCm: number): { pushed: Uint8Array; inside: number; unresolved: number } {
  const pushed = new Uint8Array(rays.length);
  let inside = 0;
  let check = [...idx];
  const at = (i: number, d: number): number => rays[i]!.o[d]! + s[i]! * rays[i]!.d[d]!;
  for (let pass = 0; pass < 8 && check.length; pass++) {
    const pts = new Float64Array(check.length * 3);
    check.forEach((i, k) => {
      for (let d = 0; d < 3; d++) pts[3 * k + d] = at(i, d);
    });
    const dist = distancesToMesh(pts, body, clearanceCm + 1);
    const next: number[] = [];
    check.forEach((i, k) => {
      // The exact distance is only searched to `clearanceCm + 1`: deeper inside it reads that cap, so the
      // SDF's sign decides inside, and its depth the step when the exact distance is capped.
      const signed = sdf.at(pts[3 * k]!, pts[3 * k + 1]!, pts[3 * k + 2]!);
      const isInside = signed < 0;
      if (!isInside && dist[k]! >= clearanceCm) return;
      if (isInside && !pushed[i]) inside++;
      s[i] = s[i]! + (isInside ? Math.max(-signed, dist[k]! < clearanceCm + 1 ? dist[k]! : 0) + clearanceCm : clearanceCm - dist[k]!) + 0.01;
      pushed[i] = 1;
      next.push(i);
    });
    check = next;
  }
  let unresolved = 0;
  if (check.length) {
    const pts = new Float64Array(check.length * 3);
    check.forEach((i, k) => {
      for (let d = 0; d < 3; d++) pts[3 * k + d] = at(i, d);
    });
    const dist = distancesToMesh(pts, body, clearanceCm + 1);
    for (let k = 0; k < check.length; k++) if (dist[k]! < clearanceCm || sdf.at(pts[3 * k]!, pts[3 * k + 1]!, pts[3 * k + 2]!) < 0) unresolved++;
  }
  return { pushed, inside, unresolved };
}

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
  const ev = buildEvidence(inp.views, inp.body, m, opt);
  lap('evidence');
  const h = m.morphHeights;
  const isBottom = opt.category === 'bottom';
  const C = opt.bodyColumns;
  const theta = (c: number): number => (2 * Math.PI * c) / C;

  // Template radius along a ray: where it leaves the proxy volume (closed), null when the ray starts outside it.
  const templateAlong = (ray: Ray): number | null => {
    if (!proxySdf || proxySdf.at(...(ray.o as [number, number, number])) >= 0) return null;
    let t = 0;
    while (t < 60 && proxySdf.at(ray.o[0] + t * ray.d[0], ray.o[1] + t * ray.d[1], ray.o[2] + t * ray.d[2]) < 0) t += 0.25;
    return t < 60 ? t : null;
  };
  // The radius the extent scans continue below/beyond the last sample: the hull's. With the template's depth
  // (two views), a capped hull (a ray towards the cameras, which no view carves) is not a radius: the scan
  // takes the template's there, so the next sample is voted on where the cloth would be and not 35 cm in
  // front of it.
  // With front and back views the hull is a slab, so an oblique ray's hull lies at the slab's corner, beyond
  // the cloth, where a point projects outside the silhouette: the template's radius, kept inside the slab.
  // Beyond the template's hem or cuff the last radius carries on (the template's cross-section continues).
  const scanRadius = (ray: Ray, hh: { s: number; capped: boolean }, prev: number): number => {
    if (opt.depthPrior !== 'template') return hh.s;
    const t = templateAlong(ray) ?? (Number.isFinite(prev) ? prev : Infinity);
    const inSlab = hh.s >= 0 && !hh.capped ? 0.98 * hh.s : Infinity;
    const r = Math.min(t, inSlab);
    return Number.isFinite(r) ? r : prev;
  };
  // Presence where too few views face a point for the facing-weighted vote (`MIN_INFORMATIVE`): the hull is
  // non-empty (turntable), or, with the template's depth, no view carves the point where the cloth would be.
  // With front and back views only, "the hull is non-empty" asks about the point next to the body (a leg
  // under a flared skirt), and the front of the hem, which hangs in front of that point and projects below
  // it from a camera at chest height, kept it: the hem ran 3-4 cm long all round.
  const fewViewsPresent = (ray: Ray, t: number, hs: number): boolean => {
    if (opt.depthPrior !== 'template') return hs >= 0;
    const [x, y, z] = along(ray, t);
    return carveCount(ev, x!, y!, z!, ev.tau, ray.head === true) <= ev.tau;
  };

  // --- 1. Body extents: hem per column (scan from the chest, or the waist for a bottom, downwards).
  const yScanTop = isBottom ? h.waist : h.chest;
  const yFloor = 2;
  const scanStep = -0.5;
  const hemRaw: number[] = [];
  // Each sample is voted on at the radius of the garment just above it (the skirt continued downwards),
  // so the hem is where most views stop seeing cloth: the median hem of frames that disagree.
  const along = (ray: Ray, t: number): number[] => [ray.o[0] + t * ray.d[0], ray.o[1] + t * ray.d[1], ray.o[2] + t * ray.d[2]];
  const legs = isBottom && opt.legs;
  const crotchY = m.landmarks.crotch[1];
  // Trousers: the seat tube ends just below the crotch, where the leg tubes (from legTop down) take over.
  const legTop = crotchY + 2;
  for (let c = 0; c < C; c++) {
    if (legs) {
      hemRaw.push(crotchY - 1);
      continue;
    }
    const present: boolean[] = [];
    let rPrev = NaN;
    for (let y = yScanTop; y >= yFloor; y += scanStep) {
      const ray = bodyRay(m, y, theta(c));
      const range = rayRange(sdf, ray, opt.clearanceCm, 35, opt.blockedCm);
      if (range.blocked) {
        present.push(true);
        continue;
      }
      const hh = hullAlong(ev, ray, range);
      const hs = hh.s;
      const test = Number.isFinite(rPrev) ? Math.min(range.hi, Math.max(range.lo, rPrev)) : range.lo;
      present.push(votePresent(ev, along(ray, test), ray.d, fewViewsPresent(ray, test, hs)).present);
      if (hs >= 0) rPrev = scanRadius(ray, hh, rPrev);
    }
    hemRaw.push(runEnd({ start: yScanTop, step: scanStep, present }, 2, 25));
  }
  const hem = circularSmooth(fillCircular(hemRaw), 4, 2);
  if (!hem.every(Number.isFinite)) throw new Error('stage 4t: no garment found below the chest in any column (masks or cameras wrong?)');
  lap('hem');

  // --- 2. Sleeve extents: cuff per column.
  const sleeveSides: Side[] = [];
  const cuffs = new Map<number, number[]>(); // key: arm side (±1), or ±2 for the trouser legs
  const sleeveNotes: string[] = [];
  // A sleeve may cover the wrist and part of the hand (the synthetic shirt dress's cuff ends 1.5 cm past the wrist): scan to the fingertips.
  const armLen = m.arms.left.upperArmCm + m.arms.left.forearmCm + m.arms.left.handCm;
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
          const hh = hullAlong(ev, ray, range);
          const hs = hh.s;
          const test = Number.isFinite(rPrev) ? Math.min(range.hi, Math.max(range.lo, rPrev)) : range.lo;
          present.push(votePresent(ev, along(ray, test), ray.d, fewViewsPresent(ray, test, hs)).present);
          if (hs >= 0) rPrev = scanRadius(ray, hh, rPrev);
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
  // --- 2b. Trouser legs: hem per column of each leg (distance down from legTop), as a cuff.
  const legSides: Side[] = [];
  if (legs) {
    for (const side of [1, -1] as Side[]) {
      const Cs = opt.sleeveColumns;
      const raw: number[] = [];
      for (let c = 0; c < Cs; c++) {
        const phi = (2 * Math.PI * c) / Cs;
        const present: boolean[] = [];
        let rPrev = NaN;
        for (let sd = 0; sd <= legTop - yFloor; sd += 0.5) {
          const ray = legRay(m, side, legTop, sd, phi);
          const range = rayRange(sdf, ray, opt.clearanceCm, 30, opt.blockedCm);
          if (range.blocked) {
            present.push(false);
            continue;
          }
          const hh = hullAlong(ev, ray, range);
          const hs = hh.s;
          const test = Number.isFinite(rPrev) ? Math.min(range.hi, Math.max(range.lo, rPrev)) : range.lo;
          present.push(votePresent(ev, along(ray, test), ray.d, fewViewsPresent(ray, test, hs)).present);
          if (hs >= 0) rPrev = scanRadius(ray, hh, rPrev);
        }
        raw.push(runEnd({ start: 0, step: 0.5, present }, 2, 8));
      }
      const known = raw.filter(Number.isFinite);
      const name = side === 1 ? 'left' : 'right';
      if (known.length >= 0.4 * Cs && percentile(known, 0.5) > 4) {
        legSides.push(side);
        const med = percentile(known, 0.5);
        // A hem is close to level; columns between the legs see the other leg and run long: hold within 4 cm of the median.
        cuffs.set(2 * side, circularSmooth(fillCircular(raw).map((x) => Math.min(med + 4, Math.max(med - 4, x))), 2, 1));
      } else sleeveNotes.push(`${name} leg: none in the masks (${known.length}/${Cs} columns with garment): the trousers end at the crotch`);
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
    const sleeveRows = [...sleeveSides, ...legSides.map((sd) => 2 * sd)].map((key, k) => Math.max(3, Math.ceil(Math.max(...cuffs.get(key)!) / sleeveRowSpacing) + 1) + (k < sleeveSides.length ? SHOULDER_CAP.rows : 0));
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
  [...sleeveSides.map((side) => ({ side, leg: false })), ...legSides.map((side) => ({ side, leg: true }))].forEach(({ side, leg }, si) => {
    const Cs = lay.sleeveCols;
    const key = leg ? 2 * side : side;
    const cuff = Cs === opt.sleeveColumns ? cuffs.get(key)! : resample(cuffs.get(key)!, Cs);
    const maxCuff = Math.max(...cuff);
    const Rs = lay.sleeveRows[si]!;
    const K = SHOULDER_CAP.rows;
    const Ra = Rs - K; // rows square to the arm, from the joint to the cuff
    const offset = rays.length;
    if (leg) {
      parts.push({ name: side === 1 ? 'leg_l' : 'leg_r', rows: Rs, cols: Cs, offset, v: new Float64Array(0), side, cuff });
      for (let r = 0; r < Rs; r++) for (let c = 0; c < Cs; c++) {
        const sAlong = (r / (Rs - 1)) * cuff[c]!;
        rays.push(legRay(m, side, legTop, sAlong, (2 * Math.PI * c) / Cs));
        vCoord.push(sAlong / maxCuff);
      }
      return;
    }
    parts.push({ name: side === 1 ? 'sleeve_l' : 'sleeve_r', rows: Rs, cols: Cs, offset, v: new Float64Array(0), side, cuff, capRows: K });
    // The sleeve head: the arm's cap, from the joint to the upper-arm ring where the cap's bulge ends.
    const headCm = m.morphHeights.upper_arm;
    for (let r = 0; r < Rs; r++) for (let c = 0; c < Cs; c++) {
      const phi = (2 * Math.PI * c) / Cs;
      if (r < K) {
        rays.push(capRay(m, side, ((SHOULDER_CAP.maxDeg * Math.PI) / 180) * (1 - r / K), phi));
        vCoord.push(0);
        continue;
      }
      const sAlong = ((r - K) / (Ra - 1)) * cuff[c]!;
      const ray = sleeveRay(m, side, sAlong, phi);
      if (sAlong <= headCm) ray.head = true;
      rays.push(ray);
      vCoord.push(sAlong / maxCuff);
    }
  });
  const N = rays.length;
  // Cap rows of the sleeves (rays fanned from the shoulder joint).
  const isCap = new Uint8Array(N);
  for (const p of parts) for (let k = 0; k < (p.capRows ?? 0) * p.cols; k++) isCap[p.offset + k] = 1;
  lap('grid');

  const partOfIndex = (i: number): PartGrid => {
    for (let k = parts.length - 1; k >= 0; k--) if (i >= parts[k]!.offset) return parts[k]!;
    return parts[0]!;
  };
  // --- 4. Per vertex: admissible range, template radius (proxy), hull.
  const lo = new Float64Array(N), hi = new Float64Array(N), hull = new Float64Array(N), s0 = new Float64Array(N);
  const blocked = new Uint8Array(N), empty = new Uint8Array(N), capped = new Uint8Array(N), byControl = new Uint8Array(N);
  /** Template radius where the ray starts inside the template volume (else NaN: beyond its hem or cuff, above its neckline). */
  const tplS = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) {
    const ray = rays[i]!;
    const own = partOfIndex(i);
    const range = rayRange(sdf, ray, opt.clearanceCm, own.name === 'body' ? 35 : isSleeve(own) ? (isCap[i] ? SHOULDER_CAP.maxExtentCm : 18) : 30, opt.blockedCm);
    lo[i] = range.lo;
    hi[i] = range.hi;
    blocked[i] = range.blocked ? 1 : 0;
    // Template: where the ray leaves the proxy volume (the proxy is closed), else 1.5 cm off the body.
    const tplRaw = templateAlong(ray);
    if (tplRaw !== null) tplS[i] = tplRaw;
    const tpl = tplRaw ?? range.lo + 1.5;
    s0[i] = Math.min(range.hi, Math.max(range.lo, tpl));
    const hh = hullAlong(ev, ray, range);
    hull[i] = hh.s;
    capped[i] = hh.capped ? 1 : 0;
    // Presence by the median vote at the hull (or the template where the hull is empty; on the sleeve
    // head the clearance, where the control's bare cap zone is drawn: `CONTROL_CAP`).
    // With the template's depth (two views) the vote is taken where the cloth would be: the template's radius,
    // inside the slab the two silhouettes leave (just inside the hull: on the hull a point is on the carving
    // boundary), and the hull alone beyond the template's hem or cuff.
    const testS = opt.depthPrior === 'template' && !ray.head
      ? Math.min(hh.s >= 0 && !hh.capped ? 0.98 * hh.s : Infinity, tplRaw ?? (hh.s >= 0 && !hh.capped ? Infinity : s0[i]!))
      : hh.s >= 0 ? hh.s : ray.head ? range.lo : s0[i]!;
    if (range.blocked) continue;
    const vote = votePresent(ev, [ray.o[0] + testS * ray.d[0], ray.o[1] + testS * ray.d[1], ray.o[2] + testS * ray.d[2]], ray.d, fewViewsPresent(ray, testS, hh.s), ray.head === true);
    empty[i] = vote.present ? 0 : 1;
    if (vote.byControl) byControl[i] = 1;
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
  for (const p of parts.slice(1)) for (let r = (p.capRows ?? 0) + Math.floor((p.rows - (p.capRows ?? 0)) / 3); r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
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
      if (!edge && !anyBlocked && region.length <= NOISE_HOLE_VERTICES) for (const j of region) { present[j] = 1; filled[j] = 1; }
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
      // No hull (the vote keeps it, a filled hole, the rows kept inside the hem): the template holds it
      // weakly. A sleeve head the control decided sits at the clearance: the hull was carved there by
      // the background round the control's bare cap (`CONTROL_CAP`).
      target[i] = byControl[i] ? lo[i]! : s0[i]!;
      w[i] = 0.05;
    }
  }
  const twoView = opt.depthPrior === 'template' ? templateDepthTargets({ views: inp.views, parts, rays, isCap, present, blocked, capped, byControl, hull, s0, tplS, lo, hi, target, w, mannequin: m }) : null;
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

  // The bodice may not run into the sleeves. Between the A-pose arm and the torso the masks cannot
  // carve: every front or back view sees the sleeve there and every side view the arm, so the hull of
  // a body ray passing between them stays open until the arm (run 14: the bodice spread into a lens
  // reaching the arms, chest girth 121.5 cm by the tape against 99.0 cm on the 2DGS mesh). With the
  // sleeves fitted, a body ray ends where it would enter a sleeve (its fitted radius round the arm
  // axis, minus the clearance); the cloth behind the sleeve is not seen by any view, and the
  // smoothness term carries the bodice across from the front and the back.
  let sleeveClamped = 0;
  if (sleeveSides.length && !isBottom) {
    const sleeves = parts.filter((p) => isSleeve(p) && p.cuff);
    const sleeveRadius = (p: PartGrid, x: number, y: number, z: number): number => {
      const f = p.side === 1 ? m.arms.left : m.arms.right;
      const rx = x - f.joint[0], ry = y - f.joint[1], rz = z - f.joint[2];
      const t = rx * f.axis[0] + ry * f.axis[1] + rz * f.axis[2];
      const cu = rx * f.u[0] + ry * f.u[1] + rz * f.u[2], cv = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
      const phi = (Math.atan2(cv, cu) + 2 * Math.PI) % (2 * Math.PI);
      const fc = (phi / (2 * Math.PI)) * p.cols;
      const c0 = Math.floor(fc) % p.cols, c1 = (c0 + 1) % p.cols, a = fc - Math.floor(fc);
      const radiusAt = (c: number): number => {
        const cuffC = p.cuff![c]!;
        if (t < 0 || t > cuffC) return -1;
        const K = p.capRows ?? 0;
        const fr = K + (t / cuffC) * (p.rows - K - 1);
        const r0 = Math.min(p.rows - 2, Math.floor(fr)), b = fr - r0;
        const i0 = p.offset + r0 * p.cols + c, i1 = i0 + p.cols;
        if (!present[i0] || !present[i1]) return -1;
        return s[i0]! * (1 - b) + s[i1]! * b;
      };
      const ra = radiusAt(c0), rb = radiusAt(c1);
      if (ra < 0 || rb < 0) return Infinity; // no fitted sleeve here: not inside it
      return Math.hypot(cu, cv) - (ra * (1 - a) + rb * a);
    };
    const body = parts[0]!;
    for (let i = body.offset; i < body.offset + body.rows * body.cols; i++) {
      if (!present[i]) continue;
      const ray = rays[i]!;
      if (ray.o[1] < h.waist) continue;
      for (let t = lo[i]!; t <= Math.max(s[i]!, lo[i]!) + 1e-9; t += 0.25) {
        const x = ray.o[0] + t * ray.d[0], y = ray.o[1] + t * ray.d[1], z = ray.o[2] + t * ray.d[2];
        if (sleeves.some((p) => sleeveRadius(p, x, y, z) < opt.clearanceCm)) {
          const cap = Math.max(lo[i]!, t - 0.25);
          if (cap < hi[i]!) {
            hi[i] = cap;
            sleeveClamped++;
          }
          break;
        }
      }
    }
    if (sleeveClamped) {
      for (let i = 0; i < N; i++) if (present[i]) s[i] = Math.min(hi[i]!, Math.max(lo[i]!, s[i]!));
      solve('sleeve exclusion');
      extrapolate();
    }
  }

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

  // Exact clearance (`pushToClearance`).
  const kept: number[] = [];
  for (let i = 0; i < N; i++) if (present[i]) kept.push(i);
  const exact = pushToClearance(rays, s, kept, inp.body, sdf, opt.clearanceCm);
  lap('exact clearance');

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
  for (const p of parts) charts[p.name] = chartOf(p.name);
  const renderVertex = (i: number, seam: boolean): number => {
    const key = `${i}:${seam ? 1 : 0}`;
    let r = rIndex.get(key);
    if (r !== undefined) return r;
    const p = partOf(i);
    const k = i - p.offset;
    const row = Math.floor(k / p.cols), col = k % p.cols;
    const [u0, v0, u1, v1] = chartOf(p.name);
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
      const ext = p.name === 'body' ? nonEmptyHem : cuffs.get(({ sleeve_l: 1, sleeve_r: -1, leg_l: 2, leg_r: -2 } as const)[p.name]) ?? [];
      return { name: p.name, rows: p.rows, cols: p.cols, vertices: p.rows * p.cols, kept, hemOrCuff: ext.length ? { min: round2(Math.min(...ext)), max: round2(Math.max(...ext)), mean: round2(ext.reduce((a, b) => a + b, 0) / ext.length) } : null };
    }),
    sleeves: { left: sleeveSides.includes(1), right: sleeveSides.includes(-1), reason: sleeveNotes.join('; ') || (opt.sleeves && !isBottom ? 'sleeves found in the masks' : 'not fitted for this category') },
    legs: { left: legSides.includes(1), right: legSides.includes(-1), fitted: legs },
    rays: { total: N, blocked: sum(blocked), empty: sum(empty), capped: sum(capped), filled: sum(filled), sleeveClamped, shoulderCap: sum(isCap), exactClearancePushed: sum(exact.pushed), exactClearanceInside: exact.inside, exactClearanceUnresolved: exact.unresolved },
    controlCap: { views: ev.dictated.filter(Boolean).length, radiusPx: round2(ev.dictatedRadiusPx), decided: sum(Uint8Array.from(byControl, (b, i) => (b && present[i] ? 1 : 0))), decidedCapRows: sum(Uint8Array.from(byControl, (b, i) => (b && present[i] && isCap[i] ? 1 : 0))) },
    twoView,
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

// ---------------------------------------------------------------------------
// Two views: depth from the template (`depthPrior: 'template'`)
// ---------------------------------------------------------------------------

export interface TwoViewReport {
  /** Unit vector the training cameras look along (principal axis of their viewing directions, sign folded to +z). */
  depthAxis: [number, number, number];
  /** Per part: rings (rows below the shoulder cap) and how many of them got a width from the masks on each side; the lateral scale applied (template width → mask width) over the rows. */
  parts: { name: string; rows: number; measuredPlus: number; measuredMinus: number; scale: { median: number; min: number; max: number } }[];
  note: string;
}

/** Smallest |lateral component| of a ray for its hull to give the silhouette's half-width (the ray then leaves the views' slab sideways). */
export const TWO_VIEW_LATERAL_MIN = 0.7;
/** Per side of a ring, how many of the most lateral rays give the lateral scale (median of their hull / template radius). */
export const TWO_VIEW_LATERAL_RAYS = 3;
/** Range of the lateral scale applied to a template ring. */
export const TWO_VIEW_SCALE: readonly [number, number] = [0.5, 2];

/**
 * Targets for the two-view fit (`depthPrior: 'template'`). Per ring (a row of a body, sleeve or leg
 * grid: rays square to one axis): the template point on every ray is split into a lateral offset (in
 * the views' image plane, square to the part's axis) and a depth offset (along the cameras' axis). The
 * width the masks show on each side comes from the hull of the rays that point sideways
 * (`TWO_VIEW_LATERAL_MIN`): seen from the front and the back, a sideways ray is carved where it leaves
 * the silhouette. The lateral scale per side is the median of hull / template radius over the
 * `TWO_VIEW_LATERAL_RAYS` rays closest to lateral (1.00 when the template is the garment); the
 * template's lateral offsets are scaled by it; rings without
 * such a ray (an arm beside the bodice, every ray capped) take the scale interpolated from the rings
 * above and below. Each ray's target is where it meets the scaled cross-section, bounded by its hull,
 * at full weight. Shoulder-cap rows (rays fanned from the joint) keep their hull where a view carves
 * it (the outline over the shoulder), else the template. Mutates `target` and `w`.
 */
function templateDepthTargets(a: {
  views: FitViews;
  parts: PartGrid[];
  rays: Ray[];
  isCap: Uint8Array;
  present: Uint8Array;
  blocked: Uint8Array;
  capped: Uint8Array;
  byControl: Uint8Array;
  hull: Float64Array;
  s0: Float64Array;
  tplS: Float64Array;
  lo: Float64Array;
  hi: Float64Array;
  target: Float64Array;
  w: Float64Array;
  mannequin: Mannequin;
}): TwoViewReport {
  const { parts, rays, isCap, present, blocked, capped, byControl, hull, lo, hi, target, w, mannequin: m } = a;
  // Template radius per ray. Where the ray misses the template (a garment longer than the predicted one, a
  // sleeve past the template's cuff), the template's cross-section continues: the radius of the nearest row
  // of the same column that has one, not the body-hugging fallback `s0` (which would pull the extra length
  // of a skirt onto the legs, front and back, where two views cannot see it).
  const s0 = Float64Array.from(a.s0);
  for (const p of parts) {
    const first = p.capRows ?? 0;
    for (let c = 0; c < p.cols; c++) {
      const col: number[] = [];
      for (let r = first; r < p.rows; r++) col.push(p.offset + r * p.cols + c);
      const known = col.filter((i) => Number.isFinite(a.tplS[i]!));
      if (!known.length) continue;
      let last = a.tplS[known[0]!]!;
      for (const i of col) {
        if (Number.isFinite(a.tplS[i]!)) last = a.tplS[i]!;
        else if (!blocked[i]) s0[i] = Math.min(hi[i]!, Math.max(lo[i]!, last));
      }
    }
  }
  // Depth axis: principal direction of the training cameras' optical axes (third row of R).
  const M = new Float64Array(9);
  for (const v of a.views.train) {
    const R = a.views.cameras[v]!.R;
    const f = [R[6]!, R[7]!, R[8]!];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[3 * i + j] = M[3 * i + j]! + f[i]! * f[j]!;
  }
  let D = [0.1, 0.2, 1];
  for (let it = 0; it < 60; it++) {
    const n = [0, 1, 2].map((i) => M[3 * i]! * D[0]! + M[3 * i + 1]! * D[1]! + M[3 * i + 2]! * D[2]!);
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    D = n.map((x) => x / l);
  }
  if (D[2]! < 0) D = D.map((x) => -x);
  const dot = (p: readonly number[], q: readonly number[]): number => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
  const median = (xs: number[]): number => {
    const q = [...xs].sort((x, y) => x - y);
    return q.length ? q[q.length >> 1]! : NaN;
  };
  const out: TwoViewReport['parts'] = [];
  for (const p of parts) {
    const axis: readonly number[] = p.name === 'sleeve_l' ? m.arms.left.axis : p.name === 'sleeve_r' ? m.arms.right.axis : [0, 1, 0];
    const dd = dot(D, axis);
    let Dp = [D[0]! - dd * axis[0]!, D[1]! - dd * axis[1]!, D[2]! - dd * axis[2]!];
    const ln = Math.hypot(Dp[0]!, Dp[1]!, Dp[2]!) || 1;
    Dp = Dp.map((x) => x / ln);
    const L = [axis[1]! * Dp[2]! - axis[2]! * Dp[1]!, axis[2]! * Dp[0]! - axis[0]! * Dp[2]!, axis[0]! * Dp[1]! - axis[1]! * Dp[0]!];
    const first = p.capRows ?? 0;
    const rows = p.rows - first;
    const kPlus = new Array<number>(rows).fill(NaN), kMinus = new Array<number>(rows).fill(NaN);
    const idx = (r: number, c: number): number => p.offset + (first + r) * p.cols + c;
    for (let r = 0; r < rows; r++) {
      // Per side: the rays closest to lateral, each as its own ratio hull / template radius. Not the median
      // half-width over every sideways ray against the template's widest point: under perspective the front
      // and back silhouettes' intersection is narrower away from the plane of their contour, so an oblique
      // ray leaves it early and that ratio read 3-4 % narrow with the truth as template (review F4).
      const sides: { r: number; dl: number }[][] = [[], []];
      for (let c = 0; c < p.cols; c++) {
        const i = idx(r, c);
        if (blocked[i]) continue;
        const dl = dot(rays[i]!.d, L);
        if (!present[i] || hull[i]! < 0 || capped[i] || Math.abs(dl) < TWO_VIEW_LATERAL_MIN || !(s0[i]! * Math.abs(dl) > 1)) continue;
        sides[dl > 0 ? 0 : 1]!.push({ r: hull[i]! / s0[i]!, dl: Math.abs(dl) });
      }
      const est = (q: { r: number; dl: number }[]): number => (q.length ? median([...q].sort((x, y) => y.dl - x.dl).slice(0, TWO_VIEW_LATERAL_RAYS).map((x) => x.r)) : NaN);
      kPlus[r] = est(sides[0]!);
      kMinus[r] = est(sides[1]!);
    }
    const fill = (k: number[]): { known: number; k: number[] } => {
      const known = k.map((x, r) => (Number.isFinite(x) ? r : -1)).filter((r) => r >= 0);
      if (!known.length) return { known: 0, k: k.map(() => 1) };
      return {
        known: known.length,
        k: k.map((x, r) => {
          if (Number.isFinite(x)) return x;
          let q0 = -1, q1 = -1;
          for (const q of known) {
            if (q < r) q0 = q;
            else if (q1 < 0) q1 = q;
          }
          if (q0 < 0) return k[q1]!;
          if (q1 < 0) return k[q0]!;
          return k[q0]! + ((k[q1]! - k[q0]!) * (r - q0)) / (q1 - q0);
        }),
      };
    };
    const clampK = (x: number): number => Math.min(TWO_VIEW_SCALE[1], Math.max(TWO_VIEW_SCALE[0], x));
    const fp = fill(kPlus), fm = fill(kMinus);
    const applied: number[] = [];
    for (let r = 0; r < rows; r++) {
      const k1 = clampK(fp.k[r]!), k2 = clampK(fm.k[r]!);
      applied.push(k1, k2);
      const pts: { phi: number; rho: number }[] = [];
      for (let c = 0; c < p.cols; c++) {
        const i = idx(r, c);
        if (blocked[i]) continue;
        const d = rays[i]!.d;
        const l = s0[i]! * dot(d, L), z = s0[i]! * dot(d, Dp);
        const ls = l * (l >= 0 ? k1 : k2);
        pts.push({ phi: Math.atan2(z, ls), rho: Math.hypot(ls, z) });
      }
      if (pts.length < 3) continue;
      pts.sort((x, y) => x.phi - y.phi);
      const rhoAt = (psi: number): number => {
        let j = pts.findIndex((q) => q.phi >= psi);
        if (j < 0) j = 0;
        const b = pts[j]!, aPt = pts[(j - 1 + pts.length) % pts.length]!;
        let span = b.phi - aPt.phi, off = psi - aPt.phi;
        if (span <= 0) span += 2 * Math.PI;
        if (off < 0) off += 2 * Math.PI;
        const t = Math.min(1, Math.max(0, off / span));
        return aPt.rho * (1 - t) + b.rho * t;
      };
      for (let c = 0; c < p.cols; c++) {
        const i = idx(r, c);
        if (!present[i] || byControl[i]) continue;
        const d = rays[i]!.d;
        let tgt = rhoAt(Math.atan2(dot(d, Dp), dot(d, L)));
        if (hull[i]! >= 0 && !capped[i]) tgt = Math.min(tgt, hull[i]!);
        target[i] = Math.min(hi[i]!, Math.max(lo[i]!, tgt));
        w[i] = 1;
      }
    }
    for (let k = 0; k < first * p.cols; k++) {
      const i = p.offset + k;
      if (!isCap[i] || !present[i] || byControl[i]) continue;
      if (hull[i]! < 0 || capped[i]) {
        target[i] = Math.min(hi[i]!, Math.max(lo[i]!, s0[i]!));
        w[i] = 1;
      }
    }
    const sorted = [...applied].sort((x, y) => x - y);
    out.push({ name: p.name, rows, measuredPlus: fp.known, measuredMinus: fm.known, scale: { median: round2(sorted[sorted.length >> 1] ?? 1), min: round2(sorted[0] ?? 1), max: round2(sorted[sorted.length - 1] ?? 1) } });
  }
  return { depthAxis: D.map((x) => Math.round(x * 1e4) / 1e4) as [number, number, number], parts: out, note: "per ring the template's cross-section is scaled along the lateral axis (image plane, square to the part's axis) to the half-width the masks show on each side; the depth is the template's" };
}
