/**
 * Own procedural hair for the realistic body spike (D28): ten hair types in four lengths, stylised to match the
 * stylised face (D27). Entirely generated here, from the drawn body's own head: no hair asset, no photo, no texture
 * file. Pure (no WebGL, no I/O); `realisticHairDraw.ts` turns the result into three.js meshes.
 *
 * v2 (WO-012): sculpted, closed, opaque hair meshes (`FrontSide`, no alpha-cards):
 * - Types 1 to 3B: a continuous, closed, parted sculpted hair volume draping smoothly from crown to hem (eliminating
 *   scalp gaps, forehead headband edges, and lattice holes), layered with broad, smooth, bevelled 3D hero locks that
 *   taper to clean sculpted points.
 * - Types 3C to 4C: a closed, organically lobed sculpted cloud volume blanketed edge-to-edge in plump, overlapping 3D
 *   sculpted curl/coil puffs (plus sculpted perimeter ringlet curls for 3C chin–long).
 * - Preserved v1 strand-cards live in `realisticHairCards.ts` behind `options.style = 'strand-cards'` (for comparison
 *   and future CUR-31 loose accent strands).
 */
import type { HairChoice, HairLength, HairType } from './hairOptions';
import { buildStrandCardsHair, coilTexture, strandTexture } from './realisticHairCards';

export { coilTexture, strandTexture };

export type V3 = [number, number, number];

/** Sculpted solid locks (v2 default) or preserved v1 alpha strand-cards (`claude/hair-strand-cards-v1`). */
export type HairStyle = 'sculpted' | 'strand-cards';

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
  /** xyz = the fibre direction, w = 1 (for anisotropic highlights or preserved strand-card shading). */
  tangents: Float32Array;
  uvs: Float32Array;
  /** rgb = occlusion (multiplies the colour), a = density (v1 shells) or edge fade. */
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
  style: HairStyle;
  parts: HairPart[];
  triangles: number;
  clumps: number;
  look: HairLook;
  /** Null when drawn as designed; else what was taken away to stay within the budget. */
  simpler: string | null;
  /** The head as read from the body (cm): centre, top, chin, and its scale against MakeHuman's default head. */
  head: { centre: V3; top: number; chin: number; scale: number };
}

export interface BuildHairOptions {
  countScale?: number;
  style?: HairStyle;
}

// ---------------------------------------------------------------------------
// Small helpers (shared with realisticHairCards.ts)
// ---------------------------------------------------------------------------

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const norm = (a: V3): V3 => {
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

export const seedOf = (s: string): number => {
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
  /** rows × NT radii about (0, cz[row]), angle 0 = front (+Z), towards +X. Pure torso (arms excluded). */
  R: Float32Array;
  /** Per-row left (+X) and right (-X) arm cylinders (cx, cz, radius), 0 radius where no arm exists. */
  armL: Float32Array;
  armR: Float32Array;
}

export function torsoModel(input: HairBodyInput, head: HeadModel): TorsoModel {
  const P = input.positions, W = input.headWeight, A = input.armWeight, nb = input.bodyVertexCount;
  const lo = Math.floor(input.ringY.underbust - 14);
  const rows = Math.ceil(head.chin + 2 - lo);
  // Keep the torso polar hull pure torso (arms excluded) so long hair drapes smoothly over the upper back with no shelf.
  const keep = (i: number): boolean => i < nb && W[i]! < 0.5 && A[i]! < 0.5;
  // Sample midline front/back from triangulated surface points (not raw sparse vertices, which can miss a 1 cm row
  // on the back and spike `cz` by +10 cm into a phantom hunchback / chest shelf).
  const zf = new Float32Array(rows).fill(-Infinity), zb = new Float32Array(rows).fill(Infinity);
  trianglePoints(P, input.indices, keep, (x, y, z) => {
    if (Math.abs(x) > 6) return;
    const r = Math.floor(y - lo);
    if (r < 0 || r >= rows) return;
    if (z > zf[r]!) zf[r] = z;
    if (z < zb[r]!) zb[r] = z;
  }, 3);
  const cz = new Float32Array(rows);
  let last = head.c[2] * 0.25;
  for (let r = 0; r < rows; r++) {
    if (Number.isFinite(zf[r]!) && Number.isFinite(zb[r]!) && zf[r]! - zb[r]! > 3) last = (zf[r]! + zb[r]!) / 2;
    cz[r] = last;
  }
  // Gently smooth `cz` across height so polar radii stay continuous along the spine and sternum.
  for (let pass = 0; pass < 3; pass++) {
    const prev = cz.slice();
    for (let r = 1; r < rows - 1; r++) cz[r] = (prev[r - 1]! + 2 * prev[r]! + prev[r + 1]!) / 4;
  }
  const R = new Float32Array(rows * NT);
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

  // Separate left/right arm cylinders per row so side curls deflect cleanly off the upper arms without disturbing the back.
  const buildArm = (side: 1 | -1): Float32Array => {
    const sx = new Float32Array(rows), sz = new Float32Array(rows), cnt = new Float32Array(rows);
    const ptsByRow: [number, number][][] = Array.from({ length: rows }, () => []);
    for (let i = 0; i < nb; i++) {
      if (W[i]! >= 0.5 || A[i]! < 0.5) continue;
      const x = P[3 * i]!, y = P[3 * i + 1]!, z = P[3 * i + 2]!;
      if (x * side <= 0) continue;
      const r = Math.floor(y - lo);
      if (r < 0 || r >= rows) continue;
      sx[r] = sx[r]! + x;
      sz[r] = sz[r]! + z;
      cnt[r] = cnt[r]! + 1;
      ptsByRow[r]!.push([x, z]);
    }
    const out = new Float32Array(rows * 3);
    for (let r = 0; r < rows; r++) {
      if (!cnt[r]!) continue;
      const cx = sx[r]! / cnt[r]!, czArm = sz[r]! / cnt[r]!;
      let rad = 0;
      for (const [px, pz] of ptsByRow[r]!) rad = Math.max(rad, Math.hypot(px - cx, pz - czArm));
      out[3 * r] = cx;
      out[3 * r + 1] = czArm;
      out[3 * r + 2] = rad + 0.4;
    }
    return out;
  };
  return { lo, rows, cz, R, armL: buildArm(1), armR: buildArm(-1) };
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
  private readonly faceX: number;
  private readonly faceY: [number, number];
  private readonly faceZ: number;
  constructor(
    readonly head: HeadModel,
    readonly torso: TorsoModel,
  ) {
    const h = head;
    // Keep face completely unobstructed (slightly wider than the test's ±4.5 cm check).
    this.faceX = Math.max(5.05, 0.84 * h.halfWidth);
    this.faceY = [h.chin - 4, h.c[1] + Math.sin(31 * DEG) * headRadius(h, 0, 31 * DEG)];
    this.faceZ = h.c[2] + 0.12 * (h.top - h.chin);
  }

  /** Out of the head along its radius (clearance `ch`), out of the body horizontally (`ct`), and sideways out of the face box. */
  push(p: V3, ch: number, ct: number, zBias = 0): V3 {
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
          const r1 = torsoRadius(this.torso, q[1] + 1, ang)?.r ?? tt.r;
          const r0 = torsoRadius(this.torso, q[1] - 1, ang)?.r ?? tt.r;
          const slope = (r1 - r0) / 2;
          const nr = 1 / Math.sqrt(1 + slope * slope), ny = -slope * nr;
          const pen = (R - dr) * nr;
          const ux = dr > 1e-6 ? q[0] / dr : 0, uz = dr > 1e-6 ? dz / dr : -1;
          const zDir = zBias !== 0 ? Math.sign(zBias) : Math.sign(dz || -1);
          // Slide off the top of the shoulders (`|x| > 6`, near shoulder ridge) without launching back hair off the trapezius.
          const onShoulderTop = Math.abs(q[0]) > 6 && Math.abs(dz) < 6.5;
          const off = ny > 0.5 && onShoulderTop ? 0.35 * pen * zDir : 0;
          q = [q[0] + ux * pen * nr, q[1] + pen * ny, q[2] + uz * pen * nr + off];
        }
      }
      // Deflect cleanly off the local left/right arm cylinder when hair drifts out onto the outer shoulder/bicep.
      const row = Math.floor(q[1] - this.torso.lo);
      if (row >= 0 && row < this.torso.rows && Math.abs(q[0]) > 13.5) {
        const arm = q[0] > 0 ? this.torso.armL : this.torso.armR;
        const ar = arm[3 * row + 2]!;
        if (ar > 0) {
          const ax = arm[3 * row]!, az = arm[3 * row + 1]!;
          const dx = q[0] - ax, dz = q[2] - az;
          const dist = Math.hypot(dx, dz);
          const need = ar + Math.min(ct, 0.8);
          if (dist < need) {
            // Prefer sliding forward/backward around the arm rather than jutting sideways out past the arm.
            const zPush = zBias !== 0 ? Math.sign(zBias) : Math.sign(dz || -1);
            const ux = dist > 1e-4 ? dx / dist : 0, uz = dist > 1e-4 ? dz / dist : zPush;
            const k = need - dist;
            q = [q[0] + ux * k * 0.5, q[1], q[2] + (uz * 0.65 + zPush * 0.45) * k];
          }
        }
      }
      if (q[2] > this.faceZ && q[1] > this.faceY[0] && q[1] < this.faceY[1] && Math.abs(q[0]) < this.faceX) {
        q = [Math.sign(q[0] || 1) * this.faceX, q[1], q[2]];
      }
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

  torsoAt(y: number, x: number, z: number): { cz: number; r: number; dr: number } | null {
    const t0 = torsoRadius(this.torso, y, 0);
    if (!t0) return null;
    const dz = z - t0.cz;
    const ang = Math.atan2(x, dz);
    const t = torsoRadius(this.torso, y, ang);
    if (!t) return null;
    return { cz: t.cz, r: t.r, dr: Math.hypot(x, z - t.cz) };
  }
}

