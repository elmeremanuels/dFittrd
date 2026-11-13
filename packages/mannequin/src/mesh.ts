/**
 * Triangle meshes: lofting a part through its sections, merging parts, normals and the mesh-health
 * checks the pipeline needs (watertight, consistently oriented, closed volume).
 */
import { cross, sub, type Vec3 } from './math';
import type { Mannequin, PartSpec } from './model';

export interface Mesh {
  /** xyz per vertex, cm. */
  positions: Float64Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
  /** Index into `partNames` per vertex. */
  vertexPart: Uint8Array;
  partNames: string[];
}

export const vertexCount = (mesh: Mesh): number => mesh.positions.length / 3;
export const triangleCount = (mesh: Mesh): number => mesh.indices.length / 3;

export function vertexAt(mesh: Mesh, i: number): Vec3 {
  return [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
}

/**
 * Loft sections into a tube. `capped` closes both ends with a fan to the part's poles (a closed
 * surface); open tubes leave the end loops as boundaries (garments). The winding is fixed afterwards
 * so that closed parts have positive volume.
 */
export function loftSections(
  sections: PartSpec['sections'],
  segments: number,
  poles?: { start: Vec3; end: Vec3 },
): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const s of sections) {
    for (let j = 0; j < segments; j++) {
      const t = (2 * Math.PI * j) / segments;
      const sa = s.a * Math.sin(t);
      const cb = s.b * Math.cos(t);
      positions.push(s.centre[0] + sa * s.u[0] + cb * s.v[0], s.centre[1] + sa * s.u[1] + cb * s.v[1], s.centre[2] + sa * s.u[2] + cb * s.v[2]);
    }
  }
  const n = sections.length;
  for (let k = 0; k < n - 1; k++) {
    const r0 = k * segments;
    const r1 = (k + 1) * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      indices.push(r0 + j, r0 + j1, r1 + j1, r0 + j, r1 + j1, r1 + j);
    }
  }
  if (poles) {
    const ps = n * segments;
    positions.push(...poles.start, ...poles.end);
    const last = (n - 1) * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      indices.push(ps, j1, j);
      indices.push(ps + 1, last + j, last + j1);
    }
  }
  return { positions, indices };
}

/** Signed volume of a triangle soup (positive when the triangles face outwards). */
export function signedVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t]! * 3, j = indices[t + 1]! * 3, k = indices[t + 2]! * 3;
    const ax = positions[i]!, ay = positions[i + 1]!, az = positions[i + 2]!;
    const bx = positions[j]!, by = positions[j + 1]!, bz = positions[j + 2]!;
    const cx = positions[k]!, cy = positions[k + 1]!, cz = positions[k + 2]!;
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

function flipWinding(indices: number[]): void {
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]!;
    indices[t + 1] = indices[t + 2]!;
    indices[t + 2] = tmp;
  }
}

/** Merge parts into one mesh, remembering which part every vertex came from. */
export function mergeParts(parts: { name: string; positions: number[]; indices: number[] }[]): Mesh {
  const total = parts.reduce((n, p) => n + p.positions.length / 3, 0);
  const tris = parts.reduce((n, p) => n + p.indices.length, 0);
  const positions = new Float64Array(total * 3);
  const indices = new Uint32Array(tris);
  const vertexPart = new Uint8Array(total);
  let vo = 0;
  let io = 0;
  parts.forEach((p, pi) => {
    positions.set(p.positions, vo * 3);
    for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i]! + vo;
    vertexPart.fill(pi, vo, vo + p.positions.length / 3);
    vo += p.positions.length / 3;
    io += p.indices.length;
  });
  return { positions, indices, vertexPart, partNames: parts.map((p) => p.name) };
}

/**
 * The mannequin as one mesh (five closed parts; the limbs overlap the torso — v0 does no boolean
 * union, so each part is a separate closed surface).
 */
export function buildMannequinMesh(mannequin: Mannequin): Mesh {
  return mergeParts(
    mannequin.parts.map((part) => {
      const { positions, indices } = loftSections(part.sections, part.segments, { start: part.startPole, end: part.endPole });
      if (signedVolume(positions, indices) < 0) flipWinding(indices);
      return { name: part.id, positions, indices };
    }),
  );
}

