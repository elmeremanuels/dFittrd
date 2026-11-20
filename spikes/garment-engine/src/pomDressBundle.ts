/**
 * The tape-built strap dress (`pomDress.ts`) as a device bundle: the five files of `bundle.ts` (base.glb,
 * anchors.json, grading.json, material.json, qa.json), so the existing viewer loads it, grades it and drapes it on the
 * device as it does any bundle. The women's counterpart of `pomBundle.ts` (the men's tee), kept in its own file.
 *
 * - **Base mesh**: `buildPomDress` of the base size on the canonical female body (shape M). Nothing is reconstructed.
 * - **Grading**: the device grades the base mesh with `gradingMorph` (radial about the body axis, lengths stretched
 *   below the hip). Bodice rings take the base girth plus the difference of the two sizes' tape girth at the ring's
 *   height; skirt rings the base cloth length times the ratio of the two sizes' cloth length there (a radial scale
 *   scales a folded row's cloth by the same factor). A knot at the knee ring's height, below the hem, carries the
 *   skirt's cloth line continued to that height, so the hem between the thigh and that knot grades to the tape's sweep.
 *   The device's morph cannot move the seam, the top edge or the straps: what it misses against each size built
 *   directly is in qa.json `gradingCheck`.
 * - **QA**: `chartAgreement.kind` is `tape-built` (nothing to calibrate), so the import flags the asset
 *   `tape_built_no_chart_check`. `pomTape` is the builder's own tape of every input on every size, built on the AU
 *   chart body of that size (the gate, 0.5 cm); `tapeProvenance` says which sizes are measured and which filled.
 */
import { createHash } from 'node:crypto';
import type { AnchorId, AnchorRing, AnchorValues } from '@curtain/anchors';
import { AU_WOMENS_BODY_CHART, type GarmentPayload } from '@curtain/schema';
import { MANNEQUIN_VERSION, buildBody, round, roundVec, topology, vertexNormals, writeGlb, type Mannequin, type Vec3 } from '@curtain/mannequin';
import { measureGarment, ringGirths, type AnchorMeasurements } from './anchoring';
import { bundleMannequin, mannequinFor, PIPELINE_VERSION, type Bundle } from './bundle';
import { assignChains } from './garment';
import { applyGrading, type GradingJson, type SizeGrading } from './grading';
import { materialJson } from './product';
import { POM_DRESS_ASSUMPTIONS, buildPomDress, measurePomDress, pomDressErrors, type PomDressBuild, type PomDressKey, type PomDressRow } from './pomDress';
import { hexToRgb } from './raster';

export const POM_DRESS_BUILDER_VERSION = 'pom-dress-0.1.0';
/** The gate: every input measurement on the built mesh within this of the tape, cm (as the tee's). */
export const POM_DRESS_TAPE_TOLERANCE_CM = 0.5;
/** Rings of the dress that carry a grading knot (the straps cross the shoulder and neck rings and are not rings of cloth). */
export const POM_DRESS_RINGS = ['chest', 'underbust', 'waist', 'hip', 'thigh'] as const satisfies readonly AnchorRing[];

/** The top edge band the device holds the dress by, cm under the top edge [A]. */
export const POM_DRESS_PIN_BAND_CM = 1.7;

const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface PomDressSizeCheck {
  size: string;
  /** The body the size was built on for this check. */
  body: string;
  provenance: string;
  measured: PomDressRow;
  errorCm: Partial<Record<PomDressKey, number>>;
  maxAbsCm: number;
  tight: PomDressBuild['tight'];
  /** Where the size lies on that body, cm: top edge above the bust line, seam above the underbust ring, hem above the knee ring. */
  onBodyCm: { topEdgeAboveBustLine: number; seamAboveUnderbust: number; hemAboveKnee: number };
}

export interface PomDressGradingCheck {
  size: string;
  /** Device grading of the base mesh, taped, minus the tape's value, cm. */
  errorCm: Partial<Record<PomDressKey, number>>;
}

