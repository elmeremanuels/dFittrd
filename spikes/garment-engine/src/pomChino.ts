/**
 * POM builder for men's chinos (men-3d-plan slice M3/M4, the second men's garment after the tee of
 * `pomTee.ts`): the flat garment measurements a shop prints for trousers (waist, front and back
 * rise, seat, thigh, knee, leg opening, inseam, outseam) become ONE welded garment mesh on the
 * canonical mannequin: two leg tubes joined on a crotch seam, a seat and a waistband.
 *
 * Construction (all in cm, mannequin space; no simulation):
 * - **Rows of constant height** (the waistband is tilted, see below). A row's cross-section is the
 *   body's own section there, offset until its girth is the tape's (a leg by the same distance all
 *   round; above the legs at most `centreSeamEaseCm` at the centre front and back, the rest at the sides):
 *   `2 × thigh width` round one leg from the crotch down to the thigh line, a straight line to
 *   `2 × knee width` at the knee line and on to `2 × leg opening` at the hem; `2 × seat width` round
 *   both at the seat line, a smooth line to `2 × waist width` at the band, constant over the band.
 *   A measurement tighter than the body is built at the tape's value anyway and recorded (`tight`).
 * - **The crotch**: at the crotch level each leg's ring is cut flat on the centre plane (a chord,
 *   the fork), and the two legs share the chord's vertices: that line is the crotch seam under the
 *   body, running from the front fork point to the back fork point. The inseams meet on it at the
 *   crotch point, which lies forward of its middle (a short front fork, a long back fork, as trousers
 *   are cut); so the inseam runs a little forward of the leg's innermost line and the back piece is the wider. Above it the two outer arcs form one ring that opens into the seat's section; below it
 *   each leg's ring rounds off again over `forkBlendCm`.
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
import { ellipseCircumference } from '@curtain/anchors';
import { slice, topology, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';

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
} as const;

export interface PomChinoOptions {
  /** Columns round one leg (a multiple of 4, default 40) and of those on the fork (even, default 6). */
  legColumns?: number;
  forkColumns?: number;
  /** Row spacing, cm (default 2 on the legs, 1.6 above the crotch). */
  legStepCm?: number;
  torsoStepCm?: number;
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
  /** The inseam's column on a leg's ring (the outseam's is half way round from column 0). */
  inseamColumn: number;
  /** Panel of every triangle (`CHINO_PANELS` index), in the order of `mesh.indices`. */
  triPanel: Uint8Array;
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

/** Offset `d` such that the ellipse (a0 + d, b0 + d) has the circumference `girth` (negative when the girth is under the body's). */
function offsetFor(a0: number, b0: number, girth: number): number {
  let lo = -Math.min(a0, b0) + 0.3, hi = 80;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (ellipseCircumference(a0 + mid, b0 + mid) < girth) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function ringLength(pts: readonly (readonly number[])[]): number {
  let L = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    L += Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, (p[2] ?? 0) - (q[2] ?? 0));
  }
  return L;
}

