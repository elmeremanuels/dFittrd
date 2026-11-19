/**
 * POM builder for a men's short-sleeved tee (men-3d-plan slice M3, the two-day tee proof): the flat
 * garment measurements a shop prints (chest width, length, shoulder, sleeve length, sleeve opening,
 * hem width; waist width when the shop has it) become ONE welded garment mesh on the canonical
 * mannequin: a front and a back panel sewn at the side seams and the shoulder seams, an armhole on
 * each side, and a set-in sleeve sewn into it whose cap follows the mannequin's arm.
 *
 * Construction (all in cm, mannequin space; no simulation):
 * - **Below the armhole** the torso is a tube of rows at constant height: the body's cross-section
 *   there (torso ellipse, and both legs below the crotch) as a convex hull, offset outwards so that
 *   its girth is the tape's: `2 × chest width` from the chest line (2.5 cm below the armhole) up to
 *   the armhole, `2 × waist width` at the waist ring when given, `2 × hem width` at the hem, straight
 *   lines in between, never closer than `minEaseCm` to the body.
 * - **Above the armhole** (the shoulders) the surface is found by marching rays from a point inside
 *   the chest at armhole height, outwards to where the distance to the body (torso plus the arm's cap
 *   on the torso side of the armhole) reaches the ease, which tapers from the chest's to `lidEaseCm`
 *   on the shoulders. This is what lets the cloth lie over the top of the shoulder, which rows of
 *   constant height cannot.
 * - **The armhole** is the cut of that surface by a plane through the armpit (the body's armpit less
 *   `armholeDropCm`) and the shoulder point (half the shoulder measurement out from the centre, on top
 *   of the shoulder), containing the front-back direction. Its two edges are the front and the back
 *   panel's side edges between the armpit and the shoulder point; above the shoulder point the two
 *   panels share their edge (the shoulder seam), below the armpit too (the side seam).
 * - **The sleeve** is lofted from the armhole's vertices (the same vertices, so it is sewn) to a hem
 *   at right angles to the arm axis whose girth is `2 × sleeve opening`, kept at least `capEaseCm`
 *   off the arm (its cone above the shoulder joint included) so the cap covers the deltoid.
 * - **Lengths** are solved, not assumed: the hem height so that the path down the front panel from
 *   the high point shoulder (HPS) is the tape's length, the sleeve so that the path along its top
 *   from the shoulder point is the tape's sleeve length.
 *
 * What is measured where is the definition `measurePomTee` checks (and the M3 gate, every input
 * within 0.5 cm): chest = tape girth at the chest line / 2; waist = tape girth at the waist ring / 2;
 * hem = girth of the hem edge / 2; shoulder = straight distance between the two shoulder points;
 * length = path down the front at the HPS's distance from the centre, HPS to hem; sleeve length =
 * path along the sleeve's top from the shoulder point to its hem; sleeve opening = girth of the
 * sleeve hem / 2. A flat-laid "across shoulder" is measured over the back and is longer than the
 * straight line on a body; how much longer is not measured here [M].
 *
 * Every number in `POM_TEE_ASSUMPTIONS` is an assumption [A], not measured on any garment.
 */
