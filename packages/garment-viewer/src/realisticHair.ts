/**
 * Own procedural hair for the realistic body spike (D28): ten hair types in four lengths, stylised to match the
 * stylised face (D27). Entirely generated here, from the drawn body's own head: no hair asset, no photo, no texture
 * file. Pure (no WebGL, no I/O); `realisticHairDraw.ts` turns the result into three.js meshes.
 *
 * v2 (WO-012): sculpted, closed, opaque lock meshes (`FrontSide`, no alpha-cards) swept along structured scalp guides
 * with bevelled/fluted cross-sections, crisp tapered tips, procedural groove normal & AO maps, plump helical curls
 * (3A–3C), and sculpted cloud-clustered coil puffs (4A–4C). The original v1 strand-card implementation is preserved in
 * `realisticHairCards.ts` behind `options.style = 'strand-cards'` (for comparison and future CUR-31 loose accents).
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
  /** rows × NT radii about (0, cz[row]), angle 0 = front (+Z), towards +X. */
  R: Float32Array;
}

export function torsoModel(input: HairBodyInput, head: HeadModel): TorsoModel {
  const P = input.positions, W = input.headWeight, nb = input.bodyVertexCount;
  const lo = Math.floor(input.ringY.underbust - 14);
  const rows = Math.ceil(head.chin + 2 - lo);
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
  private readonly faceX: number;
  private readonly faceY: [number, number];
  private readonly faceZ: number;
  constructor(
    readonly head: HeadModel,
    readonly torso: TorsoModel,
  ) {
    const h = head;
    this.faceX = Math.max(4.65, 0.78 * h.halfWidth);
    this.faceY = [h.chin - 4, h.c[1] + Math.sin(30 * DEG) * headRadius(h, 0, 30 * DEG)];
    this.faceZ = h.c[2] + 0.15 * (h.top - h.chin);
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
          // Slide cleanly off the shoulder to the front or back (chosen by zBias when given) rather than sideways onto the arm.
          const zDir = zBias !== 0 ? Math.sign(zBias) : Math.sign(dz || -1);
          const off = ny > 0.45 ? 0.65 * pen * zDir : 0;
          q = [q[0] + ux * pen * nr, q[1] + pen * ny, q[2] + uz * pen * nr + off];
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

  /** Torso surface clearance lookup at (y, angle), for gently hugging the upper back without floating away. */
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
  /** Recompute area-weighted smooth vertex normals for a contiguous vertex/triangle range. */
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
// Sculpted hair v2: types and parameters
// ---------------------------------------------------------------------------

interface SculptedTypeParams {
  kind: 'straight' | 'wave' | 'curl' | 'coil';
  /** Wave amplitude or helix radius, cm. */
  amp: number;
  /** Wave length or helix pitch, cm. */
  period: number;
  /** Sculpted lock base width, cm. */
  width: number;
  /** Cross-section thickness ratio (thickness / width). */
  thickRatio: number;
  /** Outward crown volume & lateral push. */
  crownLift: number;
  push: number;
  gravity: number;
  lift: number;
  /** Share of straight length that shows (curls/coils shrink). */
  shrink: number;
  /** Radial depth across lock layers, cm. */
  thickness: number;
  /** Sculpted core/halo volume per length, cm (3A–4C). */
  volume: Record<HairLength, number>;
  /** Lock or puff cluster count target. */
  count: number;
  /** For coil/tight-curl puffs: base puff radius (cm) and lobe crispness. */
  puffRadius: number;
  lobeStrength: number;
  look: HairLook;
}

const NO_VOL = { short: 0, chin: 0, shoulder: 0, long: 0 };

export const TYPE_PARAMS: Readonly<Record<HairType, SculptedTypeParams>> = {
  '1': { kind: 'straight', amp: 0, period: 1, width: 3.1, thickRatio: 0.42, crownLift: 0.6, push: 0.0, gravity: 0.44, lift: 0.14, shrink: 1.0, thickness: 1.0, volume: NO_VOL, count: 44, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.56, anisotropy: 0.55, specular: 0.34, coilTileCm: 3.5 } },
  '2A': { kind: 'wave', amp: 0.72, period: 11.0, width: 3.05, thickRatio: 0.44, crownLift: 0.7, push: 0.012, gravity: 0.38, lift: 0.18, shrink: 0.96, thickness: 1.2, volume: NO_VOL, count: 44, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.6, anisotropy: 0.5, specular: 0.32, coilTileCm: 3.5 } },
  '2B': { kind: 'wave', amp: 1.2, period: 7.8, width: 2.95, thickRatio: 0.46, crownLift: 0.85, push: 0.024, gravity: 0.34, lift: 0.23, shrink: 0.92, thickness: 1.45, volume: NO_VOL, count: 46, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.64, anisotropy: 0.45, specular: 0.3, coilTileCm: 3.5 } },
  '2C': { kind: 'wave', amp: 1.58, period: 5.8, width: 2.85, thickRatio: 0.48, crownLift: 1.05, push: 0.036, gravity: 0.30, lift: 0.28, shrink: 0.88, thickness: 1.75, volume: NO_VOL, count: 48, puffRadius: 0, lobeStrength: 0, look: { roughness: 0.68, anisotropy: 0.4, specular: 0.28, coilTileCm: 3.5 } },
  '3A': { kind: 'curl', amp: 1.18, period: 5.2, width: 2.05, thickRatio: 0.68, crownLift: 1.25, push: 0.032, gravity: 0.28, lift: 0.28, shrink: 0.84, thickness: 1.9, volume: { short: 1.0, chin: 1.6, shoulder: 2.1, long: 2.5 }, count: 34, puffRadius: 0, lobeStrength: 0.14, look: { roughness: 0.7, anisotropy: 0.35, specular: 0.26, coilTileCm: 4.5 } },
  '3B': { kind: 'curl', amp: 0.94, period: 3.5, width: 1.92, thickRatio: 0.74, crownLift: 1.55, push: 0.046, gravity: 0.25, lift: 0.34, shrink: 0.76, thickness: 2.25, volume: { short: 1.4, chin: 2.3, shoulder: 3.1, long: 3.8 }, count: 34, puffRadius: 1.55, lobeStrength: 0.2, look: { roughness: 0.74, anisotropy: 0.3, specular: 0.24, coilTileCm: 4.2 } },
  '3C': { kind: 'curl', amp: 0.72, period: 2.2, width: 1.55, thickRatio: 0.80, crownLift: 1.8, push: 0.065, gravity: 0.22, lift: 0.42, shrink: 0.68, thickness: 2.5, volume: { short: 2.0, chin: 3.3, shoulder: 4.8, long: 6.2 }, count: 145, puffRadius: 1.65, lobeStrength: 0.26, look: { roughness: 0.78, anisotropy: 0.24, specular: 0.22, coilTileCm: 4.0 } },
  '4A': { kind: 'coil', amp: 0.5, period: 1.4, width: 1.5, thickRatio: 0.9, crownLift: 0, push: 0, gravity: 0, lift: 1, shrink: 0.56, thickness: 0, volume: { short: 2.2, chin: 4.3, shoulder: 6.9, long: 9.8 }, count: 175, puffRadius: 1.58, lobeStrength: 0.22, look: { roughness: 0.8, anisotropy: 0.2, specular: 0.22, coilTileCm: 3.8 } },
  '4B': { kind: 'coil', amp: 0.42, period: 1.0, width: 1.3, thickRatio: 0.92, crownLift: 0, push: 0, gravity: 0, lift: 1, shrink: 0.50, thickness: 0, volume: { short: 2.5, chin: 5.0, shoulder: 8.1, long: 11.4 }, count: 215, puffRadius: 1.36, lobeStrength: 0.28, look: { roughness: 0.84, anisotropy: 0.16, specular: 0.2, coilTileCm: 3.4 } },
  '4C': { kind: 'coil', amp: 0.35, period: 0.75, width: 1.15, thickRatio: 0.95, crownLift: 0, push: 0, gravity: 0, lift: 1, shrink: 0.44, thickness: 0, volume: { short: 2.8, chin: 5.7, shoulder: 9.3, long: 13.0 }, count: 255, puffRadius: 1.18, lobeStrength: 0.34, look: { roughness: 0.88, anisotropy: 0.12, specular: 0.18, coilTileCm: 3.0 } },
};

