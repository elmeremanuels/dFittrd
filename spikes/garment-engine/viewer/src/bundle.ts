/**
 * The spike asset bundle as the device sees it (docs/ENGINE-HANDOFF.md §Stage 8): base.glb,
 * anchors.json, grading.json, material.json and qa.json from `spikes/garment-engine/out/<id>/`.
 * Types come from the spike itself, so the viewer reads exactly what `build:bundle` writes.
 * An evaluated Phase 0 bundle (`out/eval/<id>/`, product id `eval/<id>`) also carries payload.json,
 * the product's garment payload for the fit engine, and says so in anchors.json (`payloadFile`); the
 * spike fixtures have none and are looked up by id instead.
 */
import { glbFloatAccessor, glbIndexAccessor, readGlb, type Mesh } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { weldWithRemap } from '../../src/evalMesh';
import type { GradingJson } from '../../src/grading';
import type { MaterialJson } from '../../src/product';

export interface GarmentAnchorsJson {
  format: 'curtain.garment.anchors';
  productId: string;
  baseSize: string;
  category: string;
  unit: 'cm';
  mannequin: { version: string; shape: string };
  synthetic: boolean;
  /** Set by evaluated bundles: the file holding the product payload. */
  payloadFile?: string;
  rings: Record<string, { circumferenceCm: number; chartCm: number | null; spansBothLegs: boolean }>;
}

export interface QaJson {
  format: 'curtain.garment.qa';
  productId: string;
  synthetic: boolean;
  /** maxAbsCm is null in an evaluation bundle when a critical ring has no girth (listed in `missing`); `critical` and `missing` only in evaluation bundles. */
  chartAgreement: { maxAbsCm: number | null; pass: boolean; critical?: string[]; missing?: string[] };
  calibration: { residualBeforeCm: { maxAbs: number }; residualAfterGlobalCm: { maxAbs: number } };
  meshHealth: { triangles: number };
}

export interface SpikeBundle {
  productId: string;
  anchors: GarmentAnchorsJson;
  grading: GradingJson;
  material: MaterialJson;
  qa: QaJson;
  /** The calibrated base-size garment in mannequin space, cm (welded: one particle per position, what grading and the drape use). */
  baseMesh: Mesh;
  /** A baked texture (stage 4t bundles): the render mesh's UVs and topology and its map onto `baseMesh`. */
  render?: GarmentRender;
  /** The texture image decoded in the browser (absent in node, or when base.glb has none). */
  textureImage?: ImageBitmap;
  /** payload.json when the bundle has one (evaluated shop products). */
  payload?: GarmentPayload;
}

/** The render side of a textured base.glb: UVs per render vertex, its triangles, and render vertex → welded vertex. */
export interface GarmentRender {
  uvs: Float32Array;
  indices: Uint32Array;
  remap: Uint32Array;
  image: { bytes: Uint8Array; mimeType: string };
}

interface GltfImages {
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  textures?: { source?: number }[];
  images?: { bufferView?: number; mimeType?: string }[];
  bufferViews?: { byteOffset?: number; byteLength: number }[];
}

/**
 * A spike base.glb (written in metres), back in cm. Without TEXCOORD_0 the mesh is used as stored.
 * With a baked texture (stage 4t) the file holds a render mesh whose UV seams duplicate vertices: it
 * is welded by position for grading and the drape (a seam must not tear the cloth), and `render`
 * maps the welded particles back onto the textured vertices.
 */
