/**
 * Exemplar and shadow logging after stage 4t (docs/PREDICTION-ENGINE.md §4.3 P1, §5 step 1, §7 V1, §11 "from the
 * first GPU run"). Every stage 4t mesh yields:
 *
 *   exemplar.json   the measured pattern parameters of the stage 4t mesh (girths and ease per ring with the evaluation's
 *                   tape measure, hem height, hem girth and flare, trouser thigh/hip and hem/thigh, the length in the
 *                   definition the product's length rule uses, sleeve length and volume, depth ratios), the material it
 *                   was predicted with, its holdout IoU and the pipeline versions. Numbers only, no image bytes.
 *   shadow.json     the job's P0 prediction against that measurement, per parameter (predicted, the same measurement on
 *                   the P0 proxy, measured on stage 4t, error, error / σ), plus the Chamfer of the P0-predicted shape (the
 *                   proxy built from prediction.json, opened: no caps) against the stage 4t mesh, overall and per region.
 *
 * Shadow numbers on a generated asset compare the prediction with what the video model and stage 4t made, not with the
 * garment; on a synthetic job with what the synthetic truth looks like through stage 4t. Neither is ground truth (§13).
 */
import { CATEGORY_ANCHORS, type AnchorRing } from '@curtain/anchors';
import { buildMannequinMesh, slice, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import type { GarmentFeatures } from './features';
import { measureGarment, measureRing, type MeasureOptions } from './anchoring';
import { chamfer, regionChamfer, type ChamferReport, type RegionChamfer } from './chamfer';
import { frontOpeningCap, garmentChains } from './eval';
import type { EvalCategory } from './evalChart';
import type { SpikeCategory } from './garment';
import { garmentLengths } from './garmentLength';
import { PREDICTOR_VERSION, canonical, fnv1a, type Exemplar, type MeasuredPattern, type Prediction } from './predict';
import { openedProxy, type FrontOpening, type ProxySpec } from './proxy';
import { densifyLoop, tapeGirth } from './tape';
import { GARMENT_REGIONS, garmentRegion } from './templatePerturb';

export const DRAPE_LOG_VERSION = 'drape-log-0.1.0';
/** Hem girth is taken this far above the upper part of the hem line (the lowest cloth per sector), cm. */
export const HEM_GIRTH_ABOVE_CM = 2;

const r3 = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** Points of the slice at height y of the triangles whose three vertices pass `keepVertex`. */
function slicePoints(mesh: Pick<Mesh, 'positions' | 'indices'>, y: number, keepTri: (t: number) => boolean): Vec3[] {
  const loops = slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] }, keepTri);
  return loops.flatMap((l) => densifyLoop(l).points);
}

/** Tape girth (the evaluation's `tape.ts`) of the points round their own bounding-box centre; null without enough cloth. */
function tapeAround(pts: readonly Vec3[], y: number): { girth: number; depthRatio: number } | null {
  if (pts.length < 8) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  const t = tapeGirth(pts, [(x0 + x1) / 2, y, (z0 + z1) / 2], [1, 0, 0], [0, 0, 1]);
  return t ? { girth: t.girthCm, depthRatio: (z1 - z0) / Math.max(1e-9, x1 - x0) } : null;
}

export type LengthDefinitionId = 'hps_surface' | 'hps_drop' | 'waist_drop' | 'crotch_drop';

/** The definition a length rule is resolved in (`proxy.ts` `hemFor`). */
export function lengthDefinitionOf(kind: Prediction['pattern']['kind'], rule: Prediction['pattern']['length']['rule']): LengthDefinitionId {
  if (rule.from === 'printed') return rule.definition === 'hps_surface' ? 'hps_surface' : rule.origin === 'crotch' ? 'crotch_drop' : rule.origin === 'waist' ? 'waist_drop' : 'hps_drop';
  return kind === 'skirt' || kind === 'trousers' ? 'waist_drop' : 'hps_drop';
}

