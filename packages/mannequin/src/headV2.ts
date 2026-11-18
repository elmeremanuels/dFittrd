/**
 * Head v2 (`buildMannequinMesh(m, { head: 'neutral-v2' })`): the neutral standard head of `head.ts`
 * with clearer generic features, for the look review of 18 Nov 2026. Opt-in; the `neutral` head and
 * the default `egg` mesh are not changed.
 *
 * What is new against v1:
 * - **Open eyes**: an eyeball in each socket with an upper and a lower lid, a lid crease and a
 *   sculpted iris and pupil, as on a shop-window mannequin (`eyeRelief`).
 * - **Brows**: a raised band over each eye on the brow ridge, and a darker shade there (`vertexShade`).
 * - **Nose**: a defined bridge and tip whose underside slopes gently into the upper lip, so it casts
 *   no dark patch under the nose (v1's base ended in a near-horizontal step that read as a moustache).
 * - **Ears**: a rim, a hollow and a lobe on each side (`earRelief`), not a lump.
 * - **Jaw and brow differ by family**: the male head has a wider, squarer jaw and chin, a heavier and
 *   lower brow ridge and flatter brows; the female head a narrower jaw, a rounder chin, higher arched
 *   brows and slightly fuller lips. Nothing else differs.
 * - **No neck seam**: the head runs down into a short tube that follows the neck and enters it at a
 *   shallow angle below the chin, so there is no collar edge where the head meets the neck. The
 *   torso's neck has no flare towards the old egg for this head (`mesh.ts`).
 * - **More rows and columns where the features are** (the face band and the ears), so the features
 *   are not blurred by the grid.
 *
 * Own geometry only, as v1: hand-written profile curves and smooth bumps, no scan, photo,
 * measurement of a person, SMPL, FLAME or any other face or body model. One generic face per
 * family, never a likeness of anyone. No hair.
 */
import { monotoneProfile } from '@curtain/anchors';
import { HEAD_LEVELS } from './head';
import { levelWarp, type Mannequin } from './model';

/** Height of the unit head (chin 0, top 22), cm before scaling, as v1. */
const UNIT = 22;
/** The tube of the head reaches this far below the torso's neck ring (unit cm), where the torso is already wider. */
export const V2_TUBE_BELOW_RING = 2.2;

/** Landmarks of the v2 unit head: height above the chin, and the eye centre's distance from the middle. */
export const FACE_LEVELS_V2 = { eyes: 11, brow: 12.55, noseTip: 8.15, noseBase: 7.25, mouth: 5.25, eyeX: 3.15 } as const;

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const gauss = (d: number, sigma: number): number => Math.exp(-0.5 * (d / sigma) * (d / sigma));
const spow = (v: number, e: number): number => Math.sign(v) * Math.abs(v) ** e;

interface Family {
  male: boolean;
  /** Head knots above the chin's tube blend: height, front, back, half-width. */
  knots: readonly (readonly [y: number, front: number, back: number, halfWidth: number])[];
  /** Exponent of the front half of a section by height (2 = ellipse; more = squarer jaw). */
  boxy: (y: number) => number;
}

const DOME_FROM = 14;
const DOME = [9.4, -9.6, 7.6] as const;

/** Female: narrower jaw (gonion half-width 5.7), rounder chin. */
const FEMALE: Family = {
  male: false,
  knots: [
    [1.0, 7.1, -5.25, 5.25],
    [1.6, 7.95, -5.3, 5.45],
    [2.5, 8.5, -5.35, 5.6],
    [3.6, 8.7, -5.45, 5.75],
    [5, 8.9, -6.0, 6.05],
    [7, 9.1, -7.6, 6.6],
    [9, 9.0, -8.8, 7.05],
    [11, 8.95, -9.35, 7.4],
    [12.5, 9.2, -9.55, 7.55],
  ],
  boxy: (y) => 1.85 + 0.6 * smooth(2.5, 6, y) - 0.45 * smooth(12, 16, y),
};

