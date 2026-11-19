/**
 * Head v3 (`buildMannequinMesh(m, { head: 'neutral-v3' })`): head v2 of `headV2.ts` with the
 * defects of the look review of 19 Nov 2026 fixed, short sculpted hair, and about half the
 * triangles. Opt-in; the `neutral` and `neutral-v2` heads and the default `egg` mesh are not changed.
 *
 * What changes against v2:
 * - **Lid margins follow rows of the grid** (`lidWarp`): within each eye the rows nearest the upper
 *   and the lower lid are bent onto the lid curves, so the margin is one smooth row of vertices and
 *   not a staircase across rows (v2's small steps along the lid edges, seen close up).
 * - **Quieter eyes**: a lower, narrower opening whose upper lid covers the top of the iris, a flatter
 *   eyeball, no incised iris ring, a soft iris and pupil shade (v2's round, ringed iris read as a doll's).
 * - **Under the jaw**: the chin turns into the neck along a long, rounded slope that starts at the neck
 *   ring and ends under a fuller chin, so no part of the underside faces straight down; what still
 *   faces down gets a small lift of the shade (`JAW_LIFT`, a painted finish, not a light). v2's
 *   underside turned over 5 cm and, on the male head, read as a chin strap under `classic`.
 * - **Ears with a back**: from behind, the ear's back runs down into the skull over about a
 *   centimetre (`earReliefV3`), with a rolled rim, so it is not a flat plate on the side of the head.
 * - **Short sculpted hair** (`hairV3`) for both families, part of the same surface (no second shell):
 *   a short crop on the male head, a short rounded crop with a soft fringe on the female head, a
 *   hairline round the temples, the ears and the nape, a darker shade, and a few broad locks. Generic,
 *   drawn from no one.
 * - **About 24k triangles** (v2: 46k): 96 rows and 128 columns, placed where the features are.
 *
 * Own geometry only, as v1 and v2: hand-written profile curves and smooth bumps, no scan, photo,
 * measurement of a person, SMPL, FLAME or any other face, hair or body model. One generic face and
 * hair shape per family, never a likeness of anyone.
 */
import { monotoneProfile } from '@curtain/anchors';
import { HEAD_LEVELS } from './head';
import type { HeadV2Part, NeckInput } from './headV2';

/** A v3 head: v2's result plus how much of each vertex is hair (0..1), so a viewer can give the hair its own colour. */
export interface HeadV3Part extends HeadV2Part {
  hair: number[];
}
import { levelWarp, type Mannequin } from './model';

/** Height of the unit head (chin 0, top of the skull 22), cm before scaling, as v1 and v2. */
const UNIT = 22;
/** The tube of the head reaches this far below the torso's neck ring (unit cm), as v2. */
export const V3_TUBE_BELOW_RING = 2.2;
/** Grid of the v3 head: rows from the tube's end to the top, columns round the head. */
export const V3_ROWS = 96;
export const V3_COLUMNS = 128;

/** Landmarks of the v3 unit head, as v2's. */
export const FACE_LEVELS_V3 = { eyes: 11, brow: 12.55, noseTip: 8.15, noseBase: 7.25, mouth: 5.25, eyeX: 3.15 } as const;

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
/**
 * Where (unit cm under the chin) the front of the tube starts to turn into the underside of the
 * chin, and where the turn ends. The turn is long (v2: -2.8 to 2.3) so its steepest part is a slope.
 */
export const V3_CHIN_TURN = [-4.2, 2.9] as const;
/** At most this much lighter (shade multiplier above 1) where the head under the jaw faces down. */
export const JAW_LIFT = 0.16;

