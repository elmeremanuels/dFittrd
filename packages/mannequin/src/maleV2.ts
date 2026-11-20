/**
 * Male shape v2 (`buildMannequin(shape, { maleShape: 'v2' })`): the male body with non-elliptical
 * cross-sections. The v1 male body is a stack of ellipses lofted through the anchor rings; this
 * module replaces the torso below the neck ring, the top of the legs and the root of the arms with
 * outlines of its own, and leaves every ring girth on the mesh at the table value.
 *
 * What it adds (all own geometry, no scan or body model):
 *
 * - **Superellipse rings fitted to ANSUR II.** At the chest, waist and seat the section is a
 *   superellipse |x/A|^p + |z/B|^p = 1 whose breadth and depth are ANSUR II's (chest breadth and
 *   depth, waist breadth and depth, hip breadth and buttock depth; `MALE_SECTION_REFERENCE`) and
 *   whose exponent p is solved so that its perimeter is ANSUR's girth at that level. A torso is
 *   boxier than an ellipse (p > 2): the v1 ellipse of the same girth is about 20 % too wide and
 *   too deep at the chest, which is what read as a barrel. At the chest ANSUR's breadth and depth
 *   cannot reach the girth with any p ≤ `CHEST_EXPONENT_LIMIT` (ANSUR measures the breadth across
 *   the chest, the tape goes over the shoulder blades and the lats), so the depth is kept and the
 *   breadth is widened until the perimeter is the girth.
 * - **Chest and back.** Two pectoral bulges with a shallow sternal groove at the front, shoulder
 *   blades and a spine groove at the back, a belly that grows with the waist depth, and a seat
 *   with two gluteal bulges and a cleft. Their sizes are assumed (`MALE_V2_ASSUMPTIONS`).
 * - **V taper and shoulders.** The lats widen the torso from the chest up to the armpit; above
 *   the shoulder ring a trapezius slope runs up to the neck ring, lower in front than at the back
 *   (the neck base is slanted, as ANSUR's suprasternale and cervicale heights are); the arm root
 *   is a deltoid cap that bulges outwards, forwards and backwards and has no pole standing above
 *   the shoulder line.
 * - **Joined crotch.** Below the seat the torso pinches front and back into two lobes that meet
 *   the tops of the legs, so there is no flat ledge where the torso ended in v1. The legs move in
 *   so that the thighs sit under the seat, are flattened where they meet and carry the lower
 *   buttock down to the gluteal fold.
 * - **Thighs that part under the crotch.** The thighs touch at the crotch, where the torso ends, and
 *   from `thighPartOverCm` under it each keeps its inner side `thighGapCm` off the centre plane: a
 *   thigh is a D there, flat on the inside, scaled so that its girth is what the ellipse's was (the
 *   thigh ring stays at the table girth). Before, the two thighs' ellipses overlapped across the
 *   centre plane by up to 1 cm for 12 to 15 cm under the crotch, and a trouser's two legs had
 *   nowhere to pass (the body showed through the cloth under the crotch, chino-crotch-v2 report).
 *
 * Girths: every section is scaled so that, at each anchor ring, the loop on the mesh is the table
 * girth (the same rings, heights and table as v1); between two rings the scale is interpolated.
 * `torsoAt`, `legAt` and `armAt` return an ellipse about the section centre that contains the v2
 * outline (for collision and garment placement), not an ellipse of the section's girth.
 */
import { monotoneProfile, type AnchorRing } from '@curtain/anchors';
import { along, lerp } from './math';
import { polarStack, sectionCentroid, sectionPolar, verticalOutlines, type PolarSection } from './outlines';
import { polygonCompensation, stations, type ArmFrame, type BuildOptions, type Mannequin, type PartSpec, type RingFrame, type Section, type Side } from './model';

/**
 * ANSUR II (`ANSUR_II_MALE_Public.csv`, 4082 men; see `scripts/derive-male-table.ts`): the
 * least-squares line of each measure on chest circumference, at the chest girth of each male
 * size, cm, rounded to 0.1 cm; levels as fractions of the line's stature, rounded to 0.001.
 * `chest` is the size's chest girth (the x of the lines), the other girths are ANSUR's own at that
 * chest girth (the waist at the omphalion, the seat at the buttocks).
 */
export const MALE_SECTION_REFERENCE = {
  S: { chest: 90, chestBreadth: 26.5, chestDepth: 21.0, waistBreadth: 27.2, waistDepth: 18.5, waistGirth: 76.1, hipBreadth: 31.3, buttockDepth: 20.6, hipGirth: 90.3, axilla: 0.756, acromion: 0.813 },
  M: { chest: 98, chestBreadth: 27.7, chestDepth: 23.2, waistBreadth: 29.9, waistDepth: 21.2, waistGirth: 85.1, hipBreadth: 32.9, buttockDepth: 22.6, hipGirth: 96.2, axilla: 0.757, acromion: 0.817 },
  L: { chest: 106, chestBreadth: 29.0, chestDepth: 25.4, waistBreadth: 32.7, waistDepth: 23.8, waistGirth: 94.2, hipBreadth: 34.6, buttockDepth: 24.6, hipGirth: 102.0, axilla: 0.757, acromion: 0.82 },
  XL: { chest: 114, chestBreadth: 30.2, chestDepth: 27.6, waistBreadth: 35.4, waistDepth: 26.5, waistGirth: 103.3, hipBreadth: 36.3, buttockDepth: 26.6, hipGirth: 107.9, axilla: 0.757, acromion: 0.824 },
  XXL: { chest: 123, chestBreadth: 31.6, chestDepth: 30.1, waistBreadth: 38.5, waistDepth: 29.5, waistGirth: 113.4, hipBreadth: 38.1, buttockDepth: 28.8, hipGirth: 114.5, axilla: 0.757, acromion: 0.828 },
} as const;