export function originY(m: Mannequin, def: LengthDefinitionId): number {
  return def === 'waist_drop' ? m.morphHeights.waist : def === 'crotch_drop' ? m.landmarks.crotch[1] : m.landmarks.hps[1];
}

export interface MeasureContext {
  kind: Prediction['pattern']['kind'];
  category: EvalCategory;
  rule: Prediction['pattern']['length']['rule'];
  frontOpening: FrontOpening | null;
}

/** The pattern parameters of a garment mesh in mannequin space (cm), measured as the evaluation measures (tape, own body part). */
export function measurePattern(m: Mannequin, mesh: Mesh, ctx: MeasureContext, body: Mesh = buildMannequinMesh(m)): MeasuredPattern {
  const chains = garmentChains(m, mesh, ctx.category);
  const opening = ctx.category === 'outerwear' ? ctx.frontOpening : null;
  const opts: MeasureOptions = { girth: 'tape', body, ...(opening ? { frontOpeningAt: (y: number) => frontOpeningCap(opening, y) } : {}) };
  const meas = measureGarment(m, mesh, ctx.category as SpikeCategory, chains, opts);
  const girthsCm: MeasuredPattern['girthsCm'] = {};
  const easeCm: MeasuredPattern['easeCm'] = {};
  for (const id of CATEGORY_ANCHORS[ctx.category].rings) {
    const r = meas.rings[id];
    if (!r) continue;
    girthsCm[id] = r3(r.circumferenceCm)!;
    easeCm[id] = r3(r.circumferenceCm - m.shape.rings[id].circumferenceCm)!;
  }
  // Body cloth (chain 0: not on an arm), and for trousers the left leg (x > 0) below the crotch.
  const nv = mesh.positions.length / 3;
  const trousers = ctx.kind === 'trousers';
  const crotchY = m.landmarks.crotch[1];
  const onBody = (v: number): boolean => chains[v] === 0 && (!trousers || (mesh.positions[3 * v]! > 0 && mesh.positions[3 * v + 1]! < crotchY));
  // Hem line: the lowest cloth per 10° sector round the cloth's axis below the hip; hemY is their median (a generated hem is
  // not level), the hem girth is taken HEM_GIRTH_ABOVE_CM above the upper part of the line, where the cloth goes all the way round.
  const hipY0 = m.morphHeights.hip;
  let cx0 = Infinity, cx1 = -Infinity, cz0 = Infinity, cz1 = -Infinity;
  for (let v = 0; v < nv; v++) {
    if (!onBody(v) || mesh.positions[3 * v + 1]! > hipY0) continue;
    cx0 = Math.min(cx0, mesh.positions[3 * v]!); cx1 = Math.max(cx1, mesh.positions[3 * v]!);
    cz0 = Math.min(cz0, mesh.positions[3 * v + 2]!); cz1 = Math.max(cz1, mesh.positions[3 * v + 2]!);
  }
  const SECTORS = 36;
  const lowest = new Float64Array(SECTORS).fill(Infinity);
  const ax = (cx0 + cx1) / 2, az = (cz0 + cz1) / 2;
  for (let v = 0; v < nv; v++) {
    if (!onBody(v)) continue;
    const y = mesh.positions[3 * v + 1]!;
    const a = Math.atan2(mesh.positions[3 * v + 2]! - az, mesh.positions[3 * v]! - ax);
    const k = Math.min(SECTORS - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECTORS));
    if (y < lowest[k]!) lowest[k] = y;
  }
  const minima = Array.from(lowest).filter(Number.isFinite).sort((a, b) => a - b);
  const hemY = minima.length >= SECTORS / 2 ? minima[Math.floor(minima.length / 2)]! : minima.length ? minima[0]! : Infinity;
  // The hem's upper part (75th percentile of the sector minima; the maximum let one ragged sector, e.g. a trouser leg's
  // inner side under the crotch, lift the hem slice out of the leg).
  const hemTop = minima.length ? minima[Math.floor(0.75 * (minima.length - 1))]! : Infinity;
  const hemSliceY = Math.min(hemTop + HEM_GIRTH_ABOVE_CM, (trousers ? crotchY : hipY0) - 1);
  const triOk = (t: number): boolean => onBody(mesh.indices[3 * t]!) && onBody(mesh.indices[3 * t + 1]!) && onBody(mesh.indices[3 * t + 2]!);
  const hem = Number.isFinite(hemSliceY) ? tapeAround(slicePoints(mesh, hemSliceY, triOk), hemSliceY) : null;
  const hipSlice = trousers ? null : tapeAround(slicePoints(mesh, hipY0, (t) => chains[mesh.indices[3 * t]!] === 0), hipY0);
  // Trouser thigh: the left leg's own ring (measureRing on the thigh frame).
  const thighFrame = m.rings.find((r) => r.id === 'thigh')!;
  const thigh = trousers ? measureRing(mesh, thighFrame, { girth: 'tape', body }) : null;
  const hip = girthsCm.hip ?? null;
  let hemFlare: number | null = null;
  let thighOfHip: number | null = null;
  if (trousers) {
    hemFlare = hem && thigh ? hem.girth / thigh.circumferenceCm : null;
    thighOfHip = thigh && hip ? thigh.circumferenceCm / hip : null;
  } else hemFlare = hem && hip ? hem.girth / hip : null;

  // Length in the definition the product's length rule uses: a printed flat-lay shoulder-to-hem along the front from the
  // HPS (`garmentLengths`), everything else as the proxy resolves it, a drop from the rule's origin (HPS, waist, crotch) to
  // the lowest body (trousers: left leg) cloth.
  let lengthCm: number | null = null;
  let lengthDefinition: string | null = null;
  const def = lengthDefinitionOf(ctx.kind, ctx.rule);
  if (def === 'hps_surface') lengthCm = garmentLengths(m, mesh).find((d) => d.definition === 'hps_surface')?.lengthCm ?? null;
  else if (Number.isFinite(hemY)) lengthCm = originY(m, def) - hemY;
  lengthDefinition = def;
  const sleeve = meas.lengths.sleeve?.lengthCm ?? null;
  const ua = girthsCm.upper_arm, wr = girthsCm.wrist;
  return {
    girthsCm,
    easeCm,
    hemY: r3(Number.isFinite(hemY) ? hemY : null),
    hemGirthCm: r3(hem?.girth ?? null),
    hemFlare: r3(hemFlare),
    thighOfHip: r3(thighOfHip),
    lengthCm: r3(lengthCm),
    lengthDefinition,
    sleeveCm: r3(sleeve),
    upperArmRatio: r3(ua === undefined ? null : ua / m.shape.rings.upper_arm.circumferenceCm),
    cuffRatio: r3(wr === undefined ? null : wr / m.shape.rings.wrist.circumferenceCm),
    depthRatio: { hip: r3(hipSlice?.depthRatio ?? null), hem: r3(hem?.depthRatio ?? null) },
  };
}