// ---------------------------------------------------------------------------
// Sculpted geometry primitives (100% closed, opaque, FrontSide CCW)
// ---------------------------------------------------------------------------

/** Smooth 3D pseudo-noise for organic sculpted curl/coil lobes (deterministic, zero deps). */
function organicLobe(x: number, y: number, z: number, freq: number, seed: number): number {
  const s1 = Math.sin(x * freq + seed * 1.17) * Math.cos(y * freq * 1.13 - seed * 0.71) * Math.sin(z * freq * 0.91 + seed * 2.03);
  const s2 = Math.cos(x * freq * 1.73 - z * freq * 1.41 + seed * 3.1) * Math.sin(y * freq * 1.61 + x * freq * 0.83 - seed * 1.4);
  return 0.62 * s1 + 0.38 * s2;
}

/**
 * Closed, opaque sculpted scalp cap: sits cleanly under the locks with a subtle crown lift and centre-parting crease
 * (for hanging types) and a tucked bottom rim flush with the scalp so it never reads as a rubber headband.
 */
function buildSculptedCap(w: PartWriter, space: HairSpace, p: SculptedTypeParams, parting: boolean): void {
  const h = space.head;
  const cols = 36;
  const rows = 9;
  const vStart = w.vertices;
  const iStart = w.idx.length;
  for (let i = 0; i <= cols; i++) {
    const az = -Math.PI + (2 * Math.PI * i) / cols;
    const azDeg = az / DEG;
    // Tuck slightly above the front hairline so front locks frame the forehead instead of showing a naked cap edge.
    const frontInset = 2.2 * smooth(75, 0, Math.abs(azDeg));
    const backBelow = 2.0 * smooth(95, 165, Math.abs(azDeg));
    const e0 = hairlineEl(azDeg) + frontInset - backBelow;
    for (let j = 0; j <= rows; j++) {
      const f = j / rows;
      const el = (e0 + (89.5 - e0) * Math.pow(f, 1.25)) * DEG;
      const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      const baseR = headRadius(h, az, el);
      // Row 0 tucks cleanly down to the scalp; upper rows swell into a sculpted crown with a subtle parting dip.
      const rimFade = smooth(0, 0.25, f);
      let lift = 0.08 + rimFade * (0.28 + (parting ? p.crownLift * 0.55 * smooth(20 * DEG, 72 * DEG, el) : 0.22));
      let ao = parting ? 0.54 + 0.24 * smooth(0, 0.7, f) : 0.48 + 0.14 * f;
      if (parting) {
        const xOff = Math.abs(dir[0] * baseR);
        const partMask = (1 - smooth(0, 1.8 * h.scale, xOff)) * smooth(28 * DEG, 65 * DEG, el) * smooth(-0.35, 0.25, dir[2]);
        lift -= 0.24 * partMask;
        ao *= 1 - 0.34 * partMask;
      }
      const pt = add(h.c, dir, baseR + lift);
      const tanEl: V3 = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)];
      // UVs run from the crown down towards the hairline so grooves radiate naturally from the part.
      const u = ((az + Math.PI) / (2 * Math.PI)) * 6;
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
 * Closed, solid, organically lobed sculpted volume shell (for 3A–3C inner curl mass and 4A–4C afro/coil mass).
 * The bottom rim smoothly tucks back inward to the head hull so it is 100% closed and never looks hollow from below
 * even with `FrontSide` rendering.
 */
function buildSculptedVolume(w: PartWriter, space: HairSpace, p: SculptedTypeParams, length: HairLength, vol: number, seed: number): void {
  const h = space.head;
  const hs = h.scale;
  const coily = p.kind === 'coil';
  const cols = coily ? 40 : 32;
  const mainRows = coily ? 12 : 10;
  const tuckRows = 2;
  const totalRows = mainRows + tuckRows;
  const vStart = w.vertices;
  const iStart = w.idx.length;

  const belowAt = (azDeg: number): number => {
    if (coily) {
      const droop = p.kind === 'coil' ? (p.lobeStrength < 0.25 ? 1.05 : 0.82) : 0.7;
      return droop * Math.min(24, 2.3 * vol) * smooth(32, 108, Math.abs(azDeg));
    }
    // Curly inner mass (3A–3C) drops softly at the sides and nape to back up the hanging ringlets.
    const dropScale = length === 'short' ? 0.55 : length === 'chin' ? 0.95 : length === 'shoulder' ? 1.25 : 1.45;
    return dropScale * Math.min(26, 3.2 * vol) * smooth(38, 105, Math.abs(azDeg));
  };

  const envRadius = (az: number, el: number): { r: number; lobe: number } => {
    const hl = hairlineEl(az / DEG) * DEG;
    // Fuller rounded afro halo on 4B/4C; slightly more tapered at temples and fuller at crown/back.
    const crownShape = coily
      ? 0.34 + 0.66 * smooth(hl - 16 * DEG, hl + 36 * DEG, el)
      : 0.25 + 0.75 * smooth(hl - 10 * DEG, hl + 32 * DEG, el);
    const sideLift = coily ? 1 + 0.14 * smooth(35, 115, Math.abs(az / DEG)) * (1 - smooth(55 * DEG, 88 * DEG, el)) : 1;
    const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const freq = coily ? (p.lobeStrength > 0.3 ? 11.5 : p.lobeStrength > 0.25 ? 9.5 : 7.8) : 6.8;
    const lobe = organicLobe(dir[0], dir[1], dir[2], freq, seed);
    const bumpAmp = Math.min(vol * 0.22, p.lobeStrength * 2.2 * hs);
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
      let vCoord: number;
      if (j < tuckRows) {
        // Closed underside rim: smoothly returns from the scalp hull out to the lower halo rim.
        const tf = j / tuckRows;
        el = (eInner + (eOuter - eInner) * Math.pow(tf, 0.75)) * DEG;
        const outer = envRadius(az, eOuter * DEG);
        const scalpR = headRadius(h, az, el) + 0.14;
        r = scalpR + (outer.r - scalpR) * Math.pow(tf, 1.35);
        ao = 0.38 + 0.16 * tf;
        vCoord = -0.15 * (1 - tf);
      } else {
        const f = (j - tuckRows) / mainRows;
        el = (eOuter + (89.5 - eOuter) * Math.pow(f, 1.15)) * DEG;
        const ev = envRadius(az, el);
        r = ev.r;
        // Crevice AO: darker in valleys between lobes and under the rim, brighter on raised lobes.
        const rimAo = 0.56 + 0.32 * smooth(0, 0.32, f);
        ao = clamp(rimAo * (coily ? 0.72 + 0.24 * ev.lobe : 0.62 + 0.16 * ev.lobe), 0.38, 0.92);
        vCoord = f;
      }
      const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      let pt = add(h.c, dir, r);
      pt = space.push(pt, 0.18, 0.65);
      const tanEl: V3 = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)];
      const rr = len(sub(pt, h.c));
      const u = ((az + Math.PI) * rr) / p.look.coilTileCm;
      const v = ((el + Math.PI / 2) * rr) / p.look.coilTileCm + vCoord * 0.01;
      w.vertex(pt, dir, tanEl, u, v, ao, 1);
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
 * A closed, solid, sculpted 3D lock mesh swept along `centre` with a bevelled/grooved cross-section (`sides = 6` or `8`),
 * closed root cap, crisp tapered sculpted tip apex, and area-weighted outward smooth normals (`FrontSide` CCW).
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
  sides: 6 | 8,
  groove: number,
  uOffset: number,
): void {
  const n = centre.length;
  if (n < 2) return;
  const vStart = w.vertices;
  const iStart = w.idx.length;

  // Cross-section profile points [uAlongSide, vAlongOut, aoMod] in CCW order around (B, N) where B × N = T.
  // Because `B = norm(cross(N, T))` makes `(B, N, T)` right-handed, advancing `k` from B -> N gives outward CCW winding.
  const profile: readonly [number, number, number][] = sides === 8
    ? [
        [1.0, -0.06, 0.84],
        [0.54, 0.86, 1.0],
        [0.0, 1.0 - groove, 1.0 - groove * 0.45],
        [-0.54, 0.86, 1.0],
        [-1.0, -0.06, 0.84],
        [-0.56, -0.48, 0.68],
        [0.0, -0.56, 0.62],
        [0.56, -0.48, 0.68],
      ]
    : [
        [1.0, -0.04, 0.84],
        [0.48, 0.90, 1.0],
        [0.0, 1.0 - groove, 1.0 - groove * 0.4],
        [-0.48, 0.90, 1.0],
        [-1.0, -0.04, 0.84],
        [0.0, -0.58, 0.64],
      ];

  const M = profile.length;
  // Build clean right-handed local frames along the spine.
  const Bs: V3[] = [];
  const Ns: V3[] = [];
  const Ts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const T = norm(sub(centre[Math.min(n - 1, i + 1)]!, centre[Math.max(0, i - 1)]!));
    let N = out[i]!;
    N = norm(sub(N, [T[0] * dot(N, T), T[1] * dot(N, T), T[2] * dot(N, T)]));
    let B = norm(cross(N, T));
    // Keep B aligned with the requested `side` direction when possible so flat locks never flip 180°.
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

  // Root cap vertex (closed start tucked on the scalp).
  const rootPos = space.push(add(centre[0]!, Ts[0]!, -0.2), 0.2, 0.68);
  const rootIdx = w.vertex(rootPos, [-Ts[0]![0], -Ts[0]![1], -Ts[0]![2]], Ts[0]!, uOffset + 0.5, 0, ao[0]! * 0.82, 1);

  const ringStarts: number[] = [];
  for (let i = 0; i < n; i++) {
    const tFrac = i / (n - 1);
    const hw = width[i]! * 0.5;
    const ht = thick[i]! * 0.5;
    const B = Bs[i]!;
    const N = Ns[i]!;
    const T = Ts[i]!;
    const c = centre[i]!;
    ringStarts.push(w.vertices);
    for (let k = 0; k < M; k++) {
      const [pu, pv, pAo] = profile[k]!;
      let pt = add(add(c, B, pu * hw), N, pv * ht);
      // Keep every sculpted ring vertex safely clear of the head, torso and face box.
      pt = space.push(pt, 0.26, 0.78);
      const nGuess = norm(add([B[0] * pu, B[1] * pu, B[2] * pu], N, pv));
      // Mirror u across the outer face (0..1) so longitudinal grooves sit cleanly along the lock's visible crest.
      const u = uOffset + (k / M);
      w.vertex(pt, nGuess, T, u, tFrac, clamp(ao[i]! * pAo, 0.35, 1.0), 1);
    }
  }

  // Closed crisp sculpted tip apex vertex.
  const last = n - 1;
  const tipExtend = Math.min(0.9, width[Math.max(0, last - 1)]! * 0.35);
  const tipPos = space.push(add(centre[last]!, Ts[last]!, tipExtend), 0.26, 0.78);
  const tipIdx = w.vertex(tipPos, Ts[last]!, Ts[last]!, uOffset + 0.5, 1, ao[last]!, 1);

  // Root cap triangles (facing -T, outward).
  const r0 = ringStarts[0]!;
  for (let k = 0; k < M; k++) {
    const k1 = (k + 1) % M;
    w.idx.push(rootIdx, r0 + k1, r0 + k);
  }

  // Body quads (guaranteed CCW outward).
  for (let i = 0; i < n - 1; i++) {
    const ra = ringStarts[i]!;
    const rb = ringStarts[i + 1]!;
    for (let k = 0; k < M; k++) {
      const k1 = (k + 1) % M;
      w.idx.push(ra + k, ra + k1, rb + k, ra + k1, rb + k1, rb + k);
    }
  }

  // Tip cap triangles (facing +T/outward).
  const rLast = ringStarts[last]!;
  for (let k = 0; k < M; k++) {
    const k1 = (k + 1) % M;
    w.idx.push(rLast + k, rLast + k1, tipIdx);
  }

  w.recomputeNormals(vStart, iStart);
}