export function fibonacci(n: number): V3[] {
  const out: V3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.sin(ga * i) * r, y, Math.cos(ga * i) * r]);
  }
  return out;
}

export const azElOf = (d: V3): [number, number] => [Math.atan2(d[0], d[2]), Math.asin(clamp(d[1], -1, 1))];

export function scalpDirections(n: number, rand: () => number, inset: (azDeg: number) => number = () => 1.5): V3[] {
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

export function resample(pts: V3[], step: number): V3[] {
  const out: V3[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = len(sub(b, a));
    if (l < 1e-6) continue;
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

export class PartWriter {
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
  recomputeNormals(vStart = 0, iStart = 0): void {
    const vCount = this.vertices;
    for (let i = vStart * 3; i < vCount * 3; i++) this.nrm[i] = 0;
    for (let t = iStart; t < this.idx.length; t += 3) {
      const a = this.idx[t]!, b = this.idx[t + 1]!, c = this.idx[t + 2]!;
      const ax = this.pos[3 * a]!, ay = this.pos[3 * a + 1]!, az = this.pos[3 * a + 2]!;
      const ux = this.pos[3 * b]! - ax, uy = this.pos[3 * b + 1]! - ay, uz = this.pos[3 * b + 2]! - az;
      const vx = this.pos[3 * c]! - ax, vy = this.pos[3 * c + 1]! - ay, vz = this.pos[3 * c + 2]! - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        if (v < vStart) continue;
        this.nrm[3 * v] = this.nrm[3 * v]! + nx;
        this.nrm[3 * v + 1] = this.nrm[3 * v + 1]! + ny;
        this.nrm[3 * v + 2] = this.nrm[3 * v + 2]! + nz;
      }
    }
    for (let v = vStart; v < vCount; v++) {
      const nx = this.nrm[3 * v]!, ny = this.nrm[3 * v + 1]!, nz = this.nrm[3 * v + 2]!;
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-8) {
        this.nrm[3 * v] = nx / l;
        this.nrm[3 * v + 1] = ny / l;
        this.nrm[3 * v + 2] = nz / l;
      } else {
        this.nrm[3 * v] = 0;
        this.nrm[3 * v + 1] = 1;
        this.nrm[3 * v + 2] = 0;
      }
    }
  }
  part(kind: HairPart['kind']): HairPart {
    return { kind, positions: Float32Array.from(this.pos), normals: Float32Array.from(this.nrm), tangents: Float32Array.from(this.tan), uvs: Float32Array.from(this.uv), colors: Float32Array.from(this.col), indices: Uint32Array.from(this.idx) };
  }
}

export function scalpGrid(w: PartWriter, space: HairSpace, cols: number, rows: number, below: (azDeg: number) => number, radius: (az: number, el: number) => number, alpha: (az: number, el: number, edge: number) => number, ao: number, tileCm: number, push = false): void {
  const h = space.head;
  const base = w.vertices;
  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (2 * Math.PI * i) / cols;
    const e0 = hairlineEl(az / DEG) - below(az / DEG);
    for (let j = 0; j <= rows; j++) {
      const f = j / rows;
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
// Sculpted hair v2: type parameters
// ---------------------------------------------------------------------------

interface SculptedTypeParams {
  kind: 'straight' | 'wave' | 'curl' | 'coil';
  /** Wave amplitude or curl ribbon spiral radius, cm. */
  amp: number;
  /** Wave length or curl pitch, cm. */
  period: number;
  /** Broad sculpted lock width, cm. */
  width: number;
  /** Flattened sculpted ribbon thickness ratio (thickness / width). */
  thickRatio: number;
  /** Crown dome lift around parting, cm. */
  crownLift: number;
  push: number;
  gravity: number;
  lift: number;
  /** Share of straight length that shows (curls/coils shrink). */
  shrink: number;
  /** Radial layering thickness, cm. */
  thickness: number;
  /** Sculpted core/halo volume per length, cm (3C–4C cloud, 3A–3B curly base fullness). */
  volume: Record<HairLength, number>;
  /** Sculpted lock or puff cluster target count. */
  count: number;
  /** Base puff radius (cm) at shoulder scale for 3C–4C sculpted cloud puffs. */
  puffRadius: number;
  lobeStrength: number;
  look: HairLook;
}

const NO_VOL = { short: 0, chin: 0, shoulder: 0, long: 0 };

export const TYPE_PARAMS: Readonly<Record<HairType, SculptedTypeParams>> = {
  '1': { kind: 'straight', amp: 0, period: 1, width: 3.9, thickRatio: 0.30, crownLift: 0.72, push: 0.0, gravity: 0.48, lift: 0.08, shrink: 1.0, thickness: 0.52, volume: NO_VOL, count: 32, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.62, anisotropy: 0.5, specular: 0.24, coilTileCm: 3.5 } },
  '2A': { kind: 'wave', amp: 0.65, period: 12.8, width: 3.85, thickRatio: 0.32, crownLift: 0.80, push: 0.008, gravity: 0.44, lift: 0.10, shrink: 0.96, thickness: 0.62, volume: NO_VOL, count: 32, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.66, anisotropy: 0.45, specular: 0.22, coilTileCm: 3.5 } },
  '2B': { kind: 'wave', amp: 1.02, period: 9.4, width: 3.75, thickRatio: 0.34, crownLift: 0.95, push: 0.015, gravity: 0.39, lift: 0.13, shrink: 0.92, thickness: 0.78, volume: NO_VOL, count: 32, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.68, anisotropy: 0.4, specular: 0.20, coilTileCm: 3.5 } },
  '2C': { kind: 'wave', amp: 1.38, period: 7.4, width: 3.55, thickRatio: 0.38, crownLift: 1.15, push: 0.024, gravity: 0.35, lift: 0.17, shrink: 0.88, thickness: 0.96, volume: NO_VOL, count: 32, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.72, anisotropy: 0.35, specular: 0.19, coilTileCm: 3.5 } },
  '3A': { kind: 'curl', amp: 1.12, period: 7.2, width: 3.1, thickRatio: 0.48, crownLift: 1.30, push: 0.028, gravity: 0.32, lift: 0.18, shrink: 0.84, thickness: 1.15, volume: { short: 1.2, chin: 1.6, shoulder: 2.1, long: 2.5 }, count: 30, puffRadius: 0, lobeStrength: 0.12, look: { roughness: 0.74, anisotropy: 0.3, specular: 0.18, coilTileCm: 4.5 } },
  '3B': { kind: 'curl', amp: 0.96, period: 5.4, width: 2.8, thickRatio: 0.56, crownLift: 1.45, push: 0.036, gravity: 0.29, lift: 0.22, shrink: 0.76, thickness: 1.35, volume: { short: 1.6, chin: 2.4, shoulder: 3.2, long: 3.8 }, count: 30, puffRadius: 2.0, lobeStrength: 0.10, look: { roughness: 0.76, anisotropy: 0.26, specular: 0.17, coilTileCm: 4.2 } },
  '3C': { kind: 'curl', amp: 0.78, period: 4.2, width: 2.35, thickRatio: 0.62, crownLift: 1.7, push: 0.042, gravity: 0.26, lift: 0.26, shrink: 0.68, thickness: 1.5, volume: { short: 2.1, chin: 3.4, shoulder: 4.9, long: 6.3 }, count: 115, puffRadius: 2.15, lobeStrength: 0.09, look: { roughness: 0.8, anisotropy: 0.22, specular: 0.16, coilTileCm: 4.0 } },
  '4A': { kind: 'coil', amp: 0.5, period: 1.6, width: 1.6, thickRatio: 0.9, crownLift: 0, push: 0, gravity: 0, lift: 1, shrink: 0.56, thickness: 0, volume: { short: 2.2, chin: 4.3, shoulder: 6.9, long: 9.8 }, count: 120, puffRadius: 2.35, lobeStrength: 0.07, look: { roughness: 0.82, anisotropy: 0.18, specular: 0.16, coilTileCm: 4.0 } },
  '4B': { kind: 'coil', amp: 0.42, period: 1.2, width: 1.4, thickRatio: 0.92, crownLift: 0, push: 0, gravity: 0, lift: 1, shrink: 0.50, thickness: 0, volume: { short: 2.5, chin: 5.0, shoulder: 8.1, long: 11.4 }, count: 160, puffRadius: 1.98, lobeStrength: 0.09, look: { roughness: 0.86, anisotropy: 0.14, specular: 0.15, coilTileCm: 3.6 } },
  '4C': { kind: 'coil', amp: 0.35, period: 0.9, width: 1.25, thickRatio: 0.95, crownLift: 0, push: 0, gravity: 0, lift: 1, shrink: 0.44, thickness: 0, volume: { short: 2.8, chin: 5.7, shoulder: 9.3, long: 13.0 }, count: 215, puffRadius: 1.68, lobeStrength: 0.10, look: { roughness: 0.9, anisotropy: 0.1, specular: 0.14, coilTileCm: 3.2 } },
};

