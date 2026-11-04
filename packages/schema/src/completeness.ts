/**
 * completenessScore — per-field reasons for the merchant console and the plugins' inline
 * validation (docs/DECISIONS.md D6). The backend stores `status` and `missing` on the product row.
 *
 * Weights: heavy (3) = the product cannot be fitted or rendered without it; medium (2) = fit or
 * render falls back to category defaults; light (1) = nicer taste/render output.
 * `status === 'active'` iff no heavy field is missing and `score >= ACTIVE_THRESHOLD`.
 */
import {
  CATEGORY_POINTS,
  FabricSchema,
  FitPointSchema,
  GarmentCategorySchema,
  HexColorSchema,
  SizeRowSchema,
  type FitPoint,
  type GarmentCategory,
  type GarmentPayload,
} from './garment';
import { z } from 'zod';

export type CompletenessSeverity = 'heavy' | 'medium' | 'light';
export const COMPLETENESS_WEIGHTS: Record<CompletenessSeverity, number> = { heavy: 3, medium: 2, light: 1 };
export const ACTIVE_THRESHOLD = 0.5;

export interface MissingField {
  /** Dotted payload path, e.g. `fabric.primary`, `sizeChart.shoulder`. */
  field: string;
  reason: string;
  weight: number;
  severity: CompletenessSeverity;
}

export interface CompletenessResult {
  /** 0..1, present weight / applicable weight, 3 dp. */
  score: number;
  missing: MissingField[];
  status: 'active' | 'incomplete';
  /** Every field that was applicable for this category (present or not). */
  checked: string[];
}

type Draft = Partial<GarmentPayload>;

interface Check {
  field: string;
  severity: CompletenessSeverity;
  appliesTo: readonly GarmentCategory[] | 'all';
  /** Returns null when present, otherwise the reason it counts as missing. */
  missing: (g: Draft, category: GarmentCategory | null) => string | null;
}

const ALL = 'all' as const;
const CLOTHING: readonly GarmentCategory[] = ['top', 'bottom', 'dress', 'outerwear'];
const NOT_ACCESSORY: readonly GarmentCategory[] = ['top', 'bottom', 'dress', 'outerwear', 'shoes'];

const urlSchema = z.url({ protocol: /^https?$/ });
const unit = z.number().min(0).max(1);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasPositive(row: Record<string, unknown>, key: string): boolean {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

const POINT_LABEL: Record<FitPoint, string> = {
  bust: 'bust',
  waist: 'waist',
  hip: 'hip',
  shoulder: 'shoulder',
  thigh: 'thigh',
  inseam: 'inseam',
  foot: 'footEu or footLengthCm',
};

function rowHasPoint(row: Record<string, unknown>, point: FitPoint): boolean {
  if (point === 'foot') return hasPositive(row, 'footEu') || hasPositive(row, 'footLengthCm');
  return hasPositive(row, point);
}

function sizeChartMissing(g: Draft, category: GarmentCategory | null): string | null {
  const chart = g.sizeChart as unknown;
  if (!Array.isArray(chart) || chart.length === 0) {
    return 'At least one size row is required; the fit engine scores every row to recommend a size.';
  }
  const parsed = z.array(SizeRowSchema).safeParse(chart);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return `Size chart rows are invalid${first ? ` (${first.path.join('.')}: ${first.message})` : ''}.`;
  }
  if (category === 'accessory' || category === null) return null;
  const points = CATEGORY_POINTS[category];
  const rows = chart.filter(isObject);
  const anyPoint = rows.some((row) => points.some((p) => rowHasPoint(row, p)));
  if (!anyPoint) {
    return `No row carries a measurement for this category's fit points (${points.map((p) => POINT_LABEL[p]).join(', ')}).`;
  }
  return null;
}

function chartPointCheck(point: FitPoint, categories: readonly GarmentCategory[], why: string): Check {
  return {
    field: `sizeChart.${point}`,
    severity: 'light',
    appliesTo: categories,
    missing: (g) => {
      const chart = g.sizeChart as unknown;
      if (!Array.isArray(chart) || chart.length === 0) return null; // reported by sizeChart itself
      const rows = chart.filter(isObject);
      return rows.some((row) => rowHasPoint(row, point)) ? null : why;
    },
  };
}

