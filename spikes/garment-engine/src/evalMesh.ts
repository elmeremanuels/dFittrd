/**
 * Reads a garment .glb from stage 4 (or the spike's own writers) into a `Mesh` in mannequin space,
 * cm. Stage 4 writes its mesh with trimesh (`phase0_mesh.write_glb`: metres, optional vertex
 * colours), so this reader does not assume our own layout: it follows the node tree (matrix or
 * TRS), honours accessor offsets and strides, reads 8/16/32-bit indices and merges every triangle
 * primitive. `@curtain/mannequin`'s `readGlb` is used for the container only.
 *
 * The file is data written by our GPU job: every accessor is bounds-checked before it is read.
 */
import { readGlb, topology, type Mesh, type TopologyReport } from '@curtain/mannequin';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
}
interface GltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
}
interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfJson {
  asset?: { extras?: Record<string, unknown>; generator?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
}

const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const MAX_VERTICES = 2_000_000;

function readAccessor(json: GltfJson, bin: Uint8Array, index: number): { values: Float64Array; size: number } {
  const a = json.accessors?.[index];
  if (!a) throw new Error(`accessor ${index} missing`);
  const size = TYPE_SIZE[a.type];
  const cb = COMPONENT_BYTES[a.componentType];
  if (!size || !cb) throw new Error(`accessor ${index}: unsupported ${a.type}/${a.componentType}`);
  if (a.count > MAX_VERTICES * 3) throw new Error(`accessor ${index}: ${a.count} elements`);
  const values = new Float64Array(a.count * size);
  if (a.bufferView === undefined) return { values, size }; // all zeros per the spec
  const bv = json.bufferViews?.[a.bufferView];
  if (!bv) throw new Error(`bufferView ${a.bufferView} missing`);
  const stride = bv.byteStride ?? size * cb;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const end = start + (a.count - 1) * stride + size * cb;
  if (a.count > 0 && (end > bin.length || end > (bv.byteOffset ?? 0) + bv.byteLength)) throw new Error(`accessor ${index} runs past its buffer`);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const norm = a.normalized === true;
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < size; c++) {
      const off = start + i * stride + c * cb;
      let v: number;
      switch (a.componentType) {
        case 5126: v = view.getFloat32(off, true); break;
        case 5125: v = view.getUint32(off, true); break;
        case 5123: v = view.getUint16(off, true); if (norm) v /= 65535; break;
        case 5122: v = view.getInt16(off, true); if (norm) v = Math.max(v / 32767, -1); break;
        case 5121: v = view.getUint8(off); if (norm) v /= 255; break;
        default: v = view.getInt8(off); if (norm) v = Math.max(v / 127, -1);
      }
      values[i * size + c] = v;
    }
  }
  return { values, size };
}

type Mat4 = number[]; // column-major, as glTF

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return out;
}

function nodeMatrix(n: GltfNode): Mat4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.slice();
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const r = [
    1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! + z! * w!), 2 * (x! * z! - y! * w!),
    2 * (x! * y! - z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! + x! * w!),
    2 * (x! * z! + y! * w!), 2 * (y! * z! - x! * w!), 1 - 2 * (x! * x! + y! * y!),
  ];
  return [r[0]! * sx!, r[1]! * sx!, r[2]! * sx!, 0, r[3]! * sy!, r[4]! * sy!, r[5]! * sy!, 0, r[6]! * sz!, r[7]! * sz!, r[8]! * sz!, 0, tx!, ty!, tz!, 1];
}

export interface GarmentGlb {
  /** In mannequin space, cm. */
  mesh: Mesh;
  /** Mean vertex colour as `#RRGGBB` when the file carries COLOR_0 (stage 4 projects the frames' colours), else null. */
  meanColorHex: string | null;
  /** Per-vertex RGB 0…1 as stored (display values), aligned with `mesh` (before welding); null without COLOR_0 on every primitive. */
  colors: Float32Array | null;
  /** The unit the file was read in (`asset.extras.unit`, default metres as glTF says). */
  unit: 'm' | 'cm';
  /** Primitives merged, triangles only. */
  primitives: number;
  generator: string | null;
}