// ---------------------------------------------------------------------------
// Sculpted geometry primitives (100% closed, opaque, FrontSide CCW)
// ---------------------------------------------------------------------------

function organicLobe(x: number, y: number, z: number, freq: number, seed: number): number {
  const s1 = Math.sin(x * freq + seed * 1.17) * Math.cos(y * freq * 1.13 - seed * 0.71) * Math.sin(z * freq * 0.91 + seed * 2.03);
  const s2 = Math.cos(x * freq * 1.73 - z * freq * 1.41 + seed * 3.1) * Math.sin(y * freq * 1.61 + x * freq * 0.83 - seed * 1.4);
  return 0.62 * s1 + 0.38 * s2;
}

function cutYOf(length: HairLength, p: SculptedTypeParams, head: HeadModel, ring: HairBodyInput['ringY']): number {
  const y = length === 'short' ? head.chin + 5.2 : length === 'chin' ? head.chin + 1.0 : length === 'shoulder' ? ring.shoulder - 0.5 : (ring.chest + ring.underbust) / 2 - 2.5;
  return head.top - (head.top - y) * p.shrink;
}

/**
 * Closed, opaque sculpted scalp cap: sits cleanly under all hair masses. For hanging types (1–3B) it has a natural
 * rounded crown dome with a subtle centre-parting crease and a gently arched hairline that blends seamlessly under
 * the sweeping forehead locks.
 */
function buildSculptedCap(w: PartWriter, space: HairSpace, p: SculptedTypeParams, parting: boolean): void {
  const h = space.head;
  const cols = 36;
  const rows = 10;
  const vStart = w.vertices;
  const iStart = w.idx.length;
  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (2 * Math.PI * i) / cols;
    const azDeg = az / DEG;
    // Soft subtle V-arch meeting the left & right parted locks cleanly at the forehead hairline (zero centre notch).
    const frontArch = 1.4 * smooth(55, 0, Math.abs(azDeg));
    const backBelow = 2.5 * smooth(95, 165, Math.abs(azDeg));
    const e0 = hairlineEl(azDeg) + frontArch - backBelow;
    for (let j = 0; j <= rows; j++) {
      const f = j / rows;
      const el = (e0 + (89.5 - e0) * Math.pow(f, 1.22)) * DEG;
      const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      const baseR = headRadius(h, az, el);
      const rimFade = smooth(0, 0.25, f);
      // Snug under-cap sitting cleanly underneath the parted crown locks (never bulging out above the locks).
      let lift = 0.08 + rimFade * (0.20 + (parting ? p.crownLift * 0.28 * smooth(16 * DEG, 72 * DEG, el) : 0.20));
      let ao = parting ? 0.62 + 0.16 * smooth(0, 0.75, f) : 0.64 + 0.14 * f;
      if (parting) {
        const xOff = Math.abs(dir[0] * baseR);
        const partMask = (1 - smooth(0, 1.4 * h.scale, xOff)) * smooth(24 * DEG, 72 * DEG, el) * smooth(-0.3, 0.3, dir[2]);
        lift -= 0.18 * partMask;
        ao *= 1 - 0.32 * partMask;
      }
      const pt = add(h.c, dir, baseR + lift);
      const tanEl: V3 = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)];
      const u = ((az + Math.PI) / (2 * Math.PI)) * 5;
      const v = 1 - f;
      w.vertex(pt, dir, tanEl, u, v, ao, 1);
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = vStart + i * (rows + 1) + j;
      const b = a + rows + 1;
      w.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  w.recomputeNormals(vStart, iStart);
}

/**
 * Continuous, closed sculpted base hair curtain for hanging types (1–3B): sweeps smoothly around the sides and back
 * from crown to ~88% of the cut length with macro sculpted lock flutes and coherent wave/curl relief. This guarantees
 * an airtight, lush sculptural silhouette with ZERO gaps or lattice holes behind the hero locks.
 */
