/**
 * Stage 6 — grading (docs/ENGINE-HANDOFF.md). Every other size is a deformation of the calibrated
 * base mesh: per size and anchor a target girth or length = base + (chart[size] − chart[base]);
 * anchors without a chart column take a standard grading increment per size step and are logged as
 * an estimate. Per size only these targets are stored (grading.json); the device morphs the base
 * mesh with `gradingMorph` from `@curtain/anchors` (radially about each chain's axis, smoothly
 * between neighbouring rings), which `applyGrading` reproduces here.
 *
 * The breadth `shoulder_width` (D15 amendment, R1) is carried as its own target: the chart's
 * shoulder column is a width, never the `shoulder` ring. Its base value is the chart's (a
 * reconstruction has no seams to measure). When the chart has no shoulder girth, the `shoulder`
 * ring grades by the width ratio (`breadth`, an estimate): the radial morph scales a cross-section
 * uniformly, so the seams at ±width/2 land exactly on the target width.
 */
import { BREADTH_RING, gradeSizes, isAnchorBreadth, type AnchorBreadth, type AnchorId, type AnchorLength, type AnchorRing, type AnchorValues } from '@curtain/anchors';
import { sizeLabelKey } from '@curtain/schema';
import type { Mannequin, Mesh } from '@curtain/mannequin';
import type { AnchorMeasurements } from './anchoring';
import { lengthMorph, radialMorph, type ChainAssignment } from './garment';
import type { GarmentChart } from './product';

/**
 * Standard women's wear grading increments per size step (cm), used where the chart has no column.
 * Typical industry values for alpha sizes (XS…XL, about 4 cm bust per step); an estimate, logged
 * per anchor in grading.json. Phase 1 replaces this with per-category rules.
 */
export const STANDARD_INCREMENTS_CM: Readonly<Record<AnchorId, number>> = {
  neck: 1,
  shoulder: 2,
  chest: 4,
  underbust: 4,
  waist: 4,
  hip: 4,
  thigh: 2.5,
  knee: 1.5,
  calf: 1.5,
  ankle: 0.5,
  upper_arm: 1.5,
  wrist: 0.5,
  shoulder_to_waist: 0.5,
  shoulder_to_hem: 1,
  waist_to_hem: 1, // the waist stays put, so the hem moves both lengths alike
  sleeve: 0.5,
  inseam: 0,
  rise: 0.5,
  shoulder_width: 1,
};

export type TargetSource = 'chart' | 'increment' | 'hip-delta' | 'breadth';

export interface SizeGrading {
  size: string;
  /** Size steps from the base size (negative = smaller). */
  step: number;
  targets: AnchorValues;
  sources: Partial<Record<AnchorId, TargetSource>>;
}

