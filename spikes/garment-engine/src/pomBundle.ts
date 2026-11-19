/**
 * The POM tee as a device bundle (men-3d-plan slice M3): the five files of `bundle.ts` (base.glb,
 * anchors.json, grading.json, material.json, qa.json) from a tee's flat measurements, so the
 * existing viewer loads it, grades it and drapes it on the device exactly as it does any bundle.
 *
 * - **Base mesh**: `buildPomTee` of the base size on the canonical body of the product's family (the
 *   male M for a men's tee). Nothing is reconstructed, calibrated or distorted.
 * - **Grading**: the device grades the base mesh with `gradingMorph` (radial about the body axis and
 *   the arm axes, lengths stretched below the hip and along the sleeve). The targets per size are the
 *   tape's differences, not the chart's: torso rings take the base girth plus the difference of the two
 *   sizes' POM girth profiles at the ring's height; the shoulder ring scales by the shoulder ratio
 *   (the shoulder points then land at ±shoulder / 2); the upper-arm ring and both lengths are measured
 *   on every size built on the same body. `compareGrading` measures what the device's morph misses
 *   against each size built directly.
 * - **QA**: no chart agreement was measured (nothing to calibrate); `chartAgreement.kind` is
 *   `tape-built`, so the import flags the asset `tape_built_no_chart_check` and the merchant is told.
 *   What qa.json does report is the builder's own tape against every input measurement, per size
 *   (`pomTape`), the M3 gate (within 0.5 cm).
 */
import { createHash } from 'node:crypto';
import type { AnchorId, AnchorRing, AnchorValues } from '@curtain/anchors';
import type { GarmentPayload } from '@curtain/schema';
import { MALE_REFERENCE, MANNEQUIN_VERSION, buildBody, loopAround, round, roundVec, slice, topology, vertexNormals, writeGlb, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import { measureGarment, ringGirths, type AnchorMeasurements } from './anchoring';
import { bundleMannequin, mannequinFor, PIPELINE_VERSION, type Bundle } from './bundle';
import { assignChains } from './garment';
import { applyGrading, type GradingJson, type SizeGrading } from './grading';
import { materialJson } from './product';
import { POM_TEE_ASSUMPTIONS, buildPomTee, measurePomTee, type PomTeeBuild, type PomTeeRow } from './pomTee';
import { hexToRgb } from './raster';
import { densifyLoop, tapeGirth } from './tape';

export const POM_BUILDER_VERSION = 'pom-tee-0.1.0';
/** The M3 gate: every input measurement on the built mesh within this of the tape, cm. */
export const POM_TAPE_TOLERANCE_CM = 0.5;

const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Tape girth of the torso where a level plane at height y cuts it (the loop round the body axis; sleeves are other loops). */
export function torsoTapeAt(mesh: Pick<Mesh, 'positions' | 'indices'>, y: number): number | null {
  const loops = slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] });
  const l = loopAround(loops, [0, y, 0], [1, 0, 0], [0, 0, 1]);
  if (!l) return null;
  return tapeGirth(densifyLoop(l).points, [0, y, 0], [1, 0, 0], [0, 0, 1])?.girthCm ?? null;
}

export const POM_KEYS = ['chestWidthCm', 'waistWidthCm', 'hemWidthCm', 'shoulderCm', 'lengthCm', 'sleeveLengthCm', 'sleeveOpeningCm'] as const;
export type PomKey = (typeof POM_KEYS)[number];

/** Built minus asked, per input measurement given, cm. */
export function pomErrors(asked: PomTeeRow, got: PomTeeRow): Partial<Record<PomKey, number>> {
  const out: Partial<Record<PomKey, number>> = {};
  for (const k of POM_KEYS) {
    const a = asked[k], g = got[k];
    if (typeof a === 'number' && typeof g === 'number') out[k] = g - a;
  }
  return out;
}