/** Male: wider, squarer jaw and chin (gonion half-width 6.55), a little more chin forward. */
const MALE: Family = {
  male: true,
  knots: [
    [1.0, 6.9, -5.25, 5.9],
    [1.6, 7.85, -5.3, 6.25],
    [2.5, 8.85, -5.35, 6.45],
    [3.6, 8.95, -5.45, 6.6],
    [5, 9.05, -6.0, 6.7],
    [7, 9.15, -7.6, 6.95],
    [9, 9.05, -8.8, 7.2],
    [11, 9.0, -9.35, 7.45],
    [12.5, 9.3, -9.55, 7.6],
  ],
  boxy: (y) => 2.7 - 0.25 * smooth(5, 9, y) - 0.45 * smooth(12, 16, y),
};

/** The almond of an eye opening: upper and lower lid heights above the eye centre at `u` (cm from the eye centre, + towards the ear). */
function lids(u: number, male: boolean): { top: number; bottom: number; half: number } {
  const half = male ? 1.32 : 1.4;
  const t = Math.min(1, Math.abs(u) / half);
  // The upper lid peaks a little towards the nose, the lower lid a little towards the ear.
  const top = (male ? 0.46 : 0.52) * (1 - t * t) ** 0.75 * (1 - 0.12 * Math.tanh(u));
  const bottom = -(male ? 0.3 : 0.32) * (1 - t * t) ** 0.85 * (1 + 0.1 * Math.tanh(u));
  return { top, bottom, half };
}

/** Relief of one eye and its socket at (u, v), cm from the eye centre (u towards the ear, v up). */
function eyeRelief(u: number, v: number, male: boolean): number {
  let dz = -0.8 * gauss(u, 1.7) * gauss(v - 0.05, 1.05); // the orbit
  const { top, bottom, half } = lids(u, male);
  const r = Math.hypot(u / 1.25, v / 1.1);
  const ball = 0.62 * Math.sqrt(Math.max(0, 1 - r * r)); // the eyeball under the lids
  dz += ball;
  // Lids: outside the opening the surface stands 0.2 above the eyeball; the step is the lid margin.
  const inside = Math.abs(u) < half ? Math.min(top - v, v - bottom) : -Math.abs(u) + half - 0.01;
  const lidUp = 0.14 + 0.1 * smooth(-0.35, 0.35, v);
  dz += lidUp * (1 - smooth(-0.11, 0.13, inside)) * gauss(u, 2.0) * gauss(v, 1.2);
  // The fold above the upper lid, and a soft line under the lower one.
  const crease = top + (male ? 0.42 : 0.5);
  dz -= 0.2 * gauss(v - crease, 0.13) * (1 - smooth(half - 0.2, half + 0.5, Math.abs(u)));
  dz -= 0.06 * gauss(v - (bottom - 0.35), 0.15) * (1 - smooth(half - 0.4, half + 0.3, Math.abs(u)));
  // A sculpted iris (an incised ring) and pupil, looking straight ahead.
  const ri = Math.hypot(u + 0.05, v + 0.02);
  dz -= (0.09 * gauss(ri - 0.56, 0.11) + 0.11 * gauss(ri, 0.2)) * smooth(-0.06, 0.08, inside);
  return dz;
}

/**
 * The relief of the face on the v2 unit head, along the surface normal (cm), at (x, y) seen from
 * the front, y above the chin.
 */
