/**
 * Stage 4t on a Phase 0 job dir (`out/phase0/<id>/`): template fit (`templateFit.ts`) to the stage 2
 * garment masks with the exporter's cameras, the texture bake (`bake.ts`) from the stage 2 frames,
 * and the metrics the handoff asks of stage 4 (silhouette IoU per view on a train/holdout split, cloth
 * inside the mannequin, mesh health, triangle budget; Chamfer against the truth on the synthetic
 * frames). Writes `stage4t/<source>/garment.glb` (textured), `texture.jpg`, `metrics.json` and preview
 * pictures. CPU only; runs here and in the browser-free pipeline. Stage 4 (2DGS + TSDF on the GPU)
 * stays as the alternative; the evaluation picks stage 4t when it exists (`evalJob.chooseMesh`).
 *
 * Inputs read (all written by our own exporter and GPU stages, treated as data): manifest.json,
 * cameras_opencv.json, mannequin.glb, control/proxy.glb (else the proxy is built from the payload),
 * <source>/garment_mask/NNNN.png, the frames (stage2/frames or synthetic/rgb) and, for stage 2, the control
 * render the frames were generated from (control/mask, control/proxy_mask; `templateFit.CONTROL_CAP`).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, topology, type Mannequin, type Mesh } from '@curtain/mannequin';
import { bakeTexture, photometricCheck, type BakeOptions, type BakeReport, type PhotometricCheck } from './bake';
import { buildBodySdf } from './bodySdf';
import { chamfer, type ChamferReport } from './chamfer';
import { clothInsideBody, type InsideBody } from './eval';
import { readGarmentGlb, weldVertices } from './evalMesh';
import { decodeAnyPng, maskFromPng, maskIou, type Mask } from './evalPng';
import { encodePng } from './exportPng';
import { writeTexturedGlb } from './glbTextured';
import { encodeJpeg, type RgbImage } from './jpeg';
import { distancesToMesh } from './meshDistance';
import { fitTemplate, type RenderMesh, type TemplateFitOptions, type TemplateFitReport } from './templateFit';
import { camerasFromOpencvJson, idMask, project, rasterize, splitFrames, type PinholeCamera } from './views';

export const STAGE4T_VERSION = 'stage4t-0.3.0';
export type Stage4tSource = 'stage2' | 'synthetic';

export interface JobViews {
  cameras: PinholeCamera[];
  masks: Mask[];
  frames: (Uint8Array | null)[];
  maskDir: string;
  framesDir: string;
  /** The control render each stage 2 frame was generated from (control/mask, control/proxy_mask; none for the synthetic renders): `FitViews.control`. */
  control: ({ mannequin: Mask; proxy: Mask } | null)[] | null;
  controlDir: string | null;
}

const name4 = (i: number): string => String(i).padStart(4, '0');

function rgbOf(path: string, w: number, h: number): Uint8Array | null {
  if (!existsSync(path)) return null;
  const img = decodeAnyPng(new Uint8Array(readFileSync(path)));
  if (img.width !== w || img.height !== h) return null;
  const out = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) out[3 * p + c] = img.data[p * img.channels + (img.channels >= 3 ? c : 0)]!;
  return out;
}

export function loadJobViews(dir: string, source: Stage4tSource): JobViews {
  const cameras = camerasFromOpencvJson(JSON.parse(readFileSync(join(dir, 'cameras_opencv.json'), 'utf8')));
  const maskDir = source === 'stage2' ? 'stage2/garment_mask' : 'synthetic/garment_mask';
  const framesDir = source === 'stage2' ? 'stage2/frames' : 'synthetic/rgb';
  const masks = cameras.map((c, i) => {
    const p = join(dir, maskDir, `${name4(i)}.png`);
    if (!existsSync(p)) throw new Error(`${maskDir}/${name4(i)}.png missing`);
    const m = maskFromPng(decodeAnyPng(new Uint8Array(readFileSync(p))));
    if (m.width !== c.width || m.height !== c.height) throw new Error(`${maskDir}/${name4(i)}.png is ${m.width}×${m.height}, cameras say ${c.width}×${c.height}`);
    return m;
  });
  const frames = cameras.map((c, i) => rgbOf(join(dir, framesDir, `${name4(i)}.png`), c.width, c.height));
  // Stage 2's frames follow the exporter's control render; the synthetic frames are renders of a known garment and follow none.
  const readMask = (p: string, c: PinholeCamera): Mask | null => {
    if (!existsSync(p)) return null;
    const mk = maskFromPng(decodeAnyPng(new Uint8Array(readFileSync(p))));
    return mk.width === c.width && mk.height === c.height ? mk : null;
  };
  const control = source === 'stage2' && existsSync(join(dir, 'control/mask'))
    ? cameras.map((c, i) => {
        const mannequin = readMask(join(dir, 'control/mask', `${name4(i)}.png`), c);
        if (!mannequin) return null;
        // A bare control (no proxy) has no proxy mask: the whole mannequin is bare.
        const proxy = readMask(join(dir, 'control/proxy_mask', `${name4(i)}.png`), c) ?? { width: c.width, height: c.height, data: new Uint8Array(c.width * c.height) };
        return { mannequin, proxy };
      })
    : null;
  return { cameras, masks, frames, maskDir, framesDir, control, controlDir: control ? 'control/mask, control/proxy_mask' : null };
}

