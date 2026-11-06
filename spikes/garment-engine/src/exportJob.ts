/**
 * Phase 0 job export for the GPU stages 2 and 4 (docs/ENGINE-HANDOFF.md, docs/research/garment-engine.md
 * shortlist A). For one product and the base-size mannequin shape it writes everything a Modal run
 * needs, so the GPU side never has to re-implement the mannequin or the camera path:
 *
 *   manifest.json            job manifest (product, photos by role, base size, chart, fabric, mannequin
 *                            version, seeds, pinned model versions, input_hash)
 *   mannequin.glb            the bare mannequin, metres, mannequin space
 *   cameras_opencv.json      per-frame K and world-to-camera (OpenCV)
 *   transforms.json          the same poses for Nerfstudio (OpenGL camera-to-world); `file_path`
 *                            points at frames/NNNN.png, which stage 2 fills
 *   control/depth_mm/        bare-mannequin depth per turntable frame, 16-bit PNG, mm, 0 = background
 *   control/depth_vis/       the same depth as the control video frames: 8-bit, near bright, 0 = background
 *   control/mask/            bare-mannequin silhouette, 8-bit 0/255
 *   motion/…                 the same three sequences for the motion clip from the fixed motion camera,
 *                            plus motion/cameras_opencv.json
 *   photos/                  merchant photos by role (front, back, detail_N), or synthetic dressed stills
 *   synthetic/               optional: the spike's synthetic garment rendered dressed along the same
 *                            path (rgb/, garment_mask/, transforms.json, garment_truth.glb), so stage 4
 *                            can be measured against a known mesh without any video model
 *
 * Everything is rendered with the spike's software rasterizer (`src/raster.ts`) and is deterministic:
 * the same inputs give byte-identical files and the same input_hash.
 */
import { createHash } from 'node:crypto';
import {
  BASE_SHAPE_ID,
  MANNEQUIN_VERSION,
  MOTION_CLIP,
  bodyShape,
  buildMannequin,
  buildMannequinMesh,
  motionCamera,
  poseMesh,
  sampleClip,
  skinWeights,
  turntablePath,
  writeGlb,
  type CameraFrame,
  type Mannequin,
  type Mesh,
} from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { generateGarment } from './garment';
import { encodePng } from './exportPng';
import { cameraBasis, opencvCamerasJson, transformsJson } from './exportPoses';
import { garmentChart, garmentSpec, materialJson, spikeProduct, type SPIKE_PRODUCT_IDS } from './product';
import { hexToRgb, render, type DrawItem, type Render } from './raster';
import { GARMENT_ID, MANNEQUIN_GREY, MANNEQUIN_ID } from './separation';

export const EXPORT_VERSION = 'phase0-export-0.1.0';
export const MANIFEST_FORMAT = 'curtain.phase0.job';

/**
 * Pinned model and code versions (handoff rule 5). The Modal apps pin the same values in
 * `modal/phase0_lib.py` and refuse a manifest whose pins differ. Revisions were read from the
 * Hugging Face API and the upstream git history on 2026-11-06. VideoX-Fun is pinned to the
 * 2025-09-18 commit (Wan2.2-Fun era), not to its 2026 head, whose package imports pull in model
 * families (Flux2, LTX2, Ministral3) that need much newer diffusers/transformers.
 */
export const PINNED_MODELS = {
  video: {
    id: 'alibaba-pai/Wan2.2-Fun-A14B-Control',
    revision: '297be6d520f54908e124be0298e2317ee50ffdf4',
    code_url: 'https://github.com/aigc-apps/VideoX-Fun',
    code_revision: '3e8d6867d3bff699bc85cd839f9802a5faa73aa3',
    licence: 'Apache-2.0',
  },
  recon: {
    id: 'gsplat',
    version: '1.5.3',
    code_url: 'https://github.com/nerfstudio-project/gsplat',
    code_revision: '937e29912570c372bed6747a5c9bf85fed877bae',
    method: '2dgs',
    mesher: 'open3d',
    mesher_version: '0.19.0',
    licence: 'Apache-2.0 (gsplat), MIT (Open3D)',
  },
} as const;

