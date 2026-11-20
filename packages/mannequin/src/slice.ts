/**
 * Plane slicing: intersect a triangle mesh with a plane and chain the segments into loops. Used to
 * measure the mannequin's rings and, in the garment pipeline (stage 5), the garment loop at every
 * anchor plane.
 *
 * Vertices exactly on the plane count as being on the positive side (a consistent symbolic
 * perturbation), so a plane through a row of vertices still yields clean closed loops.
 */
import { dot, sub, type Vec3 } from './math';

export interface Loop {
  points: Vec3[];
  /** `true` when the chain closes on itself (a closed surface always gives closed loops). */
  closed: boolean;
}

export interface Plane {
  origin: Vec3;
  /** Unit normal. */
  normal: Vec3;
}

export function slice(positions: ArrayLike<number>, indices: ArrayLike<number>, plane: Plane, triangleFilter?: (t: number) => boolean): Loop[] {
  const nv = positions.length / 3;
  const d = new Float64Array(nv);
  for (let i = 0; i < nv; i++) d[i] = dot(sub([positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!], plane.origin), plane.normal);
  const point = new Map<number, Vec3>();
  const adj = new Map<number, number[]>();
  const edgeKey = (a: number, b: number): number => (a < b ? a * nv + b : b * nv + a);
  const crossing = (a: number, b: number): number | null => {
    const da = d[a]!, db = d[b]!;
    if ((da < 0) === (db < 0)) return null;
    const k = edgeKey(a, b);
    if (!point.has(k)) {
      const t = da / (da - db);
      point.set(k, [
        positions[3 * a]! + t * (positions[3 * b]! - positions[3 * a]!),
        positions[3 * a + 1]! + t * (positions[3 * b + 1]! - positions[3 * a + 1]!),
        positions[3 * a + 2]! + t * (positions[3 * b + 2]! - positions[3 * a + 2]!),
      ]);
    }
    return k;
  };
  const link = (p: number, q: number): void => {
    (adj.get(p) ?? adj.set(p, []).get(p)!).push(q);
    (adj.get(q) ?? adj.set(q, []).get(q)!).push(p);
  };
  for (let t = 0; t < indices.length; t += 3) {
    if (triangleFilter && !triangleFilter(t / 3)) continue;
    const i = indices[t]!, j = indices[t + 1]!, k = indices[t + 2]!;
    const ks = [crossing(i, j), crossing(j, k), crossing(k, i)].filter((x): x is number => x !== null);
    if (ks.length === 2) link(ks[0]!, ks[1]!);
  }
  const visited = new Set<number>();
  const loops: Loop[] = [];
  // Open chains first (start at an end of degree 1), then closed loops.
  const starts = [...adj.keys()].sort((p, q) => (adj.get(p)!.length === 1 ? 0 : 1) - (adj.get(q)!.length === 1 ? 0 : 1) || p - q);
  for (const s of starts) {
    if (visited.has(s)) continue;
    const chain = [s];
    visited.add(s);
    let prev = -1;
    let cur = s;
    let closed = false;
    for (;;) {
      const next = adj.get(cur)!.find((n) => n !== prev && !visited.has(n));
      if (next === undefined) {
        closed = adj.get(cur)!.some((n) => n === s && n !== prev) && chain.length > 2;
        break;
      }
      visited.add(next);
      chain.push(next);
      prev = cur;
      cur = next;
    }
    loops.push({ points: chain.map((k) => point.get(k)!), closed });
  }
  return loops;
}

/** Length of a loop (including the closing segment when it is closed). */
export function loopLength(loop: Loop): number {
  const p = loop.points;
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1], p[i]![2] - p[i - 1]![2]);
  if (loop.closed && p.length > 2) l += Math.hypot(p[0]![0] - p[p.length - 1]![0], p[0]![1] - p[p.length - 1]![1], p[0]![2] - p[p.length - 1]![2]);
  return l;
}

/** 2D coordinates of a point in the plane spanned by `u`, `v` around `origin`. */
export function planeCoords(p: Vec3, origin: Vec3, u: Vec3, v: Vec3): [number, number] {
  const r = sub(p, origin);
  return [dot(r, u), dot(r, v)];
}

/** Signed area of a closed loop in plane coordinates. */
export function loopArea(loop: Loop, origin: Vec3, u: Vec3, v: Vec3): number {
  const q = loop.points.map((p) => planeCoords(p, origin, u, v));
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i]!;
    const [x1, y1] = q[(i + 1) % q.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Does the closed loop contain `point` (both in the plane)? Even–odd rule. */
export function loopContains(loop: Loop, point: Vec3, u: Vec3, v: Vec3): boolean {
  if (!loop.closed) return false;
  const q = loop.points.map((p) => planeCoords(p, point, u, v));
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i]!;
    const [xj, yj] = q[j]!;
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The smallest closed loop that contains `centre` (the ring's loop when limbs or sleeves cut the same plane). */
export function loopAround(loops: readonly Loop[], centre: Vec3, u: Vec3, v: Vec3): Loop | null {
  let best: Loop | null = null;
  let bestArea = Infinity;
  for (const loop of loops) {
    if (!loopContains(loop, centre, u, v)) continue;
    const area = Math.abs(loopArea(loop, centre, u, v));
    if (area < bestArea) {
      best = loop;
      bestArea = area;
    }
  }
  return best;
}

/** Resample a closed loop to `n` points evenly spaced by arc length, starting nearest the +v (front) direction. */
export function resampleLoop(loop: Loop, n: number, centre: Vec3, v: Vec3): Vec3[] {
  const p = loop.points;
  if (p.length < 2 || n < 1) return [];
  let start = 0;
  let best = -Infinity;
  p.forEach((q, i) => {
    const s = dot(sub(q, centre), v);
    if (s > best) {
      best = s;
      start = i;
    }
  });
  const pts = [...p.slice(start), ...p.slice(0, start)];
  if (loop.closed) pts.push(pts[0]!);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1], pts[i]![2] - pts[i - 1]![2]));
  const total = cum[cum.length - 1]!;
  const out: Vec3[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / n;
    while (k < cum.length - 2 && cum[k + 1]! < target) k++;
    const seg = cum[k + 1]! - cum[k]! || 1;
    const t = (target - cum[k]!) / seg;
    const a = pts[k]!, b = pts[k + 1]!;
    out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
  }
  return out;
}