export interface ViewIou {
  frame: number;
  azimuthDeg: number;
  split: 'train' | 'holdout';
  /** Garment with the mannequin as occluder (what a viewer shows) against the visible-garment mask. */
  visible: number;
  /** Garment alone. */
  silhouette: number;
}

export interface IouSummary {
  views: number;
  visibleMean: number;
  visibleMin: number;
  silhouetteMean: number;
  silhouetteMin: number;
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

export function viewIous(mesh: Pick<Mesh, 'positions' | 'indices'>, body: Pick<Mesh, 'positions' | 'indices'>, views: JobViews, train: readonly number[]): ViewIou[] {
  const trainSet = new Set(train);
  return views.cameras.map((cam, i) => {
    const vis = rasterize(cam, [{ positions: body.positions, indices: body.indices, id: 1 }, { positions: mesh.positions, indices: mesh.indices, id: 2 }]);
    const sil = rasterize(cam, [{ positions: mesh.positions, indices: mesh.indices, id: 2 }]);
    return { frame: i, azimuthDeg: cam.azimuthDeg, split: trainSet.has(i) ? 'train' : 'holdout', visible: r4(maskIou(idMask(vis, 2), views.masks[i]!).iou), silhouette: r4(maskIou(idMask(sil, 2), views.masks[i]!).iou) };
  });
}

/** Within this distance of an arm's cap top (cm): the shoulder-cap region of `capTextureShare`. */
export const CAP_REGION_CM = 6;

export interface CapTexture {
  radiusCm: number;
  /** Atlas texels whose surface point lies within `radiusCm` of either cap top. */
  texels: number;
  /** Share of them sampled from at least one training frame; the rest is diffusion fill from the neighbouring print. */
  seenShare: number;
  note: string;
}

/**
 * How much of the shoulder cap's print comes from the frames. The cap top is the highest point of each
 * arm's section at the shoulder joint (per side). The holdout photometric check compares only inside
 * the garment masks, and a sleeveless control leaves the cap bare in the frames (`templateFit.CONTROL_CAP`),
 * so it cannot judge the cap's print: this share says how much of it is sampled at all.
 */
export function capTextureShare(m: Mannequin, texels: { index: Int32Array; pos: Float32Array }, seenWeight: Float32Array): CapTexture {
  const tops = [m.arms.left, m.arms.right].map((f) => {
    const a0 = m.armAt(0, f.side)!;
    let best: number[] = [], by = -Infinity;
    for (let k = 0; k < 720; k++) {
      const t = (k * Math.PI) / 360;
      const p = [0, 1, 2].map((d) => f.joint[d]! + a0.a * Math.cos(t) * f.u[d]! + a0.b * Math.sin(t) * f.v[d]!);
      if (p[1]! > by) {
        by = p[1]!;
        best = p;
      }
    }
    return best;
  });
  let all = 0, seen = 0;
  for (let i = 0; i < texels.index.length; i++) {
    const x = texels.pos[3 * i]!, y = texels.pos[3 * i + 1]!, z = texels.pos[3 * i + 2]!;
    if (!tops.some((T) => Math.hypot(x - T[0]!, y - T[1]!, z - T[2]!) < CAP_REGION_CM)) continue;
    all++;
    if (seenWeight[texels.index[i]!]! > 0) seen++;
  }
  return { radiusCm: CAP_REGION_CM, texels: all, seenShare: all ? r4(seen / all) : 0, note: 'texels within radiusCm of the top of either arm cap (highest point of the arm section at the joint) sampled from a training frame; the rest is filled by diffusion. The holdout photometric check does not cover the cap.' };
}

export function summarise(ious: readonly ViewIou[], split: 'train' | 'holdout'): IouSummary {
  const v = ious.filter((x) => x.split === split);
  const mean = (k: 'visible' | 'silhouette'): number => r4(v.reduce((s, x) => s + x[k], 0) / Math.max(1, v.length));
  return { views: v.length, visibleMean: mean('visible'), visibleMin: r4(Math.min(...v.map((x) => x.visible))), silhouetteMean: mean('silhouette'), silhouetteMin: r4(Math.min(...v.map((x) => x.silhouette))) };
}

/** Closed loops of boundary edges (openings: neckline, hem, cuffs, armholes). */
export function boundaryLoops(mesh: Pick<Mesh, 'positions' | 'indices'>): { loops: number; edges: number; longestCm: number } {
  const count = new Map<string, number>();
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = I[t + k]!, b = I[t + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const adj = new Map<number, number[]>();
  let edges = 0;
  for (const [key, c] of count) {
    if (c !== 1) continue;
    edges++;
    const [a, b] = key.split(',').map(Number) as [number, number];
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set<number>();
  let loops = 0, longest = 0;
  const P = mesh.positions;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    loops++;
    let len = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const v = stack.pop()!;
      for (const w of adj.get(v) ?? []) {
        if (seen.has(w)) continue;
        seen.add(w);
        len += Math.hypot(P[3 * v]! - P[3 * w]!, P[3 * v + 1]! - P[3 * w + 1]!, P[3 * v + 2]! - P[3 * w + 2]!);
        stack.push(w);
      }
    }
    longest = Math.max(longest, len);
  }
  return { loops, edges, longestCm: Math.round(longest * 10) / 10 };
}

export interface Stage4tMetrics {
  format: 'curtain.phase0.stage4t';
  formatVersion: 1;
  version: typeof STAGE4T_VERSION;
  source: Stage4tSource;
  inputs: { cameras: string; maskDir: string; framesDir: string; controlDir: string | null; proxy: string; mannequinSha256: string; masksSha256: string };
  split: { train: number; holdout: number; rule: string };
  fit: TemplateFitReport;
  iou: { train: IouSummary; holdout: IouSummary; perView: ViewIou[] };
  /**
   * Vertices whose signed distance to mannequin.glb is below 0 (inside) and below the 4 mm clearance
   * (grid SDF, trilinear, the fit's own constraint); the exact distance to the mannequin's triangles
   * for the same vertices (`meshDistance.ts`: minimum, and how many lie below the clearance and below
   * 3 mm; the grid SDF may differ from it by a few tenths of a millimetre); and the evaluation's
   * analytic test (3 mm inside the analytic mannequin).
   */
  insideBody: { sdfInside: number; sdfBelowClearance: number; exact: { minCm: number; belowClearance: number; below3mm: number; method: string }; vertices: number; share: number; analytic: InsideBody };
  mesh: { triangles: number; vertices: number; budget: [number, number]; withinBudget: boolean; components: number; boundaryEdges: number; boundaryLoops: number; nonManifoldEdges: number; inconsistentEdges: number; degenerateTriangles: number; watertight: boolean; note: string };
  vsTruth: ChamferReport | null;
  bake: BakeReport & { jpegBytes: number; jpegQuality: number; holdout: PhotometricCheck[]; holdoutMean: { maeTexture: number; maeMeanColour: number; psnrTexture: number; psnrMeanColour: number; maeTextureBlock8: number; maeMeanColourBlock8: number } | null; meanColour: [number, number, number]; capTexture: CapTexture };
  glbBytes: number;
  timingsMs: Record<string, number>;
}

export interface Stage4tResult {
  /** Welded fitted mesh, cm (anchoring, calibration, grading and the drape use this). */
  mesh: Mesh;
  render: RenderMesh;
  atlas: RgbImage;
  /** garment.glb (textured render mesh), texture.jpg (the atlas inside it), atlas.png (lossless, for the evaluation's software renders), metrics.json. */
  files: { 'garment.glb': Uint8Array; 'texture.jpg': Uint8Array; 'atlas.png': Uint8Array; 'metrics.json': string; previews: Record<string, Uint8Array> };
  metrics: Stage4tMetrics;
}

export interface Stage4tInputs {
  dir: string;
  source: Stage4tSource;
  /** The control proxy (closed); null = read control/proxy.glb, and without it fit from mannequin + 1.5 cm. */
  proxy?: Mesh | null;
  proxyLabel?: string;
  category: TemplateFitOptions['category'];
  fit?: Partial<TemplateFitOptions>;
  bake?: Partial<BakeOptions>;
  jpegQuality?: number;
  /** Synthetic truth to compare with (the job's synthetic/garment_truth.glb when absent and source is synthetic). */
  truth?: Mesh | null;
  previews?: boolean;
  mannequin?: Mannequin;
  log?: (msg: string) => void;
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export function runStage4t(o: Stage4tInputs): Stage4tResult {
  const log = o.log ?? (() => undefined);
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string): void => {
    const t = performance.now();
    timings[k] = Math.round(t - t0);
    t0 = t;
  };
  const m = o.mannequin ?? buildMannequin(bodyShape(BASE_SHAPE_ID));
  const bodyBytes = new Uint8Array(readFileSync(join(o.dir, 'mannequin.glb')));
  const body = weldVertices(readGarmentGlb(bodyBytes).mesh);
  let proxy = o.proxy ?? null;
  let proxyLabel = o.proxyLabel ?? 'given';
  if (!proxy && existsSync(join(o.dir, 'control/proxy.glb'))) {
    proxy = weldVertices(readGarmentGlb(new Uint8Array(readFileSync(join(o.dir, 'control/proxy.glb')))).mesh);
    proxyLabel = 'control/proxy.glb';
  }
  if (!proxy) proxyLabel = 'none (mannequin + 1.5 cm)';
  const views = loadJobViews(o.dir, o.source);
  const { train, holdout } = splitFrames(views.cameras.length);
  lap('read');
  log(`stage 4t: ${views.cameras.length} views (${train.length} train, ${holdout.length} holdout), proxy ${proxyLabel}`);
  const sdf = buildBodySdf(body);
  lap('sdf');
  const fit = fitTemplate({ mannequin: m, body, sdf, proxy, views: { cameras: views.cameras, masks: views.masks, train, holdout, frames: views.frames, ...(views.control ? { control: views.control } : {}) }, options: { category: o.category, ...o.fit } });
  lap('fit');
  log(`stage 4t: fitted ${fit.mesh.indices.length / 3} triangles, ${fit.report.iterations} sweeps, converged ${fit.report.converged}`);
  const ious = viewIous(fit.mesh, body, views, train);
  lap('iou');
  let sdfInside = 0, sdfBelow = 0;
  const nv = fit.mesh.positions.length / 3;
  for (let i = 0; i < nv; i++) {
    const d = sdf.at(fit.mesh.positions[3 * i]!, fit.mesh.positions[3 * i + 1]!, fit.mesh.positions[3 * i + 2]!);
    if (d < 0) sdfInside++;
    if (d < fit.report.options.clearanceCm - 0.02) sdfBelow++;
  }
  const exactD = distancesToMesh(fit.mesh.positions, body, 2);
  let exactMin = Infinity, exactBelow = 0, exactBelow3 = 0;
  for (const d of exactD) {
    exactMin = Math.min(exactMin, d);
    if (d < fit.report.options.clearanceCm) exactBelow++;
    if (d < 0.3) exactBelow3++;
  }
  const topo = topology(fit.mesh);
  const loops = boundaryLoops(fit.mesh);
  let truth = o.truth ?? null;
  if (!truth && o.source === 'synthetic' && existsSync(join(o.dir, 'synthetic/garment_truth.glb'))) truth = weldVertices(readGarmentGlb(new Uint8Array(readFileSync(join(o.dir, 'synthetic/garment_truth.glb')))).mesh);
  const vsTruth = truth ? chamfer(fit.mesh, truth) : null;
  lap('metrics');