const CHECKS: readonly Check[] = [
  {
    field: 'category',
    severity: 'heavy',
    appliesTo: ALL,
    missing: (g) =>
      GarmentCategorySchema.safeParse(g.category).success
        ? null
        : 'category selects the fit points, ease targets and render template (top, bottom, dress, outerwear, shoes, accessory).',
  },
  {
    field: 'sizeChartType',
    severity: 'heavy',
    appliesTo: ALL,
    missing: (g) =>
      g.sizeChartType === 'garment' || g.sizeChartType === 'body'
        ? null
        : "sizeChartType must be 'garment' (rows measured on the flat garment) or 'body' (rows are the body each size is cut for). The same chart recommends a different size depending on this.",
  },
  { field: 'sizeChart', severity: 'heavy', appliesTo: ALL, missing: sizeChartMissing },
  {
    field: 'fabric.primary',
    severity: 'heavy',
    appliesTo: ALL,
    missing: (g) =>
      isObject(g.fabric) && typeof g.fabric.primary === 'string' && g.fabric.primary.trim().length > 0
        ? null
        : 'fabric.primary drives drape and texture defaults in the render and the fabric affinity in the taste engine.',
  },
  {
    field: 'flatLayPhoto',
    severity: 'heavy',
    appliesTo: ALL,
    missing: (g) =>
      typeof g.flatLayPhoto === 'string' && urlSchema.safeParse(g.flatLayPhoto).success
        ? null
        : 'flatLayPhoto (garment laid flat on white, https URL) is the input of the on-device render; without it the item cannot be shown on the user.',
  },
  {
    field: 'fabric.stretchPct',
    severity: 'medium',
    appliesTo: NOT_ACCESSORY,
    missing: (g) =>
      isObject(g.fabric) && FabricSchema.shape.stretchPct.safeParse(g.fabric.stretchPct).success
        ? null
        : 'fabric.stretchPct (0 = woven, 30 = jersey) scales the ease target and the tight limit; 0 is assumed when absent.',
  },
  {
    field: 'fabric.drape',
    severity: 'medium',
    appliesTo: NOT_ACCESSORY,
    missing: (g) =>
      isObject(g.fabric) && unit.safeParse(g.fabric.drape).success
        ? null
        : 'fabric.drape (0 = stiff, 1 = fluid) controls hem sag in the render; a fibre default is used when absent.',
  },
  {
    field: 'ease',
    severity: 'medium',
    appliesTo: CLOTHING,
    missing: (g) =>
      isObject(g.ease) && Object.values(g.ease).some((v) => typeof v === 'number' && Number.isFinite(v))
        ? null
        : 'ease (garment minus body per fit point, cm) makes the size recommendation precise; category defaults are used when absent.',
  },
  {
    field: 'lengthCm',
    severity: 'medium',
    appliesTo: CLOTHING,
    missing: (g) =>
      isObject(g.lengthCm) && Object.values(g.lengthCm).some((v) => typeof v === 'number' && v > 0)
        ? null
        : 'lengthCm (e.g. shoulder_to_hem) places the hem and sleeves on the user; without it the render uses category averages.',
  },
  {
    field: 'criticalFitPoints',
    severity: 'medium',
    appliesTo: CLOTHING,
    missing: (g) =>
      Array.isArray(g.criticalFitPoints) &&
      g.criticalFitPoints.length > 0 &&
      g.criticalFitPoints.every((p) => FitPointSchema.safeParse(p).success)
        ? null
        : 'criticalFitPoints tells the fit engine where this garment cares most (double weight); all category points weigh equally when absent.',
  },
  chartPointCheck(
    'shoulder',
    ['top', 'dress', 'outerwear'],
    'shoulder is a default fit point for this category; rows without it skip the shoulder check.',
  ),
  chartPointCheck('thigh', ['bottom'], 'thigh is a default fit point for bottoms; rows without it skip the thigh check.'),
  chartPointCheck('inseam', ['bottom'], 'inseam lets the fit engine check leg length; rows without it skip it.'),
  chartPointCheck(
    'foot',
    ['shoes'],
    'shoe rows need footEu or footLengthCm; a foot length in cm gives a finer fit than the EU size alone.',
  ),
  {
    field: 'primaryColorHex',
    severity: 'light',
    appliesTo: ALL,
    missing: (g) =>
      HexColorSchema.safeParse(g.primaryColorHex).success
        ? null
        : 'primaryColorHex feeds the colour affinity of the taste engine and the render tint.',
  },
  {
    field: 'productPhotos',
    severity: 'light',
    appliesTo: ALL,
    missing: (g) =>
      Array.isArray(g.productPhotos) && g.productPhotos.some((u) => urlSchema.safeParse(u).success)
        ? null
        : 'productPhotos are used for colour grading and texture sampling of the render.',
  },
  {
    field: 'trueToSizeScore',
    severity: 'light',
    appliesTo: NOT_ACCESSORY,
    missing: (g) =>
      unit.safeParse(g.trueToSizeScore).success
        ? null
        : 'trueToSizeScore (from past return data) narrows or widens the size tie band; 0.8 is assumed.',
  },
  {
    field: 'fabric.opacity',
    severity: 'light',
    appliesTo: NOT_ACCESSORY,
    missing: (g) =>
      isObject(g.fabric) && unit.safeParse(g.fabric.opacity).success
        ? null
        : 'fabric.opacity (0 = sheer, 1 = opaque) controls how much skin shows through in the render.',
  },
  {
    field: 'fabric.sheen',
    severity: 'light',
    appliesTo: NOT_ACCESSORY,
    missing: (g) =>
      isObject(g.fabric) && unit.safeParse(g.fabric.sheen).success
        ? null
        : 'fabric.sheen (0 = matte, 1 = shiny) controls specular highlights in the render.',
  },
  {
    field: 'colorways',
    severity: 'light',
    appliesTo: ALL,
    missing: (g) =>
      Array.isArray(g.colorways) && g.colorways.length > 0
        ? null
        : 'colorways let the user try every colour the shop sells; only the primary colour is shown when absent.',
  },
  {
    field: 'styleTags',
    severity: 'light',
    appliesTo: ALL,
    missing: (g) =>
      isObject(g.styleTags) && Object.values(g.styleTags).some((v) => typeof v === 'number')
        ? null
        : 'styleTags (0..1 per taste axis) override the inferred style of the item in the swipe deck.',
  },
];