/** Female: narrower jaw, rounder chin (v2's, with a fuller chin underneath). */
const FEMALE: Family = {
  male: false,
  knots: [
    [0.0, 6.45, -5.2, 5.15],
    [0.9, 7.15, -5.25, 5.3],
    [1.8, 7.9, -5.3, 5.45],
    [2.8, 8.5, -5.35, 5.62],
    [3.6, 8.7, -5.45, 5.75],
    [5, 8.9, -6.0, 6.05],
    [7, 9.1, -7.6, 6.6],
    [9, 9.0, -8.8, 7.05],
    [11, 8.95, -9.35, 7.4],
    [12.5, 9.2, -9.55, 7.55],
  ],
  boxy: (y) => 1.85 + 0.55 * smooth(2.5, 6, y) - 0.4 * smooth(12, 16, y),
};

/** Male: wider, squarer jaw and chin; the jaw's corners are rounder than v2's (2.45 against 2.7). */
const MALE: Family = {
  male: true,
  knots: [
    [0.0, 6.55, -5.2, 5.75],
    [0.9, 7.3, -5.25, 5.95],
    [1.8, 8.05, -5.3, 6.25],
    [2.8, 8.8, -5.35, 6.47],
    [3.6, 8.95, -5.45, 6.6],
    [5, 9.05, -6.0, 6.7],
    [7, 9.15, -7.6, 6.95],
    [9, 9.05, -8.8, 7.2],
    [11, 9.0, -9.35, 7.45],
    [12.5, 9.3, -9.55, 7.6],
  ],
  boxy: (y) => 2.45 - 0.1 * smooth(5, 9, y) - 0.4 * smooth(12, 16, y),
};

/** The almond of an eye opening: upper and lower lid heights above the eye centre at `u` (cm from the eye centre, + towards the ear). */
export function lidsV3(u: number, male: boolean): { top: number; bottom: number; half: number } {
  const half = male ? 1.3 : 1.36;
  const t = Math.min(1, Math.abs(u) / half);
  // The upper lid peaks a little towards the nose, the lower lid a little towards the ear; both lower than v2's.
  const top = (male ? 0.39 : 0.44) * (1 - t * t) ** 0.7 * (1 - 0.12 * Math.tanh(u));
  const bottom = -(male ? 0.26 : 0.28) * (1 - t * t) ** 0.8 * (1 + 0.1 * Math.tanh(u));
  return { top, bottom, half };
}

/** Relief of one eye and its socket at (u, v), cm from the eye centre (u towards the ear, v up). */
function eyeRelief(u: number, v: number, male: boolean): number {
  let dz = -0.78 * gauss(u, 1.7) * gauss(v - 0.05, 1.05); // the orbit
  const { top, bottom, half } = lidsV3(u, male);
  const r = Math.hypot(u / 1.3, v / 1.1);
  dz += 0.5 * Math.sqrt(Math.max(0, 1 - r * r)); // the eyeball, flatter than v2's
  // The lids stand out from the eyeball outside the opening: the upper one more than the lower one.
  const inside = Math.abs(u) < half ? Math.min(top - v, v - bottom) : -Math.abs(u) + half - 0.01;
  const lid = 0.12 + 0.1 * smooth(-0.3, 0.3, v);
  // Towards the corners, where the lids cross the grid's rows, their margin is softer.
  const soft = 0.14 * Math.min(1, Math.abs(u) / half) ** 2;
  dz += lid * (1 - smooth(-0.13 - soft, 0.12 + soft, inside)) * gauss(u, 2.0) * gauss(v, 1.2);
  // The fold above the upper lid, and a soft line under the lower one.
  const crease = top + (male ? 0.4 : 0.46);
  dz -= 0.16 * gauss(v - crease, 0.15) * (1 - smooth(half - 0.2, half + 0.5, Math.abs(u)));
  dz -= 0.05 * gauss(v - (bottom - 0.33), 0.16) * (1 - smooth(half - 0.4, half + 0.3, Math.abs(u)));
  // A faint cornea: no ring, no hole for the pupil.
  dz += 0.03 * gauss(Math.hypot(u + 0.05, v + 0.02), 0.4) * smooth(-0.06, 0.1, inside);
  return dz;
}

const browHeight = (bu: number, male: boolean): number => FACE_LEVELS_V3.eyes + (male ? 1.3 : 1.5) + (male ? 0.12 : 0.26) * (1 - (bu / 1.9) ** 2) - (male ? 0 : 0.06) * bu;