export const PHOTO_ROLES = ['front', 'back', 'detail'] as const;
export type PhotoRole = (typeof PHOTO_ROLES)[number];
export const MAX_DETAIL_PHOTOS = 4;

/** Studio background of the synthetic stills and frames (the rasterizer's chroma green is replaced). */
export const STUDIO_RGB: [number, number, number] = [235, 235, 235];

export interface PhotoInput {
  role: PhotoRole;
  bytes: Uint8Array;
  /** File extension without the dot: png, jpg, jpeg or webp. */
  ext: string;
  /** Where it came from (a file name); not hashed. */
  source: string;
}

export interface ExportOptions {
  productId: (typeof SPIKE_PRODUCT_IDS)[number];
  baseSize?: string;
  /** Frames per full turn (default 160: two 81-frame half-turn clips, the Wan2.2-Fun training length). */
  frames?: number;
  /** Frame size in pixels (default 480×832, Wan2.2's portrait 480p). */
  width?: number;
  height?: number;
  /** Frames and frame rate of the motion clip (default 81 at 16 fps, the first 5 s of the 6 s clip). */
  motionFrames?: number;
  fps?: number;
  /** Orbit radius of the fixed motion camera (default 520 cm: the raised arms stay inside a 480 px wide frame). */
  motionRadiusCm?: number;
  seeds?: { video: number; recon: number };
  /** Merchant photos by role. Front and back are required unless `syntheticPhotos` is set. */
  photos?: PhotoInput[];
  /** Render the spike's synthetic garment, dressed, at frame 0 and N/2 as front and back stills (marked synthetic). */
  syntheticPhotos?: boolean;
  /** Write the synthetic dressed turntable (default true). */
  synthetic?: boolean;
}

export const DEFAULT_SEEDS = { video: 43, recon: 7 } as const;

export interface ManifestPhoto {
  role: PhotoRole;
  path: string;
  sha256: string;
  synthetic: boolean;
  source: string;
}

export interface ManifestClip {
  id: string;
  kind: 'turntable' | 'motion';
  fps: number;
  /** Turntable: indices into the camera path, in order. Motion: 0…n−1 into motion/. */
  frame_indices: number[];
  control_dir: string;
  mask_dir: string;
  depth_mm_dir: string;
  /** Photo role pinned at the first and the last frame (turntable clips only). */
  first_photo: PhotoRole | null;
  last_photo: PhotoRole | null;
  /** Motion clip only: clip times (s) of each frame. */
  times_s?: number[];
}

export interface Phase0Manifest {
  format: typeof MANIFEST_FORMAT;
  format_version: 1;
  job_id: string;
  product_id: string;
  product_name: string;
  category: string;
  base_size: string;
  chart: { type: 'body' | 'garment'; unit: 'cm'; rows: { size: string; rings: Record<string, number>; default_ease: string[] }[] };
  fabric: ReturnType<typeof materialJson>;
  mannequin: { version: string; shape: string; glb: string; glb_sha256: string; unit: 'm'; stature_cm: number };
  photos: ManifestPhoto[];
  camera: {
    path_id: string;
    frames: number;
    width: number;
    height: number;
    fov_y_deg: number;
    radius_cm: number;
    height_cm: number;
    world: string;
    pixel_origin: 'corner';
    opencv: string;
    transforms: string;
    frames_dir: string;
  };
  control: { depth_mm_dir: string; depth_vis_dir: string; mask_dir: string; near_cm: number; far_cm: number; encoding: string };
  motion: { clip_id: string; radius_cm: number; camera: string; depth_mm_dir: string; depth_vis_dir: string; mask_dir: string; near_cm: number; far_cm: number };
  clips: ManifestClip[];
  synthetic: { dir: string; transforms: string; rgb_dir: string; garment_mask_dir: string; truth_glb: string; background_rgb: number[] } | null;
  seeds: { video: number; recon: number };
  models: typeof PINNED_MODELS;
  exporter: string;
  /** Exactly what input_hash covers (paths and timestamps are left out on purpose). */
  hash_inputs: Record<string, unknown>;
  input_hash: string;
}

