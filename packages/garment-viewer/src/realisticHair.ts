/**
 * Own procedural hair for the realistic body spike (D28): ten hair types in four lengths, stylised to match the
 * stylised face (D27). Entirely generated here, from the drawn body's own head: no hair asset, no photo, no texture
 * file. Pure (no WebGL, no I/O); `realisticHairDraw.ts` turns the result into three.js meshes.
 *
 * How it is built:
 * - The head is read from the fitted realistic mesh (MakeHuman's head weights): a centre and a radial hull (the largest
 *   distance of the head's surface from the centre per direction, dilated), so the hair follows the head's size and
 *   never cuts into it. The torso from the neck down is a polar table of the drawn body (the same mesh), so long hair
 *   rests on the shoulders and back instead of passing through them; a box in front of the face keeps the face clear.
 * - A cap on the scalp (the hull pushed out a little, its hairline soft) is always there.
 * - Types 1 to 3C: strand clumps drawn as cards with alpha (`strandTexture`). Each clump's guide grows from a root on
 *   the scalp (combed away from a centre parting), bends under gravity, is pushed out of the head and the body every
 *   step, and stops at the length's cut height. On the guide the type's pattern: none (1), a planar S-wave (2A–2C), or a
 *   helix whose card is wound round the guide like a ringlet (3A–3C); curly hair shrinks (it ends higher) and stands off
 *   further (volume).
 * - Types 3C to 4C also get volume shells (`coilTexture`, the coil pattern; the outer shells sparser, so the edge is
 *   soft) and, for 4A–4C, short coil puffs on the outside: there a length is a volume, so a long 4C is an afro.
 * - Each combination stays within a triangle budget (the body's own, `HAIR_TRIANGLE_BUDGET`); one that would not fit is
 *   drawn with fewer clumps and says so (`HairBuild.simpler`).
 */
import type { HairChoice, HairLength, HairType } from './hairOptions';

type V3 = [number, number, number];

/** The triangles of the realistic body itself (`female-v1.crb`): no hair combination may draw more. */
export const HAIR_TRIANGLE_BUDGET = 27_036;