/** The relief of the face on the v3 unit head, along the surface normal (cm), at (x, y) seen from the front, y above the chin. */
export function faceReliefV3(x: number, y: number, male = false): number {
  const F = FACE_LEVELS_V3;
  const ax = Math.abs(x);
  let dz = 0;
  // Nose, as v2: a bridge, a soft ball at the tip, wings, and a slope (no shelf) into the upper lip.
  const tipH = male ? 2.0 : 1.75;
  const rootY = F.eyes + 0.55;
  if (y > F.mouth - 1 && y < F.brow + 1) {
    const t = smooth(rootY + 0.2, F.noseTip + 0.15, y);
    const ridge = (0.3 + (tipH - 0.45) * t ** 1.35) * (1 - smooth(rootY, F.brow + 0.5, y));
    const below = smooth(F.noseBase - 1.5, F.noseTip + 0.1, y);
    const width = (male ? 0.52 : 0.47) + (male ? 0.38 : 0.3) * t;
    dz += ridge * below * gauss(x, width);
    dz += 0.32 * gauss(x, 0.58) * gauss(y - (F.noseTip - 0.15), 0.47);
    dz += (male ? 0.48 : 0.4) * gauss(ax - (male ? 1.0 : 0.9), 0.38) * gauss(y - (F.noseBase + 0.3), 0.4);
    dz += 0.5 * gauss(x, 1.25) * gauss(y - (F.noseBase - 0.6), 0.6);
  }
  // The brow ridge: heavier and lower on the male head.
  dz += (male ? 0.48 : 0.22) * gauss(y - (male ? F.brow - 0.15 : F.brow + 0.1), male ? 0.68 : 0.62) * (1 - smooth(4.4, 6.2, ax));
  // Brows: a soft raised band over each eye.
  const bu = ax - F.eyeX;
  dz += (male ? 0.13 : 0.1) * gauss(y - browHeight(bu, male), male ? 0.22 : 0.18) * (smooth(-2.1, -1.6, bu) * (1 - smooth(1.4, 2.0, bu)));
  dz += eyeRelief(bu, y - F.eyes, male) * (1 - smooth(3.0, 4.2, Math.hypot(bu, (y - F.eyes) * 1.4)));
  // Cheekbones.
  dz += 0.28 * gauss(ax - 4.5, 1.4) * gauss(y - 8.8, 1.3);
  // The mouth, as v2, with the line between the lips a little softer.
  const half = male ? 2.3 : 2.15;
  dz += 0.32 * gauss(x, 2.3) * gauss(y - F.mouth, 1.3);
  const lipWidth = gauss(x, 1.35) * (1 - smooth(half - 0.35, half + 0.35, ax));
  dz += (male ? 0.24 : 0.3) * lipWidth * gauss(y - (F.mouth + 0.36 + 0.06 * gauss(ax - 0.4, 0.25)), 0.25);
  dz += (male ? 0.3 : 0.38) * lipWidth * gauss(y - (F.mouth - 0.48), 0.33);
  dz -= 0.22 * gauss(x, 1.6) * (1 - smooth(half - 0.25, half + 0.3, ax)) * gauss(y - F.mouth, 0.13);
  dz -= 0.1 * gauss(ax - half, 0.24) * gauss(y - F.mouth, 0.22);
  // The hollow under the lower lip, and the chin: round on the female head, wide and square on the male one.
  dz -= 0.15 * gauss(x, 1.5) * gauss(y - 3.7, 0.48);
  // One wide, square chin (v2's two bumps left a cleft that read as a dark line at phone size).
  if (male) dz += 0.46 * gauss(x, 1.25) ** 0.6 * gauss(y - 2.1, 1.0);
  else dz += 0.4 * gauss(x, 1.6) * gauss(y - 2.1, 1.0);
  return dz;
}