function buildSculptedCurtain(
  w: PartWriter,
  space: HairSpace,
  p: SculptedTypeParams,
  length: HairLength,
  yEndBase: number,
  ring: HairBodyInput['ringY'],
): void {
  const h = space.head;
  const hs = h.scale;
  const rows = length === 'short' ? 6 : length === 'chin' ? 9 : length === 'shoulder' ? 12 : 15;
  const vStart = w.vertices;
  const iStart = w.idx.length;

  // Sweep strictly across the central back (`+122°` around `+180°/-180°` to `-122°`, between the shoulder blades)
  // and tuck its hem slightly behind the sculpted hero locks so adjacent columns never split across a shoulder or arm.
  const cols = 18;
  const azStart = 122 * DEG;
  const azSpan = (360 - 244) * DEG;
  const columns: V3[][] = [];
  const colAo: number[][] = [];
  const colAz: number[] = [];

  for (let i = 0; i <= cols; i++) {
    const uFrac = i / cols;
    const azCont = azStart + uFrac * azSpan;
    const az = azCont > Math.PI ? azCont - 2 * Math.PI : azCont;
    const azDeg = az / DEG;
    const absAzDeg = Math.abs(azDeg);
    colAz.push(az);

    const elStart = clamp(hairlineEl(azDeg) + 28, 12, 62) * DEG;
    const dir: V3 = [Math.sin(az) * Math.cos(elStart), Math.sin(elStart), Math.cos(az) * Math.cos(elStart)];
    const root = add(h.c, dir, headRadius(h, az, elStart));
    const sx = Math.sign(Math.sin(az) || 1);
    const shoulderSide = -1;

    const edgeFade = smooth(0, 0.22, uFrac) * smooth(1, 0.78, uFrac);
    const ch = 0.24 + edgeFade * (0.38 + p.crownLift * 0.32 + (p.kind === 'curl' ? p.amp * 0.35 : p.amp * 0.16));
    const ct = 0.78 + edgeFade * (0.38 + (p.kind === 'curl' ? p.amp * 0.42 : p.amp * 0.18));

    const want: V3 = [sx * 0.12, -1.0, -0.35];
    const comb = norm(sub(want, [dir[0] * dot(want, dir), dir[1] * dot(want, dir), dir[2] * dot(want, dir)]));
    let d = norm(add(comb, dir, p.lift * 0.4));
    let q = space.push(add(root, dir, 0.2), 0.2, ct, shoulderSide);
    const pts: V3[] = [q];
    const scallop = 0.65 * Math.sin(uFrac * Math.PI * 8);
    // Keep the inner backing slightly shorter than the sculpted locks so the sculpted lock tips form the outer hem.
    const targetY = yEndBase + (length === 'short' ? 1.5 : 4.2) * hs + (1 - edgeFade) * 3.5 * hs + scallop * hs;
    const maxLen = length === 'short' ? (4.4 + 2.0 * edgeFade) * hs : 86;

    for (let s = 0; s < maxLen; s += 1.0) {
      const chCur = 0.22 + (ch - 0.22) * smooth(0, 5.5 * hs, s);
      const out = space.outward(q);
      // Damp horizontal bounce after clearing the head so the trapezius slope never launches back hair into midair.
      if (q[1] < h.chin) d = norm([d[0] * 0.52, Math.min(-0.45, d[1]), d[2] * 0.42]);
      let force: V3 = [0, -p.gravity, 0];
      const nearShoulder = smooth(h.chin + 2, ring.shoulder + 2, q[1]) * (1 - smooth(ring.shoulder - 4, ring.shoulder - 12, q[1]));
      if (nearShoulder > 0 && absAzDeg < 110) {
        force = add(force, [0, 0, -0.10 * nearShoulder]);
      }
      if (length === 'chin' && p.kind !== 'curl' && q[1] < targetY + 4.5) {
        force = add(force, out, -0.18 * smooth(targetY + 4.5, targetY, q[1]));
      }
      const onBack = q[1] < ring.shoulder + 3 && q[2] < h.c[2] - 0.5;
      if (onBack) {
        const tInfo = space.torsoAt(q[1], q[0], q[2]);
        const wantDr = tInfo ? tInfo.r + ct + (p.kind === 'curl' ? 1.4 : 0.45) : 0;
        if (tInfo && tInfo.dr > wantDr) force = add(force, out, -Math.min(0.42, (tInfo.dr - wantDr) * 0.14));
      } else {
        force = add(force, out, p.push * 0.55);
      }
      d = norm(add(d, force));
      const next = space.push(add(q, d, 1.0), chCur, ct, shoulderSide);
      const st = sub(next, q);
      if (len(st) > 1e-4) d = norm(st);
      q = next;
      pts.push(q);
      if (q[1] < targetY) break;
    }

    // Resample uniformly to `rows` points so all columns align cleanly into a smooth sculpted mesh.
    const totalArc = pts.reduce((acc, pt, idx) => (idx ? acc + len(sub(pt, pts[idx - 1]!)) : 0), 0);
    const sampled: V3[] = [];
    const aos: number[] = [];
    for (let r = 0; r <= rows; r++) {
      const f = r / rows;
      const targetS = f * totalArc;
      let acc = 0;
      let pt = pts[pts.length - 1]!;
      for (let k = 1; k < pts.length; k++) {
        const seg = len(sub(pts[k]!, pts[k - 1]!));
        if (acc + seg >= targetS || k === pts.length - 1) {
          const wSeg = seg > 1e-6 ? clamp((targetS - acc) / seg, 0, 1) : 0;
          pt = add(pts[k - 1]!, sub(pts[k]!, pts[k - 1]!), wSeg);
          break;
        }
        acc += seg;
      }
      const out = space.outward(pt);
      const round = norm(cross([0, 1, 0], out));
      // Sculpt broad longitudinal lock flutes + coherent type wave directly into the base drape.
      const flute = Math.cos(uFrac * Math.PI * 24) * 0.28 * hs * edgeFade * smooth(0, 0.25, f) * (1 - 0.5 * smooth(0.8, 1.0, f));
      let waveOut = 0;
      let waveSide = 0;
      if (p.kind === 'wave' || p.kind === 'curl') {
        const th = (2 * Math.PI * targetS) / (p.period * hs) + uFrac * Math.PI * 4;
        const ramp = smooth(0, 4 * hs, targetS) * edgeFade * (1 - 0.35 * smooth(0.82, 1.0, f));
        waveOut = p.amp * hs * 0.42 * ramp * Math.cos(th);
        waveSide = p.amp * hs * 0.35 * ramp * Math.sin(th);
      }
      // Gently tuck the very bottom row inward so the base curtain has a closed sculpted hem (no open skirt edge).
      const hemTuck = r === rows ? -0.45 * hs : 0;
      pt = space.push(add(add(pt, out, flute + waveOut + hemTuck), round, waveSide), 0.24, 0.72, shoulderSide);
      sampled.push(pt);
      // Slightly deeper interior shadow behind the hero locks so the outer locks pop with rich sculpted contrast.
      const baseAo = 0.66 + 0.18 * smooth(0, 0.35, f) + 0.08 * Math.cos(uFrac * Math.PI * 24);
      aos.push(clamp(baseAo * (r === rows ? 0.85 : 1.0), 0.56, 0.90));
    }
    columns.push(sampled);
    colAo.push(aos);
  }

  // Emit outer sculpted surface (increasing az -> right, increasing row -> down, so (+az) × (-row) = outward!).
  // Wait: verify CCW outward! `a = (i, r)`, `b = (i+1, r)` is +az, `c = (i, r+1)` is -Y (down).
  // At back (az=180°, out=-Z): +az is -X, down is -Y -> (-X) × (-Y) = +Z (INWARD!).
  // Therefore `(a, c, b)` gives (-Y) × (-X) = -Z (OUTWARD!!). Let's verify at front (az=0, out=+Z):
  // +az is +X, down is -Y -> (-Y) × (+X) = +Z (OUTWARD!!).
  for (let i = 0; i <= cols; i++) {
    const u = (i / cols) * 8;
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const pt = columns[i]![r]!;
      const out = space.outward(pt);
      w.vertex(pt, out, [0, -1, 0], u, v, colAo[i]![r]!, 1);
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let r = 0; r < rows; r++) {
      const a = vStart + i * (rows + 1) + r;
      const b = a + rows + 1;
      w.idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  w.recomputeNormals(vStart, iStart);
}

/**
 * Closed, solid, organically lobed sculpted volume shell (for 3C–4C cloud halo). Bottom rim smoothly tucks inward to
 * the head hull so it is 100% closed and never hollow from below even with `FrontSide`.
 */
function buildSculptedVolume(w: PartWriter, space: HairSpace, p: SculptedTypeParams, vol: number, seed: number): void {
  const h = space.head;
  const hs = h.scale;
  const coily = p.kind === 'coil';
  const cols = 38;
  const mainRows = 12;
  const tuckRows = 2;
  const totalRows = mainRows + tuckRows;
  const vStart = w.vertices;
  const iStart = w.idx.length;

  const belowAt = (azDeg: number): number => {
    const droop = coily ? (p.lobeStrength < 0.13 ? 1.05 : 0.85) : 1.05;
    return droop * Math.min(24, 2.25 * vol) * smooth(32, 108, Math.abs(azDeg));
  };

  const envRadius = (az: number, el: number): { r: number; lobe: number } => {
    const hl = hairlineEl(az / DEG) * DEG;
    const crownShape = 0.36 + 0.64 * smooth(hl - 16 * DEG, hl + 36 * DEG, el);
    const sideLift = 1 + 0.14 * smooth(34, 115, Math.abs(az / DEG)) * (1 - smooth(55 * DEG, 88 * DEG, el));
    const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const freq = p.lobeStrength > 0.14 ? 8.5 : 6.8;
    const lobe = organicLobe(dir[0], dir[1], dir[2], freq, seed);
    const bumpAmp = Math.min(vol * 0.18, p.lobeStrength * 3.0 * hs);
    const base = headRadius(h, az, el) + 0.35 + vol * crownShape * sideLift;
    return { r: base + lobe * bumpAmp, lobe };
  };

  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (2 * Math.PI * i) / cols;
    const azDeg = az / DEG;
    const hlDeg = hairlineEl(azDeg);
    const eOuter = Math.max(-52, hlDeg - belowAt(azDeg));
    const eInner = Math.max(-46, hlDeg - 2 * smooth(90, 175, Math.abs(azDeg)));

    for (let j = 0; j <= totalRows; j++) {
      let el: number;
      let r: number;
      let ao: number;
      if (j < tuckRows) {
        const tf = j / tuckRows;
        el = (eInner + (eOuter - eInner) * Math.pow(tf, 0.75)) * DEG;
        const outer = envRadius(az, eOuter * DEG);
        const scalpR = headRadius(h, az, el) + 0.14;
        r = scalpR + (outer.r - scalpR) * Math.pow(tf, 1.35);
        ao = 0.54 + 0.16 * tf;
      } else {
        const f = (j - tuckRows) / mainRows;
        el = (eOuter + (89.5 - eOuter) * Math.pow(f, 1.15)) * DEG;
        const ev = envRadius(az, el);
        r = ev.r;
        const rimAo = 0.68 + 0.22 * smooth(0, 0.3, f);
        ao = clamp(rimAo * (0.82 + 0.18 * ev.lobe), 0.56, 0.96);
      }
      const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      let pt = add(h.c, dir, r);
      pt = space.push(pt, 0.2, 0.68);
      const tanEl: V3 = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)];
      const rr = len(sub(pt, h.c));
      w.vertex(pt, dir, tanEl, ((az + Math.PI) * rr) / p.look.coilTileCm, ((el + Math.PI / 2) * rr) / p.look.coilTileCm, ao, 1);
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < totalRows; j++) {
      const a = vStart + i * (totalRows + 1) + j;
      const b = a + totalRows + 1;
      w.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  w.recomputeNormals(vStart, iStart);
}

/**
 * Closed, solid, broad sculpted 3D lock mesh swept along `centre` with a smooth bevelled-lenticular 6-sided
 * cross-section, closed root cap, crisp tapered sculpted tip apex, and area-weighted smooth outward normals (`FrontSide`).
 */