export function faceReliefV2(x: number, y: number, male = false): number {
  const F = FACE_LEVELS_V2;
  const ax = Math.abs(x);
  let dz = 0;
  // Nose: bridge from the root between the eyes to the tip; the tip is a soft ball; under it the
  // height falls gradually into the upper lip (no step that would cast a moustache-like shadow).
  const tipH = male ? 2.0 : 1.75;
  const rootY = F.eyes + 0.55;
  if (y > F.mouth - 1 && y < F.brow + 1) {
    const t = smooth(rootY + 0.2, F.noseTip + 0.15, y); // 0 at the root, 1 at the tip
    const ridge = (0.3 + (tipH - 0.45) * t ** 1.35) * (1 - smooth(rootY, F.brow + 0.5, y));
    const below = smooth(F.noseBase - 1.5, F.noseTip + 0.1, y); // 1 above the tip, 0 well under the base
    const width = (male ? 0.5 : 0.45) + (male ? 0.38 : 0.3) * t;
    dz += ridge * below * gauss(x, width);
    // The ball of the tip and the wings either side of it, gentle.
    dz += 0.32 * gauss(x, 0.55) * gauss(y - (F.noseTip - 0.15), 0.45);
    dz += (male ? 0.5 : 0.42) * gauss(ax - (male ? 1.0 : 0.9), 0.36) * gauss(y - (F.noseBase + 0.3), 0.38);
    // A filled upper lip under the base, so the underside of the nose is a slope, not a shelf.
    dz += 0.5 * gauss(x, 1.25) * gauss(y - (F.noseBase - 0.6), 0.6);
  }
  // The brow ridge: heavier and lower on the male head.
  dz += (male ? 0.5 : 0.22) * gauss(y - (male ? F.brow - 0.15 : F.brow + 0.1), male ? 0.65 : 0.6) * (1 - smooth(4.4, 6.2, ax));
  // Brows: a raised band over each eye: arched and higher on the female head, flatter and lower on the male one.
  const bu = ax - F.eyeX;
  const browY = F.eyes + (male ? 1.32 : 1.55) + (male ? 0.12 : 0.28) * (1 - (bu / 1.9) ** 2) - (male ? 0 : 0.06) * bu;
  dz += (male ? 0.16 : 0.12) * gauss(y - browY, male ? 0.2 : 0.16) * (smooth(-2.1, -1.6, bu) * (1 - smooth(1.4, 2.0, bu)));
  // Eyes.
  dz += eyeRelief(ax - F.eyeX, y - F.eyes, male) * (1 - smooth(3.0, 4.2, Math.hypot(bu, (y - F.eyes) * 1.4)));
  // Cheekbones.
  dz += 0.28 * gauss(ax - 4.5, 1.4) * gauss(y - 8.8, 1.3);
  // The mouth: mound, upper and lower lip, the line between them and its corners.
  const half = male ? 2.3 : 2.15;
  dz += 0.32 * gauss(x, 2.3) * gauss(y - F.mouth, 1.3);
  const lipWidth = gauss(x, 1.35) * (1 - smooth(half - 0.35, half + 0.35, ax));
  dz += (male ? 0.24 : 0.3) * lipWidth * gauss(y - (F.mouth + 0.36 + 0.06 * gauss(ax - 0.4, 0.25)), 0.24);
  dz += (male ? 0.3 : 0.38) * lipWidth * gauss(y - (F.mouth - 0.48), 0.32);
  dz -= 0.26 * gauss(x, 1.6) * (1 - smooth(half - 0.25, half + 0.3, ax)) * gauss(y - F.mouth, 0.11);
  dz -= 0.12 * gauss(ax - half, 0.22) * gauss(y - F.mouth, 0.2);
  // The hollow under the lower lip, and the chin: round on the female head, wide and square on the male one.
  dz -= 0.16 * gauss(x, 1.5) * gauss(y - 3.7, 0.45);
  if (male) dz += 0.5 * (gauss(ax - 0.9, 1.05) * gauss(y - 2.0, 0.95));
  else dz += 0.42 * gauss(x, 1.55) * gauss(y - 2.0, 0.95);
  return dz;
}

