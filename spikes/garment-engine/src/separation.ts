/**
 * Stage 3 — separation on synthetic renders (docs/ENGINE-HANDOFF.md, D14). For every frame of the
 * fixed turntable paths we render the dressed and the bare mannequin with the same camera and light;
 * a pixel is garment when the two frames differ. Both frames get independent sensor-like noise (the
 * generated video is never pixel-identical to our own render), the difference is thresholded and
 * cleaned with a 3×3 majority filter, and the mask is scored by IoU against the renderer's ground
 * truth (pixels where the garment is the visible surface).
 *
 * Not covered here (needs real generated video, see README): the segmentation-model refinement and
 * the motion signal (cloth lagging the mannequin during the clip).
 */
import type { CameraPath } from '@curtain/mannequin';
import { gaussian, mulberry32 } from './garment';
import { render, type DrawItem, type Render } from './raster';

export const MANNEQUIN_ID = 1;
export const GARMENT_ID = 2;
export const MANNEQUIN_GREY: [number, number, number] = [0.5, 0.5, 0.5];

export interface SeparationOptions {
  width?: number;
  height?: number;
  /** Use every n-th frame of each path (default 1). */
  frameStride?: number;
  /** Standard deviation of the per-pixel noise added to each frame, 8-bit levels (default 2). */
  noiseSigma?: number;
  /** Max channel difference that counts as "changed" (default 14). */
  threshold?: number;
  seed?: number;
}

export interface FrameScore {
  path: string;
  frame: number;
  azimuthDeg: number;
  iou: number;
  /** Share of changed pixels whose difference is below twice the threshold (a confidence proxy: low is good). */
  ambiguous: number;
  garmentPixels: number;
}

export interface SeparationReport {
  width: number;
  height: number;
  frames: number;
  /** Total intersection / total union over all frames. */
  iou: number;
  minFrameIou: number;
  meanAmbiguous: number;
  perFrame: FrameScore[];
}

/** Garment mask from the dressed and bare frames: max channel difference above the threshold, then a 3×3 majority vote. */
export function differenceMask(dressed: Uint8ClampedArray, bare: Uint8ClampedArray, width: number, height: number, threshold: number): { mask: Uint8Array; ambiguous: number } {
  const raw = new Uint8Array(width * height);
  let ambiguous = 0;
  let positives = 0;
  for (let k = 0; k < width * height; k++) {
    const d = Math.max(Math.abs(dressed[3 * k]! - bare[3 * k]!), Math.abs(dressed[3 * k + 1]! - bare[3 * k + 1]!), Math.abs(dressed[3 * k + 2]! - bare[3 * k + 2]!));
    if (d > threshold) {
      raw[k] = 1;
      positives++;
      if (d < 2 * threshold) ambiguous++;
    }
  }
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let votes = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          n++;
          votes += raw[yy * width + xx]!;
        }
      }
      mask[y * width + x] = votes * 2 > n ? 1 : 0;
    }
  }
  return { mask, ambiguous: positives > 0 ? ambiguous / positives : 0 };
}

function addNoise(r: Render, sigma: number, rand: () => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.rgb.length);
  for (let i = 0; i < out.length; i++) out[i] = r.rgb[i]! + Math.round(rand() * sigma);
  return out;
}

export function iou(mask: Uint8Array, truth: Uint8Array): { intersection: number; union: number } {
  let intersection = 0, union = 0;
  for (let k = 0; k < mask.length; k++) {
    const a = mask[k]!, b = truth[k]!;
    if (a && b) intersection++;
    if (a || b) union++;
  }
  return { intersection, union };
}

/**
 * Render bare and dressed frames along the paths and score the difference masks. `mannequin` and
 * `garment` are positions + indices in mannequin space (cm).
 */
export function separate(
  mannequin: Pick<DrawItem, 'positions' | 'indices'>,
  garment: Pick<DrawItem, 'positions' | 'indices'> & { color: [number, number, number] },
  paths: readonly CameraPath[],
  options: SeparationOptions = {},
): SeparationReport {
  const width = options.width ?? 192;
  const height = options.height ?? 192;
  const stride = options.frameStride ?? 1;
  const sigma = options.noiseSigma ?? 2;
  const threshold = options.threshold ?? 14;
  const noise = gaussian(mulberry32(options.seed ?? 1));
  const bareItem: DrawItem = { ...mannequin, color: MANNEQUIN_GREY, id: MANNEQUIN_ID };
  const garmentItem: DrawItem = { ...garment, id: GARMENT_ID };
  const perFrame: FrameScore[] = [];
  let I = 0, U = 0;
  for (const path of paths) {
    for (const frame of path.frames.filter((_, i) => i % stride === 0)) {
      const bare = render([bareItem], frame, width, height);
      const dressed = render([bareItem, garmentItem], frame, width, height);
      const truth = new Uint8Array(width * height);
      let garmentPixels = 0;
      for (let k = 0; k < truth.length; k++) if (dressed.ids[k] === GARMENT_ID) {
        truth[k] = 1;
        garmentPixels++;
      }
      const { mask, ambiguous } = differenceMask(addNoise(dressed, sigma, noise), addNoise(bare, sigma, noise), width, height, threshold);
      const s = iou(mask, truth);
      I += s.intersection;
      U += s.union;
      perFrame.push({ path: path.id, frame: frame.index, azimuthDeg: frame.azimuthDeg, iou: s.union ? s.intersection / s.union : 1, ambiguous, garmentPixels });
    }
  }
  return {
    width,
    height,
    frames: perFrame.length,
    iou: U ? I / U : 1,
    minFrameIou: Math.min(...perFrame.map((f) => f.iou)),
    meanAmbiguous: perFrame.reduce((s, f) => s + f.ambiguous, 0) / Math.max(1, perFrame.length),
    perFrame,
  };
}
