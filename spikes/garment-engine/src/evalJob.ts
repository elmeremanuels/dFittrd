/**
 * Reads what the GPU stages left in a Phase 0 job dir (`out/phase0/<id>/`, from the GitHub Actions
 * artifact or a local `modal run`) and runs the evaluation of one product on it:
 *
 *   manifest.json                       exporter (camera, stage 1b views, input hash)
 *   stage1b/record.json                 stage 1b: engine, per-view QA, invented back, cost
 *   stage1b/garment_mask_<view>.png     the pinned stills' garment masks (view agreement)
 *   stage1b/source/<view>_mask.png      the shop photo's garment mask (indicative comparison)
 *   stage2/record.json                  stage 2: model, steps, seams, cost
 *   stage3/garment_mask/                stage 3 masks, when stage 3 ran
 *   stage4/<source>/garment.glb         stage 4 mesh (+ metrics.json with its cost)
 *   cost_summary.json                   run_phase0.py: every stage's cost record and the total
 *
 * Every file is optional; a missing one is reported as "not run", never filled in. JSON is parsed
 * and read through narrow accessors only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath, type Mannequin, type Mesh } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { evaluateGarment, SIMULATED_ERROR, type EvalResult, type MeshSourceKind } from './eval';
import { evalBundle, type ViewAgreement } from './evalBundle';
import { readGarmentGlb, weldVerticesWithColors, weldWithRemap } from './evalMesh';
import { readTexturedGlb } from './glbTextured';
import type { RgbImage } from './jpeg';
import { frontOpeningFromRecord } from './proxy';
import { renderTextured } from './stage4t';
import { renderPositions } from './templateFit';
import { cameraFromFrame } from './views';
import { decodeAnyPng, maskFromPng, maskPng, type Mask } from './evalPng';
import { colourRender, garmentSilhouette, overlayPng, overlayRgb, RENDER_BACKGROUND, scoreView, shopPhotoScore, sideBySidePng, type TurntableScore, type ViewName, type ViewReference } from './evalView';
import { maskIou } from './evalPng';
import { stillWidths, type StillWidth } from './bottomOpenings';
import type { WaistReadingChoice } from './lowRise';

export type Json = Record<string, unknown>;

const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
export const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
export const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
export const obj = (x: unknown): Json | null => (isObj(x) ? x : null);
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** Paths inside the job dir only: no absolute paths, no `..`. */
export function safeJoin(dir: string, rel: string): string | null {
  if (!rel || rel.startsWith('/') || rel.split(/[\\/]/).some((p) => p === '..')) return null;
  return join(dir, rel);
}