/** Relief of an ear (cm, outwards along the normal) at (w, y): w is the distance from the middle of the ear towards the back of the head. */
export function earRelief(w: number, y: number, male = false): number {
  const cy = 9.9, hy = male ? 3.05 : 2.9, hw = male ? 1.7 : 1.6;
  const v = (y - cy) / hy, u = (w - 0.15 * v) / hw; // a slight backwards lean
  const r = Math.hypot(u, v);
  if (r > 1.35) return 0;
  const body = 1 - smooth(0.93, 1.07, r);
  // The ear stands out more at its back rim than where it is attached in front.
  const out = 0.3 + 0.45 * smooth(-1, 0.9, u);
  const rim = 0.32 * gauss(r - 0.86, 0.09) * smooth(-0.7, -0.2, v + 0.6 * u) ; // the helix, round the top and back
  const bowl = 0.6 * gauss(Math.hypot((u + 0.15) / 0.55, (v + 0.05) / 0.5), 0.55) * smooth(-0.75, -0.45, v); // the concha
  const lobe = 0.25 * gauss(Math.hypot(u, (v + 0.78) / 0.7), 0.25);
  return body * (out + rim - bowl) + lobe * body;
}

/** Shade (multiplier on the skin colour) of the brows, the lash line and the iris on the v2 face; 1 elsewhere. */
export function faceShadeV2(x: number, y: number, male = false): number {
  const F = FACE_LEVELS_V2;
  const ax = Math.abs(x);
  const bu = ax - F.eyeX;
  const browY = F.eyes + (male ? 1.32 : 1.55) + (male ? 0.12 : 0.28) * (1 - (bu / 1.9) ** 2) - (male ? 0 : 0.06) * bu;
  const brow = gauss(y - browY, male ? 0.2 : 0.15) * smooth(-2.0, -1.5, bu) * (1 - smooth(1.3, 1.9, bu)) * (1 - 0.35 * smooth(0.4, 1.8, bu));
  const u = bu;
  const v = y - F.eyes;
  const { top, half } = lids(u, male);
  const lash = gauss(v - top, 0.07) * (1 - smooth(half - 0.25, half + 0.1, Math.abs(u)));
  const ri = Math.hypot(u + 0.05, v + 0.02);
  const iris = (1 - smooth(0.5, 0.6, ri)) * (v < top ? 1 : 0);
  return 1 - Math.max(0.32 * brow, 0.38 * lash, 0.3 * iris);
}

export interface HeadV2Options {
  /** Rows from the tube's end to the top (default 132) and columns round the head (default 176). */
  rows?: number;
  columns?: number;
}

/** Column angles (0 = front, +x to the right of the figure) with more columns at the face and the ears. */
function columnAngles(cols: number): number[] {
  const density = (p: number): number => 0.8 + 3.0 * Math.exp(-((p / 0.8) ** 2)) + 0.9 * Math.exp(-(((Math.abs(p) - 1.62) / 0.32) ** 2));
  const N = 4096;
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1]! + density(-Math.PI + ((i - 0.5) * 2 * Math.PI) / N));
  const total = cum[N]!;
  const out: number[] = [];
  let i = 0;
  for (let c = 0; c < cols; c++) {
    const target = (c / cols) * total;
    while (i < N && cum[i + 1]! < target) i++;
    const f = (target - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
    out.push(-Math.PI + ((i + f) * 2 * Math.PI) / N);
  }
  // Start the ring at the back (−π) so the seam of the grid is at the back of the head.
  return out;
}

/** Row heights (unit cm above the chin) from the end of the tube to the top: fine in the face band, coarser on the neck and the dome. */
function rowHeights(rows: number, lo: number): number[] {
  const density = (y: number): number => 0.8 + 2.4 * smooth(0.5, 2.0, y) * (1 - smooth(13.2, 14.5, y)) + 1.4 * gauss(y - 11, 1.3) + 0.6 * gauss(y - 0.7, 0.6);
  const hi = UNIT, N = 4096;
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1]! + density(lo + ((i - 0.5) * (hi - lo)) / N));
  const total = cum[N]!;
  const out: number[] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    // Rows sit between the poles: none at the very end or the very top.
    const target = ((r + 0.5) / rows) * total;
    while (i < N && cum[i + 1]! < target) i++;
    const f = (target - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
    out.push(lo + ((i + f) * (hi - lo)) / N);
  }
  return out;
}

