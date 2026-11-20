/**
 * Test fixtures for the Phase 0 evaluation (eval*.test.ts and the viewer's shop-bundle test): the
 * synthetic garment of a spike product, a skirt cut from it, the committed shop payloads, and a
 * job dir laid out like a GPU run's output. Synthetic data only; no shop image is read.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath, writeGlb, type Mannequin, type Mesh } from '@curtain/mannequin';
import { mockGarment, type GarmentPayload } from '@curtain/schema';
import { DEFAULT_DISTORTION } from './bundle';
import { measureGarment, ringGirths } from './anchoring';
import { maskPng } from './evalPng';
import { colourRender, garmentSilhouette } from './evalView';
import { encodePng } from './exportPng';
import { distortGarment, generateGarment } from './garment';
import { garmentSpec } from './product';

const here = dirname(fileURLToPath(import.meta.url));

export const fixtureMannequin: Mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));

/** The spike's synthetic shirt dress at base size M (what the exporter calls the ground truth). */
export function syntheticDress(m: Mannequin = fixtureMannequin): Mesh {
  return generateGarment(m, garmentSpec(mockGarment('aalter-studio-2'), 'M'));
}

/** The same with the spike's simulated reconstruction error (what a stage 4 mesh might look like). */
export function reconstructedDress(m: Mannequin = fixtureMannequin): Mesh {
  const truth = syntheticDress(m);
  return distortGarment(m, truth, ringGirths(measureGarment(m, truth, 'dress')), DEFAULT_DISTORTION);
}

/** Keep the triangles whose three vertices pass `keep` (unused vertices are dropped). */
export function cropMesh(mesh: Mesh, keep: (x: number, y: number, z: number) => boolean): Mesh {
  const n = mesh.positions.length / 3;
  const ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) ok[i] = keep(mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!) ? 1 : 0;
  const remap = new Int32Array(n).fill(-1);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    if (!tri.every((v) => ok[v])) continue;
    for (const v of tri) {
      if (remap[v] === -1) {
        remap[v] = pos.length / 3;
        pos.push(mesh.positions[3 * v]!, mesh.positions[3 * v + 1]!, mesh.positions[3 * v + 2]!);
      }
      idx.push(remap[v]!);
    }
  }
  const positions = Float64Array.from(pos);
  return { positions, indices: Uint32Array.from(idx), vertexPart: new Uint8Array(positions.length / 3), partNames: ['garment'] };
}

/** A skirt: the synthetic dress below the waist (+2 cm), sleeves dropped. */
export function syntheticSkirt(m: Mannequin = fixtureMannequin): Mesh {
  const top = m.morphHeights.waist + 2;
  return cropMesh(reconstructedDress(m), (x, y) => y < top && Math.abs(x) < 28);
}

interface ShopEntry {
  handle: string;
  payload: GarmentPayload;
  baseSize: string;
}

/** The five committed shop payloads (data/bohohippychic/products.json): v1 drafts without colour or EUR price. */
export function shopPayloads(): ShopEntry[] {
  const data = JSON.parse(readFileSync(join(here, '..', 'data', 'bohohippychic', 'products.json'), 'utf8')) as { products: ShopEntry[] };
  return data.products.map((p) => ({ handle: p.handle, payload: p.payload, baseSize: p.baseSize }));
}

export function shopPayload(handle: string): ShopEntry {
  const p = shopPayloads().find((x) => x.handle === handle);
  if (!p) throw new Error(`no shop product ${handle}`);
  return p;
}

export interface FakeJobOptions {
  /** The mesh written as stage4/stage2/garment.glb (cm, mannequin space). */
  recon: Mesh;
  /** The garment the stage 1b masks are rendered from. */
  pinned: Mesh;
  frames?: number;
  width?: number;
  height?: number;
  inventedBack?: boolean;
  withCostSummary?: boolean;
  /** Also write stage 2 frames and their garment masks (`stage2/garment_mask/`), rendered from `pinned`. */
  withStage2Masks?: boolean;
}

/**
 * A job dir as a GPU run leaves it, small: manifest.json with the camera and stage 1b views, the
 * stage 1b garment masks rendered from `pinned`, stage 1b and 2 records, the stage 4 mesh and metrics,
 * and optionally cost_summary.json. Numbers in the records are fixture values, not measurements.
 */