import { dot, polygonCompensation, sub, topology, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import { armpitDistance, ellipseRadius } from './garment';

/** A tee's flat measurements of one size, cm (widths are half girths, the garment laid flat). */
export interface PomTeeRow {
  size: string;
  /** Flat width 2.5 cm below the armhole. */
  chestWidthCm: number;
  /** Flat width at the waist; optional (many tee charts have none: the side seam is then straight). */
  waistWidthCm?: number;
  /** Flat width at the hem edge. */
  hemWidthCm: number;
  /** Shoulder point to shoulder point, straight. */
  shoulderCm: number;
  /** High point shoulder to hem, down the front. */
  lengthCm: number;
  /** Shoulder point to sleeve hem along the top of the sleeve. */
  sleeveLengthCm: number;
  /** Flat width of the sleeve hem (half its girth). */
  sleeveOpeningCm: number;
}

/** What the builder needs and no tee chart gives: all assumed [A]. Values for the base size; `perSize` steps by size. */
export const POM_TEE_ASSUMPTIONS = {
  /** The armhole's lowest point lies this far under the body's armpit. */
  armholeDropCm: 2,
  /** POM chest line under the armhole (the usual "1 inch below the armhole"). */
  chestLineBelowArmholeCm: 2.5,
  /** Neck opening, HPS to HPS straight, at the base size; plus `neckWidthPerSizeCm` per size step. */
  neckWidthCm: 17.5,
  neckWidthPerSizeCm: 0.5,
  /** Neck drops under the HPS, front and back (crew neck). */
  frontNeckDropCm: 9,
  frontNeckDropPerSizeCm: 0.25,
  backNeckDropCm: 2,
  /** Ease (distance off the body) on top of the shoulders. */
  lidEaseCm: 0.9,
  /** Least distance of the sleeve cap off the arm, and towards the hem. */
  capEaseCm: 1.1,
  sleeveHemEaseCm: 0.35,
  /** Least distance of the torso off the body anywhere (a tighter chart value is flagged). */
  minEaseCm: 0.5,
} as const;

export interface PomTeeOptions {
  /** Size steps from the base size (scales the neck assumptions). */
  sizeStep?: number;
  /** Columns per panel (front and back each), rows spacing, cm. */
  panelColumns?: number;
  rowStepCm?: number;
}

export interface PomTeeBuild {
  mesh: Mesh;
  row: PomTeeRow;
  /** Vertex ids: hem rim (2N), sleeve hems (left, right), shoulder points (left, right), HPS (left, right). */
  hem: number[];
  sleeveHem: [number[], number[]];
  /** The sleeve's top line, shoulder point to hem (left, right). */
  sleeveTop: [number[], number[]];
  shoulderPoint: [number, number];
  hps: [number, number];
  /** Heights used: armhole, chest line, hem; and the sleeve's end along each arm axis. */
  levels: { armholeY: number; chestLineY: number; hemY: number; shoulderPointY: number; hpsY: number; sleeveEndS: number };
  /** Places where the chart is tighter than `minEaseCm` off the base body (height, girth asked, girth built). */
  tight: { y: number; askedCm: number; builtCm: number }[];
}

type Arm = Mannequin['arms']['left'];
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Distance to the body (approximate, signed: negative inside)
// ---------------------------------------------------------------------------

/** Signed distance to an ellipse section (horizontal or across the arm), first order: radial gap × cos of normal angle. */
function sectionGap(dx: number, dz: number, a: number, b: number): number {
  const r = Math.hypot(dx, dz);
  if (r < 1e-9) return -Math.min(a, b);
  const phi = Math.atan2(dz, dx);
  const rho = ellipseRadius(a, b, phi);
  // Outward normal of the ellipse at the radial point.
  const px = rho * Math.cos(phi), pz = rho * Math.sin(phi);
  const nx = px / (a * a), nz = pz / (b * b);
  const cosB = (px * nx + pz * nz) / (rho * Math.hypot(nx, nz));
  return (r - rho) * cosB;
}

function torsoDistance(m: Mannequin, p: Vec3): number {
  const e = m.torsoAt(p[1]);
  if (!e) return Infinity;
  const g = sectionGap(p[0] - e.cx, p[2] - e.cz, e.a, e.b);
  const lo = m.torsoAt(p[1] - 0.5), hi = m.torsoAt(p[1] + 0.5);
  if (!lo || !hi) return g;
  const phi = Math.atan2(p[2] - e.cz, p[0] - e.cx);
  const slope = (ellipseRadius(hi.a, hi.b, phi) - ellipseRadius(lo.a, lo.b, phi)) / 1;
  return g / Math.sqrt(1 + slope * slope);
}

/** The arm's end used for distances: a little past the sleeve's longest reach. */
const ARM_REACH_CM = 45;

function armDistance(m: Mannequin, f: Arm, p: Vec3): number {
  const r = sub(p, f.joint);
  const s = dot(r, f.axis);
  const ru = dot(r, f.u), rv = dot(r, f.v);
  const a0 = m.armAt(0, f.side)!;
  const pole = (0.9 / 1.18) * a0.a;
  if (s >= 0) {
    const e = m.armAt(Math.min(s, ARM_REACH_CM), f.side);
    if (!e) return Infinity;
    const g = sectionGap(ru, rv, e.a, e.b);
    const e2 = m.armAt(Math.min(s + 0.5, ARM_REACH_CM), f.side) ?? e;
    const slope = (e2.a - e.a) / 0.5;
    return g / Math.sqrt(1 + slope * slope);
  }
  if (s <= -pole) return Math.hypot(ru, rv, s + pole);
  // The cone from the joint's section up to the pole (as the mannequin closes the arm).
  const k = 1 + s / pole;
  const g = sectionGap(ru, rv, a0.a * k, a0.b * k);
  const slope = a0.a / pole;
  return g / Math.sqrt(1 + slope * slope);
}

interface Plane {
  point: Vec3;
  normal: Vec3;
}
const planeDist = (pl: Plane, p: Vec3): number => dot(sub(p, pl.point), pl.normal);

// ---------------------------------------------------------------------------
// Below the armhole: offset convex hull of the body's cross-section
// ---------------------------------------------------------------------------

function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let k = p.length - 1; k >= 0; k--) { const q = p[k]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

const perimeter = (h: [number, number][]): number => h.reduce((s, a, i) => s + Math.hypot(h[(i + 1) % h.length]![0] - a[0], h[(i + 1) % h.length]![1] - a[1]), 0);

/** Convex hull (x, z) of the body at height y: torso and, where there are legs, both legs. */
function bodyHull(m: Mannequin, y: number): [number, number][] {
  const pts: [number, number][] = [];
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

/** Distance from (x, z) to a convex polygon (0 inside). */
function polyDistance(h: [number, number][], x: number, z: number): number {
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

/** Point on the hull offset by d along azimuth θ from the vertical axis (x = z = 0). */
function hullRay(h: [number, number][], d: number, theta: number): [number, number] {
  const c = Math.cos(theta), s = Math.sin(theta);
  let lo = 0, hi = 80;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (polyDistance(h, mid * c, mid * s) <= d) lo = mid;
    else hi = mid;
  }
  return [lo * c, lo * s];
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

export function buildPomTee(m: Mannequin, row: PomTeeRow, options: PomTeeOptions = {}): PomTeeBuild {
  const A = POM_TEE_ASSUMPTIONS;
  const step = options.sizeStep ?? 0;
  const N = options.panelColumns ?? 36;
  const rowStep = options.rowStepCm ?? 1.6;
  const L = m.arms.left, R = m.arms.right;
  const tight: PomTeeBuild['tight'] = [];

  // Armpit (the body's: where the arm's inner side leaves the torso) and the armhole's bottom.
  const s0 = armpitDistance(m);
  const e0 = m.armAt(s0, 1)!;
  const bodyArmpitY = L.joint[1] + L.axis[1] * s0 - e0.a * L.u[1];
  const yAh = bodyArmpitY - A.armholeDropCm;
  const yChest = yAh - A.chestLineBelowArmholeCm;
  const gChest = 2 * row.chestWidthCm;
  const gHem = 2 * row.hemWidthCm;
  const gWaist = row.waistWidthCm === undefined ? undefined : 2 * row.waistWidthCm;
  const yWaist = m.morphHeights.waist;

  /** Girth asked of the tube at height y (hem height given). */
  const girthAt = (y: number, yHem: number): number => {
    if (y >= yChest) return gChest;
    if (gWaist !== undefined && y >= yWaist) return lerp(gWaist, gChest, (y - yWaist) / (yChest - yWaist));
    if (gWaist !== undefined) return lerp(gHem, gWaist, (y - yHem) / (yWaist - yHem));
    return lerp(gHem, gChest, (y - yHem) / (yChest - yHem));
  };
  const tubeEase = (y: number, yHem: number, record = false): { h: [number, number][]; d: number } => {
    const h = bodyHull(m, y);
    const P = perimeter(h);
    const want = girthAt(y, yHem);
    let d = (want - P) / (2 * Math.PI);
    if (d < A.minEaseCm) {
      if (record) tight.push({ y: Math.round(y * 10) / 10, askedCm: Math.round(want * 10) / 10, builtCm: Math.round((P + 2 * Math.PI * A.minEaseCm) * 10) / 10 });
      d = A.minEaseCm;
    }
    return { h, d };
  };
  const dAh = tubeEase(yAh, yAh - 60).d;

  // Ease above the armhole: from the chest's at the armhole to the lid's on the shoulders.
  const shoulderY = m.morphHeights.shoulder;
  const fanEase = (y: number): number => lerp(dAh, A.lidEaseCm, smooth((y - yAh) / Math.max(1, shoulderY - 1 - yAh)));

  const fullDistance = (p: Vec3): number => Math.min(torsoDistance(m, p), armDistance(m, L, p), armDistance(m, R, p));

  // Shoulder point: on top of the shoulder at half the shoulder measurement (iterated below so the
  // fan surface crosses the armhole plane exactly there).
  const topAt = (x: number): number => {
    // First height from above where the distance to the body reaches the lid ease.
    for (let y = shoulderY + 15; y > yAh; y -= 0.05) if (fullDistance([x, y, 0]) <= A.lidEaseCm) return y;
    return shoulderY;
  };
  const xSpWant = row.shoulderCm / 2;
  // Torso width at the armhole (the tube's top row at the side).
  const tubeTop = tubeEase(yAh, yAh - 60);
  const xAh = hullRay(tubeTop.h, tubeTop.d, 0)[0];
  const O: Vec3 = [0, yAh, 0];

  let plane: Plane = { point: [xAh, yAh, 0], normal: [1, 0, 0] };
  let planeR: Plane = plane;
  let restricted = (p: Vec3): number => fullDistance(p);
  const setPlanes = (xSp: number): void => {
    const ySp = topAt(xSp);
    const dx = xSp - xAh, dy = ySp - yAh;
    const len = Math.hypot(dx, dy);
    plane = { point: [xAh, yAh, 0], normal: [dy / len, -dx / len, 0] };
    planeR = { point: [-xAh, yAh, 0], normal: [-dy / len, -dx / len, 0] };
    restricted = (p: Vec3): number => Math.min(torsoDistance(m, p), Math.max(armDistance(m, L, p), planeDist(plane, p)), Math.max(armDistance(m, R, p), planeDist(planeR, p)));
  };
  /** Surface point of the shoulders along the ray at azimuth θ (0 = +x, π/2 = +z front) and elevation α. */
  const fanPoint = (theta: number, alpha: number): Vec3 => {
    const dir: Vec3 = [Math.cos(alpha) * Math.cos(theta), Math.sin(alpha), Math.cos(alpha) * Math.sin(theta)];
    const at = (t: number): Vec3 => [O[0] + dir[0] * t, O[1] + dir[1] * t, O[2] + dir[2] * t];
    const g = (t: number): number => {
      const p = at(t);
      return restricted(p) - fanEase(p[1]);
    };
    let t = 0.5;
    while (t < 60 && g(t) <= 0) t += 0.1;
    let lo = t - 0.1, hi = t;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (g(mid) <= 0) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2);
  };

  // The shoulder point is on top of the shoulder at half the shoulder measurement; the armhole plane
  // goes through it and the armpit.
  setPlanes(xSpWant);
  const sp: Vec3 = [xSpWant, topAt(xSpWant), 0];
  const elevation = (p: Vec3): number => Math.atan2(p[1] - O[1], Math.hypot(p[0] - O[0], p[2] - O[2]));
  const alphaSp = elevation(sp);

  // HPS: on the edge column where the surface is half the neck width out.
  const neckHalf = (A.neckWidthCm + A.neckWidthPerSizeCm * step) / 2;
  // March up the edge column from the shoulder point to the first ray whose surface is inside the
  // neck width (steeper rays reach the head, which is wider than the neck again).
  let lo = alphaSp, hi = alphaSp;
  for (let a = alphaSp; a < Math.PI / 2 - 0.02; a += 0.005) {
    if (fanPoint(0, a)[0] <= neckHalf) { hi = a; break; }
    lo = a;
  }
  if (hi === alphaSp) throw new Error('pomTee: the neck is wider than the neck opening');
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (fanPoint(0, mid)[0] > neckHalf) lo = mid;
    else hi = mid;
  }
  const alphaHps = (lo + hi) / 2;
  const hpsPoint = fanPoint(0, alphaHps);
  const yHps = hpsPoint[1];

  // Neckline: a point per azimuth θ on the column surface where y = yHps − drop·√(1 − (x / neckHalf)²).
  const dropF = A.frontNeckDropCm + A.frontNeckDropPerSizeCm * step;
  const dropB = A.backNeckDropCm;
  const alphaTopTable = (front: boolean): Float64Array => {
    const out = new Float64Array(181);
    for (let k = 0; k <= 180; k++) {
      const th = ((front ? 1 : -1) * Math.PI * k) / 180;
      const drop = front ? dropF : dropB;
      const h = (a: number): number => {
        const p = fanPoint(th, a);
        const x = Math.abs(p[0]);
        return p[1] - (yHps - drop * Math.sqrt(Math.max(0, 1 - (x / neckHalf) ** 2)));
      };
      let a0 = 0.02, a1 = Math.PI / 2 - 0.02;
      if (k === 0 || k === 180) {
        out[k] = alphaHps;
        continue;
      }
      for (let it = 0; it < 32; it++) {
        const mid = (a0 + a1) / 2;
        if (h(mid) < 0) a0 = mid;
        else a1 = mid;
      }
      out[k] = (a0 + a1) / 2;
    }
    return out;
  };
  const topFront = alphaTopTable(true);
  const topBack = alphaTopTable(false);
  const alphaTop = (theta: number, front: boolean): number => {
    const f = (Math.abs(theta) / Math.PI) * 180;
    const k = Math.min(179, Math.floor(f));
    const t = f - k;
    const tab = front ? topFront : topBack;
    return tab[k]! * (1 - t) + tab[k + 1]! * t;
  };

  // The armhole: an ellipse in the armhole plane from the armpit to the shoulder point (its long
  // axis), wide enough front to back to hold the arm's section in that plane with `capEaseCm` to spare.
  const ah: Vec3 = [xAh, yAh, 0];
  const lineDir: Vec3 = [(sp[0] - xAh), (sp[1] - yAh), 0];
  const Lq = Math.hypot(lineDir[0], lineDir[1]);
  lineDir[0] /= Lq;
  lineDir[1] /= Lq;
  let zMax = 0;
  {
    const a0 = m.armAt(0, 1)!;
    const pole = (0.9 / 1.18) * a0.a;
    for (let s = -pole; s < 25; s += 0.1) {
      const e = s >= 0 ? m.armAt(s, 1)! : { a: a0.a * (1 + s / pole), b: a0.b * (1 + s / pole) };
      if (!(e.a > 1e-3)) continue;
      for (let k = 0; k < 180; k++) {
        const phi = (2 * Math.PI * k) / 180;
        const rr = ellipseRadius(e.a, e.b, phi);
        const pt: Vec3 = [0, 1, 2].map((d) => L.joint[d]! + L.axis[d]! * s + rr * (Math.cos(phi) * L.u[d]! + Math.sin(phi) * L.v[d]!)) as Vec3;
        if (!(Math.abs(planeDist(plane, pt)) <= 0.12)) continue;
        const q = (pt[0] - xAh) * lineDir[0] + (pt[1] - yAh) * lineDir[1];
        const u = (2 * q) / Lq - 1;
        if (Math.abs(u) >= 0.97) continue;
        zMax = Math.max(zMax, (Math.abs(pt[2]) + A.capEaseCm) / Math.sqrt(1 - u * u));
      }
    }
  }
  /** Point on the armhole at angle β (π = armpit, 0 = shoulder point), front (z > 0) or back. */
  const eyePoint = (beta: number, front: boolean): Vec3 => {
    const q = (Lq / 2) * (1 + Math.cos(beta));
    return [xAh + lineDir[0] * q, yAh + lineDir[1] * q, (front ? 1 : -1) * zMax * Math.sin(beta)];
  };
  const eyeCirc = Math.PI * (3 * (Lq / 2 + zMax) - Math.sqrt((3 * (Lq / 2) + zMax) * (Lq / 2 + 3 * zMax)));
  const eyeRows = Math.max(6, Math.round(eyeCirc / 2 / rowStep));
  const SAMPLES = 120;
  const byLength = (len: number[], as: number[], n: number): number[] => {
    const out: number[] = [];
    const total = len[len.length - 1]!;
    let j = 0;
    for (let i = 0; i <= n; i++) {
      const want = (total * i) / n;
      while (j < len.length - 2 && len[j + 1]! < want) j++;
      const t = (want - len[j]!) / Math.max(1e-9, len[j + 1]! - len[j]!);
      out.push(lerp(as[j]!, as[j + 1]!, clamp01(t)));
    }
    return out;
  };
  const eyeB: number[] = [], eyeLen: number[] = [0];
  for (let k = 0; k <= SAMPLES; k++) {
    eyeB.push(Math.PI * (1 - k / SAMPLES));
    if (k > 0) {
      const p = eyePoint(eyeB[k]!, true), q = eyePoint(eyeB[k - 1]!, true);
      eyeLen.push(eyeLen[k - 1]! + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
  }
  const eyeBetas = byLength(eyeLen, eyeB, eyeRows);
  const seamA: number[] = [], seamLen: number[] = [0];
  for (let k = 0; k <= SAMPLES; k++) {
    const a = alphaSp + ((alphaHps - alphaSp) * k) / SAMPLES;
    seamA.push(a);
    if (k > 0) {
      const p = k === 1 ? sp : fanPoint(0, seamA[k - 1]!), q = fanPoint(0, a);
      seamLen.push(seamLen[k - 1]! + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
  }
  const seamRows = Math.max(3, Math.round(seamLen[SAMPLES]! / rowStep));
  const seamAlphas = byLength(seamLen, seamA, seamRows).slice(1);
  /** Fan rows: left-side edge vertex front and back (equal outside the armhole) and its elevation; row 0 is the armpit. */
  const fanRows: { front: Vec3; back: Vec3; alpha: number }[] = [];
  for (const beta of eyeBetas) {
    const f = beta >= Math.PI - 1e-9 ? ah : beta <= 1e-9 ? sp : eyePoint(beta, true);
    const bk = beta >= Math.PI - 1e-9 ? ah : beta <= 1e-9 ? sp : eyePoint(beta, false);
    fanRows.push({ front: f, back: bk, alpha: elevation(f) });
  }
  for (const a of seamAlphas) {
    const p = fanPoint(0, a);
    fanRows.push({ front: p, back: p, alpha: a });
  }
  const iSp = eyeRows;
  if (process.env.POM_DEBUG) console.log("eye", { Lq, zMax, eyeCirc, eyeRows, fanRows: fanRows.length, sp, xAh, yAh });

  // ---- solve the hem height for the length, build the tube rows ------------------------------------
  const lengthOf = (mesh: Mesh): number => frontLength(mesh, neckHalf, hpsPoint);
  let yHem = yHps - row.lengthCm;
  let build: { mesh: Mesh; meta: Omit<PomTeeBuild, 'mesh' | 'row' | 'tight' | 'levels'>; sleeveEndS: number } | null = null;
  for (let it = 0; it < 4; it++) {
    tight.length = 0;
    build = assemble(yHem);
    const got = lengthOf(build.mesh);
    if (Math.abs(got - row.lengthCm) < 0.02) break;
    yHem -= row.lengthCm - got;
  }

  function assemble(yHemNow: number): NonNullable<typeof build> {
    const required = [yChest, yWaist, m.morphHeights.hip, m.morphHeights.chest].filter((y) => y > yHemNow + 0.5 && y < yAh - 0.5);
    // Ascending heights from the hem to the armhole (inclusive).
    const ys = rowsBetween(yHemNow, yAh, rowStep, required);
    const pos: number[] = [];
    const part: number[] = [];
    const add = (p: Vec3, pt: number): number => {
      pos.push(p[0], p[1], p[2]);
      part.push(pt);
      return pos.length / 3 - 1;
    };
    const nTube = ys.length; // last tube row = fan row 0
    const nRows = nTube + fanRows.length - 1;
    const front: number[][] = [], back: number[][] = [];
    // Tube rows: full rings; front columns θ = cπ/N, back θ = −cπ/N, sharing c = 0 and c = N.
    for (let r = 0; r < nTube; r++) {
      const y = ys[r]!;
      const { h, d } = tubeEase(y, yHemNow, true);
      const fr: number[] = [], bk: number[] = [];
      for (let c = 0; c <= N; c++) {
        const th = (Math.PI * c) / N;
        const [x, z] = hullRay(h, d, th);
        fr.push(add([x, y, z], 0));
      }
      for (let c = 0; c <= N; c++) {
        if (c === 0 || c === N) { bk.push(fr[c]!); continue; }
        const th = -(Math.PI * c) / N;
        const [x, z] = hullRay(h, d, th);
        bk.push(add([x, y, z], 0));
      }
      front.push(fr);
      back.push(bk);
    }
    // Fan rows 1…: between the left and the right edge vertex; interior columns by azimuth and a share of the neckline's elevation.
    const mirror = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
    for (let i = 1; i < fanRows.length; i++) {
      const { front: ef, back: eb, alpha: ae } = fanRows[i]!;
      const inEye = i < iSp;
      const wF = Math.atan2(ef[2], ef[0]);
      const wB = -Math.atan2(eb[2], eb[0]);
      const last = i === fanRows.length - 1;
      const t = last ? 1 : ae / alphaHps;
      const fr: number[] = [], bk: number[] = [];
      for (let c = 0; c <= N; c++) {
        if (c === 0) { fr.push(add(ef, 0)); continue; }
        if (c === N) { fr.push(add(mirror(ef), 0)); continue; }
        const th = wF + ((Math.PI - 2 * wF) * c) / N;
        fr.push(add(fanPoint(th, t * alphaTop(th, true)), 0));
      }
      for (let c = 0; c <= N; c++) {
        if (!inEye && (c === 0 || c === N)) { bk.push(fr[c]!); continue; }
        if (c === 0) { bk.push(add(eb, 0)); continue; }
        if (c === N) { bk.push(add(mirror(eb), 0)); continue; }
        const th = -(wB + ((Math.PI - 2 * wB) * c) / N);
        bk.push(add(fanPoint(th, t * alphaTop(th, false)), 0));
      }
      front.push(fr);
      back.push(bk);
    }
    // The top row's interior columns lie on the neckline (t = 1); its edge columns are the HPS.
    const tris: number[] = [];
    const quad = (a: number, b: number, c: number, d: number): void => {
      tris.push(a, b, c, a, c, d);
    };
    for (const grid of [front, back]) for (let r = 0; r + 1 < nRows; r++) for (let c = 0; c < N; c++) quad(grid[r]![c]!, grid[r]![c + 1]!, grid[r + 1]![c + 1]!, grid[r + 1]![c]!);

    // Sleeves: ring 0 is the armhole (front edge up, back edge down).
    const sleeveHem: [number[], number[]] = [[], []];
    const sleeveTop: [number[], number[]] = [[], []];
    let sleeveEndS = 0;
    for (const [k, f] of [[0, L], [1, R]] as const) {
      const col = k === 0 ? 0 : N;
      const loop: number[] = [];
      for (let i = 0; i <= iSp; i++) loop.push(front[nTube - 1 + i]![col]!);
      for (let i = iSp - 1; i >= 1; i--) loop.push(back[nTube - 1 + i]![col]!);
      const K = loop.length;
      const P = (i: number): Vec3 => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!];
      const frame = loop.map((i) => {
        const r = sub(P(i), f.joint);
        const s = dot(r, f.axis);
        const ru = dot(r, f.u), rv = dot(r, f.v);
        return { s, phi: Math.atan2(rv, ru), r: Math.hypot(ru, rv) };
      });
      const topK = iSp; // the shoulder point's place in the loop
      const a0 = m.armAt(0, f.side)!;
      const pole = (0.9 / 1.18) * a0.a;
      const armR = (s: number, phi: number): number => {
        if (s >= 0) {
          const e = m.armAt(Math.min(s, ARM_REACH_CM), f.side)!;
          return ellipseRadius(e.a, e.b, phi);
        }
        return ellipseRadius(a0.a, a0.b, phi) * Math.max(0, 1 + s / pole);
      };
      const ringAt = (sEnd: number): { pts: Vec3[][]; hemR: number[] } => {
        const eEnd = m.armAt(sEnd, f.side)!;
        // The hem: an ellipse of the arm's aspect whose polygon over the loop's angles has girth 2 × opening.
        const aspect = eEnd.b / eEnd.a;
        const want = 2 * row.sleeveOpeningCm;
        const raw = frame.map((q) => ellipseRadius(1, aspect, q.phi));
        let per = 0;
        for (let j = 0; j < K; j++) {
          const p = frame[j]!, q = frame[(j + 1) % K]!;
          per += Math.hypot(raw[j]! * Math.cos(p.phi) - raw[(j + 1) % K]! * Math.cos(q.phi), raw[j]! * Math.sin(p.phi) - raw[(j + 1) % K]! * Math.sin(q.phi));
        }
        const hemR = raw.map((x) => (x * want) / per);
        const J = Math.max(6, Math.ceil((sEnd - frame[topK]!.s) / rowStep));
        const pts: Vec3[][] = [];
        for (let j = 1; j <= J; j++) {
          const t = j / J;
          const ring: Vec3[] = frame.map((q, kk) => {
            const s = lerp(q.s, sEnd, t);
            let r = lerp(q.r, hemR[kk]!, t);
            if (j < J) {
              const ease = lerp(A.capEaseCm, A.sleeveHemEaseCm, smooth((s - s0) / Math.max(1, sEnd - s0)));
              const floor = armR(s, q.phi) + ease;
              // Smooth maximum, so the cap rounds over the deltoid instead of creasing.
              const k2 = 0.6;
              r = 0.5 * (r + floor + Math.sqrt((r - floor) ** 2 + k2 * k2));
              // Back to the straight line within the last two rings.
              if (j >= J - 1) r = lerp(r, lerp(q.r, hemR[kk]!, t), 0.5);
            }
            const cu = Math.cos(q.phi) * r, cv = Math.sin(q.phi) * r;
            return [f.joint[0] + f.axis[0] * s + f.u[0] * cu + f.v[0] * cv, f.joint[1] + f.axis[1] * s + f.u[1] * cu + f.v[1] * cv, f.joint[2] + f.axis[2] * s + f.u[2] * cu + f.v[2] * cv];
          });
          pts.push(ring);
        }
        return { pts, hemR };
      };
      const topLength = (sEnd: number): number => {
        const { pts } = ringAt(sEnd);
        let len = 0;
        let prev = P(loop[topK]!);
        for (const ring of pts) {
          const q = ring[topK]!;
          len += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
          prev = q;
        }
        return len;
      };
      let sA = frame[topK]!.s + 4, sB = frame[topK]!.s + 45;
      for (let it = 0; it < 40; it++) {
        const mid = (sA + sB) / 2;
        if (topLength(mid) < row.sleeveLengthCm) sA = mid;
        else sB = mid;
      }
      const sEnd = (sA + sB) / 2;
      sleeveEndS = sEnd;
      const { pts } = ringAt(sEnd);
      let prevRing = loop;
      sleeveTop[k] = [loop[topK]!];
      for (const ring of pts) {
        const ids = ring.map((p) => add(p, k + 1));
        sleeveTop[k].push(ids[topK]!);
        for (let j = 0; j < K; j++) quad(prevRing[j]!, prevRing[(j + 1) % K]!, ids[(j + 1) % K]!, ids[j]!);
        prevRing = ids;
      }
      sleeveHem[k] = prevRing;
    }
    const mesh: Mesh = { positions: Float64Array.from(pos), indices: Uint32Array.from(orientOutward(Float64Array.from(pos), tris, m)), vertexPart: Uint8Array.from(part), partNames: ['body', 'sleeve_l', 'sleeve_r'] };
    return {
      mesh,
      sleeveEndS,
      meta: {
        hem: [...front[0]!, ...back[0]!.slice(1, N)],
        sleeveHem,
        sleeveTop,
        shoulderPoint: [front[nTube - 1 + iSp]![0]!, front[nTube - 1 + iSp]![N]!],
        hps: [front[nRows - 1]![0]!, front[nRows - 1]![N]!],
      },
    };
  }

  const b = build!;
  return {
    mesh: b.mesh,
    row,
    ...b.meta,
    levels: { armholeY: yAh, chestLineY: yChest, hemY: yHem, shoulderPointY: sp[1], hpsY: yHps, sleeveEndS: b.sleeveEndS },
    tight: dedupeTight(tight),
  };
}

function dedupeTight(t: PomTeeBuild['tight']): PomTeeBuild['tight'] {
  const seen = new Set<number>();
  return t.filter((x) => (seen.has(x.y) ? false : (seen.add(x.y), true)));
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

/**
 * Consistent winding over the welded mesh (neighbouring triangles run a shared edge in opposite
 * directions), then flipped as a whole when the torso faces inwards.
 */
function orientOutward(pos: Float64Array, tris: number[], m: Mannequin): number[] {
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
  for (let seed = 0; seed < T; seed++) {
    if (done[seed]) continue;
    done[seed] = 1;
    const stack = [seed];
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
  }
  // Outward: the torso's triangles at chest height face away from the vertical axis.
  let score = 0;
  const yc = m.morphHeights.chest;
  for (let t = 0; t < T; t++) {
    const P = (i: number): Vec3 => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!];
    const a = P(tris[3 * t]!), b = P(tris[3 * t + 1]!), c = P(tris[3 * t + 2]!);
    if (Math.abs(a[1] - yc) > 3) continue;
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])];
    score += n[0]! * a[0] + n[1]! * a[2];
  }
  if (score < 0) for (let t = 0; t < T; t++) {
    const tmp = tris[3 * t + 1]!;
    tris[3 * t + 1] = tris[3 * t + 2]!;
    tris[3 * t + 2] = tmp;
  }
  return tris;
}

// ---------------------------------------------------------------------------
// Tape: what the shop's measurements are on the built mesh
// ---------------------------------------------------------------------------

/** Segments of the mesh cut by the plane x = x0, as 3D point pairs. */
function sliceX(mesh: Pick<Mesh, 'positions' | 'indices'>, x0: number): [Vec3, Vec3][] {
  const p = mesh.positions;
  const out: [Vec3, Vec3][] = [];
  const P = (i: number): Vec3 => [p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [P(mesh.indices[t]!), P(mesh.indices[t + 1]!), P(mesh.indices[t + 2]!)];
    const pts: Vec3[] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e]!, b = v[(e + 1) % 3]!;
      const da = a[0] - x0, db = b[0] - x0;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const s = da / (da - db);
        pts.push([x0, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
      }
    }
    if (pts.length === 2) out.push([pts[0]!, pts[1]!]);
  }
  return out;
}