/** What the hair is built on: the drawn realistic mesh (body space, cm) and the ring heights of the drawn body. */
export interface HairBodyInput {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** 0..1 per vertex: how much the vertex belongs to the head (the asset's `headWeight`). */
  headWeight: ArrayLike<number>;
  /** 0..1 per vertex: how much the vertex follows its arm (the asset's `armWeight`); the arms are not in the torso table. */
  armWeight: ArrayLike<number>;
  /** Vertices of the body surface (the rest are the eye spheres). */
  bodyVertexCount: number;
  ringY: { shoulder: number; chest: number; underbust: number };
}

/** One mesh of the hair, ready for a BufferGeometry. */
export interface HairPart {
  kind: 'cap' | 'strands' | 'shells';
  positions: Float32Array;
  normals: Float32Array;
  /** xyz = the fibre direction, w = 1 (for the anisotropic highlight). */
  tangents: Float32Array;
  uvs: Float32Array;
  /** rgb = occlusion (multiplies the colour), a = density (shells) or edge fade. */
  colors: Float32Array;
  indices: Uint32Array;
}

export interface HairLook {
  roughness: number;
  /** Strength of the highlight's stretch along the fibre, 0..1. */
  anisotropy: number;
  specular: number;
  /** Texture repeats of the coil pattern per cm on the shells. */
  coilTileCm: number;
}

export interface HairBuild {
  choice: HairChoice;
  parts: HairPart[];
  triangles: number;
  clumps: number;
  look: HairLook;
  /** Null when drawn as designed; else what was taken away to stay within the budget. */
  simpler: string | null;
  /** The head as read from the body (cm): centre, top, chin, and its scale against MakeHuman's default head. */
  head: { centre: V3; top: number; chin: number; scale: number };
}

// ---------------------------------------------------------------------------
// The types
// ---------------------------------------------------------------------------

interface TypeParams {
  kind: 'straight' | 'wave' | 'curl' | 'coil';
  /** Wave amplitude or helix radius, cm. */
  amp: number;
  /** Wave length or helix pitch, cm. */
  period: number;
  /** 0: a round helix; 1: a zig-zag coil (4B, 4C). */
  zig: number;
  /** Card width, cm. */
  width: number;
  /** Outward growth per cm of strand (volume). */
  push: number;
  gravity: number;
  /** How far the root stands up off the scalp, 0..1. */
  lift: number;
  /** Share of the length that shows (curly and coily hair shrinks). */
  shrink: number;
  /** Depth of the layers the clumps lie in, cm. */
  thickness: number;
  /** Shell volume per length, cm on MakeHuman's default head (0: no shells). */
  volume: Record<HairLength, number>;
  count: number;
  look: HairLook;
}

const NO_VOLUME = { short: 0, chin: 0, shoulder: 0, long: 0 };

export const TYPE_PARAMS: Readonly<Record<HairType, TypeParams>> = {
  '1': { kind: 'straight', amp: 0, period: 1, zig: 0, width: 2.25, push: 0, gravity: 0.38, lift: 0.08, shrink: 1, thickness: 0.8, volume: NO_VOLUME, count: 128, look: { roughness: 0.34, anisotropy: 0.9, specular: 0.75, coilTileCm: 3 } },
  '2A': { kind: 'wave', amp: 0.6, period: 10, zig: 0, width: 2.25, push: 0.01, gravity: 0.34, lift: 0.12, shrink: 0.97, thickness: 1.0, volume: NO_VOLUME, count: 125, look: { roughness: 0.4, anisotropy: 0.85, specular: 0.65, coilTileCm: 3 } },
  '2B': { kind: 'wave', amp: 1.0, period: 7.5, zig: 0, width: 2.25, push: 0.025, gravity: 0.31, lift: 0.18, shrink: 0.93, thickness: 1.3, volume: NO_VOLUME, count: 122, look: { roughness: 0.44, anisotropy: 0.8, specular: 0.6, coilTileCm: 3 } },
  '2C': { kind: 'wave', amp: 1.35, period: 5.6, zig: 0, width: 2.35, push: 0.04, gravity: 0.28, lift: 0.24, shrink: 0.9, thickness: 1.7, volume: NO_VOLUME, count: 118, look: { roughness: 0.48, anisotropy: 0.75, specular: 0.55, coilTileCm: 3 } },
  '3A': { kind: 'curl', amp: 1.15, period: 4, zig: 0, width: 2.3, push: 0.03, gravity: 0.28, lift: 0.15, shrink: 0.85, thickness: 2.2, volume: NO_VOLUME, count: 105, look: { roughness: 0.5, anisotropy: 0.7, specular: 0.5, coilTileCm: 3 } },
  '3B': { kind: 'curl', amp: 0.9, period: 2.6, zig: 0, width: 2.05, push: 0.045, gravity: 0.26, lift: 0.2, shrink: 0.78, thickness: 2.8, volume: NO_VOLUME, count: 102, look: { roughness: 0.55, anisotropy: 0.6, specular: 0.45, coilTileCm: 3 } },
  '3C': { kind: 'curl', amp: 0.6, period: 1.6, zig: 0, width: 1.6, push: 0.06, gravity: 0.24, lift: 0.25, shrink: 0.7, thickness: 3.2, volume: { short: 1.2, chin: 2.4, shoulder: 3.4, long: 4.4 }, count: 100, look: { roughness: 0.6, anisotropy: 0.5, specular: 0.4, coilTileCm: 5 } },
  '4A': { kind: 'coil', amp: 0.45, period: 1.1, zig: 0.15, width: 1.05, push: 0, gravity: 0, lift: 1, shrink: 0.55, thickness: 0, volume: { short: 2.2, chin: 4.4, shoulder: 7.2, long: 10.5 }, count: 145, look: { roughness: 0.66, anisotropy: 0.4, specular: 0.35, coilTileCm: 4.5 } },
  '4B': { kind: 'coil', amp: 0.4, period: 0.8, zig: 0.7, width: 0.95, push: 0, gravity: 0, lift: 1, shrink: 0.5, thickness: 0, volume: { short: 2.5, chin: 5, shoulder: 8.2, long: 12 }, count: 155, look: { roughness: 0.72, anisotropy: 0.3, specular: 0.3, coilTileCm: 4 } },
  '4C': { kind: 'coil', amp: 0.32, period: 0.55, zig: 1, width: 0.85, push: 0, gravity: 0, lift: 1, shrink: 0.45, thickness: 0, volume: { short: 2.8, chin: 5.6, shoulder: 9.2, long: 13.5 }, count: 165, look: { roughness: 0.78, anisotropy: 0.22, specular: 0.25, coilTileCm: 3.5 } },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const DEG = Math.PI / 180;

/** A small seeded generator (mulberry32): the same choice on the same body gives the same hair. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------------------------------------------------------------------------
// The head and the torso, read from the drawn body
// ---------------------------------------------------------------------------

const NA = 72;
const NE = 36;

export interface HeadModel {
  c: V3;
  top: number;
  chin: number;
  /** Half the head's width at the eyes, cm. */
  halfWidth: number;
  /** Head height over MakeHuman's default head (22.1 cm). */
  scale: number;
  /** Radial hull, NE rows (elevation −90° → 90°) × NA columns (azimuth −180° → 180°, 0 = front, +X the body's left). */
  R: Float32Array;
}

/** Points of a triangle list, each triangle sampled on a small barycentric grid (the scalp's triangles are large). */
function trianglePoints(P: ArrayLike<number>, I: ArrayLike<number>, keep: (i: number) => boolean, visit: (x: number, y: number, z: number) => void, k = 3): void {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
    if (!keep(a) || !keep(b) || !keep(c)) continue;
    for (let i = 0; i <= k; i++) {
      for (let j = 0; i + j <= k; j++) {
        const u = i / k, v = j / k, w = 1 - u - v;
        visit(w * P[3 * a]! + u * P[3 * b]! + v * P[3 * c]!, w * P[3 * a + 1]! + u * P[3 * b + 1]! + v * P[3 * c + 1]!, w * P[3 * a + 2]! + u * P[3 * b + 2]! + v * P[3 * c + 2]!);
      }
    }
  }
}

/** Fill the empty cells of a grid from their neighbours, then grow it by one cell (max of 3×3): a hull, not a fit. */
function fillAndDilate(R: Float32Array, rows: number, cols: number, wrap: boolean): void {
  for (let pass = 0; pass < 200; pass++) {
    let empty = 0;
    const next = R.slice();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (R[r * cols + c]! > 0) continue;
        let s = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            let cc = c + dc;
            if (rr < 0 || rr >= rows) continue;
            if (wrap) cc = (cc + cols) % cols;
            else if (cc < 0 || cc >= cols) continue;
            const v = R[rr * cols + cc]!;
            if (v > 0) {
              s += v;
              n++;
            }
          }
        }
        if (n) next[r * cols + c] = s / n;
        else empty++;
      }
    }
    R.set(next);
    if (!empty) break;
  }
  const src = R.slice();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let m = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = clamp(r + dr, 0, rows - 1);
          const cc = wrap ? (c + dc + cols) % cols : clamp(c + dc, 0, cols - 1);
          m = Math.max(m, src[rr * cols + cc]!);
        }
      }
      R[r * cols + c] = m;
    }
  }
}

