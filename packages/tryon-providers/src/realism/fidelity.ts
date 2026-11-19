/**
 * "The AI layer does not lie" (D22, docs/research/ai-realism-layer.md §2): compare the AI image with
 * the 3D estimate it was made from and refuse the image when it changed the silhouette, the garment's
 * outline, its colour, the hem or the waist, or no longer tells the shown size from its neighbour.
 * Pure (no I/O, no dependencies); every number is in the report the route returns.
 *
 * Segmentation of the AI image is deliberately simple and deterministic:
 *  - figure = pixels that differ from the flat backdrop by more than `backdropKeyDeltaE` (the provider
 *    is asked to keep the backdrop; a provider that repaints it fails the silhouette check, which is
 *    the safe direction);
 *  - garment = figure pixels within `garmentKeyDeltaE` of the AI image's own median garment colour,
 *    taken inside the 3D garment mask shrunk by `erodePx` (so a recoloured garment is still found and
 *    then fails on colour, not on outline).
 * This works for plain-colour garments (the drape bake is drawn in one plain colour). A garment that
 * is too close to the skin or the backdrop cannot be verified this way and is refused as
 * `unverifiable`, never passed unchecked.
 */
import { deltaE2000, deltaE76, hexToRgb, srgbToLab, type Lab } from './colour.js';
import type { MaskImage, RenderPasses, RgbaImage } from './passes.js';

export const FIDELITY_THRESHOLDS = {
  /** Figure IoU (AI figure vs 3D figure) must be at least this. */
  silhouetteIoU: 0.9,
  /** Garment IoU (AI garment vs 3D garment) must be at least this. */
  garmentIoU: 0.85,
  /** CIEDE2000 between the median garment colour of the AI image and of the 3D colour pass. */
  colourDeltaE00: 5,
  /** The hem may move at most this far, cm. */
  hemShiftCm: 1.5,
  /** The garment's waist line may move at most this far, cm. */
  waistShiftCm: 2,
  /** Front width of the garment at the waist and hip rows may change at most this much, cm. */
  widthDeltaCm: 1.5,
  /** Size-to-size: the AI value must stay within this share of the gap between shown and neighbour size. */
  sizeSeparationShare: 0.5,
  /** A size difference smaller than this (cm) is not visible in 3D either and is not checked. */
  minVisibleGapCm: 0.5,
  /** Segmentation keys (CIE76). */
  backdropKeyDeltaE: 8,
  garmentKeyDeltaE: 14,
  /** The garment must differ this much (CIE76) from the backdrop and from the body in the 3D colour pass to be verifiable. */
  minGarmentContrast: 12,
  erodePx: 3,
} as const;

export type FidelityThresholds = { -readonly [K in keyof typeof FIDELITY_THRESHOLDS]: number };

export type RefusalReason =
  | 'dimensions'
  | 'unverifiable'
  | 'silhouette'
  | 'garment_outline'
  | 'colour'
  | 'hem'
  | 'waist'
  | 'width'
  | 'size_difference';

export interface FeatureSet {
  /** Lowest garment row, px. */
  hemRow: number;
  /** Waist line row, px: a bottom's top edge, else the narrowest garment row near the waist ring. */
  waistLineRow: number;
  /** Garment front width at the waist / hip ring rows, px. */
  waistWidth: number;
  hipWidth: number;
}

export interface SizeSeparation {
  neighbour: string;
  /** Per feature: the 3D gap shown→neighbour and how far the AI is from the shown size, cm. */
  features: Array<{ feature: keyof FeatureSet; gapCm: number; offCm: number; ok: boolean }>;
  visible: boolean;
  ok: boolean;
}

export interface FidelityReport {
  ok: boolean;
  reasons: RefusalReason[];
  metrics: {
    silhouetteIoU: number;
    garmentIoU: number;
    colourDeltaE00: number;
    hemShiftCm: number;
    waistShiftCm: number;
    waistWidthDeltaCm: number;
    hipWidthDeltaCm: number;
    pxPerCm: number;
  } | null;
  sizeSeparation: SizeSeparation | null;
  thresholds: FidelityThresholds;
}

const on = (m: MaskImage, i: number): boolean => m.data[i]! >= 128;

export function iou(a: MaskImage, b: MaskImage): number {
  let inter = 0, union = 0;
  for (let i = 0; i < a.data.length; i++) {
    const x = a.data[i]! >= 128, y = b.data[i]! >= 128;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union === 0 ? 0 : inter / union;
}

/** Square erosion by `r` px (separable min). */
export function erode(m: MaskImage, r: number): MaskImage {
  const { width: w, height: h } = m;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let ok = 255;
      for (let d = -r; d <= r && ok; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w || m.data[y * w + xx]! < 128) ok = 0;
      }
      tmp[y * w + x] = ok;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let ok = 255;
      for (let d = -r; d <= r && ok; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h || tmp[yy * w + x]! < 128) ok = 0;
      }
      out[y * w + x] = ok;
    }
  return { width: w, height: h, data: out };
}