/**
 * Relief of an ear (cm, outwards along the normal) at (w, y): w is the distance from the middle of
 * the ear towards the back of the head. Its back runs down into the skull (v2's ended in a wall).
 */
export function earReliefV3(w: number, y: number, male = false): number {
  const cy = 9.9, hy = male ? 3.05 : 2.9, hw = male ? 1.7 : 1.6;
  const v = (y - cy) / hy, u = (w - 0.15 * v) / hw; // a slight backwards lean
  const r = Math.hypot(u, v);
  if (r > 2.2) return 0;
  // Out of the ear's outline the relief falls off: sharply at the front, top and bottom, over about a cm behind.
  const back = smooth(-0.1, 0.9, r > 1e-9 ? u / r : 0);
  const edge = r <= 1 ? 1 : gauss(r - 1, 0.07 + 0.42 * back);
  // The ear stands out more at its back rim than where it is attached in front.
  const out = 0.28 + 0.5 * smooth(-1, 0.85, Math.min(u, 0.85));
  const inner = r <= 1 ? 1 : 0;
  const rim = 0.2 * gauss(r - 0.86, 0.11) * smooth(-0.7, -0.2, v + 0.6 * u) * (r <= 1.05 ? 1 : gauss(r - 1.05, 0.08));
  const bowl = 0.55 * gauss(Math.hypot((u + 0.15) / 0.55, (v + 0.05) / 0.5), 0.55) * smooth(-0.75, -0.45, v) * inner; // the concha
  const ridge = 0.12 * gauss(r - 0.55, 0.09) * smooth(-0.1, 0.3, v) * inner; // the antihelix, round the upper bowl
  const lobe = 0.22 * gauss(Math.hypot(u, (v + 0.78) / 0.7), 0.25);
  return edge * (out + rim) - bowl + ridge + lobe * (r <= 1.1 ? 1 : 0.5);
}

/**
 * The hairline (unit cm above the chin) by the angle round the head (0 = front, π = back). Male: a
 * short crop, the hairline above the ear and a short taper at the nape. Female: a short rounded crop
 * with a lower fringe, over the top of the ear and down to the nape. Kept gentle in angle, so its edge
 * is soft on the coarser columns at the sides.
 */
const HAIRLINE: Record<'male' | 'female', readonly (readonly [number, number])[]> = {
  male: [
    [0, 15.8],
    [0.4, 15.6],
    [0.7, 14.9],
    [0.95, 13.9],
    [1.15, 13.0],
    [1.3, 12.6],
    [1.55, 13.4],
    [1.85, 13.0],
    [2.1, 10.8],
    [2.5, 8.2],
    [2.9, 6.9],
    [Math.PI, 6.6],
  ],
  female: [
    [0, 14.4],
    [0.35, 14.3],
    [0.65, 13.9],
    [0.95, 13.0],
    [1.2, 11.7],
    [1.4, 11.3],
    [1.6, 11.5],
    [1.85, 11.1],
    [2.1, 8.4],
    [2.5, 6.2],
    [2.9, 5.2],
    [Math.PI, 5.0],
  ],
};
const hairlines = {
  male: monotoneProfile(HAIRLINE.male.map(([x, y]) => ({ x, y }))),
  female: monotoneProfile(HAIRLINE.female.map(([x, y]) => ({ x, y }))),
};

/** The hair shade (multiplier on the skin colour), the same for both families. */
export const HAIR_SHADE = 0.66;

/** The side parting: the angle round the head (on the figure's right, +x) where it runs back from the hairline. */
export const HAIR_PART = 0.42;

/**
 * The hair at a point of the plain unit head: `a` the angle round the head (0 front, + towards +x,
 * ±π back), `y` the height above the chin. Returns its thickness along the normal (cm), how much of
 * the point is hair (0..1) and the hair's own shade there (grooves between locks are a little darker).
 * A side parting on the figure's right; the hair is swept from it across the top to the other side,
 * fuller on that side, in shallow locks. Thin at the hairline, fuller on the crown; at the front the
 * edge is more defined than at the sides and the nape, where the hair tapers out.
 */