export type MaleSectionRow = (typeof MALE_SECTION_REFERENCE)['M'];

/** Largest superellipse exponent used for a ring (p = 2 is the ellipse, p → ∞ the rectangle). */
export const CHEST_EXPONENT_LIMIT = 3.4;

/** Assumed sizes of the v2 relief (not measured), as fractions of the local section depth unless noted. */
export const MALE_V2_ASSUMPTIONS = {
  /** Pectoral bulge at the chest ring, of the chest depth. */
  pectoral: 0.085,
  /** Shoulder blades at the armpit level, of the chest depth. */
  scapula: 0.05,
  /** Spine groove, cm. */
  spineCm: 0.6,
  /** Gluteal bulge at the seat ring, of the seat depth. */
  gluteal: 0.07,
  /** Gluteal cleft at the seat ring, cm. */
  cleftCm: 0.9,
  /** Front share of the depth at the chest and at the seat (the rest is behind the arm-joint plane). */
  chestFrontShare: 0.53,
  seatFrontShare: 0.42,
  /** Widening of the torso by the lats at the armpit level, of the chest half-width. */
  lats: 0.08,
  /** Superellipse exponent of the shoulder ring. */
  shoulderExponent: 2.6,
  /** Deltoid bulge over the arm root, of the upper-arm half-width. */
  deltoid: 0.32,
  /**
   * Under the crotch each thigh's inner side stays this far from the centre plane, cm: the thighs part, and the two legs
   * of a trouser pass between them (two layers of cloth, each the collision clearance off its own thigh). The thighs
   * touch at the crotch and are this far apart `thighPartOverCm` under it.
   */
  thighGapCm: 0.6,
  thighPartOverCm: 0.8,
  /** How round the corner of a thigh's flattened inner side is, cm. */
  thighInnerRoundCm: 0.25,
} as const;

const TORSO_SEGMENTS = 64;
const LEG_SEGMENTS = 40;
const TORSO_STEP_CM = 1.0;

/** Superellipse point of the parameter angle t (t = 0 at the front, then towards +x). */
const spow = (v: number, e: number): number => Math.sign(v) * Math.abs(v) ** e;

/** Perimeter of the n-gon on the superellipse (a, b, p) at uniform parameter angles. */
export function superellipsePerimeter(a: number, b: number, p: number, n = 720): number {
  let len = 0;
  let px = 0;
  let pz = b;
  for (let i = 1; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = a * spow(Math.sin(t), 2 / p);
    const z = b * spow(Math.cos(t), 2 / p);
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return len;
}

/**
 * The superellipse ring of ANSUR's breadth W, depth D and girth C: the exponent p ∈ [2, pMax] whose
 * perimeter is C; when even pMax falls short, p = pMax and the breadth grows until it does.
 */
export function fitRing(W: number, D: number, C: number, pMax = CHEST_EXPONENT_LIMIT): { W: number; D: number; p: number } {
  const per = (w: number, p: number): number => superellipsePerimeter(w / 2, D / 2, p);
  if (per(W, 2) >= C) {
    // Already longer as an ellipse (not the case in the table): shrink the breadth.
    let lo = 0.3 * W;
    let hi = W;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (per(m, 2) < C) lo = m;
      else hi = m;
    }
    return { W: (lo + hi) / 2, D, p: 2 };
  }
  if (per(W, pMax) >= C) {
    let lo = 2;
    let hi = pMax;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (per(W, m) < C) lo = m;
      else hi = m;
    }
    return { W, D, p: (lo + hi) / 2 };
  }
  let lo = W;
  let hi = 2 * W;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (per(m, pMax) < C) lo = m;
    else hi = m;
  }
  return { W: (lo + hi) / 2, D, p: pMax };
}

interface RingFit {
  /** Breadth and depth per cm of girth, and the exponent. */
  w: number;
  d: number;
  p: number;
}

const ROWS = Object.values(MALE_SECTION_REFERENCE);
const FITS = ROWS.map((r) => {
  const per = (W: number, D: number, C: number, pMax?: number): RingFit => {
    const f = fitRing(W, D, C, pMax);
    return { w: f.W / C, d: f.D / C, p: f.p };
  };
  return {
    chest: r.chest,
    chestFit: per(r.chestBreadth, r.chestDepth, r.chest),
    waistFit: per(r.waistBreadth, r.waistDepth, r.waistGirth, 4),
    hipFit: per(r.hipBreadth, r.buttockDepth, r.hipGirth, 4),
    axilla: r.axilla,
    acromion: r.acromion,
  };
});