export interface PomDressBundle extends Omit<Bundle, 'calibration' | 'agreement' | 'separation'> {
  base: PomDressBuild;
  tape: PomDressSizeCheck[];
  grading: GradingJson;
  gradingCheck: PomDressGradingCheck[];
}

/** The AU chart body of a size (bust, waist, hip of `AU_WOMENS_BODY_CHART`; every other dimension is the mannequin's), or null. */
export function auChartBody(size: string, heightCm?: number): Mannequin | null {
  const row = AU_WOMENS_BODY_CHART.find((r) => r.size === size);
  if (!row || row.bust === undefined || row.waist === undefined || row.hip === undefined) return null;
  return buildBody({ family: 'female', bust: row.bust, waist: row.waist, hip: row.hip, ...(heightCm === undefined ? {} : { heightCm }) });
}

export function buildPomDressBundle(productId: string, payload: GarmentPayload, rows: readonly PomDressRow[], provenance: Readonly<Record<string, string>>, baseSize = '12'): PomDressBundle {
  const m = mannequinFor(payload);
  if (m.shape.family !== 'female') throw new Error('pomDress: the dress is built on the female mannequin');
  const meta = bundleMannequin(m);
  const baseIdx = rows.findIndex((r) => r.size === baseSize);
  if (baseIdx < 0) throw new Error(`base size ${baseSize} not in the measurements`);

  const base = buildPomDress(m, rows[baseIdx]!);
  const chains = assignChains(m, base.mesh);
  if (chains.some((c) => c !== 0)) throw new Error('pomDress: part of the dress was read as a sleeve');
  const measurements = dressMeasurements(m, base);

  // The tape on every size, on its own AU chart body (a small size cannot be built on a bigger body).
  const tape: PomDressSizeCheck[] = rows.map((row, i) => {
    const body = auChartBody(row.size);
    const on = body ?? m;
    const b = body ? buildPomDress(body, row) : i === baseIdx ? base : buildPomDress(m, row);
    const measured = { ...measurePomDress(b.mesh.positions, b), size: row.size };
    const errorCm = pomDressErrors(row, measured);
    return {
      size: row.size,
      body: body ? `AU ${row.size} chart body` : 'female M',
      provenance: provenance[row.size] ?? 'measured',
      measured,
      errorCm,
      maxAbsCm: Math.max(...Object.values(errorCm).map(Math.abs)),
      tight: b.tight,
      onBodyCm: { topEdgeAboveBustLine: r2(b.levels.topY - on.morphHeights.chest), seamAboveUnderbust: r2(b.levels.seamY - on.morphHeights.underbust), hemAboveKnee: r2(b.levels.hemY - on.morphHeights.knee) },
    };
  });

  const grading = gradeDress(m, productId, rows, baseIdx, base, measurements);
  // The length target is solved against the device's own morph (it stretches only below the hip), so the graded mesh's
  // centre front is the tape's length.
  for (const [i, row] of rows.entries()) {
    if (i === baseIdx) continue;
    const entry = grading.sizes[i]!;
    for (let it = 0; it < 5; it++) {
      const got = measurePomDress(applyGrading(m, base.mesh, chains, grading, row.size).positions, base);
      const dL = row.lengthCm - got.lengthCm;
      if (Math.abs(dL) < 0.02) break;
      entry.targets.shoulder_to_hem = r2(entry.targets.shoulder_to_hem! + dL);
    }
  }
  const gradingCheck: PomDressGradingCheck[] = rows.map((row) => ({ size: row.size, errorCm: pomDressErrors(row, measurePomDress(applyGrading(m, base.mesh, chains, grading, row.size).positions, base)) }));

  const material = materialJson(payload);
  const health = topology(base.mesh);
  const inputHash = createHash('sha256').update(JSON.stringify({ payload, rows, provenance, baseSize, builder: POM_DRESS_BUILDER_VERSION, assumptions: POM_DRESS_ASSUMPTIONS, mannequin: MANNEQUIN_VERSION, pipeline: PIPELINE_VERSION })).digest('hex');
  const chartRow = payload.sizeChart.find((r) => r.size === baseSize);
  const chartBase: Partial<Record<AnchorRing, number>> = chartRow?.bust !== undefined ? { chest: chartRow.bust } : {};

  const anchors = {
    format: 'curtain.garment.anchors',
    formatVersion: 1,
    productId,
    baseSize,
    category: 'dress',
    unit: 'cm',
    mannequin: meta,
    pipelineVersion: PIPELINE_VERSION,
    builder: POM_DRESS_BUILDER_VERSION,
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
    // How the device holds it: by its top edge band (the top edge and the row under it) and the straps, with no cling pull.
    // The underbust seam does not stretch past the fabric's own give.
    support: { pinFromCm: r2(base.levels.topY - POM_DRESS_PIN_BAND_CM), cling: false, seamsAtCm: [r2(base.levels.seamY)], seamStretchPct: payload.fabric.stretchPct, holdLength: true },
    breadths: {},
    lengths: Object.fromEntries(Object.entries(measurements.lengths).map(([id, l]) => [id, { lengthCm: round(l!.lengthCm, 2), start: roundVec(l!.start, 2), end: roundVec(l!.end, 2), fromMannequin: l!.fromMannequin }])),
    calibration: { globalScale: 1, ringCorrections: {}, sources: {}, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
  };

  const worst = Math.max(...tape.map((t) => t.maxAbsCm));
  const errs = (e: Partial<Record<PomDressKey, number>>): Record<string, number> => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, r2(v!)]));
  const qa = {
    format: 'curtain.garment.qa',
    formatVersion: 1,
    productId,
    synthetic: true,
    inputHash,
    chartAgreement: {
      kind: 'tape-built',
      pass: worst <= POM_DRESS_TAPE_TOLERANCE_CM,
      basis: `Built from flat garment measurements (${POM_DRESS_BUILDER_VERSION}); nothing was reconstructed, so there is no chart to calibrate against. pomTape below is the builder's own tape of every input measurement on every size, built on the AU chart body of that size.`,
      maxAbsCm: null,
      perRingCm: {},
    },
    tapeProvenance: {
      rule: 'A size between two measured sizes is the straight line between them on the AU size number (interpolated). No size outside the measured ones is filled.',
      synthetic: 'Every number is invented (SYNTHETIC): no garment was measured.',
      sizes: Object.fromEntries(rows.map((r) => [r.size, provenance[r.size] ?? 'measured'])),
    },
    pomTape: {
      toleranceCm: POM_DRESS_TAPE_TOLERANCE_CM,
      pass: worst <= POM_DRESS_TAPE_TOLERANCE_CM,
      maxAbsCm: r2(worst),
      sizes: tape.map((t) => ({ size: t.size, provenance: t.provenance, body: t.body, maxAbsCm: r2(t.maxAbsCm), errorCm: errs(t.errorCm), onBodyCm: t.onBodyCm, ...(t.tight.length ? { tighterThanBody: t.tight } : {}) })),
    },
    gradingCheck: gradingCheck.map((g) => ({ size: g.size, errorCm: errs(g.errorCm) })),
    assumptions: POM_DRESS_ASSUMPTIONS,
    calibration: { globalScale: 1, residualBeforeCm: { rms: 0, maxAbs: 0 }, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
    meshHealth: { triangles: health.triangles, vertices: health.vertices, boundaryEdges: health.boundaryEdges, nonManifoldEdges: health.nonManifoldEdges, inconsistentEdges: health.inconsistentEdges, pieces: 1, triangleBudget: [8000, 15000], withinBudget: health.triangles <= 15000 },
    separation: null,
    gradingEstimates: grading.estimates,
  };

  const color = hexToRgb(payload.primaryColorHex ?? '#888888');
  const glb = writeGlb([{ name: productId, positions: base.mesh.positions, normals: vertexNormals(base.mesh), indices: base.mesh.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.85, doubleSided: true }], {
    scale: 0.01,
    generator: `@curtain/garment-spike ${PIPELINE_VERSION} ${POM_DRESS_BUILDER_VERSION}`,
    extras: { productId, baseSize, inputHash, unit: 'm', synthetic: true },
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
 * The anchor measurements of the dress: the rings of cloth it has (`POM_DRESS_RINGS`; a skirt ring's girth is its cloth
 * length, folds included), and its length from the mannequin's high point shoulder straight down to the hem. That length
 * is the device's handle on the hem (`lengthMorph`), not a tape number: the tape's length runs from the top edge.
 */
export function dressMeasurements(m: Mannequin, b: PomDressBuild): AnchorMeasurements {
  const all = measureGarment(m, b.mesh, 'dress', assignChains(m, b.mesh));
  const rings: AnchorMeasurements['rings'] = {};
  for (const id of POM_DRESS_RINGS) if (all.rings[id]) rings[id] = all.rings[id];
  const hps = m.landmarks.hps;
  const cf = b.centreFront[b.centreFront.length - 1]!;
  const lengths: AnchorMeasurements['lengths'] = { ...all.lengths };
  lengths.shoulder_to_hem = { id: 'shoulder_to_hem', lengthCm: hps[1] - b.levels.hemY, start: hps as Vec3, end: [hps[0], b.levels.hemY, b.mesh.positions[3 * cf + 2]!], fromMannequin: false };
  return { rings, lengths };
}

function gradeDress(m: Mannequin, productId: string, rows: readonly PomDressRow[], baseIdx: number, baseBuild: PomDressBuild, base: AnchorMeasurements): GradingJson {
  const baseRow = rows[baseIdx]!;
  const { seamY, hemY, bustLineY } = baseBuild.levels;
  const y0 = seamY - POM_DRESS_ASSUMPTIONS.seamGapCm;
  /** Tape girth of the bodice of a size at height y, on the base size's levels (the device does not move the seam). */
  const bodiceGirth = (row: PomDressRow, y: number): number => (y >= bustLineY ? 2 * row.bustWidthCm : lerp(2 * row.seamWidthCm, 2 * row.bustWidthCm, Math.max(0, (y - seamY) / (bustLineY - seamY))));
  /** Cloth length of a skirt row of a size at height y: the straight line from its top to its hem, continued below the hem. */
  const skirtCloth = (row: PomDressRow, y: number): number => lerp(2 * (row.skirtTopWidthCm ?? row.seamWidthCm), 2 * row.hemWidthCm, (y0 - y) / (y0 - hemY));

  const baseValues: AnchorValues = {};
  for (const [id, g] of Object.entries(ringGirths(base)) as [AnchorRing, number][]) baseValues[id] = g;
  // Below the hem: the skirt's cloth line continued to the knee ring's height. Not a ring of cloth, a knot for the morph.
  const kneeY = m.morphHeights.knee;
  const virtualKnee = kneeY < hemY && baseValues.thigh !== undefined;
  if (virtualKnee) baseValues.knee = skirtCloth(baseRow, kneeY);
  baseValues.shoulder_to_hem = base.lengths.shoulder_to_hem!.lengthCm;

  const sources: SizeGrading['sources'] = {};
  const sizes: SizeGrading[] = rows.map((row, i) => {
    const targets: AnchorValues = {};
    for (const [id, b] of Object.entries(baseValues) as [AnchorId, number][]) {
      let v: number;
      if (id === 'shoulder_to_hem') v = b + row.lengthCm - baseRow.lengthCm;
      else {
        const y = m.morphHeights[id as AnchorRing];
        v = y >= seamY ? b + bodiceGirth(row, y) - bodiceGirth(baseRow, y) : (b * skirtCloth(row, y)) / skirtCloth(baseRow, y);
      }
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
    baseSize: baseRow.size,
    unit: 'cm',
    morph: { method: 'anchors.gradingMorph', chains: { body: 'radial about +Y', arm: 'radial about the arm axis' }, heights },
    base: roundedBase,
    sizes,
    estimates: {},
  };
}
