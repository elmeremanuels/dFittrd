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
  /** maxAbsCm is null in an evaluation bundle when a critical ring has no girth; `critical` only in evaluation bundles. */
  chartAgreement: { maxAbsCm: number | null; pass: boolean; critical?: string[] };
  calibration: { residualBeforeCm: { maxAbs: number }; residualAfterGlobalCm: { maxAbs: number } };
  meshHealth: { triangles: number };
}

export interface SpikeBundle {
  productId: string;
  anchors: GarmentAnchorsJson;
  grading: GradingJson;
  material: MaterialJson;
  qa: QaJson;
  /** The calibrated base-size garment in mannequin space, cm. */
  baseMesh: Mesh;
  /** payload.json when the bundle has one (evaluated shop products). */
  payload?: GarmentPayload;
}

/** The garment mesh of a spike base.glb (written in metres by `writeGlb(…, { scale: 0.01 })`), back in cm. */
export function meshFromGlb(bytes: Uint8Array): Mesh {
  const glb = readGlb(bytes);
  const prim = glb.json.meshes[0]?.primitives[0];
  if (!prim || prim.attributes.POSITION === undefined) throw new Error('base.glb has no mesh');
  const unit = (glb.json.asset.extras?.unit as string | undefined) ?? 'm';
  const k = unit === 'cm' ? 1 : 100;
  const f32 = glbFloatAccessor(glb, prim.attributes.POSITION);
  const positions = new Float64Array(f32.length);
  for (let i = 0; i < f32.length; i++) positions[i] = Math.round(f32[i]! * k * 1e4) / 1e4;
  const indices = glbIndexAccessor(glb, prim.indices);
  return { positions, indices, vertexPart: new Uint8Array(positions.length / 3), partNames: [glb.json.meshes[0]!.name] };
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
  return {
    productId,
    anchors: a,
    grading: g,
    material: material as MaterialJson,
    qa: qa as QaJson,
    baseMesh: meshFromGlb(new Uint8Array(glb)),
    ...(payload ? { payload } : {}),
  };
}
