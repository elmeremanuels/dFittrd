/**
 * POM builder for men's chinos (men-3d-plan slice M3/M4, the second men's garment after the tee of
 * `pomTee.ts`): the flat garment measurements a shop prints for trousers (waist, front and back
 * rise, seat, thigh, knee, leg opening, inseam, outseam) become ONE welded garment mesh on the
 * canonical mannequin: two leg tubes joined on a crotch seam, a seat and a waistband.
 *
 * Construction (all in cm, mannequin space; no simulation):
 * - **The body** is read through `pomChinoBody.ts`, the same for both male shapes: at a height the outline a ring of
 *   cloth lies on (its hull), from the drawn outlines of a v2 body and from the ellipses of a v1 body.
 * - **Rows** (level, but for the tilted waistband and the crotch row, see below). A row's cross-section is the
 *   body's own outline there, offset until the row's length is the tape's girth (a leg by the same distance all
 *   round; above the legs at most `centreSeamEaseCm` at the centre front and back, the rest at the sides):
 *   `2 × thigh width` round one leg from the crotch down to the thigh line, a straight line to
 *   `2 × knee width` at the knee line and on to `2 × leg opening` at the hem; `2 × seat width` round
 *   both at the seat line, a smooth line to `2 × waist width` at the band, constant over the band.
 *   A measurement tighter than the body is built at the tape's value anyway and recorded (`tight`).
 *   The number of rows per stretch is fixed (`counts`), so every size has the base size's vertices and triangles
 *   and can be shipped as offsets from it.
 * - **The crotch**: at the crotch each leg's ring is cut flat on the centre plane (the fork), and the two legs share
 *   the cut's vertices: that line is the crotch seam under the body. The inseams meet on it at the crotch point,
 *   which lies forward of its middle (a short front fork, a long back fork, as trousers are cut). The seam is built
 *   the way it hangs: the crotch point is its lowest point, and from there it runs straight to where it meets the
 *   body in front and behind (the drawn body on the centre plane), then round the body to the seat line. Below the
 *   crotch each leg's ring rounds off again over `forkBlendCm`.
 * - **The waistband** sits where the fit engine reads the waist of men's trousers: between the body's
 *   natural waist and its seat by the front rise (`wornWaistCm` of `@curtain/fit-engine`: rise 30 cm
 *   or more at the waist, 18 or less at the seat). The band's mid height at the body's axis is put at
 *   that level. Its plane is tilted, lower at the front and higher at the back.
 * - **Lengths are solved, not assumed**: the crotch point's height and the band's tilt so that the
 *   paths along the crotch seam from the crotch point to the band's top edge are the front and the
 *   back rise; the hem's height so that the path down the inseam is the tape's inseam. When the rises
 *   are too short to reach the worn waist with the crotch seam under the body, the seam stays
 *   `minCrotchEaseCm` under the body and the band sits lower (`levels.bandBelowWornCm`, recorded).
 * - **The outseam is not an input the builder can also honour**: band height, both rises and the
 *   inseam already fix the side seam's length. It is taped on the built mesh and reported; the
 *   difference to the chart's value says how consistent the chart is with this body, nothing more.
 *
 * What is measured where is the definition `measurePomChino` checks: waist = length of the band's top
 * edge / 2; seat = girth round both at the seat line / 2; thigh = girth of one leg `thighBelowCrotchCm`
 * under the crotch point / 2; knee = girth of one leg at the knee line / 2; leg opening = hem edge of
 * one leg / 2; front and back rise = along the crotch seam from the crotch point to the band's top
 * edge; inseam = crotch point to hem down the inner leg; outseam = band's top edge to hem down the side.
 *
 * Every number in `POM_CHINO_ASSUMPTIONS` is an assumption [A], not measured on any garment.
 */
