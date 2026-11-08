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
import { BASE_SHAPE_ID, MANNEQUIN_VERSION, bodyShape, buildMannequin, buildMannequinMesh, type Mannequin, type Mesh } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { applyCalibration, calibrate, chartAgreement, measureGarment, ringGirths, type AnchorMeasurements, type Calibration, type ChartAgreement, type MeasureOptions } from './anchoring';
import { DEFAULT_DISTORTION } from './bundle';
import { asGradingChart, criticalRings, evalChart, evalChartRow, type EvalCategory, type EvalChart } from './evalChart';
import { meshHealth, type MeshHealth } from './evalMesh';
import { assignChains, distortGarment, type ChainAssignment, type Distortion, type SpikeCategory } from './garment';
import { WAISTBAND, waistbandGirth, type WaistbandGirth } from './waistband';
import { openingProfile, sliceAt, type OpeningProfile } from './bottomOpenings';
import { bottomLengths, garmentLengths, type BottomLengthMeasure, type LengthMeasure } from './garmentLength';
import { openingHalfWidth, proxyKind, type FrontOpening } from './proxy';
import { gradeGarment, type GradingJson } from './grading';

export const EVAL_VERSION = 'phase0-eval-0.3.0';
/** Phase 0 acceptance: calibrated circumference within ±2 cm of the chart at the critical anchors. */
export const CHART_TOLERANCE_CM = 2;
/** A global scale further than this from 1 means the reconstruction's size (or its unit) is off, not just its shape. */
export const GLOBAL_SCALE_WARN = 0.1;
/** A per-ring correction outside 1 ± this means calibration reshaped the garment, not just nudged it. */
export const RING_CORRECTION_WARN = 0.08;

/** Where the evaluated mesh came from. Only `stage4` and `stage4t` are real results for a product. */
export type MeshSourceKind = 'stage4' | 'stage4t' | 'stage4-synthetic' | 'synthetic-truth';

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
  stage4t: 'stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames)',
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
  /** Girth of the mesh as reconstructed (tape measure, `src/tape.ts`), cm; null = the garment does not go round the ring. */
  measuredCm: number | null;
  /** Length of the closed slice polyline around the ring (the spike's first method), cm; null = no closed loop. Diagnostic only. */
  polylineCm: number | null;
  /** Share of angles round the ring where the tape found cloth (the rest is bridged). */
  tapeCoverage: number | null;
  /** The pattern block does not fit this ring: reported, not critical, not calibrated against. */
  notFitted: boolean;
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
  /** The length as the printed value means it (shoulder_to_hem of a shop: flat-lay, along the garment front from the HPS). */
  measuredCm: number | null;
  /** shoulder_to_hem only: the vertical drop from the HPS to the front hem (the spike's measurement up to eval 0.2.0). */
  dropCm?: number | null;
  /** How `measuredCm` is taken. */
  definition?: 'flat-lay' | 'drop';
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
  /** Every length definition on the reconstructed and on the calibrated mesh (`garmentLength.ts`). */
  lengthDefinitions: { reconstructed: LengthMeasure[]; calibrated: LengthMeasure[]; bottom?: BottomLengthMeasure[] };
  /** Flat-lay minus vertical drop of shoulder_to_hem on the calibrated mesh: added to the graded drops to compare with a printed table. */
  flatLayOffsetCm: number | null;
  calibration: Calibration;
  /** Acceptance item "chart agreement" on the calibrated mesh. */
  agreement: ChartAgreement & { missing: AnchorRing[] };
  /** The same test before calibration and after the global scale only (diagnostics). */
  before: { maxAbsCm: number | null; pass: boolean };
  afterGlobal: { maxAbsCm: number | null; pass: boolean };
  warnings: string[];
  health: MeshHealth;
  /** Cloth inside the mannequin: as reconstructed, and on the calibrated base mesh (the asset). */
  insideBody: { reconstructed: InsideBody; calibrated: InsideBody };
  grading: GradingJson | null;
  gradingError: string | null;
  mannequin: Mannequin;
  /** The mesh as evaluated (after the simulated error for a synthetic truth). */
  reconstructed: Mesh;
  /** Calibrated base-size mesh: the asset's base.glb. */
  baseMesh: Mesh;
  chains: ChainAssignment;
  measurements: AnchorMeasurements;
  /**
   * Bottoms whose cloth does not reach the waist ring (worn lower, or tilted): the waistband measured on its own plane under
   * the top edge (`src/waistband.ts`), as reconstructed. Reported in the waist row; never calibrated on. null otherwise.
   */
  waistband: WaistbandGirth | null;
  /**
   * Bottoms: where the cloth does not go round the body, slice by slice from the top edge to the hem, as reconstructed
   * (`src/bottomOpenings.ts`). A hip with no girth is reported from it (bridged girth, the opening). null otherwise.
   */
  openings: OpeningProfile | null;
  timingsMs: { measure: number; calibrate: number; grade: number };
}