export interface GradingJson {
  format: 'curtain.garment.grading';
  formatVersion: 1;
  productId: string;
  baseSize: string;
  unit: 'cm';
  /** How the device applies the targets. */
  morph: {
    method: 'anchors.gradingMorph';
    chains: { body: 'radial about +Y'; arm: 'radial about the arm axis' };
    heights: Record<AnchorRing, number>;
    /** Breadths: the ring whose height they sit at; the seams are at ±width/2 there (`shoulderSeams`). */
    breadths?: Partial<Record<AnchorBreadth, { ring: AnchorRing; height: number }>>;
  };
  /** Calibrated base-size value per anchor. */
  base: AnchorValues;
  sizes: SizeGrading[];
  /** Anchors whose targets are estimates (no chart column), with the rule used. */
  estimates: Partial<Record<AnchorId, TargetSource>>;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function gradeGarment(m: Mannequin, chart: GarmentChart, baseSize: string, base: AnchorMeasurements): GradingJson {
  const baseIdx = chart.rows.findIndex((r) => sizeLabelKey(r.size) === sizeLabelKey(baseSize));
  if (baseIdx < 0) throw new Error(`base size ${baseSize} not in the chart`);
  const baseRow = chart.rows[baseIdx]!;
  const baseValues: AnchorValues = {};
  const spansBothLegs = new Set<AnchorRing>();
  for (const [id, r] of Object.entries(base.rings) as [AnchorRing, NonNullable<AnchorMeasurements['rings'][AnchorRing]>][]) {
    baseValues[id] = r.circumferenceCm;
    if (r.spansBothLegs) spansBothLegs.add(id);
  }
  for (const [id, l] of Object.entries(base.lengths) as [AnchorLength, NonNullable<AnchorMeasurements['lengths'][AnchorLength]>][]) {
    if (!l.fromMannequin) baseValues[id] = l.lengthCm;
  }
  // Breadths come from the chart at the base size (the calibration target; no seams on a mesh).
  for (const [id, w] of Object.entries(baseRow.breadths) as [AnchorBreadth, number][]) baseValues[id] = w;
  const chartValue = (row: GarmentChart['rows'][number], id: AnchorId): number | undefined =>
    isAnchorBreadth(id) ? row.breadths[id] : (row.rings as Partial<Record<AnchorId, number>>)[id];
  // A breadth's ring without a girth column of its own grades with the breadth.
  const ringOfBreadth = new Map<AnchorRing, AnchorBreadth>();
  for (const id of Object.keys(baseRow.breadths) as AnchorBreadth[]) ringOfBreadth.set(BREADTH_RING[id], id);
  const estimates: GradingJson['estimates'] = {};
  const sizes: SizeGrading[] = chart.rows.map((row, i) => {
    const step = i - baseIdx;
    const targets: AnchorValues = {};
    const sources: SizeGrading['sources'] = {};
    for (const [id, b] of Object.entries(baseValues) as [AnchorId, number][]) {
      const ringId = id as AnchorRing;
      const chartNow = chartValue(row, id);
      const chartBase = chartValue(baseRow, id);
      const breadth = ringOfBreadth.get(ringId);
      const wNow = breadth && row.breadths[breadth];
      const wBase = breadth && baseRow.breadths[breadth];
      let value: number;
      let source: TargetSource;
      if (chartNow !== undefined && chartBase !== undefined) {
        value = b + chartNow - chartBase;
        source = 'chart';
      } else if (wNow !== undefined && wBase !== undefined && wBase > 0) {
        value = b * (wNow / wBase); // the ring scales with its breadth (uniform cross-section scale)
        source = 'breadth';
      } else if (spansBothLegs.has(ringId) && row.rings.hip !== undefined && baseRow.rings.hip !== undefined) {
        value = b + row.rings.hip - baseRow.rings.hip; // a skirt grades with the hip
        source = 'hip-delta';
      } else {
        value = b + step * STANDARD_INCREMENTS_CM[id];
        source = 'increment';
      }
      targets[id] = round2(value);
      sources[id] = source;
      if (source !== 'chart') estimates[id] = source;
    }
    return { size: row.size, step, targets, sources };
  });
  // Same duplicate-label rule as the device (throws on a repeated size).
  gradeSizes(baseValues, sizes.map((s) => ({ size: s.size, target: s.targets })), { heights: m.morphHeights });
  const heights = {} as Record<AnchorRing, number>;
  for (const [k, v] of Object.entries(m.morphHeights) as [AnchorRing, number][]) heights[k] = round2(v);
  const breadths: NonNullable<GradingJson['morph']['breadths']> = {};
  for (const id of Object.keys(baseRow.breadths) as AnchorBreadth[]) breadths[id] = { ring: BREADTH_RING[id], height: heights[BREADTH_RING[id]] };
  const roundedBase: AnchorValues = {};
  for (const [k, v] of Object.entries(baseValues) as [AnchorId, number][]) roundedBase[k] = round2(v);
  return {
    format: 'curtain.garment.grading',
    formatVersion: 1,
    productId: chart.productId,
    baseSize,
    unit: 'cm',
    morph: { method: 'anchors.gradingMorph', chains: { body: 'radial about +Y', arm: 'radial about the arm axis' }, heights, ...(Object.keys(breadths).length ? { breadths } : {}) },
    base: roundedBase,
    sizes,
    estimates,
  };
}

/** The base mesh morphed to one size's targets (what the device does with grading.json). */
export function applyGrading(m: Mannequin, baseMesh: Mesh, chains: ChainAssignment, grading: GradingJson, size: string): Mesh {
  const entry = grading.sizes.find((s) => sizeLabelKey(s.size) === sizeLabelKey(size));
  if (!entry) throw new Error(`size ${size} not graded`);
  const [morph] = gradeSizes(grading.base, [{ size: entry.size, target: entry.targets }], { heights: m.morphHeights });
  const girths = radialMorph(m, baseMesh, chains, morph!);
  return lengthMorph(
    m,
    girths,
    chains,
    { shoulderToHem: grading.base.shoulder_to_hem, sleeve: grading.base.sleeve },
    { shoulderToHem: entry.targets.shoulder_to_hem, sleeve: entry.targets.sleeve },
  );
}