/** Area-weighted vertex normals (unit length). */
export function vertexNormals(mesh: Mesh): Float64Array {
  const n = new Float64Array(mesh.positions.length);
  const p = mesh.positions;
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const i = idx[t]!, j = idx[t + 1]!, k = idx[t + 2]!;
    const a: Vec3 = [p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!];
    const fn = cross(sub([p[3 * j]!, p[3 * j + 1]!, p[3 * j + 2]!], a), sub([p[3 * k]!, p[3 * k + 1]!, p[3 * k + 2]!], a));
    for (const v of [i, j, k]) {
      n[3 * v] = n[3 * v]! + fn[0];
      n[3 * v + 1] = n[3 * v + 1]! + fn[1];
      n[3 * v + 2] = n[3 * v + 2]! + fn[2];
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!) || 1;
    n[v] = n[v]! / l;
    n[v + 1] = n[v + 1]! / l;
    n[v + 2] = n[v + 2]! / l;
  }
  return n;
}

export interface TopologyReport {
  vertices: number;
  triangles: number;
  /** Edges used by exactly one triangle (holes). */
  boundaryEdges: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  /** Edges whose two triangles traverse them in the same direction (flipped faces). */
  inconsistentEdges: number;
  /** Triangles with a repeated vertex or zero area. */
  degenerateTriangles: number;
  /** Connected components (by shared edges). */
  components: number;
  /** Euler characteristic V − E + F per component (2 for a closed sphere-like surface). */
  eulerCharacteristics: number[];
  /** Signed volume per component, cm³. */
  volumes: number[];
  /** Closed, manifold, consistently oriented, every component a positive-volume sphere. */
  watertight: boolean;
}

/** Edge-based mesh health check. */
export function topology(mesh: Mesh): TopologyReport {
  const idx = mesh.indices;
  const nv = vertexCount(mesh);
  const edges = new Map<number, { count: number; dir: number }>();
  let degenerate = 0;
  const key = (a: number, b: number): number => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) degenerate++;
    else {
      const a = vertexAt(mesh, tri[0]!);
      const c = cross(sub(vertexAt(mesh, tri[1]!), a), sub(vertexAt(mesh, tri[2]!), a));
      if (Math.hypot(c[0], c[1], c[2]) < 1e-12) degenerate++;
    }
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!;
      const b = tri[(e + 1) % 3]!;
      const k = key(a, b);
      const rec = edges.get(k) ?? { count: 0, dir: 0 };
      rec.count++;
      rec.dir += a < b ? 1 : -1;
      edges.set(k, rec);
    }
  }
  let boundary = 0, nonManifold = 0, inconsistent = 0;
  for (const rec of edges.values()) {
    if (rec.count === 1) boundary++;
    else if (rec.count > 2) nonManifold++;
    else if (rec.dir !== 0) inconsistent++;
  }
  // Components by union-find over triangle vertices.
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]!);
    parent[find(idx[t + 1]!)] = r;
    parent[find(idx[t + 2]!)] = find(idx[t]!);
  }
  const compOf = new Map<number, number>();
  const used = new Uint8Array(nv);
  for (let t = 0; t < idx.length; t++) used[idx[t]!] = 1;
  for (let v = 0; v < nv; v++) if (used[v]) {
    const r = find(v);
    if (!compOf.has(r)) compOf.set(r, compOf.size);
  }
  const nc = compOf.size;
  const V = new Array<number>(nc).fill(0), E = new Array<number>(nc).fill(0), F = new Array<number>(nc).fill(0);
  const vol = new Array<number>(nc).fill(0);
  for (let v = 0; v < nv; v++) if (used[v]) V[compOf.get(find(v))!]!++;
  for (const k of edges.keys()) E[compOf.get(find(Math.floor(k / nv)))!]!++;
  for (let t = 0; t < idx.length; t += 3) {
    const c = compOf.get(find(idx[t]!))!;
    F[c]!++;
    vol[c]! += signedVolume(mesh.positions, [idx[t]!, idx[t + 1]!, idx[t + 2]!]);
  }
  const euler = V.map((v, c) => v - E[c]! + F[c]!);
  return {
    vertices: nv,
    triangles: idx.length / 3,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
    degenerateTriangles: degenerate,
    components: nc,
    eulerCharacteristics: euler,
    volumes: vol,
    watertight: boundary === 0 && nonManifold === 0 && inconsistent === 0 && degenerate === 0 && euler.every((x) => x === 2) && vol.every((x) => x > 0),
  };
}