export function headModel(input: HairBodyInput): HeadModel {
  const P = input.positions, W = input.headWeight, nb = input.bodyVertexCount;
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nb; i++) {
    if (W[i]! < 0.95) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, P[3 * i + k]!);
      hi[k] = Math.max(hi[k]!, P[3 * i + k]!);
    }
  }
  if (!(hi[1] > lo[1])) throw new Error('realistic hair: the body has no head');
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const R = new Float32Array(NA * NE);
  const visit = (x: number, y: number, z: number): void => {
    const d: V3 = [x - c[0], y - c[1], z - c[2]];
    const r = len(d);
    if (r < 1e-6) return;
    const az = Math.atan2(d[0], d[2]);
    const el = Math.asin(clamp(d[1] / r, -1, 1));
    const ci = clamp(Math.floor(((az + Math.PI) / (2 * Math.PI)) * NA), 0, NA - 1);
    const ri = clamp(Math.floor(((el + Math.PI / 2) / Math.PI) * NE), 0, NE - 1);
    const k = ri * NA + ci;
    if (r > R[k]!) R[k] = r;
  };
  const isHead = (i: number): boolean => i < nb && W[i]! >= 0.5;
  trianglePoints(P, input.indices, isHead, visit, 4);
  fillAndDilate(R, NE, NA, true);
  let halfWidth = 0;
  for (let i = 0; i < nb; i++) if (W[i]! >= 0.95 && Math.abs(P[3 * i + 1]! - c[1]) < 2) halfWidth = Math.max(halfWidth, Math.abs(P[3 * i]! - c[0]));
  return { c, top: hi[1], chin: lo[1], halfWidth, scale: (hi[1] - lo[1]) / 22.1, R };
}

/** The head's hull radius towards (azimuth, elevation), radians, bilinear. */
export function headRadius(h: HeadModel, az: number, el: number): number {
  const fc = ((az + Math.PI) / (2 * Math.PI)) * NA - 0.5;
  const fr = clamp(((el + Math.PI / 2) / Math.PI) * NE - 0.5, 0, NE - 1);
  const c0 = Math.floor(fc), r0 = Math.floor(fr);
  const wc = fc - c0, wr = fr - r0;
  const r1 = Math.min(NE - 1, r0 + 1);
  const a = (c0 + NA) % NA, b = (c0 + 1 + NA) % NA;
  const g = (r: number, cc: number): number => h.R[r * NA + cc]!;
  return (g(r0, a) * (1 - wc) + g(r0, b) * wc) * (1 - wr) + (g(r1, a) * (1 - wc) + g(r1, b) * wc) * wr;
}

const NT = 48;

export interface TorsoModel {
  lo: number;
  rows: number;
  cz: Float32Array;
  /** rows × NT radii about (0, cz[row]), angle 0 = front (+Z), towards +X. */
  R: Float32Array;
}

/** The drawn body below the head as a polar table every cm, from under the long hair's cut to the chin. */
export function torsoModel(input: HairBodyInput, head: HeadModel): TorsoModel {
  const P = input.positions, W = input.headWeight, nb = input.bodyVertexCount;
  const lo = Math.floor(input.ringY.underbust - 14);
  const rows = Math.ceil(head.chin + 2 - lo);
  // Centre of each row: halfway between the front and back of the midline (|x| < 5).
  const zf = new Float32Array(rows).fill(-Infinity), zb = new Float32Array(rows).fill(Infinity);
  for (let i = 0; i < nb; i++) {
    const r = Math.floor(P[3 * i + 1]! - lo);
    if (r < 0 || r >= rows || Math.abs(P[3 * i]!) > 5 || W[i]! >= 0.5) continue;
    zf[r] = Math.max(zf[r]!, P[3 * i + 2]!);
    zb[r] = Math.min(zb[r]!, P[3 * i + 2]!);
  }
  const cz = new Float32Array(rows);
  let last = 0;
  for (let r = 0; r < rows; r++) {
    if (Number.isFinite(zf[r]!) && Number.isFinite(zb[r]!)) last = (zf[r]! + zb[r]!) / 2;
    cz[r] = last;
  }
  const R = new Float32Array(rows * NT);
  const A = input.armWeight;
  const keep = (i: number): boolean => i < nb && W[i]! < 0.5 && A[i]! < 0.5;
  trianglePoints(P, input.indices, keep, (x, y, z) => {
    const r = Math.floor(y - lo);
    if (r < 0 || r >= rows) return;
    const dz = z - cz[r]!;
    const d = Math.hypot(x, dz);
    const a = Math.atan2(x, dz);
    const k = r * NT + (Math.floor(((a + Math.PI) / (2 * Math.PI)) * NT) % NT);
    if (d > R[k]!) R[k] = d;
  }, 2);
  fillAndDilate(R, rows, NT, true);
  return { lo, rows, cz, R };
}

function torsoRadius(t: TorsoModel, y: number, ang: number): { cz: number; r: number } | null {
  const f = y - t.lo - 0.5;
  if (f < 0 || f > t.rows - 1) return null;
  const r0 = Math.floor(f), r1 = Math.min(t.rows - 1, r0 + 1), w = f - r0;
  const fa = ((ang + Math.PI) / (2 * Math.PI)) * NT - 0.5;
  const a0 = Math.floor(fa), wa = fa - a0;
  const ia = (a0 + NT) % NT, ib = (a0 + 1 + NT) % NT;
  const g = (r: number): number => t.R[r * NT + ia]! * (1 - wa) + t.R[r * NT + ib]! * wa;
  return { cz: t.cz[r0]! * (1 - w) + t.cz[r1]! * w, r: g(r0) * (1 - w) + g(r1) * w };
}

