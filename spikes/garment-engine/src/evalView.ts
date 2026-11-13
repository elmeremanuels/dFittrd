/**
 * View agreement (docs/ENGINE-HANDOFF.md §Stage 7 QA, Phase 0 acceptance "view agreement"): the
 * garment rendered at 0° and 180° of the turntable (the frames stage 2 pins) against
 *
 * 1. the stage 1b stills' garment masks (`stage1b/garment_mask_<view>.png`): same mannequin, same
 *    camera, so the silhouette IoU is a real check of stages 2–4 against what was pinned. For the
 *    synthetic spike product the reference is the synthetic garment mask of the same frame;
 * 2. the shop photo's garment mask (`stage1b/source/<view>_mask.png`, SAM 2 on the shop photo):
 *    another body, pose and camera, so both silhouettes are cropped to their bounding box and scaled
 *    to the same height first. **Indicative only**; it cannot pass or fail an asset.
 *
 * The render is our software rasteriser (`raster.ts`), with the mannequin drawn as an occluder, so
 * only garment pixels visible from the camera count, as in the stage 1b mask.
 */
import { type CameraFrame, type Mesh } from '@curtain/mannequin';
import { encodePng } from './exportPng';
import { maskIou, mirrorMask, normaliseMask, type DecodedPng, type Mask, type MaskIou } from './evalPng';
import { render } from './raster';
import { GARMENT_ID, MANNEQUIN_GREY, MANNEQUIN_ID } from './separation';

/** Initial pass mark for the silhouette IoU against the pinned still; Phase 0 data must set the real one. */
export const VIEW_IOU_PASS = 0.85;

export type ViewName = 'front' | 'back';

/**
 * The garment's pixels at a camera. With `body`, the mannequin is drawn as an occluder (what a
 * viewer shows: garment that lies inside the mannequin is hidden); with `null`, the garment's own
 * silhouette (what the garment masks of stage 2 and stage 4 describe where the body is covered).
 */
export function garmentSilhouette(body: Mesh | null, garment: Mesh, frame: CameraFrame, width: number, height: number): Mask {
  const r = render(
    [
      ...(body ? [{ positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID }] : []),
      { positions: garment.positions, indices: garment.indices, color: [0.8, 0.3, 0.2] as [number, number, number], id: GARMENT_ID },
    ],
    frame,
    width,
    height,
  );
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = r.ids[i] === GARMENT_ID ? 1 : 0;
  return { width, height, data };
}

export type ReferenceKind = 'stage1b' | 'synthetic';

export interface ViewReference {
  view: ViewName;
  /** Turntable frame index (0 or N/2). */
  frame: number;
  kind: ReferenceKind;
  /** Path relative to the job dir. */
  path: string;
  mask: Mask;
  /** Stage 1b: the back was generated without a back photo (D13). */
  invented: boolean;
}

export interface ViewScore extends MaskIou {
  /** IoU of the garment's own silhouette (no mannequin occluder) with the reference: holes and cloth inside the mannequin do not count against it. */
  silhouetteIou?: number;
  view: ViewName;
  frame: number;
  reference: ReferenceKind;
  referencePath: string;
  invented: boolean;
  pass: boolean;
}

export function scoreView(rendered: Mask, ref: ViewReference, passIou = VIEW_IOU_PASS, silhouette?: Mask): ViewScore {
  const s = maskIou(rendered, ref.mask);
  return { ...s, iou: Math.round(s.iou * 10000) / 10000, ...(silhouette ? { silhouetteIou: Math.round(maskIou(silhouette, ref.mask).iou * 10000) / 10000 } : {}), view: ref.view, frame: ref.frame, reference: ref.kind, referencePath: ref.path, invented: ref.invented, pass: s.iou >= passIou };
}

export interface ShopPhotoScore {
  view: ViewName;
  photoMaskPath: string;
  /** IoU of the two silhouettes after cropping each to its box and scaling to the same height. */
  normalisedIou: number;
  /** The same with the photo mirrored (a photo may be taken mirrored); the larger one is reported. */
  mirrored: boolean;
  /** Height / width of each silhouette's box: a quick look at proportions. */
  aspectRender: number;
  aspectPhoto: number;
  label: 'indicative only: different body, pose and camera';
}

const aspect = (m: Mask): number => {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    if (!m.data[y * m.width + x]) continue;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return x1 < 0 ? 0 : Math.round(((y1 - y0 + 1) / (x1 - x0 + 1)) * 100) / 100;
};

