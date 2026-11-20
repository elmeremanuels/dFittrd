/**
 * The reader of a drape bake (`drapeBake.ts` describes the file). Kept apart so the meshopt decoder (WebAssembly,
 * about 17 KB gzip) is loaded only for a bundle that is a bake: `bundle.ts` imports this file with `import()`.
 * Runs on the device; nothing is sent (D3).
 */
import { readGlb } from '@curtain/mannequin';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { drapeBakeMetaOf, type BakedSize, type DrapeBake } from './drapeBake';

interface Accessor { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }
interface BufferView { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES'; filter?: string; count: number } } }
interface BakeGltf {
  asset: { extras?: { curtainBake?: unknown } };
  accessors: Accessor[];
  bufferViews: BufferView[];
  meshes: { name?: string; primitives: { attributes: { POSITION: number }; indices: number; targets?: { POSITION: number }[] }[]; extras?: { size?: string } }[];
  nodes: { mesh?: number; translation?: number[]; scale?: number[] }[];
}

/** Decode a drape bake from base.glb bytes. Waits for the meshopt decoder (WebAssembly) once. */
export async function readDrapeBake(bytes: Uint8Array): Promise<DrapeBake> {
  const glb = readGlb(bytes);
  const json = glb.json as unknown as BakeGltf;
  const meta = drapeBakeMetaOf(json);
  if (!meta) throw new Error('base.glb holds no drape bake');
  await MeshoptDecoder.ready;
  const views = new Map<number, Uint8Array>();
  const viewBytes = (i: number): Uint8Array => {
    const hit = views.get(i);
    if (hit) return hit;
    const v = json.bufferViews[i]!;
    const ext = v.extensions?.EXT_meshopt_compression;
    let out: Uint8Array;
    if (ext) {
      out = new Uint8Array(ext.count * ext.byteStride);
      const src = glb.bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
      MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, (ext.filter ?? 'NONE') as 'NONE');
    } else {
      out = glb.bin.slice(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    }
    views.set(i, out);
    return out;
  };
  const short3 = (acc: number, scale: number, offset: readonly number[] | null): Float32Array => {
    const a = json.accessors[acc]!;
    if (a.componentType !== 5122 || a.type !== 'VEC3') throw new Error('drape bake: positions must be int16 VEC3');
    const raw = viewBytes(a.bufferView);
    const stride = json.bufferViews[a.bufferView]!.byteStride ?? 6;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) out[3 * i + k] = dv.getInt16((a.byteOffset ?? 0) + i * stride + 2 * k, true) * scale + (offset ? offset[k]! : 0);
    return out;
  };
  const indexOf = (acc: number): Uint32Array => {
    const a = json.accessors[acc]!;
    const raw = viewBytes(a.bufferView);
    if (a.componentType === 5123) return Uint32Array.from(new Uint16Array(raw.buffer, raw.byteOffset + (a.byteOffset ?? 0), a.count));
    if (a.componentType === 5125) return new Uint32Array(raw.buffer.slice(raw.byteOffset + (a.byteOffset ?? 0), raw.byteOffset + (a.byteOffset ?? 0) + 4 * a.count));
    throw new Error('drape bake: indices must be uint16 or uint32');
  };
  const sizes = new Map<string, BakedSize>();
  let indices: Uint32Array | null = null;
  let vertexCount = -1;
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh]!;
    const sm = meta.sizes.find((s) => s.size === mesh.extras?.size);
    if (!sm) continue;
    const prim = mesh.primitives[0]!;
    const scale = node.scale?.[0] ?? 1;
    if (node.scale && (node.scale[1] !== scale || node.scale[2] !== scale)) throw new Error('drape bake: the grid must be uniform');
    const base = short3(prim.attributes.POSITION, scale, node.translation ?? [0, 0, 0]);
    const targets = (prim.targets ?? []).map((t) => short3(t.POSITION, scale, null));
    if (targets.length !== sm.targetT.length) throw new Error(`drape bake: size ${sm.size} has ${targets.length} targets for ${sm.targetT.length} bodies`);
    if (targets.some((tg) => tg.length !== base.length)) throw new Error(`drape bake: size ${sm.size} has a morph target of another vertex count`);
    if (vertexCount >= 0 && base.length / 3 !== vertexCount) throw new Error('drape bake: sizes differ in vertex count');
    if (sizes.has(sm.size)) throw new Error(`drape bake: size ${sm.size} has two meshes`);
    vertexCount = base.length / 3;
    // One triangle list for every size: the figure draws them all with the first one.
    const idx = indexOf(prim.indices);
    if (indices && (idx.length !== indices.length || idx.some((v, i) => v !== indices![i]))) throw new Error(`drape bake: size ${sm.size} has other triangles than the first size`);
    indices ??= idx;
    if (indices.some((v) => v >= vertexCount)) throw new Error('drape bake: an index is out of range');
    sizes.set(sm.size, { ...sm, base, targets } satisfies BakedSize);
  }
  if (!indices || sizes.size !== meta.sizes.length) throw new Error('drape bake: a size listed in the metadata has no mesh');
  return { meta, indices, vertexCount, sizes };
}