const r2 = (x: number): number => Math.round(x * 100) / 100 + 0; // + 0 turns -0 into 0
const cmSigned = (x: number): string => `${x > 0 ? '+' : ''}${r2(x).toFixed(2)} cm`;
const maxAbs = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v.map(Math.abs)) : null;
};

export interface InsideBody {
  /** Vertices more than `toleranceCm` inside the mannequin's analytic torso, leg or arm section. */
  vertices: number;
  share: number;
  toleranceCm: number;
}

/**
 * How much of the garment lies inside the mannequin: such cloth is hidden by the body in every
 * render (the grey patches through a reconstructed bodice), and a drape pushes it out unpredictably.
 * Uses the mannequin's analytic sections (`torsoAt`, `legAt`, `armAt`), not its mesh.
 */
export function clothInsideBody(m: Mannequin, mesh: Mesh, toleranceCm = 0.3): InsideBody {
  const inside = (dx: number, dz: number, a: number, b: number): boolean => {
    const r = Math.hypot(dx, dz);
    if (r < 1e-9) return true;
    const t = Math.atan2(dz, dx);
    const re = (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t));
    return r < re - toleranceCm;
  };
  const n = mesh.positions.length / 3;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = mesh.positions[3 * i]!, y = mesh.positions[3 * i + 1]!, z = mesh.positions[3 * i + 2]!;
    let hit = false;
    const t = m.torsoAt(y);
    if (t && inside(x - t.cx, z - t.cz, t.a, t.b)) hit = true;
    for (const side of [1, -1] as const) {
      if (hit) break;
      const l = m.legAt(y, side);
      if (l && inside(x - l.cx, z - l.cz, l.a, l.b)) hit = true;
      const f = side === 1 ? m.arms.left : m.arms.right;
      const d: [number, number, number] = [x - f.joint[0], y - f.joint[1], z - f.joint[2]];
      const sAlong = d[0] * f.axis[0] + d[1] * f.axis[1] + d[2] * f.axis[2];
      const a = m.armAt(sAlong, side);
      if (!hit && a) {
        const q: [number, number, number] = [x - a.centre[0], y - a.centre[1], z - a.centre[2]];
        if (inside(q[0] * f.u[0] + q[1] * f.u[1] + q[2] * f.u[2], q[0] * f.v[0] + q[1] * f.v[1] + q[2] * f.v[2], a.a, a.b)) hit = true;
      }
    }
    if (hit) count++;
  }
  return { vertices: count, share: n ? Math.round((count / n) * 10000) / 10000 : 0, toleranceCm };
}

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

/**
 * Slack (cm, chord) on top of the product's own front opening at a ring that the tape still bridges as that opening:
 * the fronts' edges of a reconstruction are a little ragged and hang a little apart. Wider than that is a hole.
 */
export const FRONT_OPENING_SLACK_CM = 4;

/** Widest front opening (chord, cm) bridged at height y: the opening's width there plus the slack; 0 outside its rows. */
export function frontOpeningCap(o: FrontOpening, y: number): number {
  const half = openingHalfWidth(o, y);
  return half < 0 ? 0 : 2 * half + FRONT_OPENING_SLACK_CM;
}