/** The scalp's edge: the elevation (degrees, about the head centre) of the hairline at an azimuth (degrees, 0 = front). */
const HAIRLINE: readonly [number, number][] = [
  [0, 33],
  [40, 30],
  [65, 22],
  [85, 16],
  [100, 12],
  [118, -6],
  [140, -26],
  [180, -34],
];

export function hairlineEl(azDeg: number): number {
  const a = Math.min(180, Math.abs(azDeg));
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [a1, e1] = HAIRLINE[i]!;
    const [a0, e0] = HAIRLINE[i - 1]!;
    if (a <= a1) return e0 + ((a - a0) / (a1 - a0)) * (e1 - e0);
  }
  return HAIRLINE[HAIRLINE.length - 1]![1];
}

/** Where the hair may be: outside the head and torso (each grown by a clearance) and clear of the face. */
export class HairSpace {
  /** Front-of-face box: |x| < faceX for y in (yLo, yHi) and z > zFront. */
  private readonly faceX: number;
  private readonly faceY: [number, number];
  private readonly faceZ: number;
  constructor(
    readonly head: HeadModel,
    readonly torso: TorsoModel,
  ) {
    const h = head;
    this.faceX = 0.78 * h.halfWidth;
    this.faceY = [h.chin - 4, h.c[1] + Math.sin(30 * DEG) * headRadius(h, 0, 30 * DEG)];
    this.faceZ = h.c[2] + 0.15 * (h.top - h.chin);
  }

  /** Out of the head along its radius (clearance `ch`), out of the body horizontally (`ct`), and sideways out of the face box. */
  push(p: V3, ch: number, ct: number): V3 {
    let q: V3 = p;
    for (let it = 0; it < 2; it++) {
      const d = sub(q, this.head.c);
      const r = len(d);
      const el = Math.asin(clamp(d[1] / (r || 1), -1, 1));
      if (el > -58 * DEG && r > 1e-6) {
        const R = headRadius(this.head, Math.atan2(d[0], d[2]), el) + ch;
        if (r < R) q = add(this.head.c, d, R / r);
      }
      const ang0 = Math.atan2(q[0], q[2] - (this.torso.cz[0] ?? 0));
      const t = torsoRadius(this.torso, q[1], ang0);
      if (t) {
        const dz = q[2] - t.cz;
        const ang = Math.atan2(q[0], dz);
        const tt = torsoRadius(this.torso, q[1], ang)!;
        const dr = Math.hypot(q[0], dz);
        const R = tt.r + ct;
        if (dr < R) {
          // Out along the surface's normal in the plane of the radius and the vertical (the slope of the table's radius
          // with height): on the back that is outwards, on top of a shoulder mostly up, and there a little to the front or
          // the back as well, so the hair slides off the shoulder as hair does instead of along it to the arm.
          const r1 = torsoRadius(this.torso, q[1] + 1, ang)?.r ?? tt.r;
          const r0 = torsoRadius(this.torso, q[1] - 1, ang)?.r ?? tt.r;
          const slope = (r1 - r0) / 2;
          const nr = 1 / Math.sqrt(1 + slope * slope), ny = -slope * nr;
          const pen = (R - dr) * nr;
          const ux = dr > 1e-6 ? q[0] / dr : 0, uz = dr > 1e-6 ? dz / dr : -1;
          const off = ny > 0.5 ? 0.5 * pen * Math.sign(dz || -1) : 0;
          q = [q[0] + ux * pen * nr, q[1] + pen * ny, q[2] + uz * pen * nr + off];
        }
      }
      if (q[2] > this.faceZ && q[1] > this.faceY[0] && q[1] < this.faceY[1] && Math.abs(q[0]) < this.faceX) q = [Math.sign(q[0] || 1) * this.faceX, q[1], q[2]];
    }
    return q;
  }

  /** Outward from the head above the chin, from the body's axis below it (horizontal), blended over 6 cm. */
  outward(p: V3): V3 {
    const fromHead = norm(sub(p, this.head.c));
    const t = torsoRadius(this.torso, p[1], 0);
    const fromBody = norm([p[0], 0, p[2] - (t ? t.cz : this.head.c[2])]);
    const w = smooth(this.head.chin - 6, this.head.chin, p[1]);
    return norm(add(fromBody, sub(fromHead, fromBody), w));
  }
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

/** Unit directions spread evenly over the sphere (Fibonacci), in a fixed order. */
function fibonacci(n: number): V3[] {
  const out: V3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.sin(ga * i) * r, y, Math.cos(ga * i) * r]);
  }
  return out;
}

const azElOf = (d: V3): [number, number] => [Math.atan2(d[0], d[2]), Math.asin(clamp(d[1], -1, 1))];

/** About `n` root directions on the scalp (above the hairline by `inset` degrees), jittered. */
function scalpDirections(n: number, rand: () => number, inset: (azDeg: number) => number = () => 1.5): V3[] {
  const inScalp = (d: V3): boolean => {
    const [az, el] = azElOf(d);
    return el / DEG > hairlineEl(az / DEG) + inset(az / DEG);
  };
  const probe = fibonacci(4000).filter(inScalp).length / 4000;
  const all = fibonacci(Math.max(8, Math.round(n / Math.max(0.05, probe))));
  const jitter = 0.5 * Math.sqrt((4 * Math.PI) / all.length);
  return all
    .map((d) => norm([d[0] + (rand() - 0.5) * jitter, d[1] + (rand() - 0.5) * jitter, d[2] + (rand() - 0.5) * jitter]))
    .filter(inScalp);
}