import { slice, topology, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import { chinoBody, outlineGirth, outlineRadius, type Outline } from './pomChinoBody';

/** The pattern pieces of the chino, the panels its UV layout keeps apart. */
export const CHINO_PANELS = ['front_l', 'front_r', 'back_l', 'back_r', 'waistband_l', 'waistband_r'] as const;
export type ChinoPanel = (typeof CHINO_PANELS)[number];

/** A chino's flat measurements of one size, cm (widths are half girths, the garment laid flat). */
export interface PomChinoRow {
  /** The size label, `waist/leg` on a W/L chart. */
  size: string;
  /** Flat width of the waistband's top edge. */
  waistWidthCm: number;
  /** Crotch point to the band's top edge along the front crotch seam. */
  frontRiseCm: number;
  /** Crotch point to the band's top edge along the back crotch seam. */
  backRiseCm: number;
  /** Flat width at the seat line. */
  seatWidthCm: number;
  /** Flat width of one leg, `thighBelowCrotchCm` under the crotch point. */
  thighWidthCm: number;
  /** Flat width of one leg at the knee line. */
  kneeWidthCm: number;
  /** Flat width of one leg's hem. */
  legOpeningWidthCm: number;
  /** Crotch point to hem down the inner leg. */
  inseamCm: number;
  /** Band's top edge to hem down the side. Checked, not built to (see the file header). */
  outseamCm: number;
}

/** What the builder needs and no trouser chart gives: all assumed [A]. */
export const POM_CHINO_ASSUMPTIONS = {
  /** Height of the waistband. */
  bandHeightCm: 3.5,
  /** The fit engine's worn-waist rule (`WORN_WAIST_RISE_CM`): the front rise at which the band sits at the natural waist, and at the seat. */
  wornWaistRiseAtWaistCm: 30,
  wornWaistRiseAtSeatCm: 18,
  /** The seat line is the body's hip ring, and at least this far above the crotch point. */
  seatLineMinAboveCrotchCm: 4,
  /** The thigh is taped this far under the crotch point (the usual "1 inch below the crotch"). */
  thighBelowCrotchCm: 2.5,
  /** The knee line is the body's knee ring (a chart would give its distance from the crotch). */
  kneeLine: 'body knee ring',
  /** Half the fork (the flat cut of a leg's ring on the centre plane) over the leg tube's half depth. */
  forkHalfShare: 0.45,
  /** The crotch point lies this share of the fork's half length forward of its middle (a short front fork, a long back fork). */
  forkForwardShare: 0.8,
  /** Along the centre front and the centre back the cloth lies this close to the body; the rest of a girth's ease is at the sides. */
  centreSeamEaseCm: 0.7,
  /** A leg's ring is round again this far under the crotch point. */
  forkBlendCm: 5,
  /** The crotch seam stays at least this far under the body's crotch. */
  minCrotchEaseCm: 0.5,
  /** Where the body leaves room, the cloth is kept at least this far off it between the crotch and the seat line. */
  minEaseCm: 0.5,
  /** Gap between the two legs' cloth at the centre plane, each side. */
  legGapCm: 0.25,
  /** The band's tilt (front lower, back higher by this each) is kept within these. */
  tiltRangeCm: [-2, 6],
  /** The sewn seams (rises, inseams, outseams) stretch at most this much in the drape, % (a felled seam of a woven cloth). */
  seamStretchPct: 1,
  /** Along the grain (the rows and columns of the mesh: weft and warp of a woven twill) the cloth stretches at most this much in the drape, %. */
  grainStretchPct: 2,
  /** … and two neighbours on a row or a column come at most this much closer than they were cut: a woven cloth folds, it does not shorten. */
  grainShortenPct: 0.5,
} as const;

export interface PomChinoOptions {
  /** Columns round one leg (a multiple of 4, default 40) and of those on the fork (even, default 6). */
  legColumns?: number;
  forkColumns?: number;
  /** Row spacing, cm (default 2 on the legs, 1.6 above the crotch). */
  legStepCm?: number;
  torsoStepCm?: number;
  /** Rows per stretch, from another build (`PomChinoBuild.counts`): this build then has that build's vertices and triangles. */
  counts?: PomChinoCounts;
}

/** Rows of cloth per stretch: hem to knee line, knee to where the fork starts, on to the thigh line, on to the crotch; crotch to seat line, seat to the band, the band. */
export interface PomChinoCounts {
  leg: [number, number, number, number];
  torso: [number, number, number];
}

export interface PomChinoLevels {
  /** Where the fit engine reads the waist on this body for this rise, cm above the floor. */
  wornWaistY: number;
  /** The band's top edge at the centre front, the centre back and its mean; its mid height at the axis. */
  bandTopFrontY: number;
  bandTopBackY: number;
  bandTopY: number;
  bandCentreY: number;
  /** How far the band sits under the worn waist because the rises are too short for this body (0 when it sits there). */
  bandBelowWornCm: number;
  /** Half the difference of the band's height between back and front. */
  tiltCm: number;
  seatY: number;
  crotchY: number;
  /** Body crotch minus the crotch point. */
  crotchEaseCm: number;
  thighY: number;
  kneeY: number;
  hemY: number;
}

export interface PomChinoBuild {
  mesh: Mesh;
  row: PomChinoRow;
  /** Rows of vertex ids. `legRows[side][r][j]`: side 0 left (+x), 1 right; r from the hem up to the crotch row (the last, with the fork); column `inseamColumn` is the inseam, `N/2` the outseam. */
  legRows: [number[][], number[][]];
  /** `torsoRows[r][c]`: from the crotch row (the legs' outer arcs) up to the band's top edge; column 0 is the centre front, `T/2` the centre back, `T/4` the left side seam. */
  torsoRows: number[][];
  /** Index into `torsoRows` of the seat line and of the band's lower edge; into `legRows[s]` of the thigh and the knee line. */
  seatRow: number;
  bandRow: number;
  thighRow: number;
  kneeRow: number;
  /** Vertex paths the lengths are taped along: crotch point to the band's top (front, back), crotch point to hem, band's top to hem down the left side. */
  frontRise: number[];
  backRise: number[];
  inseam: number[];
  outseam: number[];
  crotchPoint: number;
  /** The sewn seams as vertex paths: both rises, and the inseam and the outseam of each leg. */
  seams: { name: string; path: number[] }[];
  /** The rows (closed: the first vertex repeated at the end) and the columns of the mesh: the weft and the warp of the cloth. */
  grain: number[][];
  /** The inseam's column on a leg's ring (the outseam's is half way round from column 0). */
  inseamColumn: number;
  /** Panel of every triangle (`CHINO_PANELS` index), in the order of `mesh.indices`. */
  triPanel: Uint8Array;
  /** Rows per stretch of the legs and of the top; a size built with the same counts has the same vertices and triangles. */
  counts: PomChinoCounts;
  levels: PomChinoLevels;
  /** Measurements asked tighter than the body where they sit (the body's girth there, what was asked). Built at the asked value. */
  tight: { where: 'waist' | 'seat' | 'thigh' | 'knee' | 'hem'; y: number; askedCm: number; bodyCm: number }[];
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
type P2 = [number, number];

function ringLength(pts: readonly (readonly number[])[]): number {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    L += Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, (p[2] ?? 0) - (q[2] ?? 0));
  }
  return L;
}