/** JSON with sorted object keys and no whitespace; the Python side reproduces it with `json.dumps(sort_keys=True, separators=(',', ':'))`. */
export function canonicalJson(x: unknown): string {
  if (x === null || typeof x !== 'object') {
    if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('non-finite number in hashed input');
    return JSON.stringify(x);
  }
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

export const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

export function inputHash(hashInputs: Record<string, unknown>): string {
  return sha256(canonicalJson(hashInputs));
}

const pad4 = (i: number): string => String(i).padStart(4, '0');
const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

/** Turntable clips: two half turns that share the back frame, each `frames/2 + 1` long, front→back then back→front. */
export function turntableClips(frames: number): { id: string; frame_indices: number[]; first_photo: PhotoRole; last_photo: PhotoRole }[] {
  if (frames % 8 !== 0 || frames < 8) throw new Error(`frames per turn must be a positive multiple of 8 (Wan clips need 4k+1 frames), got ${frames}`);
  const half = frames / 2;
  return [
    { id: 'turntable_a', frame_indices: Array.from({ length: half + 1 }, (_, i) => i), first_photo: 'front', last_photo: 'back' },
    { id: 'turntable_b', frame_indices: Array.from({ length: half + 1 }, (_, i) => (half + i) % frames), first_photo: 'back', last_photo: 'front' },
  ];
}

/** Depth along the optical axis (cm) of every vertex seen from every frame: the fixed range of the 8-bit control encoding, padded by 1 cm. */
export function depthRange(positions: ArrayLike<number>, frames: readonly CameraFrame[]): { nearCm: number; farCm: number } {
  let near = Infinity, far = -Infinity;
  for (const f of frames) {
    const { forward } = cameraBasis(f);
    for (let v = 0; v < positions.length; v += 3) {
      const d = (positions[v]! - f.position[0]) * forward[0] + (positions[v + 1]! - f.position[1]) * forward[1] + (positions[v + 2]! - f.position[2]) * forward[2];
      if (d < near) near = d;
      if (d > far) far = d;
    }
  }
  return { nearCm: Math.floor(near) - 1, farCm: Math.ceil(far) + 1 };
}

export interface ControlFrame {
  depthMm: Uint16Array;
  depthVis: Uint8Array;
  mask: Uint8Array;
}

/** Throws when the silhouette touches the frame border: the control video would cut the mannequin off. */
export function assertInsideFrame(mask: Uint8Array, width: number, height: number, what: string): void {
  for (let x = 0; x < width; x++) if (mask[x] || mask[(height - 1) * width + x]) throw new Error(`${what}: the mannequin touches the top or bottom frame border`);
  for (let y = 0; y < height; y++) if (mask[y * width] || mask[y * width + width - 1]) throw new Error(`${what}: the mannequin touches the left or right frame border (raise the camera radius or the frame width)`);
}

/** Bare-mannequin control images of one rendered frame: metric depth (mm), the 8-bit control encoding (near = 255, far = 1, background 0) and the silhouette. */
export function controlFrame(r: Render, nearCm: number, farCm: number): ControlFrame {
  const n = r.width * r.height;
  const depthMm = new Uint16Array(n);
  const depthVis = new Uint8Array(n);
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (r.ids[k] !== MANNEQUIN_ID) continue;
    const d = r.depth[k]!;
    depthMm[k] = Math.min(65535, Math.round(d * 10));
    depthVis[k] = Math.max(1, Math.min(255, Math.round(1 + (254 * (farCm - d)) / (farCm - nearCm))));
    mask[k] = 255;
  }
  return { depthMm, depthVis, mask };
}

function studioRgb(r: Render): Uint8Array {
  const out = new Uint8Array(r.rgb.length);
  for (let k = 0; k < r.width * r.height; k++) {
    const bg = r.ids[k] === 0;
    out[3 * k] = bg ? STUDIO_RGB[0] : r.rgb[3 * k]!;
    out[3 * k + 1] = bg ? STUDIO_RGB[1] : r.rgb[3 * k + 1]!;
    out[3 * k + 2] = bg ? STUDIO_RGB[2] : r.rgb[3 * k + 2]!;
  }
  return out;
}

const grey = (width: number, height: number, data: ArrayLike<number>, bitDepth: 8 | 16 = 8): Uint8Array => encodePng({ width, height, channels: 1, bitDepth, data });
const rgbPng = (width: number, height: number, data: ArrayLike<number>): Uint8Array => encodePng({ width, height, channels: 3, bitDepth: 8, data });

