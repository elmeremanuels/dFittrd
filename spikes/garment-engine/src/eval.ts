/**
 * Phase 0 evaluation of one reconstructed garment (docs/ENGINE-HANDOFF.md §Phase 0, stages 5–6 and
 * the QA of stage 7): the stage 4 mesh on the base mannequin, measured at every anchor ring of its
 * category, calibrated against the product's chart (body chart + ease, or garment chart), the error
 * per anchor before and after calibration, the lengths against what the shop printed, grading to
 * every size in the chart, and mesh health.
 *
 * Uses the spike's stage 5/6 code unchanged (`measureGarment`, `calibrate`, `applyCalibration`,
 * `chartAgreement`, `gradeGarment`). What it adds: categories beyond dress and top, a per-anchor
 * table, plausibility flags, and honest labels for where the mesh came from.
 *
 * Read the numbers with this in mind: after the per-ring calibration the chart agreement is close
 * to 0 by construction (each critical ring is scaled to its chart value). The numbers that say
 * something about the reconstruction are the error **before** calibration and the residual after
 * the **global scale** alone.
 */
import { createHash } from 'node:crypto';
import { type AnchorLength, type AnchorRing } from '@curtain/anchors';
import { BASE_SHAPE_ID, MANNEQUIN_VERSION, bodyShape, buildMannequin, type Mannequin, type Mesh } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { applyCalibration, calibrate, chartAgreement, measureGarment, ringGirths, type AnchorMeasurements, type Calibration, type ChartAgreement } from './anchoring';
import { DEFAULT_DISTORTION } from './bundle';
import { asGradingChart, criticalRings, evalChart, evalChartRow, type EvalCategory, type EvalChart } from './evalChart';
import { meshHealth, type MeshHealth } from './evalMesh';
import { assignChains, distortGarment, type ChainAssignment, type Distortion, type SpikeCategory } from './garment';
import { gradeGarment, type GradingJson } from './grading';

export const EVAL_VERSION = 'phase0-eval-0.1.0';
/** Phase 0 acceptance: calibrated circumference within ±2 cm of the chart at the critical anchors. */
export const CHART_TOLERANCE_CM = 2;
/** A global scale further than this from 1 means the reconstruction's size (or its unit) is off, not just its shape. */
export const GLOBAL_SCALE_WARN = 0.1;
/** A per-ring correction outside 1 ± this means calibration reshaped the garment, not just nudged it. */
export const RING_CORRECTION_WARN = 0.08;

/** Where the evaluated mesh came from. Only `stage4` is a real result for a product. */
export type MeshSourceKind = 'stage4' | 'stage4-synthetic' | 'synthetic-truth';

export interface MeshSource {
  kind: MeshSourceKind;
  /** Path relative to the job dir. */
  path: string;
  sha256: string;
  /** Applied to the mesh before evaluation (`synthetic-truth` only): the spike's simulated reconstruction error. */
  simulatedError: Distortion | null;
}

export const SOURCE_LABEL: Readonly<Record<MeshSourceKind, string>> = {
  stage4: 'stage 4 reconstruction of the stage 2 video (GPU output)',
  'stage4-synthetic': 'stage 4 reconstruction of the synthetic frames (tests the reconstruction only, not a product result)',
  'synthetic-truth': "the spike's synthetic ground-truth garment with its simulated reconstruction error (tests this tooling only, not a product result)",
};

export interface AnchorRow {
  anchor: AnchorRing;
  critical: boolean;
  /** Chart girth at the base size, cm (garment girth: body + ease, or garment chart). */
  chartCm: number | null;
  /** Ease added to a body chart value, and whether it is the category default. */
  ease: { cm: number; isDefault: boolean } | null;
  /** Girth of the mesh as reconstructed, cm; null = no closed loop around the ring. */
  measuredCm: number | null;
  /** measured − chart before any calibration. */
  beforeCm: number | null;
  /** measured × global scale − chart. */
  afterGlobalCm: number | null;
  /** Re-measured on the calibrated mesh − chart. */
  afterCm: number | null;
  /** Critical rings only: |after| ≤ tolerance (false when there is no loop). */
  pass: boolean | null;
  note: string | null;
}

