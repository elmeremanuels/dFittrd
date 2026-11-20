/**
 * Skin tone, undertone and seasonal-colour estimate (DECISIONS.md D5, body-scan.md §Face step).
 *
 * Pipeline: FaceLandmarker region sampling (cheeks, forehead, nasal bridge; only pixels the
 * multiclass segmenter classes as face-skin) → sRGB → linear → XYZ(D65) → CIELAB → k-means (k=5) on
 * Lab, dominant mid-lightness cluster (rejects specular highlights and shadows) → ITA =
 * atan2(L*−50, b*)·180/π → Monk Skin Tone class via the published thresholds → undertone from the
 * hue angle atan2(b*, a*) → rule-based 12-season ESTIMATE. Everything here is pure and tested.
 *
 * Colour data never leaves the device and never enters the fit signature.
 */
import { FACE_REGIONS, SEG } from './landmarks';
import type { Landmark, Season, SeasonEstimate, SkinEstimate } from './types';

export interface Lab {
  L: number;
  a: number;
  b: number;
}

// ---------------------------------------------------------------------------
// Colour science
// ---------------------------------------------------------------------------

export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/** D65 reference white (2° observer). */
const D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 } as const;

export function srgbToXyz(r: number, g: number, b: number): { X: number; Y: number; Z: number } {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return {
    X: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    Y: R * 0.2126729 + G * 0.7151522 + B * 0.072175,
    Z: R * 0.0193339 + G * 0.119192 + B * 0.9503041,
  };
}

function labF(t: number): number {
  const d = 6 / 29;
  return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

function labFInv(t: number): number {
  const d = 6 / 29;
  return t > d ? t * t * t : 3 * d * d * (t - 4 / 29);
}

export function xyzToLab(X: number, Y: number, Z: number): Lab {
  const fx = labF(X / D65.X);
  const fy = labF(Y / D65.Y);
  const fz = labF(Z / D65.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function srgbToLab(r: number, g: number, b: number): Lab {
  const { X, Y, Z } = srgbToXyz(r, g, b);
  return xyzToLab(X, Y, Z);
}

export function labToSrgb(lab: Lab): { r: number; g: number; b: number } {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const X = D65.X * labFInv(fx);
  const Y = D65.Y * labFInv(fy);
  const Z = D65.Z * labFInv(fz);
  const R = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const G = X * -0.969266 + Y * 1.8760108 + Z * 0.041556;
  const B = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** Individual Typology Angle in degrees. atan2 handles negative b*. */
export function ita(lab: Lab): number {
  return (Math.atan2(lab.L - 50, lab.b) * 180) / Math.PI;
}

/**
 * Monk Skin Tone class (1 = lightest … 10 = darkest) from ITA, using the published thresholds
 * (PMC12179258, 89–92 % agreement on clinical photos):
 * 1 > 81.62; 2: 75.99–81.62; 3: 68.24–75.99; 4: 57.53–68.24; 5: 30.61–57.53; 6: −4.63–30.61;
 * 7: −37.77–−4.63; 8: −66.87–−37.77; 9: −81.33–−66.87; 10 < −81.33.
 */
export const MONK_ITA_THRESHOLDS: readonly number[] = [81.62, 75.99, 68.24, 57.53, 30.61, -4.63, -37.77, -66.87, -81.33];

export function monkFromIta(itaDeg: number): number {
  for (let i = 0; i < MONK_ITA_THRESHOLDS.length; i++) {
    if (itaDeg > (MONK_ITA_THRESHOLDS[i] as number)) return i + 1;
  }
  return 10;
}

/** Representative sRGB swatches for the 10 Monk classes (Monk Skin Tone scale, CC-BY 4.0). */
export const MONK_SWATCHES: readonly string[] = [
  '#F6EDE4',
  '#F3E7DB',
  '#F7EAD0',
  '#EADABA',
  '#D7BD96',
  '#A07E56',
  '#825C43',
  '#604134',
  '#3A312A',
  '#292420',
];

export function hueAngle(lab: Lab): number {
  const h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

export function chroma(lab: Lab): number {
  return Math.hypot(lab.a, lab.b);
}

/**
 * Undertone from the hue angle: skin sits between red (low h) and yellow (high h). Thresholds are
 * approximate: h ≥ 58° or the b-to-a ratio ≥ 1.5 → warm; h ≤ 48° or the ratio ≤ 1.0 → cool; otherwise neutral.
 */
export function undertoneFromLab(lab: Lab): 'warm' | 'cool' | 'neutral' {
  const h = hueAngle(lab);
  const ratio = lab.a > 0 ? lab.b / lab.a : Number.POSITIVE_INFINITY;
  if (h >= 58 || ratio >= 1.5) return 'warm';
  if (h <= 48 || ratio <= 1.0) return 'cool';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// k-means on Lab
// ---------------------------------------------------------------------------

export interface Cluster {
  centroid: Lab;
  count: number;
}

const dist2 = (p: Lab, q: Lab): number => (p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2;

/** Deterministic k-means: initial centroids at L* quantiles, 25 Lloyd iterations max. */
export function kMeansLab(points: readonly Lab[], k = 5, maxIter = 25): Cluster[] {
  if (points.length === 0) return [];
  const kk = Math.min(k, points.length);
  const sorted = [...points].sort((a, b) => a.L - b.L);
  let centroids: Lab[] = Array.from({ length: kk }, (_, i) => {
    const p = sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) / kk) * sorted.length))] as Lab;
    return { ...p };
  });
  let assign = new Int32Array(points.length).fill(-1);
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    const next = new Int32Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const p = points[i] as Lab;
      let best = 0;
      let bd = Number.POSITIVE_INFINITY;
      for (let c = 0; c < kk; c++) {
        const d = dist2(p, centroids[c] as Lab);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      next[i] = best;
      if (assign[i] !== best) changed = true;
    }
    assign = next;
    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i] as number] as { L: number; a: number; b: number; n: number };
      const p = points[i] as Lab;
      s.L += p.L;
      s.a += p.a;
      s.b += p.b;
      s.n++;
    }
    centroids = sums.map((s, c) => (s.n > 0 ? { L: s.L / s.n, a: s.a / s.n, b: s.b / s.n } : (centroids[c] as Lab)));
    if (!changed) break;
  }
  const counts = new Array<number>(kk).fill(0);
  for (let i = 0; i < points.length; i++) {
    const c = assign[i] as number;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return centroids.map((centroid, i) => ({ centroid, count: counts[i] as number }));
}