export function hairV3(a: number, y: number, male = false): { thickness: number; cover: number; tone: number } {
  const aa = Math.min(Math.PI, Math.abs(a));
  const fromPart = a - HAIR_PART; // < 0: the side the hair is swept to
  // The front of the hairline: higher at the parting, a little lower (the fringe) on the swept side.
  const front = Math.cos(aa) > 0 ? Math.cos(aa) : 0;
  const sweep = front * (male ? 0.35 * gauss(fromPart, 0.28) - 0.25 * gauss(a + 0.45, 0.4) : 0.8 * gauss(fromPart, 0.25) - 1.5 * gauss(a + 0.35, 0.42));
  const line = (male ? hairlines.male : hairlines.female)(aa) + sweep;
  if (y < line - 0.6) return { thickness: 0, cover: 0, tone: 1 };
  const backOfHead = Math.cos(aa) < 0 ? -Math.cos(aa) : 0;
  const cover = smooth(line - 0.4, line + 0.6 + 1.0 * backOfHead + 0.4 * (1 - front), y);
  // At the nape it tapers out over about 3 cm, so the back of the hair has no ledge.
  const rise = smooth(line - 0.15, line + 0.8 + 0.8 * (1 - front) + 2.2 * backOfHead, y);
  const crown = smooth(13, 20.5, y);
  // (The terms by angle vanish towards the top, so the grid closes smoothly at its pole.)
  const fade = 1 - smooth(19, 21.5, y);
  // The swept side is fuller towards the front and the top; the parting is a shallow groove.
  const swept = smooth(0.1, -0.6, fromPart) * front * smooth(13, 16, y) * fade;
  const part = gauss(fromPart, 0.05) * smooth(line + 0.2, line + 1.2, y) * (1 - smooth(17.5, 19.5, y));
  // Locks: shallow grooves that leave the parting and run across the head and down towards the swept side
  // (lines of equal phase), only where the columns are fine (the front half).
  const phase = ((2 * Math.PI) / (male ? 1.1 : 1.5)) * (y - 2.6 * fromPart);
  const locks = (0.5 - 0.5 * Math.cos(phase)) * smooth(line + 0.5, line + 1.6, y) * fade * smooth(0.1, 0.6, front);
  let t: number;
  if (male) {
    t = 0.35 + 0.45 * crown + 0.3 * front * gauss(y - 16.8, 1.4) * fade + 0.3 * swept - 0.16 * part - 0.04 * locks;
  } else {
    t = 0.6 + 0.95 * crown + (0.45 * backOfHead * gauss(y - 11.5, 3) + 0.25 * front * gauss(y - (line + 0.6), 0.7)) * fade + 0.45 * swept - 0.22 * part - 0.08 * locks + 0.35 * gauss(aa - 1.4, 0.45) * gauss(y - 14, 2) * fade;
  }
  return { thickness: Math.max(0, t) * rise, cover, tone: HAIR_SHADE * (1 - 0.12 * locks - 0.2 * part) };
}

/** Shade of the brows, the lash line, the iris and the pupil on the v3 face (multiplier; 1 elsewhere). */
export function faceShadeV3(x: number, y: number, male = false): number {
  const F = FACE_LEVELS_V3;
  const ax = Math.abs(x);
  const bu = ax - F.eyeX;
  const brow = gauss(y - browHeight(bu, male), male ? 0.21 : 0.16) * smooth(-2.0, -1.5, bu) * (1 - smooth(1.3, 1.9, bu)) * (1 - 0.35 * smooth(0.4, 1.8, bu));
  const v = y - F.eyes;
  const { top, bottom, half } = lidsV3(bu, male);
  const lash = gauss(v - top, 0.06) * (1 - smooth(half - 0.3, half + 0.05, Math.abs(bu)));
  const open = smooth(-0.04, 0.06, Math.min(top - v, v - bottom)) * (Math.abs(bu) < half ? 1 : 0);
  const ri = Math.hypot(bu + 0.05, v + 0.02);
  const iris = (1 - smooth(0.38, 0.52, ri)) * open;
  const pupil = (1 - smooth(0.12, 0.2, ri)) * open;
  return 1 - Math.max(0.3 * brow, 0.36 * lash, 0.2 * iris + 0.1 * pupil);
}