/** Rows from `lo` up to `hi` about `step` apart, every `required` height present exactly. */
function rowsAsc(lo: number, hi: number, step: number, required: readonly number[]): number[] {
  const n = Math.max(1, Math.round((hi - lo) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n);
  const req = required.filter((r) => r > lo + 1e-6 && r < hi - 1e-6);
  const kept = out.filter((x, i) => i === 0 || i === n || req.every((r) => Math.abs(x - r) > step * 0.4));
  return [...kept, ...req].sort((p, q) => p - q).filter((x, i, a) => i === 0 || x - a[i - 1]! > 1e-6);
}

/** Where the fit engine reads a men's trouser waist on this body, as a height: between the waist ring and the hip ring by the front rise. */
export function wornWaistHeight(m: Pick<Mannequin, 'morphHeights'>, frontRiseCm: number): number {
  const A = POM_CHINO_ASSUMPTIONS;
  const f = clamp((A.wornWaistRiseAtWaistCm - frontRiseCm) / (A.wornWaistRiseAtWaistCm - A.wornWaistRiseAtSeatCm), 0, 1);
  return m.morphHeights.waist + f * (m.morphHeights.hip - m.morphHeights.waist);
}

/** The body's girth at a height above the legs (its torso section), cm. */
export function bodyGirthAt(m: Pick<Mannequin, 'torsoAt'>, y: number): number | null {
  const e = m.torsoAt(y);
  return e ? ellipseCircumference(e.a, e.b) : null;
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
  for (let it = 0; it < 12; it++) {
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
    b = buildOnce(m, row, s, options);
  }
  // The crotch seam cannot be above the body: what `crotchY` asks beyond the limit has lowered the band (`buildOnce`).
  void limit;
  return b;
}

function buildOnce(m: Mannequin, row: PomChinoRow, s: Solve, options: PomChinoOptions): PomChinoBuild {
  const A = POM_CHINO_ASSUMPTIONS;
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
  const hemY = s.hemY;
  const kneeY = m.morphHeights.knee;
  const tilt = s.tilt;

  // --- Body sections ------------------------------------------------------------------------------
  let legHi = m.morphHeights.hip, legLo = 0;
  while (!m.legAt(legHi, 1) && legHi > 0) legHi -= 0.05;
  while (!m.legAt(legLo, 1) && legLo < legHi) legLo += 0.05;
  // Below the ankle ring the leg's section turns into the foot (longer, further forward): the tube keeps the ankle's
  // section down to its hem and hangs straight; where the foot stands out of it, the drape lays the hem on the foot.
  const legBody = (y: number) => m.legAt(clamp(Math.max(y, Math.min(m.morphHeights.ankle, legHi)), legLo, legHi), 1)!;
  const torsoBody = (y: number) => m.torsoAt(y);

  const gWaist = 2 * row.waistWidthCm, gSeat = 2 * row.seatWidthCm, gThigh = 2 * row.thighWidthCm, gKnee = 2 * row.kneeWidthCm, gHem = 2 * row.legOpeningWidthCm;
  const legGirth = (y: number): number => {
    if (y >= thighY) return gThigh;
    if (kneeY < thighY - 1 && kneeY > hemY + 1) return y >= kneeY ? lerp(gKnee, gThigh, (y - kneeY) / (thighY - kneeY)) : lerp(gHem, gKnee, (y - hemY) / (kneeY - hemY));
    return lerp(gHem, gThigh, clamp((y - hemY) / (thighY - hemY), 0, 1));
  };
  // Seat to band: no corner at the seat line (the hip is round), straight in the middle.
  const torsoGirth = (y: number): number => (y >= bandLowY ? gWaist : lerp(gSeat, gWaist, smooth((y - seatY) / (bandLowY - seatY))));

  // --- Rings ---------------------------------------------------------------------------------------
  /** The round ring of the left leg at height y: the leg's section offset to the girth, its inner side kept off the centre plane. */
  const roundRing = (y: number, girth: number, k = 1): P2[] => {
    const e = legBody(y);
    const d = offsetFor(e.a, e.b, girth);
    const a = (e.a + d) * k, bb = (e.b + d) * k;
    const cx = Math.max(e.cx, a + A.legGapCm);
    const out: P2[] = [];
    for (let j = 0; j < N; j++) {
      const phi = (2 * Math.PI * j) / N;
      out.push([cx - a * Math.cos(phi), e.cz + bb * Math.sin(phi)]);
    }
    return out;
  };
  /** The forked ring: the same section moved to the centre plane and cut flat on it; columns −K/2…K/2 lie on the cut. */
  const forkRing = (y: number, girth: number, k = 1): P2[] => {
    const e = legBody(y);
    const d = offsetFor(e.a, e.b, girth);
    const a = (e.a + d) * k, bb = (e.b + d) * k;
    const kappa = Math.sqrt(1 - A.forkHalfShare * A.forkHalfShare);
    // Wide enough to hold the leg's outer side; never so far out that no cut is left.
    const cx = Math.min(0.97 * a, Math.max(kappa * a, e.cx + e.a + Math.min(d, A.minEaseCm) - a));
    const psi0 = Math.acos(cx / a);
    const h = bb * Math.sin(psi0);
    const out: P2[] = new Array<P2>(N);
    for (let j = -H; j <= H; j++) out[(j + N) % N] = [0, e.cz + (h * j) / H];
    for (let j = H + 1; j < N - H; j++) {
      const psi = psi0 + ((j - H) / (N - K)) * (2 * Math.PI - 2 * psi0);
      out[j] = [cx - a * Math.cos(psi), e.cz + bb * Math.sin(psi)];
    }
    return out;
  };
  /** Scale factor `k` of a ring maker so that the ring's length is the girth (two fixed-point steps are within 0.001 cm). */
  const fitted = (make: (k: number) => P2[], girth: number): P2[] => {
    let k = 1;
    for (let i = 0; i < 4; i++) k *= girth / ringLength(make(k));
    return make(k);
  };
  const legRingAt = (y: number): P2[] => {
    const g = legGirth(y);
    const w = smooth((crotchY - y) / A.forkBlendCm);
    if (w >= 1) return fitted((k) => roundRing(y, g, k), g);
    const mix = (k: number): P2[] => {
      const f = forkRing(y, g, k), r = roundRing(y, g, k);
      return f.map((p, j) => [lerp(p[0], r[j]![0], w), lerp(p[1], r[j]![1], w)] as P2);
    };
    return fitted(mix, g);
  };

  // --- Rows -----------------------------------------------------------------------------------------
  const legYs = rowsAsc(hemY, crotchY, options.legStepCm ?? 2, [kneeY, thighY, crotchY - A.forkBlendCm]);
  const torsoYs = rowsAsc(crotchY, bandTopY, options.torsoStepCm ?? 1.6, [seatY, bandLowY]);
  const pos: number[] = [];
  const add = (x: number, y: number, z: number): number => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const legRows: [number[][], number[][]] = [[], []];
  const onFork = (j: number): boolean => j <= H || j >= N - H;
  for (let r = 0; r < legYs.length; r++) {
    const y = legYs[r]!;
    const ring = legRingAt(y);
    const top = r === legYs.length - 1;
    const left = ring.map((p) => add(p[0], y, p[1]));
    // The right leg mirrors the left; on the crotch row the fork's vertices are shared (the crotch seam).
    const right = ring.map((p, j) => (top && onFork(j) ? left[j]! : add(-p[0], y, p[1])));
    legRows[0].push(left);
    legRows[1].push(right);
  }
  const crotchLeft = legRows[0][legYs.length - 1]!, crotchRight = legRows[1][legYs.length - 1]!;
  const half = N - K; // columns from the centre front to the centre back on one side
  const leftCol = (c: number): number => H + c;
  const peanut: P2[] = [];
  for (let c = 0; c <= half; c++) peanut.push([pos[3 * crotchLeft[leftCol(c)]!]!, pos[3 * crotchLeft[leftCol(c)]! + 2]!]);

  /** One side (centre front to centre back, left) of the ring above the seat line at height y, in its own tilted plane. */
  const sectionSide = (y: number, k: number): Vec3[] => {
    const e = torsoBody(y) ?? torsoBody(m.morphHeights.hip)!;
    const g = torsoGirth(y);
    const d = offsetFor(e.a, e.b, g);
    // Ease beyond `centreSeamEaseCm` goes to the sides: the centre seams lie on the body, as the crotch seam must.
    const db = Math.min(d, A.centreSeamEaseCm);
    const bb = (e.b + db) * k;
    let lo = e.a + d, hi = e.a + d + 40;
    if (db < d) for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (ellipseCircumference(mid, e.b + db) < g) lo = mid;
      else hi = mid;
    }
    const a = lo * k;
    const wt = clamp((y - seatY) / Math.max(1e-6, bandLowY - seatY), 0, 1);
    const out: Vec3[] = [];
    for (let c = 0; c <= half; c++) {
      const al = (Math.PI * c) / half;
      out.push([a * Math.sin(al), y - tilt * wt * Math.cos(al), e.cz + bb * Math.cos(al)]);
    }
    return out;
  };
  const fullRing = (side: Vec3[]): Vec3[] => [...side, ...side.slice(1, -1).reverse().map((p) => [-p[0], p[1], p[2]] as Vec3)];
  const sectionAt = (y: number): Vec3[] => {
    let k = 1;
    const g = torsoGirth(y);
    for (let i = 0; i < 4; i++) k *= g / ringLength(fullRing(sectionSide(y, k)));
    return sectionSide(y, k);
  };
  const seatSide = sectionAt(seatY);

  const outOf = (p: P2, e: { cx: number; cz: number; a: number; b: number } | null, ease: number): void => {
    if (!e) return;
    const dx = p[0] - e.cx, dz = p[1] - e.cz;
    const q = (dx * dx) / ((e.a + ease) * (e.a + ease)) + (dz * dz) / ((e.b + ease) * (e.b + ease));
    if (q >= 1 || q < 1e-12) return;
    const f = 1 / Math.sqrt(q);
    p[0] = e.cx + dx * f;
    p[1] = e.cz + dz * f;
  };

  const torsoRows: number[][] = [];
  let seatRow = 0, bandRow = 0;
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
    if (y < seatY - 1e-6) {
      // From the legs' outer arcs straight to the seat's section, and out of the body where that cuts into its underside:
      // the crotch seam is then as short as the body lets it be, so the drape cannot straighten it and let the crotch drop.
      const w = (y - crotchY) / (seatY - crotchY);
      side = peanut.map((p, c) => {
        const q: P2 = [lerp(p[0], seatSide[c]![0], w), lerp(p[1], seatSide[c]![2], w)];
        const centre = c === 0 || c === half;
        if (!centre) outOf(q, m.legAt(y, 1), A.minEaseCm);
        outOf(q, torsoBody(y), A.minEaseCm);
        return [centre ? 0 : Math.max(q[0], 0.05), y, q[1]] as Vec3;
      });
    } else side = sectionAt(y);
    if (Math.abs(y - seatY) < 1e-6) seatRow = r;
    if (Math.abs(y - bandLowY) < 1e-6) bandRow = r;
    const leftIds = side.map((p) => add(p[0], p[1], p[2]));
    const ids = [...leftIds];
    for (let c = half - 1; c >= 1; c--) ids.push(add(-side[c]![0], side[c]![1], side[c]![2]));
    torsoRows.push(ids);
  }

  // --- What is tighter than the body ---------------------------------------------------------------
  const tightIf = (where: PomChinoBuild['tight'][number]['where'], y: number, asked: number, body: number | null): void => {
    if (body !== null && asked < body) tight.push({ where, y: Math.round(y * 10) / 10, askedCm: Math.round(asked * 10) / 10, bodyCm: Math.round(body * 10) / 10 });
  };
  const legBodyGirth = (y: number): number => ellipseCircumference(legBody(y).a, legBody(y).b);
  tightIf('waist', bandTopY - A.bandHeightCm / 2, gWaist, bodyGirthAt(m, bandTopY - A.bandHeightCm / 2));
  tightIf('seat', seatY, gSeat, bodyGirthAt(m, seatY));
  tightIf('thigh', thighY, gThigh, legBodyGirth(thighY));
  if (kneeY > hemY) tightIf('knee', kneeY, gKnee, legBodyGirth(kneeY));
  if (hemY > legLo) tightIf('hem', hemY, gHem, legBodyGirth(hemY));

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
    const e = legBody(legYs[0]!);
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

  const thighRow = legYs.findIndex((y) => Math.abs(y - thighY) < 1e-6);
  const kneeRow = legYs.findIndex((y) => Math.abs(y - kneeY) < 1e-6);
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
    inseamColumn: JC,
    triPanel: Uint8Array.from(panels),
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