export const meshSha = (mesh: Pick<Mesh, 'positions' | 'indices'>): string => {
  // FNV over the rounded numbers (stable across platforms; this is an identity check, not security).
  const pos = Array.from(mesh.positions, (x) => Math.round(x * 1e4));
  return `fnv1a32:${fnv1a(`${pos.join(',')}|${Array.from(mesh.indices).join(',')}`)}`;
};

export interface Stage4tQuality {
  holdoutVisibleIou: number | null;
  holdoutSilhouetteIou: number | null;
  trainVisibleIou: number | null;
  insideBody: number | null;
}

/** Quality numbers from a stage 4t metrics.json (data, checked). */
export function stage4tQuality(metrics: unknown): Stage4tQuality {
  const o = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null);
  const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const iou = o(o(metrics)?.iou);
  return {
    holdoutVisibleIou: n(o(iou?.holdout)?.visibleMean),
    holdoutSilhouetteIou: n(o(iou?.holdout)?.silhouetteMean),
    trainVisibleIou: n(o(iou?.train)?.visibleMean),
    insideBody: n(o(o(metrics)?.insideBody)?.share),
  };
}

export function buildExemplar(o: { productId: string; familyId: string | null; source: Exemplar['source']; prediction: Prediction; pattern: MeasuredPattern; quality: Stage4tQuality; versions: Record<string, string>; mesh: Mesh }): Exemplar {
  return {
    format: 'curtain.drape.exemplar',
    formatVersion: 1,
    productId: o.productId,
    familyId: o.familyId,
    cell: o.prediction.cell,
    kind: o.prediction.pattern.kind,
    source: o.source,
    pattern: o.pattern,
    material: o.prediction.material,
    materialSource: 'prediction-prior',
    cellSource: 'prediction',
    // Not approved until a merchant approves the asset (D13): P1 blends only approved exemplars.
    quality: { ...o.quality, approved: false },
    versions: { drapeLog: DRAPE_LOG_VERSION, predictor: o.prediction.predictorVersion, drapeTable: o.prediction.drapeTableVersion, fabricLibrary: o.prediction.fabricLibraryVersion, ...o.versions },
    meshSha256: meshSha(o.mesh),
  };
}