/**
 * A closed, smooth, organically lobed 3D coil/curl puff blob (`6 × 3` lat/lon = 36 triangles, CCW FrontSide)
 * embedded into the outer afro/curly volume so every puff reads as tactile sculpted 3D hair even in dark colours.
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
  // Random twist around D so each puff has organic orientation.
  const twist = (seed % 628) * 0.01;
  const ct = Math.cos(twist), st = Math.sin(twist);
  const A: V3 = [E1[0] * ct + E2[0] * st, E1[1] * ct + E2[1] * st, E1[2] * ct + E2[2] * st];
  const B: V3 = [E2[0] * ct - E1[0] * st, E2[1] * ct - E1[1] * st, E2[2] * ct - E1[2] * st];

  const lonN = 6;
  const latN = 3; // 2 intermediate rings + south & north poles -> 6*2 + 6*2 + 6*2 = 36 tris (Wait: 6*1 + 6*2 + 6*1 = 24 tris!)
  const pAt = (lat: number, lon: number): { pt: V3; n: V3; u: number; v: number; ao: number } => {
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const co = Math.cos(lon), so = Math.sin(lon);
    // Subtle multi-lobe organic sculpt so puffs look like clustered coils rather than sterile marbles.
    const lobe = 1 + lobeAmp * (0.6 * Math.sin(3 * lon + seed) * cl + 0.4 * Math.cos(2 * lon - 2 * lat + seed * 1.7));
    const lx = rx * cl * co * lobe;
    const ly = ry * cl * so * lobe;
    const lz = rz * sl * lobe;
    let pt: V3 = [
      centre[0] + A[0] * lx + B[0] * ly + D[0] * lz,
      centre[1] + A[1] * lx + B[1] * ly + D[1] * lz,
      centre[2] + A[2] * lx + B[2] * ly + D[2] * lz,
    ];
    pt = space.push(pt, 0.18, 0.55);
    const n = norm([A[0] * cl * co + B[0] * cl * so + D[0] * sl, A[1] * cl * co + B[1] * cl * so + D[1] * sl, A[2] * cl * co + B[2] * cl * so + D[2] * sl]);
    // Darker AO near the embedded underside (sl < 0), bright clean crown on the outer dome (sl > 0).
    const ao = clamp(aoBase * (0.62 + 0.42 * smooth(-0.75, 0.65, sl)), 0.42, 1.0);
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

  // South fan (CCW outward: south -> r0[i+1] -> r0[i]).
  const r0 = rings[0]!;
  for (let i = 0; i < lonN; i++) {
    const i1 = (i + 1) % lonN;
    w.idx.push(southIdx, r0 + i1, r0 + i);
  }
  // Mid band(s) (CCW outward: ra[i] -> ra[i+1] -> rb[i]).
  for (let j = 0; j < rings.length - 1; j++) {
    const ra = rings[j]!;
    const rb = rings[j + 1]!;
    for (let i = 0; i < lonN; i++) {
      const i1 = (i + 1) % lonN;
      w.idx.push(ra + i, ra + i1, rb + i, ra + i1, rb + i1, rb + i);
    }
  }
  // North fan (CCW outward: rTop[i] -> rTop[i+1] -> north).
  const rTop = rings[rings.length - 1]!;
  for (let i = 0; i < lonN; i++) {
    const i1 = (i + 1) % lonN;
    w.idx.push(rTop + i, rTop + i1, northIdx);
  }
  w.recomputeNormals(vStart, iStart);
}

// ---------------------------------------------------------------------------
// Sculpted guide solver (structured parting, face-framing, clean shoulder/back drape)
// ---------------------------------------------------------------------------

interface SculptedLockSpec {
  dir: V3;
  layer: number;
  widthScale: number;
  thickScale: number;
  lengthJitter: number;
  /** +1 drapes in front of shoulder/chest, -1 sweeps behind shoulder onto back, 0 neutral. */
  shoulderSide: number;
  faceFraming: boolean;
  groove: number;
}