/** Piecewise linear in the table's chest girths, held at the ends. */
function byChest(chest: number, pick: (f: (typeof FITS)[number]) => number): number {
  const xs = FITS.map((f) => f.chest);
  const c = Math.min(xs[xs.length - 1]!, Math.max(xs[0]!, chest));
  let i = 1;
  while (i < xs.length - 1 && c > xs[i]!) i++;
  const t = (c - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return lerp(pick(FITS[i - 1]!), pick(FITS[i]!), t);
}

/** The ANSUR-fitted superellipse rings (chest, waist, seat) of a body with this chest girth, per cm of girth. */
export function maleRingFits(chestCm: number): Record<'chest' | 'waist' | 'hip', RingFit> {
  const f = (k: 'chestFit' | 'waistFit' | 'hipFit'): RingFit => ({ w: byChest(chestCm, (r) => r[k].w), d: byChest(chestCm, (r) => r[k].d), p: byChest(chestCm, (r) => r[k].p) });
  return { chest: f('chestFit'), waist: f('waistFit'), hip: f('hipFit') };
}

/** The parameters of one torso outline. */
interface OutlineParams {
  A: number;
  bf: number;
  bb: number;
  p: number;
  pec: number;
  scap: number;
  spine: number;
  glute: number;
  cleft: number;
  belly: number;
  pinchF: number;
  pinchB: number;
  /** Width of the pinch, of the half-width A. */
  pw: number;
}
const KEYS = ['A', 'bf', 'bb', 'p', 'pec', 'scap', 'spine', 'glute', 'cleft', 'belly', 'pinchF', 'pinchB', 'pw'] as const satisfies readonly (keyof OutlineParams)[];

const g = (u: number): number => Math.exp(-u * u);

/**
 * Torso outline (x along +X, z along +Z, relative to the section centre), n points at uniform
 * polar angles (t = 0 at the front, then towards +x), unscaled: the superellipse of half-width A,
 * front depth bf, back depth bb and exponent p, with the relief added front and back.
 */
function torsoOutline(P: OutlineParams, n: number): Float64Array {
  const out = new Float64Array(2 * n);
  // Width of the crotch pinch: the gap between the two lobes.
  const w = P.pw * P.A;
  for (let j = 0; j < n; j++) {
    const t = (2 * Math.PI * j) / n;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const B = c >= 0 ? P.bf : P.bb;
    const r = (Math.abs(s / P.A) ** P.p + Math.abs(c / B) ** P.p) ** (-1 / P.p);
    const x = r * s;
    const xn = x / P.A;
    const ax = Math.abs(xn);
    const zn = Math.min(1, Math.abs(r * c) / B);
    let z: number;
    if (c >= 0) {
      const relief = P.pec * (g((ax - 0.42) / 0.2) - 0.15 * g(xn / 0.12)) + P.belly * g(xn / 0.55);
      z = (r * c + relief * Math.sqrt(zn)) * (1 - P.pinchF * g(x / w));
    } else {
      const relief = P.scap * g((ax - 0.47) / 0.22) + P.glute * g((ax - 0.4) / 0.3) - P.spine * g(xn / 0.08) - P.cleft * g(xn / 0.07);
      z = (r * c - relief * Math.sqrt(zn)) * (1 - P.pinchB * g(x / w));
    }
    out[2 * j] = x;
    out[2 * j + 1] = z;
  }
  return out;
}

function perimeter(o: Float64Array): number {
  const n = o.length / 2;
  let len = 0;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    len += Math.hypot(o[2 * k]! - o[2 * j]!, o[2 * k + 1]! - o[2 * j + 1]!);
  }
  return len;
}

const scaled = (o: Float64Array, k: number): Float64Array => o.map((v) => v * k);

/** Semi-axes of an ellipse about the origin that contains the outline. */
function envelope(o: Float64Array): { a: number; b: number } {
  let ax = 1e-9;
  let bz = 1e-9;
  for (let j = 0; j < o.length; j += 2) {
    ax = Math.max(ax, Math.abs(o[j]!));
    bz = Math.max(bz, Math.abs(o[j + 1]!));
  }
  let k = 1;
  for (let j = 0; j < o.length; j += 2) k = Math.max(k, Math.hypot(o[j]! / ax, o[j + 1]! / bz));
  return { a: ax * k, b: bz * k };
}