function openLength(pts: readonly (readonly number[])[]): number {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i]![0]! - pts[i + 1]![0]!, pts[i]![1]! - pts[i + 1]![1]!, (pts[i]![2] ?? 0) - (pts[i + 1]![2] ?? 0));
  return L;
}

/** `n` points evenly spaced along a polyline, its ends included. */
function resample(line: readonly P2[], n: number): P2[] {
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
  const total = acc[acc.length - 1]!;
  const out: P2[] = [];
  let k = 1;
  for (let i = 0; i < n; i++) {
    const want = (total * i) / (n - 1);
    while (k < line.length - 1 && acc[k]! < want) k++;
    const span = acc[k]! - acc[k - 1]!;
    const t = span > 0 ? (want - acc[k - 1]!) / span : 0;
    out.push([lerp(line[k - 1]![0], line[k]![0], t), lerp(line[k - 1]![1], line[k]![1], t)]);
  }
  return out;
}

/** Where the fit engine reads a men's trouser waist on this body, as a height: between the waist ring and the hip ring by the front rise. */
export function wornWaistHeight(m: Pick<Mannequin, 'morphHeights'>, frontRiseCm: number): number {
  const A = POM_CHINO_ASSUMPTIONS;
  const f = clamp((A.wornWaistRiseAtWaistCm - frontRiseCm) / (A.wornWaistRiseAtWaistCm - A.wornWaistRiseAtSeatCm), 0, 1);
  return m.morphHeights.waist + f * (m.morphHeights.hip - m.morphHeights.waist);
}

/** The body's girth at a height, cm: a tape round its drawn outline there (the hull of the torso and the legs). */
export function bodyGirthAt(m: Mannequin, y: number): number | null {
  const o = chinoBody(m).round(y);
  return o ? outlineGirth(o) : null;
}

interface Solve {
  /** Crotch point height wanted (may be above the limit: the band is then lowered by the excess). */
  crotchY: number;
  tilt: number;
  hemY: number;
}

export function buildPomChino(m: Mannequin, row: PomChinoRow, options: PomChinoOptions = {}): PomChinoBuild {
  const A = POM_CHINO_ASSUMPTIONS;
  const bodyCrotch = m.landmarks.crotch[1];
  const limit = bodyCrotch - A.minCrotchEaseCm;
  const s: Solve = { crotchY: bodyCrotch - 1.5, tilt: 2, hemY: bodyCrotch - 1.5 - row.inseamCm };
  let b = buildOnce(m, row, s, options);
  // The rows are counted once: the solve moves heights, never the mesh.
  const fixed = { ...options, counts: b.counts };
  for (let it = 0; it < 16; it++) {
    const got = pathLengths(b);
    const eF = row.frontRiseCm - got.frontRiseCm, eB = row.backRiseCm - got.backRiseCm, eI = row.inseamCm - got.inseamCm;
    // Lowering the crotch point lengthens both rises alike; the tilt takes from the front and gives to the back.
    const dy = -(eF + eB) / 2;
    const clampedTilt = clamp(s.tilt + (eB - eF) / 2, A.tiltRangeCm[0], A.tiltRangeCm[1]);
    const tiltMoved = Math.abs(clampedTilt - s.tilt);
    s.crotchY += dy;
    s.tilt = clampedTilt;
    s.hemY += dy - eI;
    if (Math.abs(dy) < 0.004 && tiltMoved < 0.004 && Math.abs(eI) < 0.004) break;
    b = buildOnce(m, row, s, fixed);
  }
  // The crotch seam cannot be above the body: what `crotchY` asks beyond the limit has lowered the band (`buildOnce`).
  void limit;
  return b;
}