  const bakeIn = { render: fit.render, welded: fit.mesh, body, cameras: views.cameras, frames: views.frames, masks: views.masks, views: train, ...(o.bake ? { options: o.bake } : {}) };
  const bake = bakeTexture(bakeIn);
  lap('bake');
  const capTexture = capTextureShare(m, bake.texels, bake.seenWeight);
  // Mean garment colour over the training frames' masks: the one colour the old bundle carried.
  const meanColour: [number, number, number] = [0, 0, 0];
  let mc = 0;
  for (const v of train) {
    const f = views.frames[v];
    if (!f) continue;
    const mk = views.masks[v]!.data;
    for (let p = 0; p < mk.length; p += 7) if (mk[p]) {
      for (let c = 0; c < 3; c++) meanColour[c] = meanColour[c]! + f[3 * p + c]!;
      mc++;
    }
  }
  for (let c = 0; c < 3; c++) meanColour[c] = mc ? Math.round(meanColour[c]! / mc) : 0;
  const checks = holdout.map((v) => photometricCheck(bakeIn, bake, v, meanColour)).filter((c): c is PhotometricCheck => c !== null);
  const avg = (k: keyof PhotometricCheck): number => Math.round((checks.reduce((s, c) => s + (c[k] as number), 0) / Math.max(1, checks.length)) * 100) / 100;
  lap('photometric');
  const quality = o.jpegQuality ?? 88;
  const jpeg = encodeJpeg(bake.atlas, quality);
  lap('jpeg');
  const glb = writeTexturedGlb({ name: 'garment', positions: fit.render.positions, uvs: fit.render.uvs, indices: fit.render.indices, image: jpeg, mimeType: 'image/jpeg' }, {
    scale: 0.01,
    generator: `@curtain/garment-spike ${STAGE4T_VERSION}`,
    extras: { unit: 'm', stage: '4t', source: o.source, version: STAGE4T_VERSION, weldedVertices: nv, note: 'render mesh: UV seams duplicate vertices; weld by position for simulation' },
  });