/** Called once per output file, in a fixed order; `path` is relative to the job directory. */
export type Emit = (path: string, data: Uint8Array | string) => void;

export interface ExportResult {
  manifest: Phase0Manifest;
  files: number;
  bytes: number;
}

function photoSet(options: ExportOptions, frontStill: () => Uint8Array, backStill: () => Uint8Array): { photo: ManifestPhoto; bytes: Uint8Array }[] {
  const given = options.photos ?? [];
  for (const p of given) {
    if (!PHOTO_ROLES.includes(p.role)) throw new Error(`unknown photo role ${String(p.role)}`);
    if (!/^(png|jpe?g|webp)$/i.test(p.ext)) throw new Error(`photo ${p.source}: use png, jpg or webp, not ${p.ext}`);
  }
  const out: { photo: ManifestPhoto; bytes: Uint8Array }[] = [];
  for (const role of ['front', 'back'] as const) {
    const mine = given.filter((p) => p.role === role);
    if (mine.length > 1) throw new Error(`more than one ${role} photo`);
    if (mine[0] && options.syntheticPhotos) throw new Error(`a ${role} photo was given together with syntheticPhotos; pick one`);
    if (mine[0]) {
      const ext = mine[0].ext.toLowerCase().replace('jpeg', 'jpg');
      out.push({ photo: { role, path: `photos/${role}.${ext}`, sha256: sha256(mine[0].bytes), synthetic: false, source: mine[0].source }, bytes: mine[0].bytes });
    } else if (options.syntheticPhotos) {
      const bytes = role === 'front' ? frontStill() : backStill();
      out.push({ photo: { role, path: `photos/${role}.png`, sha256: sha256(bytes), synthetic: true, source: 'spike synthetic garment, software rasterizer' }, bytes });
    } else throw new Error(`a ${role} photo is required (handoff D13), or pass syntheticPhotos for a dry run`);
  }
  const details = given.filter((p) => p.role === 'detail');
  if (details.length > MAX_DETAIL_PHOTOS) throw new Error(`at most ${MAX_DETAIL_PHOTOS} detail photos, got ${details.length}`);
  details.forEach((p, i) => {
    const ext = p.ext.toLowerCase().replace('jpeg', 'jpg');
    out.push({ photo: { role: 'detail', path: `photos/detail_${i}.${ext}`, sha256: sha256(p.bytes), synthetic: false, source: p.source }, bytes: p.bytes });
  });
  return out;
}