export interface ShadowRow {
  parameter: string;
  unit: 'cm' | 'ratio';
  /** The predicted value as the prediction states it (resolved on mannequin M for heights and lengths). */
  predicted: number | null;
  /** The same measurement on the P0 proxy built from the prediction (what the control and the template had). */
  proxy: number | null;
  /** Measured on the stage 4t mesh. */
  measured: number | null;
  /** measured − predicted. */
  error: number | null;
  sigma: number | null;
  /** |error| / σ (§7 σ calibration: 80 % of errors ≤ 1.28 σ). */
  z: number | null;
  note: string | null;
  /**
   * false: the row cannot test the prediction, because the value it compares was not predicted (a synthetic job's length
   * set to its own truth, provenance `synthetic`) or the job's truth IS the prediction (`ShadowReport.informative`).
   * Such rows stay in the report and are left out of `v1`.
   */
  informative: boolean;
}

export interface ShadowReport {
  format: 'curtain.drape.shadow';
  formatVersion: 1;
  version: string;
  productId: string;
  predictorVersion: string;
  cell: string;
  source: Exemplar['source'];
  rows: ShadowRow[];
  /** P0-predicted shape (the proxy from prediction.json, opened) against the stage 4t mesh: recon = proxy, truth = stage 4t; 50,000 samples each, as stage 4t's own vsTruth. */
  chamfer: ChamferReport;
  regions: RegionChamfer[];
  /** §7 V1 gate values the rows answer (first guesses; nothing skips a GPU run in P0), from informative rows only (null otherwise). */
  v1: { hemHeightErrCm: number | null; lengthErrCm: number | null; hemGirthErrPct: number | null; upperArmErrCm: number | null; chamferCm: number | null; sigmaWithin128: number | null; excluded: string[] };
  /**
   * Whether this report can test the prediction at all. false on a synthetic job whose truth is the proxy built from this
   * very prediction (skirt, trousers, outerwear: `syntheticGarmentFromProxy`): truth = template = prediction, every row and the
   * Chamfer are circular by construction and measure stage 4t only.
   */
  informative: { value: boolean; reason: string | null };
  notes: string[];
}

function row(parameter: string, unit: ShadowRow['unit'], predicted: number | null, proxy: number | null, measured: number | null, sigma: number | null, note: string | null = null, informative = true): ShadowRow {
  const error = predicted !== null && measured !== null ? measured - predicted : null;
  return { parameter, unit, predicted: r3(predicted), proxy: r3(proxy), measured: r3(measured), error: r3(error), sigma, z: error !== null && sigma ? r3(Math.abs(error) / sigma) : null, note, informative };
}