function sculptedLockTube(
  w: PartWriter,
  space: HairSpace,
  centre: V3[],
  side: V3[],
  out: V3[],
  width: number[],
  thick: number[],
  ao: number[],
  groove: number,
  uOffset: number,
): void {
  const n = centre.length;
  if (n < 2) return;
  const vStart = w.vertices;
  const iStart = w.idx.length;

  // Flattened, softly sculpted bevelled lenticular lock profile (broad ribbon-sculpt, NOT a round pipe).
  const profile: readonly [number, number, number][] = [
    [1.0, -0.05, 0.88],
    [0.52, 0.88, 1.0],
    [0.0, 1.0 - groove, 1.0 - groove * 0.25],
    [-0.52, 0.88, 1.0],
    [-1.0, -0.05, 0.88],
    [0.0, -0.52, 0.72],
  ];

  const M = profile.length;
  const Bs: V3[] = [];
  const Ns: V3[] = [];
  const Ts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const T = norm(sub(centre[Math.min(n - 1, i + 1)]!, centre[Math.max(0, i - 1)]!));
    let N = out[i]!;
    N = norm(sub(N, [T[0] * dot(N, T), T[1] * dot(N, T), T[2] * dot(N, T)]));
    let B = norm(cross(N, T));
    if (dot(B, side[i]!) < 0) {
      B = [-B[0], -B[1], -B[2]];
      N = norm(cross(T, B));
    } else {
      N = norm(cross(T, B));
    }
    Ts.push(T);
    Bs.push(B);
    Ns.push(N);
  }

  // Root cap vertex tucked cleanly inside the crown cap (zero blunt tabs at the parting).
  const rootPos = space.push(add(centre[0]!, Ts[0]!, -0.15), 0.06, 0.68);
  const rootIdx = w.vertex(rootPos, [-Ts[0]![0], -Ts[0]![1], -Ts[0]![2]], Ts[0]!, uOffset + 0.5, 0, ao[0]! * 0.85, 1);

  const ringStarts: number[] = [];
  for (let i = 0; i < n; i++) {
    const tFrac = i / (n - 1);
    const hw = width[i]! * 0.5;
    const ht = thick[i]! * 0.5;
    const B = Bs[i]!;
    const N = Ns[i]!;
    const T = Ts[i]!;
    const c = centre[i]!;
    const minHeadClear = 0.08 + 0.18 * smooth(0, 0.16, tFrac);
    ringStarts.push(w.vertices);
    for (let k = 0; k < M; k++) {
      const [pu, pv, pAo] = profile[k]!;
      let pt = add(add(c, B, pu * hw), N, pv * ht);
      pt = space.push(pt, minHeadClear, 0.78);
      const nGuess = norm(add([B[0] * pu, B[1] * pu, B[2] * pu], N, pv));
      const u = uOffset + k / M;
      w.vertex(pt, nGuess, T, u, tFrac, clamp(ao[i]! * pAo, 0.52, 1.0), 1);
    }
  }

  const last = n - 1;
  const tipExtend = Math.min(1.1, width[Math.max(0, last - 1)]! * 0.42);
  const tipPos = space.push(add(centre[last]!, Ts[last]!, tipExtend), 0.25, 0.78);
  const tipIdx = w.vertex(tipPos, Ts[last]!, Ts[last]!, uOffset + 0.5, 1, ao[last]!, 1);

  const r0 = ringStarts[0]!;
  for (let k = 0; k < M; k++) {
    const k1 = (k + 1) % M;
    w.idx.push(rootIdx, r0 + k1, r0 + k);
  }
  for (let i = 0; i < n - 1; i++) {
    const ra = ringStarts[i]!;
    const rb = ringStarts[i + 1]!;
    for (let k = 0; k < M; k++) {
      const k1 = (k + 1) % M;
      w.idx.push(ra + k, ra + k1, rb + k, ra + k1, rb + k1, rb + k);
    }
  }
  const rLast = ringStarts[last]!;
  for (let k = 0; k < M; k++) {
    const k1 = (k + 1) % M;
    w.idx.push(rLast + k, rLast + k1, tipIdx);
  }

  w.recomputeNormals(vStart, iStart);
}

/**
 * Smooth, plump, organically sculpted 3D puff sphere (`8 × 4` lat/lon = 48 triangles, CCW FrontSide): packed densely
 * edge-to-edge so 3C and 4A–4C read as lush sculpted curl/coil clouds with smooth matte 3D form.
 */
