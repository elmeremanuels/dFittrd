/**
 * A drape bake (docs/research/step3-serverdrape-spike.md §10, route R2): the garment draped on the SERVER, per size, on
 * a few chart bodies along one axis of the size chart, packed into base.glb. The device does not drape: it blends the
 * drapes of the selected size to the shopper's place on the axis (piecewise linear between the two nearest chart
 * bodies, held at the ends) and pushes the few particles the blend leaves inside the drawn body back out.
 *
 * File: base.glb is a glTF 2.0 with one mesh per size. Its POSITION is the drape on the size's base body (t = 0) and
 * its morph targets are the drapes on the other chart bodies minus that base, all int16 on a `quantStepCm` grid through
 * the node's scale and translation (KHR_mesh_quantization), every buffer view compressed with EXT_meshopt_compression.
 * `asset.extras.curtainBake` (`DrapeBakeMeta`) names the bodies, the axis, the colour and what each size rests on.
 * There are no normals (the figure computes them) and no texture: the garment is drawn in one plain colour.
 *
 * Everything here runs on the device; nothing is sent (D3). Pure apart from the meshopt decoder (WebAssembly).
 */
import { readGlb } from '@curtain/mannequin';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

export const DRAPE_BAKE_FORMAT = 'curtain.garment.drapeBake';

/** Where a size's garment measurements come from: the shop's tape, or interpolated / extrapolated from it. */
export type SizeProvenance = 'measured' | 'interpolated' | 'extrapolated';

export interface DrapeBakeSizeMeta {
  size: string;
  /** Axis value of the base body (the mesh's own POSITION). */
  baseT: number;
  /** Axis values of the morph targets, in target order. */
  targetT: number[];
  provenance: SizeProvenance;
  /** Chart bodies this size was not draped on, and why (e.g. the wear rule says the band cannot be worn there). */
  notDraped?: { t: number; reason: string }[];
}

export interface DrapeBakeMeta {
  format: typeof DRAPE_BAKE_FORMAT;
  formatVersion: 1;
  /** The shopper's axis value: t = (hip − hipAtZero) / hipPerUnit (the chart's hip line). */
  axis: { measure: 'hip'; hipAtZero: number; hipPerUnit: number; label: string };
  quantStepCm: number;
  /** The garment is drawn in this one colour; the product's print is not shown. */
  plainColourHex: string;
  plainColourSource: string;
  sizes: DrapeBakeSizeMeta[];
  /** Free text: how the drapes were made (shown to developers, not to shoppers). */
  source: string;
}

export interface BakedSize extends DrapeBakeSizeMeta {
  /** Base drape, cm, mannequin frame. */
  base: Float32Array;
  /** Morph targets (drape − base), cm, in `targetT` order. */
  targets: Float32Array[];
}

export interface DrapeBake {
  meta: DrapeBakeMeta;
  indices: Uint32Array;
  vertexCount: number;
  sizes: Map<string, BakedSize>;
}

interface Accessor { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }
interface BufferView { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES'; filter?: string; count: number } } }
interface BakeGltf {
  asset: { extras?: { curtainBake?: unknown } };
  accessors: Accessor[];
  bufferViews: BufferView[];
  meshes: { name?: string; primitives: { attributes: { POSITION: number }; indices: number; targets?: { POSITION: number }[] }[]; extras?: { size?: string } }[];
  nodes: { mesh?: number; translation?: number[]; scale?: number[] }[];
}

/** The bake's metadata, or null when base.glb is an ordinary garment file. Throws on a bake it cannot read. */
export function drapeBakeMetaOf(json: { asset?: { extras?: { curtainBake?: unknown } } }): DrapeBakeMeta | null {
  const m = json.asset?.extras?.curtainBake as Partial<DrapeBakeMeta> | undefined;
  if (!m) return null;
  if (m.format !== DRAPE_BAKE_FORMAT || m.formatVersion !== 1) throw new Error(`drape bake: unsupported format ${String(m.format)} ${String(m.formatVersion)}`);
  if (!Array.isArray(m.sizes) || m.sizes.length === 0 || !m.axis || !(Number(m.quantStepCm) > 0) || typeof m.plainColourHex !== 'string') throw new Error('drape bake: incomplete metadata');
  return m as DrapeBakeMeta;
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
    if (vertexCount >= 0 && base.length / 3 !== vertexCount) throw new Error('drape bake: sizes differ in vertex count');
    vertexCount = base.length / 3;
    indices ??= indexOf(prim.indices);
    sizes.set(sm.size, { ...sm, base, targets });
  }
  if (!indices || sizes.size !== meta.sizes.length) throw new Error('drape bake: a size listed in the metadata has no mesh');
  return { meta, indices, vertexCount, sizes };
}

/** The shopper's axis value from the hip girth (cm), not clamped. */
export function bakeAxis(meta: Pick<DrapeBakeMeta, 'axis'>, hipCm: number): number {
  return (hipCm - meta.axis.hipAtZero) / meta.axis.hipPerUnit;
}

/**
 * Morph weights of a size at axis value t: piecewise linear between the two nearest chart bodies (base and targets
 * together), held at the outermost body beyond the ends (no extrapolation). Returned in target order; the base body
 * gets 1 − Σ.
 */
export function bakeWeights(size: Pick<DrapeBakeSizeMeta, 'baseT' | 'targetT'>, t: number): { weights: number[]; clamped: boolean } {
  const nodes = [size.baseT, ...size.targetT];
  const order = nodes.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const lo = order[0]![0], hi = order[order.length - 1]![0];
  const c = Math.min(hi, Math.max(lo, t));
  const w = new Array<number>(nodes.length).fill(0);
  if (order.length === 1) w[0] = 1;
  else
    for (let k = 0; k + 1 < order.length; k++) {
      const [a, ia] = order[k]!, [b, ib] = order[k + 1]!;
      if (c >= a && c <= b) {
        const f = b > a ? (c - a) / (b - a) : 0;
        w[ia] = 1 - f;
        w[ib] = f;
        break;
      }
    }
  return { weights: w.slice(1), clamped: t < lo - 1e-9 || t > hi + 1e-9 };
}

/** base + Σ w_k · target_k: the blended drape, cm. */
export function blendBakedSize(size: Pick<BakedSize, 'base' | 'targets'>, weights: readonly number[]): Float32Array {
  const out = Float32Array.from(size.base);
  size.targets.forEach((tg, k) => {
    const w = weights[k] ?? 0;
    if (w === 0) return;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + w * tg[i]!;
  });
  return out;
}

/**
 * The device's last step: particles of a blended drape that lie inside the drawn body (`collide`, the drape's collider
 * with its clearance) are moved out, and a hem below the soles is laid on the floor, as the collider does in an
 * on-device drape. Projection only: nothing else moves. Counts are what the estimate rests on (reported, not shown).
 */
export function settleOnBody(pos: Float32Array, collide: (pos: Float32Array, i: number) => boolean, floorCm = 0): { body: number; floor: number; maxBodyCm: number } {
  let body = 0, floor = 0, maxBodyCm = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[3 * i]!, y = pos[3 * i + 1]!, z = pos[3 * i + 2]!;
    if (!collide(pos, i)) continue;
    if (y < floorCm) floor++;
    const dh = Math.hypot(pos[3 * i]! - x, pos[3 * i + 2]! - z);
    if (dh > 1e-6) {
      body++;
      maxBodyCm = Math.max(maxBodyCm, dh);
    }
  }
  return { body, floor, maxBodyCm };
}