function readJson(path: string): Json | null {
  if (!existsSync(path)) return null;
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

export interface CostRecord {
  stage: string;
  gpu: string | null;
  region: string | null;
  gpuSeconds: number | null;
  wallSeconds: number | null;
  usdLow: number | null;
  usdHigh: number | null;
  estimate: boolean;
}

export function costRecord(x: unknown): CostRecord | null {
  const o = obj(x);
  if (!o || !str(o.stage)) return null;
  return { stage: str(o.stage)!, gpu: str(o.gpu), region: str(o.region), gpuSeconds: num(o.gpu_seconds), wallSeconds: num(o.wall_seconds), usdLow: num(o.usd_estimate_low), usdHigh: num(o.usd_estimate_high), estimate: o.estimate !== false };
}

export interface JobFiles {
  dir: string;
  exists: boolean;
  manifest: Json | null;
  stage1b: Json | null;
  stage2: Json | null;
  stage3Masks: number;
  /** Garment masks of the generated frames (`stage2/garment_mask/`, the stage 2 segmentation stage 4 trains on) and their record. */
  stage2Masks: { count: number; record: Json | null };
  stage4: Partial<Record<'stage2' | 'synthetic', { glb: string | null; metrics: Json | null }>>;
  /**
   * Stage 4t (template fit + bake, `scripts/stage4t.ts`): textured garment.glb, metrics.json, atlas.png, and the drape log
   * written after it (`src/drapeLogJob.ts`: exemplar.json, the measured pattern; shadow.json, the P0 prediction against it).
   */
  stage4t: Partial<Record<'stage2' | 'synthetic', { glb: string | null; metrics: Json | null; atlas: string | null; exemplar: Json | null; shadow: Json | null }>>;
  costSummary: Json | null;
  /** Every cost record found: cost_summary.json when present, else the stages' own records. */
  costs: CostRecord[];
}

export function readJob(dir: string): JobFiles {
  const exists = existsSync(dir) && statSync(dir).isDirectory();
  const at = (rel: string): string => join(dir, rel);
  const stage4: JobFiles['stage4'] = {};
  for (const source of ['stage2', 'synthetic'] as const) {
    const glb = at(`stage4/${source}/garment.glb`);
    const metrics = readJson(at(`stage4/${source}/metrics.json`));
    if (existsSync(glb) || metrics) stage4[source] = { glb: existsSync(glb) ? `stage4/${source}/garment.glb` : null, metrics };
  }
  const stage4t: JobFiles['stage4t'] = {};
  for (const source of ['stage2', 'synthetic'] as const) {
    const glb = at(`stage4t/${source}/garment.glb`);
    const metrics = readJson(at(`stage4t/${source}/metrics.json`));
    const atlas = at(`stage4t/${source}/atlas.png`);
    if (existsSync(glb) || metrics)
      stage4t[source] = { glb: existsSync(glb) ? `stage4t/${source}/garment.glb` : null, metrics, atlas: existsSync(atlas) ? `stage4t/${source}/atlas.png` : null, exemplar: readJson(at(`stage4t/${source}/exemplar.json`)), shadow: readJson(at(`stage4t/${source}/shadow.json`)) };
  }
  const maskDir = at('stage3/garment_mask');
  const stage3Masks = existsSync(maskDir) ? readdirSync(maskDir).filter((f) => f.endsWith('.png')).length : 0;
  const files: JobFiles = {
    dir,
    exists,
    manifest: readJson(at('manifest.json')),
    stage1b: readJson(at('stage1b/record.json')),
    stage2: withRescoredConsistency(readJson(at('stage2/record.json')), readJson(at(RESCORED_CONSISTENCY)), { record: mtimeMs(at('stage2/record.json')), rescore: mtimeMs(at(RESCORED_CONSISTENCY)) }),
    stage3Masks,
    stage2Masks: { count: existsSync(at('stage2/garment_mask')) ? readdirSync(at('stage2/garment_mask')).filter((f) => f.endsWith('.png')).length : 0, record: readJson(at('stage2/garment_mask/record.json')) },
    stage4,
    stage4t,
    costSummary: readJson(at('cost_summary.json')),
    costs: [],
  };
  const fromSummary = arr(files.costSummary?.costs).map(costRecord).filter((c): c is CostRecord => c !== null);
  files.costs = fromSummary.length
    ? fromSummary
    : [files.stage1b?.cost, files.stage2?.cost, files.stage4.stage2?.metrics?.cost, files.stage4.synthetic?.metrics?.cost].map(costRecord).filter((c): c is CostRecord => c !== null);
  return files;
}

/** Where `phase0_garment.py <job> --score` (CPU) writes a re-scored stage 2 consistency check. */
export const RESCORED_CONSISTENCY = 'stage2/consistency_v2.json';

/** [major, minor, patch] of a version string such as 'garment-consistency-0.4.0'; null without one. */
export function consistencyVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? /(\d+)\.(\d+)\.(\d+)\s*$/.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The frame-level outcome of a consistency check, for telling an identical re-score from a changed one (`seconds` etc. ignored). */
function checkOutcome(c: unknown): string {
  const o = c && typeof c === 'object' ? (c as Json) : {};
  return JSON.stringify([o.version ?? null, o.frames ?? null, o.flagged ?? null, o.flagged_frames ?? null, o.off_reference_spans ?? null]);
}

/**
 * The stage 2 record with a CPU re-score of its consistency check (`phase0_garment.py <job> --score`) in place of the one
 * the GPU run wrote, so the report reads the newer check (e.g. 0.4.0's off-reference spans on a clip scored by 0.3.0 on
 * Modal). The GPU run's own check stays in `consistency_gpu`; the re-score is marked with `rescored_from`.
 *
 * The re-score is used only when it has a version at least the record's and, when both times are known, it is not older
 * than `stage2/record.json` (a stage 2 re-run makes an old re-score stale). Otherwise the GPU check is kept and
 * `rescore_ignored` says why. A re-score with the same frame-level outcome as the GPU check is not substituted; the
 * check is marked `rescore_identical` instead. No record: nothing (a re-score alone is not a stage 2 run).
 */
export function withRescoredConsistency(record: Json | null, rescore: Json | null, times?: { record?: number | null; rescore?: number | null }): Json | null {
  if (!record || !rescore) return record;
  const gpu = record.consistency && typeof record.consistency === 'object' ? (record.consistency as Json) : null;
  const ignore = (why: string): Json => (gpu ? { ...record, consistency: { ...gpu, rescore_ignored: why } } : record);
  const rv = consistencyVersion(rescore.version);
  if (!rv) return ignore(`${RESCORED_CONSISTENCY} has no version`);
  const gv = consistencyVersion(gpu?.version);
  if (gv && compareVersions(rv, gv) < 0) return ignore(`${RESCORED_CONSISTENCY} (${String(rescore.version)}) is older than the GPU check (${String(gpu?.version)})`);
  if (times?.record != null && times.rescore != null && times.rescore < times.record) return ignore(`${RESCORED_CONSISTENCY} predates stage2/record.json (stage 2 re-run since)`);
  if (gpu && checkOutcome(gpu) === checkOutcome(rescore)) return { ...record, consistency: { ...gpu, rescore_identical: RESCORED_CONSISTENCY } };
  return { ...record, consistency: { ...rescore, rescored_from: RESCORED_CONSISTENCY, gpu_version: gpu?.version ?? null }, consistency_gpu: gpu };
}

function mtimeMs(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

function readMask(dir: string, rel: string): Mask | null {
  const p = safeJoin(dir, rel);
  if (!p || !existsSync(p)) return null;
  try {
    return maskFromPng(decodeAnyPng(new Uint8Array(readFileSync(p))));
  } catch {
    return null;
  }
}

/** The pinned views' reference masks: stage 1b garment masks, else (synthetic product) the synthetic masks of frames 0 and N/2. */
export function viewReferences(job: JobFiles): { refs: ViewReference[]; notes: string[] } {
  const notes: string[] = [];
  const cam = obj(job.manifest?.camera);
  const frames = num(cam?.frames);
  if (!job.manifest || !frames) return { refs: [], notes: ['no manifest.json in the job dir: no camera for the view renders'] };
  const refs: ViewReference[] = [];
  const s1b = obj(job.manifest.stage1b);
  if (s1b) {
    for (const v of arr(s1b.views)) {
      const vo = obj(v);
      const view = str(vo?.view) as ViewName | null;
      const rel = str(vo?.garment_mask);
      const frame = num(vo?.frame);
      if (!view || !rel || frame === null) continue;
      const mask = readMask(job.dir, rel);
      if (mask) refs.push({ view, frame, kind: 'stage1b', path: rel, mask, invented: vo?.invented === true });
      else notes.push(`${view}: ${rel} not found (stage 1b not run, or the still failed QA)`);
    }
  } else {
    const syn = obj(job.manifest.synthetic);
    const dirRel = str(syn?.garment_mask_dir);
    if (dirRel) {
      for (const [view, frame] of [['front', 0], ['back', frames / 2]] as const) {
        const rel = `${dirRel}/${String(frame).padStart(4, '0')}.png`;
        const mask = readMask(job.dir, rel);
        if (mask) refs.push({ view, frame, kind: 'synthetic', path: rel, mask, invented: false });
      }
    } else notes.push('the job has neither stage 1b views nor synthetic masks');
  }
  return { refs, notes };
}

/** Turntable angles compared with the stage 2 frames (0° front, 180° back; 90° a side, which stage 1b never pinned). */
export const TURNTABLE_ANGLES = [0, 90, 180] as const;

export interface ViewMeshes {
  /** The calibrated base-size mesh (the asset). */
  calibrated: Mesh;
  /** The mesh as reconstructed, before calibration. */
  reconstructed?: Mesh;
  /** Per-vertex RGB of both meshes (same vertex order), for the colour renders. */
  colors?: ArrayLike<number> | null;
  /** A baked texture (stage 4t): the render mesh's UVs and topology, its map onto `calibrated`, and the atlas pixels. */
  texture?: EvalTexture | null;
}

/** A stage 4t texture carried through the evaluation into the bundle. */
export interface EvalTexture {
  uvs: Float32Array;
  indices: Uint32Array;
  /** Render vertex → vertex of the welded (evaluated) mesh. */
  remap: Uint32Array;
  image: { bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' };
  /** Decoded atlas for the software renders (stage4t/<source>/atlas.png), when present. */
  atlas: RgbImage | null;
}

export function viewAgreement(job: JobFiles, m: Mannequin, meshes: Mesh | ViewMeshes, writeImage?: (name: string, png: Uint8Array) => void): ViewAgreement {
  const vm: ViewMeshes = 'positions' in meshes ? { calibrated: meshes } : meshes;
  const garment = vm.calibrated;
  const { refs, notes } = viewReferences(job);
  const cam = obj(job.manifest?.camera);
  const frames = num(cam?.frames);
  const width = num(cam?.width);
  const height = num(cam?.height);
  if (!frames || !width || !height) return { views: [], shopPhotos: [], turntable: [], notes };
  const path = turntablePath(m, 'turntable_mid', { frames });
  const body = buildMannequinMesh(m);
  const views = [];
  const shopPhotos = [];
  const rendered = new Map<ViewName, Mask>();
  const renderView = (view: ViewName, frame: number): Mask => {
    let r = rendered.get(view);
    if (!r) {
      r = garmentSilhouette(body, garment, path.frames[frame]!, width, height);
      rendered.set(view, r);
      writeImage?.(`view/${view}_render.png`, maskPng(r));
    }
    return r;
  };
  for (const ref of refs) {
    if (ref.mask.width !== width || ref.mask.height !== height) {
      notes.push(`${ref.view}: reference mask is ${ref.mask.width}×${ref.mask.height}, frames are ${width}×${height}`);
      continue;
    }
    const r = renderView(ref.view, ref.frame);
    const sil = garmentSilhouette(null, garment, path.frames[ref.frame]!, width, height);
    views.push(scoreView(r, ref, undefined, sil));
    writeImage?.(`view/${ref.view}_overlay.png`, overlayPng(r, ref.mask));
  }
  // Shop photo masks (stage 1b segmentation of the shop photo): indicative only.
  for (const view of ['front', 'back'] as const) {
    const rel = `stage1b/source/${view}_mask.png`;
    const photo = readMask(job.dir, rel);
    if (!photo) continue;
    const r = renderView(view, view === 'front' ? 0 : frames / 2);
    const s = shopPhotoScore(view, r, photo, rel);
    if (s) shopPhotos.push(s);
  }
  if (job.manifest && obj(job.manifest.stage1b) && shopPhotos.length === 0) notes.push('no shop photo masks (stage1b/source/<view>_mask.png): stage 1b not run');

  // Turntable: the mesh against the generated frames' garment masks (stage 2 segmentation) at 0°, 90° and 180°.
  const turntable: TurntableScore[] = [];
  const r4 = (x: number): number => Math.round(x * 10000) / 10000;
  for (const angleDeg of TURNTABLE_ANGLES) {
    const frame = Math.round((angleDeg / 360) * frames);
    const name = String(frame).padStart(4, '0');
    const refRel = `stage2/garment_mask/${name}.png`;
    const ref = readMask(job.dir, refRel);
    if (!ref || ref.width !== width || ref.height !== height) continue;
    const cf = path.frames[frame]!;
    let calibratedVisible: Mask | null = null;
    for (const [kind, mesh] of [['calibrated', garment], ['reconstructed', vm.reconstructed]] as const) {
      if (!mesh) continue;
      const vis = garmentSilhouette(body, mesh, cf, width, height);
      const sil = garmentSilhouette(null, mesh, cf, width, height);
      turntable.push({ angleDeg, frame, referencePath: refRel, mesh: kind, iouVisible: r4(maskIou(vis, ref).iou), iouSilhouette: r4(maskIou(sil, ref).iou) });
      if (kind === 'calibrated') calibratedVisible = vis;
    }
    if (writeImage && calibratedVisible) {
      const framePath = safeJoin(job.dir, `stage2/frames/${name}.png`);
      let frameRgb: Uint8Array | null = null;
      if (framePath && existsSync(framePath)) {
        try {
          const img = decodeAnyPng(new Uint8Array(readFileSync(framePath)));
          if (img.width === width && img.height === height) {
            frameRgb = new Uint8Array(width * height * 3);
            for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) frameRgb[3 * i + c] = img.data[i * img.channels + (img.channels >= 3 ? c : 0)]!;
          }
        } catch {
          frameRgb = null;
        }
      }
      const tex = vm.texture;
      const shown = tex && tex.atlas
        ? renderTextured(cameraFromFrame(cf, width, height), { positions: renderPositions(tex, garment.positions), uvs: tex.uvs, indices: tex.indices }, tex.atlas, body, RENDER_BACKGROUND)
        : colourRender(body, garment, vm.colors ?? null, cf, width, height);
      const panels = [...(frameRgb ? [frameRgb] : []), shown, overlayRgb(calibratedVisible, ref)];
      writeImage(`view/turntable_${angleDeg}.png`, sideBySidePng(width, height, panels));
    }
  }
  if (job.manifest && turntable.length === 0) notes.push('no stage 2 garment masks (stage2/garment_mask/): no turntable comparison');
  return { views, shopPhotos, turntable, notes };
}

/**
 * The pinned stills' garment masks against the mannequin's own silhouette in the same camera (rendered from our mesh, not
 * segmented), on the rows of the given heights (`stillWidths`).
 */
export function stillsAgainstBody(job: JobFiles, m: Mannequin, heightsCm: readonly number[]): { view: ViewName; frame: number; widths: StillWidth[] }[] {
  const { refs } = viewReferences(job);
  const frames = num(obj(job.manifest?.camera)?.frames);
  if (!frames) return [];
  const path = turntablePath(m, 'turntable_mid', { frames });
  const body = buildMannequinMesh(m);
  return refs.map((ref) => {
    const cf = path.frames[ref.frame]!;
    const bodyMask = garmentSilhouette(null, body, cf, ref.mask.width, ref.mask.height);
    return { view: ref.view, frame: ref.frame, widths: stillWidths(ref.mask, bodyMask, cameraFromFrame(cf, ref.mask.width, ref.mask.height), heightsCm) };
  });
}

export interface MeshChoice {
  kind: MeshSourceKind;
  path: string;
  bytes: Uint8Array | null;
  /** For a synthetic truth built in memory when the job dir has none. */
  mesh: Mesh | null;
}

/**
 * The mesh to evaluate: the stage 4 reconstruction of the generated video when it exists. With
 * `allowSynthetic` (the spike's own product only), fall back to stage 4 on the synthetic frames,
 * then to the synthetic ground truth (`synthetic/garment_truth.glb`, or `fallbackTruth`).
 */
export function chooseMesh(job: JobFiles, opts: { allowSynthetic: boolean; fallbackTruth?: () => Mesh; prefer?: 'stage4t' | 'stage4' }): MeshChoice | null {
  const read = (rel: string): Uint8Array | null => {
    const p = safeJoin(job.dir, rel);
    return p && existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  };
  // Stage 4t (template fit) first: stage 4's 2DGS mesh is the alternative (run 14: 22 % of it inside the mannequin).
  const t2 = job.stage4t.stage2?.glb;
  if (t2 && (opts.prefer ?? 'stage4t') === 'stage4t') return { kind: 'stage4t', path: t2, bytes: read(t2), mesh: null };
  const s2 = job.stage4.stage2?.glb;
  if (s2) return { kind: 'stage4', path: s2, bytes: read(s2), mesh: null };
  if (t2) return { kind: 'stage4t', path: t2, bytes: read(t2), mesh: null };
  if (!opts.allowSynthetic) return null;
  const syn = job.stage4.synthetic?.glb;
  if (syn) return { kind: 'stage4-synthetic', path: syn, bytes: read(syn), mesh: null };
  const truthRel = str(obj(job.manifest?.synthetic)?.truth_glb);
  if (truthRel) {
    const bytes = read(truthRel);
    if (bytes) return { kind: 'synthetic-truth', path: truthRel, bytes, mesh: null };
  }
  if (opts.fallbackTruth) return { kind: 'synthetic-truth', path: '(generated in memory: generateGarment)', bytes: null, mesh: opts.fallbackTruth() };
  return null;
}

export interface ProductEval {
  result: EvalResult;
  /** stage4t/<source>/metrics.json when the evaluated mesh is stage 4t's. */
  stage4t?: Json | null;
  view: ViewAgreement;
  bundle: ReturnType<typeof evalBundle> | null;
  /** Bottoms: each pinned still's garment width against the mannequin's on the rows of the top edge, the hip and below. */
  stills?: { view: ViewName; frame: number; widths: StillWidth[] }[];
  meanColorHex: string | null;
  readMs: number;
  evalMs: number;
  viewMs: number;
}

/** Evaluate one product on the chosen mesh: anchoring + calibration + grading, view agreement, bundle files. */
export function evaluateProduct(o: {
  productId: string;
  payload: GarmentPayload;
  baseSize: string;
  job: JobFiles;
  choice: MeshChoice;
  writeImage?: (name: string, png: Uint8Array) => void;
  /** What the printed shoulder_to_hem means (`evaluateGarment`). */
  printedLength?: 'flat-lay' | 'drop';
  /** The founder's recorded waist reading (`evaluateGarment` `waistReading`, `src/lowRise.ts`). */
  waistReading?: WaistReadingChoice | null;
}): ProductEval {
  const t0 = performance.now();
  let mesh: Mesh;
  let meanColorHex: string | null = null;
  let colors: Float32Array | null = null;
  let texture: EvalTexture | null = null;
  if (o.choice.mesh) mesh = o.choice.mesh;
  else if (o.choice.kind === 'stage4t') {
    if (!o.choice.bytes) throw new Error(`${o.choice.path}: missing`);
    const g = readTexturedGlb(o.choice.bytes);
    if (!g.uvs || !g.image) throw new Error(`${o.choice.path}: no TEXCOORD_0 or no embedded image`);
    const raw: Mesh = { positions: g.positions, indices: g.indices, vertexPart: new Uint8Array(g.positions.length / 3), partNames: ['garment'] };
    const w = weldWithRemap(raw);
    mesh = w.mesh;
    const source = o.choice.path.split('/')[1] === 'synthetic' ? 'synthetic' : 'stage2';
    const atlasRel = o.job.stage4t[source]?.atlas ?? null;
    let atlas: RgbImage | null = null;
    if (atlasRel) {
      const img = decodeAnyPng(new Uint8Array(readFileSync(safeJoin(o.job.dir, atlasRel)!)));
      if (img.channels >= 3) {
        const data = new Uint8Array(img.width * img.height * 3);
        for (let p = 0; p < img.width * img.height; p++) for (let c = 0; c < 3; c++) data[3 * p + c] = img.data[p * img.channels + c]!;
        atlas = { width: img.width, height: img.height, data };
      }
    }
    texture = { uvs: g.uvs, indices: g.indices, remap: w.remap, image: { bytes: g.image.bytes, mimeType: g.image.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' }, atlas };
    const mc = arr(obj(o.job.stage4t[source]?.metrics?.bake)?.meanColour).map((x) => num(x) ?? 0);
    if (mc.length === 3) meanColorHex = `#${mc.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  } else {
    if (!o.choice.bytes) throw new Error(`${o.choice.path}: missing`);
    const g = readGarmentGlb(o.choice.bytes);
    const w = weldVerticesWithColors(g.mesh, g.colors);
    mesh = w.mesh;
    colors = w.colors;
    meanColorHex = o.choice.kind === 'stage4' ? g.meanColorHex : null;
  }
  const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
  const t1 = performance.now();
  const result = evaluateGarment({
    productId: o.productId,
    payload: o.payload,
    baseSize: o.baseSize,
    mesh,
    mannequin: m,
    source: { kind: o.choice.kind, path: o.choice.path, simulatedError: o.choice.kind === 'synthetic-truth' ? SIMULATED_ERROR : null },
    ...(o.printedLength ? { printedLength: o.printedLength } : {}),
    // Outerwear: the control proxy's front opening (from the description) is what the tape may bridge at the front.
    frontOpening: frontOpeningFromRecord(obj(obj(o.job.manifest?.control)?.proxy)?.front_opening),
    ...(o.waistReading ? { waistReading: o.waistReading } : {}),
  });
  const t2 = performance.now();
  // The simulated error of a synthetic truth changes positions, not the vertex order: the colours still apply.
  const view = viewAgreement(o.job, m, { calibrated: result.baseMesh, reconstructed: result.reconstructed, colors, texture }, o.writeImage);
  const stills = result.category === 'bottom' ? stillsAgainstBody(o.job, m, [95, 90, m.morphHeights.hip, 84, 80]) : undefined;
  const t3 = performance.now();
  const bundle = result.grading ? evalBundle(result, o.payload, { meanColorHex, view, texture, inputs: { jobDir: o.job.dir, manifestInputHash: str(o.job.manifest?.input_hash) } }) : null;
  const stage4t = o.choice.kind === 'stage4t' ? o.job.stage4t[o.choice.path.split('/')[1] === 'synthetic' ? 'synthetic' : 'stage2']?.metrics ?? null : null;
  return { result, view, bundle, ...(stills ? { stills } : {}), meanColorHex, stage4t, readMs: Math.round(t1 - t0), evalMs: Math.round(t2 - t1), viewMs: Math.round(t3 - t2) };
}
