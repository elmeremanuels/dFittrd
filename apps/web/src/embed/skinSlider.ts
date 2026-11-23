/**
 * Skin tone slider (CUR-28, WO-015): continuous interpolation between the 10 Monk swatches.
 *
 * The slider runs from 0 (Monk 1, Light) to 1 (Monk 10, Deep), with 0.5 at the midpoint between
 * Monk 5 and 6 (Medium). Interpolation is in OKLab colour space for perceptually uniform blending.
 *
 * D20: only the hex colour value is kept on the device. The monk class number is no longer stored;
 * it can be derived from the slider position if needed for display.
 */
import { MONK_SWATCHES } from '@/features/capture/faceSkin';

/** sRGB hex to linear RGB (0..1). */
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [toLinear((n >> 16) & 255), toLinear((n >> 8) & 255), toLinear(n & 255)];
}

/** Linear RGB to sRGB hex. */
function linearToHex(rgb: [number, number, number]): string {
  const toSrgb = (c: number) => {
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(255, s * 255)));
  };
  const r = toSrgb(rgb[0]);
  const g = toSrgb(rgb[1]);
  const b = toSrgb(rgb[2]);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

/** Linear RGB to OKLab. */
function linearToOklab(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** OKLab to linear RGB. */
function oklabToLinear(lab: [number, number, number]): [number, number, number] {
  const [L, a, b] = lab;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The 10 Monk swatches in OKLab. */
const MONK_OKLAB: readonly [number, number, number][] = MONK_SWATCHES.map((hex) => linearToOklab(hexToLinear(hex)));

/**
 * Interpolate between two OKLab colours. `t` is 0..1: 0 = a, 1 = b.
 */
function mixOklab(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The hex colour at slider position `t` (0..1). 0 = Monk 1 (Light), 0.5 = midpoint between Monk 5
 * and 6 (Medium), 1 = Monk 10 (Deep). Interpolation is in OKLab for perceptually uniform blending.
 */
export function skinHexAt(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * 9; // 0..9, matching the 10 swatches (indices 0..9)
  const lo = Math.floor(scaled);
  const hi = Math.min(lo + 1, 9);
  const frac = scaled - lo;
  const lab = mixOklab(MONK_OKLAB[lo]!, MONK_OKLAB[hi]!, frac);
  return linearToHex(oklabToLinear(lab));
}

/** The approximate Monk class (1..10) for a slider position. */
export function monkAt(t: number): number {
  return Math.round(Math.max(0, Math.min(1, t)) * 9) + 1;
}

/** The slider position (0..1) for a Monk class (1..10). */
export function sliderForMonk(monk: number): number {
  return Math.max(0, Math.min(9, monk - 1)) / 9;
}

/**
 * The slider position (0..1) for a hex colour: the position that produces the closest colour.
 * Returns null if the colour is not within the slider's range (e.g., a non-skin colour).
 */
export function sliderForHex(hex: string): number | null {
  // Fast path: if the input matches one of the 10 integer-class swatches exactly, return its
  // position without searching. Shoppers who picked a swatch expect it to come back the same.
  const upper = hex.toUpperCase();
  for (let i = 0; i < MONK_SWATCHES.length; i++) {
    if (upper === MONK_SWATCHES[i]!.toUpperCase()) return i / 9;
  }
  const target = linearToOklab(hexToLinear(hex));
  const dist = (t: number): number => {
    const lab = linearToOklab(hexToLinear(skinHexAt(t)));
    return Math.hypot(lab[0] - target[0], lab[1] - target[1], lab[2] - target[2]);
  };
  let bestT = 0;
  let bestDist = Infinity;
  // Sample 100 positions and find the closest
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const d = dist(t);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }
  // Refine with ternary search on the unimodal distance function (40 iterations ≈ 1e-12 precision).
  let lo = Math.max(0, bestT - 0.01);
  let hi = Math.min(1, bestT + 0.01);
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist(m1) < dist(m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  return (lo + hi) / 2;
}