function cutYOf(length: HairLength, p: SculptedTypeParams, head: HeadModel, ring: HairBodyInput['ringY']): number {
  const y = length === 'short' ? head.chin + 5.2 : length === 'chin' ? head.chin + 1.0 : length === 'shoulder' ? ring.shoulder - 0.5 : (ring.chest + ring.underbust) / 2 - 2.5;
  return head.top - (head.top - y) * p.shrink;
}

/** Structured anatomical lock roots so the parting, hairline, temples and nape never have accidental gaps. */
function structuredRoots(p: SculptedTypeParams, length: HairLength, countScale: number, rand: () => number): SculptedLockSpec[] {
  const specs: SculptedLockSpec[] = [];
  const scale = countScale * (length === 'short' ? 0.92 : 1.0);
  const pushDir = (azDeg: number, elDeg: number, layer: number, widthScale: number, thickScale: number, lengthJitter: number, faceFraming = false): void => {
    const hl = hairlineEl(azDeg);
    const el = clamp(elDeg, hl + 1.2, 88.5) * DEG;
    const az = azDeg * DEG;
    const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const absAz = Math.abs(azDeg);
    const shoulderSide = absAz < 66 ? 1 : -1;
    const groove = rand() < 0.65 ? 0.16 + 0.1 * rand() : -0.04;
    specs.push({ dir, layer, widthScale, thickScale, lengthJitter, shoulderSide, faceFraming, groove });
  };

  if (p.kind === 'straight' || p.kind === 'wave') {
    // 1. Base curtain layer (broad airtight solid mass around sides and back).
    const nBase = Math.max(10, Math.round(16 * scale));
    for (let i = 0; i < nBase; i++) {
      const f = (i + 0.5) / nBase;
      const azDeg = -172 + 344 * f + (rand() - 0.5) * 6;
      if (Math.abs(azDeg) < 28) continue;
      const hl = hairlineEl(azDeg);
      const elDeg = hl + 10 + (rand() - 0.5) * 8 + 14 * (i % 2);
      pushDir(azDeg, elDeg, 0.08 + 0.16 * rand(), 1.38, 1.15, (rand() - 0.5) * 0.07);
    }
    // 2. Parting-line crown locks (left & right of centre part from front hairline to crown/back).
    const nPart = Math.max(5, Math.round(7 * scale));
    for (const side of [-1, 1]) {
      for (let i = 0; i < nPart; i++) {
        const f = i / Math.max(1, nPart - 1);
        // Sweep from front forehead (az ~ 14°, el ~ 37°) up over the crown (el ~ 82°) to upper back (az ~ 162°, el ~ 52°).
        const azDeg = side * (12 + 150 * Math.pow(f, 1.18)) + (rand() - 0.5) * 4;
        const elDeg = 38 + 44 * Math.sin(Math.PI * (0.12 + 0.78 * f)) + (rand() - 0.5) * 3;
        const frontFace = i <= 1;
        pushDir(azDeg, elDeg, 0.55 + 0.25 * rand(), frontFace ? 0.92 : 1.05, 1.0, frontFace ? -0.1 : (rand() - 0.5) * 0.08, frontFace);
      }
    }
    // 3. Mid-sculpted fill ring around temples, sides and occiput.
    const nMid = Math.max(8, Math.round(14 * scale));
    for (let i = 0; i < nMid; i++) {
      const f = (i + 0.5) / nMid;
      const azDeg = -175 + 350 * f + (rand() - 0.5) * 8;
      if (Math.abs(azDeg) < 22) continue;
      const hl = hairlineEl(azDeg);
      const elDeg = hl + 26 + 18 * ((i % 2) ? 0.7 : 0.2) + (rand() - 0.5) * 6;
      pushDir(azDeg, elDeg, 0.42 + 0.34 * rand(), 1.02, 1.0, (rand() - 0.5) * 0.09);
    }
    // 4. Sculpted accent / face-framing locks along the temples and outer shoulder sweep.
    const accentAz = [-32, -52, -78, -118, -155, 32, 52, 78, 118, 155];
    for (const a0 of accentAz) {
      if (rand() > scale) continue;
      const azDeg = a0 + (rand() - 0.5) * 6;
      const hl = hairlineEl(azDeg);
      const isFront = Math.abs(azDeg) < 65;
      const elDeg = hl + (isFront ? 6 + 6 * rand() : 22 + 16 * rand());
      pushDir(azDeg, elDeg, 0.84 + 0.16 * rand(), isFront ? 0.68 : 0.76, 0.92, isFront ? -0.12 - 0.06 * rand() : -0.05 + 0.08 * rand(), isFront);
    }
  } else {
    // Curly locks (3A, 3B, or perimeter curls of 3C): fuller crown + dense ringlet coverage.
    const total = Math.max(18, Math.round(p.count * scale));
    const dirs = scalpDirections(total, rand, (a) => 1.8 - 2.5 * smooth(85, 160, Math.abs(a)));
    for (const d of dirs) {
      const [az, el] = azElOf(d);
      const azDeg = az / DEG;
      const absAz = Math.abs(azDeg);
      const layer = clamp(0.18 + 0.72 * rand() + 0.18 * smooth(25 * DEG, 70 * DEG, el), 0, 1);
      const frontFace = absAz < 58 && el < 46 * DEG;
      specs.push({
        dir: d,
        layer,
        widthScale: frontFace ? 0.84 : 0.92 + 0.24 * rand(),
        thickScale: 0.95 + 0.15 * rand(),
        lengthJitter: (rand() - 0.5) * 0.14 - (frontFace ? 0.08 : 0),
        shoulderSide: absAz < 64 ? 1 : -1,
        faceFraming: frontFace,
        groove: 0.12,
      });
    }
  }
  return specs;
}

