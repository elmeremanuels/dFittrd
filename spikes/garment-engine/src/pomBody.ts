/**
 * The drawn body for the POM builder where the body's sections are not ellipses (the male shape v2,
 * `Mannequin.outlines`): its polar outlines tabulated every quarter centimetre, and on them the same
 * questions `pomTee.ts` asks of the ellipses of a v1 body: the signed distance to the torso and to an
 * arm, the hull of the body at one height, where the arm leaves the torso, and an arm's surface.
 *
 * On a v2 body `torsoAt`, `legAt` and `armAt` return an ellipse that CONTAINS the section: 4 to 13 cm
 * more girth than the drawn body (measured on the table bodies), symmetric front to back although the
 * seat lies behind. Built on those, the tee's hem came out 2.7 to 3.3 cm too wide and the XL and XXL
 * waist up to 1.1 cm (men-tee-v2 report); built on the outlines it is built on the body that is drawn.
 */
import { POLAR_N, dot, sub, type Mannequin, type MannequinOutlines, type PolarSection, type Side, type Vec3 } from '@curtain/mannequin';

type Arm = Mannequin['arms']['left'];

const STEP_CM = 0.25;
const TWO_PI = 2 * Math.PI;
const STRIDE = POLAR_N + 3;

interface Tab {
  lo: number;
  rows: number;
  data: Float64Array;
}

function tabulate(lo: number, hi: number, at: (x: number) => PolarSection | null): Tab {
  const rows = Math.ceil((hi - lo) / STEP_CM) + 1;
  const data = new Float64Array(rows * STRIDE);
  for (let k = 0; k < rows; k++) {
    const o = at(lo + k * STEP_CM);
    if (!o) continue;
    data[k * STRIDE] = 1;
    data[k * STRIDE + 1] = o.cx;
    data[k * STRIDE + 2] = o.cz;
    data.set(o.r, k * STRIDE + 3);
  }
  return { lo, rows, data };
}

/** Scratch: centre x, centre z, radius, d(radius)/d(angle). */
const S = new Float64Array(4);

/** The outline at coordinate x towards the point (px, pz) into `S`; false outside the table. */
function sample(t: Tab, x: number, px: number, pz: number): boolean {
  const f = (x - t.lo) / STEP_CM;
  const k = Math.floor(f);
  if (k < 0 || k >= t.rows - 1) return false;
  const i0 = k * STRIDE, i1 = i0 + STRIDE;
  const d = t.data;
  if (d[i0] === 0 || d[i1] === 0) return false;
  const w = f - k;
  const cx = d[i0 + 1]! * (1 - w) + d[i1 + 1]! * w;
  const cz = d[i0 + 2]! * (1 - w) + d[i1 + 2]! * w;
  let a = (Math.atan2(pz - cz, px - cx) / TWO_PI) * POLAR_N;
  if (a < 0) a += POLAR_N;
  const j = Math.floor(a) % POLAR_N, j1 = (j + 1) % POLAR_N;
  const wa = a - Math.floor(a);
  const r0 = d[i0 + 3 + j]! * (1 - w) + d[i1 + 3 + j]! * w;
  const r1 = d[i0 + 3 + j1]! * (1 - w) + d[i1 + 3 + j1]! * w;
  S[0] = cx;
  S[1] = cz;
  S[2] = r0 * (1 - wa) + r1 * wa;
  S[3] = (r1 - r0) / (TWO_PI / POLAR_N);
  return true;
}

export interface PomBody {
  /** Signed distance to the torso (negative inside), cm; Infinity outside its heights. */
  torsoDistance(p: Vec3): number;
  /** Signed distance to an arm, its cap above the shoulder joint included. */
  armDistance(f: Arm, p: Vec3): number;
  /** The body's section at height y as points (x, z): the torso and, where there are legs, both legs. */
  sectionPoints(y: number): [number, number][];
  /** Height of the armpit: where the arm's inner side leaves the torso. */
  armpitY: number;
  /** Distance along the arm axis of that point. */
  armpitS: number;
  /** The arm's surface at distance s along the axis and angle φ about it, as a world point, or null where there is no arm. */
  armPoint(f: Arm, s: number, phi: number): Vec3 | null;
  /** The arm's radius from its AXIS along angle φ at distance s (0 where there is none). */
  armRadius(f: Arm, s: number, phi: number): number;
  /** Where the arm's cap starts along the axis (negative: above the shoulder joint). */
  armTopS: number;
}

const cache = new WeakMap<Mannequin, PomBody>();

/** The outline reader of a body with drawn outlines; null for every other body (the builder then uses its ellipses). */
export function pomBody(m: Mannequin): PomBody | null {
  const o = m.outlines;
  if (!o) return null;
  let hit = cache.get(m);
  if (!hit) cache.set(m, (hit = build(m, o)));
  return hit;
}

