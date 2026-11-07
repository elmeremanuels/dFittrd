/**
 * Surface distance between two meshes, the same definition as stage 4's `phase0_mesh.compare_to_truth`
 * (open3d): `samples` points uniformly on each surface (area-weighted), each sample's distance to the
 * nearest sample of the other surface, Chamfer = mean of the two directions' means, F-score at 1 and
 * 2 cm. Seeded, so the same meshes give the same numbers. Units: cm.
 */
import type { Mesh } from '@curtain/mannequin';

/** Small deterministic PRNG (mulberry32). */
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

export function samplePoints(mesh: Pick<Mesh, 'positions' | 'indices'>, n: number, seed = 0): Float64Array {
  const P = mesh.positions, I = mesh.indices;
  const nt = I.length / 3;
  const cdf = new Float64Array(nt);
  let total = 0;
  for (let t = 0; t < nt; t++) {
    const a = 3 * I[3 * t]!, b = 3 * I[3 * t + 1]!, c = 3 * I[3 * t + 2]!;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    cdf[t] = total;
  }
  const rand = rng(seed);
  const out = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const r = rand() * total;
    let lo = 0, hi = nt - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    let u = rand(), v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const a = 3 * I[3 * lo]!, b = 3 * I[3 * lo + 1]!, c = 3 * I[3 * lo + 2]!;
    for (let d = 0; d < 3; d++) out[3 * k + d] = P[a + d]! + u * (P[b + d]! - P[a + d]!) + v * (P[c + d]! - P[a + d]!);
  }
  return out;
}

/** Distance from every point of `from` to its nearest point of `to` (uniform hash grid on `to`). */
export function nearestDistances(from: Float64Array, to: Float64Array, cellCm = 1): Float64Array {
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  for (let i = 0; i < to.length / 3; i++) {
    const k = key(Math.floor(to[3 * i]! / cellCm), Math.floor(to[3 * i + 1]! / cellCm), Math.floor(to[3 * i + 2]! / cellCm));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  const out = new Float64Array(from.length / 3);
  for (let i = 0; i < out.length; i++) {
    const x = from[3 * i]!, y = from[3 * i + 1]!, z = from[3 * i + 2]!;
    const cx = Math.floor(x / cellCm), cy = Math.floor(y / cellCm), cz = Math.floor(z / cellCm);
    let best = Infinity;
    for (let r = 0; r < 64; r++) {
      // Search shells of growing radius until the best distance is certainly inside the searched cube.
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const list = grid.get(key(cx + dx, cy + dy, cz + dz));
        if (!list) continue;
        for (const j of list) {
          const d = (to[3 * j]! - x) ** 2 + (to[3 * j + 1]! - y) ** 2 + (to[3 * j + 2]! - z) ** 2;
          if (d < best) best = d;
        }
      }
      if (best <= (r * cellCm) ** 2) break;
    }
    out[i] = Math.sqrt(best);
  }
  return out;
}

export interface ChamferReport {
  chamferCmMean: number;
  reconToTruthCm: { mean: number; p95: number; max: number };
  truthToReconCm: { mean: number; p95: number; max: number };
  fscore1cm: number;
  fscore2cm: number;
  samples: number;
}

const stats = (d: Float64Array): { mean: number; p95: number; max: number } => {
  const s = Float64Array.from(d).sort();
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const r = (x: number): number => Math.round(x * 1000) / 1000;
  return { mean: r(mean), p95: r(s[Math.floor(0.95 * (s.length - 1))]!), max: r(s[s.length - 1]!) };
};

export function chamfer(recon: Pick<Mesh, 'positions' | 'indices'>, truth: Pick<Mesh, 'positions' | 'indices'>, samples = 50000, seed = 0): ChamferReport {
  const a = samplePoints(recon, samples, seed);
  const b = samplePoints(truth, samples, seed + 1);
  const d1 = nearestDistances(a, b);
  const d2 = nearestDistances(b, a);
  const f = (t: number): number => {
    let p = 0, r = 0;
    for (const x of d1) if (x < t) p++;
    for (const x of d2) if (x < t) r++;
    p /= d1.length;
    r /= d2.length;
    return Math.round(((2 * p * r) / Math.max(p + r, 1e-9)) * 10000) / 10000;
  };
  const s1 = stats(d1), s2 = stats(d2);
  return { chamferCmMean: Math.round(((s1.mean + s2.mean) / 2) * 1000) / 1000, reconToTruthCm: s1, truthToReconCm: s2, fscore1cm: f(1), fscore2cm: f(2), samples };
}

/**
 * The same Chamfer split by region: every sample (on either surface) is assigned to a region by
 * `regionOf` at its own position, and per region the mean of the two directions' means over the
 * samples that fall in it. A region with no samples on one side reports that direction as null.
 */
export interface RegionChamfer {
  region: string;
  chamferCmMean: number | null;
  reconToTruthCm: number | null;
  truthToReconCm: number | null;
  reconSamples: number;
  truthSamples: number;
}

export function regionChamfer(
  recon: Pick<Mesh, 'positions' | 'indices'>,
  truth: Pick<Mesh, 'positions' | 'indices'>,
  regions: readonly string[],
  regionOf: (x: number, y: number, z: number) => string,
  samples = 50000,
  seed = 0,
): RegionChamfer[] {
  const a = samplePoints(recon, samples, seed);
  const b = samplePoints(truth, samples, seed + 1);
  const d1 = nearestDistances(a, b);
  const d2 = nearestDistances(b, a);
  const acc = new Map(regions.map((r) => [r, { s1: 0, n1: 0, s2: 0, n2: 0 }]));
  const add = (pts: Float64Array, d: Float64Array, first: boolean): void => {
    for (let i = 0; i < d.length; i++) {
      const e = acc.get(regionOf(pts[3 * i]!, pts[3 * i + 1]!, pts[3 * i + 2]!));
      if (!e) continue;
      if (first) { e.s1 += d[i]!; e.n1++; } else { e.s2 += d[i]!; e.n2++; }
    }
  };
  add(a, d1, true);
  add(b, d2, false);
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  return regions.map((region) => {
    const e = acc.get(region)!;
    const m1 = e.n1 ? e.s1 / e.n1 : null, m2 = e.n2 ? e.s2 / e.n2 : null;
    return { region, chamferCmMean: m1 !== null && m2 !== null ? r3((m1 + m2) / 2) : null, reconToTruthCm: m1 === null ? null : r3(m1), truthToReconCm: m2 === null ? null : r3(m2), reconSamples: e.n1, truthSamples: e.n2 };
  });
}