interface SculptedGuide {
  pts: V3[];
  spec: SculptedLockSpec;
  phase: number;
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
  const reach = p.kind === 'wave' ? 0.35 * p.amp : p.kind === 'curl' ? 0.75 * p.amp : 0;
  const ch = 0.28 + reach + spec.layer * p.thickness + (p.kind === 'curl' ? vol * 0.32 * smooth(20 * DEG, 70 * DEG, el) : 0);
  const ct = 0.75 + reach + spec.layer * p.thickness * 0.55;

  const front = clamp(Math.cos(az), 0, 1);
  const sx = Math.abs(root[0] - h.c[0]) > 0.25 ? Math.sign(root[0] - h.c[0]) : rand() < 0.5 ? -1 : 1;

  // Sweep gracefully away from the centre parting at the crown, framing the temples cleanly and flowing down the back.
  const sidePush = 0.42 + 1.45 * front;
  const backBias = spec.shoulderSide < 0 ? -0.35 : 0.12;
  const want: V3 = [sx * sidePush, -1.0, -0.22 * front + backBias * (1 - front)];
  const n = spec.dir;
  const comb = norm(sub(want, [n[0] * dot(want, n), n[1] * dot(want, n), n[2] * dot(want, n)]));
  const archLift = p.lift * (0.65 + 0.55 * smooth(35 * DEG, 80 * DEG, el));
  let d = norm(add(comb, n, archLift / Math.max(0.08, 1 - archLift)));
  let q = space.push(add(root, n, Math.min(ch, 0.35 + spec.layer * 0.65)), 0.25, ct, spec.shoulderSide);