/** Column angles (0 = front) with more columns at the face and the ears; the ring starts at the back. */
function columnAngles(cols: number): number[] {
  const density = (p: number): number => 0.75 + 3.1 * Math.exp(-((p / 0.78) ** 2)) + 0.7 * Math.exp(-(((Math.abs(p) - 1.62) / 0.3) ** 2)) + 0.45 * Math.exp(-(((Math.abs(p) - 1.1) / 0.25) ** 2)) + 1.1 * Math.exp(-(((Math.abs(p) - 0.36) / 0.17) ** 2));
  return distribute(cols, -Math.PI, Math.PI, density, 0);
}

/** Row heights (unit cm) from the end of the tube to the top: fine at the eyes and the mouth, coarser on the neck and the crown. */
function rowHeights(rows: number, lo: number): number[] {
  // The tube's last 3 cm (where it sinks into the torso's flare) as finely as v2's, so their meeting line is smooth.
  const density = (y: number): number =>
    0.55 + 1.1 * (1 - smooth(lo + 2.4, lo + 3.4, y)) + 2.3 * smooth(0.0, 1.8, y) * (1 - smooth(13.2, 15.0, y)) + 1.7 * gauss(y - 11, 0.9) + 0.6 * gauss(y - 5.2, 0.8) + 0.5 * gauss(y - 15.2, 0.8) + 0.4 * gauss(y - 0.5, 1.3);
  return distribute(rows, lo, UNIT, density, 0.5);
}

/** `n` points from lo to hi spaced by the inverse of `density`; `offset` 0.5 keeps them off both ends. */
function distribute(n: number, lo: number, hi: number, density: (x: number) => number, offset: number): number[] {
  const N = 4096;
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1]! + density(lo + ((i - 0.5) * (hi - lo)) / N));
  const total = cum[N]!;
  const out: number[] = [];
  let i = 0;
  for (let r = 0; r < n; r++) {
    const target = ((r + offset) / n) * total;
    while (i < N && cum[i + 1]! < target) i++;
    const f = (target - cum[i]!) / (cum[i + 1]! - cum[i]! || 1);
    out.push(lo + ((i + f) * (hi - lo)) / N);
  }
  return out;
}

/**
 * Bend the rows of the grid inside each eye onto its lids: the row nearest the upper lid at the
 * eye's middle follows the upper lid curve, the one nearest the lower lid the lower one, and the
 * rows next to them follow in proportion. Monotone in y for every column (a blend of monotone maps),
 * so the grid never folds. `ys` are the nominal row heights; returns the bent height of row r at `ax`.
 */
function lidWarp(ys: readonly number[], male: boolean): (r: number, ax: number) => number {
  const F = FACE_LEVELS_V3;
  const mid = lidsV3(0, male);
  const nearest = (y: number): number => {
    let best = 0;
    for (let i = 1; i < ys.length; i++) if (Math.abs(ys[i]! - y) < Math.abs(ys[best]! - y)) best = i;
    return best;
  };
  const iT = nearest(F.eyes + mid.top);
  const iB = Math.min(iT - 1, nearest(F.eyes + mid.bottom));
  const reach = 6;
  return (r, ax) => {
    const y = ys[r]!;
    if (r < iB - reach || r > iT + reach) return y;
    const u = ax - F.eyeX;
    const { top, bottom, half } = lidsV3(u, male);
    const w = 1 - smooth(0.7 * half, 1.05 * half, Math.abs(u));
    if (w <= 0) return y;
    const yT = F.eyes + top, yB = F.eyes + bottom;
    let bent: number;
    if (r >= iT) {
      // Above the upper lid the rows keep its curve (the fold above it is parallel to it), fading out over `reach` rows.
      const span = ys[iT + reach]! - ys[iT]!;
      bent = y + (yT - ys[iT]!) * (1 - (y - ys[iT]!) / span);
    } else if (r <= iB) {
      const span = ys[iB]! - ys[iB - reach]!;
      bent = y + (yB - ys[iB]!) * (1 - (ys[iB]! - y) / span);
    } else {
      bent = yB + ((y - ys[iB]!) / (ys[iT]! - ys[iB]!)) * (yT - yB);
    }
    return y + w * (bent - y);
  };
}