const rowCount = (m: MaskImage, y: number): number => {
  let c = 0;
  for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]! >= 128) c++;
  return c;
};

/** Rows that hold at least `minPx` mask pixels (stray pixels do not make a hem). */
function rowSpan(m: MaskImage, minPx: number): { top: number; bottom: number } | null {
  let top = -1, bottom = -1;
  for (let y = 0; y < m.height; y++) {
    if (rowCount(m, y) >= minPx) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return top < 0 ? null : { top, bottom };
}

/** Mean width over rows y-2..y+2. */
function widthAt(m: MaskImage, y: number): number {
  let s = 0, k = 0;
  for (let yy = Math.max(0, y - 2); yy <= Math.min(m.height - 1, y + 2); yy++) {
    s += rowCount(m, yy);
    k++;
  }
  return k ? s / k : 0;
}

export function featuresOf(garment: MaskImage, meta: Pick<RenderPasses['meta'], 'waistRow' | 'hipRow' | 'category'>, pxPerCm: number): FeatureSet | null {
  const span = rowSpan(garment, 3);
  if (!span) return null;
  let waistLineRow = span.top;
  if (meta.category !== 'bottom') {
    // The middle of the narrowest band of garment rows within ±8 cm of the waist ring: every row
    // within 1 px (plus 1 %) of the minimum width counts, so a straight torso gives a stable row.
    const band = Math.round(8 * pxPerCm);
    const y0 = Math.max(span.top, meta.waistRow - band), y1 = Math.min(span.bottom, meta.waistRow + band);
    const widths: Array<[number, number]> = [];
    for (let y = y0; y <= y1; y++) {
      const wdt = widthAt(garment, y);
      if (wdt > 0) widths.push([y, wdt]);
    }
    if (widths.length) {
      const min = Math.min(...widths.map((r) => r[1]));
      const rows = widths.filter((r) => r[1] <= min + 1 + 0.01 * min).map((r) => r[0]);
      waistLineRow = Math.round(rows.reduce((a, b) => a + b, 0) / rows.length);
    } else waistLineRow = meta.waistRow;
  }
  return { hemRow: span.bottom, waistLineRow, waistWidth: widthAt(garment, meta.waistRow), hipWidth: widthAt(garment, meta.hipRow) };
}

function medianLab(img: RgbaImage, mask: MaskImage): Lab | null {
  const L: number[] = [], A: number[] = [], B: number[] = [];
  const d = img.data;
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]! < 128) continue;
    const lab = srgbToLab(d[4 * i]!, d[4 * i + 1]!, d[4 * i + 2]!);
    L.push(lab[0]);
    A.push(lab[1]);
    B.push(lab[2]);
  }
  if (L.length === 0) return null;
  const med = (v: number[]): number => {
    v.sort((x, y) => x - y);
    return v[v.length >> 1]!;
  };
  return [med(L), med(A), med(B)];
}

/** AI figure: pixels away from the backdrop. */
export function figureOf(img: RgbaImage, backdropHex: string, keyDeltaE: number): MaskImage {
  const bd = srgbToLab(...hexToRgb(backdropHex));
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) {
    out[i] = deltaE76(srgbToLab(img.data[4 * i]!, img.data[4 * i + 1]!, img.data[4 * i + 2]!), bd) > keyDeltaE ? 255 : 0;
  }
  return { width: img.width, height: img.height, data: out };
}

/** AI garment: figure pixels near the reference colour. */
export function garmentOf(img: RgbaImage, figure: MaskImage, ref: Lab, keyDeltaE: number): MaskImage {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) {
    if (!on(figure, i)) continue;
    out[i] = deltaE76(srgbToLab(img.data[4 * i]!, img.data[4 * i + 1]!, img.data[4 * i + 2]!), ref) <= keyDeltaE ? 255 : 0;
  }
  return { width: img.width, height: img.height, data: out };
}

const minus = (a: MaskImage, b: MaskImage): MaskImage => ({ width: a.width, height: a.height, data: a.data.map((v, i) => (v >= 128 && b.data[i]! < 128 ? 255 : 0)) });

const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

