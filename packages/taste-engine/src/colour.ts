/**
 * Hex → HSL and the twelve hue bins of taste-engine-spec.md §featurize.
 */
import type { HueBin } from './types';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsl {
  /** degrees, [0, 360) */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  l: number;
}

/** Parse `#RGB` or `#RRGGBB` (case-insensitive) to 0..255 channels; null when malformed. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1] as string;
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToHsl(rgb) : null;
}

/**
 * Spec bins: l ≥ 0.90 → white; l < 0.12 → black; s < 0.15 → neutral-dark (l < 0.5) or
 * neutral-light; else by hue: red [345,15), orange [15,45), yellow [45,70), green [70,160),
 * teal [160,200), blue [200,260), purple [260,300), pink [300,345).
 * A malformed hex (schema-validated upstream, so this is defensive) is binned as neutral-light.
 */
export function hueBinFromHsl({ h, s, l }: Hsl): HueBin {
  if (l >= 0.9) return 'white';
  if (l < 0.12) return 'black';
  if (s < 0.15) return l < 0.5 ? 'neutral-dark' : 'neutral-light';
  if (h >= 345 || h < 15) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 260) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

export function hueBin(hex: string): HueBin {
  const hsl = hexToHsl(hex);
  return hsl ? hueBinFromHsl(hsl) : 'neutral-light';
}
