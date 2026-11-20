/**
 * Skin shading `skin-v2` of the 2D figure (DECISIONS.md D22 point 3), the 2D half of the viewer's
 * `skin-v2` (`packages/garment-viewer/src/skin.ts`). Opt-in (`AvatarView skinShading="skin-v2"`);
 * without it the figure is drawn exactly as before (`femaleFigureGolden.test.tsx`).
 *
 * The flat figure shades the swatch by adding and taking away the same number from each channel
 * (`adjustColor`, +10 to -22): a light swatch clips to white at the top and turns grey at the
 * bottom, and a deep one loses half its brightness and goes almost black. Here every shade is the
 * swatch multiplied in linear light, so the hue stays the skin's at every step:
 * - the lit side is the swatch itself, the turned-away side darker with the red kept a little
 *   more than the green and blue (the warm shadow edge of skin, as the 3D terminator);
 * - the side shading is that warm shadow, not black;
 * - a faint sheen down the lit side, stronger on deep tones (where it shows the form) than on light
 *   ones (where it would wash them out);
 * - the outline is a little darker than the warm shadow and darkened further, keeping its hue,
 *   until it stands out 3.2:1 from the mirror's backdrop: a brown line on the light tones (the flat
 *   one was a grey-brown), a slightly darker warm edge on the deep ones (the flat one was the fill
 *   itself, so the figure had no edge where it meets a dark garment).
 * The light comes from the viewer's right, as the 3D key light. Display only: a colour in memory.
 */

export type Skin2dShading = 'flat' | 'skin-v2';

/** The 2D shading a host asked for: `skin-v2` when asked by name, else `flat`. */
export function skin2dShadingOf(value: unknown): Skin2dShading {
  return value === 'skin-v2' ? 'skin-v2' : 'flat';
}

const toLin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number): number => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));

/** `#rrggbb` → linear RGB. */
export function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [toLin(n >> 16), toLin((n >> 8) & 255), toLin(n & 255)];
}
/** Linear RGB → `#rrggbb` (lower case). */
export function hexOfLinear(c: readonly [number, number, number]): string {
  return `#${c.map((v) => toSrgb(v).toString(16).padStart(2, '0')).join('')}`;
}
/** The swatch multiplied per channel in linear light; a channel that would pass 1 scales all three down alike (hue kept). */
export function scaleLinear(hex: string, k: readonly [number, number, number]): string {
  const c = linearRgb(hex).map((v, i) => v * k[i]!) as [number, number, number];
  const peak = Math.max(...c);
  return hexOfLinear(peak > 1 ? (c.map((v) => v / peak) as [number, number, number]) : c);
}

const lum = (hex: string): number => {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** CIE L* of `#rrggbb`. */
export function lightness(hex: string): number {
  const y = lum(hex);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** Linear multipliers of the shades (r, g, b). The red is kept more in the shadow: the warm terminator. */
export const SKIN2D_SHADES = {
  lit: [1, 1, 1],
  mid: [0.94, 0.92, 0.91],
  shadow: [0.76, 0.68, 0.65],
  side: [0.5, 0.41, 0.38],
  edge: [0.56, 0.47, 0.44],
} as const;

const FIGURE_BACKDROP = '#F1ECE6';

export interface Skin2d {
  /** Radial fill: the lit centre, the middle, the turned-away edge. */
  lit: string;
  mid: string;
  shadow: string;
  /** The side shading's colour (drawn with opacity over the fill). */
  side: string;
  /** Opacity of the side shading at the shadowed (left) and the lit (right) edge. */
  sideLeft: number;
  sideRight: number;
  /** Opacity of the white sheen band down the lit side. */
  sheen: number;
  /** The figure's outline. */
  outline: string;
  /** About the colour the head ends up drawn in (for the face ink). */
  head: string;
}

/** The 2D skin-v2 shades for a swatch. Pure. */
export function skin2d(hex: string): Skin2d {
  const L = lightness(hex);
  const deep = Math.min(1, Math.max(0, (55 - L) / 30));
  const shadow = scaleLinear(hex, SKIN2D_SHADES.shadow);
  // A line a little darker than the figure's shadowed edge, darkened further (hue kept) only as far as the backdrop
  // needs (3.2:1). A darker line on a deep tone drew the body path's inner joins (shoulders, hips) as black seams.
  const edge = scaleLinear(hex, SKIN2D_SHADES.edge);
  let outline = edge;
  for (let k = 1; k > 0.05 && contrast(outline, FIGURE_BACKDROP) < 3.2; k -= 0.02) outline = scaleLinear(edge, [k, k, k]);
  return {
    lit: scaleLinear(hex, SKIN2D_SHADES.lit),
    mid: scaleLinear(hex, SKIN2D_SHADES.mid),
    shadow,
    side: scaleLinear(hex, SKIN2D_SHADES.side),
    sideLeft: 0.45,
    sideRight: 0.2,
    sheen: 0.05 + 0.1 * deep,
    outline,
    head: scaleLinear(hex, [0.8, 0.76, 0.74]),
  };
}