/** Where a length ends (y, cm; `short` also has a fixed length). Curly hair shrinks: it ends higher. */
function cutY(length: HairLength, p: TypeParams, head: HeadModel, ring: HairBodyInput['ringY']): number {
  const y = length === 'short' ? head.chin + 5 : length === 'chin' ? head.chin + 1.5 : length === 'shoulder' ? ring.shoulder + 0.5 : (ring.chest + ring.underbust) / 2 - 2;
  return head.top - (head.top - y) * p.shrink;
}

interface Guide {
  pts: V3[];
  /** 0..1: the clump's layer (0 next to the scalp). */
  layer: number;
  phase: number;
  root: V3;
}

function growGuide(space: HairSpace, root: V3, p: TypeParams, length: HairLength, yEnd: number, layer: number, rand: () => number, vol: number): Guide {
  const head = space.head;
  const hs = head.scale;
  // The guide keeps the pattern's own reach (a helix's radius, a wave's depth) clear of the head and the body.
  const reach = p.kind === 'wave' ? 0.4 * p.amp : p.amp;
  const ch = 0.35 + reach + layer * p.thickness;
  const ct = 0.9 + reach + layer * p.thickness * 0.6;
  const n = norm(sub(root, head.c));
  const [az] = azElOf(n);
  const front = clamp(Math.cos(az), 0, 1);
  const sx = Math.abs(root[0] - head.c[0]) > 0.3 ? Math.sign(root[0] - head.c[0]) : rand() < 0.5 ? -1 : 1;
  // Combed away from a centre parting: the front sideways (so it falls beside the face), the rest down and back.
  const want: V3 = [sx * (0.35 + 1.3 * front), -1, -0.35 * front];
  const comb = norm(sub(want, [n[0] * dot(want, n), n[1] * dot(want, n), n[2] * dot(want, n)]));
  let d = norm(add(comb, n, p.lift / Math.max(0.05, 1 - p.lift)));
  let q = space.push(add(root, n, ch), ch, ct);
  const pts: V3[] = [q];
  const ds = 1;
  const maxLen = length === 'short' ? (p.kind === 'curl' ? 4.5 : 6.5) * hs : 95;
  for (let s = 0; s < maxLen; s += ds) {
    const out = space.outward(q);
    d = norm(add(add(d, [0, -p.gravity, 0]), out, p.push * (1 + 0.15 * vol)));
    const next = space.push(add(q, d, ds), ch, ct);
    const step = sub(next, q);
    if (len(step) > 1e-4) d = norm(step);
    q = next;
    pts.push(q);
    if (q[1] < yEnd) break;
  }
  // Smoothed with the root held, and pushed out again after each pass: no kinks where the guide met the body.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
      pts[i] = space.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4], ch, ct);
    }
  }
  return { pts, layer, phase: rand() * 2 * Math.PI, root };
}

/** Points along a polyline at a fixed spacing (the last one at its end). */
function resample(pts: V3[], step: number): V3[] {
  const out: V3[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = len(sub(b, a));
    let t = step - carry;
    while (t <= l) {
      out.push(add(a, sub(b, a), t / l));
      t += step;
    }
    carry = l - (t - step);
  }
  const lastPt = pts[pts.length - 1]!;
  if (len(sub(out[out.length - 1]!, lastPt)) > 0.25 * step) out.push(lastPt);
  return out;
}

// ---------------------------------------------------------------------------
// Mesh writers
// ---------------------------------------------------------------------------

class PartWriter {
  pos: number[] = [];
  nrm: number[] = [];
  tan: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get vertices(): number {
    return this.pos.length / 3;
  }
  vertex(p: V3, n: V3, t: V3, u: number, v: number, ao: number, a: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.tan.push(t[0], t[1], t[2], 1);
    this.uv.push(u, v);
    this.col.push(ao, ao, ao, a);
    return this.vertices - 1;
  }
  part(kind: HairPart['kind']): HairPart {
    return { kind, positions: Float32Array.from(this.pos), normals: Float32Array.from(this.nrm), tangents: Float32Array.from(this.tan), uvs: Float32Array.from(this.uv), colors: Float32Array.from(this.col), indices: Uint32Array.from(this.idx) };
  }
}

/**
 * A card along a centre line: `side` is the width direction per point, `face` the normal. u across (0..1), v from the
 * root (0) to the tip (1); the texture fades the tip.
 */