export interface LengthRow {
  id: string;
  measuredCm: number | null;
  /** What the shop printed (payload `lengthCm`), cm. */
  printedCm: number | null;
  diffCm: number | null;
  note: string | null;
}

export interface EvalResult {
  productId: string;
  category: EvalCategory;
  baseSize: string;
  source: MeshSource;
  chart: EvalChart;
  critical: AnchorRing[];
  rows: AnchorRow[];
  lengths: LengthRow[];
  calibration: Calibration;
  /** Acceptance item "chart agreement" on the calibrated mesh. */
  agreement: ChartAgreement & { missing: AnchorRing[] };
  /** The same test before calibration and after the global scale only (diagnostics). */
  before: { maxAbsCm: number | null; pass: boolean };
  afterGlobal: { maxAbsCm: number | null; pass: boolean };
  warnings: string[];
  health: MeshHealth;
  grading: GradingJson | null;
  gradingError: string | null;
  mannequin: Mannequin;
  /** The mesh as evaluated (after the simulated error for a synthetic truth). */
  reconstructed: Mesh;
  /** Calibrated base-size mesh: the asset's base.glb. */
  baseMesh: Mesh;
  chains: ChainAssignment;
  measurements: AnchorMeasurements;
  timingsMs: { measure: number; calibrate: number; grade: number };
}

const r2 = (x: number): number => Math.round(x * 100) / 100 + 0; // + 0 turns -0 into 0
const maxAbs = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v.map(Math.abs)) : null;
};

export function meshSha256(mesh: Mesh): string {
  return createHash('sha256').update(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength)).update(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength)).digest('hex');
}

/** Lowest and highest body-chain vertex, cm (for the outseam of trousers). */
function verticalExtent(mesh: Mesh, chains: ChainAssignment): { minY: number; maxY: number } {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < chains.length; i++) {
    if (chains[i] !== 0) continue;
    const y = mesh.positions[3 * i + 1]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minY, maxY };
}

/** Payload `lengthCm` keys → the measured length that answers them. */
const LENGTH_KEYS: Readonly<Record<string, AnchorLength | 'outseam'>> = {
  shoulder_to_hem: 'shoulder_to_hem',
  shoulder_to_waist: 'shoulder_to_waist',
  waist_to_hem: 'waist_to_hem',
  sleeve_length: 'sleeve',
  outseam: 'outseam',
};

/**
 * Grading chains of a garment. A bottom has no sleeves: everything follows the body chain
 * (`assignChains` would put waist-side vertices on the arms, since the A-pose elbows hang at waist height).
 */
export function garmentChains(m: Mannequin, mesh: Mesh, category: EvalCategory): ChainAssignment {
  return category === 'bottom' ? new Uint8Array(mesh.positions.length / 3) : assignChains(m, mesh);
}

export interface EvaluateOptions {
  productId: string;
  payload: GarmentPayload;
  baseSize: string;
  /** The garment in mannequin space (cm), on the base mannequin (M) in A-pose. */
  mesh: Mesh;
  source: Omit<MeshSource, 'sha256'>;
  mannequin?: Mannequin;
  toleranceCm?: number;
}