export function writeFakeJob(o: FakeJobOptions): string {
  const dir = mkdtempSync(join(tmpdir(), 'curtain-eval-'));
  const frames = o.frames ?? 8;
  const width = o.width ?? 96;
  const height = o.height ?? 160;
  const m = fixtureMannequin;
  const path = turntablePath(m, 'turntable_mid', { frames });
  const body = buildMannequinMesh(m);
  const put = (rel: string, data: Uint8Array | string): void => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), data);
  };
  const views = (['front', 'back'] as const).map((view) => ({
    view,
    frame: view === 'front' ? 0 : frames / 2,
    source: view === 'back' && o.inventedBack ? null : `dress/source_${view}.jpg`,
    bare_rgb: `dress/bare_${view}.png`,
    bare_mask: `control/mask/${String(view === 'front' ? 0 : frames / 2).padStart(4, '0')}.png`,
    still: `stage1b/${view}.png`,
    garment_mask: `stage1b/garment_mask_${view}.png`,
    invented: view === 'back' && o.inventedBack === true,
  }));
  put('manifest.json', JSON.stringify({
    format: 'curtain.phase0.job',
    job_id: 'fixture-000000000000',
    input_hash: '0'.repeat(64),
    camera: { path_id: 'turntable_mid', frames, width, height },
    synthetic: null,
    stage1b: {
      dir: 'stage1b',
      source_kind: 'on_model',
      sources: [{ role: 'front', path: 'dress/source_front.jpg', sha256: 'a'.repeat(64), source: 'fixture' }, ...(o.inventedBack ? [] : [{ role: 'back', path: 'dress/source_back.jpg', sha256: 'b'.repeat(64), source: 'fixture' }])],
      views,
      invented_back: o.inventedBack === true,
    },
  }));
  for (const v of views) {
    const mask = garmentSilhouette(body, o.pinned, path.frames[v.frame]!, width, height);
    put(v.garment_mask, maskPng(mask));
    put(`stage1b/source/${v.view}_mask.png`, maskPng(mask));
  }
  const cost = (stage: string, gpuSeconds: number) => ({ stage, estimate: true, gpu: 'L40S', region: 'eu', gpu_seconds: gpuSeconds, wall_seconds: gpuSeconds + 10, usd_estimate_low: 0.01, usd_estimate_high: 0.02 });
  put('stage1b/record.json', JSON.stringify({ engine: 'fashn', invented_back: o.inventedBack === true, summary: { pass: true, failed_views: [] }, cost: cost('stage1b_dress', 100) }));
  put('stage2/record.json', JSON.stringify({ model: { id: 'fixture-video' }, steps: 4, turntable_frames_assembled: frames, seams: [{ mean_abs_diff_8bit: 3.5 }], cost: cost('stage2_video', 200) }));
  put('stage4/stage2/garment.glb', writeGlb([{ name: 'garment', positions: o.recon.positions, indices: o.recon.indices }], { scale: 0.01 }));
  put('stage4/stage2/metrics.json', JSON.stringify({ mesh: { triangles: o.recon.indices.length / 3 }, mask_iou: { train: 0.9, holdout: 0.89 }, cost: cost('stage4_recon[stage2]', 50) }));
  if (o.withStage2Masks) {
    for (let f = 0; f < frames; f++) {
      const name = String(f).padStart(4, '0');
      put(`stage2/garment_mask/${name}.png`, maskPng(garmentSilhouette(null, o.pinned, path.frames[f]!, width, height)));
      const rgb = colourRender(body, o.pinned, null, path.frames[f]!, width, height);
      put(`stage2/frames/${name}.png`, encodePng({ width, height, channels: 3, bitDepth: 8, data: rgb }));
    }
    put('stage2/garment_mask/record.json', JSON.stringify({ segmentation: 'fixture-segment', frames, ambiguous_frames: [] }));
  }
  if (o.withCostSummary) put('cost_summary.json', JSON.stringify({ costs: [cost('stage1b_dress', 100), cost('stage2_video', 200), cost('stage4_recon[stage2]', 50)], cost_total: { estimate: true, gpu_seconds: 350, usd_estimate_low: 0.03, usd_estimate_high: 0.06 }, wall_seconds: 400 }));
  return dir;
}