/** Writes one Phase 0 job through `emit`. Deterministic. */
export function exportJob(options: ExportOptions, emit: Emit): ExportResult {
  const baseSize = options.baseSize ?? 'M';
  const framesPerTurn = options.frames ?? 160;
  const width = options.width ?? 480;
  const height = options.height ?? 832;
  const fps = options.fps ?? 16;
  const motionFrames = options.motionFrames ?? 81;
  const seeds = options.seeds ?? { ...DEFAULT_SEEDS };
  const withSynthetic = options.synthetic ?? true;
  if (width % 16 !== 0 || height % 16 !== 0) throw new Error(`frame size must be a multiple of 16 (VAE and patch size), got ${width}×${height}`);
  if ((motionFrames - 1) % 4 !== 0) throw new Error(`motion frames must be 4k+1, got ${motionFrames}`);
  if ((motionFrames - 1) / fps > MOTION_CLIP.durationS) throw new Error(`motion frames at ${fps} fps run past the ${MOTION_CLIP.durationS} s clip`);
  const clips = turntableClips(framesPerTurn);

  const payload: GarmentPayload = spikeProduct(options.productId);
  const chart = garmentChart(payload);
  const spec = garmentSpec(payload, baseSize);
  const mannequin: Mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
  const body: Mesh = buildMannequinMesh(mannequin);
  const path = turntablePath(mannequin, 'turntable_mid', { frames: framesPerTurn });
  const bareItem: DrawItem = { positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID };

  let garment: Mesh | null = null;
  const garmentItem = (): DrawItem => {
    garment ??= generateGarment(mannequin, spec);
    return { positions: garment.positions, indices: garment.indices, color: hexToRgb(spec.colorHex), id: GARMENT_ID };
  };
  const still = (frame: CameraFrame): Uint8Array => rgbPng(width, height, studioRgb(render([bareItem, garmentItem()], frame, width, height)));
  const photos = photoSet(options, () => still(path.frames[0]!), () => still(path.frames[framesPerTurn / 2]!));

  let files = 0, bytes = 0;
  const put: Emit = (p, data) => {
    files++;
    bytes += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    emit(p, data);
  };

  const mannequinGlb = writeGlb([{ name: 'mannequin', positions: body.positions, indices: body.indices, baseColor: [0.5, 0.5, 0.5, 1], roughness: 0.9 }], {
    scale: 0.01,
    generator: `@curtain/garment-spike ${EXPORT_VERSION}`,
    extras: { mannequinVersion: MANNEQUIN_VERSION, shape: BASE_SHAPE_ID, unit: 'm' },
  });
  put('mannequin.glb', mannequinGlb);
  for (const p of photos) put(p.photo.path, p.bytes);

  // Turntable control frames.
  const range = depthRange(body.positions, path.frames);
  for (const f of path.frames) {
    const c = controlFrame(render([bareItem], f, width, height), range.nearCm, range.farCm);
    assertInsideFrame(c.mask, width, height, `turntable frame ${f.index}`);
    put(`control/depth_mm/${pad4(f.index)}.png`, grey(width, height, c.depthMm, 16));
    put(`control/depth_vis/${pad4(f.index)}.png`, grey(width, height, c.depthVis));
    put(`control/mask/${pad4(f.index)}.png`, grey(width, height, c.mask));
  }
  put('cameras_opencv.json', json(opencvCamerasJson(path, width, height)));
  put('transforms.json', json(transformsJson(path, width, height, { image: (i) => `frames/${pad4(i)}.png` })));

  // Motion clip control frames from the fixed motion camera.
  const motionRadiusCm = options.motionRadiusCm ?? 520;
  const cam = motionCamera(mannequin, { radiusCm: motionRadiusCm });
  const skin = skinWeights(mannequin, body);
  const times = Array.from({ length: motionFrames }, (_, i) => i / fps);
  const posed = times.map((t) => poseMesh(mannequin, body, skin, sampleClip(MOTION_CLIP, t)));
  let mNear = Infinity, mFar = -Infinity;
  for (const pos of posed) {
    const r = depthRange(pos, [cam]);
    mNear = Math.min(mNear, r.nearCm);
    mFar = Math.max(mFar, r.farCm);
  }
  posed.forEach((pos, i) => {
    const c = controlFrame(render([{ ...bareItem, positions: pos }], cam, width, height), mNear, mFar);
    assertInsideFrame(c.mask, width, height, `motion frame ${i}`);
    put(`motion/depth_mm/${pad4(i)}.png`, grey(width, height, c.depthMm, 16));
    put(`motion/depth_vis/${pad4(i)}.png`, grey(width, height, c.depthVis));
    put(`motion/mask/${pad4(i)}.png`, grey(width, height, c.mask));
  });
  put('motion/cameras_opencv.json', json(opencvCamerasJson({ id: 'motion', frames: [cam] }, width, height)));

  // Synthetic dressed turntable: a known garment along the same path, for measuring stage 4 alone.
  if (withSynthetic) {
    const g = garmentItem();
    for (const f of path.frames) {
      const r = render([bareItem, g], f, width, height);
      const m = new Uint8Array(width * height);
      for (let k = 0; k < m.length; k++) m[k] = r.ids[k] === GARMENT_ID ? 255 : 0;
      put(`synthetic/rgb/${pad4(f.index)}.png`, rgbPng(width, height, studioRgb(r)));
      put(`synthetic/garment_mask/${pad4(f.index)}.png`, grey(width, height, m));
    }
    put('synthetic/transforms.json', json(transformsJson(path, width, height, { image: (i) => `rgb/${pad4(i)}.png`, mask: (i) => `garment_mask/${pad4(i)}.png` })));
    const color = hexToRgb(spec.colorHex);
    put('synthetic/garment_truth.glb', writeGlb([{ name: `${options.productId}-truth`, positions: g.positions, indices: g.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.85, doubleSided: true }], {
      scale: 0.01,
      generator: `@curtain/garment-spike ${EXPORT_VERSION}`,
      extras: { productId: options.productId, baseSize, unit: 'm', synthetic: true },
    }));
  }

  const hashInputs = {
    exporter: EXPORT_VERSION,
    product: payload,
    base_size: baseSize,
    mannequin: { version: MANNEQUIN_VERSION, shape: BASE_SHAPE_ID },
    camera: { path_id: path.id, frames: framesPerTurn, width, height, fov_y_deg: path.frames[0]!.fovYDeg, radius_cm: path.radiusCm },
    motion: { clip_id: MOTION_CLIP.id, frames: motionFrames, fps, radius_cm: motionRadiusCm },
    photos: photos.map((p) => ({ role: p.photo.role, sha256: p.photo.sha256, synthetic: p.photo.synthetic })),
    seeds,
    models: PINNED_MODELS,
    synthetic: withSynthetic,
  };
  const hash = inputHash(hashInputs);

  const manifest: Phase0Manifest = {
    format: MANIFEST_FORMAT,
    format_version: 1,
    job_id: `${options.productId}-${hash.slice(0, 12)}`,
    product_id: options.productId,
    product_name: payload.name,
    category: chart.category,
    base_size: baseSize,
    chart: { type: chart.type, unit: 'cm', rows: chart.rows.map((r) => ({ size: r.size, rings: r.rings as Record<string, number>, default_ease: r.defaultEase })) },
    fabric: materialJson(payload),
    mannequin: { version: MANNEQUIN_VERSION, shape: BASE_SHAPE_ID, glb: 'mannequin.glb', glb_sha256: sha256(mannequinGlb), unit: 'm', stature_cm: mannequin.statureCm },
    photos: photos.map((p) => p.photo),
    camera: {
      path_id: path.id,
      frames: framesPerTurn,
      width,
      height,
      fov_y_deg: path.frames[0]!.fovYDeg,
      radius_cm: path.radiusCm,
      height_cm: path.heightCm,
      world: 'mannequin space, metres: +Y up, +Z mannequin front, +X mannequin left',
      pixel_origin: 'corner',
      opencv: 'cameras_opencv.json',
      transforms: 'transforms.json',
      frames_dir: 'frames',
    },
    control: {
      depth_mm_dir: 'control/depth_mm',
      depth_vis_dir: 'control/depth_vis',
      mask_dir: 'control/mask',
      near_cm: range.nearCm,
      far_cm: range.farCm,
      encoding: 'depth_mm: uint16 mm, 0 = background; depth_vis: uint8, linear in depth, near_cm = 255, far_cm = 1, background 0; mask: 255 = mannequin',
    },
    motion: { clip_id: MOTION_CLIP.id, radius_cm: motionRadiusCm, camera: 'motion/cameras_opencv.json', depth_mm_dir: 'motion/depth_mm', depth_vis_dir: 'motion/depth_vis', mask_dir: 'motion/mask', near_cm: mNear, far_cm: mFar },
    clips: [
      ...clips.map((c) => ({ ...c, kind: 'turntable' as const, fps, control_dir: 'control/depth_vis', mask_dir: 'control/mask', depth_mm_dir: 'control/depth_mm' })),
      { id: 'motion', kind: 'motion', fps, frame_indices: times.map((_, i) => i), control_dir: 'motion/depth_vis', mask_dir: 'motion/mask', depth_mm_dir: 'motion/depth_mm', first_photo: 'front', last_photo: null, times_s: times.map((t) => Math.round(t * 1e6) / 1e6) },
    ],
    synthetic: withSynthetic
      ? { dir: 'synthetic', transforms: 'synthetic/transforms.json', rgb_dir: 'synthetic/rgb', garment_mask_dir: 'synthetic/garment_mask', truth_glb: 'synthetic/garment_truth.glb', background_rgb: [...STUDIO_RGB] }
      : null,
    seeds,
    models: PINNED_MODELS,
    exporter: `@curtain/garment-spike ${EXPORT_VERSION}`,
    hash_inputs: hashInputs,
    input_hash: hash,
  };
  put('manifest.json', json(manifest));
  return { manifest, files, bytes };
}
