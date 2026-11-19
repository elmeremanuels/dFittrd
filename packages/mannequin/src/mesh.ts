/**
 * Triangle meshes: lofting a part through its sections, merging parts, normals and the mesh-health
 * checks the pipeline needs (watertight, consistently oriented, closed volume).
 */
import { cross, sub, type Vec3 } from './math';
import { buildHeadPart, HEAD_LEVELS } from './head';
import { buildHeadPartV2, type HeadV2Part } from './headV2';
import { buildHeadPartV3 } from './headV3';
import { levelWarp, type Mannequin, type PartSpec } from './model';

export interface Mesh {
  /** xyz per vertex, cm. */
  positions: Float64Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
  /** Index into `partNames` per vertex. */
  vertexPart: Uint8Array;
  partNames: string[];
  /**
   * Only on a mesh with the v2 or v3 head (`head: 'neutral-v2' | 'neutral-v3'`): a multiplier on the skin colour per
   * vertex (1 = the skin colour; less on the brows, the lash line and the iris). Absent otherwise.
   */
  shade?: Float32Array;
  /** Only with the v3 head: how much of each vertex is hair (0..1; 0 off the head), for the hair's own colour. */
  hair?: Float32Array;
  /** Only with the v2 or v3 head: the heights of its chin and top (its tube reaches below the chin, into the neck). */
  headLevels?: { chinY: number; topY: number };
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

export interface MeshOptions {
  /**
   * `egg` (default): the v0 head, part of the torso, bytes as before. `neutral`: the neutral
   * standard face of `head.ts` as a sixth closed part `head`; the torso's neck runs straight up
   * into it and the egg is gone. `neutral-v2`: the head v2 of `headV2.ts` (open eyes, brows, ears,
   * a jaw and brow per family, no neck seam), with a `shade` per vertex; the neck has no flare
   * towards the egg. The `neutral` and `egg` meshes are not changed by it. `neutral-v3`: the head v3
   * of `headV3.ts` (v2's fixes of the 19 Nov review, short sculpted hair, about 24k triangles), built
   * on the torso exactly as v2.
   */
  head?: 'egg' | 'neutral' | 'neutral-v2' | 'neutral-v3';
}

/** The torso part with the egg head cut off: the neck continues as a column that ends inside the head part. */
function torsoWithoutHead(mannequin: Mannequin, torso: PartSpec, straightNeck = false): PartSpec {
  const warp = levelWarp(mannequin.shape.levels);
  const level = (f: number): number => (warp ? warp(f) : f) * mannequin.statureCm;
  const neckTop = level(HEAD_LEVELS.neckTop);
  const neckEnd = level(HEAD_LEVELS.neckEnd);
  let below = torso.sections.filter((s) => s.centre[1] <= neckTop + 1e-9);
  if (straightNeck) {
    // Head v2: from the neck ring up the visible neck is the head's own tube; the torso's neck stays just inside it.
    const ring = neckSection(mannequin, torso);
    below = below.map((s) => (s.centre[1] > ring.y ? { ...s, a: 0.95 * ring.a, b: 0.95 * ring.b } : s));
  }
  const last = below[below.length - 1]!;
  const column = torso.sections
    .filter((s) => s.centre[1] > neckTop + 1e-9 && s.centre[1] <= neckEnd)
    .map((s) => {
      // Inside the head the column narrows and leans forward a little, so no edge of it shows behind the jaw.
      const t = (s.centre[1] - neckTop) / (neckEnd - neckTop);
      const k = 1 - 0.4 * t * t;
      return { ...s, centre: [last.centre[0], s.centre[1], last.centre[2] + 0.012 * mannequin.statureCm * t] as [number, number, number], a: last.a * k, b: last.b * k };
    });
  const sections = [...below, ...column];
  const end = sections[sections.length - 1]!;
  return { ...torso, sections, endPole: [end.centre[0], end.centre[1] + 0.5, end.centre[2]] };
}

/** The torso's lofted section at height y (the mesh's own, interpolated linearly between its two nearest sections, as the loft is). */
function torsoSectionAt(torso: PartSpec, y: number): { a: number; b: number; cz: number } {
  const s = torso.sections;
  let i = 1;
  while (i < s.length - 1 && s[i]!.centre[1] < y) i++;
  const p = s[i - 1]!, q = s[i]!;
  const t = Math.min(1, Math.max(0, (y - p.centre[1]) / (q.centre[1] - p.centre[1] || 1)));
  return { a: p.a + (q.a - p.a) * t, b: p.b + (q.b - p.b) * t, cz: p.centre[2] + (q.centre[2] - p.centre[2]) * t };
}

/** The torso's section at the neck ring. */
function neckSection(mannequin: Mannequin, torso: PartSpec): { y: number; a: number; b: number; cz: number } {
  const y = mannequin.morphHeights.neck;
  return { y, ...torsoSectionAt(torso, y) };
}

/**
 * The mannequin as one mesh (five closed parts; the limbs overlap the torso — v0 does no boolean
 * union, so each part is a separate closed surface). With `head: 'neutral'` a sixth closed part,
 * the neutral standard head, replaces the egg.
 */
export function buildMannequinMesh(mannequin: Mannequin, options: MeshOptions = {}): Mesh {
  const v3 = options.head === 'neutral-v3';
  const v2 = options.head === 'neutral-v2' || v3;
  const neutral = options.head === 'neutral' || v2;
  const parts = mannequin.parts.map((part) => {
    const spec = neutral && part.id === 'torso' ? torsoWithoutHead(mannequin, part, v2) : part;
    const { positions, indices } = loftSections(spec.sections, spec.segments, { start: spec.startPole, end: spec.endPole });
    if (signedVolume(positions, indices) < 0) flipWinding(indices);
    return { name: part.id as string, positions, indices };
  });
  if (v2) {
    const torso = mannequin.parts.find((p) => p.id === 'torso')!;
    const neck = { ...neckSection(mannequin, torso), at: (y: number) => torsoSectionAt(torso, y) };
    const head: HeadV2Part & { hair?: number[] } = v3 ? buildHeadPartV3(mannequin, neck) : buildHeadPartV2(mannequin, neck);
    if (signedVolume(head.positions, head.indices) < 0) flipWinding(head.indices);
    parts.push(head);
    const mesh = mergeParts(parts);
    const shade = new Float32Array(mesh.vertexPart.length).fill(1);
    shade.set(head.shade, mesh.vertexPart.length - head.shade.length);
    const levels = { chinY: head.chinY, topY: head.topY };
    if (head.hair) {
      const hair = new Float32Array(mesh.vertexPart.length);
      hair.set(head.hair, mesh.vertexPart.length - head.hair.length);
      return { ...mesh, shade, hair, headLevels: levels };
    }
    return { ...mesh, shade, headLevels: levels };
  }
  if (neutral) {
    const head = buildHeadPart(mannequin);
    if (signedVolume(head.positions, head.indices) < 0) flipWinding(head.indices);
    parts.push(head);
  }
  return mergeParts(parts);
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