const hex2 = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

export function readGarmentGlb(bytes: Uint8Array): GarmentGlb {
  const glb = readGlb(bytes);
  const json = glb.json as unknown as GltfJson;
  const unit = json.asset?.extras?.unit === 'cm' ? 'cm' : 'm';
  const k = unit === 'cm' ? 1 : 100;
  // Mesh instances with their world matrix; without scenes or nodes, every mesh once at identity.
  const instances: { mesh: number; matrix: Mat4 }[] = [];
  const nodes = json.nodes ?? [];
  const visit = (i: number, parent: Mat4, depth: number): void => {
    const n = nodes[i];
    if (!n || depth > 64) return;
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) instances.push({ mesh: n.mesh, matrix: m });
    for (const c of n.children ?? []) visit(c, m, depth + 1);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes;
  if (roots && nodes.length) for (const r of roots) visit(r, IDENTITY, 0);
  if (instances.length === 0) (json.meshes ?? []).forEach((_, i) => instances.push({ mesh: i, matrix: IDENTITY }));

  const pos: number[] = [];
  const idx: number[] = [];
  let colourSum = [0, 0, 0];
  let coloured = 0;
  const cols: number[] = [];
  let allColoured = true;
  let primitives = 0;
  for (const inst of instances) {
    for (const prim of json.meshes?.[inst.mesh]?.primitives ?? []) {
      if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
      primitives++;
      const base = pos.length / 3;
      const p = readAccessor(json, glb.bin, prim.attributes.POSITION);
      if (p.size !== 3) throw new Error('POSITION is not VEC3');
      if (base + p.values.length / 3 > MAX_VERTICES) throw new Error('mesh too large');
      const M = inst.matrix;
      for (let v = 0; v < p.values.length; v += 3) {
        const x = p.values[v]!, y = p.values[v + 1]!, z = p.values[v + 2]!;
        pos.push((M[0]! * x + M[4]! * y + M[8]! * z + M[12]!) * k, (M[1]! * x + M[5]! * y + M[9]! * z + M[13]!) * k, (M[2]! * x + M[6]! * y + M[10]! * z + M[14]!) * k);
      }
      if (prim.attributes.COLOR_0 !== undefined) {
        const c = readAccessor(json, glb.bin, prim.attributes.COLOR_0);
        const a = json.accessors![prim.attributes.COLOR_0]!;
        // Float colours are linear 0…1; normalized integer colours too once divided (readAccessor does it).
        const scale = a.componentType === 5126 || a.normalized ? 255 : 1;
        for (let v = 0; v < c.values.length; v += c.size) {
          colourSum = [colourSum[0]! + c.values[v]! * scale, colourSum[1]! + c.values[v + 1]! * scale, colourSum[2]! + c.values[v + 2]! * scale];
          coloured++;
          cols.push((c.values[v]! * scale) / 255, (c.values[v + 1]! * scale) / 255, (c.values[v + 2]! * scale) / 255);
        }
      } else allColoured = false;
      const n = p.values.length / 3;
      if (prim.indices !== undefined) {
        const ind = readAccessor(json, glb.bin, prim.indices).values;
        for (let t = 0; t + 2 < ind.length; t += 3) {
          const a = ind[t]!, b = ind[t + 1]!, c = ind[t + 2]!;
          if (a >= n || b >= n || c >= n) throw new Error('index out of range');
          idx.push(base + a, base + b, base + c);
        }
      } else for (let v = 0; v + 2 < n; v += 3) idx.push(base + v, base + v + 1, base + v + 2);
    }
  }
  if (idx.length === 0) throw new Error('glb has no triangles');
  const positions = Float64Array.from(pos);
  const mesh: Mesh = { positions, indices: Uint32Array.from(idx), vertexPart: new Uint8Array(positions.length / 3), partNames: ['garment'] };
  const meanColorHex = coloured ? `#${hex2(colourSum[0]! / coloured)}${hex2(colourSum[1]! / coloured)}${hex2(colourSum[2]! / coloured)}`.toUpperCase() : null;
  const colors = allColoured && cols.length === positions.length ? Float32Array.from(cols) : null;
  return { mesh, meanColorHex, colors, unit, primitives, generator: json.asset?.generator ?? null };
}

