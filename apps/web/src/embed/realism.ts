/**
 * AI realism layer, embed side (D22): turn the 3D view's render passes into the wire request. The
 * request carries the passes and nothing else: no photo, no face, no measurement (the schema has no
 * field for them and refuses unknown keys). Browser only for the default PNG encoder.
 */
import type { RealismRequest } from '@curtain/schema';

/** The passes as the viewer exports them (packages/garment-viewer `ViewerPasses`), structurally. */
export interface ExportedPasses {
  kind: 'renderPasses';
  width: number;
  height: number;
  size: string;
  colour: PassImage;
  depth: PassImage;
  normal: PassImage;
  garmentMask: PassImage;
  figureMask: PassImage;
  neighbour: { size: string; garmentMask: PassImage } | null;
  meta: { statureCm: number; waistRow: number; hipRow: number; backdropHex: string; garmentHex: string };
}
export interface PassImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type PngEncoder = (img: PassImage) => string;

/** RGBA → base64 PNG (no data: prefix) through a canvas. */
export const canvasPng: PngEncoder = (img) => {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const url = c.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
};

export function realismRequest(p: ExportedPasses, ids: { productId: string; shopId: string }, encode: PngEncoder = canvasPng, now: () => Date = () => new Date()): RealismRequest {
  return {
    productId: ids.productId,
    shopId: ids.shopId,
    size: p.size,
    passes: {
      kind: 'renderPasses',
      width: p.width,
      height: p.height,
      colourPng: encode(p.colour),
      depthPng: encode(p.depth),
      normalPng: encode(p.normal),
      garmentMaskPng: encode(p.garmentMask),
      figureMaskPng: encode(p.figureMask),
      ...(p.neighbour ? { neighbour: { size: p.neighbour.size, garmentMaskPng: encode(p.neighbour.garmentMask) } } : {}),
      meta: { statureCm: p.meta.statureCm, waistRow: p.meta.waistRow, hipRow: p.meta.hipRow, backdropHex: p.meta.backdropHex, garmentHex: p.meta.garmentHex },
    },
    consent: { tier: 'heroOptIn', ack: true, acknowledgedAt: now().toISOString() },
  };
}
