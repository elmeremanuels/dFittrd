/**
 * The neutral standard head (D19: "every mannequin gets a neutral standard face"), for both
 * families. Own geometry only: a stack of horizontal superellipse sections through three profile
 * curves written by hand below (front, back, half-width), plus a relief of smooth bumps and
 * hollows for the brow, eye sockets, nose, lips, chin and ears. No scan, no photo, no SMPL, FLAME
 * or other face or body model, and no measurement of a person: the proportions are the common
 * drawing-book ones (eyes at half the head height, nose base at a third, mouth a third of the way
 * from the nose base to the chin). It is a shop-window mannequin face: sculpted, no painted eyes,
 * no hair, not a likeness of anyone.
 *
 * The head is a sixth closed part (`head`) that overlaps the neck, like the limbs overlap the
 * torso (v0 does no boolean union). `buildMannequinMesh(m, { head: 'neutral' })` cuts the egg off
 * the torso part, runs the neck straight up into the head and adds this part. The default mesh
 * (`head: 'egg'`) is unchanged, byte for byte.
 */
import { monotoneProfile } from '@curtain/anchors';
import type { Vec3 } from './math';
import { levelWarp, type Mannequin } from './model';

/** Chin and top of the head as fractions of stature (the generator's own head: 13 % of stature). */
export const HEAD_LEVELS = { chin: 0.865, top: 1, neckTop: 0.865, neckEnd: 0.925 } as const;

/** Height of the unit head the profiles below are written for, cm (chin 0, top 22). */
const UNIT = 22;

/** Height above the chin where the skull's dome starts, cm on the unit head. */
const DOME_FROM = 14;
/** Extents of the head at the start of the dome: front, back, half-width. */
const DOME = [9.4, -9.6, 7.6] as const;

/**
 * Profile knots of the unit head below the dome: height above the chin, front and back extent
 * (z), half-width (x). Above `DOME_FROM` the three curves are a quarter ellipse to the top.
 */
const LOWER: readonly (readonly [y: number, front: number, back: number, halfWidth: number])[] = [
  [0, 6.9, 5.3, 0.9],
  [0.35, 7.9, 3.4, 2.5],
  [1, 8.45, 1.2, 3.55],
  [2, 8.75, -1.6, 4.6],
  [3.5, 8.85, -4.3, 5.45],
  [5, 9.0, -6.1, 6.0],
  [7, 9.1, -7.7, 6.6],
  [9, 9.0, -8.8, 7.05],
  [11, 8.95, -9.35, 7.4],
  [12.5, 9.2, -9.55, 7.55],
];
const PROFILE: readonly (readonly [number, number, number, number])[] = [
  ...LOWER,
  ...Array.from({ length: 33 }, (_, i) => {
    const y = DOME_FROM + (i * (UNIT - DOME_FROM)) / 32;
    const f = Math.sqrt(Math.max(0, 1 - ((y - DOME_FROM) / (UNIT - DOME_FROM)) ** 2));
    return [y, DOME[0] * f, DOME[1] * f, DOME[2] * f] as const;
  }),
];

/** Landmark heights of the unit head (above the chin), cm. */
export const FACE_LEVELS = { eyes: 11, brow: 12.5, noseTip: 8.2, noseBase: 7.3, mouth: 5.3 } as const;

export interface HeadOptions {
  /** Rows from chin to top (default 76) and columns round the head (default 104). */
  rows?: number;
  columns?: number;
}

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const gauss = (d: number, sigma: number): number => Math.exp(-0.5 * (d / sigma) * (d / sigma));
const spow = (v: number, e: number): number => Math.sign(v) * Math.abs(v) ** e;

/**
 * The relief of the face on the unit head: how far the surface moves forward (cm) at (x, y), y
 * above the chin. `male` gives a slightly heavier brow and chin; nothing else differs.
 */
