/**
 * The size chart of any Phase 0 product as garment girths per anchor ring, for the evaluation of a
 * reconstructed garment. `product.ts` `garmentChart` does the same for the spike's two schema
 * fixtures and accepts only dresses and tops; the shop validation set also has trousers, a skirt and
 * a cardigan. Same rules: a garment chart is used as is; a body chart gets the ease the fit engine uses
 * (`easeTargetFor`: the product's ease, else the pattern block's `BLOCKS` ease, else the category default
 * `CATEGORY_EASE`), and every ring that used a default is listed. Only the category's rings are kept
 * (`CATEGORY_ANCHORS`): the AU body chart lists a bust for trousers too. A test checks that both give the
 * same chart for the spike products.
 *
 * Before drape-prior P0 the block ease was left out (product ease, else the category default): an oversized
 * cardigan's chest was 102 cm here and in its control proxy while `computeFit` sized it as 104 (block
 * `oversized`, bust +14), a shirt blouse 103 against 105, an A-line skirt's waist 79.5 against 80.5. The picture and
 * the size advice must not contradict each other (D15; docs/PREDICTION-ENGINE.md §2 test 2).
 */
import { CATEGORY_ANCHORS, FIT_POINT_TO_ANCHOR, isAnchorRing, type AnchorBreadth, type AnchorCategory, type AnchorRing } from '@curtain/anchors';
import { CATEGORY_POINTS, blockRule, easeTargetFor, type FitGarment, type Point } from '@curtain/fit-engine';
import { duplicateSizeLabels, sizeLabelKey, type GarmentPayload } from '@curtain/schema';
import type { SpikeCategory } from './garment';
import type { ChartRow, GarmentChart } from './product';

/** Categories the evaluation handles (the clothing categories of `@curtain/anchors`). */
export const EVAL_CATEGORIES = ['dress', 'top', 'outerwear', 'bottom'] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export function isEvalCategory(c: string): c is EvalCategory {
  return (EVAL_CATEGORIES as readonly string[]).includes(c);
}

/** Chart girth points that are anchor rings; the chart's `shoulder` is a width (D15 breadth), never the ring. */
const GIRTH_POINTS = ['bust', 'waist', 'hip', 'thigh'] as const;
type GirthPoint = (typeof GIRTH_POINTS)[number];

export interface EvalChart extends Omit<GarmentChart, 'category'> {
  category: EvalCategory;
  /** Where every value came from, for the report. */
  provenance: string;
  /**
   * Rings the product's pattern block does not fit (the fit engine's `BLOCKS[block].skip`, e.g. an
   * empire line hangs from the bust: no waist, no hip). Their chart value stays for grading, but they
   * are neither critical nor calibrated against: the garment is not meant to sit there.
   */
  notFitted: { rings: AnchorRing[]; block: string; label: string } | null;
}

/**
 * The chart's ease for one point, as the fit engine takes it (`easeTargetFor`): the product's, else the pattern
 * block's, else the category default, else none. `isDefault`: not the product's own; `fromBlock`: the block's.
 */
export function easeFor(p: GarmentPayload, category: EvalCategory, point: GirthPoint | 'shoulder'): { ease: number; isDefault: boolean; fromBlock: boolean } | null {
  const own = (p.ease as Partial<Record<string, number>> | undefined)?.[point];
  if (own !== undefined) return { ease: own, isDefault: false, fromBlock: false };
  const garment = { ...p, category, fabric: p.fabric ?? { stretchPct: 0 } } as unknown as FitGarment;
  const e = easeTargetFor(garment, point as Point);
  if (e === undefined) return null;
  const fromBlock = (blockRule(p.patternBlock).ease as Partial<Record<string, number>>)[point] !== undefined;
  return { ease: e, isDefault: true, fromBlock };
}