function buildOnce(m: Mannequin, row: PomChinoRow, s: Solve, options: PomChinoOptions): PomChinoBuild {
  const A = POM_CHINO_ASSUMPTIONS;
  const B = chinoBody(m);
  const N = options.legColumns ?? 40;
  const K = options.forkColumns ?? 6;
  if (N % 4 !== 0 || K % 2 !== 0 || K >= N / 2) throw new Error(`leg columns ${N} (a multiple of 4) and fork columns ${K} (even, under half) do not fit`);
  const T = 2 * (N - K);
  const H = K / 2;
  // The inseam's column: the fork's vertex nearest `forkForwardShare`, never its front end.
  const JC = Math.min(H - 1, Math.max(0, Math.round(A.forkForwardShare * H)));
  const tight: PomChinoBuild['tight'] = [];

  // --- Levels ------------------------------------------------------------------------------------
  const bodyCrotch = m.landmarks.crotch[1];
  const limit = bodyCrotch - A.minCrotchEaseCm;
  const below = Math.max(0, s.crotchY - limit);
  const crotchY = Math.min(s.crotchY, limit);
  const wornWaistY = wornWaistHeight(m, row.frontRiseCm);
  const bandTopY = wornWaistY + A.bandHeightCm / 2 - below;
  const bandLowY = bandTopY - A.bandHeightCm;
  const seatY = Math.min(bandLowY - 2, Math.max(m.morphHeights.hip, crotchY + A.seatLineMinAboveCrotchCm));
  const thighY = crotchY - A.thighBelowCrotchCm;
  const blendY = crotchY - A.forkBlendCm;
  const hemY = s.hemY;
  const kneeY = m.morphHeights.knee;
  const tilt = s.tilt;
  if (!(hemY < kneeY - 1 && kneeY < blendY - 1)) throw new Error(`size ${row.size}: the knee line (${kneeY.toFixed(1)}) is not between the hem (${hemY.toFixed(1)}) and the fork (${blendY.toFixed(1)})`);

  const gWaist = 2 * row.waistWidthCm, gSeat = 2 * row.seatWidthCm, gThigh = 2 * row.thighWidthCm, gKnee = 2 * row.kneeWidthCm, gHem = 2 * row.legOpeningWidthCm;
  const legGirth = (y: number): number => (y >= thighY ? gThigh : y >= kneeY ? lerp(gKnee, gThigh, (y - kneeY) / (thighY - kneeY)) : lerp(gHem, gKnee, (y - hemY) / (kneeY - hemY)));
  // Seat to band: no corner at the seat line (the hip is round), straight in the middle.
  const torsoGirth = (y: number): number => (y >= bandLowY ? gWaist : lerp(gSeat, gWaist, smooth((y - seatY) / (bandLowY - seatY))));

  /** The offset at which `make(d)` is `girth` long (the ring grows with d). */
  const solveOffset = <P extends readonly number[]>(make: (d: number) => P[], girth: number, lo: number, closed: boolean): P[] => {
    let a = lo, b = 60;
    for (let i = 0; i < 44; i++) {
      const mid = (a + b) / 2;
      if ((closed ? ringLength(make(mid)) : 2 * openLength(make(mid))) < girth) a = mid;
      else b = mid;
    }
    return make((a + b) / 2);
  };

  // --- Rings ---------------------------------------------------------------------------------------
  /** The left leg's ring at height y: the leg's outline offset to the girth; round below the fork, cut flat on the centre plane at the crotch. */
  const legRingAt = (y: number): P2[] => {
    const o = B.leg(y);
    const g = legGirth(y);
    const w = smooth((crotchY - y) / A.forkBlendCm);
    let rMin = Infinity;
    for (let j = 0; j < o.r.length; j++) rMin = Math.min(rMin, o.r[j]!);
    const R = (th: number, d: number): number => Math.max(0.3, outlineRadius(o, th) + d);
    /** Round: column j at the angle π − 2πj/N (0 the inner side, N/4 the front, N/2 the outseam); its inner side kept off the centre plane. */
    const roundRing = (d: number): P2[] => {
      const out: P2[] = [];
      let minX = Infinity;
      for (let j = 0; j < N; j++) {
        const th = Math.PI - (2 * Math.PI * j) / N;
        const r = R(th, d);
        out.push([o.cx + r * Math.cos(th), o.cz + r * Math.sin(th)]);
        minX = Math.min(minX, out[j]![0]);
      }
      const shift = Math.max(0, A.legGapCm - minX);
      if (shift > 0) for (const p of out) p[0] += shift;
      return out;
    };
    /** Forked: the same ring moved to the centre plane and cut flat on it; columns −K/2…K/2 lie on the cut. */
    const forkRing = (d: number): P2[] => {
      const a = R(0, d);
      const kappa = Math.sqrt(1 - A.forkHalfShare * A.forkHalfShare);
      // Wide enough to hold the leg's outer side; never so far out that no cut is left.
      const cx = Math.min(0.97 * a, Math.max(kappa * a, o.cx + outlineRadius(o, 0) + Math.min(d, A.minEaseCm) - a));
      const cross = (t0: number, t1: number): number => {
        // cx + R(θ)·cos θ changes sign between t0 (positive side) and t1.
        let p = t0, q = t1;
        if (cx + R(q, d) * Math.cos(q) > 0) return q;
        for (let i = 0; i < 40; i++) {
          const mid = (p + q) / 2;
          if (cx + R(mid, d) * Math.cos(mid) > 0) p = mid;
          else q = mid;
        }
        return (p + q) / 2;
      };
      const thF = cross(Math.PI / 2, Math.PI), thB = cross((3 * Math.PI) / 2, Math.PI);
      const zF = o.cz + R(thF, d) * Math.sin(thF), zB = o.cz + R(thB, d) * Math.sin(thB);
      const out: P2[] = new Array<P2>(N);
      for (let j = -H; j <= H; j++) out[(j + N) % N] = [0, lerp(zB, zF, (j + H) / K)];
      const sweep = thF - (thB - 2 * Math.PI);
      for (let j = H + 1; j < N - H; j++) {
        const th = thF - ((j - H) / (N - K)) * sweep;
        const r = R(th, d);
        out[j] = [cx + r * Math.cos(th), o.cz + r * Math.sin(th)];
      }
      return out;
    };
    const make = (d: number): P2[] => {
      if (w >= 1) return roundRing(d);
      const f = forkRing(d);
      if (w <= 0) return f;
      const r = roundRing(d);
      return f.map((p, j) => [lerp(p[0], r[j]![0], w), lerp(p[1], r[j]![1], w)] as P2);
    };
    return solveOffset(make, g, -rMin + 0.3, true);
  };

  // --- Rows -----------------------------------------------------------------------------------------
  const legStep = options.legStepCm ?? 2, torsoStep = options.torsoStepCm ?? 1.6;
  const cnt = (len: number, step: number, min = 1): number => Math.max(min, Math.round(len / step));
  const counts: PomChinoCounts = options.counts ?? {
    leg: [cnt(kneeY - hemY, legStep), cnt(blendY - kneeY, legStep), cnt(thighY - blendY, legStep), cnt(crotchY - thighY, legStep)],
    torso: [cnt(seatY - crotchY, torsoStep, 3), cnt(bandLowY - seatY, torsoStep), cnt(bandTopY - bandLowY, torsoStep, 2)],
  };
  const stations = (marks: readonly number[], n: readonly number[]): number[] => {
    const out = [marks[0]!];
    for (let k = 0; k < n.length; k++) for (let i = 1; i <= n[k]!; i++) out.push(lerp(marks[k]!, marks[k + 1]!, i / n[k]!));
    return out;
  };
  const legYs = stations([hemY, kneeY, blendY, thighY, crotchY], counts.leg);
  const torsoYs = stations([crotchY, seatY, bandLowY, bandTopY], counts.torso);
  const kneeRow = counts.leg[0], thighRow = counts.leg[0] + counts.leg[1] + counts.leg[2];
  const seatRow = counts.torso[0], bandRow = counts.torso[0] + counts.torso[1];
  const pos: number[] = [];
  const add = (x: number, y: number, z: number): number => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const half = N - K; // columns from the centre front to the centre back on one side
  const leftCol = (c: number): number => H + c;

  const outOf = (p: P2, o: Outline | null, ease: number): void => {
    if (!o) return;
    const dx = p[0] - o.cx, dz = p[1] - o.cz;
    const r = Math.hypot(dx, dz);
    if (r < 1e-9) return;
    const R = outlineRadius(o, Math.atan2(dz, dx)) + ease;
    if (r >= R) return;
    p[0] = o.cx + (dx * R) / r;
    p[1] = o.cz + (dz * R) / r;
  };

  /** One side (centre front to centre back, left) of the ring round both at height y, evenly spaced along it, in its own tilted plane. */
  const sectionAt = (y: number): Vec3[] => {
    const o = B.round(y) ?? B.round(m.morphHeights.hip)!;
    const g = torsoGirth(y);
    let rMin = Infinity;
    for (let j = 0; j < o.r.length; j++) rMin = Math.min(rMin, o.r[j]!);
    const wt = clamp((y - seatY) / Math.max(1e-6, bandLowY - seatY), 0, 1);
    const DENSE = 96;
    const make = (ds: number): Vec3[] => {
      // Ease beyond `centreSeamEaseCm` goes to the sides: the centre seams lie on the body, as the crotch seam must.
      const db = Math.min(ds, A.centreSeamEaseCm);
      const dense: P2[] = [];
      for (let i = 0; i <= DENSE; i++) {
        const th = Math.PI / 2 - (Math.PI * i) / DENSE;
        const c = Math.cos(th);
        const r = Math.max(0.3, outlineRadius(o, th) + db + (ds - db) * c * c);
        dense.push([i === 0 || i === DENSE ? 0 : r * c, o.cz + r * Math.sin(th)]);
      }
      const even = resample(dense, half + 1);
      const zF = even[0]![1], zB = even[half]![1];
      const zMid = (zF + zB) / 2, zHalf = Math.max(1e-6, (zF - zB) / 2);
      return even.map((p) => [p[0], y - (tilt * wt * (p[1] - zMid)) / zHalf, p[1]] as Vec3);
    };
    return solveOffset(make, g, -rMin + 0.3, false);
  };
  const seatSide = sectionAt(seatY);

  // --- The crotch row and the crotch seam ---------------------------------------------------------------
  // The seam hangs from the body, so it is built the way it hangs: the crotch point is its lowest point, and from there
  // it runs straight (taut) to where it meets the body in front and behind, then round the body to the seat line.
  // A level seam under the body (the first builder) carried the legs on a flat line: it sagged 3.7 cm in the drape and
  // its edges next to the crotch point stretched 37 to 59 %.
  const crotchRing = legRingAt(crotchY);
  const cpZ = crotchRing[JC]![1];
  /** The taut line in the centre plane from the crotch point to the seat line, in front (dir 1) or behind (−1) the body: [z, y] by rising y. */
  const tautChain = (dir: 1 | -1): P2[] => {
    const endZ = dir === 1 ? seatSide[0]![2] : seatSide[half]![2];
    const pts: P2[] = [[cpZ * dir, crotchY]];
    for (let y = Math.max(B.centreLo, crotchY + 0.25); y < seatY - 0.25; y += 0.5) {
      const c = B.centre(y);
      if (c) pts.push([(dir === 1 ? c.front : -c.back) + Math.min(A.minEaseCm, A.centreSeamEaseCm), y]);
    }
    pts.push([endZ * dir, seatY]);
    // The string pulled tight outside the body: the hull of these points on the side of larger z.
    const chain: P2[] = [];
    for (const p of pts) {
      while (chain.length >= 2) {
        const a = chain[chain.length - 2]!, b = chain[chain.length - 1]!;
        if ((b[1] - a[1]) * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1]) >= 0) chain.pop();
        else break;
      }
      chain.push(p);
    }
    return chain.map((p) => [p[0] * dir, p[1]] as P2);
  };
  const front = tautChain(1), back = tautChain(-1);
  /** Height on the first (straight) stretch of a chain at depth z. */
  const onFirst = (chain: P2[], z: number): number => {
    const a = chain[0]!, b = chain[1]!;
    const t = Math.abs(b[0] - a[0]) < 1e-9 ? 0 : clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return lerp(a[1], b[1], t);
  };
  /** The point at share w of the length of a chain from the height y0 on its first stretch up to its end. */
  const alongChain = (chain: P2[], z0: number, w: number): P2 => {
    const start: P2 = [clamp(z0, Math.min(chain[0]![0], chain[1]![0]), Math.max(chain[0]![0], chain[1]![0])), onFirst(chain, z0)];
    const line = [start, ...chain.slice(1)];
    let total = 0;
    for (let i = 0; i + 1 < line.length; i++) total += Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1]);
    let want = w * total;
    for (let i = 0; i + 1 < line.length; i++) {
      const L = Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1]);
      if (want <= L || i + 2 === line.length) return [lerp(line[i]![0], line[i + 1]![0], L > 0 ? Math.min(1, want / L) : 0), lerp(line[i]![1], line[i + 1]![1], L > 0 ? Math.min(1, want / L) : 0)];
      want -= L;
    }
    return line[line.length - 1]!;
  };
  // Heights of the crotch row: the fork's vertices on the taut lines, the outer arcs next to them eased back to level.
  const crotchRowY: number[] = new Array<number>(N).fill(crotchY);
  for (let j = -H; j <= H; j++) crotchRowY[(j + N) % N] = j === JC ? crotchY : j > JC ? onFirst(front, crotchRing[(j + N) % N]![1]) : onFirst(back, crotchRing[(j + N) % N]![1]);
  const Q = Math.max(2, Math.round(half / 6));
  const fall = (t: number): number => (t >= 1 ? 0 : Math.cos((Math.PI * t) / 2) ** 2);
  const liftF = crotchRowY[H]! - crotchY, liftB = crotchRowY[N - H]! - crotchY;
  for (let c = 1; c < half; c++) crotchRowY[leftCol(c)] = crotchY + liftF * fall(c / Q) + liftB * fall((half - c) / Q);

  const legRows: [number[][], number[][]] = [[], []];
  const onFork = (j: number): boolean => j <= H || j >= N - H;
  for (let r = 0; r < legYs.length; r++) {
    const y = legYs[r]!;
    const top = r === legYs.length - 1;
    const ring = top ? crotchRing : legRingAt(y);
    const left = ring.map((p, j) => add(p[0], top ? crotchRowY[j]! : y, p[1]));
    // The right leg mirrors the left; on the crotch row the fork's vertices are shared (the crotch seam).
    const right = ring.map((p, j) => (top && onFork(j) ? left[j]! : add(-p[0], top ? crotchRowY[j]! : y, p[1])));
    legRows[0].push(left);
    legRows[1].push(right);
  }
  const crotchLeft = legRows[0][legYs.length - 1]!, crotchRight = legRows[1][legYs.length - 1]!;
  const peanut: Vec3[] = [];
  for (let c = 0; c <= half; c++) peanut.push([pos[3 * crotchLeft[leftCol(c)]!]!, pos[3 * crotchLeft[leftCol(c)]! + 1]!, pos[3 * crotchLeft[leftCol(c)]! + 2]!]);

  const torsoRows: number[][] = [];
  for (let r = 0; r < torsoYs.length; r++) {
    const y = torsoYs[r]!;
    if (r === 0) {
      const ids: number[] = [];
      for (let c = 0; c <= half; c++) ids.push(crotchLeft[leftCol(c)]!);
      for (let c = half - 1; c >= 1; c--) ids.push(crotchRight[leftCol(c)]!);
      torsoRows.push(ids);
      continue;
    }
    let side: Vec3[];
    if (r < seatRow) {
      // From the legs' outer arcs straight to the seat's section, and out of the body where that cuts into its underside;
      // the centre front and back on the taut lines.
      const w = r / seatRow;
      side = peanut.map((p, c) => {
        if (c === 0 || c === half) {
          const q = alongChain(c === 0 ? front : back, p[2], w);
          return [0, q[1], q[0]] as Vec3;
        }
        const yy = lerp(p[1], seatY, w);
        const q: P2 = [lerp(p[0], seatSide[c]![0], w), lerp(p[2], seatSide[c]![2], w)];
        if (yy <= B.legHi) outOf(q, B.legDrawn(yy), A.minEaseCm);
        outOf(q, B.torsoDrawn(yy), A.minEaseCm);
        return [Math.max(q[0], 0.05), yy, q[1]] as Vec3;
      });
    } else side = r === seatRow ? seatSide : sectionAt(y);
    const leftIds = side.map((p) => add(p[0], p[1], p[2]));
    const ids = [...leftIds];
    for (let c = half - 1; c >= 1; c--) ids.push(add(-side[c]![0], side[c]![1], side[c]![2]));
    torsoRows.push(ids);
  }

  // --- What is tighter than the body ---------------------------------------------------------------
  const tightIf = (where: PomChinoBuild['tight'][number]['where'], y: number, asked: number, body: number | null): void => {
    if (body !== null && asked < body) tight.push({ where, y: Math.round(y * 10) / 10, askedCm: Math.round(asked * 10) / 10, bodyCm: Math.round(body * 10) / 10 });
  };
  const legBodyGirth = (y: number): number => outlineGirth(B.leg(y));
  tightIf('waist', bandTopY - A.bandHeightCm / 2, gWaist, bodyGirthAt(m, bandTopY - A.bandHeightCm / 2));
  tightIf('seat', seatY, gSeat, bodyGirthAt(m, seatY));
  tightIf('thigh', thighY, gThigh, legBodyGirth(thighY));
  tightIf('knee', kneeY, gKnee, legBodyGirth(kneeY));
  if (hemY > B.legLo) tightIf('hem', hemY, gHem, legBodyGirth(hemY));

  // --- Triangles and panels -------------------------------------------------------------------------
  const tris: number[] = [];
  const panels: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean, panel: number): void => {
    // a–b on the lower row, d–c above them. Skip the degenerate half of a quad that shares vertices.
    const put = (i: number, j: number, k: number): void => {
      if (i === j || j === k || i === k) return;
      if (flip) tris.push(i, k, j);
      else tris.push(i, j, k);
      panels.push(panel);
    };
    put(a, b, c);
    put(a, c, d);
  };
  for (let side = 0; side < 2; side++) {
    const rows = legRows[side]!;
    for (let r = 0; r + 1 < rows.length; r++) for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      // Columns from the inseam's forward to the outseam are the front, the rest the back.
      const panel = j >= JC && j < N / 2 ? (side === 0 ? 0 : 1) : side === 0 ? 2 : 3;
      quad(rows[r]![j]!, rows[r]![j1]!, rows[r + 1]![j1]!, rows[r + 1]![j]!, side === 1, panel);
    }
  }
  for (let r = 0; r + 1 < torsoRows.length; r++) for (let c = 0; c < T; c++) {
    const c1 = (c + 1) % T;
    const band = r >= bandRow && bandRow > 0;
    const panel = band ? (c < half ? 4 : 5) : c < half / 2 ? 0 : c < half ? 2 : c < half + half / 2 ? 3 : 1;
    quad(torsoRows[r]![c]!, torsoRows[r]![c1]!, torsoRows[r + 1]![c1]!, torsoRows[r + 1]![c]!, false, panel);
  }
  // Outward: the first leg quad's normal must point away from the leg's axis; flip everything when it does not.
  const positions = Float64Array.from(pos);
  {
    const i = tris[0]!, j = tris[1]!, k = tris[2]!;
    const ux = positions[3 * j]! - positions[3 * i]!, uy = positions[3 * j + 1]! - positions[3 * i + 1]!, uz = positions[3 * j + 2]! - positions[3 * i + 2]!;
    const vx = positions[3 * k]! - positions[3 * i]!, vy = positions[3 * k + 1]! - positions[3 * i + 1]!, vz = positions[3 * k + 2]! - positions[3 * i + 2]!;
    const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
    const e = B.leg(legYs[0]!);
    const cxm = (positions[3 * i]! + positions[3 * j]! + positions[3 * k]!) / 3 - Math.max(e.cx, 0), czm = (positions[3 * i + 2]! + positions[3 * j + 2]! + positions[3 * k + 2]!) / 3 - e.cz;
    if (nx * cxm + nz * czm < 0) for (let t = 0; t < tris.length; t += 3) {
      const tmp = tris[t + 1]!;
      tris[t + 1] = tris[t + 2]!;
      tris[t + 2] = tmp;
    }
  }
  const mesh: Mesh = { positions, indices: Uint32Array.from(tris), vertexPart: new Uint8Array(positions.length / 3), partNames: ['chino'] };

  // --- Paths -----------------------------------------------------------------------------------------
  const crotchPoint = crotchLeft[JC]!;
  const frontRise = [crotchPoint];
  for (let j = JC + 1; j <= H; j++) frontRise.push(crotchLeft[j]!);
  for (let r = 1; r < torsoRows.length; r++) frontRise.push(torsoRows[r]![0]!);
  const backRise = [crotchPoint];
  for (let j = JC - 1; j >= -H; j--) backRise.push(crotchLeft[(j + N) % N]!);
  for (let r = 1; r < torsoRows.length; r++) backRise.push(torsoRows[r]![half]!);
  const inseam: number[] = [];
  for (let r = legRows[0].length - 1; r >= 0; r--) inseam.push(legRows[0][r]![JC]!);
  const outseam: number[] = [];
  for (let r = torsoRows.length - 1; r >= 1; r--) outseam.push(torsoRows[r]![half / 2]!);
  for (let r = legRows[0].length - 1; r >= 0; r--) outseam.push(legRows[0][r]![N / 2]!);

  const inseamR: number[] = [], outseamR: number[] = [];
  for (let r = legRows[1].length - 1; r >= 0; r--) inseamR.push(legRows[1][r]![JC]!);
  for (let r = torsoRows.length - 1; r >= 1; r--) outseamR.push(torsoRows[r]![T - half / 2]!);
  for (let r = legRows[1].length - 1; r >= 0; r--) outseamR.push(legRows[1][r]![N / 2]!);
  const seams = [
    { name: 'front rise', path: frontRise },
    { name: 'back rise', path: backRise },
    { name: 'inseam left', path: inseam },
    { name: 'inseam right', path: inseamR },
    { name: 'outseam left', path: outseam },
    { name: 'outseam right', path: outseamR },
  ];
  const grain: number[][] = [];
  for (const rows of [legRows[0], legRows[1], torsoRows]) for (const row of rows) grain.push([...row, row[0]!]);
  for (let side = 0; side < 2; side++) for (let j = 0; j < N; j++) grain.push(legRows[side]!.map((row) => row[j]!));
  for (let c = 0; c < T; c++) grain.push(torsoRows.map((row) => row[c]!));
  const top = torsoRows[torsoRows.length - 1]!;
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return {
    mesh,
    row,
    legRows,
    torsoRows,
    seatRow,
    bandRow,
    thighRow,
    kneeRow,
    frontRise,
    backRise,
    inseam,
    outseam,
    crotchPoint,
    seams,
    grain,
    inseamColumn: JC,
    triPanel: Uint8Array.from(panels),
    counts,
    levels: {
      wornWaistY: r2(wornWaistY),
      bandTopFrontY: r2(positions[3 * top[0]! + 1]!),
      bandTopBackY: r2(positions[3 * top[half]! + 1]!),
      bandTopY: r2(bandTopY),
      bandCentreY: r2(bandTopY - A.bandHeightCm / 2),
      bandBelowWornCm: r2(below),
      tiltCm: r2(tilt),
      seatY: r2(seatY),
      crotchY: r2(crotchY),
      crotchEaseCm: r2(bodyCrotch - crotchY),
      thighY: r2(thighY),
      kneeY: r2(kneeY),
      hemY: r2(hemY),
    },
    tight,
  };
}

