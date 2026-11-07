/**
 * Phase 0 job export for the GPU stages 2 and 4 (docs/ENGINE-HANDOFF.md, docs/research/garment-engine.md
 * shortlist A). For one product and the base-size mannequin shape it writes everything a Modal run
 * needs, so the GPU side never has to re-implement the mannequin or the camera path:
 *
 *   manifest.json            job manifest (product, photos by role, base size, chart, fabric, mannequin
 *                            version, seeds, pinned model versions, input_hash)
 *   mannequin.glb            the bare mannequin, metres, mannequin space
 *   prediction.json          the P0 drape prediction (src/predict/, docs/PREDICTION-ENGINE.md §4.1): material
 *                            vector, pattern parameters with σ and provenance, route (always gpu); the proxy
 *                            takes its shape defaults from it. A shadow record: not in input_hash itself
 *   cameras_opencv.json      per-frame K and world-to-camera (OpenCV)
 *   transforms.json          the same poses for Nerfstudio (OpenGL camera-to-world); `file_path`
 *                            points at frames/NNNN.png, which stage 2 fills
 *   control/depth_mm/        control depth per turntable frame, 16-bit PNG, mm, 0 = background: the
 *                            mannequin WEARING the coarse proxy garment (`--control proxy`, default,
 *                            src/proxy.ts) or the bare mannequin (`--control bare`)
 *   control/depth_vis/       the same depth as the control video frames: 8-bit, near bright, 0 = background
 *   control/mask/            the control silhouette (mannequin + proxy), 8-bit 0/255
 *   control/bare_mask/       proxy only (since 0.3.0): the bare mannequin's full silhouette, not occluded
 *                            by the proxy; stage 2/4 segment the garment of a generated frame against it
 *   control/proxy_mask/      proxy only: where the proxy is visible (the garment zone stage 2's
 *                            consistency metric checks), 8-bit 0/255
 *   control/proxy.glb        proxy only: the proxy volume, metres (a control signal, never an output)
 *   motion/…                 the same three sequences for the motion clip from the fixed motion camera,
 *                            plus motion/cameras_opencv.json
 *   photos/                  merchant photos by role (front, back, detail_N), or synthetic dressed stills
 *   dress/                   only with `onModel`: the shop's source photos (garment on a person or
 *                            flat-lay) and the bare mannequin rendered at frame 0 and N/2 (RGB and
 *                            silhouette), the inputs of stage 1b (modal/stage1_dress.py), which writes
 *                            the pinned stills to stage1b/
 *   synthetic/               optional: the spike's synthetic garment rendered dressed along the same
 *                            path (rgb/, garment_mask/, transforms.json, garment_truth.glb), so stage 4
 *                            can be measured against a known mesh without any video model
 *
 * The manifest also carries the stage 2 prompts (`prompt`): a neutral garment description from fixed
 * vocabulary (category, colour, length, sleeves, fabric), never the product title or brand, and a
 * negative prompt against text, logos and the wrong garment (`videoPrompt` in src/product.ts).
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
  type SkinWeights,
  skinWeights,
  turntablePath,
  writeGlb,
  type CameraFrame,
  type Mannequin,
  type Mesh,
} from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { evalChart } from './evalChart';
import { generateGarment } from './garment';
import { encodePng } from './exportPng';
import { cameraBasis, opencvCamerasJson, transformsJson } from './exportPoses';
import { garmentSpec, materialJson, resolveSpikeProduct, videoPrompt, type ProductSource, type ResolvedProduct, type VideoPrompt } from './product';
import { CONTROL_MODES, buildProxy, proxyRecord, proxySpec, syntheticGarmentFromProxy, type ControlMode, type Proxy, type ProxyOptions } from './proxy';
import type { GarmentFeatures } from './features';
import { PREDICTOR_VERSION, predict, withSyntheticLength, type Prediction } from './predict';
import { hexToRgb, render, type DrawItem, type Render } from './raster';
import { GARMENT_ID, MANNEQUIN_GREY, MANNEQUIN_ID } from './separation';

/**
 * 0.2.0: control proxy (`control.mode`), neutral prompts (`prompt`), shop products (`product_source`); all three are hashed.
 * 0.3.0: the bare mannequin's silhouette per frame (`control.bare_mask_dir`, `motion.bare_mask_dir`), no still pinned in the
 * motion clip, and with synthetic stills the proxy takes the synthetic garment's length (`length_source: "synthetic stills: …"`).
 * 0.4.0: stage 1b dresses the PROXY-DRESSED mannequin (run 12: FASHN dressed the bare mannequin's two separate legs as a
 * romper). Per view `dress/proxy_<view>.png` (our mannequin wearing the control proxy in a flat neutral material,
 * `STAGE1B_PROXY_RGB`) and `dress/proxy_mask_<view>.png` (the visible proxy), built in every control mode; hashed as
 * `stage1b.target`.
 * 0.5.0 (after run 13): the prompt colour never comes from a word of the product name (`neutral-prompt-0.2.0`; run 13's Qwen
 * engine painted the "Azure Palm" pastel print as a solid blue dress); with no primaryColorHex the description names no
 * colour, and stage 1b measures one from the garment cut-out. The synthetic garment of such a product is the fallback colour.
 * 0.6.0 (categories): the product's garment features (`features.ts`: sleeve style, front closure, neckline from the shop
 * description) reach the proxy (control-proxy-0.3.0: sleeve shells from a sleeve style, an outerwear front opening) and the
 * prompt (neutral-prompt-0.3.0), and are hashed and written to the manifest (`features`); the synthetic garment (stage 4
 * truth, synthetic stills) exists for every kind: skirt, trousers and outerwear use `syntheticGarmentFromProxy`; a shop
 * product may be exported with synthetic stills (a dry run without stage 1b).
 * The version is hashed, so a re-export changes the job id (run 11a's `aalter-studio-2-28080a938e84` was 0.2.0).
 */