function sculptedPuffBlob(
  w: PartWriter,
  space: HairSpace,
  centre: V3,
  outDir: V3,
  rx: number,
  ry: number,
  rz: number,
  lobeAmp: number,
  aoBase: number,
  seed: number,
  tileScale: number,
): void {
  const vStart = w.vertices;
  const iStart = w.idx.length;
  const D = norm(outDir);
  const ref: V3 = Math.abs(D[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
  const E1 = norm(cross(ref, D));
  const E2 = norm(cross(D, E1));
  const twist = (seed % 628) * 0.01;
  const ct = Math.cos(twist), st = Math.sin(twist);
  const A: V3 = [E1[0] * ct + E2[0] * st, E1[1] * ct + E2[1] * st, E1[2] * ct + E2[2] * st];
  const B: V3 = [E2[0] * ct - E1[0] * st, E2[1] * ct - E1[1] * st, E2[2] * ct - E1[2] * st];

  const lonN = 8;
  const latN = 4; // 3 intermediate rings + poles -> 8 + 16 + 16 + 8 = 48 tris
  const pAt = (lat: number, lon: number): { pt: V3; n: V3; u: number; v: number; ao: number } => {
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const co = Math.cos(lon), so = Math.sin(lon);
    // Soft organic pillowing (gentle 3-lobe variation, never jagged pebbles).
    const lobe = 1 + lobeAmp * (0.65 * Math.sin(3 * lon + seed) * cl * cl + 0.35 * Math.cos(2 * lon - lat + seed * 1.3) * cl);
    const lx = rx * cl * co * lobe;
    const ly = ry * cl * so * lobe;
    const lz = rz * sl * lobe;
    let pt: V3 = [
      centre[0] + A[0] * lx + B[0] * ly + D[0] * lz,
      centre[1] + A[1] * lx + B[1] * ly + D[1] * lz,
      centre[2] + A[2] * lx + B[2] * ly + D[2] * lz,
    ];
    pt = space.push(pt, 0.2, 0.6);
    const n = norm([A[0] * cl * co + B[0] * cl * so + D[0] * sl, A[1] * cl * co + B[1] * cl * so + D[1] * sl, A[2] * cl * co + B[2] * cl * so + D[2] * sl]);
    // Soft crevice shading at the embedded base, clean bright crown on top so even black hair reads clearly in 3D.
    const ao = clamp(aoBase * (0.70 + 0.32 * smooth(-0.7, 0.55, sl)), 0.56, 1.0);
    return { pt, n, u: (lon / (2 * Math.PI)) * tileScale, v: ((lat + Math.PI / 2) / Math.PI) * tileScale, ao };
  };

  const south = pAt(-Math.PI / 2, 0);
  const southIdx = w.vertex(south.pt, south.n, A, 0.5 * tileScale, 0, south.ao, 1);
  const rings: number[] = [];
  for (let j = 1; j < latN; j++) {
    const lat = -Math.PI / 2 + (Math.PI * j) / latN;
    rings.push(w.vertices);
    for (let i = 0; i < lonN; i++) {
      const lon = (2 * Math.PI * i) / lonN;
      const q = pAt(lat, lon);
      w.vertex(q.pt, q.n, A, q.u, q.v, q.ao, 1);
    }
  }
  const north = pAt(Math.PI / 2, 0);
  const northIdx = w.vertex(north.pt, north.n, A, 0.5 * tileScale, tileScale, north.ao, 1);

  const r0 = rings[0]!;
  for (let i = 0; i < lonN; i++) {
    const i1 = (i + 1) % lonN;
    w.idx.push(southIdx, r0 + i1, r0 + i);
  }
  for (let j = 0; j < rings.length - 1; j++) {
    const ra = rings[j]!;
    const rb = rings[j + 1]!;
    for (let i = 0; i < lonN; i++) {
      const i1 = (i + 1) % lonN;
      w.idx.push(ra + i, ra + i1, rb + i, ra + i1, rb + i1, rb + i);
    }
  }
  const rTop = rings[rings.length - 1]!;
  for (let i = 0; i < lonN; i++) {
    const i1 = (i + 1) % lonN;
    w.idx.push(rTop + i, rTop + i1, northIdx);
  }
  w.recomputeNormals(vStart, iStart);
}

// ---------------------------------------------------------------------------
// Sculpted hero lock guides (structured parting, coherent waves/curls, clean shoulder drape)
// ---------------------------------------------------------------------------

interface SculptedLockSpec {
  dir: V3;
  layer: number;
  widthScale: number;
  thickScale: number;
  lengthJitter: number;
  shoulderSide: number;
  faceFraming: boolean;
  groove: number;
  /** Coherent wave phase derived from azimuth + subtle per-lock variation so neighbours nest together. */
  phase: number;
}

function structuredHeroRoots(p: SculptedTypeParams, length: HairLength, countScale: number, rand: () => number): SculptedLockSpec[] {
  const specs: SculptedLockSpec[] = [];
  const scale = countScale * (length === 'short' ? 0.92 : 1.0);
  const addLock = (azDeg: number, elDeg: number, layer: number, widthScale: number, thickScale: number, lengthJitter: number, faceFraming = false): void => {
    const hl = hairlineEl(azDeg);
    const el = clamp(elDeg, hl + 1.0, 88.5) * DEG;
    const az = azDeg * DEG;
    const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const absAz = Math.abs(azDeg);
    const shoulderSide = absAz < 62 ? 1 : -1;
    const groove = rand() < 0.6 ? 0.14 + 0.08 * rand() : -0.04;
    // Coherent wave phase across azimuth so neighbouring sculpted waves nest smoothly (never lattice holes!).
    const phase = az * 2.2 + (rand() - 0.5) * 0.85;
    specs.push({ dir, layer, widthScale, thickScale, lengthJitter, shoulderSide, faceFraming, groove, phase });
  };

  // 1. Continuous centre-parting locks (left & right): start right along the top midline from the front hairline
  //    (el 36°) all the way over the very top of the crown (el 86°) to the upper back, so the parted locks themselves
  //    form the smooth crown dome and sculpted forehead hairline — zero exposed cap dome or protruding root tabs!
  const partPairs: readonly [number, number, number, number, boolean][] = [
    // [azDeg, elDeg, widthScale, lengthJitter, faceFraming]
    [1.8, 35, 1.10, -0.06, true],
    [3.5, 47, 1.18, -0.03, true],
    [6.5, 59, 1.24, 0.0, true],
    [11, 71, 1.26, 0.02, false],
    [24, 83, 1.26, 0.03, false],
    [146, 76, 1.24, 0.02, false],
    [164, 62, 1.22, 0.0, false],
  ];
  for (const side of [-1, 1]) {
    for (let i = 0; i < partPairs.length; i++) {
      if (rand() > scale * 1.15) continue;
      const [a0, e0, ws, lj, ff] = partPairs[i]!;
      addLock(side * (a0 + (rand() - 0.5) * 1.8), e0 + (rand() - 0.5) * 2.0, 0.62 + 0.32 * (1 - Math.abs(i - 2) * 0.14), ws, 1.02, lj + (rand() - 0.5) * 0.04, ff);
    }
  }

  // 2. Temple & upper-side overlapping sculpted locks tucked right below the crown parting sweep.
  const nMid = Math.max(8, Math.round(12 * scale));
  for (let i = 0; i < nMid; i++) {
    const f = (i + 0.5) / nMid;
    const azDeg = -170 + 340 * f + (rand() - 0.5) * 6;
    if (Math.abs(azDeg) < 34) continue;
    const hl = hairlineEl(azDeg);
    const elDeg = hl + 18 + 22 * (i % 2) + (rand() - 0.5) * 5;
    addLock(azDeg, elDeg, 0.34 + 0.42 * rand(), 1.20, 1.0, (rand() - 0.5) * 0.09, Math.abs(azDeg) < 55);
  }

  // 3. Sculpted outer accent tips framing the jawline, shoulders and back hem.
  const accentAz = [-42, -88, -140, 42, 88, 140];
  for (const a0 of accentAz) {
    if (rand() > scale) continue;
    const azDeg = a0 + (rand() - 0.5) * 6;
    const hl = hairlineEl(azDeg);
    const isFront = Math.abs(azDeg) < 55;
    addLock(azDeg, hl + (isFront ? 6 : 16) + 5 * rand(), 0.84 + 0.16 * rand(), isFront ? 0.78 : 0.90, 0.96, isFront ? -0.10 : 0.04 + (rand() - 0.5) * 0.06, isFront);
  }

  return specs;
}

interface SculptedGuide {
  pts: V3[];
  spec: SculptedLockSpec;
}

function growSculptedGuide(
  space: HairSpace,
  spec: SculptedLockSpec,
  p: SculptedTypeParams,
  length: HairLength,
  yEndBase: number,
  ring: HairBodyInput['ringY'],
  rand: () => number,
  vol: number,
): SculptedGuide {
  const h = space.head;
  const hs = h.scale;
  const [az, el] = azElOf(spec.dir);
  const absAzDeg = Math.abs(az / DEG);
  const root = add(h.c, spec.dir, headRadius(h, az, el));
  const reach = p.kind === 'wave' ? 0.20 * p.amp : p.kind === 'curl' ? 0.36 * p.amp : 0;
  // Target outer clearance once the lock clears the crown; root starts buried inside the crown dome (`chRoot = 0.08`)
  // and ramps smoothly over the first 6.5 cm so locks emerge seamlessly from the scalp with zero exposed root tabs.
  const chTarget = 0.42 + reach + spec.layer * p.thickness + (p.kind === 'curl' ? vol * 0.14 * smooth(15 * DEG, 70 * DEG, el) : 0);
  const chRoot = 0.08;
  const ct = 0.85 + reach + spec.layer * p.thickness * 0.55;

  const front = clamp(Math.cos(az), 0, 1);
  const sx = Math.abs(root[0] - h.c[0]) > 0.2 ? Math.sign(root[0] - h.c[0]) : rand() < 0.5 ? -1 : 1;

  // Sweep smoothly sideways and downward from the centre parting (hugging the scalp contour at the temples).
  const sidePush = spec.faceFraming ? 1.15 : 0.42 + 1.15 * front;
  const backBias = spec.shoulderSide < 0 ? -0.32 : 0.10;
  const want: V3 = [sx * sidePush, spec.faceFraming ? -0.88 : -1.0, -0.22 * front + backBias * (1 - front)];
  const n = spec.dir;
  const comb = norm(sub(want, [n[0] * dot(want, n), n[1] * dot(want, n), n[2] * dot(want, n)]));
  const archLift = p.lift * (spec.faceFraming ? 0.22 : 0.45 + 0.35 * smooth(40 * DEG, 80 * DEG, el));
  let d = norm(add(comb, n, archLift / Math.max(0.1, 1 - archLift)));
  let q = space.push(add(root, n, chRoot), chRoot, ct, spec.shoulderSide);

  const pts: V3[] = [q];
  const ds = 1.0;
  const span = Math.max(6, h.top - yEndBase);
  const yEnd = yEndBase - spec.lengthJitter * span * 0.4;
  const shortGrad = length === 'short' ? (p.kind === 'curl' ? 5.6 + 2.6 * smooth(-20 * DEG, 65 * DEG, el) : 5.6 + 3.4 * smooth(-25 * DEG, 70 * DEG, el)) * hs : 98;
  const maxLen = length === 'short' ? shortGrad * (1 + spec.lengthJitter * 0.35) : 98;

  for (let s = 0; s < maxLen; s += ds) {
    const chCur = chRoot + (chTarget - chRoot) * smooth(0, 6.5 * hs, s);
    const out = space.outward(q);
    // Damp horizontal bounce below chin height so shoulder/trapezius collisions never launch hair out into midair.
    if (q[1] < h.chin) d = norm([d[0] * 0.55, Math.min(-0.45, d[1]), d[2] * 0.45]);
    let force: V3 = [0, -p.gravity, 0];

    // Keep front hairline locks gracefully sweeping past the temples (never cutting in front of the eyes!).
    if (spec.faceFraming && s < 6.5 * hs) {
      force = add(force, [sx * 0.22 * (1 - s / (6.5 * hs)), 0, -0.05]);
    }

    const nearShoulder = smooth(h.chin + 2, ring.shoulder + 2, q[1]) * (1 - smooth(ring.shoulder - 4, ring.shoulder - 12, q[1]));
    if (nearShoulder > 0 && absAzDeg > 30 && absAzDeg < 110) {
      force = add(force, [0, 0, spec.shoulderSide * 0.14 * nearShoulder]);
    }

    if (length === 'chin' && (p.kind === 'straight' || p.kind === 'wave') && q[1] < yEnd + 4.5) {
      force = add(force, out, -0.20 * smooth(yEnd + 4.5, yEnd, q[1]));
    }

    const onBack = q[1] < ring.shoulder + 3 && q[2] < h.c[2] - 0.5;
    if (onBack) {
      const tInfo = space.torsoAt(q[1], q[0], q[2]);
      const targetDr = tInfo ? tInfo.r + ct + (p.kind === 'curl' ? 1.5 : 0.5) : 0;
      if (tInfo && tInfo.dr > targetDr) {
        force = add(force, out, -Math.min(0.45, (tInfo.dr - targetDr) * 0.15));
      }
    } else {
      const volZone = smooth(ring.shoulder - 4, h.chin + 4, q[1]);
      force = add(force, out, p.push * (0.45 + 0.55 * volZone) * (1 + 0.06 * vol));
    }

    d = norm(add(d, force));
    const next = space.push(add(q, d, ds), chCur, ct, spec.shoulderSide);
    const step = sub(next, q);
    if (len(step) > 1e-4) d = norm(step);
    q = next;
    pts.push(q);
    if (q[1] < yEnd) break;
  }

  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const chCur = chRoot + (chTarget - chRoot) * smooth(0, 6.5 * hs, i * ds);
      const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
      pts[i] = space.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4], chCur, ct, spec.shoulderSide);
    }
  }
  return { pts, spec };
}

