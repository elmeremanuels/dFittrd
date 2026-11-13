/**
 * Signed distance to the mannequin (`mannequin.glb`, the exact mesh the GPU stages rendered), on a
 * voxel grid with trilinear lookup. Stage 4t (`templateFit.ts`) uses it as a hard constraint: no
 * garment vertex closer than `MIN_CLEARANCE_CM` to the body, inside counted negative.
 *
 * The mannequin is a union of closed, overlapping parts (torso with head, two legs, two arms;
 * `topology` reports 5 watertight components). The signed distance of a union is the minimum of
 * the parts' signed distances, so every part gets its own narrow band (exact point–triangle
 * distance, sign from the angle-weighted pseudo-normal of the nearest face, edge or vertex,
 * Bærentzen and Aanæs 2005) and its own flood fill for the far field (outside = reachable from the
 * grid border without crossing the band's inside), and the parts are combined with `min`. Beyond the
 * band the value is ±band: the sign is exact, the magnitude only says "far".
 */
import type { Mesh } from '@curtain/mannequin';

export interface BodySdf {
  origin: [number, number, number];
  voxelCm: number;
  dims: [number, number, number];
  bandCm: number;
  values: Float32Array;
  /** Signed distance at a point, cm (negative inside the body). Trilinear; outside the grid: +band. */
  at(x: number, y: number, z: number): number;
}

/** Garment vertices stay at least this far outside the mannequin (stage 4t hard constraint). */
export const MIN_CLEARANCE_CM = 0.4;

type V3 = [number, number, number];

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5) and its feature: 0 face, 1–3 edge ab/bc/ca, 4–6 vertex a/b/c. */
function closestOnTriangle(p: V3, a: V3, b: V3, c: V3, out: V3): number {
  const ab0 = b[0] - a[0], ab1 = b[1] - a[1], ab2 = b[2] - a[2];
  const ac0 = c[0] - a[0], ac1 = c[1] - a[1], ac2 = c[2] - a[2];
  const ap0 = p[0] - a[0], ap1 = p[1] - a[1], ap2 = p[2] - a[2];
  const d1 = ab0 * ap0 + ab1 * ap1 + ab2 * ap2;
  const d2 = ac0 * ap0 + ac1 * ap1 + ac2 * ap2;
  if (d1 <= 0 && d2 <= 0) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
    return 4;
  }
  const bp0 = p[0] - b[0], bp1 = p[1] - b[1], bp2 = p[2] - b[2];
  const d3 = ab0 * bp0 + ab1 * bp1 + ab2 * bp2;
  const d4 = ac0 * bp0 + ac1 * bp1 + ac2 * bp2;
  if (d3 >= 0 && d4 <= d3) {
    out[0] = b[0]; out[1] = b[1]; out[2] = b[2];
    return 5;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = a[0] + v * ab0; out[1] = a[1] + v * ab1; out[2] = a[2] + v * ab2;
    return 1;
  }
  const cp0 = p[0] - c[0], cp1 = p[1] - c[1], cp2 = p[2] - c[2];
  const d5 = ab0 * cp0 + ab1 * cp1 + ab2 * cp2;
  const d6 = ac0 * cp0 + ac1 * cp1 + ac2 * cp2;
  if (d6 >= 0 && d5 <= d6) {
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return 6;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = a[0] + w * ac0; out[1] = a[1] + w * ac1; out[2] = a[2] + w * ac2;
    return 3;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = b[0] + w * (c[0] - b[0]); out[1] = b[1] + w * (c[1] - b[1]); out[2] = b[2] + w * (c[2] - b[2]);
    return 2;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out[0] = a[0] + ab0 * v + ac0 * w; out[1] = a[1] + ab1 * v + ac1 * w; out[2] = a[2] + ab2 * v + ac2 * w;
  return 0;
}

/** Triangle components (shared vertices). */
function triangleComponents(mesh: Mesh): Int32Array {
  const nv = mesh.positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]!), b = find(idx[t + 1]!), c = find(idx[t + 2]!);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const comp = new Int32Array(idx.length / 3);
  const ids = new Map<number, number>();
  for (let t = 0; t < comp.length; t++) {
    const r = find(idx[3 * t]!);
    let id = ids.get(r);
    if (id === undefined) {
      id = ids.size;
      ids.set(r, id);
    }
    comp[t] = id;
  }
  return comp;
}

export interface BodySdfOptions {
  voxelCm?: number;
  bandCm?: number;
}