function build(m: Mannequin, o: MannequinOutlines): PomBody {
  const torso = tabulate(0, m.statureCm, (y) => o.torso(y));
  const legs: Record<Side, Tab> = { 1: tabulate(0, 0.6 * m.statureCm, (y) => o.leg(y, 1)), [-1]: tabulate(0, 0.6 * m.statureCm, (y) => o.leg(y, -1)) } as Record<Side, Tab>;
  const ARM_LO = -8, ARM_HI = 46;
  const arms: Record<Side, Tab> = { 1: tabulate(ARM_LO, ARM_HI, (s) => o.arm(s, 1)), [-1]: tabulate(ARM_LO, ARM_HI, (s) => o.arm(s, -1)) } as Record<Side, Tab>;
  let armTopS = 0;
  for (let s = ARM_LO; s < 0; s += STEP_CM) if (o.arm(s, 1)) { armTopS = s; break; }
  armTopS = Math.ceil(armTopS / STEP_CM) * STEP_CM;

  /** Radial gap × cos of the angle between the radius and the outline's normal (first order, as `sectionGap`). */
  const gap = (t: Tab, x: number, px: number, pz: number): number | null => {
    if (!sample(t, x, px, pz)) return null;
    const r = Math.hypot(px - S[0]!, pz - S[1]!);
    const R = S[2]!;
    return ((r - R) * R) / Math.hypot(R, S[3]!);
  };
  /** d(radius)/d(coordinate) along the direction of (px, pz), over half a centimetre. */
  const slope = (t: Tab, x: number, px: number, pz: number): number => {
    if (!sample(t, x - 0.25, px, pz)) return 0;
    const lo = S[2]!;
    if (!sample(t, x + 0.25, px, pz)) return 0;
    return (S[2]! - lo) / 0.5;
  };

  const armFrame = (f: Arm, p: Vec3): [number, number, number] => {
    const r = sub(p, f.joint);
    return [dot(r, f.axis), dot(r, f.u), dot(r, f.v)];
  };
  const armRadius = (f: Arm, s: number, phi: number): number => {
    const t = arms[f.side];
    const c = Math.cos(phi), sn = Math.sin(phi);
    // The outline is polar about its own centre: walk out along φ from the axis to where it is crossed.
    let rho = 0;
    if (!sample(t, s, 100 * c, 100 * sn)) return 0;
    rho = S[2]!;
    for (let it = 0; it < 8; it++) {
      if (!sample(t, s, rho * c, rho * sn)) return 0;
      const d = Math.hypot(rho * c - S[0]!, rho * sn - S[1]!) - S[2]!;
      if (Math.abs(d) < 1e-4) break;
      rho = Math.max(0, rho - d);
    }
    return rho;
  };

  // Armpit: the first station down the arm where its inner side (towards the body, −u) stands clear of the torso.
  const L = m.arms.left;
  let armpitS = L.upperArmCm;
  for (let s = 0; s < L.upperArmCm; s += 0.25) {
    const rIn = armRadius(L, s, Math.PI);
    const inner: Vec3 = [L.joint[0] + L.axis[0] * s - L.u[0] * rIn, L.joint[1] + L.axis[1] * s - L.u[1] * rIn, L.joint[2] + L.axis[2] * s - L.u[2] * rIn];
    const g = gap(torso, inner[1], inner[0], inner[2]);
    if (g === null || g > 0.5) { armpitS = s; break; }
  }
  const rPit = armRadius(L, armpitS, Math.PI);
  const armpitY = L.joint[1] + L.axis[1] * armpitS - L.u[1] * rPit;

  return {
    torsoDistance(p) {
      const g = gap(torso, p[1], p[0], p[2]);
      if (g === null) return Infinity;
      const sl = slope(torso, p[1], p[0], p[2]);
      return g / Math.sqrt(1 + sl * sl);
    },
    armDistance(f, p) {
      const [s, ru, rv] = armFrame(f, p);
      const t = arms[f.side];
      if (s < armTopS) {
        // Above the cap: the distance to its top point.
        sample(t, armTopS, 0, 0);
        return Math.hypot(ru - S[0]!, rv - S[1]!, s - armTopS);
      }
      const sc = Math.min(s, ARM_HI - 1);
      const g = gap(t, sc, ru, rv);
      if (g === null) return Infinity;
      const sl = slope(t, Math.max(armTopS + 0.25, sc), ru, rv);
      return g / Math.sqrt(1 + sl * sl);
    },
    sectionPoints(y) {
      const pts: [number, number][] = [];
      for (const t of [torso, legs[1], legs[-1]]) {
        if (!sample(t, y, 1e6, 0)) continue;
        const f = (y - t.lo) / STEP_CM;
        const k = Math.floor(f), w = f - k;
        const i0 = k * STRIDE, i1 = i0 + STRIDE;
        const cx = S[0]!, cz = S[1]!;
        for (let j = 0; j < POLAR_N; j++) {
          const r = t.data[i0 + 3 + j]! * (1 - w) + t.data[i1 + 3 + j]! * w;
          const a = (TWO_PI * j) / POLAR_N;
          pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
        }
      }
      return pts;
    },
    armpitY,
    armpitS,
    armPoint(f, s, phi) {
      const r = armRadius(f, s, phi);
      if (!(r > 1e-3)) return null;
      const cu = Math.cos(phi) * r, cv = Math.sin(phi) * r;
      return [f.joint[0] + f.axis[0] * s + f.u[0] * cu + f.v[0] * cv, f.joint[1] + f.axis[1] * s + f.u[1] * cu + f.v[1] * cv, f.joint[2] + f.axis[2] * s + f.u[2] * cu + f.v[2] * cv];
    },
    armRadius,
    armTopS,
  };
}