export interface HeadV3Options {
  /** Rows (default `V3_ROWS`) and columns (default `V3_COLUMNS`). */
  rows?: number;
  columns?: number;
  /** Leave the hair off (for comparisons and tests). Default false. */
  bald?: boolean;
}

/**
 * The v3 head of a mannequin as one closed surface, cm, in mannequin space (+Y up, +Z front), with
 * its shade and levels (the same shape of result as v2). Deterministic; the caller orients the
 * winding. `neck` is the torso's neck section the tube follows, as for v2.
 */
export function buildHeadPartV3(m: Mannequin, neck: NeckInput, options: HeadV3Options = {}): HeadV3Part {
  const rows = options.rows ?? V3_ROWS;
  const cols = options.columns ?? V3_COLUMNS;
  const warp = levelWarp(m.shape.levels);
  const level = (f: number): number => (warp ? warp(f) : f) * m.statureCm;
  const chinY = level(HEAD_LEVELS.chin);
  const k = (level(HEAD_LEVELS.top) - chinY) / UNIT;
  const fam = m.shape.family === 'male' ? MALE : FEMALE;
  const male = fam.male;
  const na = neck.a / k, nb = neck.b / k, nz = neck.cz / k;
  const ring = (neck.y - chinY) / k;
  const lo = ring - V3_TUBE_BELOW_RING;
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
  const [turnFrom, turnTo] = V3_CHIN_TURN;

  const section = (y: number): { zf: number; zb: number; w: number; z0: number; e: number } => {
    // Under the chin the head is a tube on the neck, as v2: just outside the torso's neck from the ring up, inside it below.
    const d = 0.04 - 0.34 * smooth(ring, lo, y);
    const t = y < ring && neck.at ? neck.at(chinY + y * k) : null;
    const ta = t ? t.a / k : na, tb = t ? t.b / k : nb, tz = t ? t.cz / k : nz;
    const tube = { zf: tz + tb + d, zb: tz - tb - d, w: ta + d, z0: tz, e: 2 };
    if (y <= turnFrom) return tube;
    const head = { zf: front(Math.max(y, first[0])), zb: back(Math.max(y, first[0])), w: half(Math.max(y, first[0])) };
    // The front turns into the chin along a long slope: a smootherstep over the whole turn, so the underside never faces down.
    const s = Math.min(1, Math.max(0, (y - turnFrom) / (turnTo - turnFrom)));
    const tf = s * s * s * (s * (6 * s - 15) + 10);
    const ts = smooth(-0.6, 5.5, y);
    const zf = tube.zf + (head.zf - tube.zf) * tf;
    const low = 1 - smooth(5, 8, y);
    const zbBlend = tube.zb + (head.zb - tube.zb) * ts;
    const wBlend = tube.w + (head.w - tube.w) * ts;
    // A smooth max and min (v2's hard ones left a crease across the cheek where the two curves cross), exact under the chin.
    const r = 0.5 * smooth(-0.6, 1.5, y);
    const smax = (p: number, q: number): number => 0.5 * (p + q + Math.sqrt((p - q) * (p - q) + r * r));
    const zb = zbBlend + (-smax(-tube.zb, -zbBlend) - zbBlend) * low;
    const w = wBlend + (smax(tube.w, wBlend) - wBlend) * low;
    const z0head = head.zb + 0.45 * (head.zf - head.zb);
    const z0 = nz + (z0head - nz) * ts;
    return { zf, zb, w, z0, e: 2 + (fam.boxy(y) - 2) * tf };
  };

  const ys = rowHeights(rows, lo);
  const phis = columnAngles(cols);
  const bend = lidWarp(ys, male);
  const pointAt = (y: number, phi: number): [number, number, number] => {
    const s = section(y);
    const cz = Math.cos(phi), sx = Math.sin(phi);
    const e = 2 / (cz > 0 ? s.e : 2);
    return [s.w * spow(sx, e), y, s.z0 + (cz > 0 ? s.zf - s.z0 : s.z0 - s.zb) * spow(cz, e)];
  };
  const base: [number, number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (const phi of phis) {
      const p = pointAt(ys[r]!, phi);
      // Only the face's columns are bent onto the lids.
      const y = Math.cos(phi) > 0.5 ? bend(r, Math.abs(p[0])) : ys[r]!;
      base.push(y === ys[r] ? p : pointAt(y, phi));
    }
  }
  const at = (r: number, c: number): [number, number, number] => base[Math.min(rows - 1, Math.max(0, r)) * cols + ((c + cols) % cols)]!;
  const positions: number[] = [];
  const shade: number[] = [];
  const hairCover: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = at(r, c);
      const a = at(r, c + 1), b = at(r, c - 1), u = at(r + 1, c), dn = at(r - 1, c);
      const tc = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const tr = [u[0] - dn[0], u[1] - dn[1], u[2] - dn[2]];
      let n = [tc[1]! * tr[2]! - tc[2]! * tr[1]!, tc[2]! * tr[0]! - tc[0]! * tr[2]!, tc[0]! * tr[1]! - tc[1]! * tr[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      n = n.map((v) => v / len);
      if (n[0]! * p[0] + n[2]! * (p[2] - nz) < 0) n = n.map((v) => -v);
      const [x, y, z] = p;
      let relief = 0;
      let tone = 1;
      let cover = 0;
      if (y > -1) {
        const facing = smooth(0.12, 0.5, n[2]!) * smooth(-1, 0.6, y);
        if (facing > 0) {
          relief += facing * faceReliefV3(x, y, male);
          tone = 1 - facing * (1 - faceShadeV3(x, y, male));
        }
        const side = smooth(0.5, 0.85, Math.abs(n[0]!));
        if (side > 0) {
          const zMid = section(y).z0 - 0.9;
          relief += side * earReliefV3(zMid - z, y, male);
        }
        if (!options.bald) {
          const s = section(y);
          const hair = hairV3(Math.atan2(x, z - s.z0), y, male);
          if (hair.cover > 0 || hair.thickness > 0) {
            relief += hair.thickness;
            tone = tone + (hair.tone - tone) * hair.cover;
            cover = hair.cover;
          }
        }
      }
      // Where the head under the jaw faces down it is painted a little lighter, so its underside has no dark band.
      if (y < 4.5 && y > ring + 1 && n[1]! < 0) tone *= 1 + JAW_LIFT * smooth(0.15, 0.75, -n[1]!) * (1 - smooth(1.5, 4.5, y));
      positions.push((x + n[0]! * relief) * k, chinY + (y + n[1]! * relief) * k, (z + n[2]! * relief) * k);
      shade.push(tone);
      hairCover.push(cover);
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
  // The top pole sits on the hair (its thickness at the crown).
  const crown = options.bald ? 0 : hairV3(Math.PI / 2, UNIT, male).thickness;
  positions.push(0, chinY + lo * k, nz * k, 0, chinY + (UNIT + crown) * k, 0);
  shade.push(1, options.bald ? 1 : HAIR_SHADE);
  hairCover.push(0, options.bald ? 0 : 1);
  const last = (rows - 1) * cols;
  for (let c = 0; c < cols; c++) {
    const c1 = (c + 1) % cols;
    indices.push(pole, c1, c);
    indices.push(pole + 1, last + c, last + c1);
  }
  return { name: 'head', positions, indices, shade, hair: hairCover, chinY, topY: chinY + UNIT * k };
}