/** Superellipse depth B with perimeter C at half-width A and exponent p. */
function depthForGirth(A: number, p: number, C: number): number {
  let lo = 0.05 * A;
  let hi = 3 * A;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (superellipsePerimeter(A, m, p, 240) < C) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Profile through knots: a monotone cubic per parameter. */
function paramProfile(knots: readonly { y: number; P: OutlineParams }[]): (y: number) => OutlineParams {
  const fs = KEYS.map((k) => monotoneProfile(knots.map((q) => ({ x: q.y, y: q.P[k] }))));
  return (y) => {
    const out = {} as OutlineParams;
    KEYS.forEach((k, i) => (out[k] = fs[i]!(y)));
    return out;
  };
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Distance from the torso axis (x = z = 0) along the direction (dx, dz) to the far side of the two
 * leg outlines at one height; the crotch bridge (`BRIDGE_CM`) where the ray passes between them.
 */
const BRIDGE_CM = 0.35;
function unionRadius(legs: readonly Section[], dx: number, dz: number): number {
  let best = 0;
  for (const s of legs) {
    const o = s.outline;
    const n = o ? o.length / 2 : 64;
    for (let j = 0; j < n; j++) {
      const q = (j + 1) % n;
      const pt = (i: number): [number, number] => {
        if (o) return [s.centre[0] + o[2 * i]!, s.centre[2] + o[2 * i + 1]!];
        const t = (2 * Math.PI * i) / n;
        return [s.centre[0] + s.a * Math.sin(t), s.centre[2] + s.b * Math.cos(t)];
      };
      const [x0, z0] = pt(j);
      const [x1, z1] = pt(q);
      // Ray t·(dx, dz) against the segment p0 + u·(p1 − p0).
      const ex = x1 - x0;
      const ez = z1 - z0;
      const det = dx * -ez - dz * -ex;
      if (Math.abs(det) < 1e-12) continue;
      const t = (x0 * -ez - z0 * -ex) / det;
      const u = (dx * z0 - dz * x0) / det;
      if (u >= 0 && u <= 1 && t > best) best = t;
    }
  }
  return Math.max(best, BRIDGE_CM);
}

/** Linear interpolation through (x, y) knots sorted by x, held at the ends. */
function linear(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  let i = 1;
  while (x > xs[i]!) i++;
  return lerp(ys[i - 1]!, ys[i]!, (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!));
}

export function maleShapeV2(m: Mannequin, options: BuildOptions = {}): Mannequin {
  const S = m.statureCm;
  const shape = m.shape;
  const A = MALE_V2_ASSUMPTIONS;
  const ring = (id: AnchorRing): RingFrame => m.rings.find((r) => r.id === id)!;
  const Y = m.morphHeights;
  const G = (id: AnchorRing): number => shape.rings[id].circumferenceCm;
  const chestCm = G('chest');
  const fits = maleRingFits(chestCm);
  const axillaF = byChest(chestCm, (r) => r.axilla);
  const yc = m.landmarks.crotch[1];
  const yh = Y.hip;
  const yw = Y.waist;
  const yub = Y.underbust;
  const ych = Y.chest;
  const ysh = Y.shoulder;
  const yn = Y.neck;
  // The armpit sits between the chest and shoulder rings (ANSUR axilla height, held inside them).
  const yax = Math.min(ysh - 0.3 * (ysh - ych), Math.max(ych + 0.25 * (ysh - ych), axillaF * S));

  const zero = { pec: 0, scap: 0, spine: 0, glute: 0, cleft: 0, belly: 0, pinchF: 0, pinchB: 0, pw: 0.42 };
  const fitted = (id: 'chest' | 'waist' | 'hip') => {
    const f = fits[id];
    return { A: (f.w * G(id)) / 2, D: f.d * G(id), p: f.p };
  };
  const chest = fitted('chest');
  const waist = fitted('waist');
  const hip = fitted('hip');

  // --- Legs: moved in under the seat ------------------------------------------------------------
  const thigh = ring('thigh');
  // The thigh tops sit inside the seat's breadth (a little in from its side) and touch in the middle.
  const topA = 0.97 * thigh.a;
  const legX = Math.max(0.9 * thigh.a, Math.min(m.landmarks.legX, hip.A - topA - 0.3));
  const dx = legX - m.landmarks.legX;
  const yt = Y.thigh;
  const gluteFold = yt + 0.35 * (yc - yt);
  const legTop = (m.parts.find((p) => p.id === 'leg_l')!.sections[0]!).centre[1];
  // The lobes of the torso at the crotch: the two thigh tops side by side.
  const topB = 1.05 * thigh.b;
  // …and no further forward than the lower belly: the thigh tops move back by what they would stand out.
  const shiftZ = Math.max(0, topB - 0.99 * A.seatFrontShare * hip.D);
  const gluteCm = A.gluteal * hip.D;
  // The torso ends at the crotch, where the thighs still touch, and closes under it between them (its pole): from
  // there down the thighs have parted and nothing of the torso may stand in the gap.
  const yEnd = yc;
  // --- Leg sections ------------------------------------------------------------------------------
  const legV1 = m.parts.find((p) => p.id === 'leg_l')!;
  const ls = LEG_SEGMENTS;
  // --- Thighs that part under the crotch ----------------------------------------------------------
  /** 0 at the crotch and above (the thighs touch), 1 from `thighPartOverCm` under it (each `thighGapCm` off the centre plane). */
  const parted = (yy: number): number => smooth(Math.min(1, Math.max(0, (yc - yy) / A.thighPartOverCm)));
  /** A smooth floor: u where u is well above 0, never under 0. */
  const softFloor = (u: number): number => {
    const q = u / A.thighInnerRoundCm;
    return q > 30 ? u : A.thighInnerRoundCm * Math.log1p(Math.exp(q));
  };
  /**
   * Leg outline at height y on the left leg (local x towards +X about the leg's centre, z in the body's frame), in cm
   * on the mesh but for `scale` (the polygon's compensation, and the tuck into the torso), by which the caller multiplies.
   */
  const legOutline = (yy: number, tucked: boolean, scale: number): Float64Array => {
    const e = m.legAt(Math.min(yy, legTop), 1)!;
    const up = Math.min(1, Math.max(0, (yy - yt) / (gluteFold - yt)));
    const top = Math.min(1, Math.max(0, (yy - gluteFold) / (yc - gluteFold)));
    // Above the crotch the leg tucks into the torso's lobes (no flat top shows).
    const tuck = tucked ? 1 - 0.22 * Math.min(1, Math.max(0, (yy - yc) / (legTop - yc))) : 1;
    // From the thigh ring up the leg runs straight to its top under the seat (v1 flared out here).
    const rise = Math.min(1, Math.max(0, (yy - yt) / (yc - yt)));
    const a0 = yy <= yt ? e.a : (yy <= yc ? lerp(thigh.a, topA, rise) : topA) * tuck;
    const b0 = yy <= yt ? e.b : (yy <= yc ? lerp(thigh.b, topB, rise) : topB) * tuck;
    const glute = gluteCm * (0.55 * up * up + 0.45 * top);
    const t = parted(yy);
    // Where the thighs touch (at the crotch and above): flattened just past the middle of the body, softly.
    const touching = -(legX + 0.1);
    // Where they have parted: the inner side never nearer the centre plane than the gap (on the mesh, so before `scale`).
    const wall = -(legX - A.thighGapCm) / scale;
    /** The outline scaled by f, its inner side moved by `share` from touching (0) to parted (1); a negative share: the whole ellipse, nothing flattened. */
    const make = (f: number, share: number): Float64Array => {
      const o = new Float64Array(2 * ls);
      for (let j = 0; j < ls; j++) {
        const ang = (2 * Math.PI * j) / ls;
        const x = f * a0 * Math.sin(ang);
        let z = f * b0 * Math.cos(ang);
        // Lower buttock on the back of the thigh, a little towards the inside.
        if (z < 0) z -= glute * g((x + 0.15 * a0) / (0.65 * a0)) * Math.sqrt(-Math.cos(ang));
        const met = x < touching ? touching - 0.35 * (touching - x) * g((touching - x) / (0.4 * a0)) : x;
        o[2 * j] = share < 0 ? x : share > 0 ? lerp(met, wall + softFloor(x - wall), share) : met;
        o[2 * j + 1] = z + e.cz - shiftZ * top;
      }
      return o;
    };
    if (t <= 0) return make(1, 0);
    // At the thigh ring and below, the girth the section has as a whole ellipse is kept (the ring stays at the table
    // girth): the flat inner side is paid for all round. Above the gluteal fold the outline keeps its own size, so the
    // thigh still meets the torso flush at the crotch.
    const keep = 1 - up;
    if (keep <= 0) return make(1, t);
    const want = perimeter(make(1, -1));
    let lo = 1;
    let hi = 1.25;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (perimeter(make(mid, 1)) < want) lo = mid;
      else hi = mid;
    }
    return make(lerp(1, (lo + hi) / 2, t * keep), t);
  };
  // Sections also at the crotch and where the thighs have parted: the mesh is straight between its sections.
  const legRingYs = [yt, Y.knee, Y.calf, Y.ankle, yc, yc - A.thighPartOverCm / 2, yc - A.thighPartOverCm];
  const legStationsV1 = legV1.sections.map((s) => s.centre[1]);
  const legYs = stations(legTop, legStationsV1[legStationsV1.length - 1]!, options.legStepCm ?? 1.5, legRingYs);
  const legSectionAt = (yy: number, side: Side, tucked = true): Section => {
    const e = m.legAt(Math.min(yy, legTop), 1)!;
    // Below the thigh ring the leg is the v1 ellipse wherever that stays clear of the gap (the knee, the calf, the ankle).
    if (yy <= yt + 1e-9 && legX - e.a - A.thighGapCm > 6 * A.thighInnerRoundCm) {
      const k = polygonCompensation(e.a, e.b, ls);
      return { centre: [side * legX, yy, e.cz], u: [1, 0, 0], v: [0, 0, 1], a: e.a * k, b: e.b * k };
    }
    // Scale: exact at the thigh ring (the ellipse's girth there), holding the outline's own size above it.
    // Above the torso's end the thigh stays just inside the torso that covers it (no surfaces fighting).
    const inside = !tucked || yy <= yEnd ? 1 : yy >= yEnd + 1 ? 0.985 : lerp(1, 0.985, yy - yEnd);
    const k = polygonCompensation(e.a, e.b, ls) * inside;
    const raw = legOutline(yy, tucked, k);
    const o = new Float64Array(raw.length);
    for (let j = 0; j < ls; j++) {
      o[2 * j] = side * raw[2 * j]! * k;
      o[2 * j + 1] = (raw[2 * j + 1]! - e.cz) * k;
    }
    // A right leg mirrors x, which reverses the point order: walk it the other way round so the loft stays consistent.
    if (side === -1) {
      const r = new Float64Array(o.length);
      for (let j = 0; j < ls; j++) {
        const q = (ls - j) % ls;
        r[2 * j] = o[2 * q]!;
        r[2 * j + 1] = o[2 * q + 1]!;
      }
      return { centre: [side * legX, yy, e.cz], u: [1, 0, 0], v: [0, 0, 1], ...envelope(r), outline: r };
    }
    return { centre: [side * legX, yy, e.cz], u: [1, 0, 0], v: [0, 0, 1], ...envelope(o), outline: o };
  };
  const legPart = (side: Side): PartSpec => ({
    ...legV1,
    id: side === 1 ? 'leg_l' : 'leg_r',
    segments: ls,
    sections: legYs.map((yy) => legSectionAt(yy, side)),
    startPole: [side * legX, legTop + 0.8, 0],
    endPole: [side * legX, legV1.endPole[1], legV1.endPole[2]],
  });

  // --- Torso knots ------------------------------------------------------------------------------
  const neck = ring('neck');
  const shoulder = ring('shoulder');
  const shA = shoulder.a;
  const shB = depthForGirth(shA, A.shoulderExponent, G('shoulder'));
  const waistFront = Math.min(0.6, Math.max(0.48, 0.5 + 0.8 * (waist.D / (2 * waist.A) - 0.68)));
  const bellyCm = Math.max(0, waist.D * (waistFront - 0.5));
  const ub = (t: number) => ({ A: lerp(chest.A, waist.A, t), D: lerp(chest.D, waist.D, t), p: lerp(chest.p, waist.p, t) });
  const ubP = ub(0.45);
  const yBlendTop = yh;
  const knots: { y: number; P: OutlineParams }[] = [
    { y: yh, P: { ...zero, A: hip.A, bf: A.seatFrontShare * hip.D, bb: (1 - A.seatFrontShare) * hip.D, p: hip.p, glute: gluteCm, cleft: A.cleftCm, pinchB: 0.15 } },
    { y: lerp(yh, yw, 0.5), P: { ...zero, A: lerp(hip.A, waist.A, 0.55), bf: lerp(A.seatFrontShare * hip.D, waistFront * waist.D, 0.6), bb: lerp((1 - A.seatFrontShare) * hip.D, (1 - waistFront) * waist.D, 0.6), p: lerp(hip.p, waist.p, 0.6), glute: 0.15 * gluteCm, spine: 0.5 * A.spineCm, belly: 0.5 * bellyCm } },
    { y: yw, P: { ...zero, A: waist.A, bf: waistFront * waist.D - bellyCm, bb: (1 - waistFront) * waist.D, p: waist.p, spine: A.spineCm, belly: bellyCm } },
    { y: yub, P: { ...zero, A: ubP.A, bf: 0.5 * ubP.D - 0.4 * bellyCm, bb: 0.5 * ubP.D, p: ubP.p, spine: A.spineCm, pec: 0.25 * A.pectoral * chest.D, belly: 0.4 * bellyCm } },
    { y: ych, P: { ...zero, A: chest.A, bf: A.chestFrontShare * chest.D - A.pectoral * chest.D, bb: (1 - A.chestFrontShare) * chest.D - 0.6 * A.scapula * chest.D, p: chest.p, pec: A.pectoral * chest.D, scap: 0.6 * A.scapula * chest.D, spine: A.spineCm } },
    { y: yax, P: { ...zero, A: (1 + A.lats) * chest.A, bf: A.chestFrontShare * chest.D - 0.9 * A.pectoral * chest.D, bb: (1 - A.chestFrontShare) * chest.D - A.scapula * chest.D, p: chest.p, pec: 0.8 * A.pectoral * chest.D, scap: A.scapula * chest.D, spine: A.spineCm } },
    { y: ysh, P: { ...zero, A: shA, bf: 0.95 * shB, bb: 1.05 * shB - 0.5 * A.scapula * chest.D, p: A.shoulderExponent, scap: 0.5 * A.scapula * chest.D, spine: 0.6 * A.spineCm } },
    { y: lerp(ysh, yn, 0.35), P: { ...zero, A: lerp(shA, neck.a, 0.33), bf: lerp(shB, neck.b, 0.75), bb: lerp(shB, neck.b, 0.3), p: lerp(A.shoulderExponent, 2, 0.4) } },
    { y: lerp(ysh, yn, 0.7), P: { ...zero, A: lerp(shA, neck.a, 0.68), bf: lerp(shB, neck.b, 0.97), bb: lerp(shB, neck.b, 0.72), p: lerp(A.shoulderExponent, 2, 0.8) } },
    { y: yn, P: { ...zero, A: neck.a, bf: neck.b, bb: neck.b, p: 2 } },
  ];
  const profile = paramProfile(knots);

  // Girth scale: exact at every torso ring, linear between them.
  const n = TORSO_SEGMENTS;
  const torsoRingIds = ['hip', 'waist', 'underbust', 'chest', 'shoulder', 'neck'] as const;
  const ringScale = torsoRingIds.map((id) => G(id) / perimeter(torsoOutline(profile(Y[id]), n)));
  const ringYs = torsoRingIds.map((id) => Y[id]);
  const torsoV1 = m.parts.find((p) => p.id === 'torso')!;
  const below = stations(yEnd, yn, options.torsoStepCm ?? TORSO_STEP_CM, [...ringYs, yc]).map((yy): Section => {
    // Below the seat ring the girth scale fades to 1 at the crotch: the lobes keep the thighs' size.
    const k = yy >= yh ? linear(ringYs, ringScale, yy) : lerp(1, ringScale[0]!, Math.max(0, (yy - yc) / (yh - yc)));
    let o = scaled(torsoOutline(profile(yy), n), k);
    const w = yy <= yc ? 1 : yy >= yBlendTop ? 0 : 1 - smooth((yy - yc) / (yBlendTop - yc));
    if (w > 0) {
      // Join: the outline goes over to the two thighs side by side; just inside them where the torso ends (1 %, so the
      // two surfaces cross in a shallow groove: at 4 % it read as a dark line round the thigh tops).
      const grow = yy >= yEnd + 0.5 ? 1 : lerp(0.99, 1, (yy - yEnd) / 0.5);
      const legs = [legSectionAt(yy, 1, false), legSectionAt(yy, -1, false)];
      const joined = new Float64Array(o.length);
      for (let j = 0; j < o.length; j += 2) {
        const r0 = Math.hypot(o[j]!, o[j + 1]!);
        const r1 = grow * unionRadius(legs, o[j]! / r0, o[j + 1]! / r0);
        const r = lerp(r0, r1, w);
        joined[j] = (o[j]! / r0) * r;
        joined[j + 1] = (o[j + 1]! / r0) * r;
      }
      o = joined;
    }
    return { centre: [0, yy, 0], u: [1, 0, 0], v: [0, 0, 1], ...envelope(o), outline: o };
  });
  // Above the neck ring: the v1 ellipses, resampled to the v2 segment count.
  const above = torsoV1.sections
    .filter((s) => s.centre[1] > yn + 1e-6)
    .map((s): Section => {
      const e = m.torsoAt(s.centre[1])!;
      const k = polygonCompensation(e.a, e.b, n);
      return { ...s, a: e.a * k, b: e.b * k };
    });
  const torso: PartSpec = { ...torsoV1, segments: n, sections: [...below, ...above], startPole: [0, yEnd - 0.6, 0] };

  // --- Arms: deltoid cap ---------------------------------------------------------------------------
  const armV1 = m.parts.find((p) => p.id === 'arm_l')!;
  const as = armV1.segments;
  const upperArmS = Y.upper_arm;
  const ua = ring('upper_arm');
  const deltoidEnd = 0.85 * upperArmS;
  const rootA = armV1.sections[0]!.a;
  /** Highest the arm's surface may reach at |x| (the shoulder line: the trapezius, then the round top of the deltoid). */
  const shoulderTop = (x: number): number => {
    const ax = Math.abs(x);
    const trap = ysh + ((yn - ysh) * (shA - ax)) / (shA - neck.a) + 0.4;
    const capR = 2.2 * ua.a;
    const over = Math.max(0, ax - (shA - 0.25 * ua.a));
    return Math.min(trap, ysh + 0.9 - (over * over) / (2 * capR));
  };
  /**
   * Moves a world point of the arm down in its section plane (along ∓u) to a soft minimum of its
   * own height and the shoulder line: the cap rounds off under the line instead of being cut flat.
   */
  const SOFT_CM = 0.9;
  const softMin = (a: number, b: number): number => {
    const lo = Math.min(a, b);
    return lo - SOFT_CM * Math.log(Math.exp((lo - a) / SOFT_CM) + Math.exp((lo - b) / SOFT_CM));
  };
  const clampToShoulder = (f: ArmFrame, p: [number, number, number]): [number, number, number] => {
    const dir = f.u[1] > 0 ? -1 : 1;
    const q: [number, number, number] = [...p];
    for (let it = 0; it < 8; it++) {
      const d = (q[1] - softMin(p[1], shoulderTop(q[0]))) / Math.abs(f.u[1]);
      if (Math.abs(d) < 1e-6) break;
      q[0] += dir * f.u[0] * d;
      q[1] += dir * f.u[1] * d;
      q[2] += dir * f.u[2] * d;
    }
    return q;
  };
  const capS = [-0.55, -0.4, -0.22].map((k) => k * rootA);
  const armSections = (f: ArmFrame): Section[] => {
    const sv1 = armV1.sections.map((s0) => Math.hypot(s0.centre[0] - armV1.sections[0]!.centre[0], s0.centre[1] - armV1.sections[0]!.centre[1], s0.centre[2] - armV1.sections[0]!.centre[2]));
    return [...capS, ...sv1].map((sAlong): Section => {
      const e = m.armAt(Math.max(0, sAlong), 1)!;
      // The cap: a dome over the joint instead of the v1 cone.
      const dome = sAlong < 0 ? Math.sqrt(Math.max(0.05, 1 - (sAlong / (0.72 * rootA)) ** 2)) : 1;
      const k = polygonCompensation(e.a, e.b, as);
      const centre = along(f.joint, f.axis, sAlong);
      const w = Math.max(0, 1 - Math.max(0, sAlong) / deltoidEnd);
      if (w <= 0) return { centre, u: f.u, v: f.v, a: e.a * k, b: e.b * k };
      const bulge = A.deltoid * ua.a * Math.sin(Math.PI * Math.min(1, 0.35 + 0.65 * (1 - w))) * (0.5 + 0.5 * w);
      const o = new Float64Array(2 * as);
      for (let j = 0; j < as; j++) {
        const t = (2 * Math.PI * j) / as;
        // Lateral side is +u on the left arm, −u on the right one; the deltoid wraps it front and back.
        const lat = f.side * Math.sin(t);
        const r = 1 + (bulge / e.a) * Math.max(0, 0.35 + 0.65 * lat) ** 1.5;
        let x = e.a * k * Math.sin(t) * r * dome;
        let z = e.b * k * Math.cos(t) * (1 + 0.6 * (r - 1)) * dome;
        const world = clampToShoulder(f, [centre[0] + x * f.u[0] + z * f.v[0], centre[1] + x * f.u[1] + z * f.v[1], centre[2] + x * f.u[2] + z * f.v[2]]);
        const d: [number, number, number] = [world[0] - centre[0], world[1] - centre[1], world[2] - centre[2]];
        x = d[0] * f.u[0] + d[1] * f.u[1] + d[2] * f.u[2];
        z = d[0] * f.v[0] + d[1] * f.v[1] + d[2] * f.v[2];
        o[2 * j] = x;
        o[2 * j + 1] = z;
      }
      return { centre, u: f.u, v: f.v, ...envelope(o), outline: o };
    });
  };
  const armPart = (f: ArmFrame): PartSpec => {
    const v1 = m.parts.find((p) => p.id === (f.side === 1 ? 'arm_l' : 'arm_r'))!;
    const sections = armSections(f);
    // The pole: the middle of the first (clamped) cap section, a little further up the axis.
    const first = sections[0]!;
    const o = first.outline!;
    let cx = 0;
    let cz = 0;
    for (let j = 0; j < o.length; j += 2) {
      cx += o[j]!;
      cz += o[j + 1]!;
    }
    cx /= o.length / 2;
    cz /= o.length / 2;
    const mid = along(first.centre, f.u, cx);
    const pole = clampToShoulder(f, along([mid[0] + cz * f.v[0], mid[1] + cz * f.v[1], mid[2] + cz * f.v[2]], f.axis, -0.12 * rootA));
    return { ...v1, sections, startPole: pole };
  };

  // --- Assemble -------------------------------------------------------------------------------------
  const parts = [torso, legPart(1), legPart(-1), armPart(m.arms.left), armPart(m.arms.right)];
  const shiftLeg = (r: RingFrame): RingFrame => (r.part === 'leg_l' ? { ...r, centre: [r.centre[0] + dx, r.centre[1], r.centre[2]] } : r);
  const legJoint = /^(hip|knee)_(l|r)$/;
  const joints = m.joints.map((j) => {
    const hit = legJoint.exec(j.id);
    return hit ? { ...j, pivot: [(hit[2] === 'l' ? 1 : -1) * legX, j.pivot[1], j.pivot[2]] as [number, number, number] } : j;
  });

  const torsoYs = torso.sections.map((s) => s.centre[1]);
  const sectionLerp = (secs: readonly Section[], ys: readonly number[], yy: number): { a: number; b: number; cz: number } => {
    let i = 1;
    while (i < ys.length - 1 && ys[i]! < yy) i++;
    const p = secs[i - 1]!;
    const q = secs[i]!;
    const t = Math.min(1, Math.max(0, (yy - ys[i - 1]!) / (ys[i]! - ys[i - 1]! || 1)));
    return { a: lerp(p.a, q.a, t), b: lerp(p.b, q.b, t), cz: lerp(p.centre[2], q.centre[2], t) };
  };
  const legSecs = parts[1]!.sections;
  const legYsDesc = legSecs.map((s) => s.centre[1]);
  const legSecsAsc = [...legSecs].reverse();
  const legYsAsc = [...legYsDesc].reverse();
  const torsoLo = torsoYs[0]!;
  const torsoHi = torsoYs[torsoYs.length - 1]!;
  const legLo = legYsAsc[0]!;
  const legHi = legYsAsc[legYsAsc.length - 1]!;
  const armSecs = parts[3]!.sections;
  const armS = armSecs.slice(capS.length).map((s) => Math.hypot(s.centre[0] - m.arms.left.joint[0], s.centre[1] - m.arms.left.joint[1], s.centre[2] - m.arms.left.joint[2]));
  const armEnvelopeAt = (s: number): { a: number; b: number } | null => {
    if (s > deltoidEnd || s < 0) return null;
    const e = sectionLerp(armSecs.slice(capS.length), armS, s);
    return { a: e.a, b: e.b };
  };

  // The drawn sections as polar outlines (`outlines.ts`), built on first use.
  const torsoOutlineAt = verticalOutlines(torso);
  const legOutlineAt = [verticalOutlines(parts[1]!), verticalOutlines(parts[2]!)];
  const armStacks: Partial<Record<Side, (s: number) => PolarSection | null>> = {};
  const armOutlineAt = (side: Side): ((s: number) => PolarSection | null) => {
    let stack = armStacks[side];
    if (!stack) {
      const part = parts[side === 1 ? 3 : 4]!;
      const f = side === 1 ? m.arms.left : m.arms.right;
      const keys = part.sections.map((sec) => (sec.centre[0] - f.joint[0]) * f.axis[0] + (sec.centre[1] - f.joint[1]) * f.axis[1] + (sec.centre[2] - f.joint[2]) * f.axis[2]);
      const polar = part.sections.map((sec) => {
        const [cu, cv] = sectionCentroid(sec, part.segments);
        return sectionPolar(sec, part.segments, cu, cv);
      });
      // The cap closes to its pole a little above the first section.
      const first = polar[0]!;
      stack = armStacks[side] = polarStack([keys[0]! - 0.12 * rootA, ...keys], [{ cu: first.cu, cv: first.cv, r: first.r.map((x) => 0.02 * x) }, ...polar]);
    }
    return stack;
  };

  return {
    ...m,
    maleShape: 'v2',
    parts,
    rings: m.rings.map(shiftLeg),
    joints,
    landmarks: { ...m.landmarks, legX },
    torsoAt(yy) {
      if (!(yy >= torsoLo && yy <= torsoHi)) return null;
      if (yy > yn) return m.torsoAt(yy);
      const e = sectionLerp(torso.sections, torsoYs, yy);
      return { a: e.a, b: e.b, cx: 0, cz: e.cz };
    },
    legAt(yy, side) {
      if (!(yy >= legLo && yy <= legHi)) return null;
      const e = sectionLerp(legSecsAsc, legYsAsc, yy);
      return { a: e.a, b: e.b, cx: side * legX, cz: e.cz };
    },
    armAt(s, side) {
      const base = m.armAt(s, side);
      const env = armEnvelopeAt(s);
      if (!base || !env) return base;
      return { ...base, a: Math.max(base.a, env.a), b: Math.max(base.b, env.b) };
    },
    outlines: {
      torso: (yy) => (yy >= torsoLo && yy <= torsoHi && (yy <= yn || m.torsoAt(yy)) ? torsoOutlineAt(yy) : null),
      leg: (yy, side) => legOutlineAt[side === 1 ? 0 : 1]!(yy),
      arm: (s, side) => armOutlineAt(side)(s),
    },
  };
}
