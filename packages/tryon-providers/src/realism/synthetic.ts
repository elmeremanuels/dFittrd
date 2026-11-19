/**
 * A synthetic set of render passes (a simple figure in a plain dress on the cream backdrop), for
 * tests and the dev page. It stands in for packages/garment-viewer `exportPasses` where there is no
 * WebGL. Not a person, not a photo.
 */
import type { MaskImage, RenderPasses, RgbaImage } from './passes.js';

export interface SyntheticOptions {
  width?: number;
  height?: number;
  garmentHex?: string;
  skinHex?: string;
  backdropHex?: string;
  /** Extra half-width of the dress, px (a bigger size). */
  grow?: number;
  /** Extra length of the dress, px. */
  longer?: number;
  /** Add a neighbouring size this much wider/longer, px. */
  neighbour?: { size: string; grow: number; longer: number } | null;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Half-width of the figure's body at row y (px), 0 outside. Head, torso with waist, legs. */
function bodyHalf(y: number, h: number): number {
  const t = y / h;
  if (t < 0.05 || t > 0.97) return 0;
  if (t < 0.15) return 0.035 * h * Math.sqrt(Math.max(0, 1 - ((t - 0.1) / 0.05) ** 2)); // head
  if (t < 0.18) return 0.018 * h; // neck
  if (t < 0.6) {
    const waist = 0.38, k = (t - waist) / 0.2;
    return h * (0.06 + 0.025 * Math.min(1, k * k)); // torso: narrowest at the waist
  }
  return h * 0.055 * (1 - (t - 0.6) * 0.8); // legs (one column)
}

function dressHalf(y: number, h: number, grow: number, longer: number): number {
  const t = y / h;
  const hem = 0.68 * h + longer;
  if (t < 0.2 || y > hem) return 0;
  const body = bodyHalf(y, h);
  const flare = t > 0.45 ? (t - 0.45) * h * 0.12 : 0;
  return body + 3 + grow + flare;
}

export function syntheticPasses(o: SyntheticOptions = {}): RenderPasses {
  const w = o.width ?? 384, h = o.height ?? 576;
  const back = o.backdropHex ?? '#F5EFE7';
  const [br, bg, bb] = rgb(back);
  const [gr, gg, gb] = rgb(o.garmentHex ?? '#1F4E79');
  const [sr, sg, sb] = rgb(o.skinHex ?? '#8C8C8C');
  const n = w * h;
  const colour: RgbaImage = { width: w, height: h, data: new Uint8Array(n * 4) };
  const normal: RgbaImage = { width: w, height: h, data: new Uint8Array(n * 4) };
  const depth: MaskImage = { width: w, height: h, data: new Uint8Array(n) };
  const garmentMask: MaskImage = { width: w, height: h, data: new Uint8Array(n) };
  const figureMask: MaskImage = { width: w, height: h, data: new Uint8Array(n) };
  const neighbourMask: MaskImage | null = o.neighbour ? { width: w, height: h, data: new Uint8Array(n) } : null;
  const cx = w / 2;
  for (let y = 0; y < h; y++) {
    const bh = bodyHalf(y, h);
    const dh = dressHalf(y, h, o.grow ?? 0, o.longer ?? 0);
    const nh = o.neighbour ? dressHalf(y, h, (o.grow ?? 0) + o.neighbour.grow, (o.longer ?? 0) + o.neighbour.longer) : 0;
    const half = Math.max(bh, dh);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = Math.abs(x + 0.5 - cx);
      const inFig = dx < half;
      const inGar = dx < dh;
      if (neighbourMask && dx < nh) neighbourMask.data[i] = 255;
      const shade = inFig ? 1 - 0.25 * (dx / Math.max(1, half)) ** 2 : 1;
      const c = inGar ? [gr, gg, gb] : inFig ? [sr, sg, sb] : [br, bg, bb];
      colour.data[4 * i] = inFig ? Math.round(c[0]! * shade) : c[0]!;
      colour.data[4 * i + 1] = inFig ? Math.round(c[1]! * shade) : c[1]!;
      colour.data[4 * i + 2] = inFig ? Math.round(c[2]! * shade) : c[2]!;
      colour.data[4 * i + 3] = 255;
      if (inFig) {
        figureMask.data[i] = 255;
        if (inGar) garmentMask.data[i] = 255;
        const nx = Math.max(-0.95, Math.min(0.95, (x + 0.5 - cx) / Math.max(1, half)));
        const nz = Math.sqrt(1 - nx * nx);
        normal.data[4 * i] = Math.round(((nx + 1) / 2) * 255);
        normal.data[4 * i + 1] = 128;
        normal.data[4 * i + 2] = Math.round(((nz + 1) / 2) * 255);
        depth.data[i] = Math.max(1, Math.round(200 * nz));
      }
      normal.data[4 * i + 3] = 255;
    }
  }
  return {
    kind: 'renderPasses',
    width: w,
    height: h,
    colour,
    depth,
    normal,
    garmentMask,
    figureMask,
    ...(o.neighbour && neighbourMask ? { neighbour: { size: o.neighbour.size, garmentMask: neighbourMask } } : {}),
    meta: { size: 'M', statureCm: 168, waistRow: Math.round(0.38 * h), hipRow: Math.round(0.5 * h), backdropHex: back, garmentHex: o.garmentHex ?? '#1F4E79', category: 'dress' },
  };
}