// ---------------------------------------------------------------------------
// The tape on a built (or graded, or draped) chino
// ---------------------------------------------------------------------------

type Ids = Pick<PomChinoBuild, 'legRows' | 'torsoRows' | 'seatRow' | 'thighRow' | 'kneeRow' | 'frontRise' | 'backRise' | 'inseam' | 'outseam'>;

function pathLength(p: ArrayLike<number>, ids: readonly number[], closed = false): number {
  let L = 0;
  const n = closed ? ids.length : ids.length - 1;
  for (let i = 0; i < n; i++) {
    const a = ids[i]!, c = ids[(i + 1) % ids.length]!;
    L += Math.hypot(p[3 * a]! - p[3 * c]!, p[3 * a + 1]! - p[3 * c + 1]!, p[3 * a + 2]! - p[3 * c + 2]!);
  }
  return L;
}

function pathLengths(b: Pick<PomChinoBuild, 'mesh' | 'frontRise' | 'backRise' | 'inseam' | 'outseam'>): Pick<PomChinoRow, 'frontRiseCm' | 'backRiseCm' | 'inseamCm' | 'outseamCm'> {
  const p = b.mesh.positions;
  return { frontRiseCm: pathLength(p, b.frontRise), backRiseCm: pathLength(p, b.backRise), inseamCm: pathLength(p, b.inseam), outseamCm: pathLength(p, b.outseam) };
}

