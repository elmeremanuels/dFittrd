/**
 * Colour harmony — hex → CIELAB (D65), ΔE2000 (Sharma, Wu & Dalal 2005), a documented
 * 12-season palette table and `colourMatchScore(garmentHex, season | undertone)` → 0..1 with a
 * chip label. The user's season / undertone is an on-device *estimate* from the capture pipeline
 * (DECISIONS.md D5: multi-point CIELAB sampling → ITA → undertone from hue angle → rule-based
 * 12-season estimate, confirmed by the user). Nothing here reads a photo.
 */
import { parseHex, type Rgb } from './colour';

export interface Lab {
  /** lightness 0..100 */
  L: number;
  /** green(−) … red(+) */
  a: number;
  /** blue(−) … yellow(+) */
  b: number;
}

// ---------------------------------------------------------------------------
// sRGB → CIELAB (D65 reference white)
// ---------------------------------------------------------------------------

const D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 } as const;

function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

export function rgbToLab({ r, g, b }: Rgb): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const X = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const Y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const Z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
  const fx = labF(X / D65.X);
  const fy = labF(Y / D65.Y);
  const fz = labF(Z / D65.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** `#RGB` / `#RRGGBB` → Lab; null when malformed. */
export function hexToLab(hex: string): Lab | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToLab(rgb) : null;
}

/** Chroma C* = √(a² + b²). */
export function chroma(lab: Lab): number {
  return Math.hypot(lab.a, lab.b);
}