export function evaluateGarment(o: EvaluateOptions): EvalResult {
  const m = o.mannequin ?? buildMannequin(bodyShape(BASE_SHAPE_ID));
  const tol = o.toleranceCm ?? CHART_TOLERANCE_CM;
  const chart = evalChart(o.payload);
  const category = chart.category;
  // `measureGarment` reads the category's ring subset from `@curtain/anchors`, so it measures any
  // clothing category; its type lists only the synthetic garment's two.
  const cat = category as SpikeCategory;
  const baseRow = evalChartRow(chart, o.baseSize);
  const critical = criticalRings(o.payload, chart, o.baseSize);
  const warnings: string[] = [];

  let mesh = o.mesh;
  if (o.source.simulatedError) {
    const truthGirths = ringGirths(measureGarment(m, mesh, cat));
    mesh = distortGarment(m, mesh, truthGirths, o.source.simulatedError);
  }
  const source: MeshSource = { ...o.source, sha256: meshSha256(o.mesh) };

  const t0 = performance.now();
  const chains = garmentChains(m, mesh, category);
  const raw = measureGarment(m, mesh, cat, chains);
  const measured = ringGirths(raw);
  const t1 = performance.now();

  // Calibrate only against rings the mesh has a loop at; a missing critical ring is reported, not invented.
  const chartBase = baseRow.rings;
  const calibration = calibrate({ measured, chart: chartBase });
  const baseMesh = applyCalibration(m, mesh, measured, calibration, chains);
  const measurements = measureGarment(m, baseMesh, cat, chains);
  const after = ringGirths(measurements);
  const t2 = performance.now();

  const bodyRow = o.payload.sizeChart.find((r) => r.size === baseRow.size);
  const easeAt = (anchor: AnchorRing, chartCm: number): AnchorRow['ease'] => {
    const key = anchor === 'chest' ? 'bust' : anchor;
    const body = key === 'waist' || key === 'hip' || key === 'bust' || key === 'thigh' ? bodyRow?.[key] : undefined;
    return body === undefined ? null : { cm: r2(chartCm - body), isDefault: baseRow.defaultEase.includes(anchor) };
  };
  const rings = new Set<AnchorRing>([...(Object.keys(chartBase) as AnchorRing[]), ...(Object.keys(measured) as AnchorRing[])]);
  const order = m.rings.map((r) => r.id).filter((id, i, a) => a.indexOf(id) === i);
  const rows: AnchorRow[] = order.filter((id) => rings.has(id)).map((anchor) => {
    const chartCm = chartBase[anchor] ?? null;
    const mv = measured[anchor] ?? null;
    const av = after[anchor] ?? null;
    const isCritical = critical.includes(anchor);
    const ease = chart.type === 'body' && chartCm !== null ? easeAt(anchor, chartCm) : null;
    const before = mv !== null && chartCm !== null ? mv - chartCm : null;
    const afterGlobal = mv !== null && chartCm !== null ? mv * calibration.globalScale - chartCm : null;
    const afterCm = av !== null && chartCm !== null ? av - chartCm : null;
    const pass = isCritical ? afterCm !== null && Math.abs(afterCm) <= tol : null;
    let note: string | null = null;
    if (mv === null) note = raw.rings[anchor] === undefined && chartCm !== null ? 'no closed garment loop around this ring (open front, garment does not reach it, or a hole)' : null;
    else if (chartCm === null) note = 'no chart value: scaled with the global scale';
    else if (raw.rings[anchor]?.spansBothLegs) note = 'loop encloses both legs (skirt)';
    return { anchor, critical: isCritical, chartCm, ease, measuredCm: mv === null ? null : r2(mv), beforeCm: before === null ? null : r2(before), afterGlobalCm: afterGlobal === null ? null : r2(afterGlobal), afterCm: afterCm === null ? null : r2(afterCm), pass, note };
  });

  const missing = critical.filter((a) => measured[a] === undefined);
  const agreementCore = chartAgreement(after, chartBase, critical, tol);
  const agreement = { ...agreementCore, pass: agreementCore.pass && missing.length === 0, missing };
  const critRows = rows.filter((r) => r.critical);
  const beforeMax = maxAbs(critRows.map((r) => r.beforeCm));
  const globalMax = maxAbs(critRows.map((r) => r.afterGlobalCm));
  if (missing.length) warnings.push(`no garment loop at critical ring${missing.length > 1 ? 's' : ''} ${missing.join(', ')}: chart agreement fails there`);
  if (Math.abs(calibration.globalScale - 1) > GLOBAL_SCALE_WARN) warnings.push(`global scale ${calibration.globalScale.toFixed(3)}: the reconstruction is ${((calibration.globalScale - 1) * -100).toFixed(1)} % off in size (check units and cameras before trusting the shape)`);
  for (const [id, c] of Object.entries(calibration.ringCorrections) as [AnchorRing, number][]) {
    if (Math.abs(c - 1) > RING_CORRECTION_WARN) warnings.push(`ring ${id}: per-ring correction ${c.toFixed(3)} after the global scale; calibration reshaped the garment there`);
  }
  if (Object.keys(measured).length === 0) warnings.push('the mesh has no loop at any ring of its category: it is not on the base mannequin, or not in mannequin space');

  // Lengths: measured on the calibrated mesh against what the shop printed; reported, never calibrated.
  const lengths: LengthRow[] = [];
  const printed = (o.payload.lengthCm ?? {}) as Record<string, number>;
  const ext = verticalExtent(baseMesh, chains);
  const measuredLength = (id: AnchorLength | 'outseam'): number | null => {
    if (id === 'outseam') return category === 'bottom' && Number.isFinite(ext.minY) ? ext.maxY - ext.minY : null;
    const l = measurements.lengths[id];
    return l && !l.fromMannequin ? l.lengthCm : null;
  };
  const lengthIds = new Map<string, AnchorLength | 'outseam' | null>();
  for (const k of Object.keys(printed)) lengthIds.set(k, LENGTH_KEYS[k] ?? null);
  for (const [id, l] of Object.entries(measurements.lengths) as [AnchorLength, NonNullable<AnchorMeasurements['lengths'][AnchorLength]>][]) {
    const k = id === 'sleeve' ? 'sleeve_length' : id;
    if (!l.fromMannequin && !lengthIds.has(k)) lengthIds.set(k, id);
  }
  if (category === 'bottom' && !lengthIds.has('outseam')) lengthIds.set('outseam', 'outseam');
  for (const [id, key] of lengthIds) {
    const mv = key ? measuredLength(key) : null;
    const pv = printed[id] ?? null;
    let note: string | null = null;
    const onMannequin = key !== null && key !== 'outseam' && measurements.lengths[key]?.fromMannequin === true;
    if (!key) note = 'no measurement for this length in the spike';
    else if (onMannequin) note = "the garment covers the mannequin's whole line here; the spike has no seam to measure it on the garment";
    else if (mv === null) note = 'the garment edge was not found on this line';
    else if (key === 'outseam') note = 'top of the garment to its lowest point (no waistband or side-seam detection in the spike)';
    else if (key === 'shoulder_to_hem') note = 'high point shoulder to the front hem, on the mannequin';
    lengths.push({ id, measuredCm: mv === null ? null : r2(mv), printedCm: pv, diffCm: mv !== null && pv !== null ? r2(mv - pv) : null, note });
  }

  let grading: GradingJson | null = null;
  let gradingError: string | null = null;
  const t3 = performance.now();
  try {
    grading = gradeGarment(m, asGradingChart(chart), o.baseSize, measurements);
  } catch (e) {
    gradingError = e instanceof Error ? e.message : String(e);
  }
  const t4 = performance.now();

  return {
    productId: o.productId,
    category,
    baseSize: o.baseSize,
    source,
    chart,
    critical,
    rows,
    lengths,
    calibration,
    agreement,
    before: { maxAbsCm: beforeMax === null ? null : r2(beforeMax), pass: beforeMax !== null && beforeMax <= tol && missing.length === 0 },
    afterGlobal: { maxAbsCm: globalMax === null ? null : r2(globalMax), pass: globalMax !== null && globalMax <= tol && missing.length === 0 },
    warnings,
    health: meshHealth(mesh),
    grading,
    gradingError,
    mannequin: m,
    reconstructed: mesh,
    baseMesh,
    chains,
    measurements,
    timingsMs: { measure: Math.round(t1 - t0), calibrate: Math.round(t2 - t1), grade: Math.round(t4 - t3) },
  };
}

/** The spike's simulated reconstruction error, for a synthetic ground-truth garment. */
export const SIMULATED_ERROR: Distortion = DEFAULT_DISTORTION;

export const EVAL_MANNEQUIN = { version: MANNEQUIN_VERSION, shape: BASE_SHAPE_ID } as const;