/**
 * The cloth's own tape: every measurement along the garment's own rows and seams (vertex paths), so it holds on a graded
 * or draped copy too (`positions`, default the build's): a row of cloth keeps its vertices wherever it hangs.
 */
export function measurePomChino(b: Ids & { mesh: Pick<Mesh, 'positions'> }, positions: ArrayLike<number> = b.mesh.positions, size = ''): PomChinoRow {
  const top = b.torsoRows[b.torsoRows.length - 1]!;
  const leg = b.legRows[0];
  return {
    size,
    waistWidthCm: pathLength(positions, top, true) / 2,
    frontRiseCm: pathLength(positions, b.frontRise),
    backRiseCm: pathLength(positions, b.backRise),
    seatWidthCm: pathLength(positions, b.torsoRows[b.seatRow]!, true) / 2,
    thighWidthCm: b.thighRow >= 0 ? pathLength(positions, leg[b.thighRow]!, true) / 2 : NaN,
    kneeWidthCm: b.kneeRow >= 0 ? pathLength(positions, leg[b.kneeRow]!, true) / 2 : NaN,
    legOpeningWidthCm: pathLength(positions, leg[0]!, true) / 2,
    inseamCm: pathLength(positions, b.inseam),
    outseamCm: pathLength(positions, b.outseam),
  };
}