/**
 * Length down the front: the cloth cut by the plane through the HPS (x = its distance from the
 * centre), the longest connected piece on the front (z ≥ 0), plus the step from the HPS to its top.
 */
export function frontLength(mesh: Pick<Mesh, 'positions' | 'indices'>, xHps: number, hps: Vec3): number {
  const segs = sliceX(mesh, xHps - 1e-3).filter(([a, b]) => a[2] >= 0 && b[2] >= 0);
  const key = (p: Vec3): string => `${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
  const ends = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) (ends.get(key(p)) ?? ends.set(key(p), []).get(key(p))!).push(i);
  });
  const used = new Uint8Array(segs.length);
  let best = 0, bestTop: Vec3 | null = null;
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    // Flood the piece, summing lengths and keeping its highest point.
    let len = 0;
    let top: Vec3 = segs[s0]![0];
    const stack = [s0];
    used[s0] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const [a, b] = segs[i]!;
      len += Math.hypot(a[1] - b[1], a[2] - b[2]);
      for (const p of [a, b]) {
        if (p[1] > top[1]) top = p;
        for (const j of ends.get(key(p)) ?? []) if (!used[j]) { used[j] = 1; stack.push(j); }
      }
    }
    if (len > best) { best = len; bestTop = top; }
  }
  return bestTop ? best + Math.hypot(hps[1] - bestTop[1], hps[2] - bestTop[2]) : 0;
}

const loopGirth = (mesh: Pick<Mesh, 'positions'>, ids: readonly number[], drop: (p: Vec3) => [number, number]): number => {
  const pts = ids.map((i) => drop([mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!]));
  return perimeter(hull2(pts));
};

/** The tee's own tape: every input measurement taken on the built mesh, as a `PomTeeRow`. */
export function measurePomTee(m: Mannequin, b: Omit<PomTeeBuild, 'row'>, tapeGirthAt: (mesh: Mesh, y: number) => number | null): PomTeeRow {
  const { mesh } = b;
  const P = (i: number): Vec3 => [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
  const chest = tapeGirthAt(mesh, b.levels.chestLineY);
  const waist = tapeGirthAt(mesh, m.morphHeights.waist);
  const hem = loopGirth(mesh, b.hem, (p) => [p[0], p[2]]);
  const [spL, spR] = [P(b.shoulderPoint[0]), P(b.shoulderPoint[1])];
  const shoulder = Math.hypot(spL[0] - spR[0], spL[1] - spR[1], spL[2] - spR[2]);
  const hps = P(b.hps[0]);
  const length = frontLength(mesh, hps[0], hps);
  const arm = m.arms.left;
  const sleeveRing = b.sleeveHem[0];
  const opening = loopGirth(mesh, sleeveRing, (p) => {
    const r = sub(p, arm.joint);
    return [dot(r, arm.u), dot(r, arm.v)];
  }) / 2;
  // Along the sleeve's top: the vertices of the shoulder point's column, ring by ring.
  let sleeveLength = 0;
  for (let k = 1; k < b.sleeveTop[0].length; k++) {
    const p = P(b.sleeveTop[0][k - 1]!), q = P(b.sleeveTop[0][k]!);
    sleeveLength += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  }
  return {
    size: '',
    chestWidthCm: (chest ?? NaN) / 2,
    ...(waist !== null ? { waistWidthCm: waist / 2 } : {}),
    hemWidthCm: hem / 2,
    shoulderCm: shoulder,
    lengthCm: length,
    sleeveLengthCm: sleeveLength,
    sleeveOpeningCm: opening,
  };
}

export { polygonCompensation, topology };