/**
 * Dominant mid-lightness cluster: discard clusters whose L* is more than 15 from the sample median
 * (specular highlights, shadows), then take the most populous remaining one.
 */
export function dominantSkinCluster(points: readonly Lab[], k = 5): Lab | null {
  if (points.length === 0) return null;
  const clusters = kMeansLab(points, k);
  const Ls = points.map((p) => p.L).sort((a, b) => a - b);
  const medL = Ls[Ls.length >> 1] as number;
  const mid = clusters.filter((c) => Math.abs(c.centroid.L - medL) <= 15);
  const pool = mid.length > 0 ? mid : clusters;
  pool.sort((a, b) => b.count - a.count);
  return (pool[0] as Cluster).centroid;
}

// ---------------------------------------------------------------------------
// Pixel sampling
// ---------------------------------------------------------------------------

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * Collect Lab samples in small discs around each landmark, keeping only pixels the segmenter
 * labels as face-skin (when a mask is given). Landmarks are normalised to the image.
 */
export function sampleSkinLab(
  img: RgbaImage,
  landmarks: readonly Landmark[],
  indices: readonly number[],
  mask?: { width: number; height: number; data: Uint8Array } | null,
  radiusPx = 4,
): Lab[] {
  const out: Lab[] = [];
  for (const i of indices) {
    const l = landmarks[i];
    if (!l) continue;
    const cx = Math.round(l.x * img.width);
    const cy = Math.round(l.y * img.height);
    for (let dy = -radiusPx; dy <= radiusPx; dy++) {
      for (let dx = -radiusPx; dx <= radiusPx; dx++) {
        if (dx * dx + dy * dy > radiusPx * radiusPx) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        if (mask) {
          const mx = Math.floor((x / img.width) * mask.width);
          const my = Math.floor((y / img.height) * mask.height);
          if (mask.data[my * mask.width + mx] !== SEG.FACE_SKIN) continue;
        }
        const o = (y * img.width + x) * 4;
        const a = img.data[o + 3] ?? 255;
        if (a < 128) continue;
        out.push(srgbToLab(img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0));
      }
    }
  }
  return out;
}

/** Lab samples of every pixel the segmenter labels as a given class (sub-sampled by `stride`). */
export function sampleClassLab(
  img: RgbaImage,
  mask: { width: number; height: number; data: Uint8Array },
  cls: number,
  stride = 3,
): Lab[] {
  const out: Lab[] = [];
  for (let y = 0; y < img.height; y += stride) {
    const my = Math.floor((y / img.height) * mask.height);
    for (let x = 0; x < img.width; x += stride) {
      const mx = Math.floor((x / img.width) * mask.width);
      if (mask.data[my * mask.width + mx] !== cls) continue;
      const o = (y * img.width + x) * 4;
      out.push(srgbToLab(img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0));
    }
  }
  return out;
}

export const SKIN_SAMPLE_INDICES: readonly number[] = [
  ...FACE_REGIONS.leftCheek,
  ...FACE_REGIONS.rightCheek,
  ...FACE_REGIONS.forehead,
  ...FACE_REGIONS.noseBridge,
];