export interface PomSizeCheck {
  size: string;
  /** The body the size was built on for this check: the family's table body of the same label when there is one, else the base. */
  body: string;
  measured: PomTeeRow;
  errorCm: Partial<Record<PomKey, number>>;
  maxAbsCm: number;
  tight: PomTeeBuild['tight'];
}

/** The table body of a family size (male S…XXL), or null. */
function tableBody(family: 'male' | 'female', size: string): Mannequin | null {
  if (family !== 'male') return null;
  const t = MALE_TABLE[size];
  return t ? buildBody({ family: 'male', bust: t.chest, waist: t.waist, hip: t.hip, heightCm: t.stature, shoulderCm: t.shoulderWidth }) : null;
}
const MALE_TABLE = MALE_REFERENCE as Readonly<Record<string, { chest: number; waist: number; hip: number; stature: number; shoulderWidth: number }>>;

export interface PomBundle extends Omit<Bundle, 'calibration' | 'agreement' | 'separation'> {
  base: PomTeeBuild;
  /** Every size built on its own table body and taped (the M3 gate). */
  tape: PomSizeCheck[];
  /** Every size built on the base body, the device's grading of the base against it. */
  grading: GradingJson;
  gradingCheck: GradingCheck[];
}

export interface GradingCheck {
  size: string;
  /** Device grading of the base mesh, taped, minus the tape's value, cm. */
  errorCm: Partial<Record<PomKey, number>>;
  /** Vertex distance between the graded base and the direct build (same topology only), cm; null when the topologies differ. */
  vertexRmsCm: number | null;
}