/** Merge vertices that share a position (to 1e-4 cm): trimesh writes per-face copies unless it processed the mesh. */
export function weldVertices(mesh: Mesh, epsCm = 1e-4): Mesh {
  return weld(mesh, epsCm).mesh;
}

/** `weldVertices` that carries per-vertex RGB along (the first copy's colour wins). */
export function weldVerticesWithColors(mesh: Mesh, colors: ArrayLike<number> | null, epsCm = 1e-4): { mesh: Mesh; colors: Float32Array | null } {
  const { mesh: out, remap } = weld(mesh, epsCm);
  if (!colors) return { mesh: out, colors: null };
  const c = new Float32Array(out.positions.length);
  for (let i = remap.length - 1; i >= 0; i--) for (let ch = 0; ch < 3; ch++) c[3 * remap[i]! + ch] = colors[3 * i + ch]!;
  return { mesh: out, colors: c };
}

/** `weldVertices` that also returns the map from every input vertex to its welded vertex (UV seams, render meshes). */
export function weldWithRemap(mesh: Mesh, epsCm = 1e-4): { mesh: Mesh; remap: Uint32Array } {
  return weld(mesh, epsCm);
}

function weld(mesh: Mesh, epsCm: number): { mesh: Mesh; remap: Uint32Array } {
  const map = new Map<string, number>();
  const remap = new Uint32Array(mesh.positions.length / 3);
  const pos: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[3 * i]!, y = mesh.positions[3 * i + 1]!, z = mesh.positions[3 * i + 2]!;
    const key = `${Math.round(x / epsCm)},${Math.round(y / epsCm)},${Math.round(z / epsCm)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = pos.length / 3;
      map.set(key, j);
      pos.push(x, y, z);
    }
    remap[i] = j;
  }
  const idx: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!, b = remap[mesh.indices[t + 1]!]!, c = remap[mesh.indices[t + 2]!]!;
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const positions = Float64Array.from(pos);
  return { mesh: { positions, indices: Uint32Array.from(idx), vertexPart: new Uint8Array(positions.length / 3), partNames: mesh.partNames }, remap };
}

export interface MeshHealth extends TopologyReport {
  triangleBudget: [number, number];
  withinBudget: boolean;
  /** Bounding box in mannequin space, cm. */
  bboxCm: [[number, number, number], [number, number, number]];
  notChecked: string[];
}

export const TRIANGLE_BUDGET: [number, number] = [8000, 15000];

export function meshHealth(mesh: Mesh): MeshHealth {
  const t = topology(mesh);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = mesh.positions[i + c]!;
      if (v < lo[c]!) lo[c] = v;
      if (v > hi[c]!) hi[c] = v;
    }
  }
  const r = (v: number): number => Math.round(v * 10) / 10;
  return {
    ...t,
    triangleBudget: TRIANGLE_BUDGET,
    withinBudget: t.triangles >= TRIANGLE_BUDGET[0] && t.triangles <= TRIANGLE_BUDGET[1],
    bboxCm: [[r(lo[0]), r(lo[1]), r(lo[2])], [r(hi[0]), r(hi[1]), r(hi[2])]],
    notChecked: ['self-intersection', 'watertight where expected (openings at neckline, hem and cuffs are allowed but not located)'],
  };
}