export function shopPhotoScore(view: ViewName, rendered: Mask, photo: Mask, photoMaskPath: string): ShopPhotoScore | null {
  const a = normaliseMask(rendered);
  const b = normaliseMask(photo);
  const bm = normaliseMask(mirrorMask(photo));
  if (!a || !b || !bm) return null;
  const straight = maskIou(a, b).iou;
  const flipped = maskIou(a, bm).iou;
  return {
    view,
    photoMaskPath,
    normalisedIou: Math.round(Math.max(straight, flipped) * 10000) / 10000,
    mirrored: flipped > straight,
    aspectRender: aspect(rendered),
    aspectPhoto: aspect(photo),
    label: 'indicative only: different body, pose and camera',
  };
}

/** RGB samples of the overlay: grey = both, red = reference only, blue = render only. */
export function overlayRgb(rendered: Mask, reference: Mask): Uint8Array {
  const { width, height } = rendered;
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = rendered.data[i]!, b = reference.data[i]!;
    const [r, g, bl] = a && b ? [120, 120, 120] : b ? [220, 40, 30] : a ? [30, 80, 220] : [245, 245, 245];
    data[3 * i] = r;
    data[3 * i + 1] = g;
    data[3 * i + 2] = bl;
  }
  return data;
}

/** RGB overlay for a person to look at: grey = both, red = reference only, blue = render only. */
export function overlayPng(rendered: Mask, reference: Mask): Uint8Array {
  return encodePng({ width: rendered.width, height: rendered.height, channels: 3, bitDepth: 8, data: overlayRgb(rendered, reference) });
}

/** Studio grey behind the colour renders (the stage 2 frames' background is a light grey too). */
export const RENDER_BACKGROUND = [236, 236, 236] as const;

/**
 * Colour render of the garment on the mannequin at a camera: the garment in its stage 4 vertex
 * colours, unlit (they carry the frames' light), else flat; the mannequin shaded grey. RGB samples.
 */
export function colourRender(body: Mesh, garment: Mesh, colors: ArrayLike<number> | null, frame: CameraFrame, width: number, height: number): Uint8Array {
  const r = render(
    [
      { positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID },
      { positions: garment.positions, indices: garment.indices, color: [0.72, 0.68, 0.62], id: GARMENT_ID, ...(colors ? { vertexColors: colors, unlit: true } : {}) },
    ],
    frame,
    width,
    height,
  );
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) out[3 * i + c] = r.ids[i] ? r.rgb[3 * i + c]! : RENDER_BACKGROUND[c]!;
  }
  return out;
}

/** Panels of the same size (RGB samples) side by side, 8 px apart, as one PNG. */
export function sideBySidePng(width: number, height: number, panels: readonly Uint8Array[]): Uint8Array {
  const gap = 8;
  const W = panels.length * width + (panels.length - 1) * gap;
  const data = new Uint8Array(W * height * 3).fill(255);
  panels.forEach((p, k) => {
    const x0 = k * (width + gap);
    for (let y = 0; y < height; y++) data.set(p.subarray(y * width * 3, (y + 1) * width * 3), (y * W + x0) * 3);
  });
  return encodePng({ width: W, height, channels: 3, bitDepth: 8, data });
}

/**
 * Decoded images stacked top to bottom, 8 px apart, left-aligned on white, as one RGB PNG (the before/after pictures of two
 * runs: the same camera, so heights in the two rows compare directly). Grey and alpha are converted to RGB on white.
 */
export function stackPng(images: readonly DecodedPng[]): Uint8Array {
  if (!images.length) throw new Error('stackPng: no images');
  const gap = 8;
  const W = Math.max(...images.map((i) => i.width));
  const H = images.reduce((h, i) => h + i.height, 0) + gap * (images.length - 1);
  const data = new Uint8Array(W * H * 3).fill(255);
  let y0 = 0;
  for (const img of images) {
    const ch = img.channels;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * ch;
      const a = ch === 2 ? img.data[i + 1]! / 255 : ch === 4 ? img.data[i + 3]! / 255 : 1;
      const o = ((y0 + y) * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v = ch >= 3 ? img.data[i + c]! : img.data[i]!;
        data[o + c] = Math.round(v * a + 255 * (1 - a));
      }
    }
    y0 += img.height + gap;
  }
  return encodePng({ width: W, height: H, channels: 3, bitDepth: 8, data });
}

/** One turntable angle: the stage 4 mesh rendered at the stage 2 camera against that frame's garment mask. */
export interface TurntableScore {
  angleDeg: number;
  frame: number;
  /** Path of the stage 2 garment mask, relative to the job dir. */
  referencePath: string;
  mesh: 'reconstructed' | 'calibrated';
  /** Mannequin drawn as an occluder (what a viewer shows). */
  iouVisible: number;
  /** The garment's own silhouette. */
  iouSilhouette: number;
}