// ---------------------------------------------------------------------------
// 12-season estimate (rule-based, labelled estimate)
// ---------------------------------------------------------------------------

export const SEASONS: readonly Season[] = [
  'light spring',
  'warm spring',
  'bright spring',
  'light summer',
  'cool summer',
  'soft summer',
  'soft autumn',
  'warm autumn',
  'deep autumn',
  'deep winter',
  'cool winter',
  'bright winter',
];

/**
 * Score every season from four axes (undertone, value, chroma, contrast). Heuristic weights, not
 * calibrated probabilities (body-scan.md: "treat as a styling estimate and label it").
 */
export function seasonEstimate(skin: Lab, hair?: Lab | null): SeasonEstimate {
  const undertone = undertoneFromLab(skin);
  const C = chroma(skin);
  const value: 'light' | 'medium' | 'deep' = skin.L >= 62 ? 'light' : skin.L <= 45 ? 'deep' : 'medium';
  const chromaAxis: 'clear' | 'medium' | 'soft' = C >= 24 ? 'clear' : C <= 18 ? 'soft' : 'medium';
  const spread = hair ? Math.abs(skin.L - hair.L) : Number.NaN;
  const contrast: 'high' | 'medium' | 'low' = Number.isNaN(spread) ? 'medium' : spread >= 40 ? 'high' : spread <= 20 ? 'low' : 'medium';

  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const warm = undertone === 'warm' ? 1 : undertone === 'neutral' ? 0.5 : 0;
  const cool = 1 - warm;
  // continuous axes: light ramps 45→62 L*, clear ramps 18→24 C*, hi ramps 20→40 L* spread
  const light = clamp01((skin.L - 45) / 17);
  const deep = 1 - light;
  const clear = clamp01((C - 18) / 6);
  const soft = 1 - clear;
  const hi = Number.isNaN(spread) ? 0.5 : clamp01((spread - 20) / 20);
  const lo = 1 - hi;
  // soft (muted) seasons live at medium value; 1 at L* ≈ 53, 0 at the light/deep extremes
  const medium = 1 - Math.abs(light - 0.5) * 2;

  // primary axis ×2 + undertone + a 0.5 secondary hint (the classic 12-season groupings);
  // bright seasons need lightness, deep seasons take either contrast or clarity as their flavour
  const scores: Record<Season, number> = {
    'light spring': 2 * light + warm + 0.5 * lo,
    'warm spring': 2 * warm + 0.5 * light + 0.5 * clear,
    'bright spring': 2 * clear + warm + 0.5 * light,
    'light summer': 2 * light + cool + 0.5 * soft,
    'cool summer': 2 * cool + 0.5 * light + 0.5 * soft,
    'soft summer': 2 * soft + cool + 0.5 * medium,
    'soft autumn': 2 * soft + warm + 0.5 * medium,
    'warm autumn': 2 * warm + 0.5 * deep + 0.5 * soft,
    'deep autumn': 2 * deep + warm + 0.5 * Math.max(hi, clear),
    'deep winter': 2 * deep + cool + 0.5 * Math.max(hi, clear),
    'cool winter': 2 * cool + 0.5 * deep + 0.5 * clear,
    'bright winter': 2 * clear + cool + 0.5 * hi,
  };
  let season: Season = 'soft summer';
  let best = -1;
  for (const s of SEASONS) {
    if (scores[s] > best) {
      best = scores[s];
      season = s;
    }
  }
  for (const s of SEASONS) scores[s] = Math.round(scores[s] * 100) / 100;
  return { season, scores, axes: { undertone, value, chroma: chromaAxis, contrast }, label: 'estimate' };
}

/** Full estimate from already-sampled skin (and optional hair) Lab points. */
export function estimateSkin(skinSamples: readonly Lab[], hairSamples: readonly Lab[] = []): SkinEstimate | null {
  const lab = dominantSkinCluster(skinSamples);
  if (!lab) return null;
  const hair = hairSamples.length >= 10 ? dominantSkinCluster(hairSamples, 3) : null;
  const rgb = labToSrgb(lab);
  const i = ita(lab);
  const hairRgb = hair ? labToSrgb(hair) : null;
  return {
    lab: { L: round1(lab.L), a: round1(lab.a), b: round1(lab.b) },
    srgbHex: rgbToHex(rgb.r, rgb.g, rgb.b),
    ita: round1(i),
    monk: monkFromIta(i),
    undertone: undertoneFromLab(lab),
    hueAngle: round1(hueAngle(lab)),
    chroma: round1(chroma(lab)),
    season: seasonEstimate(lab, hair),
    hairLab: hair ? { L: round1(hair.L), a: round1(hair.a), b: round1(hair.b) } : undefined,
    hairHex: hairRgb ? rgbToHex(hairRgb.r, hairRgb.g, hairRgb.b) : undefined,
    sampleCount: skinSamples.length,
    isEstimate: true,
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
