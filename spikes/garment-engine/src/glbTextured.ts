/**
 * A garment .glb with a base colour texture: POSITION, NORMAL, TEXCOORD_0, uint32 indices, and the
 * atlas embedded as an image buffer view (image/jpeg or image/png, both glTF 2.0 core). The
 * `@curtain/mannequin` writer has no textures, and the spike may not change that package.
 * Deterministic (fixed key order, no timestamps). Positions in cm are written in metres (`scale`).
 */
import { vertexNormals, type Mesh } from '@curtain/mannequin';

export interface TexturedGlbInput {
  name: string;
  positions: ArrayLike<number>;
  uvs: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Normals per vertex (computed from the triangles when absent). */
  normals?: ArrayLike<number>;
  image: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png';
  roughness?: number;
  doubleSided?: boolean;
}

export interface TexturedGlbOptions {
  scale?: number;
  generator?: string;
  extras?: Record<string, unknown>;
}

const pad4 = (n: number): number => (n + 3) & ~3;

export function writeTexturedGlb(p: TexturedGlbInput, o: TexturedGlbOptions = {}): Uint8Array {
  const s = o.scale ?? 1;
  const nv = p.positions.length / 3;
  if (p.uvs.length !== nv * 2) throw new Error(`TEXCOORD_0 has ${p.uvs.length / 2} entries for ${nv} vertices`);
  const normals = p.normals ?? vertexNormals({ positions: Float64Array.from(p.positions), indices: Uint32Array.from(p.indices), vertexPart: new Uint8Array(0), partNames: [] } as Mesh);
  const pos = new Float32Array(nv * 3);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv * 3; i++) {
    pos[i] = p.positions[i]! * s;
    const c = i % 3;
    lo[c] = Math.min(lo[c]!, pos[i]!);
    hi[c] = Math.max(hi[c]!, pos[i]!);
  }
  const chunks: { bytes: Uint8Array; target?: number }[] = [
    { bytes: new Uint8Array(pos.buffer), target: 34962 },
    { bytes: new Uint8Array(Float32Array.from(normals).buffer), target: 34962 },
    { bytes: new Uint8Array(Float32Array.from(p.uvs).buffer), target: 34962 },
    { bytes: new Uint8Array(Uint32Array.from(p.indices).buffer), target: 34963 },
    { bytes: p.image },
  ];
  const bufferViews: Record<string, unknown>[] = [];
  let offset = 0;
  for (const c of chunks) {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: c.bytes.byteLength, ...(c.target ? { target: c.target } : {}) });
    offset = pad4(offset + c.bytes.byteLength);
  }
  const json = {
    asset: { version: '2.0', generator: o.generator ?? '@curtain/garment-spike', ...(o.extras ? { extras: o.extras } : {}) },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: p.name }],
    meshes: [{ name: p.name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{ name: `${p.name}-material`, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: p.roughness ?? 0.85 }, doubleSided: p.doubleSided ?? true }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 4, mimeType: p.mimeType }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5126, count: nv, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: nv, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: p.indices.length, type: 'SCALAR' },
    ],
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  for (let i = jsonBytes.length; i < jsonLen; i++) out[20 + i] = 0x20;
  let o2 = 20 + jsonLen;
  view.setUint32(o2, offset, true);
  view.setUint32(o2 + 4, 0x004e4942, true);
  o2 += 8;
  let k = 0;
  for (const c of chunks) {
    out.set(c.bytes, o2 + (bufferViews[k]!.byteOffset as number));
    k++;
  }
  return out;
}

export interface TexturedGlb {
  /** cm when the file says `asset.extras.unit` is 'cm', else metres × 100. */
  positions: Float64Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
  image: { bytes: Uint8Array; mimeType: string } | null;
  extras: Record<string, unknown> | null;
}

/**
 * Reads what `writeTexturedGlb` (or any single-primitive glb with TEXCOORD_0 and an embedded image)
 * wrote. Every offset is checked against the buffer.
 */
export function readTexturedGlb(bytes: Uint8Array): TexturedGlb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  const jsonLen = view.getUint32(12, true);
  if (20 + jsonLen > bytes.length) throw new Error('glb JSON chunk runs past the file');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as {
    asset?: { extras?: Record<string, unknown> };
    meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
    accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
    bufferViews?: { byteOffset?: number; byteLength: number }[];
    materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
    textures?: { source?: number }[];
    images?: { bufferView?: number; mimeType?: string }[];
  };
  const binStart = 20 + jsonLen + 8;
  if (binStart > bytes.length) throw new Error('glb has no BIN chunk');
  const binLen = view.getUint32(20 + jsonLen, true);
  if (binStart + binLen > bytes.length) throw new Error('glb BIN chunk runs past the file');
  const bin = bytes.subarray(binStart, binStart + binLen);
  const bvBytes = (i: number): Uint8Array => {
    const bv = json.bufferViews?.[i];
    if (!bv) throw new Error(`bufferView ${i} missing`);
    const o = bv.byteOffset ?? 0;
    if (o + bv.byteLength > bin.length) throw new Error(`bufferView ${i} runs past BIN`);
    return bin.subarray(o, o + bv.byteLength);
  };
  const accessor = (i: number, comps: number): Float64Array => {
    const a = json.accessors?.[i];
    if (!a || a.bufferView === undefined) throw new Error(`accessor ${i} missing`);
    const b = bvBytes(a.bufferView);
    const o = a.byteOffset ?? 0;
    const n = a.count * comps;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    if (o + n * size > b.length) throw new Error(`accessor ${i} runs past its bufferView`);
    const dv = new DataView(b.buffer, b.byteOffset + o, n * size);
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) out[k] = a.componentType === 5126 ? dv.getFloat32(4 * k, true) : a.componentType === 5125 ? dv.getUint32(4 * k, true) : a.componentType === 5123 ? dv.getUint16(2 * k, true) : dv.getUint8(k);
    return out;
  };
  const prim = json.meshes?.[0]?.primitives[0];
  if (!prim || prim.attributes.POSITION === undefined) throw new Error('glb has no mesh');
  const k = json.asset?.extras?.unit === 'cm' ? 1 : 100;
  const positions = accessor(prim.attributes.POSITION, 3).map((x) => Math.round(x * k * 1e4) / 1e4);
  const uvs = prim.attributes.TEXCOORD_0 !== undefined ? Float32Array.from(accessor(prim.attributes.TEXCOORD_0, 2)) : null;
  const indices = prim.indices !== undefined ? Uint32Array.from(accessor(prim.indices, 1)) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  let image: TexturedGlb['image'] = null;
  const texIndex = json.materials?.[prim.material ?? 0]?.pbrMetallicRoughness?.baseColorTexture?.index;
  const src = texIndex !== undefined ? json.textures?.[texIndex]?.source : undefined;
  const img = src !== undefined ? json.images?.[src] : undefined;
  if (img && img.bufferView !== undefined) image = { bytes: bvBytes(img.bufferView).slice(), mimeType: img.mimeType ?? 'image/png' };
  return { positions, uvs, indices, image, extras: json.asset?.extras ?? null };
}