export const EXPORT_VERSION = 'phase0-export-0.6.0';
/** Id of the control proxy in the rasterizer's id buffer. */
export const PROXY_ID = 3;
/** Albedo of the proxy where it is rendered for a picture (the control frames only use depth and ids). */
const PROXY_GREY: [number, number, number] = [0.62, 0.62, 0.62];
/**
 * Albedo of the proxy in the stage 1b target render (`dress/proxy_<view>.png`): a flat, untextured warm neutral, so
 * the try-on model reads it as one closed garment volume to replace, and it differs from the grey mannequin (0.5)
 * and the studio background (235) by colour, so stage 1b can tell proxy left-overs from both.
 */
export const STAGE1B_PROXY_RGB: [number, number, number] = [0.72, 0.68, 0.62];
/**
 * Synthetic garment colour when the product has no primaryColorHex (shop drafts). Since 0.5.0 never a colour from the
 * product name (a print or collection name: "Azure Palm" is a cream print, not blue).
 */
const FALLBACK_GARMENT_HEX = '#7a5c8a';
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

/** What a stage 1b source photo shows: the garment worn by a person, or laid flat / on a ghost mannequin. */
export const SOURCE_KINDS = ['on_model', 'flat_lay'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Where stage 1b (modal/stage1_dress.py) writes the dressed stills that stage 2 pins at frame 0 and N/2. */
export const STAGE1B_DIR = 'stage1b';
/** The P0 drape prediction of the job (docs/PREDICTION-ENGINE.md §4.1). */
export const PREDICTION_FILE = 'prediction.json';

export interface OnModelOptions {
  /** Default `on_model`. */
  kind?: SourceKind;
}

export interface ExportOptions {
  /** A spike product id (`SPIKE_PRODUCT_IDS`), or the id of `product`. */
  productId: string;
  /** The product (a shop draft from `shopProduct`); default: the spike fixture `productId`. */
  product?: ResolvedProduct;
  /** Base size; default the product's (spike: M, shop: products.json). */
  baseSize?: string;
  /** Control video: the mannequin wearing the coarse proxy garment (default) or the bare mannequin. */
  control?: ControlMode;
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
  /**
   * The front (required) and back (optional) photos are shop photos of the garment on a person or
   * flat-lay, not stills on our mannequin. They go to dress/ as stage 1b inputs, with the bare mannequin
   * rendered at frame 0 and N/2, and the manifest's front and back point at stage1b/front.png and
   * stage1b/back.png, which stage 1b must produce before stage 2 runs. Without a back photo, stage 1b
   * generates the back and the manifest marks it `invented: true` (validation runs only: D13 says the
   * merchant owns the back).
   */
  onModel?: OnModelOptions | boolean;
  /** Write the synthetic dressed turntable (default true; dresses and tops are lofted (`garment.ts`), skirts, trousers and outerwear come from the proxy's surfaces (`syntheticGarmentFromProxy`)). */
  synthetic?: boolean;
}

export const DEFAULT_SEEDS = { video: 43, recon: 7 } as const;

export interface ManifestPhoto {
  role: PhotoRole;
  path: string;
  /** null for a still that stage 1b has not produced yet (`produced_by: 'stage1b'`). */
  sha256: string | null;
  synthetic: boolean;
  source: string;
  /** Set when the still is produced by a later stage, not supplied: stage 1b dresses our mannequin from a shop photo. */
  produced_by?: typeof STAGE1B_DIR;
  /** Stage 1b only: no back photo was given, so the back still is generated (D13: never for a published asset). */
  invented?: boolean;
}

/** `manifest.control.proxy`: the proxy spec as `proxyRecord` writes it, plus its file. */
export type ManifestProxy = Record<string, unknown> & { glb: string; glb_sha256: string };

export interface Stage1bView {
  view: 'front' | 'back';
  /** Turntable frame the still is pinned at (0 or N/2), so its camera is cameras_opencv.json frame `frame`. */
  frame: number;
  /** Shop photo for this view, or null (back only: the back is then invented from the front). */
  source: string | null;
  /** Bare mannequin at this frame: studio RGB and the silhouette (255 = mannequin), whatever the control mode. */
  bare_rgb: string;
  bare_mask: string;
  /**
   * Since 0.4.0: our mannequin wearing the control proxy (flat neutral `STAGE1B_PROXY_RGB`) at this frame, the image
   * stage 1b dresses, and the visible proxy (255). Stage 1b lets the model change only the proxy region dilated by a
   * category margin and compares the dressed still's silhouette with the proxy's.
   */
  proxy_rgb: string;
  proxy_mask: string;
  /** Outputs stage 1b writes. */
  still: string;
  garment_mask: string;
  invented: boolean;
}

export interface Stage1bSpec {
  dir: typeof STAGE1B_DIR;
  source_kind: SourceKind;
  sources: { role: 'front' | 'back'; path: string; sha256: string; source: string }[];
  views: Stage1bView[];
  invented_back: boolean;
  background_rgb: number[];
  /** What stage 1b dresses (0.4.0): the proxy-dressed mannequin; the proxy's kind and the flat material's albedo. */
  target: { kind: 'proxy_dressed'; proxy_kind: string; proxy_glb_sha256: string; proxy_rgb: number[] };
  record: string;
  note: string;
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
  /** Where the proxy is visible per frame (control mode proxy), else null. */
  proxy_mask_dir: string | null;
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
  product_source: ProductSource;
  /** Sleeve style, front closure and neckline from the shop description (null: none, e.g. the spike fixtures). Hashed. */
  features: GarmentFeatures | null;
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
  control: {
    /** `proxy`: the mannequin wearing the coarse proxy garment; `bare`: the bare mannequin. */
    mode: ControlMode;
    proxy: ManifestProxy | null;
    depth_mm_dir: string;
    depth_vis_dir: string;
    mask_dir: string;
    proxy_mask_dir: string | null;
    /** Proxy mode: the bare mannequin's full silhouette per frame (control/mask holds mannequin + proxy). Bare mode: null (control/mask is it). */
    bare_mask_dir: string | null;
    near_cm: number;
    far_cm: number;
    encoding: string;
  };
  motion: { clip_id: string; radius_cm: number; camera: string; depth_mm_dir: string; depth_vis_dir: string; mask_dir: string; proxy_mask_dir: string | null; bare_mask_dir: string | null; near_cm: number; far_cm: number };
  /** Stage 2 prompts (hashed): neutral description, never the product title or brand. */
  prompt: VideoPrompt;
  clips: ManifestClip[];
  synthetic: { dir: string; transforms: string; rgb_dir: string; garment_mask_dir: string; truth_glb: string; background_rgb: number[] } | null;
  /** Stage 1b inputs and outputs when the front/back are shop photos (`onModel`), else null. */
  stage1b: Stage1bSpec | null;
  seeds: { video: number; recon: number };
  models: typeof PINNED_MODELS;
  exporter: string;
  /** The P0 shadow prediction (prediction.json). Not in hash_inputs: what of it shapes the control is hashed through `control.proxy`. */
  prediction?: { file: string; sha256: string; predictor_version: string; hashed: false };
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

/**
 * Control images of one rendered frame (bare mannequin, or mannequin + proxy): metric depth (mm),
 * the 8-bit control encoding (near = 255, far = 1, background 0) and the silhouette of everything drawn.
 */
export function controlFrame(r: Render, nearCm: number, farCm: number): ControlFrame {
  const n = r.width * r.height;
  const depthMm = new Uint16Array(n);
  const depthVis = new Uint8Array(n);
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (r.ids[k] === 0) continue;
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

/** 255 where the render shows object `id`. */
export function idMask(r: Render, id: number): Uint8Array {
  const m = new Uint8Array(r.width * r.height);
  for (let k = 0; k < m.length; k++) m[k] = r.ids[k] === id ? 255 : 0;
  return m;
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

const photoExt = (ext: string): string => ext.toLowerCase().replace('jpeg', 'jpg');

/** The on-model (stage 1b) source photos: front required, back optional; detail photos are handled by photoSet. */
function stage1bSources(options: ExportOptions): { role: 'front' | 'back'; path: string; sha256: string; source: string; bytes: Uint8Array }[] {
  const given = options.photos ?? [];
  if (options.syntheticPhotos) throw new Error('onModel and syntheticPhotos exclude each other: stage 1b dresses shop photos, the synthetic stills are already dressed');
  const out: { role: 'front' | 'back'; path: string; sha256: string; source: string; bytes: Uint8Array }[] = [];
  for (const role of ['front', 'back'] as const) {
    const mine = given.filter((p) => p.role === role);
    if (mine.length > 1) throw new Error(`more than one ${role} photo`);
    if (!mine[0]) {
      if (role === 'front') throw new Error('onModel needs a front photo (the shop photo stage 1b dresses our mannequin from)');
      continue;
    }
    out.push({ role, path: `dress/source_${role}.${photoExt(mine[0].ext)}`, sha256: sha256(mine[0].bytes), source: mine[0].source, bytes: mine[0].bytes });
  }
  return out;
}

function photoSet(options: ExportOptions, frontStill: () => Uint8Array, backStill: () => Uint8Array): { photo: ManifestPhoto; bytes: Uint8Array | null }[] {
  const given = options.photos ?? [];
  for (const p of given) {
    if (!PHOTO_ROLES.includes(p.role)) throw new Error(`unknown photo role ${String(p.role)}`);
    if (!/^(png|jpe?g|webp)$/i.test(p.ext)) throw new Error(`photo ${p.source}: use png, jpg or webp, not ${p.ext}`);
  }
  const out: { photo: ManifestPhoto; bytes: Uint8Array | null }[] = [];
  if (options.onModel) {
    const sources = stage1bSources(options);
    for (const role of ['front', 'back'] as const) {
      const src = sources.find((s) => s.role === role);
      out.push({
        photo: {
          role,
          path: `${STAGE1B_DIR}/${role}.png`,
          sha256: null,
          synthetic: false,
          source: src ? `stage 1b: dressed on our mannequin from ${src.source}` : 'stage 1b: INVENTED from the front photo (no back photo given; validation only, D13)',
          produced_by: STAGE1B_DIR,
          invented: !src,
        },
        bytes: null,
      });
    }
  }
  for (const role of options.onModel ? ([] as const) : (['front', 'back'] as const)) {
    const mine = given.filter((p) => p.role === role);
    if (mine.length > 1) throw new Error(`more than one ${role} photo`);
    if (mine[0] && options.syntheticPhotos) throw new Error(`a ${role} photo was given together with syntheticPhotos; pick one`);
    if (mine[0]) {
      const ext = photoExt(mine[0].ext);
      out.push({ photo: { role, path: `photos/${role}.${ext}`, sha256: sha256(mine[0].bytes), synthetic: false, source: mine[0].source }, bytes: mine[0].bytes });
    } else if (options.syntheticPhotos) {
      const bytes = role === 'front' ? frontStill() : backStill();
      out.push({ photo: { role, path: `photos/${role}.png`, sha256: sha256(bytes), synthetic: true, source: 'spike synthetic garment, software rasterizer' }, bytes });
    } else throw new Error(`a ${role} photo is required (handoff D13), or pass syntheticPhotos for a dry run`);
  }
  const details = given.filter((p) => p.role === 'detail');
  if (details.length > MAX_DETAIL_PHOTOS) throw new Error(`at most ${MAX_DETAIL_PHOTOS} detail photos, got ${details.length}`);
  details.forEach((p, i) => {
    const ext = photoExt(p.ext);
    out.push({ photo: { role: 'detail', path: `photos/detail_${i}.${ext}`, sha256: sha256(p.bytes), synthetic: false, source: p.source }, bytes: p.bytes });
  });
  return out;
}

/** Writes one Phase 0 job through `emit`. Deterministic. */
export function exportJob(options: ExportOptions, emit: Emit): ExportResult {
  const product = options.product ?? resolveSpikeProduct(options.productId, options.baseSize);
  if (product.id !== options.productId) throw new Error(`productId ${options.productId} differs from the product's id ${product.id}`);
  const baseSize = options.baseSize ?? product.baseSize;
  const control: ControlMode = options.control ?? 'proxy';
  if (!CONTROL_MODES.includes(control)) throw new Error(`unknown control mode ${String(control)}; use ${CONTROL_MODES.join(' or ')}`);
  const framesPerTurn = options.frames ?? 160;
  const width = options.width ?? 480;
  const height = options.height ?? 832;
  const fps = options.fps ?? 16;
  const motionFrames = options.motionFrames ?? 81;
  const seeds = options.seeds ?? { ...DEFAULT_SEEDS };
  if (width % 16 !== 0 || height % 16 !== 0) throw new Error(`frame size must be a multiple of 16 (VAE and patch size), got ${width}×${height}`);
  if ((motionFrames - 1) % 4 !== 0) throw new Error(`motion frames must be 4k+1, got ${motionFrames}`);
  if ((motionFrames - 1) / fps > MOTION_CLIP.durationS) throw new Error(`motion frames at ${fps} fps run past the ${MOTION_CLIP.durationS} s clip`);
  const clips = turntableClips(framesPerTurn);

  const payload: GarmentPayload = product.payload;
  const chart = evalChart(payload);
  // The synthetic garment (stage 4 truth, synthetic stills): lofted for dresses and tops, the proxy's opened surfaces for the other kinds.
  const lofted = payload.category === 'dress' || payload.category === 'top';
  const withSynthetic = options.synthetic ?? true;
  const features = product.features ?? null;
  const mannequin: Mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
  const body: Mesh = buildMannequinMesh(mannequin);
  const path = turntablePath(mannequin, 'turntable_mid', { frames: framesPerTurn });
  const bareItem: DrawItem = { positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID };

  // Control proxy: the mannequin wears a coarse closed garment volume in the control video (src/proxy.ts).
  // With synthetic stills the pinned frames show the synthetic garment, so the proxy's hem is that
  // garment's (a product without shoulder_to_hem would otherwise get the proxy's own default length).
  // The P0 drape prediction (src/predict/): the proxy's shape defaults come from it, and it is written as prediction.json
  // (a shadow prediction, scored against stage 4t by `predict:log`). Not hashed on its own: everything of it that shapes
  // the control (hem flare, legs, default ease, length and sleeve rules, front opening) is hashed through the proxy record
  // and glb below; its material vector, σ and route drive nothing yet (docs/PREDICTION-ENGINE.md "P0 status").
  let prediction: Prediction = predict({ id: product.id, payload, baseSize, features, source: product.source });
  if (options.syntheticPhotos && lofted) {
    // Always the override: the synthetic garment drops its length vertically, while a printed length is flat-lay (proxy 0.2.0).
    // It goes into the prediction (provenance `synthetic`), so prediction.json is the shape the control and the template had.
    const synth = garmentSpec(payload, baseSize).shoulderToHemCm;
    prediction = withSyntheticLength(prediction, synth, `synthetic stills: the synthetic garment's shoulder_to_hem ${synth} cm (vertical drop)`);
  }
  const proxyOpts: ProxyOptions = { ...(features ? { features } : {}), prediction };
  const pSpec = proxySpec(mannequin, payload, baseSize, proxyOpts);
  const proxy: Proxy | null = control === 'proxy' ? buildProxy(mannequin, payload, baseSize, proxyOpts) : null;
  const proxyItem: DrawItem | null = proxy ? { positions: proxy.mesh.positions, indices: proxy.mesh.indices, color: PROXY_GREY, id: PROXY_ID } : null;
  // Stage 1b dresses the mannequin WEARING the proxy (same proxy as the control), in every control mode.
  const dressProxy: Proxy | null = options.onModel ? (proxy ?? buildProxy(mannequin, payload, baseSize, proxyOpts)) : null;
  const controlItems: DrawItem[] = proxyItem ? [bareItem, proxyItem] : [bareItem];
  const prompt = videoPrompt(mannequin, payload, pSpec);

  let garment: Mesh | null = null;
  let garmentColor: [number, number, number] = [0, 0, 0];
  const garmentItem = (): DrawItem => {
    if (!garment) {
      const hex = (payload.primaryColorHex as string | undefined) ?? FALLBACK_GARMENT_HEX;
      if (lofted) {
        const spec = garmentSpec(payload, baseSize);
        spec.colorHex = hex;
        // A sleeve style from the features (no printed sleeve length): the synthetic garment's sleeves are the proxy's.
        if (pSpec.sleeveStyle) spec.sleeveCm = pSpec.sleeveCm;
        garment = generateGarment(mannequin, spec);
      } else garment = syntheticGarmentFromProxy(mannequin, payload, baseSize, proxyOpts);
      garmentColor = hexToRgb(hex);
    }
    return { positions: garment.positions, indices: garment.indices, color: garmentColor, id: GARMENT_ID };
  };
  const still = (frame: CameraFrame): Uint8Array => rgbPng(width, height, studioRgb(render([bareItem, garmentItem()], frame, width, height)));
  const photos = photoSet(options, () => still(path.frames[0]!), () => still(path.frames[framesPerTurn / 2]!));
  const onModel = options.onModel ? { kind: (typeof options.onModel === 'object' ? options.onModel.kind : undefined) ?? 'on_model' } : null;
  if (onModel && !SOURCE_KINDS.includes(onModel.kind)) throw new Error(`unknown source kind ${String(onModel.kind)}; use ${SOURCE_KINDS.join(' or ')}`);
  const sources = onModel ? stage1bSources(options) : [];

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
  const predictionJson = json(prediction);
  put(PREDICTION_FILE, predictionJson);
  for (const p of photos) if (p.bytes) put(p.photo.path, p.bytes);

  // Stage 1b inputs: the shop photos and the bare mannequin at the two pinned frames (same camera, same
  // light as the turntable). The silhouette is the BARE mannequin's in every control mode: stage 1b's
  // alignment QA compares the dressed still with our mannequin, not with the proxy.
  let stage1b: Stage1bSpec | null = null;
  if (onModel) {
    for (const s of sources) put(s.path, s.bytes);
    const views: Stage1bView[] = (['front', 'back'] as const).map((view) => {
      const frame = view === 'front' ? 0 : framesPerTurn / 2;
      const bare = `dress/bare_${view}.png`;
      const bareMask = `dress/bare_mask_${view}.png`;
      const r = render([bareItem], path.frames[frame]!, width, height);
      put(bare, rgbPng(width, height, studioRgb(r)));
      put(bareMask, grey(width, height, idMask(r, MANNEQUIN_ID)));
      const proxyRgb = `dress/proxy_${view}.png`;
      const proxyMask = `dress/proxy_mask_${view}.png`;
      const dp = dressProxy!;
      const rp = render([bareItem, { positions: dp.mesh.positions, indices: dp.mesh.indices, color: STAGE1B_PROXY_RGB, id: PROXY_ID }], path.frames[frame]!, width, height);
      put(proxyRgb, rgbPng(width, height, studioRgb(rp)));
      put(proxyMask, grey(width, height, idMask(rp, PROXY_ID)));
      const src = sources.find((s) => s.role === view);
      return {
        view,
        frame,
        source: src ? src.path : null,
        bare_rgb: bare,
        bare_mask: bareMask,
        proxy_rgb: proxyRgb,
        proxy_mask: proxyMask,
        still: `${STAGE1B_DIR}/${view}.png`,
        garment_mask: `${STAGE1B_DIR}/garment_mask_${view}.png`,
        invented: !src,
      };
    });
    const inventedBack = !sources.some((s) => s.role === 'back');
    stage1b = {
      dir: STAGE1B_DIR,
      source_kind: onModel.kind,
      sources: sources.map(({ role, path: p, sha256: h, source }) => ({ role, path: p, sha256: h, source })),
      views,
      invented_back: inventedBack,
      background_rgb: [...STUDIO_RGB],
      target: { kind: 'proxy_dressed', proxy_kind: dressProxy!.spec.kind, proxy_glb_sha256: sha256(proxyGlbBytes(dressProxy!, product.id, baseSize)), proxy_rgb: [...STAGE1B_PROXY_RGB] },
      record: `${STAGE1B_DIR}/record.json`,
      note:
        'Validation input: shop photos dressed onto our mannequin by stage 1b (generated, an estimate). ' +
        (inventedBack ? 'The back still is INVENTED (no back photo); D13 forbids this for a published asset. ' : '') +
        'Shop photos and outputs stay out of git.',
    };
  }

  // Control proxy file (inspection only; the frames below are what stage 2 reads).
  let manifestProxy: ManifestProxy | null = null;
  if (proxy) {
    const glb = proxyGlbBytes(proxy, product.id, baseSize);
    put('control/proxy.glb', glb);
    manifestProxy = { ...proxyRecord(proxy.spec), glb: 'control/proxy.glb', glb_sha256: sha256(glb) };
  }

  // Turntable control frames.
  const range = depthRange(proxy ? concat(body.positions, proxy.mesh.positions) : body.positions, path.frames);
  for (const f of path.frames) {
    const r = render(controlItems, f, width, height);
    const c = controlFrame(r, range.nearCm, range.farCm);
    assertInsideFrame(c.mask, width, height, `turntable frame ${f.index}`);
    put(`control/depth_mm/${pad4(f.index)}.png`, grey(width, height, c.depthMm, 16));
    put(`control/depth_vis/${pad4(f.index)}.png`, grey(width, height, c.depthVis));
    put(`control/mask/${pad4(f.index)}.png`, grey(width, height, c.mask));
    if (proxy) {
      put(`control/proxy_mask/${pad4(f.index)}.png`, grey(width, height, idMask(r, PROXY_ID)));
      // The bare mannequin's full silhouette (not occluded by the proxy): stage 2/4 segment the garment
      // of a generated frame against it (modal/phase0_garment.py).
      put(`control/bare_mask/${pad4(f.index)}.png`, grey(width, height, idMask(render([bareItem], f, width, height), MANNEQUIN_ID)));
    }
  }
  put('cameras_opencv.json', json(opencvCamerasJson(path, width, height)));
  put('transforms.json', json(transformsJson(path, width, height, { image: (i) => `frames/${pad4(i)}.png` })));

  // Motion clip control frames from the fixed motion camera; the proxy is posed with the same rig
  // (its parts are named body / leg_* / sleeve_*, so `skinWeights` binds them to the torso, legs and arms).
  const motionRadiusCm = options.motionRadiusCm ?? 520;
  const cam = motionCamera(mannequin, { radiusCm: motionRadiusCm });
  const skin = skinWeights(mannequin, body);
  const proxySkin: SkinWeights | null = proxy ? skinWeights(mannequin, proxy.mesh) : null;
  const times = Array.from({ length: motionFrames }, (_, i) => i / fps);
  const posed = times.map((t) => {
    const pose = sampleClip(MOTION_CLIP, t);
    return { body: poseMesh(mannequin, body, skin, pose), proxy: proxy && proxySkin ? poseMesh(mannequin, proxy.mesh, proxySkin, pose) : null };
  });
  let mNear = Infinity, mFar = -Infinity;
  for (const pos of posed) {
    const r = depthRange(pos.proxy ? concat(pos.body, pos.proxy) : pos.body, [cam]);
    mNear = Math.min(mNear, r.nearCm);
    mFar = Math.max(mFar, r.farCm);
  }
  posed.forEach((pos, i) => {
    const items: DrawItem[] = [{ ...bareItem, positions: pos.body }, ...(proxyItem && pos.proxy ? [{ ...proxyItem, positions: pos.proxy }] : [])];
    const r = render(items, cam, width, height);
    const c = controlFrame(r, mNear, mFar);
    assertInsideFrame(c.mask, width, height, `motion frame ${i}`);
    put(`motion/depth_mm/${pad4(i)}.png`, grey(width, height, c.depthMm, 16));
    put(`motion/depth_vis/${pad4(i)}.png`, grey(width, height, c.depthVis));
    put(`motion/mask/${pad4(i)}.png`, grey(width, height, c.mask));
    if (proxy) {
      put(`motion/proxy_mask/${pad4(i)}.png`, grey(width, height, idMask(r, PROXY_ID)));
      put(`motion/bare_mask/${pad4(i)}.png`, grey(width, height, idMask(render([{ ...bareItem, positions: pos.body }], cam, width, height), MANNEQUIN_ID)));
    }
  });
  put('motion/cameras_opencv.json', json(opencvCamerasJson({ id: 'motion', frames: [cam] }, width, height)));

  // Synthetic dressed turntable: a known garment along the same path, for measuring stage 4 alone.
  if (withSynthetic) {
    const g = garmentItem();
    for (const f of path.frames) {
      const r = render([bareItem, g], f, width, height);
      put(`synthetic/rgb/${pad4(f.index)}.png`, rgbPng(width, height, studioRgb(r)));
      put(`synthetic/garment_mask/${pad4(f.index)}.png`, grey(width, height, idMask(r, GARMENT_ID)));
    }
    put('synthetic/transforms.json', json(transformsJson(path, width, height, { image: (i) => `rgb/${pad4(i)}.png`, mask: (i) => `garment_mask/${pad4(i)}.png` })));
    const color = g.color;
    put('synthetic/garment_truth.glb', writeGlb([{ name: `${product.id}-truth`, positions: g.positions, indices: g.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.85, doubleSided: true }], {
      scale: 0.01,
      generator: `@curtain/garment-spike ${EXPORT_VERSION}`,
      extras: { productId: product.id, baseSize, unit: 'm', synthetic: true },
    }));
  }

  // The spec AND the geometry: a change to the proxy mesh code (bodyShell, legSection, clearances)
  // changes the control frames, so it must change input_hash and the job id even without a
  // PROXY_VERSION bump, or cached stage 2 outputs would be reused against different control frames.
  const proxyHashed = manifestProxy ? { ...proxyRecord(proxy!.spec), glb_sha256: manifestProxy.glb_sha256 } : null;
  const hashInputs = {
    exporter: EXPORT_VERSION,
    product: payload,
    features: features ?? undefined,
    base_size: baseSize,
    mannequin: { version: MANNEQUIN_VERSION, shape: BASE_SHAPE_ID },
    camera: { path_id: path.id, frames: framesPerTurn, width, height, fov_y_deg: path.frames[0]!.fovYDeg, radius_cm: path.radiusCm },
    motion: { clip_id: MOTION_CLIP.id, frames: motionFrames, fps, radius_cm: motionRadiusCm },
    photos: onModel
      ? [...sources.map((s) => ({ role: s.role, sha256: s.sha256, synthetic: false })), ...photos.filter((p) => p.photo.role === 'detail').map((p) => ({ role: p.photo.role, sha256: p.photo.sha256, synthetic: false }))]
      : photos.map((p) => ({ role: p.photo.role, sha256: p.photo.sha256, synthetic: p.photo.synthetic })),
    // Absent (undefined, so not hashed) unless onModel.
    stage1b: onModel ? { source_kind: onModel.kind, invented_back: stage1b!.invented_back, target: stage1b!.target } : undefined,
    control: { mode: control, proxy: proxyHashed },
    prompt,
    seeds,
    models: PINNED_MODELS,
    synthetic: withSynthetic,
  };
  const hash = inputHash(hashInputs);

  const proxyMaskDir = proxy ? 'control/proxy_mask' : null;
  const manifest: Phase0Manifest = {
    format: MANIFEST_FORMAT,
    format_version: 1,
    job_id: `${product.id}-${hash.slice(0, 12)}`,
    product_id: product.id,
    product_name: payload.name,
    category: chart.category,
    product_source: product.source,
    features,
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
      mode: control,
      proxy: manifestProxy,
      depth_mm_dir: 'control/depth_mm',
      depth_vis_dir: 'control/depth_vis',
      mask_dir: 'control/mask',
      proxy_mask_dir: proxyMaskDir,
      bare_mask_dir: proxy ? 'control/bare_mask' : null,
      near_cm: range.nearCm,
      far_cm: range.farCm,
      encoding:
        `${control === 'proxy' ? 'mannequin wearing the coarse proxy garment (control signal only, never an output)' : 'bare mannequin'}; ` +
        'depth_mm: uint16 mm, 0 = background; depth_vis: uint8, linear in depth, near_cm = 255, far_cm = 1, background 0; mask: 255 = mannequin or proxy; proxy_mask: 255 = proxy visible',
    },
    motion: { clip_id: MOTION_CLIP.id, radius_cm: motionRadiusCm, camera: 'motion/cameras_opencv.json', depth_mm_dir: 'motion/depth_mm', depth_vis_dir: 'motion/depth_vis', mask_dir: 'motion/mask', proxy_mask_dir: proxy ? 'motion/proxy_mask' : null, bare_mask_dir: proxy ? 'motion/bare_mask' : null, near_cm: mNear, far_cm: mFar },
    prompt,
    clips: [
      ...clips.map((c) => ({ ...c, kind: 'turntable' as const, fps, control_dir: 'control/depth_vis', mask_dir: 'control/mask', depth_mm_dir: 'control/depth_mm', proxy_mask_dir: proxyMaskDir })),
      { id: 'motion', kind: 'motion', fps, frame_indices: times.map((_, i) => i), control_dir: 'motion/depth_vis', mask_dir: 'motion/mask', depth_mm_dir: 'motion/depth_mm', proxy_mask_dir: proxy ? 'motion/proxy_mask' : null, first_photo: null, last_photo: null, times_s: times.map((t) => Math.round(t * 1e6) / 1e6) },
    ],
    synthetic: withSynthetic
      ? { dir: 'synthetic', transforms: 'synthetic/transforms.json', rgb_dir: 'synthetic/rgb', garment_mask_dir: 'synthetic/garment_mask', truth_glb: 'synthetic/garment_truth.glb', background_rgb: [...STUDIO_RGB] }
      : null,
    stage1b,
    seeds,
    models: PINNED_MODELS,
    exporter: `@curtain/garment-spike ${EXPORT_VERSION}`,
    prediction: { file: PREDICTION_FILE, sha256: sha256(predictionJson), predictor_version: PREDICTOR_VERSION, hashed: false },
    hash_inputs: hashInputs,
    input_hash: hash,
  };
  put('manifest.json', json(manifest));
  return { manifest, files, bytes };
}

function proxyGlbBytes(proxy: Proxy, productId: string, baseSize: string): Uint8Array {
  return writeGlb([{ name: 'control-proxy', positions: proxy.mesh.positions, indices: proxy.mesh.indices, baseColor: [0.62, 0.62, 0.62, 1], roughness: 0.9 }], {
    scale: 0.01,
    generator: `@curtain/garment-spike ${EXPORT_VERSION}`,
    extras: { productId, baseSize, unit: 'm', controlProxy: true, note: 'control signal for stage 2 only, never an output' },
  });
}

function concat(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(a.length + b.length);
  out.set(a as ArrayLike<number>, 0);
  out.set(b as ArrayLike<number>, a.length);
  return out;
}
