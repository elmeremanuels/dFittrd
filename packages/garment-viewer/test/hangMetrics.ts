/**
 * Test tooling (outside `src`, not part of the package): what a drape does to a hanging garment's lengths, for
 * docs/reports/claude/cloth-hang.md. Used by the opt-in `src/clothHangMetrics.test.ts` and by `src/clothHang.test.ts`.
 * Everything is read from the cloth itself, so it works for any bundle: no vertex lists of a builder are needed.
 */
import { stepCloth, type Cloth, type ClothParams, type Collide } from '../src/cloth';

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Shortest paths along the edges at REST from the held particles (multi-source Dijkstra): distance and the particle before each one on its path (−1: a held particle or unreachable). */
export function supportPaths(cloth: Cloth): { rest: Float64Array; before: Int32Array } {
  const n = cloth.invMass.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < cloth.edgeRest.length; e++) {
    adj[cloth.edges[2 * e]!]!.push(cloth.edges[2 * e + 1]!, cloth.edgeRest[e]!);
    adj[cloth.edges[2 * e + 1]!]!.push(cloth.edges[2 * e]!, cloth.edgeRest[e]!);
  }
  const rest = new Float64Array(n).fill(Infinity);
  const before = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // A plain array used as a heap by sorting in batches would be slow; a simple binary heap of [d, i].
  const heap: [number, number][] = [];
  const push = (d: number, i: number): void => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p]![0] <= heap[k]![0]) break;
      [heap[p], heap[k]] = [heap[k]!, heap[p]!];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1]![0] < heap[c]![0]) c++;
        if (heap[c]![0] >= heap[k]![0]) break;
        [heap[c], heap[k]] = [heap[k]!, heap[c]!];
        k = c;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i++) if (cloth.invMass[i] === 0) { rest[i] = 0; push(0, i); }
  while (heap.length) {
    const [d, i] = pop();
    if (done[i]) continue;
    done[i] = 1;
    const a = adj[i]!;
    for (let k = 0; k < a.length; k += 2) {
      const j = a[k]!, nd = d + a[k + 1]!;
      if (nd < rest[j]!) { rest[j] = nd; before[j] = i; push(nd, j); }
    }
  }
  return { rest, before };
}

const q = (sorted: number[], p: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]! : 0);

export interface HangMetrics {
  /** Edge strain, % of the rest length: 1st percentile (negative: compressed), median, 99th percentile, largest. */
  strainPct: { p1: number; p50: number; p99: number; max: number };
  /** Edges more than 3 % and more than 10 % longer than at rest, share of all edges in %. */
  over3Pct: number;
  over10Pct: number;
  /**
   * The far end of the garment (the tenth of the free particles farthest from the held ones along the cloth at rest; a
   * hem): the length of each one's rest-shortest path back to the held particles, after the drape against at rest, %.
   * Positive: the cloth between the support and the hem came out longer than it was cut.
   */
  hangPathPct: { median: number; max: number; restCm: number };
  particles: number;
  edges: number;
}

/** Strain and support-to-hem length of a cloth as it is now. */
export function hangMetrics(cloth: Cloth): HangMetrics {
  const { pos, edges, edgeRest } = cloth;
  const d = (a: number, b: number): number => Math.hypot(pos[3 * a]! - pos[3 * b]!, pos[3 * a + 1]! - pos[3 * b + 1]!, pos[3 * a + 2]! - pos[3 * b + 2]!);
  const strains: number[] = [];
  let o3 = 0, o10 = 0;
  for (let e = 0; e < edgeRest.length; e++) {
    if (edgeRest[e]! <= 0) continue;
    const s = d(edges[2 * e]!, edges[2 * e + 1]!) / edgeRest[e]! - 1;
    strains.push(s);
    if (s > 0.03) o3++;
    if (s > 0.1) o10++;
  }
  strains.sort((a, b) => a - b);
  const { rest, before } = supportPaths(cloth);
  const free: number[] = [];
  for (let i = 0; i < rest.length; i++) if (cloth.invMass[i] !== 0 && Number.isFinite(rest[i]!) && rest[i]! > 0) free.push(i);
  free.sort((a, b) => rest[a]! - rest[b]!);
  const far = free.slice(Math.floor(0.9 * free.length));
  const ratios: number[] = [];
  let restSum = 0;
  for (const i of far) {
    let len = 0;
    for (let j = i; before[j]! >= 0; j = before[j]!) len += d(j, before[j]!);
    ratios.push(len / rest[i]! - 1);
    restSum += rest[i]!;
  }
  ratios.sort((a, b) => a - b);
  return {
    strainPct: { p1: r2(q(strains, 0.01) * 100), p50: r2(q(strains, 0.5) * 100), p99: r2(q(strains, 0.99) * 100), max: r2(strains[strains.length - 1]! * 100) },
    over3Pct: r2((100 * o3) / strains.length),
    over10Pct: r2((100 * o10) / strains.length),
    hangPathPct: { median: r2(q(ratios, 0.5) * 100), max: r2(ratios[ratios.length - 1]! * 100), restCm: r2(restSum / Math.max(1, far.length)) },
    particles: cloth.invMass.length,
    edges: edgeRest.length,
  };
}

/** Largest distance any particle moves from where the drape froze it, over `seconds` more of simulated time, cm. Advances the cloth. */
export function residualMotionCm(cloth: Cloth, params: ClothParams, collide: Collide | null, seconds = 1): number {
  const at = Float32Array.from(cloth.pos);
  let worst = 0;
  for (let f = 0; f < Math.round(seconds / params.dt); f++) {
    stepCloth(cloth, params, collide, 1);
    for (let i = 0; i < at.length; i += 3) worst = Math.max(worst, Math.hypot(cloth.pos[i]! - at[i]!, cloth.pos[i + 1]! - at[i + 1]!, cloth.pos[i + 2]! - at[i + 2]!));
  }
  return r2(worst);
}

/** Perimeter of the convex hull (x–z) of the mesh's slice at height `y`, cm (NaN: no cloth there). */
export function sliceGirth(pos: ArrayLike<number>, idx: ArrayLike<number>, y: number): number {
  const pts: [number, number][] = [];
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k]!, b = idx[t + ((k + 1) % 3)]!;
    const ya = pos[3 * a + 1]! - y, yb = pos[3 * b + 1]! - y;
    if ((ya < 0) !== (yb < 0)) { const s = ya / (ya - yb); pts.push([pos[3 * a]! + s * (pos[3 * b]! - pos[3 * a]!), pos[3 * a + 2]! + s * (pos[3 * b + 2]! - pos[3 * a + 2]!)]); }
  }
  if (pts.length < 3) return NaN;
  pts.sort((p, r) => p[0] - r[0] || p[1] - r[1]);
  const cr = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hull: [number, number][] = [];
  for (const p of pts) { while (hull.length >= 2 && cr(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop(); hull.push(p); }
  const lower = hull.length + 1;
  for (let k = pts.length - 2; k >= 0; k--) { const p = pts[k]!; while (hull.length >= lower && cr(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop(); hull.push(p); }
  let per = 0;
  for (let k = 0; k < hull.length - 1; k++) per += Math.hypot(hull[k + 1]![0] - hull[k]![0], hull[k + 1]![1] - hull[k]![1]);
  return per;
}