/** Hue angle h° in [0, 360). */
export function hueAngle(lab: Lab): number {
  const h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

// ---------------------------------------------------------------------------
// ΔE2000
// ---------------------------------------------------------------------------

const deg2rad = (d: number): number => (d * Math.PI) / 180;
const rad2deg = (r: number): number => (r * 180) / Math.PI;
const POW25_7 = 25 ** 7;

function hueOf(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const h = rad2deg(Math.atan2(b, a));
  return h < 0 ? h + 360 : h;
}

/** CIEDE2000 colour difference (kL = kC = kH = 1). ~1 is a just-noticeable difference. */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = hueOf(a1p, b1);
  const h2p = hueOf(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) dhp = diff;
    else if (diff > 180) dhp = diff - 360;
    else dhp = diff + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp / 2));

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(deg2rad(hbarp - 30)) +
    0.24 * Math.cos(deg2rad(2 * hbarp)) +
    0.32 * Math.cos(deg2rad(3 * hbarp + 6)) -
    0.2 * Math.cos(deg2rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(deg2rad(2 * dTheta)) * RC;

  const l = dLp / SL;
  const c = dCp / SC;
  const h = dHp / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

// ---------------------------------------------------------------------------
// 12-season palettes
// ---------------------------------------------------------------------------

export type Undertone = 'warm' | 'cool' | 'neutral';
export const UNDERTONES = ['warm', 'cool', 'neutral'] as const satisfies readonly Undertone[];

export type SeasonFamily = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS = [
  'lightSpring',
  'trueSpring',
  'brightSpring',
  'lightSummer',
  'trueSummer',
  'softSummer',
  'softAutumn',
  'trueAutumn',
  'deepAutumn',
  'deepWinter',
  'trueWinter',
  'brightWinter',
] as const;
export type Season = (typeof SEASONS)[number];

export interface PaletteSwatch {
  name: string;
  hex: string;
}

export interface SeasonDefinition {
  key: Season;
  label: string;
  family: SeasonFamily;
  /** Dominant undertone of the season. Soft seasons sit on the warm/cool border → 'neutral'. */
  undertone: Undertone;
  /** One-line description shown in the swatch confirmation screen. */
  description: string;
  /** Representative swatches (8 per season) incl. the season's best neutrals. */
  palette: readonly PaletteSwatch[];
}

const season = (
  key: Season,
  label: string,
  family: SeasonFamily,
  undertone: Undertone,
  description: string,
  palette: readonly [string, string][],
): SeasonDefinition =>
  Object.freeze({
    key,
    label,
    family,
    undertone,
    description,
    palette: Object.freeze(palette.map(([name, hex]) => Object.freeze({ name, hex }))),
  });

/**
 * Small, documented 12-season table (Spring/Summer/Autumn/Winter × light/true/bright|soft|deep).
 * Each palette lists eight representative colours — the season's signature hues plus its best
 * neutrals — chosen so that ΔE2000 to the nearest swatch separates "in palette" (≲ 10) from
 * "off palette" (≳ 35) for everyday garment colours. The capture pipeline estimates the season;
 * the user confirms it. Terracotta `#C97A4F` (the handoff §3.1 reference dress) is a True Autumn
 * swatch by construction.
 */
export const SEASON_TABLE: Readonly<Record<Season, SeasonDefinition>> = Object.freeze({
  lightSpring: season('lightSpring', 'Light Spring', 'spring', 'warm', 'Light, warm and fresh: peach, aqua, buttery yellow.', [
    ['peach', '#F7C6A3'],
    ['light coral', '#F28B82'],
    ['warm cream', '#FBF3DC'],
    ['aqua', '#9FD8D8'],
    ['light leaf', '#B8D99A'],
    ['butter', '#F9E79F'],
    ['camel', '#D4A373'],
    ['light periwinkle', '#B5C7E8'],
  ]),
  trueSpring: season('trueSpring', 'True Spring', 'spring', 'warm', 'Warm and clear: coral, turquoise, golden yellow.', [
    ['coral', '#FF7F50'],
    ['turquoise', '#30D5C8'],
    ['golden yellow', '#F4C430'],
    ['leaf green', '#6DBE45'],
    ['tomato', '#E8462C'],
    ['camel', '#C19A6B'],
    ['ivory', '#FFF8E7'],
    ['bright periwinkle', '#7B9EE6'],
  ]),
  brightSpring: season('brightSpring', 'Bright Spring', 'spring', 'warm', 'Bright, warm-leaning and high contrast: hot coral, lime, true red.', [
    ['hot coral', '#FF5A3C'],
    ['bright turquoise', '#00C2C7'],
    ['lime', '#A4DE02'],
    ['bright yellow', '#FFD60A'],
    ['true red', '#E0162B'],
    ['royal blue', '#2E5BFF'],
    ['hot pink', '#FF4F9A'],
    ['white', '#FFFFFF'],
  ]),
  lightSummer: season('lightSummer', 'Light Summer', 'summer', 'cool', 'Light, cool and soft: powder blue, lavender, rose.', [
    ['powder blue', '#B7D3E8'],
    ['lavender', '#C8B6E2'],
    ['rose pink', '#F2B8C6'],
    ['soft white', '#F3F1EC'],
    ['light grey', '#C9CCD1'],
    ['mint', '#BFE3D2'],
    ['periwinkle', '#A6B8E8'],
    ['light raspberry', '#D98BA5'],
  ]),
  trueSummer: season('trueSummer', 'True Summer', 'summer', 'cool', 'Cool and muted: dusty rose, slate blue, raspberry.', [
    ['dusty rose', '#C98A9A'],
    ['slate blue', '#6E86B5'],
    ['raspberry', '#B04A6A'],
    ['grey blue', '#8CA3B8'],
    ['cocoa', '#8A6E6A'],
    ['lavender grey', '#A79DB8'],
    ['soft white', '#EDEDEA'],
    ['mid grey', '#8F9399'],
  ]),
  softSummer: season('softSummer', 'Soft Summer', 'summer', 'neutral', 'Muted and cool-leaning: mauve, dusty teal, taupe.', [
    ['mauve', '#A88F9B'],
    ['dusty teal', '#6E9A98'],
    ['greyed rose', '#C9A2A6'],
    ['taupe', '#9F9088'],
    ['soft navy', '#4B5A73'],
    ['sage', '#9AA98C'],
    ['pewter', '#8E8E93'],
    ['oatmeal', '#D9D2C5'],
  ]),
  softAutumn: season('softAutumn', 'Soft Autumn', 'autumn', 'neutral', 'Muted and warm-leaning: camel, olive, soft teal.', [
    ['camel', '#C2A074'],
    ['olive', '#7F8A4F'],
    ['soft teal', '#3F7F7A'],
    ['soft terracotta', '#C98A6A'],
    ['mushroom', '#B3A394'],
    ['dusty coral', '#D39A86'],
    ['khaki', '#A89F72'],
    ['cream', '#EFE6D2'],
  ]),
  trueAutumn: season('trueAutumn', 'True Autumn', 'autumn', 'warm', 'Warm and rich: rust, mustard, olive, terracotta.', [
    ['rust', '#B7410E'],
    ['mustard', '#D4A017'],
    ['olive', '#6B7A2D'],
    ['terracotta', '#C97A4F'],
    ['teal', '#2F7E79'],
    ['camel', '#B88A5B'],
    ['brick', '#8E3B2F'],
    ['warm cream', '#F2E6CF'],
  ]),
  deepAutumn: season('deepAutumn', 'Deep Autumn', 'autumn', 'warm', 'Deep and warm: chocolate, forest, burnt orange.', [
    ['chocolate', '#4B2E1E'],
    ['burgundy brown', '#6E2C2F'],
    ['forest', '#1F4D2E'],
    ['burnt orange', '#CC5500'],
    ['deep teal', '#0F4C5C'],
    ['mustard', '#C69214'],
    ['black brown', '#2B1D14'],
    ['warm ivory', '#F1E8D8'],
  ]),
  deepWinter: season('deepWinter', 'Deep Winter', 'winter', 'cool', 'Deep, cool and high contrast: black, burgundy, emerald, navy.', [
    ['black', '#0B0B0F'],
    ['pure white', '#FFFFFF'],
    ['burgundy', '#5A1A2E'],
    ['emerald', '#046A38'],
    ['navy', '#0B1F4A'],
    ['royal purple', '#4B2A7B'],
    ['true red', '#C8102E'],
    ['icy pink', '#F4D6E3'],
  ]),
  trueWinter: season('trueWinter', 'True Winter', 'winter', 'cool', 'Cool and clear: cobalt, fuchsia, emerald, black and white.', [
    ['black', '#000000'],
    ['white', '#FFFFFF'],
    ['cobalt', '#0047AB'],
    ['fuchsia', '#D6249F'],
    ['emerald', '#00875A'],
    ['icy blue', '#CFE4F5'],
    ['charcoal', '#3C3F45'],
    ['cherry', '#B3122E'],
  ]),
  brightWinter: season('brightWinter', 'Bright Winter', 'winter', 'cool', 'Bright, cool and saturated: electric blue, hot pink, violet.', [
    ['black', '#0A0A0A'],
    ['white', '#FFFFFF'],
    ['electric blue', '#1E5EFF'],
    ['hot pink', '#FF2E88'],
    ['icy yellow', '#F7F6C9'],
    ['true red', '#E60026'],
    ['emerald', '#00A86B'],
    ['violet', '#7F00FF'],
  ]),
});

export function isSeason(x: string): x is Season {
  return (SEASONS as readonly string[]).includes(x);
}

export function isUndertone(x: string): x is Undertone {
  return (UNDERTONES as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ColourChipLabel = 'Great with your undertone' | 'Neutral' | 'Clashes';

/** Tunables of colourMatchScore (exported for the UI's explainer and for tests). */
export const COLOUR_MATCH = Object.freeze({
  /** ΔE2000 to the nearest season swatch at/below which palette proximity is 1. */
  paletteNearDeltaE: 8,
  /** ΔE2000 at/above which palette proximity is 0. */
  paletteFarDeltaE: 40,
  /** Chroma below which a colour is treated as achromatic (undertone agreement 0.5). */
  achromaticChroma: 8,
  /** Chroma at which undertone agreement reaches full weight. */
  fullChroma: 30,
  /** Hue angle (°) at the centre of "warm" (yellow-orange); cool is the opposite side. */
  warmHueDeg: 60,
  /** Season score = w·paletteProximity + (1−w)·undertoneAgreement. */
  paletteWeight: 0.7,
  /** Chip thresholds. */
  greatAtLeast: 0.66,
  clashesAtMost: 0.34,
});

/**
 * How well a colour agrees with an undertone, 0..1 (0.5 = neutral).
 * warmth = cos(h − 60°) weighted by chroma: achromatic colours are neutral for everyone;
 * 'neutral' undertones prefer balanced/muted hues over strongly warm or strongly cool ones.
 */
export function undertoneAgreement(lab: Lab, undertone: Undertone): number {
  const C = chroma(lab);
  const cw = clamp01((C - COLOUR_MATCH.achromaticChroma) / (COLOUR_MATCH.fullChroma - COLOUR_MATCH.achromaticChroma));
  if (cw === 0) return 0.5;
  const warmth = Math.cos(deg2rad(hueAngle(lab) - COLOUR_MATCH.warmHueDeg));
  switch (undertone) {
    case 'warm':
      return clamp01(0.5 + 0.5 * warmth * cw);
    case 'cool':
      return clamp01(0.5 - 0.5 * warmth * cw);
    case 'neutral':
      return clamp01(1 - 0.5 * Math.abs(warmth) * cw);
  }
}

/** Nearest swatch of a season by ΔE2000. */
export function nearestSwatch(lab: Lab, seasonKey: Season): { swatch: PaletteSwatch; deltaE: number } {
  let best: { swatch: PaletteSwatch; deltaE: number } | null = null;
  for (const swatch of SEASON_TABLE[seasonKey].palette) {
    const swatchLab = hexToLab(swatch.hex) as Lab;
    const dE = deltaE2000(lab, swatchLab);
    if (!best || dE < best.deltaE) best = { swatch, deltaE: dE };
  }
  return best as { swatch: PaletteSwatch; deltaE: number };
}

/** 1 at ΔE ≤ 8, 0 at ΔE ≥ 40, linear between. */
export function paletteProximity(deltaE: number): number {
  const { paletteNearDeltaE: near, paletteFarDeltaE: far } = COLOUR_MATCH;
  return clamp01(1 - (deltaE - near) / (far - near));
}

export function colourChipLabel(score: number): ColourChipLabel {
  if (score >= COLOUR_MATCH.greatAtLeast) return 'Great with your undertone';
  if (score <= COLOUR_MATCH.clashesAtMost) return 'Clashes';
  return 'Neutral';
}

export interface ColourMatch {
  /** 0..1 */
  score: number;
  label: ColourChipLabel;
  /** The season or undertone the garment was scored against. */
  target: Season | Undertone;
  /** Undertone used for the agreement term (the season's undertone, or the given one). */
  undertone: Undertone;
  /** ΔE2000 to the nearest season swatch; null when scored against a bare undertone or the hex was malformed. */
  deltaE: number | null;
  nearestSwatch: PaletteSwatch | null;
  /** Garment colour in CIELAB; null when the hex was malformed. */
  lab: Lab | null;
}

/**
 * colourMatch(garmentHex, season | undertone):
 * - season: 0.7 · paletteProximity(min ΔE2000 to the season's swatches) + 0.3 · undertoneAgreement(season undertone)
 * - undertone: undertoneAgreement alone
 * A malformed hex scores 0.5 / 'Neutral' (garment colours are schema-validated upstream; this is defensive).
 */
export function colourMatch(garmentHex: string, target: Season | Undertone): ColourMatch {
  const lab = hexToLab(garmentHex);
  const undertone: Undertone = isSeason(target) ? SEASON_TABLE[target].undertone : target;
  if (!lab) return { score: 0.5, label: 'Neutral', target, undertone, deltaE: null, nearestSwatch: null, lab: null };
  const agreement = undertoneAgreement(lab, undertone);
  if (!isSeason(target)) {
    const score = round4(agreement);
    return { score, label: colourChipLabel(score), target, undertone, deltaE: null, nearestSwatch: null, lab };
  }
  const nearest = nearestSwatch(lab, target);
  const w = COLOUR_MATCH.paletteWeight;
  const score = round4(w * paletteProximity(nearest.deltaE) + (1 - w) * agreement);
  return { score, label: colourChipLabel(score), target, undertone, deltaE: nearest.deltaE, nearestSwatch: nearest.swatch, lab };
}

/** 0..1 — see colourMatch. */
export function colourMatchScore(garmentHex: string, target: Season | Undertone): number {
  return colourMatch(garmentHex, target).score;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round4(x: number): number {
  return Math.round((x + Number.EPSILON) * 1e4) / 1e4;
}