export function buildPomBundle(productId: string, payload: GarmentPayload, rows: readonly PomTeeRow[], baseSize = 'M'): PomBundle {
  const m = mannequinFor(payload);
  const meta = bundleMannequin(m);
  const family = m.shape.family === 'male' ? 'male' : 'female';
  const baseIdx = rows.findIndex((r) => r.size === baseSize);
  if (baseIdx < 0) throw new Error(`base size ${baseSize} not in the measurements`);
  const step = (i: number): number => i - baseIdx;

  // Every size on the base body: the base mesh, and what the device's grading should reach.
  const onBase = rows.map((row, i) => buildPomTee(m, row, { sizeStep: step(i) }));
  const base = onBase[baseIdx]!;
  const chains = assignChains(m, base.mesh);
  const measurements = pomMeasurements(m, base);
  const sizeMeas = onBase.map((b) => pomMeasurements(m, b));

  // The tape on every size, on its own table body (a small size cannot be built on a bigger body: it is tighter than the body).
  const tape: PomSizeCheck[] = rows.map((row, i) => {
    const body = tableBody(family, row.size);
    const b = body ? buildPomTee(body, row, { sizeStep: step(i) }) : onBase[i]!;
    const measured = { ...measurePomTee(body ?? m, b, torsoTapeAt), size: row.size };
    const errorCm = pomErrors(row, measured);
    return { size: row.size, body: body ? `${family} ${row.size}` : `${family} ${baseSize}`, measured, errorCm, maxAbsCm: Math.max(...Object.values(errorCm).map(Math.abs)), tight: b.tight };
  });

  const grading = gradePom(m, productId, rows, baseIdx, onBase, measurements, sizeMeas);
  const gradingCheck: GradingCheck[] = rows.map((row, i) => {
    const graded = applyGrading(m, base.mesh, chains, grading, row.size);
    const viaGrading = measurePomTee(m, { ...base, mesh: graded }, torsoTapeAt);
    const errorCm = pomErrors(row, viaGrading);
    const same = onBase[i]!.mesh.positions.length === graded.positions.length && onBase[i]!.mesh.indices.length === graded.indices.length;
    let vertexRmsCm: number | null = null;
    if (same) {
      let s = 0;
      const p = graded.positions, q = onBase[i]!.mesh.positions;
      for (let k = 0; k < p.length; k += 3) s += (p[k]! - q[k]!) ** 2 + (p[k + 1]! - q[k + 1]!) ** 2 + (p[k + 2]! - q[k + 2]!) ** 2;
      vertexRmsCm = Math.sqrt(s / (p.length / 3));
    }
    return { size: row.size, errorCm, vertexRmsCm };
  });

  const material = materialJson(payload);
  const health = topology(base.mesh);
  const inputHash = createHash('sha256').update(JSON.stringify({ payload, rows, baseSize, builder: POM_BUILDER_VERSION, assumptions: POM_TEE_ASSUMPTIONS, mannequin: MANNEQUIN_VERSION, pipeline: PIPELINE_VERSION, ...(meta.family ? { family: meta.family } : {}) })).digest('hex');
  const chartBase: Partial<Record<AnchorRing, number>> = {};
  const chartRow = payload.sizeChart.find((r) => r.size === baseSize);
  if (chartRow?.bust !== undefined) chartBase.chest = chartRow.bust;
  if (chartRow?.waist !== undefined) chartBase.waist = chartRow.waist;
  if (chartRow?.hip !== undefined) chartBase.hip = chartRow.hip;
  const P = (i: number): Vec3 => [base.mesh.positions[3 * i]!, base.mesh.positions[3 * i + 1]!, base.mesh.positions[3 * i + 2]!];

  const anchors = {
    format: 'curtain.garment.anchors',
    formatVersion: 1,
    productId,
    baseSize,
    category: 'top',
    unit: 'cm',
    mannequin: meta,
    pipelineVersion: PIPELINE_VERSION,
    builder: POM_BUILDER_VERSION,
    inputHash,
    synthetic: true,
    rings: Object.fromEntries(
      Object.entries(measurements.rings).map(([id, r]) => {
        const frame = m.rings.find((x) => x.id === id)!;
        return [id, {
          circumferenceCm: round(r!.circumferenceCm, 2),
          chartCm: chartBase[id as AnchorRing] ?? null,
          offsetCm: r!.offsetCm ? { mean: round(r!.offsetCm.mean, 2), min: round(r!.offsetCm.min, 2), max: round(r!.offsetCm.max, 2) } : null,
          spansBothLegs: r!.spansBothLegs,
          plane: { centre: roundVec(frame.centre, 3), normal: roundVec(frame.normal, 6) },
          loop: r!.loop.map((p) => roundVec(p, 2)),
        }];
      }),
    ),
    // The shoulder points are mesh vertices here (the builder sews the sleeve to them), not notional chart points.
    breadths: { shoulder_width: { widthCm: round(rows[baseIdx]!.shoulderCm, 2), source: 'pom', ring: 'shoulder', seams: base.shoulderPoint.map((i) => roundVec(P(i), 2)) } },
    lengths: Object.fromEntries(Object.entries(measurements.lengths).map(([id, l]) => [id, { lengthCm: round(l!.lengthCm, 2), start: roundVec(l!.start, 2), end: roundVec(l!.end, 2), fromMannequin: l!.fromMannequin }])),
    calibration: { globalScale: 1, ringCorrections: {}, sources: {}, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
  };

  const worst = Math.max(...tape.map((t) => t.maxAbsCm));
  const qa = {
    format: 'curtain.garment.qa',
    formatVersion: 1,
    productId,
    synthetic: true,
    inputHash,
    ...(meta.family ? { mannequin: meta } : {}),
    chartAgreement: {
      kind: 'tape-built',
      pass: true,
      basis: `Built from the flat garment measurements (${POM_BUILDER_VERSION}); nothing was reconstructed, so there is no chart to calibrate against. pomTape below is the builder's own tape of every input measurement on every size, built on the family's table body of that size.`,
      maxAbsCm: null,
      perRingCm: {},
    },
    pomTape: {
      toleranceCm: POM_TAPE_TOLERANCE_CM,
      pass: worst <= POM_TAPE_TOLERANCE_CM,
      maxAbsCm: r2(worst),
      sizes: tape.map((t) => ({ size: t.size, body: t.body, maxAbsCm: r2(t.maxAbsCm), errorCm: Object.fromEntries(Object.entries(t.errorCm).map(([k, v]) => [k, r2(v!)])), ...(t.tight.length ? { tighterThanBody: t.tight } : {}) })),
    },
    gradingCheck: gradingCheck.map((g) => ({ size: g.size, errorCm: Object.fromEntries(Object.entries(g.errorCm).map(([k, v]) => [k, r2(v!)])), vertexRmsCm: g.vertexRmsCm === null ? null : r2(g.vertexRmsCm) })),
    assumptions: POM_TEE_ASSUMPTIONS,
    calibration: { globalScale: 1, residualBeforeCm: { rms: 0, maxAbs: 0 }, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
    meshHealth: { triangles: health.triangles, vertices: health.vertices, boundaryEdges: health.boundaryEdges, nonManifoldEdges: health.nonManifoldEdges, inconsistentEdges: health.inconsistentEdges, pieces: 1, triangleBudget: [8000, 15000], withinBudget: health.triangles <= 15000 },
    separation: null,
    gradingEstimates: grading.estimates,
  };

  const color = hexToRgb(payload.primaryColorHex ?? '#888888');
  const glb = writeGlb([{ name: productId, positions: base.mesh.positions, normals: vertexNormals(base.mesh), indices: base.mesh.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.85, doubleSided: true }], {
    scale: 0.01,
    generator: `@curtain/garment-spike ${PIPELINE_VERSION} ${POM_BUILDER_VERSION}`,
    extras: { productId, baseSize, unit: 'm', synthetic: true, inputHash },
  });

  return {
    productId,
    files: { 'base.glb': glb, 'anchors.json': json(anchors), 'grading.json': json(grading), 'material.json': json(material), 'qa.json': json(qa) },
    mannequin: m,
    baseMesh: base.mesh,
    measurements,
    material,
    base,
    tape,
    grading,
    gradingCheck,
  };
}

/**
 * The anchor measurements of a POM tee (`measureGarment`), with the two rings its welded sleeves
 * confuse taken on the right part: the shoulder ring as a tape round everything at its height
 * (torso and both sleeve caps: one loop over the shoulders), the upper-arm ring on the sleeve alone
 * (the plane across the arm also cuts the torso's side under the armhole, and on a large size the two
 * loops merge).
 */
export function pomMeasurements(m: Mannequin, b: PomTeeBuild): AnchorMeasurements {
  const out = measureGarment(m, b.mesh, 'top', assignChains(m, b.mesh));
  const mesh = b.mesh;
  const shoulder = m.rings.find((r) => r.id === 'shoulder')!;
  const all = slice(mesh.positions, mesh.indices, { origin: shoulder.centre, normal: shoulder.normal }).flatMap((l) => densifyLoop(l).points);
  const t = tapeGirth(all, shoulder.centre, shoulder.u, shoulder.v, { maxGapCm: 40, maxGapDeg: 120, minCoverage: 0.3 });
  if (t) out.rings.shoulder = { id: 'shoulder', circumferenceCm: t.girthCm, loop: t.loop.points.filter((_, i) => i % Math.max(1, Math.floor(t.loop.points.length / 32)) === 0).slice(0, 32), offsetCm: null, spansBothLegs: false };
  const ua = m.rings.find((r) => r.id === 'upper_arm' && r.side === 'left')!;
  const sleeveOnly = (tri: number): boolean => mesh.vertexPart[mesh.indices[3 * tri]!]! === 1 && mesh.vertexPart[mesh.indices[3 * tri + 1]!]! === 1 && mesh.vertexPart[mesh.indices[3 * tri + 2]!]! === 1;
  const loop = loopAround(slice(mesh.positions, mesh.indices, { origin: ua.centre, normal: ua.normal }, sleeveOnly), ua.centre, ua.u, ua.v);
  if (loop) {
    const t2 = tapeGirth(densifyLoop(loop).points, ua.centre, ua.u, ua.v);
    if (t2) out.rings.upper_arm = { id: 'upper_arm', circumferenceCm: t2.girthCm, loop: t2.loop.points.slice(0, 32), offsetCm: null, spansBothLegs: false };
  } else delete out.rings.upper_arm;
  return out;
}

/** The POM girth profile of a size at height y (what `buildPomTee` asks of the tube), cm. */
function pomGirthAt(m: Mannequin, row: PomTeeRow, b: PomTeeBuild, y: number): number {
  const gC = 2 * row.chestWidthCm, gH = 2 * row.hemWidthCm, gW = row.waistWidthCm === undefined ? undefined : 2 * row.waistWidthCm;
  const yC = b.levels.chestLineY, yW = m.morphHeights.waist, yH = b.levels.hemY;
  if (y >= yC) return gC;
  if (gW !== undefined && y >= yW) return gW + ((gC - gW) * (y - yW)) / (yC - yW);
  if (gW !== undefined) return gH + ((gW - gH) * (y - yH)) / (yW - yH);
  return gH + ((gC - gH) * (y - yH)) / (yC - yH);
}

function gradePom(m: Mannequin, productId: string, rows: readonly PomTeeRow[], baseIdx: number, onBase: PomTeeBuild[], base: AnchorMeasurements, sizeMeas: AnchorMeasurements[]): GradingJson {
  const baseValues: AnchorValues = {};
  for (const [id, g] of Object.entries(ringGirths(base)) as [AnchorRing, number][]) baseValues[id] = g;
  for (const id of ['shoulder_to_hem', 'sleeve'] as const) {
    const l = base.lengths[id];
    if (l && !l.fromMannequin) baseValues[id] = l.lengthCm;
  }
  baseValues.shoulder_width = rows[baseIdx]!.shoulderCm;
  const baseRow = rows[baseIdx]!, baseBuild = onBase[baseIdx]!;
  const sources: SizeGrading['sources'] = {};
  const sizes: SizeGrading[] = rows.map((row, i) => {
    const targets: AnchorValues = {};
    for (const [id, b] of Object.entries(baseValues) as [AnchorId, number][]) {
      let v: number;
      if (id === 'shoulder_width') v = row.shoulderCm;
      else if (id === 'shoulder') v = b * (row.shoulderCm / baseRow.shoulderCm);
      // The sleeve grades with its opening (the morph holds the upper arm's scale down to the hem), its length with the tape's.
      else if (id === 'upper_arm') v = b * (row.sleeveOpeningCm / baseRow.sleeveOpeningCm);
      else if (id === 'sleeve') v = b + row.sleeveLengthCm - baseRow.sleeveLengthCm;
      else if (id === 'shoulder_to_hem') v = sizeMeas[i]!.lengths[id]?.lengthCm ?? b;
      else v = b + pomGirthAt(m, row, onBase[i]!, m.morphHeights[id as AnchorRing]) - pomGirthAt(m, baseRow, baseBuild, m.morphHeights[id as AnchorRing]);
      targets[id] = r2(v);
      sources[id] = 'chart';
    }
    return { size: row.size, step: i - baseIdx, targets, sources: { ...sources } };
  });
  const heights = {} as Record<AnchorRing, number>;
  for (const [k, v] of Object.entries(m.morphHeights) as [AnchorRing, number][]) heights[k] = r2(v);
  const roundedBase: AnchorValues = {};
  for (const [k, v] of Object.entries(baseValues) as [AnchorId, number][]) roundedBase[k] = r2(v);
  return {
    format: 'curtain.garment.grading',
    formatVersion: 1,
    productId,
    baseSize: rows[baseIdx]!.size,
    unit: 'cm',
    morph: { method: 'anchors.gradingMorph', chains: { body: 'radial about +Y', arm: 'radial about the arm axis' }, heights, breadths: { shoulder_width: { ring: 'shoulder', height: heights.shoulder } } },
    base: roundedBase,
    sizes,
    estimates: {},
  };
}