/** Compare the AI image with the passes it was made from. Pure. */
export function checkFidelity(passes: RenderPasses, ai: RgbaImage, overrides: Partial<FidelityThresholds> = {}): FidelityReport {
  const t: FidelityThresholds = { ...FIDELITY_THRESHOLDS, ...overrides };
  const refuse = (reason: RefusalReason): FidelityReport => ({ ok: false, reasons: [reason], metrics: null, sizeSeparation: null, thresholds: t });
  if (ai.width !== passes.width || ai.height !== passes.height || ai.data.length !== passes.width * passes.height * 4) return refuse('dimensions');

  const figure3d = passes.figureMask;
  const garment3d = passes.garmentMask;
  const span = rowSpan(figure3d, 2);
  if (!span) return refuse('unverifiable');
  const pxPerCm = (span.bottom - span.top + 1) / passes.meta.statureCm;

  // Can the garment be told apart by colour at all?
  const core = erode(garment3d, t.erodePx);
  const garmentLab3d = medianLab(passes.colour, core);
  const bodyLab3d = medianLab(passes.colour, erode(minus(figure3d, garment3d), t.erodePx));
  const backdropLab = srgbToLab(...hexToRgb(passes.meta.backdropHex));
  if (!garmentLab3d || deltaE76(garmentLab3d, backdropLab) < t.minGarmentContrast || (bodyLab3d && deltaE76(garmentLab3d, bodyLab3d) < t.minGarmentContrast)) return refuse('unverifiable');

  const figureAi = figureOf(ai, passes.meta.backdropHex, t.backdropKeyDeltaE);
  const garmentLabAi = medianLab(ai, core);
  if (!garmentLabAi) return refuse('unverifiable');
  const garmentAi = garmentOf(ai, figureAi, garmentLabAi, t.garmentKeyDeltaE);

  const silhouetteIoU = iou(figureAi, figure3d);
  const garmentIoU = iou(garmentAi, garment3d);
  const colourDeltaE00 = deltaE2000(garmentLab3d, garmentLabAi);

  const f3d = featuresOf(garment3d, passes.meta, pxPerCm);
  const fAi = featuresOf(garmentAi, passes.meta, pxPerCm);
  if (!f3d || !fAi) return refuse('unverifiable');
  const cm = (px: number): number => px / pxPerCm;
  const hemShiftCm = cm(Math.abs(fAi.hemRow - f3d.hemRow));
  const waistShiftCm = cm(Math.abs(fAi.waistLineRow - f3d.waistLineRow));
  const waistWidthDeltaCm = cm(Math.abs(fAi.waistWidth - f3d.waistWidth));
  const hipWidthDeltaCm = cm(Math.abs(fAi.hipWidth - f3d.hipWidth));

  const reasons: RefusalReason[] = [];
  if (silhouetteIoU < t.silhouetteIoU) reasons.push('silhouette');
  if (garmentIoU < t.garmentIoU) reasons.push('garment_outline');
  if (colourDeltaE00 > t.colourDeltaE00) reasons.push('colour');
  if (hemShiftCm > t.hemShiftCm) reasons.push('hem');
  if (waistShiftCm > t.waistShiftCm) reasons.push('waist');
  if (waistWidthDeltaCm > t.widthDeltaCm || hipWidthDeltaCm > t.widthDeltaCm) reasons.push('width');

  let sizeSeparation: SizeSeparation | null = null;
  if (passes.neighbour) {
    const fN = featuresOf(passes.neighbour.garmentMask, passes.meta, pxPerCm);
    if (fN) {
      const keys: Array<keyof FeatureSet> = ['hemRow', 'waistWidth', 'hipWidth'];
      const features = keys.map((k) => {
        const gapCm = cm(Math.abs(fN[k] - f3d[k]));
        const offCm = cm(Math.abs(fAi[k] - f3d[k]));
        return { feature: k, gapCm: round(gapCm, 2), offCm: round(offCm, 2), ok: gapCm < t.minVisibleGapCm || offCm < t.sizeSeparationShare * gapCm };
      });
      const visible = features.some((x) => x.gapCm >= t.minVisibleGapCm);
      sizeSeparation = { neighbour: passes.neighbour.size, features, visible, ok: features.every((x) => x.ok) };
      if (!sizeSeparation.ok) reasons.push('size_difference');
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      silhouetteIoU: round(silhouetteIoU),
      garmentIoU: round(garmentIoU),
      colourDeltaE00: round(colourDeltaE00, 2),
      hemShiftCm: round(hemShiftCm, 2),
      waistShiftCm: round(waistShiftCm, 2),
      waistWidthDeltaCm: round(waistWidthDeltaCm, 2),
      hipWidthDeltaCm: round(hipWidthDeltaCm, 2),
      pxPerCm: round(pxPerCm, 3),
    },
    sizeSeparation,
    thresholds: t,
  };
}