function emitSculptedLock(w: PartWriter, space: HairSpace, g: SculptedGuide, p: SculptedTypeParams, length: HairLength, lockIndex: number): void {
  const hs = space.head.scale;
  const isCurl = p.kind === 'curl';
  // Smooth curve sampling (~6.4–7.0 samples per wave/curl cycle) keeps straight chest drape, waves and curls silky-smooth.
  const step = p.kind === 'straight'
    ? (length === 'short' ? 1.25 : length === 'chin' ? 1.8 : 2.15) * hs
    : p.kind === 'wave'
      ? Math.max(1.12, p.period / 6.6) * hs
      : Math.max(0.84, p.period / 6.8) * hs;
  const P = resample(g.pts, step);
  const n = P.length;
  if (n < 2) return;

  const centre: V3[] = [];
  const side: V3[] = [];
  const outArr: V3[] = [];
  const widthArr: number[] = [];
  const thickArr: number[] = [];
  const aoArr: number[] = [];

  const baseW = p.width * g.spec.widthScale * hs * (length === 'short' ? 0.85 : 1.0);
  const baseT = baseW * p.thickRatio * g.spec.thickScale;
  const layerAo = 0.78 + 0.22 * g.spec.layer;

  for (let i = 0; i < n; i++) {
    const tFrac = i / (n - 1);
    const s = i * step;
    const T = norm(sub(P[Math.min(n - 1, i + 1)]!, P[Math.max(0, i - 1)]!));
    let out = space.outward(P[i]!);
    out = norm(sub(out, [T[0] * dot(out, T), T[1] * dot(out, T), T[2] * dot(out, T)]));
    const round = norm(cross([0, 1, 0], out));
    const rb = sub(round, [T[0] * dot(round, T), T[1] * dot(round, T), T[2] * dot(round, T)]);
    const B = len(rb) > 0.3 ? norm(rb) : norm(cross(T, out));
    out = norm(cross(B, T));

    // Root emerges seamlessly from inside the crown dome (pinched flush inside cap at t=0, swelling cleanly over first 20%).
    const rootW = 0.28 + 0.72 * smooth(0, 0.22, tFrac);
    const rootT = 0.14 + 0.86 * smooth(0, 0.24, tFrac);
    const tipStart = length === 'short' ? 0.48 : isCurl ? 0.76 : 0.66;
    const minTip = isCurl ? 0.20 : 0.08;
    const tipTaper = tFrac > tipStart ? Math.pow(Math.max(minTip, 1 - (tFrac - tipStart) / (1 - tipStart)), 0.60) : 1.0;
    const wCur = baseW * rootW * tipTaper;
    const tCur = baseT * rootT * (tFrac > tipStart ? Math.pow(tipTaper, 0.82) : 1.0);

    const shaftAo = 0.78 + 0.22 * smooth(0, 0.2, tFrac);
    const tipShadow = 1 - 0.10 * smooth(0.84, 1.0, tFrac);
    aoArr.push(clamp(layerAo * shaftAo * tipShadow, 0.60, 1.0));
    widthArr.push(wCur);
    thickArr.push(tCur);

    const th = (2 * Math.PI * s) / (p.period * hs) + g.spec.phase;
    if (p.kind === 'straight') {
      centre.push(P[i]!);
      side.push(B);
      outArr.push(out);
    } else if (p.kind === 'wave') {
      const ramp = smooth(0, length === 'short' ? 2.5 : 5.5, s) * (0.65 + 0.35 * smooth(0, 18, s));
      const a = p.amp * hs * ramp * (0.45 + 0.55 * tipTaper);
      const pos = add(add(P[i]!, B, a * Math.sin(th)), out, 0.45 * a * Math.cos(th));
      centre.push(pos);
      side.push(B);
      outArr.push(norm(add(out, T, -0.28 * Math.cos(th) * ramp)));
    } else {
      // Silky-smooth plump 3D sculpted curl lock: smooth elliptical S-spiral ribbon curling away below the crown.
      const ramp = smooth(1.5 * hs, 6.5 * hs, s);
      const rB = p.amp * hs * ramp * (0.50 + 0.50 * tipTaper);
      const rO = p.amp * hs * 0.65 * ramp * (0.50 + 0.50 * tipTaper);
      const cx = Math.cos(th);
      const cy = Math.sin(th);
      const roll = 0.42 * Math.sin(th) * ramp;
      const sideCurl = norm(add(B, out, roll));
      const outCurl = norm(add(out, B, -roll * 0.45));
      centre.push(add(add(P[i]!, B, rB * cx), out, rO * cy));
      side.push(sideCurl);
      outArr.push(outCurl);
    }
  }

  sculptedLockTube(w, space, centre, side, outArr, widthArr, thickArr, aoArr, g.spec.groove, (lockIndex * 0.27) % 1);
}

/**
 * Emit densely packed, plump, overlapping 3D sculpted curl/coil puff clouds across the outer halo surface (3C, 4A–4C).
 * Puff radius scales with halo size so neighbouring puffs always overlap edge-to-edge like a sculpted cloud.
 */
function emitSculptedPuffs(
  w: PartWriter,
  space: HairSpace,
  p: SculptedTypeParams,
  length: HairLength,
  vol: number,
  count: number,
  rand: () => number,
): number {
  const h = space.head;
  const hs = h.scale;
  const coily = p.kind === 'coil';
  const droop = coily ? (p.lobeStrength < 0.13 ? 1.05 : 0.85) : 1.05;
  // Extend puffs right down to the forehead hairline so soft rounded coil puffs kiss the hairline cleanly (zero bare band).
  const dirs = scalpDirections(count, rand, (a) => -2.2 - Math.min(22, 2.15 * vol) * droop * smooth(32, 108, Math.abs(a)));
  const tileScale = coily ? 1.0 : 0.85;
  // Scale puff size smoothly with volume so large afros stay tightly packed with chunky overlapping puffs (never sparse pebbles!).
  const volScale = 0.82 + 0.052 * vol;

  const items = dirs.map((d, idx) => {
    const [az, el] = azElOf(d);
    const hl = hairlineEl(az / DEG) * DEG;
    const crownShape = 0.36 + 0.64 * smooth(hl - 16 * DEG, hl + 36 * DEG, el);
    const sideLift = 1 + 0.14 * smooth(34, 115, Math.abs(az / DEG)) * (1 - smooth(55 * DEG, 88 * DEG, el));
    const radScale = (0.86 + 0.30 * rand()) * volScale * hs;
    const rPuff = p.puffRadius * radScale * (length === 'short' ? 0.86 : 1.0);
    const rSurf = headRadius(h, az, el) + 0.35 + vol * crownShape * sideLift;
    // Sit proud on the surface (~28% embedded into core) so the silhouette is made of plump overlapping sculpted puffs.
    const rCentre = Math.max(headRadius(h, az, el) + 0.45 * rPuff, rSurf + 0.06 * rPuff + (rand() - 0.5) * rPuff * 0.32);
    const c = space.push(add(h.c, d, rCentre), 0.25 + rPuff * 0.32, 0.72 + rPuff * 0.32);
    const rx = rPuff * (0.96 + 0.16 * rand());
    const ry = rPuff * (coily ? 0.96 + 0.16 * rand() : 1.12 + 0.18 * rand());
    const rz = rPuff * (coily ? 0.88 + 0.16 * rand() : 0.82 + 0.16 * rand());
    const ao = 0.84 + 0.16 * smooth(hl - 12 * DEG, hl + 42 * DEG, el) * (0.88 + 0.12 * rand());
    return { c, d, rx, ry, rz, ao, rCentre, seed: idx * 73 + Math.floor(rand() * 500) };
  });

  items.sort((a, b) => b.rCentre - a.rCentre);
  for (const it of items) {
    sculptedPuffBlob(w, space, it.c, it.d, it.rx, it.ry, it.rz, p.lobeStrength, it.ao, it.seed, tileScale);
  }
  return items.length;
}

/** Build the sculpted solid-lock hair v2 (`style: 'sculpted'`). */
export function buildSculptedHair(input: HairBodyInput, choice: HairChoice, options: { countScale?: number } = {}): HairBuild {
  const head = headModel(input);
  const torso = torsoModel(input, head);
  const space = new HairSpace(head, torso);
  const p = TYPE_PARAMS[choice.type];
  const hs = head.scale;
  const vol = p.volume[choice.length] * hs;
  const coily = p.kind === 'coil';
  const tightCurl = choice.type === '3C';
  const seedBase = seedOf(`v2/${choice.type}/${choice.length}`);

  const build = (countScale: number): { parts: HairPart[]; clumps: number } => {
    const rand = rng(seedBase);
    const parts: HairPart[] = [];

    // 1. Opaque sculpted cap under everything.
    const cap = new PartWriter();
    buildSculptedCap(cap, space, p, !coily && !tightCurl);
    parts.push(cap.part('cap'));

    // 2. Closed sculpted base volume:
    //    - For 1–3B: continuous draped sculpted curtain behind the hero locks (zero scalp gaps / zero lattice holes!).
    //    - For 3C–4C: closed organically lobed sculpted cloud halo core.
    const shells = new PartWriter();
    if (coily || tightCurl) {
      buildSculptedVolume(shells, space, p, vol, seedBase % 997);
    } else {
      const yEnd = cutYOf(choice.length, p, head, input.ringY);
      buildSculptedCurtain(shells, space, p, choice.length, yEnd, input.ringY);
    }
    parts.push(shells.part('shells'));

    // 3. Sculpted hero locks or densely packed sculpted coil-puff clusters (`strands` part).
    const strands = new PartWriter();
    let clumps = 0;

    if (coily) {
      const lengthBoost = choice.length === 'short' ? 0.72 : choice.length === 'chin' ? 0.88 : choice.length === 'shoulder' ? 1.02 : 1.15;
      const puffCount = Math.max(40, Math.round(p.count * lengthBoost * countScale));
      clumps = emitSculptedPuffs(strands, space, p, choice.length, vol, puffCount, rand);
    } else if (tightCurl) {
      const puffTarget = Math.max(36, Math.round(p.count * (choice.length === 'short' ? 0.72 : choice.length === 'chin' ? 0.88 : 1.0) * countScale));
      clumps += emitSculptedPuffs(strands, space, p, choice.length, vol, puffTarget, rand);
      if (choice.length !== 'short') {
        const yEnd = cutYOf(choice.length, p, head, input.ringY);
        const hangCount = Math.max(10, Math.round((choice.length === 'chin' ? 14 : choice.length === 'shoulder' ? 18 : 22) * countScale));
        const dirs = scalpDirections(hangCount * 2, rand, (a) => 1.5 - 4 * smooth(70, 150, Math.abs(a)))
          .filter((d) => {
            const [az, el] = azElOf(d);
            return Math.abs(az / DEG) > 26 && el < (hairlineEl(az / DEG) + 32) * DEG;
          })
          .slice(0, hangCount);
        const guides: SculptedGuide[] = dirs.map((d) => {
          const [az] = azElOf(d);
          const absAz = Math.abs(az / DEG);
          const spec: SculptedLockSpec = {
            dir: d,
            layer: 0.45 + 0.55 * rand(),
            widthScale: 0.92 + 0.18 * rand(),
            thickScale: 1.0,
            lengthJitter: (rand() - 0.5) * 0.12,
            shoulderSide: absAz < 60 ? 1 : -1,
            faceFraming: absAz < 52,
            groove: 0.12,
            phase: az * 2.4 + (rand() - 0.5) * 0.9,
          };
          return growSculptedGuide(space, spec, p, choice.length, yEnd, input.ringY, rand, vol);
        });
        guides.sort((a, b) => b.spec.layer - a.spec.layer);
        for (let i = 0; i < guides.length; i++) emitSculptedLock(strands, space, guides[i]!, p, choice.length, i);
        clumps += guides.length;
      }
    } else {
      const specs = structuredHeroRoots(p, choice.length, countScale, rand);
      const yEnd = cutYOf(choice.length, p, head, input.ringY);
      const guides = specs.map((spec) => growSculptedGuide(space, spec, p, choice.length, yEnd, input.ringY, rand, vol));
      guides.sort((a, b) => b.spec.layer - a.spec.layer);
      for (let i = 0; i < guides.length; i++) emitSculptedLock(strands, space, guides[i]!, p, choice.length, i);
      clumps += guides.length;
    }

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
      scale = Math.max(0.15, (scale * (HAIR_TRIANGLE_BUDGET - fixed)) / strandTris) * 0.96;
      built = build(scale);
      triangles = built.parts.reduce((s, q) => s + q.indices.length / 3, 0);
    }
    simpler = `${before} clumps drawn as ${built.clumps} to stay within ${HAIR_TRIANGLE_BUDGET} triangles`;
  }
  return { choice, style: 'sculpted', parts: built.parts, triangles, clumps: built.clumps, look: p.look, simpler, head: { centre: head.c, top: head.top, chin: head.chin, scale: hs } };
}