export function garmentFromGlb(bytes: Uint8Array): { mesh: Mesh; render: GarmentRender | null } {
  const glb = readGlb(bytes);
  const prim = glb.json.meshes[0]?.primitives[0] as { attributes: Record<string, number>; indices?: number; material?: number } | undefined;
  if (!prim || prim.attributes.POSITION === undefined) throw new Error('base.glb has no mesh');
  const unit = (glb.json.asset.extras?.unit as string | undefined) ?? 'm';
  const k = unit === 'cm' ? 1 : 100;
  const f32 = glbFloatAccessor(glb, prim.attributes.POSITION);
  const positions = new Float64Array(f32.length);
  for (let i = 0; i < f32.length; i++) positions[i] = Math.round(f32[i]! * k * 1e4) / 1e4;
  const indices = glbIndexAccessor(glb, prim.indices as number);
  const raw: Mesh = { positions, indices, vertexPart: new Uint8Array(positions.length / 3), partNames: [glb.json.meshes[0]!.name] };
  const json = glb.json as unknown as GltfImages;
  const tex = json.materials?.[prim.material ?? 0]?.pbrMetallicRoughness?.baseColorTexture?.index;
  const img = tex !== undefined ? json.images?.[json.textures?.[tex]?.source ?? -1] : undefined;
  if (prim.attributes.TEXCOORD_0 === undefined || !img || img.bufferView === undefined) return { mesh: raw, render: null };
  const bv = json.bufferViews?.[img.bufferView];
  if (!bv || (bv.byteOffset ?? 0) + bv.byteLength > glb.bin.length) throw new Error('base.glb: texture image runs past the buffer');
  const imageBytes = glb.bin.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const { mesh, remap } = weldWithRemap(raw);
  return { mesh, render: { uvs: glbFloatAccessor(glb, prim.attributes.TEXCOORD_0), indices, remap, image: { bytes: imageBytes, mimeType: img.mimeType ?? 'image/png' } } };
}

/** The garment mesh of a spike base.glb, cm (welded when the file is textured). */
export function meshFromGlb(bytes: Uint8Array): Mesh {
  return garmentFromGlb(bytes).mesh;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

async function get(fetchFn: FetchLike, url: string): Promise<Awaited<ReturnType<FetchLike>>> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** Product ids with a complete bundle, from the dev server's `/bundle/index.json`. */
export async function listBundles(fetchFn: FetchLike, base = '/bundle'): Promise<{ products: string[]; hint: string | null }> {
  return (await (await get(fetchFn, `${base}/index.json`)).json()) as { products: string[]; hint: string | null };
}

export async function loadBundle(fetchFn: FetchLike, productId: string, base = '/bundle'): Promise<SpikeBundle> {
  const dir = `${base}/${encodeURIComponent(productId)}`;
  const [anchors, grading, material, qa, glb] = await Promise.all([
    get(fetchFn, `${dir}/anchors.json`).then((r) => r.json()),
    get(fetchFn, `${dir}/grading.json`).then((r) => r.json()),
    get(fetchFn, `${dir}/material.json`).then((r) => r.json()),
    get(fetchFn, `${dir}/qa.json`).then((r) => r.json()),
    get(fetchFn, `${dir}/base.glb`).then((r) => r.arrayBuffer()),
  ]);
  const g = grading as GradingJson;
  if (g.format !== 'curtain.garment.grading') throw new Error(`${productId}: grading.json has format ${String(g.format)}`);
  const a = anchors as GarmentAnchorsJson;
  const payload = a.payloadFile === 'payload.json' ? ((await (await get(fetchFn, `${dir}/payload.json`)).json()) as GarmentPayload) : undefined;
  const garment = garmentFromGlb(new Uint8Array(glb));
  let textureImage: ImageBitmap | undefined;
  if (garment.render && typeof createImageBitmap === 'function') {
    // glTF UVs have v down: decode without flipping, the texture keeps flipY = false.
    textureImage = await createImageBitmap(new Blob([garment.render.image.bytes as BlobPart], { type: garment.render.image.mimeType }), { imageOrientation: 'none' } as ImageBitmapOptions);
  }
  return {
    productId,
    anchors: a,
    grading: g,
    material: material as MaterialJson,
    qa: qa as QaJson,
    baseMesh: garment.mesh,
    ...(garment.render ? { render: garment.render } : {}),
    ...(textureImage ? { textureImage } : {}),
    ...(payload ? { payload } : {}),
  };
}