export function buildBodySdf(mesh: Mesh, opts: BodySdfOptions = {}): BodySdf {
  const h = opts.voxelCm ?? 0.5;
  const band = opts.bandCm ?? 2;
  const P = mesh.positions;
  const idx = mesh.indices;
  const nt = idx.length / 3;
  const nv = P.length / 3;
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let c = 0; c < 3; c++) {
    lo[c] = Math.min(lo[c]!, P[3 * i + c]!);
    hi[c] = Math.max(hi[c]!, P[3 * i + c]!);
  }
  const pad = band + 2 * h;
  const origin: V3 = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
  const dims: V3 = [0, 1, 2].map((c) => Math.ceil((hi[c]! - lo[c]! + 2 * pad) / h) + 1) as V3;
  const [nx, ny, nz] = dims;
  const total = nx * ny * nz;
  if (total > 60_000_000) throw new Error(`body SDF grid too large: ${nx}×${ny}×${nz}`);

  // Face normals (unit), angle-weighted vertex pseudo-normals, edge pseudo-normals.
  const fn = new Float64Array(nt * 3);
  const vn = new Float64Array(nv * 3);
  const edgeFaces = new Map<number, number[]>();
  const key = (a: number, b: number): number => (a < b ? a * nv + b : b * nv + a);
  const vtx = (i: number): V3 => [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!];
  for (let t = 0; t < nt; t++) {
    const ia = idx[3 * t]!, ib = idx[3 * t + 1]!, ic = idx[3 * t + 2]!;
    const a = vtx(ia), b = vtx(ib), c = vtx(ic);
    const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    fn[3 * t] = n[0] / l; fn[3 * t + 1] = n[1] / l; fn[3 * t + 2] = n[2] / l;
    const corners: [number, V3, V3, V3][] = [[ia, a, b, c], [ib, b, c, a], [ic, c, a, b]];
    for (const [i, p, q, r] of corners) {
      const e1: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const e2: V3 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const cosA = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / ((Math.hypot(...e1) * Math.hypot(...e2)) || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
      for (let k = 0; k < 3; k++) vn[3 * i + k] = vn[3 * i + k]! + ang * fn[3 * t + k]!;
    }
    for (const [x, y] of [[ia, ib], [ib, ic], [ic, ia]] as const) {
      const k = key(x, y);
      const list = edgeFaces.get(k);
      if (list) list.push(t);
      else edgeFaces.set(k, [t]);
    }
  }
  const pseudo = (t: number, feature: number, out: V3): void => {
    const ia = idx[3 * t]!, ib = idx[3 * t + 1]!, ic = idx[3 * t + 2]!;
    if (feature === 0) {
      out[0] = fn[3 * t]!; out[1] = fn[3 * t + 1]!; out[2] = fn[3 * t + 2]!;
      return;
    }
    if (feature >= 4) {
      const i = feature === 4 ? ia : feature === 5 ? ib : ic;
      out[0] = vn[3 * i]!; out[1] = vn[3 * i + 1]!; out[2] = vn[3 * i + 2]!;
      return;
    }
    const [x, y] = feature === 1 ? [ia, ib] : feature === 2 ? [ib, ic] : [ic, ia];
    out[0] = 0; out[1] = 0; out[2] = 0;
    for (const f of edgeFaces.get(key(x, y)) ?? [t]) for (let k = 0; k < 3; k++) out[k] = out[k]! + fn[3 * f + k]!;
  };

  const comp = triangleComponents(mesh);
  const nComp = comp.reduce((m, c) => Math.max(m, c + 1), 0);
  const values = new Float32Array(total).fill(band);
  const part = new Float32Array(total);
  const state = new Uint8Array(total); // 0 unknown, 1 band outside, 2 band inside, 3 outside (flood)
  const queue = new Int32Array(total);
  const p: V3 = [0, 0, 0], q: V3 = [0, 0, 0], n: V3 = [0, 0, 0];
  for (let ci = 0; ci < nComp; ci++) {
    part.fill(Infinity);
    state.fill(0);
    for (let t = 0; t < nt; t++) {
      if (comp[t] !== ci) continue;
      const a = vtx(idx[3 * t]!), b = vtx(idx[3 * t + 1]!), c = vtx(idx[3 * t + 2]!);
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - band - origin[0]) / h));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) + band - origin[0]) / h));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - band - origin[1]) / h));
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) + band - origin[1]) / h));
      const k0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - band - origin[2]) / h));
      const k1 = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2], c[2]) + band - origin[2]) / h));
      for (let k = k0; k <= k1; k++) {
        p[2] = origin[2] + k * h;
        for (let j = j0; j <= j1; j++) {
          p[1] = origin[1] + j * h;
          for (let i = i0; i <= i1; i++) {
            p[0] = origin[0] + i * h;
            const feature = closestOnTriangle(p, a, b, c, q);
            const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > band) continue;
            const g = (k * ny + j) * nx + i;
            if (d >= Math.abs(part[g]!)) continue;
            pseudo(t, feature, n);
            const s = dx * n[0] + dy * n[1] + dz * n[2] >= 0 ? 1 : -1;
            part[g] = s * d;
            state[g] = s > 0 ? 1 : 2;
          }
        }
      }
    }
    // Far field: flood from the border through everything that is not band-inside.
    let head = 0, tail = 0;
    const pushIf = (g: number): void => {
      if (state[g] === 0 || state[g] === 1) {
        if (state[g] === 0) state[g] = 3;
        else state[g] = 4; // band outside, visited
        queue[tail++] = g;
      }
    };
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) pushIf((k * ny + j) * nx + i);
    }
    while (head < tail) {
      const g = queue[head++]!;
      const i = g % nx, r = (g - i) / nx, j = r % ny, k = (r - j) / ny;
      if (i > 0) pushIf(g - 1);
      if (i < nx - 1) pushIf(g + 1);
      if (j > 0) pushIf(g - nx);
      if (j < ny - 1) pushIf(g + nx);
      if (k > 0) pushIf(g - nx * ny);
      if (k < nz - 1) pushIf(g + nx * ny);
    }
    for (let g = 0; g < total; g++) {
      const st = state[g]!;
      const v = st === 0 ? -band : st === 3 ? band : part[g]!;
      if (v < values[g]!) values[g] = v;
    }
  }

  const at = (x: number, y: number, z: number): number => {
    const fx = (x - origin[0]) / h, fy = (y - origin[1]) / h, fz = (z - origin[2]) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return band;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const g = (k * ny + j) * nx + i;
    const v = (o: number): number => values[g + o]!;
    const sx = nx, sxy = nx * ny;
    const c00 = v(0) * (1 - tx) + v(1) * tx;
    const c10 = v(sx) * (1 - tx) + v(sx + 1) * tx;
    const c01 = v(sxy) * (1 - tx) + v(sxy + 1) * tx;
    const c11 = v(sxy + sx) * (1 - tx) + v(sxy + sx + 1) * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  };
  return { origin, voxelCm: h, dims, bandCm: band, values, at };
}