  const pts: V3[] = [q];
  const ds = 1.0;
  // Staggered organic cut height: front framing slightly shorter, short hair graduated naturally from nape to crown.
  const span = Math.max(6, h.top - yEndBase);
  const yEnd = yEndBase - spec.lengthJitter * span * 0.45;
  const shortGrad = length === 'short' ? (p.kind === 'curl' ? 5.2 + 2.6 * smooth(-20 * DEG, 65 * DEG, el) : 5.4 + 3.6 * smooth(-25 * DEG, 70 * DEG, el)) * hs : 98;
  const maxLen = length === 'short' ? shortGrad * (1 + spec.lengthJitter * 0.4) : 98;

  for (let s = 0; s < maxLen; s += ds) {
    const out = space.outward(q);
    // Graceful crown arch over first 3 cm, then gravity takes over cleanly.
    const crownBoost = s < 3.5 ? (1 - s / 3.5) * p.crownLift * 0.16 : 0;
    let force: V3 = [0, -p.gravity, 0];

    // OI-172 fix: steer side locks cleanly forward over the front shoulder/chest OR backward onto the upper back,
    // and keep hanging locks gently inside the outer arm zone so wide curls never clip the upper arms.
    const nearShoulder = smooth(h.chin + 3, ring.shoulder + 1, q[1]) * (1 - smooth(ring.shoulder - 8, ring.shoulder - 20, q[1]));
    if (nearShoulder > 0 && absAzDeg > 28 && absAzDeg < 126) {
      force = add(force, [0, 0, spec.shoulderSide * 0.30 * nearShoulder]);
      force = add(force, [-sx * (spec.shoulderSide > 0 ? 0.14 : 0.08) * nearShoulder, 0, 0]);
    }
    if (q[1] < ring.shoulder + 2 && Math.abs(q[0]) > 14.5 * hs) {
      force = add(force, [-Math.sign(q[0]) * 0.16, 0, spec.shoulderSide * 0.12]);
    }

    // Chin-length bob: soft sculpted inward curve at the bottom 3 cm toward the jawline/neck.
    if (length === 'chin' && (p.kind === 'straight' || p.kind === 'wave') && q[1] < yEnd + 4.5) {
      const bobT = smooth(yEnd + 4.5, yEnd, q[1]);
      force = add(force, out, -0.18 * bobT);
    }

    // Upper-back hug: prevent long straight/wavy locks from bowing outward away from the shoulder blades.
    const onBack = q[1] < ring.shoulder + 2 && q[2] < h.c[2] - 1;
    if (onBack && (p.kind === 'straight' || p.kind === 'wave')) {
      const tInfo = space.torsoAt(q[1], q[0], q[2]);
      const targetDr = tInfo ? tInfo.r + ct + 0.6 : 0;
      if (tInfo && tInfo.dr > targetDr) {
        const pull = Math.min(0.24, (tInfo.dr - targetDr) * 0.06);
        force = add(force, out, -pull);
      }
    } else {
      // Controlled outward volume near head/sides (never kicking tips wildly outward on the back).
      const volZone = smooth(ring.shoulder - 4, h.chin + 4, q[1]);
      force = add(force, out, p.push * (0.45 + 0.55 * volZone) * (1 + 0.1 * vol) + crownBoost);
    }

    d = norm(add(d, force));
    const next = space.push(add(q, d, ds), ch, ct, spec.shoulderSide);
    const step = sub(next, q);
    if (len(step) > 1e-4) d = norm(step);
    q = next;
    pts.push(q);
    if (q[1] < yEnd) break;
  }

  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
      pts[i] = space.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4], ch, ct, spec.shoulderSide);
    }
  }
  return { pts, spec, phase: rand() * 2 * Math.PI };
}