export function faceRelief(x: number, y: number, male = false): number {
  const F = FACE_LEVELS;
  const ax = Math.abs(x);
  let dz = 0;
  // Nose: a ridge that grows from the root between the eyes to the tip, then ends at the base.
  if (y > F.noseBase - 1 && y < F.brow + 0.5) {
    const t = smooth(F.eyes + 0.7, F.noseTip, y); // 0 at the root, 1 at the tip
    const height = (0.22 + (male ? 2.0 : 1.75) * t ** 1.3) * smooth(F.noseBase - 0.55, F.noseTip - 0.1, y) * (1 - smooth(F.eyes + 0.6, F.brow + 0.4, y));
    const width = 0.6 + 0.5 * t;
    dz += height * gauss(x, width);
  }
  // Brow: one soft ridge across, a little heavier on the male head.
  dz += (male ? 0.3 : 0.2) * gauss(y - F.brow, 0.7) * (1 - smooth(4.4, 6.4, ax));
  // Eye sockets, with a lidded eye in each.
  const ex = ax - 3.2;
  dz -= 0.7 * gauss(ex, 1.5) * gauss(y - F.eyes, 0.85);
  dz += 0.4 * gauss(ex, 1.0) * gauss(y - (F.eyes - 0.05), 0.42);
  // Cheekbones.
  dz += 0.25 * gauss(ax - 4.5, 1.4) * gauss(y - 8.9, 1.3);
  // The mound of the mouth, the two lips and the line between them.
  dz += 0.3 * gauss(x, 2.2) * gauss(y - F.mouth, 1.3);
  const lipWidth = gauss(x, 1.3) * (1 - smooth(1.9, 2.6, ax));
  dz += 0.3 * lipWidth * gauss(y - (F.mouth + 0.42), 0.3);
  dz += 0.34 * lipWidth * gauss(y - (F.mouth - 0.52), 0.36);
  dz -= 0.32 * gauss(x, 1.5) * (1 - smooth(2.0, 2.8, ax)) * gauss(y - F.mouth, 0.15);
  // The hollow under the lower lip and the chin.
  dz -= 0.18 * gauss(x, 1.5) * gauss(y - 3.75, 0.5);
  dz += (male ? 0.55 : 0.4) * gauss(x, male ? 2.1 : 1.8) * gauss(y - 2.1, 1.0);
  return dz;
}

/**
 * The head of a mannequin as one closed surface, cm, in mannequin space (+Y up, +Z front).
 * Deterministic. The winding is not fixed here (the caller orients it, as for the other parts).
 */
export function buildHeadPart(m: Mannequin, options: HeadOptions = {}): { name: 'head'; positions: number[]; indices: number[] } {
  const rows = options.rows ?? 76;
  const cols = options.columns ?? 104;
  const warp = levelWarp(m.shape.levels);
  const level = (f: number): number => (warp ? warp(f) : f) * m.statureCm;
  const chinY = level(HEAD_LEVELS.chin);
  const k = (level(HEAD_LEVELS.top) - chinY) / UNIT;
  const male = m.shape.family === 'male';
  const jaw = male ? 1.07 : 1;
  const front = monotoneProfile(PROFILE.map(([y, f]) => ({ x: y, y: f })));
  const back = monotoneProfile(PROFILE.map(([y, , b]) => ({ x: y, y: b })));
  const half = monotoneProfile(PROFILE.map(([y, , , w]) => ({ x: y, y: w * (y < 8 ? 1 + (jaw - 1) * smooth(8, 4, y) : 1) })));

  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    // Cosine spacing: rows are closer together towards the chin and the top, where the surface turns.
    const y = (UNIT / 2) * (1 - Math.cos((Math.PI * (r + 0.5)) / rows));
    const zf = front(y);
    const zb = back(y);
    const w = half(y);
    const z0 = zb + 0.45 * (zf - zb);
    // The face is a little boxier than an ellipse between the cheekbones and the jaw.
    const boxy = 2 + 0.5 * smooth(1.5, 5, y) * (1 - smooth(12, 16, y));
    for (let c = 0; c < cols; c++) {
      const phi = (2 * Math.PI * c) / cols;
      const cz = Math.cos(phi);
      const sx = Math.sin(phi);
      const e = 2 / (cz > 0 ? boxy : 2);
      let x = w * spow(sx, e);
      let z = z0 + (cz > 0 ? zf - z0 : z0 - zb) * spow(cz, e);
      // The relief acts on the front of the head only and fades out towards the sides.
      const facing = smooth(0.05, 0.45, cz);
      if (facing > 0) z += facing * faceRelief(x, y, male);
      // Ears: a lump on each side, behind the widest point.
      const ear = 0.8 * gauss(y - 10.2, 1.8) * gauss(z - (z0 - 0.6), 1.25) * smooth(0.75, 0.97, Math.abs(sx));
      x += Math.sign(sx) * ear;
      positions.push(x * k, chinY + y * k, z * k);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const c1 = (c + 1) % cols;
      const a = r * cols + c, b = r * cols + c1, d = (r + 1) * cols + c1, e = (r + 1) * cols + c;
      indices.push(a, b, d, a, d, e);
    }
  }
  const bottom: Vec3 = [0, chinY, 0.5 * (front(0) + back(0)) * k];
  const top: Vec3 = [0, chinY + UNIT * k, 0];
  const pole = positions.length / 3;
  positions.push(...bottom, ...top);
  const last = (rows - 1) * cols;
  for (let c = 0; c < cols; c++) {
    const c1 = (c + 1) % cols;
    indices.push(pole, c1, c);
    indices.push(pole + 1, last + c, last + c1);
  }
  return { name: 'head', positions, indices };
}
