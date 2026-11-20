/**
 * Minimal glTF 2.0 binary (.glb) writer: indexed triangle meshes with POSITION, optional NORMAL and one
 * metallic-roughness material per mesh. No textures, no animation, no Draco. Output is a pure
 * function of the input (no timestamps, fixed key order), so the same mesh gives the same bytes.
 *
 * Positions are written as given; glTF expects metres, so convert cm with `scale: 0.01`.
 */

export interface GlbPrimitive {
  name: string;
  /** xyz per vertex. */
  positions: ArrayLike<number>;
  /** Unit normals per vertex (optional). */
  normals?: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Linear RGBA base colour (default mid-grey). */
  baseColor?: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  doubleSided?: boolean;
}

export interface GlbOptions {
  /** Multiplies every position (e.g. 0.01 for cm → m). */
  scale?: number;
  generator?: string;
  /** JSON-serialisable metadata stored in `asset.extras`. */
  extras?: Record<string, unknown>;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const pad4 = (n: number): number => (n + 3) & ~3;

export function writeGlb(primitives: readonly GlbPrimitive[], options: GlbOptions = {}): Uint8Array {
  const s = options.scale ?? 1;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];

  const push = (bytes: Uint8Array, target: number): number => {
    const offset = byteLength;
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    const padded = pad4(byteLength);
    if (padded > byteLength) {
      chunks.push(new Uint8Array(padded - byteLength));
      byteLength = padded;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    return bufferViews.length - 1;
  };

  primitives.forEach((prim, pi) => {
    const nv = prim.positions.length / 3;
    const pos = new Float32Array(nv * 3);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv * 3; i++) {
      const v = Math.fround(prim.positions[i]! * s);
      pos[i] = v;
      const c = i % 3;
      if (v < min[c]!) min[c] = v;
      if (v > max[c]!) max[c] = v;
    }
    const attributes: Record<string, number> = {};
    accessors.push({ bufferView: push(new Uint8Array(pos.buffer), ARRAY_BUFFER), componentType: FLOAT, count: nv, type: 'VEC3', min, max });
    attributes.POSITION = accessors.length - 1;
    if (prim.normals) {
      const nor = Float32Array.from(prim.normals);
      accessors.push({ bufferView: push(new Uint8Array(nor.buffer), ARRAY_BUFFER), componentType: FLOAT, count: nv, type: 'VEC3' });
      attributes.NORMAL = accessors.length - 1;
    }
    const wide = nv > 65535;
    const idx = wide ? Uint32Array.from(prim.indices) : Uint16Array.from(prim.indices);
    accessors.push({ bufferView: push(new Uint8Array(idx.buffer), ELEMENT_ARRAY_BUFFER), componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT, count: prim.indices.length, type: 'SCALAR' });
    const indicesAccessor = accessors.length - 1;
    materials.push({
      name: `${prim.name}-material`,
      pbrMetallicRoughness: { baseColorFactor: prim.baseColor ?? [0.5, 0.5, 0.5, 1], metallicFactor: prim.metallic ?? 0, roughnessFactor: prim.roughness ?? 0.8 },
      doubleSided: prim.doubleSided ?? false,
    });
    meshes.push({ name: prim.name, primitives: [{ attributes, indices: indicesAccessor, material: pi, mode: 4 }] });
    nodes.push({ name: prim.name, mesh: pi });
  });

  const asset: Record<string, unknown> = { version: '2.0', generator: options.generator ?? '@curtain/mannequin glb writer' };
  if (options.extras) asset.extras = options.extras;
  const gltf = {
    asset,
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = pad4(jsonBytes.byteLength);
  const total = 12 + 8 + jsonLen + 8 + byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen);
  let o = 20 + jsonLen;
  view.setUint32(o, byteLength, true);
  view.setUint32(o + 4, CHUNK_BIN, true);
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export interface ParsedGlb {
  json: {
    asset: { version: string; extras?: Record<string, unknown> };
    meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
    bufferViews: { byteOffset: number; byteLength: number }[];
  };
  bin: Uint8Array;
}

/** Parse a .glb written by `writeGlb` (header, JSON and BIN chunk). Throws on a malformed file. */
export function readGlb(bytes: Uint8Array): ParsedGlb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a glb');
  if (view.getUint32(4, true) !== 2) throw new Error('unsupported glTF version');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('length mismatch');
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as ParsedGlb['json'];
  const o = 20 + jsonLen;
  const binLen = view.getUint32(o, true);
  if (view.getUint32(o + 4, true) !== CHUNK_BIN) throw new Error('second chunk is not BIN');
  return { json, bin: bytes.subarray(o + 8, o + 8 + binLen) };
}

/** Read a FLOAT accessor of a parsed glb as a Float32Array copy. */
export function glbFloatAccessor(glb: ParsedGlb, accessor: number): Float32Array {
  const a = glb.json.accessors[accessor]!;
  const bv = glb.json.bufferViews[a.bufferView]!;
  const comps = a.type === 'VEC3' ? 3 : a.type === 'VEC2' ? 2 : 1;
  return new Float32Array(glb.bin.slice(bv.byteOffset, bv.byteOffset + a.count * comps * 4).buffer);
}

/** Read an index accessor of a parsed glb as a Uint32Array. */
export function glbIndexAccessor(glb: ParsedGlb, accessor: number): Uint32Array {
  const a = glb.json.accessors[accessor]!;
  const bv = glb.json.bufferViews[a.bufferView]!;
  const raw = glb.bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
  return a.componentType === UNSIGNED_INT ? new Uint32Array(raw.buffer) : Uint32Array.from(new Uint16Array(raw.buffer));
}