/** Payload `lengthCm` keys → the measured length that answers them. */
const LENGTH_KEYS: Readonly<Record<string, AnchorLength | 'outseam'>> = {
  shoulder_to_hem: 'shoulder_to_hem',
  shoulder_to_waist: 'shoulder_to_waist',
  waist_to_hem: 'waist_to_hem',
  sleeve_length: 'sleeve',
  outseam: 'outseam',
  inseam: 'inseam',
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
  /** What the printed shoulder_to_hem means: a shop's garment table is flat-lay (default); the spike's synthetic garment is built with a vertical drop. */
  printedLength?: 'flat-lay' | 'drop';
  /**
   * Outerwear only: the product's front opening (the control proxy's, manifest `control.proxy.front_opening`, which
   * comes from the description's own words). The tape bridges it at a ring as the fronts laid closed, up to its width
   * there + `FRONT_OPENING_SLACK_CM`. Absent or null: no opening is bridged (a gap at the front is a hole).
   */
  frontOpening?: FrontOpening | null;
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
  // A tape measure round the outside, own body part only: real reconstructions are noisy, have holes
  // and fuse the sleeves to the bodice (run 14); on smooth meshes it equals the loop length.
  // Outerwear whose description gives a front opening (a V, an open front): it is bridged at the front as a flat-lay
  // chest lays the fronts closed, up to the opening's own width at that ring + FRONT_OPENING_SLACK_CM. Any other gap
  // wider than the tape's 4 cm, and every other garment's, stays "no girth".
  const opening = category === 'outerwear' ? (o.frontOpening ?? null) : null;
  const measureOpts: MeasureOptions = { girth: 'tape', body: buildMannequinMesh(m), ...(opening ? { frontOpeningAt: (y: number) => frontOpeningCap(opening, y) } : {}) };
  const raw = measureGarment(m, mesh, cat, chains, measureOpts);
  const measured = ringGirths(raw);
  const t1 = performance.now();

  // Calibrate only against rings the mesh has a loop at; a missing critical ring is reported, not invented.
  // Rings the pattern block does not fit keep their chart value for the table and for grading, but do not calibrate.
  const notFitted = new Set<AnchorRing>(chart.notFitted?.rings ?? []);
  const chartFull = baseRow.rings;
  const chartBase = Object.fromEntries(Object.entries(chartFull).filter(([k]) => !notFitted.has(k as AnchorRing))) as Partial<Record<AnchorRing, number>>;
  const calibration = calibrate({ measured, chart: chartBase });
  const baseMesh = applyCalibration(m, mesh, measured, calibration, chains);
  const measurements = measureGarment(m, baseMesh, cat, chains, measureOpts);
  const after = ringGirths(measurements);
  const t2 = performance.now();

  const bodyRow = o.payload.sizeChart.find((r) => r.size === baseRow.size);
  const easeAt = (anchor: AnchorRing, chartCm: number): AnchorRow['ease'] => {
    const key = anchor === 'chest' ? 'bust' : anchor;
    const body = key === 'waist' || key === 'hip' || key === 'bust' || key === 'thigh' ? bodyRow?.[key] : undefined;
    return body === undefined ? null : { cm: r2(chartCm - body), isDefault: baseRow.defaultEase.includes(anchor) };
  };
  // A bottom whose cloth does not reach the waist ring: its waistband where it is (report only, not calibrated).
  const waistband = category === 'bottom' && chartFull.waist !== undefined && raw.rings.waist === undefined ? waistbandGirth(mesh) : null;
  // A bottom: where it does not go round (a side opening at the hip leaves the hip with no girth at all).
  const openings = category === 'bottom' ? openingProfile(mesh, m) : null;
  const rings = new Set<AnchorRing>([...(Object.keys(chartFull) as AnchorRing[]), ...(Object.keys(measured) as AnchorRing[])]);
  const order = m.rings.map((r) => r.id).filter((id, i, a) => a.indexOf(id) === i);
  const rows: AnchorRow[] = order.filter((id) => rings.has(id)).map((anchor) => {
    const chartCm = chartFull[anchor] ?? null;
    const isNotFitted = notFitted.has(anchor);
    const mv = measured[anchor] ?? null;
    const av = after[anchor] ?? null;
    const isCritical = critical.includes(anchor);
    const ease = chart.type === 'body' && chartCm !== null ? easeAt(anchor, chartCm) : null;
    const before = mv !== null && chartCm !== null ? mv - chartCm : null;
    const afterGlobal = mv !== null && chartCm !== null ? mv * calibration.globalScale - chartCm : null;
    const afterCm = av !== null && chartCm !== null ? av - chartCm : null;
    const pass = isCritical ? afterCm !== null && Math.abs(afterCm) <= tol : null;
    let note: string | null = null;
    if (mv === null) note = raw.rings[anchor] === undefined && chartCm !== null ? 'the garment does not go round this ring (open front, garment does not reach it, or a hole wider than the tape bridges)' : null;
    else if (isNotFitted) note = `not a fit point of the ${chart.notFitted!.block} block (${chart.notFitted!.label}): reported, not calibrated`;
    else if (chartCm === null) note = 'no chart value: scaled with the global scale';
    if (mv !== null && raw.rings[anchor]?.tape?.frontGapCm) note = `${note ? `${note}; ` : ''}front opening ${raw.rings[anchor]!.tape!.frontGapCm} cm bridged (the fronts laid closed, as a flat-lay chest)`;
    else if (raw.rings[anchor]?.spansBothLegs) note = 'loop encloses both legs (skirt)';
    const t = raw.rings[anchor]?.tape;
    if (mv === null && openings && chartCm !== null && anchor !== 'waist') {
      // No tape girth on a bottom: say how big the cloth is with its openings bridged and where it is open, never a pass.
      const sl = sliceAt(openings, m.morphHeights[anchor]);
      if (sl && sl.bridgedCm !== null) {
        const gaps = sl.gaps.map((g) => `${g.chordCm} cm at ${g.midDeg}° (${g.midDeg > 45 && g.midDeg < 135 ? "the mannequin's left" : g.midDeg < -45 && g.midDeg > -135 ? "the mannequin's right" : Math.abs(g.midDeg) <= 45 ? 'front' : 'back'})`).join(', ');
        note = `no tape girth: the cloth goes ${Math.round(sl.coverage * 100)} % of the way round at ${sl.yCm} cm${gaps ? `, open ${gaps}` : ''}; with the openings bridged ${sl.bridgedCm} cm (${cmSigned(sl.bridgedCm - chartCm)} against the chart), the mannequin there ${sl.bodyCm ?? '—'} cm, the cloth at least ${sl.minClearanceCm ?? '—'} cm off it (src/bottomOpenings.ts, as reconstructed)`;
      }
    }
    if (anchor === 'waist' && waistband && chartCm !== null) {
      const wb = waistband;
      const at = `the cloth does not reach the waist ring (${r2(m.morphHeights.waist)} cm): its top edge runs from ${wb.backY} cm at the back to ${wb.frontY} cm at the front (plane tilted ${wb.tiltDeg}°); measured on the waistband, ${WAISTBAND.belowCm} cm under that edge (src/waistband.ts), as reconstructed; not calibrated. A band that sits lower than the waist ring lies on the body between the waist and the hip, so its girth says where the skirt is worn as much as how big it is`;
      const why = wb.girthCm === null ? `; the tape refuses there: an opening of ${wb.maxGapCm} cm (${wb.maxGapDeg}°), with it bridged ${wb.bridgedCm} cm (${wb.bridgedCm !== null ? cmSigned(wb.bridgedCm - chartCm) : '—'} against the chart)` : '';
      const before = wb.girthCm !== null ? wb.girthCm - chartCm : null;
      return { anchor, critical: isCritical, chartCm, ease, measuredCm: wb.girthCm, polylineCm: null, tapeCoverage: wb.coverage, notFitted: isNotFitted, beforeCm: before === null ? null : r2(before), afterGlobalCm: null, afterCm: null, pass: isCritical ? false : null, note: `${at}${why}` };
    }
    return { anchor, critical: isCritical, chartCm, ease, measuredCm: mv === null ? null : r2(mv), polylineCm: t && t.loopLengthCm !== null ? r2(t.loopLengthCm) : null, tapeCoverage: t ? r2(t.coverage) : null, notFitted: isNotFitted, beforeCm: before === null ? null : r2(before), afterGlobalCm: afterGlobal === null ? null : r2(afterGlobal), afterCm: afterCm === null ? null : r2(afterCm), pass, note };
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
  const printedLengthDef = o.printedLength ?? 'flat-lay';
  // Bottoms (per type, `bottomLengths`): a skirt's waist_to_hem along the centre front, the outseam down the side seam, the
  // inseam down the inner leg of trousers; flat-lay along the garment, or the vertical drop.
  const trousers = category === 'bottom' && proxyKind(o.payload) === 'trousers';
  const bottomDefs = category === 'bottom' ? bottomLengths(m, baseMesh, trousers) : undefined;
  const bottomLen = (flat: string, drop: string): number | null => bottomDefs?.find((d) => d.definition === (printedLengthDef === 'flat-lay' ? flat : drop))?.lengthCm ?? null;
  const measuredLength = (id: AnchorLength | 'outseam'): number | null => {
    if (category === 'bottom' && bottomDefs) {
      if (id === 'outseam') return bottomLen('outseam_side', 'outseam_drop') ?? (Number.isFinite(ext.minY) ? ext.maxY - ext.minY : null);
      if (id === 'inseam') return trousers ? bottomLen('inseam_inner', 'inseam_drop') : null;
      if (id === 'waist_to_hem') return trousers ? null : bottomLen('waist_to_hem_front', 'outseam_drop');
    }
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
  if (trousers && !lengthIds.has('inseam')) lengthIds.set('inseam', 'inseam');
  // A skirt's length is waist to hem whether or not the shop printed it (none of the shop's skirts prints a length).
  if (category === 'bottom' && !trousers && !lengthIds.has('waist_to_hem')) lengthIds.set('waist_to_hem', 'waist_to_hem');
  const printedLength = printedLengthDef;
  const defsCal = garmentLengths(m, baseMesh);
  const defsRec = garmentLengths(m, mesh);
  const flat = defsCal.find((d) => d.definition === 'hps_surface')?.lengthCm ?? null;
  const drop = defsCal.find((d) => d.definition === 'hps_drop')?.lengthCm ?? null;
  for (const [id, key] of lengthIds) {
    let mv = key ? measuredLength(key) : null;
    const pv = printed[id] ?? null;
    let note: string | null = null;
    if (key === 'shoulder_to_hem' && printedLength === 'flat-lay' && mv !== null && flat !== null) {
      const dropCm = mv;
      mv = flat;
      const diff = pv !== null ? r2(mv - pv) : null;
      lengths.push({ id, measuredCm: r2(mv), dropCm: r2(dropCm), definition: 'flat-lay', printedCm: pv, diffCm: diff, note: `flat-lay: along the garment front from the high point shoulder (src/garmentLength.ts); vertical drop ${r2(dropCm)} cm` });
      continue;
    }
    const onMannequin = key !== null && key !== 'outseam' && measurements.lengths[key]?.fromMannequin === true;
    if (trousers && key === 'waist_to_hem') note = 'trousers: no centre-front length (the front ends at the crotch); see outseam and inseam';
    else if (!key) note = 'no measurement for this length in the spike';
    else if (onMannequin) note = "the garment covers the mannequin's whole line here; the spike has no seam to measure it on the garment";
    else if (mv === null) note = 'the garment edge was not found on this line';
    else if (category === 'bottom' && (key === 'outseam' || key === 'inseam' || key === 'waist_to_hem')) {
      note = `${printedLength === 'flat-lay' ? 'flat-lay, along the garment' : 'vertical drop'}: ${key === 'outseam' ? 'top edge down the side seam to the hem' : key === 'inseam' ? 'crotch down the inner leg to the hem' : 'top edge at the centre front to the hem'} (src/garmentLength.ts bottomLengths)`;
    }
    else if (key === 'shoulder_to_hem') note = "high point shoulder to the front hem, vertical drop (the spike's synthetic garment is built this way)";
    lengths.push({ id, measuredCm: mv === null ? null : r2(mv), ...(key === 'shoulder_to_hem' ? { definition: 'drop' as const } : {}), printedCm: pv, diffCm: mv !== null && pv !== null ? r2(mv - pv) : null, note });
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
    lengthDefinitions: { reconstructed: defsRec, calibrated: defsCal, ...(bottomDefs ? { bottom: bottomDefs } : {}) },
    flatLayOffsetCm: printedLength === 'flat-lay' && flat !== null && drop !== null ? r2(flat - drop) : null,
    calibration,
    agreement,
    before: { maxAbsCm: beforeMax === null ? null : r2(beforeMax), pass: beforeMax !== null && beforeMax <= tol && missing.length === 0 },
    afterGlobal: { maxAbsCm: globalMax === null ? null : r2(globalMax), pass: globalMax !== null && globalMax <= tol && missing.length === 0 },
    warnings,
    health: meshHealth(mesh),
    insideBody: { reconstructed: clothInsideBody(m, mesh), calibrated: clothInsideBody(m, baseMesh) },
    grading,
    gradingError,
    mannequin: m,
    reconstructed: mesh,
    baseMesh,
    chains,
    measurements,
    waistband,
    openings,
    timingsMs: { measure: Math.round(t1 - t0), calibrate: Math.round(t2 - t1), grade: Math.round(t4 - t3) },
  };
}

/** The spike's simulated reconstruction error, for a synthetic ground-truth garment. */
export const SIMULATED_ERROR: Distortion = DEFAULT_DISTORTION;

export const EVAL_MANNEQUIN = { version: MANNEQUIN_VERSION, shape: BASE_SHAPE_ID } as const;
