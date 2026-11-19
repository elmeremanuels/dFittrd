/**
 * The render passes of the 3D view (packages/garment-viewer `exportPasses`), decoded: the ONLY input
 * of the AI realism layer (D22, docs/research/ai-realism-layer.md §3). There is no person photo in
 * here and there is no field for one (AGENTS.md hard rule 1). `checkRenderPasses` is the server's
 * guard that what arrived looks like our render and not like a camera picture: a flat backdrop
 * outside the figure, binary masks, the garment inside the figure, depth only on the figure, unit
 * normals. It is a guard against mistakes and casual misuse, not a proof: the proof is that no
 * camera path in the client leads here (tests in apps/web and apps/api).
 */

/** 8-bit RGBA, row-major, top row first. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 8-bit single channel, 0 or 255, row-major, top row first. */
export interface MaskImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RenderPassMeta {
  /** The size drawn. */
  size: string;
  /** Stature of the drawn body, cm (px per cm comes from the figure mask height over this). */
  statureCm: number;
  /** Rows (px from the top) of the body's waist and hip rings, projected by the viewer. */
  waistRow: number;
  hipRow: number;
  /** `#rrggbb` of the flat backdrop the passes were drawn on. */
  backdropHex: string;
  /** `#rrggbb` of the garment's base colour in the bundle (informational; the check compares pixels). */
  garmentHex: string;
  /** Garment category, for the waist rule (a bottom's waist is its top edge). */
  category: 'top' | 'bottom' | 'dress' | 'outerwear';
}

export interface RenderPasses {
  kind: 'renderPasses';
  width: number;
  height: number;
  /** Lit colour of the figure (standard face, never the shopper's face texture), flat backdrop. */
  colour: RgbaImage;
  /** Depth, grey: 255 nearest, 0 = background / far. */
  depth: MaskImage;
  /** View-space normals packed as rgb = (n + 1) / 2 · 255; black outside the figure. */
  normal: RgbaImage;
  /** Garment pixels. */
  garmentMask: MaskImage;
  /** Figure pixels (body + garment). */
  figureMask: MaskImage;
  /** The neighbouring size's garment mask, same camera, for the size-to-size check. */
  neighbour?: { size: string; garmentMask: MaskImage } | undefined;
  meta: RenderPassMeta;
}

export const PASS_MIN_SIDE = 256;
export const PASS_MAX_WIDTH = 1024;
export const PASS_MAX_HEIGHT = 1536;

/** Guard thresholds (shares of pixels). */
export const PASS_GUARD = {
  /** Share of mask pixels that must be exactly 0 or 255. */
  binaryShare: 0.995,
  /** Share of garment pixels that must lie inside the figure. */
  garmentInFigureShare: 0.99,
  /** Share of background pixels whose colour must equal the backdrop within `backdropTolerance` per channel. */
  flatBackdropShare: 0.995,
  backdropTolerance: 3,
  /** Share of figure pixels with a depth > 0, and of background pixels with depth 0. */
  depthOnFigureShare: 0.98,
  /** Share of figure pixels whose packed normal has length within 0.8–1.2. */
  unitNormalShare: 0.97,
  /** The figure covers between these shares of the frame. */
  figureAreaMin: 0.04,
  figureAreaMax: 0.7,
  /** The garment covers at least this share of the figure. */
  garmentAreaMin: 0.05,
} as const;

export type PassIssue =
  | 'dimensions'
  | 'mask_not_binary'
  | 'garment_outside_figure'
  | 'backdrop_not_flat'
  | 'depth_off_figure'
  | 'normals_not_unit'
  | 'figure_area'
  | 'garment_area'
  | 'landmarks';

const binaryShare = (m: MaskImage): number => {
  let n = 0;
  for (const v of m.data) if (v === 0 || v === 255) n++;
  return n / m.data.length;
};

function hex(h: string): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The guard. Returns the issues found (empty: the passes look like our render). Pure. */
export function checkRenderPasses(p: RenderPasses): PassIssue[] {
  const issues: PassIssue[] = [];
  const { width: w, height: h } = p;
  const n = w * h;
  const sameSize = (img: { width: number; height: number; data: Uint8Array }, ch: number): boolean => img.width === w && img.height === h && img.data.length === n * ch;
  if (
    p.kind !== 'renderPasses' ||
    w < PASS_MIN_SIDE || h < PASS_MIN_SIDE || w > PASS_MAX_WIDTH || h > PASS_MAX_HEIGHT ||
    !sameSize(p.colour, 4) || !sameSize(p.normal, 4) || !sameSize(p.depth, 1) || !sameSize(p.garmentMask, 1) || !sameSize(p.figureMask, 1) ||
    (p.neighbour && !sameSize(p.neighbour.garmentMask, 1))
  ) {
    return ['dimensions'];
  }
  const masks = [p.garmentMask, p.figureMask, ...(p.neighbour ? [p.neighbour.garmentMask] : [])];
  if (masks.some((m) => binaryShare(m) < PASS_GUARD.binaryShare)) issues.push('mask_not_binary');

  const fig = p.figureMask.data, gar = p.garmentMask.data, depth = p.depth.data, col = p.colour.data, nor = p.normal.data;
  const [br, bg, bb] = hex(p.meta.backdropHex);
  const tol = PASS_GUARD.backdropTolerance;
  let figure = 0, garment = 0, garmentIn = 0, bgCount = 0, bgFlat = 0, depthFig = 0, depthBgZero = 0, unit = 0;
  for (let i = 0; i < n; i++) {
    const inFig = fig[i]! >= 128;
    if (gar[i]! >= 128) {
      garment++;
      if (inFig) garmentIn++;
    }
    if (inFig) {
      figure++;
      if (depth[i]! > 0) depthFig++;
      const x = nor[4 * i]! / 127.5 - 1, y = nor[4 * i + 1]! / 127.5 - 1, z = nor[4 * i + 2]! / 127.5 - 1;
      const len = Math.hypot(x, y, z);
      if (len >= 0.8 && len <= 1.2) unit++;
    } else {
      bgCount++;
      if (depth[i] === 0) depthBgZero++;
      if (Math.abs(col[4 * i]! - br) <= tol && Math.abs(col[4 * i + 1]! - bg) <= tol && Math.abs(col[4 * i + 2]! - bb) <= tol) bgFlat++;
    }
  }
  if (garment === 0 || garmentIn / garment < PASS_GUARD.garmentInFigureShare) issues.push('garment_outside_figure');
  if (bgCount === 0 || bgFlat / bgCount < PASS_GUARD.flatBackdropShare) issues.push('backdrop_not_flat');
  if (figure === 0 || depthFig / figure < PASS_GUARD.depthOnFigureShare || (bgCount > 0 && depthBgZero / bgCount < PASS_GUARD.depthOnFigureShare)) issues.push('depth_off_figure');
  if (figure === 0 || unit / figure < PASS_GUARD.unitNormalShare) issues.push('normals_not_unit');
  if (figure / n < PASS_GUARD.figureAreaMin || figure / n > PASS_GUARD.figureAreaMax) issues.push('figure_area');
  if (figure > 0 && garment / figure < PASS_GUARD.garmentAreaMin) issues.push('garment_area');
  const m = p.meta;
  if (!(m.statureCm > 50 && m.statureCm < 250) || !(m.waistRow >= 0 && m.waistRow < h) || !(m.hipRow >= 0 && m.hipRow < h) || m.hipRow <= m.waistRow) issues.push('landmarks');
  return issues;
}