function ribbon(w: PartWriter, centre: V3[], side: V3[], face: V3[], width: number[], ao: (i: number) => number): void {
  const n = centre.length;
  if (n < 2) return;
  const base = w.vertices;
  for (let i = 0; i < n; i++) {
    const t = norm(sub(centre[Math.min(n - 1, i + 1)]!, centre[Math.max(0, i - 1)]!));
    const h = width[i]! / 2;
    const v = i / (n - 1);
    w.vertex(add(centre[i]!, side[i]!, -h), face[i]!, t, 0, v, ao(i), 1);
    w.vertex(add(centre[i]!, side[i]!, h), face[i]!, t, 1, v, ao(i), 1);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + 2 * i;
    w.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/** The clump of one guide with the type's pattern on it. */
function clumpOf(w: PartWriter, space: HairSpace, g: Guide, p: TypeParams, widthScale: number): void {
  const curly = p.kind === 'curl' || p.kind === 'coil';
  const step = p.kind === 'straight' ? 2.0 : p.kind === 'wave' ? p.period / 5.5 : p.kind === 'curl' ? p.period / (p.period < 2 ? 4.0 : 4.8) : p.period / 4.0;
  const P = resample(g.pts, step);
  const n = P.length;
  if (n < 2) return;
  const total = (n - 1) * step;
  const centre: V3[] = [], side: V3[] = [], face: V3[] = [], width: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = i * step;
    const T = norm(sub(P[Math.min(n - 1, i + 1)]!, P[Math.max(0, i - 1)]!));
    let out = space.outward(P[i]!);
    out = norm(sub(out, [T[0] * dot(out, T), T[1] * dot(out, T), T[2] * dot(out, T)]));
    // The card's width runs round the body (horizontal) wherever it can: stable where the strand bends over the upper
    // back (a cross product of the strand and the outward direction flips there and twists the card).
    const round = norm(cross([0, 1, 0], out));
    const rb = sub(round, [T[0] * dot(round, T), T[1] * dot(round, T), T[2] * dot(round, T)]);
    const B = len(rb) > 0.3 ? norm(rb) : norm(cross(T, out));
    out = norm(cross(B, T));
    // The pattern starts a little below the root (the first cm lie on the scalp).
    const ramp = smooth(0, curly ? 2.5 : 6, s) * (p.kind === 'wave' ? 0.6 + 0.4 * smooth(0, 25, s) : 1);
    const th = (2 * Math.PI * s) / p.period + g.phase;
    if (p.kind === 'straight') {
      centre.push(P[i]!);
      side.push(B);
      face.push(out);
      width.push(p.width * widthScale * (1 + 0.25 * (s / Math.max(1, total))));
    } else if (p.kind === 'wave') {
      const a = p.amp * ramp;
      centre.push(add(add(P[i]!, B, a * Math.sin(th)), out, 0.35 * a * Math.cos(th)));
      side.push(B);
      // Tilt the face with the wave so each crest catches the light.
      face.push(norm(add(out, T, -0.35 * Math.cos(th) * (a / p.amp || 0))));
      width.push(p.width * widthScale);
    } else {
      // A helix (round, or a zig-zag for 4B/4C) round the guide; the card is wound round it like a ringlet.
      const zz = (x: number): number => (2 / Math.PI) * Math.asin(Math.sin(x));
      const cx = (1 - p.zig) * Math.cos(th) + p.zig * zz(th + Math.PI / 2);
      const cy = (1 - p.zig) * Math.sin(th) + p.zig * zz(th);
      const r = p.amp * ramp;
      const radial = norm(add([B[0] * cx, B[1] * cx, B[2] * cx], out, cy));
      centre.push(add(add(P[i]!, B, r * cx), out, r * cy));
      side.push(T);
      face.push(radial);
      width.push(p.width * widthScale * (0.7 + 0.3 * ramp));
    }
  }
  const layerAo = 0.62 + 0.38 * g.layer;
  ribbon(w, centre, side, face, width, (i) => layerAo * (0.55 + 0.45 * smooth(0, 5, i * step)));
}

// ---------------------------------------------------------------------------
// Cap and shells (a grid over the scalp in azimuth and elevation)
// ---------------------------------------------------------------------------

/**
 * A grid over the scalp from the hairline (lowered by `below(az)` degrees) to the crown. `radius(az, el)` gives each
 * vertex's distance from the head centre, `alpha(az, el, edge)` its density (edge: 0 at the lower rim, 1 one row in).
 */
function scalpGrid(w: PartWriter, space: HairSpace, cols: number, rows: number, below: (azDeg: number) => number, radius: (az: number, el: number) => number, alpha: (az: number, el: number, edge: number) => number, ao: number, tileCm: number, push = false): void {
  const h = space.head;
  const base = w.vertices;
  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (2 * Math.PI * i) / cols;
    const e0 = hairlineEl(az / DEG) - below(az / DEG);
    for (let j = 0; j <= rows; j++) {
      const f = j / rows;
      // Rows denser near the hairline, where the edge is.
      const el = (e0 + (89.5 - e0) * Math.pow(f, 1.35)) * DEG;
      const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      let p = add(h.c, dir, radius(az, el));
      if (push) p = space.push(p, 0.3, 0.9);
      const tanEl: V3 = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)];
      const rr = len(sub(p, h.c));
      w.vertex(p, dir, tanEl, ((az + Math.PI) * rr) / tileCm, ((el + Math.PI / 2) * rr) / tileCm, ao, alpha(az, el, Math.min(1, j)));
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = base + i * (rows + 1) + j;
      const b = a + rows + 1;
      w.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildHair(input: HairBodyInput, choice: HairChoice, options: { countScale?: number } = {}): HairBuild {
  const head = headModel(input);
  const torso = torsoModel(input, head);
  const space = new HairSpace(head, torso);
  const p = TYPE_PARAMS[choice.type];
  const hs = head.scale;
  const vol = p.volume[choice.length] * hs;
  const coily = p.kind === 'coil';
  const rand = rng(seedOf(`${choice.type}/${choice.length}`));

  const build = (countScale: number): { parts: HairPart[]; clumps: number } => {
    const parts: HairPart[] = [];
    // The cap: always, the scalp's hull pushed out 0.25 cm, its rim ragged and soft.
    const cap = new PartWriter();
    const capRand = rng(seedOf(`cap/${choice.type}`));
    scalpGrid(cap, space, 40, 10, () => 1.5, (az, el) => headRadius(head, az, el) + 0.25, (_az, _el, edge) => (edge < 1 ? 0.25 + 0.5 * capRand() : 1), coily ? 0.55 : 0.5, 3);
    parts.push(cap.part('cap'));

    // Shells: 3C, 4A–4C. A volume over the scalp, reaching below the hairline at the sides and back as it grows.
    if (vol > 0) {
      const shells = new PartWriter();
      const k = Math.max(4, Math.min(coily ? 6 : 4, Math.round(2.5 + vol * 0.35)));
      const droop = coily ? 1 : 0.6;
      for (let s = k; s >= 1; s--) {
        const t = s / k;
        const env = (az: number, el: number): number => {
          const hl = hairlineEl(az / DEG) * DEG;
          // Fuller over the crown and back, less at the hairline; an afro is rounder at the top.
          const f = 0.3 + 0.7 * smooth(hl - 10 * DEG, hl + 32 * DEG, el);
          return headRadius(head, az, el) + 0.4 + t * vol * f;
        };
        const below = (azDeg: number): number => t * droop * Math.min(22, 2.2 * vol) * smooth(35, 110, Math.abs(azDeg));
        scalpGrid(shells, space, 42, 9, below, env, (_az, _el, edge) => (2.5 - 1.8 * Math.pow(t, 0.85)) * (0.4 + 0.6 * edge), 0.5 + 0.5 * t, p.look.coilTileCm, true);
      }
      parts.push(shells.part('shells'));
    }

    // Strand clumps: 1–3C hang from the scalp; 4A–4C are short coil puffs on the outside of the volume.
    const strands = new PartWriter();
    const n = Math.round(p.count * countScale * (choice.length === 'short' ? 0.85 : 1));
    const dirs = scalpDirections(n, rand, coily ? (a) => 1.5 - 9.5 * smooth(35, 110, Math.abs(a)) : undefined);
    const yEnd = cutY(choice.length, p, head, input.ringY);
    const guides: Guide[] = [];
    for (const d of dirs) {
      const [az, el] = azElOf(d);
      if (coily) {
        // A puff: a short coil coming out of the volume's outer layer, mostly along the surface (so the edge is coily,
        // not spiky).
        const hl = hairlineEl(az / DEG) * DEG;
        const f = 0.3 + 0.7 * smooth(hl - 10 * DEG, hl + 32 * DEG, el);
        const r0 = headRadius(head, az, el) + 0.4 + Math.max(0.2, vol * f - 0.6 - 0.9 * rand());
        const root = add(head.c, d, r0);
        const L = 0.85 + 0.06 * vol + rand() * 0.55;
        const tang = norm(cross(d, norm([rand() - 0.5, rand() - 0.5, rand() - 0.5])));
        const out = norm(add(tang, d, 0.35 + 0.25 * rand()));
        const pts: V3[] = [];
        for (let s = 0; s <= L + 1e-9; s += 0.3) pts.push(space.push(add(root, out, s), 0.3, 0.9));
        guides.push({ pts, layer: 0.6 + 0.4 * rand(), phase: rand() * 6.28, root });
      } else {
        const layer = rand();
        guides.push(growGuide(space, add(head.c, d, headRadius(head, az, el)), p, choice.length, yEnd, layer, rand, vol));
      }
    }
    // Emit outer layers first so visible outer strands write depth before occluded inner strands (Early-Z rejection).
    guides.sort((a, b) => b.layer - a.layer);
    for (const g of guides) clumpOf(strands, space, g, p, 1);
    const clumps = guides.length;
    parts.push(strands.part('strands'));
    return { parts, clumps };
  };

  const scale0 = options.countScale ?? 1;
  let built = build(scale0);
  let triangles = built.parts.reduce((s, q) => s + q.indices.length / 3, 0);
  let simpler: string | null = null;
  if (triangles > HAIR_TRIANGLE_BUDGET) {
    const before = built.clumps;
    let scale = scale0;
    for (let it = 0; it < 6 && triangles > HAIR_TRIANGLE_BUDGET; it++) {
      const strandTris = built.parts.find((q) => q.kind === 'strands')!.indices.length / 3;
      const fixed = triangles - strandTris;
      scale = Math.max(0.15, (scale * (HAIR_TRIANGLE_BUDGET - fixed)) / strandTris) * 0.98;
      built = build(scale);
      triangles = built.parts.reduce((s, q) => s + q.indices.length / 3, 0);
    }
    simpler = `${before} clumps drawn as ${built.clumps} to stay within ${HAIR_TRIANGLE_BUDGET} triangles`;
  }
  return { choice, parts: built.parts, triangles, clumps: built.clumps, look: p.look, simpler, head: { centre: head.c, top: head.top, chin: head.chin, scale: hs } };
}

// ---------------------------------------------------------------------------
// Generated textures (RGBA8, with their own mip levels whose alpha keeps the coverage of level 0)
// ---------------------------------------------------------------------------

export interface HairTexture {
  width: number;
  height: number;
  /** Level 0 first; each RGBA8, rows from v = 0. RGB is a grey (sRGB) that multiplies the hair colour. */
  levels: Uint8Array[];
}

export const textureBytes = (t: HairTexture): number => t.levels.reduce((s, l) => s + l.byteLength, 0);

const toSrgb = (x: number): number => Math.round(255 * clamp(x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055, 0, 1));

function withMips(width: number, height: number, lum: Float32Array, alpha: Float32Array): HairTexture {
  const levels: Uint8Array[] = [];
  let w = width, h = height, L = lum, A = alpha;
  const cover = (a: Float32Array, k: number): number => {
    let c = 0;
    for (let i = 0; i < a.length; i++) if (a[i]! * k >= 0.5) c++;
    return c / a.length;
  };
  const target = cover(alpha, 1);
  for (;;) {
    // Scale this level's alpha so as much of it passes the 0.5 test as of level 0 (else the cards thin out with distance).
    let k = 1;
    if (w !== width) {
      let lo = 1, hi = 8;
      for (let it = 0; it < 18; it++) {
        const m = (lo + hi) / 2;
        if (cover(A, m) < target) lo = m;
        else hi = m;
      }
      k = (lo + hi) / 2;
    }
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const g = toSrgb(L[i]!);
      out[4 * i] = g;
      out[4 * i + 1] = g;
      out[4 * i + 2] = g;
      out[4 * i + 3] = Math.round(255 * clamp(A[i]! * k, 0, 1));
    }
    levels.push(out);
    if (w === 1 && h === 1) break;
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const nl = new Float32Array(nw * nh), na = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sl = 0, sa = 0, c = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const xx = Math.min(w - 1, 2 * x + dx), yy = Math.min(h - 1, 2 * y + dy);
            const a = A[yy * w + xx]! + 1e-3;
            sl += L[yy * w + xx]! * a;
            sa += a;
            c++;
          }
        }
        na[y * nw + x] = sa / c;
        nl[y * nw + x] = sl / sa;
      }
    }
    w = nw;
    h = nh;
    L = nl;
    A = na;
  }
  return { width, height, levels };
}

