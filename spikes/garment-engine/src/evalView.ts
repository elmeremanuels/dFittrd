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
import { maskIou, mirrorMask, normaliseMask, type Mask, type MaskIou } from './evalPng';
import { render } from './raster';
import { GARMENT_ID, MANNEQUIN_GREY, MANNEQUIN_ID } from './separation';

/** Initial pass mark for the silhouette IoU against the pinned still; Phase 0 data must set the real one. */
export const VIEW_IOU_PASS = 0.85;

export type ViewName = 'front' | 'back';

export function garmentSilhouette(body: Mesh, garment: Mesh, frame: CameraFrame, width: number, height: number): Mask {
  const r = render(
    [
      { positions: body.positions, indices: body.indices, color: MANNEQUIN_GREY, id: MANNEQUIN_ID },
      { positions: garment.positions, indices: garment.indices, color: [0.8, 0.3, 0.2], id: GARMENT_ID },
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
  view: ViewName;
  frame: number;
  reference: ReferenceKind;
  referencePath: string;
  invented: boolean;
  pass: boolean;
}

export function scoreView(rendered: Mask, ref: ViewReference, passIou = VIEW_IOU_PASS): ViewScore {
  const s = maskIou(rendered, ref.mask);
  return { ...s, iou: Math.round(s.iou * 10000) / 10000, view: ref.view, frame: ref.frame, reference: ref.kind, referencePath: ref.path, invented: ref.invented, pass: s.iou >= passIou };
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

/** RGB overlay for a person to look at: grey = both, red = reference only, blue = render only. */
export function overlayPng(rendered: Mask, reference: Mask): Uint8Array {
  const { width, height } = rendered;
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = rendered.data[i]!, b = reference.data[i]!;
    const [r, g, bl] = a && b ? [120, 120, 120] : b ? [220, 40, 30] : a ? [30, 80, 220] : [245, 245, 245];
    data[3 * i] = r;
    data[3 * i + 1] = g;
    data[3 * i + 2] = bl;
  }
  return encodePng({ width, height, channels: 3, bitDepth: 8, data });
}
