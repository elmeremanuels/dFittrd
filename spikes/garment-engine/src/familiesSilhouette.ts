/**
 * Silhouette check for cut families: the main product photo's foreground mask, normalised for
 * position and scale, compared by IoU. It splits text families that are really two cuts (a maxi
 * and a midi with the same copy).
 *
 * Without a segmentation model the mask comes from the frame border: pixels not reachable from the
 * border through background colours. That only works on a plain backdrop (studio, hanger, flat-lay,
 * ghost mannequin), so `photoSilhouette` refuses a photo whose border needs more than a few colours
 * or whose subject runs off the top or the sides; such a member is "not checked", never split. A
 * garment mask made elsewhere (e.g. stage 1b's Grounding DINO + SAM 2 on Modal) can be passed in
 * through `maskSilhouette` instead.
 *
 * Pure functions on decoded pixels; the CLI downloads a small PNG of the main photo (the Shopify CDN
 * converts with `format=png`) and decodes it with `decodeAnyPng`.
 */
import { maskIou, mirrorMask, normaliseMask, type DecodedPng, type Mask } from './evalPng';

/** Normalised main-photo mask (bounding box scaled to `SIL_H` rows, centred on `SIL_W` columns). */
export type Silhouette = Mask;

export const SIL_W = 64;
export const SIL_H = 128;

export interface SilhouetteResult {
  silhouette: Silhouette | null;
  /** Foreground share of the frame before normalisation. */
  foregroundShare: number;
  /** Background colours learned from the frame border. */
  paletteSize: number;
  /** Why there is no silhouette. */
  reason?: string;
}

export interface SilhouetteOptions {
  /** Max per-channel distance (0–255) from a border colour that still counts as background. */
  tolerance?: number;
  /** Share of border pixels the background palette must explain. */
  paletteCover?: number;
  /** A plain backdrop: at most this many border colour bins explain `paletteCover` of the border. */
  maxPaletteColours?: number;
  /** Share of the top, left and right border rows that may be foreground (a subject cut off there is not a whole silhouette). */
  maxSideContact?: number;
  /** A mask covering less or more of the frame than this is not a usable silhouette. */
  minShare?: number;
  maxShare?: number;
}

function rgbAt(img: DecodedPng, i: number): [number, number, number] {
  const p = i * img.channels;
  if (img.channels >= 3) return [img.data[p]!, img.data[p + 1]!, img.data[p + 2]!];
  const g = img.data[p]!;
  return [g, g, g];
}

/** Background palette: mean colours of the most frequent border colour bins (3 bits per channel). */
export function borderPalette(img: DecodedPng, cover = 0.9, maxColours = 12): { palette: Array<[number, number, number]>; covered: number } {
  const { width: w, height: h } = img;
  const band = Math.max(2, Math.round(0.02 * Math.min(w, h)));
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const [r, g, b] = rgbAt(img, y * w + x);
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bins.set(key, bin);
      total++;
    }
  }
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  const palette: Array<[number, number, number]> = [];
  let covered = 0;
  for (const bin of sorted) {
    if (palette.length >= maxColours || covered >= cover * total) break;
    palette.push([bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]);
    covered += bin.n;
  }
  return { palette, covered: total ? covered / total : 0 };
}

function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    out[i] = m[i]! & m[i - 1]! & m[i + 1]! & m[i - w]! & m[i + w]!;
  }
  return out;
}

function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = m[i]! | (x > 0 ? m[i - 1]! : 0) | (x < w - 1 ? m[i + 1]! : 0) | (y > 0 ? m[i - w]! : 0) | (y < h - 1 ? m[i + w]! : 0);
  }
  return out;
}

/** Largest 4-connected component of a 0/1 mask. */
export function largestComponent(m: Uint8Array, w: number): Uint8Array {
  const label = new Int32Array(m.length);
  let best = 0, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    next++;
    let size = 0;
    label[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= m.length || !m[j] || label[j]) continue;
        label[j] = next;
        stack.push(j);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = label[i] === best && best ? 1 : 0;
  return out;
}

/**
 * Foreground of a product photo: pixels not reachable from the frame border through background
 * colours (so holes are filled), opened once, largest component kept, then normalised.
 */
export function photoSilhouette(img: DecodedPng, opts: SilhouetteOptions = {}): SilhouetteResult {
  const tol = opts.tolerance ?? 28;
  const { width: w, height: h } = img;
  const n = w * h;
  const cover = opts.paletteCover ?? 0.9;
  const maxColours = opts.maxPaletteColours ?? 4;
  const { palette, covered } = borderPalette(img, cover, maxColours);
  if (covered < cover) {
    return { silhouette: null, foregroundShare: 0, paletteSize: palette.length, reason: `not a plain backdrop: ${maxColours} border colours explain only ${(covered * 100).toFixed(0)} % of the border` };
  }
  const isBg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rgbAt(img, i);
    for (const c of palette) {
      if (Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol) {
        isBg[i] = 1;
        break;
      }
    }
  }
  // Flood the background from the border.
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (isBg[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < n - w) seed(i + w);
  }
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = outside[i] ? 0 : 1;
  const fg = largestComponent(dilate(erode(raw, w, h), w, h), w);
  let count = 0;
  for (let i = 0; i < n; i++) count += fg[i]!;
  const share = count / n;
  const base = { foregroundShare: Math.round(share * 1000) / 1000, paletteSize: palette.length };
  let side = 0;
  for (let x = 0; x < w; x++) side += fg[x]!;
  for (let y = 0; y < h; y++) side += fg[y * w]! + fg[y * w + w - 1]!;
  const contact = side / (w + 2 * h);
  if (contact > (opts.maxSideContact ?? 0.02)) return { ...base, silhouette: null, reason: `subject runs off the top or a side (${(contact * 100).toFixed(1)} % of those border pixels): not a whole silhouette` };
  if (share < (opts.minShare ?? 0.05)) return { ...base, silhouette: null, reason: `foreground ${(share * 100).toFixed(1)} % of the frame: no subject found against the border colours` };
  if (share > (opts.maxShare ?? 0.85)) return { ...base, silhouette: null, reason: `foreground ${(share * 100).toFixed(1)} % of the frame: the background is not separable from the border colours (busy set)` };
  const sil = normaliseMask({ width: w, height: h, data: fg }, SIL_W, SIL_H);
  return sil ? { ...base, silhouette: sil } : { ...base, silhouette: null, reason: 'empty mask' };
}

/** A garment mask made elsewhere (0/1, any size), normalised like a photo silhouette. */
export function maskSilhouette(mask: Mask): Silhouette | null {
  return normaliseMask(mask, SIL_W, SIL_H);
}

/** IoU of two normalised silhouettes; a horizontally mirrored pose counts as the same shape. */
export function silhouetteIou(a: Silhouette, b: Silhouette): number {
  return Math.max(maskIou(a, b).iou, maskIou(a, mirrorMask(b)).iou);
}