/**
 * The strand card: 64 × 256, u across the card, v from root to tip. About fifty strands of a few texels with their own
 * brightness, a slight sway, ends spread over the last fifth (the tip is soft), the card's sides fading out.
 */
export function strandTexture(seed = 7): HairTexture {
  const W = 64, H = 256;
  const r = rng(seed);
  const lum = new Float32Array(W * H), alpha = new Float32Array(W * H), wsum = new Float32Array(W * H);
  for (let s = 0; s < 70; s++) {
    const u0 = 3 + r() * (W - 6);
    const width = 0.8 + r() * 1.4;
    const b = 0.6 + r() * 0.55;
    const end = H * (0.8 + r() * 0.2);
    const sway = 0.6 + r() * 1.2, ph = r() * 6.28, freq = 1 + r() * 2;
    for (let y = 0; y < H; y++) {
      const taper = 1 - smooth(end - 0.1 * H, end, y);
      if (taper <= 0) continue;
      const uc = u0 + sway * Math.sin((y / H) * 2 * Math.PI * freq + ph);
      for (let x = Math.max(0, Math.floor(uc - 3 * width)); x <= Math.min(W - 1, Math.ceil(uc + 3 * width)); x++) {
        const a = Math.exp(-(((x + 0.5 - uc) / width) ** 2)) * taper;
        const i = y * W + x;
        alpha[i] = Math.max(alpha[i]!, a);
        lum[i] = lum[i]! + a * b;
        wsum[i] = wsum[i]! + a;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) / W;
      alpha[i] = Math.min(1, alpha[i]! * 1.3) * smooth(0, 0.14, u) * smooth(1, 0.86, u);
      lum[i] = wsum[i]! > 1e-4 ? lum[i]! / wsum[i]! : 0.5;
    }
  }
  return withMips(W, H, lum, alpha);
}