/**
 * The three girths that have a level line, taken again by cutting the mesh with a level plane (no vertex ids: an
 * independent reading of the built mesh): seat round both legs' cloth at the seat line, thigh and knee round the left leg.
 * Half girths, cm; NaN where the plane cuts no closed loop.
 */
export function sliceChinoGirths(b: Pick<PomChinoBuild, 'mesh' | 'levels'>): Pick<PomChinoRow, 'seatWidthCm' | 'thighWidthCm' | 'kneeWidthCm'> {
  const { positions, indices } = b.mesh;
  const loopLen = (pts: readonly Vec3[]): number => ringLength(pts);
  const at = (y: number, leftOnly: boolean): number => {
    const filter = leftOnly ? (t: number): boolean => positions[3 * indices[3 * t]!]! + positions[3 * indices[3 * t + 1]!]! + positions[3 * indices[3 * t + 2]!]! > 0 : undefined;
    const loops = slice(positions, indices, { origin: [0, y - 0.02, 0], normal: [0, 1, 0] }, filter).filter((l) => l.closed);
    if (loops.length === 0) return NaN;
    return Math.max(...loops.map((l) => loopLen(l.points))) / 2;
  };
  return { seatWidthCm: at(b.levels.seatY, false), thighWidthCm: at(b.levels.thighY, true), kneeWidthCm: at(b.levels.kneeY, true) };
}

export { topology };