/** Prediction against the stage 4t measurement, per parameter, and the Chamfer of the predicted shape. */
export function shadowCompare(o: {
  m: Mannequin;
  productId: string;
  source: Exemplar['source'];
  prediction: Prediction;
  /** The P0 proxy spec (resolved on mannequin M) and its opened surface. */
  spec: ProxySpec;
  proxyMesh: Mesh;
  proxyPattern: MeasuredPattern;
  measured: MeasuredPattern;
  stage4t: Mesh;
  samples?: number;
  /** Why the job's truth is this prediction itself (a synthetic skirt, trousers or outerwear), or null. */
  truthIsPrediction?: string | null;
}): ShadowReport {
  const { m, prediction: pr, spec, proxyPattern: px, measured: me } = o;
  const circular = o.truthIsPrediction ?? null;
  const pat = pr.pattern;
  const rows: ShadowRow[] = [];
  const notes: string[] = [];
  const kind = pat.kind;
  if (kind === 'trousers') {
    rows.push(row('legs.hemOfThigh', 'ratio', pat.legs?.hemOfThigh.value === 'ankle' ? null : (pat.legs?.hemOfThigh.value as number | undefined) ?? null, px.hemFlare, me.hemFlare, pat.legs?.hemOfThigh.sigma ?? null, pat.legs?.hemOfThigh.value === 'ankle' ? 'tapered to the ankle: no ratio predicted' : null));
    rows.push(row('legs.thighOfHip', 'ratio', pat.legs && pat.legs.thighOfHip.value > 0 ? pat.legs.thighOfHip.value : null, px.thighOfHip, me.thighOfHip, pat.legs?.thighOfHip.sigma ?? null, 'a floor, not a target: the thigh is the larger of the chart/default girth and this share of the hip'));
  } else {
    rows.push(row('hemFlare', 'ratio', pat.hemFlare.value, px.hemFlare, me.hemFlare, pat.hemFlare.sigma, kind === 'dress' || kind === 'skirt' ? 'predicted before leg clearance; measured on the hem ring 2 cm above the lowest body cloth' : null));
  }
  for (const [ring, v] of Object.entries(pat.defaultEase) as [AnchorRing, NonNullable<Prediction['pattern']['defaultEase'][AnchorRing]>][]) {
    // Only rings whose proxy girth came from the predicted default (the chart's rings are the fit engine's, not a prediction).
    if (spec.girthSource[ring] !== 'mannequin + proxy default ease') continue;
    rows.push(row(`defaultEase.${ring}`, 'cm', v.value, px.easeCm[ring] ?? null, me.easeCm[ring] ?? null, v.sigma, 'cm of girth over mannequin M'));
  }
  const lengthSynthetic = pat.length.provenance === 'synthetic';
  const synthNote = lengthSynthetic ? '; NOT a prediction: the length was set to the synthetic truth\'s (provenance synthetic)' : '';
  rows.push(row('hemY', 'cm', spec.hemY, px.hemY, me.hemY, pat.length.sigmaCm || null, `hem height above the floor; rule: ${pat.length.source}${synthNote}`, !lengthSynthetic));
  const def = lengthDefinitionOf(kind, pat.length.rule);
  // A printed flat-lay length is the prediction itself; any other length is the drop to the hem the proxy resolved (hemY).
  const predictedLength = def === 'hps_surface' ? (pat.length.rule.from === 'printed' ? pat.length.rule.cm : null) : originY(m, def) - spec.hemY;
  rows.push(row(`length.${def}`, 'cm', predictedLength, px.lengthCm, me.lengthCm, pat.length.sigmaCm || null, `${def === 'hps_surface' ? 'flat-lay: along the front from the HPS' : 'vertical drop from the rule origin to the lowest body (trousers: left leg) cloth'}${synthNote}`, !lengthSynthetic));
  if (pat.sleeve.rule.from !== 'none' || (me.sleeveCm ?? 0) > 0) {
    rows.push(row('sleeve.lengthCm', 'cm', spec.sleeveCm, px.sleeveCm, me.sleeveCm, pat.sleeve.sigmaCm || null, pat.sleeve.source));
    const uaPred = spec.girths.upper_arm !== undefined ? spec.girths.upper_arm / m.shape.rings.upper_arm.circumferenceCm : null;
    rows.push(row('sleeve.upperArmRatio', 'ratio', uaPred, px.upperArmRatio, me.upperArmRatio, pat.defaultEase.upper_arm ? pat.defaultEase.upper_arm.sigma! / m.shape.rings.upper_arm.circumferenceCm : null));
  }
  rows.push(row('depthRatio.hem', 'ratio', null, px.depthRatio.hem, me.depthRatio.hem, null, 'derived descriptor (P0 predicts no depth): proxy vs stage 4t'));
  if (circular) for (const r of rows) r.informative = false;
  const c = chamfer(o.proxyMesh, o.stage4t, o.samples ?? 50000);
  const regions = regionChamfer(o.proxyMesh, o.stage4t, GARMENT_REGIONS, garmentRegion(m), o.samples ?? 50000);
  const used = rows.filter((r) => r.informative);
  const zs = used.map((r) => r.z).filter((z): z is number => z !== null);
  const hemRow = used.find((r) => r.parameter === 'hemY');
  const lenRow = used.find((r) => r.parameter.startsWith('length.'));
  const uaRow = used.find((r) => r.parameter === 'sleeve.upperArmRatio');
  const hemGirthPred = circular ? null : px.hemGirthCm;
  if (circular) notes.push(`not informative: ${circular}. Every row and the Chamfer measure stage 4t against its own template, not the prediction; v1 is empty`);
  else if (lengthSynthetic) notes.push('the length is the synthetic truth\'s, not predicted: the hemY and length rows are left out of v1');
  if (pr.predictorVersion !== PREDICTOR_VERSION) notes.push(`prediction.json is ${pr.predictorVersion}; this code is ${PREDICTOR_VERSION}`);
  return {
    format: 'curtain.drape.shadow',
    formatVersion: 1,
    version: DRAPE_LOG_VERSION,
    productId: o.productId,
    predictorVersion: pr.predictorVersion,
    cell: pr.cell,
    source: o.source,
    rows,
    chamfer: c,
    regions,
    v1: {
      hemHeightErrCm: hemRow?.error ?? null,
      lengthErrCm: lenRow?.error ?? null,
      hemGirthErrPct: hemGirthPred && me.hemGirthCm ? r3(((me.hemGirthCm - hemGirthPred) / hemGirthPred) * 100) : null,
      upperArmErrCm: uaRow && uaRow.error !== null ? r3(uaRow.error * m.shape.rings.upper_arm.circumferenceCm) : null,
      chamferCm: circular ? null : c.chamferCmMean,
      sigmaWithin128: zs.length ? r3(zs.filter((z) => z <= 1.28).length / zs.length) : null,
      excluded: rows.filter((r) => !r.informative).map((r) => r.parameter).concat(circular ? ['chamfer'] : []),
    },
    informative: { value: !circular, reason: circular },
    notes,
  };
}

/** The P0 predicted shape of a product: the proxy built from the prediction, opened (no caps), with its spec. */
export function predictedShape(m: Mannequin, payload: GarmentPayload, baseSize: string, prediction: Prediction, features: GarmentFeatures | null | undefined): { spec: ProxySpec; mesh: Mesh } {
  return openedProxy(m, payload, baseSize, { ...(features ? { features } : {}), prediction });
}

/** Hash of a set of exemplars as `predict()` records it. */
export const exemplarSetHash = (ex: readonly Exemplar[]): string => `fnv1a32:${fnv1a(canonical([...ex].sort((a, b) => (a.productId < b.productId ? -1 : 1))))}`;