/**
 * The coil pattern of the shells, 128 × 128 and tileable: small rings (round for 3C and 4A, kinked for 4B, tight and
 * jagged for 4C), each with a weight in its alpha, so a shell's density (its vertex alpha) decides which rings it shows.
 */
export function coilTexture(type: HairType, seed = 11): HairTexture {
  const W = 128, H = 128;
  const r = rng(seed + seedOf(type));
  const lum = new Float32Array(W * H), alpha = new Float32Array(W * H);
  // A soft base everywhere (tileable value noise): dense inner shells are nearly opaque, sparse outer ones show only the rings.
  const G = 8, cell = W / G;
  const lattice = Array.from({ length: G * G }, () => r());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = x / cell, fy = y / cell;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const sx = smooth(0, 1, fx - x0), sy = smooth(0, 1, fy - y0);
      const at = (i: number, j: number): number => lattice[((j + G) % G) * G + ((i + G) % G)]!;
      const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
      alpha[y * W + x] = 0.32 + 0.3 * v;
      lum[y * W + x] = 0.42 + 0.2 * v;
    }
  }
  const spec = type === '3C' ? { n: 60, r0: 10, r1: 15, kink: 0 } : type === '4A' ? { n: 90, r0: 7, r1: 10, kink: 0.1 } : type === '4B' ? { n: 140, r0: 5, r1: 7.5, kink: 0.35 } : { n: 220, r0: 3.5, r1: 5.5, kink: 0.55 };
  for (let k = 0; k < spec.n; k++) {
    const cx = r() * W, cy = r() * H;
    const rad = spec.r0 + r() * (spec.r1 - spec.r0);
    const weight = 0.55 + 0.45 * r();
    const b = 0.65 + 0.5 * r();
    const lobes = 3 + Math.floor(r() * 3), ph = r() * 6.28;
    const thick = 1.1 + 0.6 * r();
    const ext = Math.ceil(rad * 1.6 + 3);
    for (let dy = -ext; dy <= ext; dy++) {
      for (let dx = -ext; dx <= ext; dx++) {
        const x = (Math.floor(cx) + dx + W) % W, y = (Math.floor(cy) + dy + H) % H;
        const ex = Math.floor(cx) + dx + 0.5 - cx, ey = Math.floor(cy) + dy + 0.5 - cy;
        const d = Math.hypot(ex, ey);
        const ang = Math.atan2(ey, ex);
        const rr = rad * (1 + spec.kink * Math.sin(lobes * ang + ph));
        const a = Math.exp(-(((d - rr) / thick) ** 2)) * weight;
        const i = y * W + x;
        if (a > alpha[i]!) {
          alpha[i] = a;
          // Lit on the ring's upper side: the coil reads as a coil, not a dot.
          lum[i] = b * (0.8 + 0.25 * Math.sin(ang + 1.2));
        }
      }
    }
  }
  return withMips(W, H, lum, alpha);
}