/** The torso's neck the tube follows: its section at the neck ring and, below the ring, at any height (cm). */
export interface NeckInput {
  y: number;
  a: number;
  b: number;
  cz: number;
  /** The torso's section at height y below the ring (its flare into the shoulders); absent: the ring's section. */
  at?: (y: number) => { a: number; b: number; cz: number };
}

/** A v2 head with its shade and its levels (cm, mannequin space). */
export interface HeadV2Part {
  name: 'head';
  positions: number[];
  indices: number[];
  /** Multiplier on the skin colour per vertex (1 = skin). */
  shade: number[];
  /** Height of the chin and of the top of the head. */
  chinY: number;
  topY: number;
}

/**
 * The v2 head of a mannequin as one closed surface, cm, in mannequin space (+Y up, +Z front).
 * Deterministic. The winding is not fixed here (the caller orients it). `neck` is the torso's neck
 * section the tube follows (half-width `a`, half-depth `b`, centre `cz`, cm).
 */
export function buildHeadPartV2(m: Mannequin, neck: NeckInput, options: HeadV2Options = {}): HeadV2Part {
  const rows = options.rows ?? 132;
  const cols = options.columns ?? 176;
  const warp = levelWarp(m.shape.levels);
  const level = (f: number): number => (warp ? warp(f) : f) * m.statureCm;
  const chinY = level(HEAD_LEVELS.chin);
  const k = (level(HEAD_LEVELS.top) - chinY) / UNIT;
  const fam = m.shape.family === 'male' ? MALE : FEMALE;
  const male = fam.male;
  // The neck in unit cm.
  const na = neck.a / k, nb = neck.b / k, nz = neck.cz / k;
  const ring = (neck.y - chinY) / k;
  const lo = ring - V2_TUBE_BELOW_RING;
  const dome = Array.from({ length: 33 }, (_, i) => {
    const y = DOME_FROM + (i * (UNIT - DOME_FROM)) / 32;
    const f = Math.sqrt(Math.max(0, 1 - ((y - DOME_FROM) / (UNIT - DOME_FROM)) ** 2));
    return [y, DOME[0] * f, DOME[1] * f, DOME[2] * f] as const;
  });
  const knots = [...fam.knots, ...dome];
  const front = monotoneProfile(knots.map(([y, f]) => ({ x: y, y: f })));
  const back = monotoneProfile(knots.map(([y, , b]) => ({ x: y, y: b })));
  const half = monotoneProfile(knots.map(([y, , , w]) => ({ x: y, y: w })));
  const first = fam.knots[0]!;

  /** The section at unit height y: front and back extent, half-width, the z of the widest point, and the front exponent. */
  const section = (y: number): { zf: number; zb: number; w: number; z0: number; e: number } => {
    // Under the chin the head is a tube on the neck: just inside it at the end, just outside it from the chin up.
    // The tube is the neck from the neck ring up (the torso's neck stays just inside it). Below the ring it follows the
    // torso's flare into the shoulders and sinks into it at a shallow angle, so there is no edge at the base of the neck.
    const d = 0.04 - 0.34 * smooth(ring, lo, y);
    const t = y < ring && neck.at ? neck.at(chinY + y * k) : null;
    const ta = t ? t.a / k : na, tb = t ? t.b / k : nb, tz = t ? t.cz / k : nz;
    const tube = { zf: tz + tb + d, zb: tz - tb - d, w: ta + d, z0: tz, e: 2 };
    if (y <= -0.6) return tube;
    const head = { zf: front(Math.max(y, first[0])), zb: back(Math.max(y, first[0])), w: half(Math.max(y, first[0])) };
    // From the tube to the head: the front (under the chin) turns quickly, the back and sides slowly, so the nape has no edge.
    const tf = smooth(-0.6, first[0] + 1.3, y);
    const ts = smooth(-0.6, 5.5, y);
    const zf = tube.zf + (head.zf - tube.zf) * tf;
    // Low on the head the back and sides never come inside the tube (the nape and the jaw stay on the neck).
    const low = 1 - smooth(5, 8, y);
    const zbBlend = tube.zb + (head.zb - tube.zb) * ts;
    const wBlend = tube.w + (head.w - tube.w) * ts;
    const zb = zbBlend + (Math.min(tube.zb, zbBlend) - zbBlend) * low;
    const w = wBlend + (Math.max(tube.w, wBlend) - wBlend) * low;
    const z0head = head.zb + 0.45 * (head.zf - head.zb);
    const z0 = nz + (z0head - nz) * ts;
    return { zf, zb, w, z0, e: 2 + (fam.boxy(y) - 2) * tf };
  };

  const ys = rowHeights(rows, lo);
  const phis = columnAngles(cols);
  const base: [number, number, number][] = [];
  for (const y of ys) {
    const s = section(y);
    for (const phi of phis) {
      const cz = Math.cos(phi), sx = Math.sin(phi);
      const e = 2 / (cz > 0 ? s.e : 2);
      const x = s.w * spow(sx, e);
      const z = s.z0 + (cz > 0 ? s.zf - s.z0 : s.z0 - s.zb) * spow(cz, e);
      base.push([x, y, z]);
    }
  }
  // Normals of the plain surface from the grid, then the relief along them.
  const at = (r: number, c: number): [number, number, number] => base[Math.min(rows - 1, Math.max(0, r)) * cols + ((c + cols) % cols)]!;
  const positions: number[] = [];
  const shade: number[] = [];
  const faceX0 = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = at(r, c);
      const a = at(r, c + 1), b = at(r, c - 1), u = at(r + 1, c), dn = at(r - 1, c);
      const tc = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const tr = [u[0] - dn[0], u[1] - dn[1], u[2] - dn[2]];
      let n = [tc[1]! * tr[2]! - tc[2]! * tr[1]!, tc[2]! * tr[0]! - tc[0]! * tr[2]!, tc[0]! * tr[1]! - tc[1]! * tr[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      n = n.map((v) => v / len);
      // Outwards: away from the head's vertical axis.
      if (n[0]! * p[0] + n[2]! * (p[2] - nz) < 0) n = n.map((v) => -v);
      const [x, y, z] = p;
      let relief = 0;
      let tone = 1;
      if (y > 0.1) {
        const facing = smooth(0.12, 0.5, n[2]!);
        if (facing > 0) {
          relief += facing * faceReliefV2(x - faceX0, y, male);
          tone = 1 - facing * (1 - faceShadeV2(x, y, male));
        }
        const side = smooth(0.55, 0.85, Math.abs(n[0]!));
        if (side > 0) {
          // The ear sits behind the middle of the side, from the brow down to the nose base.
          const zMid = section(y).z0 - 0.9;
          relief += side * earRelief(zMid - z, y, male);
        }
      }
      positions.push((x + n[0]! * relief) * k, chinY + (y + n[1]! * relief) * k, (z + n[2]! * relief) * k);
      shade.push(tone);
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      const a = r * cols + c, b = r * cols + c1, d = (r + 1) * cols + c1, e = (r + 1) * cols + c;
      indices.push(a, b, d, a, d, e);
    }
  }
  const pole = positions.length / 3;
  positions.push(0, chinY + lo * k, nz * k, 0, chinY + UNIT * k, 0);
  shade.push(1, 1);
  const last = (rows - 1) * cols;
  for (let c = 0; c < cols; c++) {
    const c1 = (c + 1) % cols;
    indices.push(pole, c1, c);
    indices.push(pole + 1, last + c, last + c1);
  }
  return { name: 'head', positions, indices, shade, chinY, topY: chinY + UNIT * k };
}
