/**
 * Exact point-to-mesh distance (closest point on a triangle, Ericson, "Real-Time Collision
 * Detection" 5.1.5) with a uniform grid over the triangles, for clearance checks against
 * `mannequin.glb` itself rather than the grid SDF of `bodySdf.ts` (trilinear on a 0.25 cm grid,
 * about 0.3 mm optimistic near the surface on run 14). Unsigned: whether a point is inside comes
 * from the SDF's sign. Units: cm.
 */
import type { Mesh } from '@curtain/mannequin';

/** Squared distance from p to triangle (a, b, c). */
export function pointTriangleDistSq(px: number, py: number, pz: number, P: ArrayLike<number>, ia: number, ib: number, ic: number): number {
  const ax = P[ia]!, ay = P[ia + 1]!, az = P[ia + 2]!;
  const abx = P[ib]! - ax, aby = P[ib + 1]! - ay, abz = P[ib + 2]! - az;
  const acx = P[ic]! - ax, acy = P[ic + 1]! - ay, acz = P[ic + 2]! - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const sq = (x: number, y: number, z: number): number => (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
  if (d1 <= 0 && d2 <= 0) return sq(ax, ay, az);
  const bpx = px - P[ib]!, bpy = py - P[ib + 1]!, bpz = pz - P[ib + 2]!;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return sq(P[ib]!, P[ib + 1]!, P[ib + 2]!);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return sq(ax + v * abx, ay + v * aby, az + v * abz);
  }
  const cpx = px - P[ic]!, cpy = py - P[ic + 1]!, cpz = pz - P[ic + 2]!;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return sq(P[ic]!, P[ic + 1]!, P[ic + 2]!);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return sq(ax + w * acx, ay + w * acy, az + w * acz);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const bx = P[ib]!, by = P[ib + 1]!, bz = P[ib + 2]!;
    return sq(bx + w * (P[ic]! - bx), by + w * (P[ic + 1]! - by), bz + w * (P[ic + 2]! - bz));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return sq(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

/**
 * Distance from every point to the nearest triangle of `mesh`, exact up to `maxCm` (points further
 * away get `maxCm`). Grid cells of `cellCm`; each triangle is listed in every cell its bounding box
 * touches.
 */
export function distancesToMesh(points: ArrayLike<number>, mesh: Pick<Mesh, 'positions' | 'indices'>, maxCm = 2, cellCm = 1): Float64Array {
  const P = mesh.positions, I = mesh.indices;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number): number => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
  for (let t = 0; t < I.length / 3; t++) {
    const a = 3 * I[3 * t]!, b = 3 * I[3 * t + 1]!, c = 3 * I[3 * t + 2]!;
    const lo = [0, 1, 2].map((d) => Math.floor(Math.min(P[a + d]!, P[b + d]!, P[c + d]!) / cellCm));
    const hi = [0, 1, 2].map((d) => Math.floor(Math.max(P[a + d]!, P[b + d]!, P[c + d]!) / cellCm));
    for (let x = lo[0]!; x <= hi[0]!; x++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let z = lo[2]!; z <= hi[2]!; z++) {
      const k = key(x, y, z);
      const l = grid.get(k);
      if (l) l.push(t);
      else grid.set(k, [t]);
    }
  }
  const reach = Math.ceil(maxCm / cellCm);
  const out = new Float64Array(points.length / 3);
  const stamp = new Int32Array(I.length / 3).fill(-1);
  for (let i = 0; i < out.length; i++) {
    const px = points[3 * i]!, py = points[3 * i + 1]!, pz = points[3 * i + 2]!;
    const cx = Math.floor(px / cellCm), cy = Math.floor(py / cellCm), cz = Math.floor(pz / cellCm);
    let best = maxCm * maxCm;
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
      const l = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!l) continue;
      for (const t of l) {
        if (stamp[t] === i) continue;
        stamp[t] = i;
        const d = pointTriangleDistSq(px, py, pz, P, 3 * I[3 * t]!, 3 * I[3 * t + 1]!, 3 * I[3 * t + 2]!);
        if (d < best) best = d;
      }
    }
    out[i] = Math.sqrt(best);
  }
  return out;
}