export function evalChart(p: GarmentPayload): EvalChart {
  if (!isEvalCategory(p.category)) throw new Error(`no evaluation for category ${p.category}`);
  const dup = duplicateSizeLabels(p.sizeChart);
  if (dup.length > 0) throw new Error(`duplicate size labels: ${dup.join(', ')}`);
  const category = p.category;
  const type = p.sizeChartType === 'garment' ? 'garment' : 'body';
  // Only rings the category's garment has (an AU body chart lists the bust for trousers too).
  const ringSubset = new Set<AnchorRing>(CATEGORY_ANCHORS[category].rings);
  const hasBreadth = CATEGORY_ANCHORS[category].breadths.includes('shoulder_width');
  const rows: ChartRow[] = p.sizeChart.map((row) => {
    const rings: Partial<Record<AnchorRing, number>> = {};
    const defaultEase: AnchorRing[] = [];
    const blockEase: AnchorRing[] = [];
    for (const point of GIRTH_POINTS) {
      const v = row[point];
      if (v === undefined) continue;
      const anchor = FIT_POINT_TO_ANCHOR[point] as AnchorRing;
      if (!ringSubset.has(anchor)) continue;
      if (type === 'garment') {
        rings[anchor] = v;
        continue;
      }
      const e = easeFor(p, category, point);
      if (e?.isDefault) defaultEase.push(anchor);
      if (e?.fromBlock) blockEase.push(anchor);
      rings[anchor] = v + (e?.ease ?? 0);
    }
    const breadths: Partial<Record<AnchorBreadth, number>> = {};
    const defaultEaseBreadths: AnchorBreadth[] = [];
    const sw = row.shoulder;
    if (sw !== undefined && hasBreadth) {
      if (type === 'garment') breadths.shoulder_width = sw;
      else {
        const e = easeFor(p, category, 'shoulder');
        if (e?.isDefault) defaultEaseBreadths.push('shoulder_width');
        breadths.shoulder_width = sw + (e?.ease ?? 0);
      }
    }
    return { size: row.size, rings, defaultEase, ...(blockEase.length ? { blockEase } : {}), breadths, defaultEaseBreadths };
  });
  const provenance = type === 'garment' ? 'garment chart, as printed' : `body chart + ${p.ease && Object.keys(p.ease).length ? `product ease (${Object.entries(p.ease).map(([k, v]) => `${k} +${v} cm`).join(', ')}) and ` : ''}the fit engine's default ease where the product gives none (pattern block ${p.patternBlock ? `"${p.patternBlock}"` : 'none'}, else the category default)`;
  const rule = blockRule(p.patternBlock);
  const named = new Set<string>(p.criticalFitPoints ?? []);
  // As `computeFit`: a point the product names as critical is checked even when its block skips it.
  const skipRings = rule.skip.filter((pt) => !named.has(pt)).map((pt) => (FIT_POINT_TO_ANCHOR as Partial<Record<string, string>>)[pt]).filter((a): a is AnchorRing => !!a && isAnchorRing(a) && ringSubset.has(a));
  const notFitted = skipRings.length && p.patternBlock ? { rings: skipRings, block: p.patternBlock, label: rule.label } : null;
  return { productId: p.id, category, type, rows, provenance, notFitted };
}

export function evalChartRow(chart: EvalChart, size: string): ChartRow {
  const row = chart.rows.find((r) => sizeLabelKey(r.size) === sizeLabelKey(size));
  if (!row) throw new Error(`size ${size} not in the chart of ${chart.productId}`);
  return row;
}

/**
 * The chart as `grading.ts` takes it. Grading never reads the category; the spike's type only
 * lists dress and top because the synthetic garments are only those two.
 */
export function asGradingChart(chart: EvalChart): GarmentChart {
  return { productId: chart.productId, category: chart.category as SpikeCategory, type: chart.type, rows: chart.rows };
}

/**
 * Critical anchors for chart agreement: the product's `criticalFitPoints` when it names any, else
 * the fit engine's points for the category minus the points its pattern block skips (as
 * `computeFit` does); only rings, and only rings the chart has a value for.
 */
export function criticalRings(p: GarmentPayload, chart: EvalChart, baseSize: string): AnchorRing[] {
  const points: readonly string[] = p.criticalFitPoints && p.criticalFitPoints.length ? p.criticalFitPoints : (CATEGORY_POINTS[chart.category as AnchorCategory & keyof typeof CATEGORY_POINTS] ?? []);
  const base = evalChartRow(chart, baseSize).rings;
  const out: AnchorRing[] = [];
  for (const point of points) {
    const a = (FIT_POINT_TO_ANCHOR as Partial<Record<string, string>>)[point];
    if (a && isAnchorRing(a) && base[a] !== undefined && !out.includes(a) && !chart.notFitted?.rings.includes(a)) out.push(a);
  }
  return out;
}