function emitSculptedLock(w: PartWriter, space: HairSpace, g: SculptedGuide, p: SculptedTypeParams, length: HairLength, lockIndex: number): void {
  const hs = space.head.scale;
  const isCurl = p.kind === 'curl';
  const step = p.kind === 'straight'
    ? (length === 'short' ? 1.35 : length === 'chin' ? 2.2 : 3.2) * hs
    : p.kind === 'wave'
      ? Math.max(1.55, p.period / 4.2) * hs
      : Math.max(0.95, p.period / 3.9) * hs;
  const P = resample(g.pts, step);
  const n = P.length;
  if (n < 2) return;

  const centre: V3[] = [];
  const side: V3[] = [];
  const outArr: V3[] = [];
  const widthArr: number[] = [];
  const thickArr: number[] = [];
  const aoArr: number[] = [];

  const baseW = p.width * g.spec.widthScale * hs * (length === 'short' ? 0.84 : 1.0);
  const baseT = baseW * p.thickRatio * g.spec.thickScale;
  const layerAo = 0.64 + 0.34 * g.spec.layer;

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

    // Smooth sculpted lock silhouette profile: tucked at root, plump mid-shaft, graceful pointed taper at tip.
    const rootSwell = 0.64 + 0.36 * smooth(0, 0.16, tFrac);
    const tipStart = length === 'short' ? 0.42 : isCurl ? 0.72 : 0.64;
    const tipTaper = tFrac > tipStart ? Math.pow(Math.max(0.06, 1 - (tFrac - tipStart) / (1 - tipStart)), 0.62) : 1.0;
    const wCur = baseW * rootSwell * tipTaper;
    const tCur = baseT * (0.58 + 0.42 * smooth(0, 0.18, tFrac)) * (tFrac > tipStart ? Math.pow(tipTaper, 0.85) : 1.0);

    // Subtle root AO darkening near the parting & scalp, lifting smoothly along the sculpted shaft.
    const shaftAo = 0.66 + 0.34 * smooth(0, 0.22, tFrac);
    const tipShadow = 1 - 0.12 * smooth(0.82, 1.0, tFrac);
    aoArr.push(clamp(layerAo * shaftAo * tipShadow, 0.42, 1.0));
    widthArr.push(wCur);
    thickArr.push(tCur);

    const th = (2 * Math.PI * s) / (p.period * hs) + g.phase;
    if (p.kind === 'straight') {
      centre.push(P[i]!);
      side.push(B);
      outArr.push(out);
    } else if (p.kind === 'wave') {
      const ramp = smooth(0, length === 'short' ? 2.2 : 5.0, s) * (0.65 + 0.35 * smooth(0, 20, s));
      const a = p.amp * hs * ramp * (0.45 + 0.55 * tipTaper);
      const pos = add(add(P[i]!, B, a * Math.sin(th)), out, 0.42 * a * Math.cos(th));
      centre.push(pos);
      side.push(B);
      outArr.push(norm(add(out, T, -0.3 * Math.cos(th) * ramp)));
    } else {
      // Plump 3D helical spring curl: centre spirals around the guide so the solid tube reads as a bouncy sculpted ringlet.
      const ramp = smooth(0, 2.2 * hs, s);
      const r = p.amp * hs * ramp * (0.42 + 0.58 * tipTaper);
      const cx = Math.cos(th);
      const cy = Math.sin(th);
      const radial = norm(add([B[0] * cx, B[1] * cx, B[2] * cx], out, cy));
      centre.push(add(add(P[i]!, B, r * cx), out, r * cy));
      side.push(norm(cross(radial, T)));
      outArr.push(radial);
    }
  }

  sculptedLockTube(w, space, centre, side, outArr, widthArr, thickArr, aoArr, 6, g.spec.groove, (lockIndex * 0.23) % 1);
}