/** Build the hair for `choice`: sculpted solid locks by default, or preserved v1 strand-cards with `style: 'strand-cards'`. */
export function buildHair(input: HairBodyInput, choice: HairChoice, options: BuildHairOptions = {}): HairBuild {
  if (options.style === 'strand-cards') return buildStrandCardsHair(input, choice, options);
  return buildSculptedHair(input, choice, options);
}

// ---------------------------------------------------------------------------
// Generated textures (RGBA8 with mipmaps; <= 256 KB total in GPU memory)
// ---------------------------------------------------------------------------

export interface HairTexture {
  width: number;
  height: number;
  /** Level 0 first; each RGBA8, rows from v = 0. */
  levels: Uint8Array[];
}

export const textureBytes = (t: HairTexture): number => t.levels.reduce((s, l) => s + l.byteLength, 0);

const toSrgb = (x: number): number => Math.round(255 * clamp(x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055, 0, 1));

export function withMips(width: number, height: number, lum: Float32Array, alpha: Float32Array): HairTexture {
  const levels: Uint8Array[] = [];
  let w = width, h = height, L = lum, A = alpha;
  const cover = (a: Float32Array, k: number): number => {
    let c = 0;
    for (let i = 0; i < a.length; i++) if (a[i]! * k >= 0.5) c++;
    return c / a.length;
  };
  const target = cover(alpha, 1);
  for (;;) {
    let k = 1;
    if (w !== width && target < 0.999) {
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

function normalMips(width: number, height: number, heightField: Float32Array, strength: number, wrapY: boolean): HairTexture {
  const nx0 = new Float32Array(width * height);
  const ny0 = new Float32Array(width * height);
  const nz0 = new Float32Array(width * height);
  const sample = (x: number, y: number): number => {
    const xx = (x + width) % width;
    const yy = wrapY ? (y + height) % height : clamp(y, 0, height - 1);
    return heightField[yy * width + xx]!;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * strength;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * strength;
      const l = Math.hypot(-dx, -dy, 1);
      const i = y * width + x;
      nx0[i] = -dx / l;
      ny0[i] = -dy / l;
      nz0[i] = 1 / l;
    }
  }
  const levels: Uint8Array[] = [];
  let w = width, h = height, X = nx0, Y = ny0, Z = nz0;
  for (;;) {
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      out[4 * i] = Math.round(clamp(X[i]! * 0.5 + 0.5, 0, 1) * 255);
      out[4 * i + 1] = Math.round(clamp(Y[i]! * 0.5 + 0.5, 0, 1) * 255);
      out[4 * i + 2] = Math.round(clamp(Z[i]! * 0.5 + 0.5, 0, 1) * 255);
      out[4 * i + 3] = 255;
    }
    levels.push(out);
    if (w === 1 && h === 1) break;
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const nX = new Float32Array(nw * nh), nY = new Float32Array(nw * nh), nZ = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sx = 0, sy = 0, sz = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const xx = Math.min(w - 1, 2 * x + dx), yy = Math.min(h - 1, 2 * y + dy);
            const idx = yy * w + xx;
            sx += X[idx]!;
            sy += Y[idx]!;
            sz += Z[idx]!;
          }
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        const idx = y * nw + x;
        nX[idx] = sx / l;
        nY[idx] = sy / l;
        nZ[idx] = sz / l;
      }
    }
    w = nw;
    h = nh;
    X = nX;
    Y = nY;
    Z = nZ;
  }
  return { width, height, levels };
}

/**
 * Procedural sculpted lock groove maps (64 × 128, tileable in u): soft, broad, combed longitudinal hair flutes with
 * subtle matte crevice AO (mean luminance ~0.94 so chosen hair colours stay true and never crush to black).
 */
export function sculptedLockTextures(seed = 19): { albedo: HairTexture; normal: HairTexture } {
  const W = 64, H = 128;
  const r = rng(seed);
  const modes = Array.from({ length: 5 }, (_, i) => ({
    freq: [2, 4, 6, 9, 13][i]!,
    amp: [0.36, 0.28, 0.18, 0.11, 0.05][i]!,
    ph: r() * Math.PI * 2,
    sway: (r() - 0.5) * 0.14,
  }));
  const height = new Float32Array(W * H);
  const lum = new Float32Array(W * H);
  const alpha = new Float32Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const rootShade = 0.90 + 0.10 * smooth(0, 0.16, v);
    const midLift = 1 + 0.05 * Math.sin(Math.PI * v);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let hVal = 0;
      for (const m of modes) {
        const ang = 2 * Math.PI * (u * m.freq + m.sway * Math.sin(2 * Math.PI * v)) + m.ph;
        const ridge = 1 - Math.abs(Math.sin(ang * 0.5));
        hVal += m.amp * (ridge * 2 - 1);
      }
      const idx = y * W + x;
      height[idx] = hVal;
      // Clean sculpted flute contrast baked into albedo so matte Lambert lighting shows distinct combed lock grooves.
      lum[idx] = clamp((0.88 + 0.18 * hVal) * rootShade * midLift, 0.62, 1.0);
    }
  }
  return {
    albedo: withMips(W, H, lum, alpha),
    normal: normalMips(W, H, height, 1.35, false),
  };
}

/**
 * Procedural sculpted coil/curl relief maps (64 × 64, tileable in u & v): soft velvet curl micro-dimples with gentle
 * matte crevice shading (preserving colour readability even in dark black `#1f1b19`).
 */
export function sculptedCoilTextures(type: HairType, seed = 29): { albedo: HairTexture; normal: HairTexture } {
  const W = 64, H = 64;
  const r = rng(seed + seedOf(type));
  const height = new Float32Array(W * H);
  const lum = new Float32Array(W * H);
  const alpha = new Float32Array(W * H).fill(1);
  const spec = type === '3C'
    ? { cells: 14, r0: 8.5, r1: 12.5, kink: 0.08 }
    : type === '4A'
      ? { cells: 18, r0: 7.0, r1: 10.5, kink: 0.12 }
      : type === '4B'
        ? { cells: 24, r0: 5.5, r1: 8.5, kink: 0.18 }
        : { cells: 32, r0: 4.5, r1: 7.0, kink: 0.24 };

  const centres = Array.from({ length: spec.cells }, () => ({
    x: r() * W,
    y: r() * H,
    rad: spec.r0 + r() * (spec.r1 - spec.r0),
    ph: r() * Math.PI * 2,
    amp: 0.78 + 0.22 * r(),
  }));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = 0;
      for (const c of centres) {
        let dx = x + 0.5 - c.x;
        let dy = y + 0.5 - c.y;
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        if (dy > H / 2) dy -= H;
        if (dy < -H / 2) dy += H;
        const ang = Math.atan2(dy, dx);
        const rr = c.rad * (1 + spec.kink * Math.sin(3 * ang + c.ph));
        const d = Math.hypot(dx, dy) / rr;
        if (d < 1.15) {
          const dome = Math.max(0, 1 - d * d) * c.amp;
          if (dome > best) best = dome;
        }
      }
      const idx = y * W + x;
      height[idx] = best;
      lum[idx] = clamp(0.84 + 0.18 * Math.pow(best, 0.75), 0.74, 1.0);
    }
  }
  return {
    albedo: withMips(W, H, lum, alpha),
    normal: normalMips(W, H, height, 1.25, true),
  };
}