  const previews: Record<string, Uint8Array> = {};
  if (o.previews !== false) {
    for (const deg of [0, 45, 90, 180, 270]) {
      const f = Math.round((deg / 360) * views.cameras.length) % views.cameras.length;
      const cam = views.cameras[f]!;
      const panels = [views.frames[f] ?? new Uint8Array(cam.width * cam.height * 3).fill(236), renderTextured(cam, fit.render, bake.atlas, body)];
      previews[`preview/turntable_${deg}.png`] = sideBySide(cam.width, cam.height, panels);
    }
  }
  lap('previews');

  const masksSha = createHash('sha256');
  for (const mk of views.masks) masksSha.update(mk.data);
  const metrics: Stage4tMetrics = {
    format: 'curtain.phase0.stage4t',
    formatVersion: 1,
    version: STAGE4T_VERSION,
    source: o.source,
    inputs: { cameras: 'cameras_opencv.json', maskDir: views.maskDir, framesDir: views.framesDir, controlDir: views.controlDir, proxy: proxyLabel, mannequinSha256: sha(bodyBytes), masksSha256: masksSha.digest('hex') },
    split: { train: train.length, holdout: holdout.length, rule: 'frame index mod 5 = 2 is held out (not used by the fit or the bake)' },
    fit: fit.report,
    iou: { train: summarise(ious, 'train'), holdout: summarise(ious, 'holdout'), perView: ious },
    insideBody: { sdfInside, sdfBelowClearance: sdfBelow, exact: { minCm: Math.round(exactMin * 1000) / 1000, belowClearance: exactBelow, below3mm: exactBelow3, method: 'unsigned point-to-triangle distance to mannequin.glb (exact), inside/outside from the SDF sign' }, vertices: nv, share: r4(sdfInside / nv), analytic: clothInsideBody(m, fit.mesh) },
    mesh: {
      triangles: topo.triangles,
      vertices: topo.vertices,
      budget: [8000, 15000],
      withinBudget: topo.triangles >= 8000 && topo.triangles <= 15000,
      components: topo.components,
      boundaryEdges: topo.boundaryEdges,
      boundaryLoops: loops.loops,
      nonManifoldEdges: topo.nonManifoldEdges,
      inconsistentEdges: topo.inconsistentEdges,
      degenerateTriangles: topo.degenerateTriangles,
      watertight: topo.watertight,
      note: 'open by design: one body tube and one tube per sleeve whose shoulder cap closes over the arm cap and overlaps the bodice (separate components, not stitched); openings at the neckline, hem, cuffs and underarms are the boundary loops',
    },
    vsTruth,
    bake: { ...bake.report, jpegBytes: jpeg.length, jpegQuality: quality, holdout: checks, holdoutMean: checks.length ? { maeTexture: avg('maeTexture'), maeMeanColour: avg('maeMeanColour'), psnrTexture: avg('psnrTexture'), psnrMeanColour: avg('psnrMeanColour'), maeTextureBlock8: avg('maeTextureBlock8'), maeMeanColourBlock8: avg('maeMeanColourBlock8') } : null, meanColour, capTexture },
    glbBytes: glb.length,
    timingsMs: timings,
  };
  const atlasPng = encodePng({ width: bake.atlas.width, height: bake.atlas.height, channels: 3, bitDepth: 8, data: bake.atlas.data });
  return { mesh: fit.mesh, render: fit.render, atlas: bake.atlas, files: { 'garment.glb': glb, 'texture.jpg': jpeg, 'atlas.png': atlasPng, 'metrics.json': `${JSON.stringify(metrics, null, 2)}\n`, previews }, metrics };
}

function sideBySide(width: number, height: number, panels: readonly Uint8Array[]): Uint8Array {
  const gap = 8;
  const W = panels.length * width + (panels.length - 1) * gap;
  const data = new Uint8Array(W * height * 3).fill(255);
  panels.forEach((p, k) => {
    for (let y = 0; y < height; y++) data.set(p.subarray(y * width * 3, (y + 1) * width * 3), (y * W + k * (width + gap)) * 3);
  });
  return encodePng({ width: W, height, channels: 3, bitDepth: 8, data });
}

/**
 * The textured garment on the grey mannequin at a camera: perspective-correct UVs, nearest texel,
 * unlit (the atlas carries the frames' light), mannequin flat grey with a head light. RGB samples.
 */
export function renderTextured(cam: PinholeCamera, render: Pick<RenderMesh, 'positions' | 'uvs' | 'indices'>, atlas: RgbImage, body: Pick<Mesh, 'positions' | 'indices'> | null, background: readonly [number, number, number] = [236, 236, 236]): Uint8Array {
  const W = cam.width, H = cam.height;
  const out = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) out.set(background, 3 * i);
  const depth = new Float32Array(W * H).fill(Infinity);
  const q = new Float64Array(3);
  const draw = (P: ArrayLike<number>, I: ArrayLike<number>, uv: ArrayLike<number> | null): void => {
    const nv = P.length / 3;
    const sx = new Float64Array(nv), sy = new Float64Array(nv), sz = new Float64Array(nv);
    for (let v = 0; v < nv; v++) {
      project(cam, P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!, q);
      sx[v] = q[0]!;
      sy[v] = q[1]!;
      sz[v] = q[2]!;
    }
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
      if (sz[a]! <= 1 || sz[b]! <= 1 || sz[c]! <= 1) continue;
      const x0 = sx[a]!, y0 = sy[a]!, x1 = sx[b]!, y1 = sy[b]!, x2 = sx[c]!, y2 = sy[c]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area === 0) continue;
      let shade = 1;
      if (!uv) {
        const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!;
        const vx = P[3 * c]! - P[3 * a]!, vy = P[3 * c + 1]! - P[3 * a + 1]!, vz = P[3 * c + 2]! - P[3 * a + 2]!;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const dx = cam.centre[0] - P[3 * a]!, dy = cam.centre[1] - P[3 * a + 1]!, dz = cam.centre[2] - P[3 * a + 2]!;
        shade = 0.35 + 0.65 * Math.abs((nx * dx + ny * dy + nz * dz) / ((Math.hypot(nx, ny, nz) * Math.hypot(dx, dy, dz)) || 1));
      }
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const iw0 = 1 / sz[a]!, iw1 = 1 / sz[b]!, iw2 = 1 / sz[c]!;
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5, cy = py + 0.5;
          const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / area;
          const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const iz = w0 * iw0 + w1 * iw1 + w2 * iw2;
          const z = 1 / iz;
          const k = py * W + px;
          if (z >= depth[k]!) continue;
          depth[k] = z;
          if (uv) {
            const u = (w0 * uv[2 * a]! * iw0 + w1 * uv[2 * b]! * iw1 + w2 * uv[2 * c]! * iw2) / iz;
            const v = (w0 * uv[2 * a + 1]! * iw0 + w1 * uv[2 * b + 1]! * iw1 + w2 * uv[2 * c + 1]! * iw2) / iz;
            const tx = Math.min(atlas.width - 1, Math.max(0, Math.floor(u * atlas.width)));
            const ty = Math.min(atlas.height - 1, Math.max(0, Math.floor(v * atlas.height)));
            out.set(atlas.data.subarray(3 * (ty * atlas.width + tx), 3 * (ty * atlas.width + tx) + 3), 3 * k);
          } else {
            const g = Math.round(150 * shade);
            out[3 * k] = g;
            out[3 * k + 1] = g;
            out[3 * k + 2] = g;
          }
        }
      }
    }
  };
  if (body) draw(body.positions, body.indices, null);
  draw(render.positions, render.indices, render.uvs);
  return out;
}