/** Emit sculpted 3D coil/curl puff clusters distributed organically across the outer halo surface (3C, 4A–4C). */
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
  const droop = coily ? (p.lobeStrength < 0.25 ? 1.05 : 0.82) : 0.95;
  const dirs = scalpDirections(count, rand, (a) => 1.5 - Math.min(20, 2.0 * vol) * droop * smooth(34, 108, Math.abs(a)));
  const tileScale = coily ? 1.2 : 1.0;

  // Emit outer puffs first for Early-Z friendliness.
  const items = dirs.map((d, idx) => {
    const [az, el] = azElOf(d);
    const hl = hairlineEl(az / DEG) * DEG;
    const crownShape = coily
      ? 0.34 + 0.66 * smooth(hl - 16 * DEG, hl + 36 * DEG, el)
      : 0.25 + 0.75 * smooth(hl - 10 * DEG, hl + 32 * DEG, el);
    const sideLift = coily ? 1 + 0.14 * smooth(35, 115, Math.abs(az / DEG)) * (1 - smooth(55 * DEG, 88 * DEG, el)) : 1;
    const radScale = (0.82 + 0.38 * rand()) * (length === 'short' ? 0.84 : length === 'chin' ? 0.94 : 1.04) * hs;
    const rPuff = p.puffRadius * radScale;
    // Embed each puff cleanly into the outer sculpted volume so puffs overlap organically without floating gaps.
    const rSurf = headRadius(h, az, el) + 0.35 + vol * crownShape * sideLift;
    const depthOffset = (rand() - 0.35) * rPuff * 0.45;
    const rCentre = Math.max(headRadius(h, az, el) + 0.45 * rPuff, rSurf - 0.22 * rPuff + depthOffset);
    const c = space.push(add(h.c, d, rCentre), 0.25 + rPuff * 0.4, 0.75 + rPuff * 0.4);
    const rx = rPuff * (0.94 + 0.2 * rand());
    const ry = rPuff * (coily ? 0.94 + 0.2 * rand() : 1.12 + 0.22 * rand());
    const rz = rPuff * (coily ? 0.78 + 0.22 * rand() : 0.72 + 0.18 * rand());
    const ao = 0.78 + 0.22 * smooth(hl - 12 * DEG, hl + 40 * DEG, el) * (0.85 + 0.15 * rand());
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

    // 2. Closed sculpted volume core (3A–3C inner curly body, 4A–4C sculpted cloud afro volume).
    if (vol > 0) {
      const shells = new PartWriter();
      buildSculptedVolume(shells, space, p, choice.length, vol, seedBase % 997);
      parts.push(shells.part('shells'));
    }

    // 3. Sculpted locks or sculpted coil-puff clusters (`strands` part for API/test continuity).
    const strands = new PartWriter();
    let clumps = 0;

    if (coily) {
      const lengthBoost = choice.length === 'short' ? 0.72 : choice.length === 'chin' ? 0.88 : choice.length === 'shoulder' ? 1.02 : 1.15;
      const puffCount = Math.max(40, Math.round(p.count * lengthBoost * countScale));
      clumps = emitSculptedPuffs(strands, space, p, choice.length, vol, puffCount, rand);
    } else if (tightCurl) {
      // 3C: sculpted crown & halo curl-cluster puffs + tight bouncy corkscrew locks around the lower perimeter.
      const puffTarget = Math.max(36, Math.round(p.count * (choice.length === 'short' ? 0.72 : choice.length === 'chin' ? 0.88 : 1.0) * countScale));
      clumps += emitSculptedPuffs(strands, space, p, choice.length, vol, puffTarget, rand);
      if (choice.length !== 'short') {
        const yEnd = cutYOf(choice.length, p, head, input.ringY);
        const hangCount = Math.max(12, Math.round((choice.length === 'chin' ? 18 : choice.length === 'shoulder' ? 24 : 28) * countScale));
        const dirs = scalpDirections(hangCount * 2, rand, (a) => 1.5 - 4 * smooth(70, 150, Math.abs(a)))
          .filter((d) => {
            const [az, el] = azElOf(d);
            return el < (hairlineEl(az / DEG) + 34) * DEG;
          })
          .slice(0, hangCount);
        const guides: SculptedGuide[] = dirs.map((d) => {
          const [az] = azElOf(d);
          const absAz = Math.abs(az / DEG);
          const spec: SculptedLockSpec = {
            dir: d,
            layer: 0.45 + 0.55 * rand(),
            widthScale: 0.92 + 0.2 * rand(),
            thickScale: 1.0,
            lengthJitter: (rand() - 0.5) * 0.14,
            shoulderSide: absAz < 62 ? 1 : -1,
            faceFraming: absAz < 55,
            groove: 0.14,
          };
          return growSculptedGuide(space, spec, p, choice.length, yEnd, input.ringY, rand, vol);
        });
        guides.sort((a, b) => b.spec.layer - a.spec.layer);
        for (let i = 0; i < guides.length; i++) emitSculptedLock(strands, space, guides[i]!, p, choice.length, i);
        clumps += guides.length;
      }
    } else {
      const specs = structuredRoots(p, choice.length, countScale, rand);
      const yEnd = cutYOf(choice.length, p, head, input.ringY);
      const guides = specs.map((spec) => growSculptedGuide(space, spec, p, choice.length, yEnd, input.ringY, rand, vol));
      // Outer layers first for Early-Z depth rejection.
      guides.sort((a, b) => b.spec.layer - a.spec.layer);
      for (let i = 0; i < guides.length; i++) emitSculptedLock(strands, space, guides[i]!, p, choice.length, i);
      clumps = guides.length;
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

/** Build RGBA8 mip pyramid from linear RGB normal channels ([-1, 1] -> [0, 255], renormalized per mip). */
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
 * Procedural sculpted lock groove maps (64 × 128, tileable in u): clean longitudinal hair flutes with soft crevice AO
 * and tangent-space normal relief so solid sculpted locks read as combed locks without fine noisy static.
 */
export function sculptedLockTextures(seed = 19): { albedo: HairTexture; normal: HairTexture } {
  const W = 64, H = 128;
  const r = rng(seed);
  // 8 primary + 6 secondary longitudinal grooves across u (tileable).
  const modes = Array.from({ length: 6 }, (_, i) => ({
    freq: [3, 5, 7, 11, 14, 19][i]!,
    amp: [0.34, 0.26, 0.20, 0.12, 0.06, 0.03][i]!,
    ph: r() * Math.PI * 2,
    sway: (r() - 0.5) * 0.22,
  }));
  const height = new Float32Array(W * H);
  const lum = new Float32Array(W * H);
  const alpha = new Float32Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const rootShade = 0.86 + 0.14 * smooth(0, 0.18, v);
    const midLift = 1 + 0.06 * Math.sin(Math.PI * v);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let hVal = 0;
      for (const m of modes) {
        const ang = 2 * Math.PI * (u * m.freq + m.sway * Math.sin(2 * Math.PI * v)) + m.ph;
        // Rounded ridge / sharper crease profile (`abs(sin)` inverted) mimics carved hair grooves.
        const ridge = 1 - Math.abs(Math.sin(ang * 0.5));
        hVal += m.amp * (ridge * 2 - 1);
      }
      const idx = y * W + x;
      height[idx] = hVal;
      // Soft matte groove AO: darker inside sculpted valleys, gentle bright crest on lock ridges.
      lum[idx] = clamp((0.80 + 0.22 * hVal) * rootShade * midLift, 0.45, 1.0);
    }
  }
  return {
    albedo: withMips(W, H, lum, alpha),
    normal: normalMips(W, H, height, 2.1, false),
  };
}

/**
 * Procedural sculpted coil/curl relief maps (64 × 64, tileable in u & v): soft clustered dimples and curved coil
 * grooves for 3C–4C sculpted volumes and puff clusters.
 */
export function sculptedCoilTextures(type: HairType, seed = 29): { albedo: HairTexture; normal: HairTexture } {
  const W = 64, H = 64;
  const r = rng(seed + seedOf(type));
  const height = new Float32Array(W * H);
  const lum = new Float32Array(W * H);
  const alpha = new Float32Array(W * H).fill(1);
  const spec = type === '3C'
    ? { cells: 18, r0: 6.5, r1: 10.5, kink: 0.12 }
    : type === '4A'
      ? { cells: 24, r0: 5.5, r1: 8.5, kink: 0.18 }
      : type === '4B'
        ? { cells: 34, r0: 4.2, r1: 6.8, kink: 0.30 }
        : { cells: 46, r0: 3.4, r1: 5.4, kink: 0.42 };

  // Soft pillowy cellular coil bumps (tileable).
  const centres = Array.from({ length: spec.cells }, () => ({
    x: r() * W,
    y: r() * H,
    rad: spec.r0 + r() * (spec.r1 - spec.r0),
    ph: r() * Math.PI * 2,
    amp: 0.72 + 0.28 * r(),
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
      // Crevice AO between rounded coil clusters, soft lit crown on domes.
      lum[idx] = clamp(0.62 + 0.38 * Math.pow(best, 0.7), 0.45, 1.0);
    }
  }
  return {
    albedo: withMips(W, H, lum, alpha),
    normal: normalMips(W, H, height, 2.4, true),
  };
}
