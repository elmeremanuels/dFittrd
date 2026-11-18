/**
 * The writer of a drape bake (`drapeBake.ts` reads it). Server and test side only: the embed never imports this file
 * (it is not exported from the package index), so the meshopt encoder stays out of the viewer chunk.
 *
 * Per size: POSITION = the drape on the base body, one morph target per other body (drape − base), int16 on a
 * `meta.quantStepCm` grid through the node's scale and translation (KHR_mesh_quantization); one shared uint16 index
 * buffer; every view compressed with EXT_meshopt_compression (vertex codec `codec`, default 1).
 */
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import type { DrapeBakeMeta } from './drapeBake';

export interface DrapeBakeInput {
  meta: DrapeBakeMeta;
  indices: Uint32Array;
  /** Per size (in `meta.sizes` order): the base drape and the drapes on the target bodies (absolute, cm), `targetT` order. */
  drapes: { size: string; base: Float32Array; targets: Float32Array[]; targetNames?: string[] }[];
  generator?: string;
  codec?: number;
}

export async function writeDrapeBake(input: DrapeBakeInput): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const { meta, indices } = input;
  const step = meta.quantStepCm;
  const codec = input.codec ?? 1;
  const chunks: Uint8Array[] = [];
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let raw = 0, packed = 0;
  const pad4 = (x: number): number => (x + 3) & ~3;
  function view(data: Uint8Array, count: number, stride: number, mode: 'ATTRIBUTES' | 'TRIANGLES', target: number): number {
    const enc = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode, mode === 'ATTRIBUTES' ? codec : undefined);
    const v: Record<string, unknown> = { buffer: 1, byteOffset: raw, byteLength: data.byteLength, target, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: packed, byteLength: enc.byteLength, byteStride: stride, mode, count } } };
    if (mode === 'ATTRIBUTES') v.byteStride = stride;
    chunks.push(enc, new Uint8Array(pad4(enc.byteLength) - enc.byteLength));
    packed += pad4(enc.byteLength);
    raw += pad4(data.byteLength);
    views.push(v);
    return views.length - 1;
  }
  function i16vec3(q: Int16Array, count: number): number {
    const buf = new Int16Array(count * 4);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { const v = q[3 * i + k]!; buf[4 * i + k] = v; mn[k] = Math.min(mn[k]!, v); mx[k] = Math.max(mx[k]!, v); }
    const bv = view(new Uint8Array(buf.buffer), count, 8, 'ATTRIBUTES', 34962);
    accessors.push({ bufferView: bv, componentType: 5122, count, type: 'VEC3', min: mn, max: mx });
    return accessors.length - 1;
  }
  let maxIndex = 0;
  for (const i of indices) maxIndex = Math.max(maxIndex, i);
  if (maxIndex > 65535) throw new Error('drape bake: more than 65,536 vertices');
  const idx16 = Uint16Array.from(indices);
  const ibv = view(new Uint8Array(idx16.buffer), idx16.length, 2, 'TRIANGLES', 34963);
  accessors.push({ bufferView: ibv, componentType: 5123, count: idx16.length, type: 'SCALAR' });
  const idxAcc = accessors.length - 1;
  // One grid for every size: origin at the min corner of all drapes.
  const origin = [Infinity, Infinity, Infinity];
  for (const d of input.drapes) for (const p of [d.base, ...d.targets]) for (let i = 0; i < p.length; i++) origin[i % 3] = Math.min(origin[i % 3]!, p[i]!);
  const q = (p: Float32Array): Int16Array =>
    Int16Array.from(p, (v, i) => {
      const n = Math.round((v - origin[i % 3]!) / step);
      if (n > 32767) throw new Error('drape bake: quantisation grid overflow');
      return n;
    });
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  for (const sm of meta.sizes) {
    const d = input.drapes.find((x) => x.size === sm.size);
    if (!d || d.targets.length !== sm.targetT.length) throw new Error(`drape bake: size ${sm.size} has no drapes for its bodies`);
    const qb = q(d.base);
    const count = d.base.length / 3;
    const targets = d.targets.map((tg) => ({ POSITION: i16vec3(Int16Array.from(q(tg), (v, i) => v - qb[i]!), count) }));
    meshes.push({ name: `size ${sm.size}`, primitives: [{ attributes: { POSITION: i16vec3(qb, count) }, indices: idxAcc, targets, mode: 4 }], weights: targets.map(() => 0), extras: { size: sm.size, ...(d.targetNames ? { targetNames: d.targetNames } : {}) } });
    nodes.push({ name: `size ${sm.size}`, mesh: meshes.length - 1, translation: origin, scale: [step, step, step] });
  }
  const bin = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0));
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.byteLength;
  }
  const gltf = {
    asset: { version: '2.0', generator: input.generator ?? 'curtain drapeBakeWrite.ts', extras: { unit: 'cm', curtainBake: meta } },
    extensionsUsed: ['KHR_mesh_quantization', 'EXT_meshopt_compression'],
    extensionsRequired: ['KHR_mesh_quantization', 'EXT_meshopt_compression'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.byteLength }, { byteLength: raw, extensions: { EXT_meshopt_compression: { fallback: true } } }],
  };
  const js = new TextEncoder().encode(JSON.stringify(gltf));
  const jsPad = pad4(js.byteLength);
  const total = 12 + 8 + jsPad + 8 + bin.byteLength;
  const glb = new Uint8Array(total);
  const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsPad, true);
  dv.setUint32(16, 0x4e4f534a, true);
  glb.set(js, 20);
  glb.fill(0x20, 20 + js.byteLength, 20 + jsPad);
  dv.setUint32(20 + jsPad, bin.byteLength, true);
  dv.setUint32(24 + jsPad, 0x004e4942, true);
  glb.set(bin, 28 + jsPad);
  return glb;
}
