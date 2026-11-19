/**
 * Render passes of the 3D view for the AI realism layer (D22, docs/research/ai-realism-layer.md):
 * the lit colour of the figure, linear depth, view-space normals, the garment mask and the figure
 * mask, all from the same front camera on the flat backdrop. The colour pass is drawn with the
 * standard body colour and the standard head: no face texture and no picked skin colour goes into
 * it (hard rule 1, D19; D20 point 1 waits for the privacy policy, as for the hero render).
 * This file is pure (no WebGL): the drawing is `renderPasses` in scene.ts.
 */

export interface ViewerPassImage {
  width: number;
  height: number;
  /** RGBA, top row first. */
  data: Uint8Array;
}

export interface ViewerPasses {
  kind: 'renderPasses';
  width: number;
  height: number;
  size: string;
  colour: ViewerPassImage;
  /** Grey in RGBA (r = g = b): 255 nearest, 1 farthest on the figure, 0 background. */
  depth: ViewerPassImage;
  normal: ViewerPassImage;
  /** White on black in RGBA. */
  garmentMask: ViewerPassImage;
  figureMask: ViewerPassImage;
  neighbour: { size: string; garmentMask: ViewerPassImage } | null;
  meta: { statureCm: number; waistRow: number; hipRow: number; backdropHex: string; garmentHex: string };
}

export interface ExportPassesOptions {
  /** Default 512 × 768 (3:4 portrait). */
  width?: number;
  height?: number;
  /** Also draw this size's garment mask (default: the next size up, else down), for the size-to-size check; null: none. */
  neighbour?: string | null;
}

export const PASS_WIDTH = 512;
export const PASS_HEIGHT = 768;

/** WebGL reads bottom row first; the passes are top row first. In place on a copy. */
export function flipRows(data: Uint8Array, width: number, height: number, channels = 4): Uint8Array {
  const out = new Uint8Array(data.length);
  const row = width * channels;
  for (let y = 0; y < height; y++) out.set(data.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

/** A mask drawn white on black: every pixel to exactly 0 or 255 (r ≥ 128), alpha 255. */
export function binarise(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i]! >= 128 ? 255 : 0;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** Depth pass cleanup: background (mask 0) to 0, figure pixels at least 1. */
export function cleanDepth(depth: Uint8Array, figure: Uint8Array): Uint8Array {
  const out = new Uint8Array(depth.length);
  for (let i = 0; i < depth.length; i += 4) {
    const v = figure[i]! >= 128 ? Math.max(1, depth[i]!) : 0;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** Normals cleanup: black outside the figure. */
export function cleanNormals(normal: Uint8Array, figure: Uint8Array): Uint8Array {
  const out = new Uint8Array(normal);
  for (let i = 0; i < normal.length; i += 4) {
    if (figure[i]! < 128) out[i] = out[i + 1] = out[i + 2] = 0;
    out[i + 3] = 255;
  }
  return out;
}

/** The size next to `size` the check compares with: the next one up, else the one below; null for a one-size bundle. */
export function neighbourSize(sizes: readonly string[], size: string): string | null {
  const i = sizes.indexOf(size);
  if (i < 0) return null;
  return sizes[i + 1] ?? sizes[i - 1] ?? null;
}

export const hexOf = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** The row (px from the top) of a projected y in a pass of this height, clamped. */
export function rowOf(y: number, height: number): number {
  return Math.max(0, Math.min(height - 1, Math.round(y)));
}