const SEVERITY_ORDER: Record<CompletenessSeverity, number> = { heavy: 0, medium: 1, light: 2 };

/**
 * Score a (possibly partial, possibly invalid) garment payload.
 * Accepts `unknown` so plugins can call it on raw merchant input before zod validation.
 */
export function completenessScore(garment: unknown): CompletenessResult {
  const g: Draft = isObject(garment) ? (garment as Draft) : {};
  const categoryParsed = GarmentCategorySchema.safeParse(g.category);
  const category: GarmentCategory | null = categoryParsed.success ? categoryParsed.data : null;

  const missing: MissingField[] = [];
  const checked: string[] = [];
  let total = 0;
  let present = 0;

  for (const check of CHECKS) {
    // Without a valid category only the category-independent checks apply.
    if (check.appliesTo !== ALL) {
      if (category === null || !check.appliesTo.includes(category)) continue;
    }
    const weight = COMPLETENESS_WEIGHTS[check.severity];
    checked.push(check.field);
    total += weight;
    const reason = check.missing(g, category);
    if (reason === null) present += weight;
    else missing.push({ field: check.field, reason, weight, severity: check.severity });
  }

  missing.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const score = total === 0 ? 0 : Math.round((present / total) * 1000) / 1000;
  const heavyMissing = missing.some((m) => m.severity === 'heavy');
  return {
    score,
    missing,
    status: !heavyMissing && score >= ACTIVE_THRESHOLD ? 'active' : 'incomplete',
    checked,
  };
}

/** Convenience: just the dotted paths, for the `missing_fields text[]` column. */
export function missingFields(garment: unknown): string[] {
  return completenessScore(garment).missing.map((m) => m.field);
}
