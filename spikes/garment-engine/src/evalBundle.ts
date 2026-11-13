/**
 * The asset bundle of an evaluated garment, in the spike bundle format (`bundle.ts`, stage 8) so
 * the spike viewer loads it: base.glb (the calibrated base-size mesh), anchors.json, grading.json,
 * material.json and qa.json, plus two files the spike fixtures do not need:
 *
 * - payload.json: the product's garment payload, which the viewer gives the fit engine (a schema
 *   fixture is looked up by id; a shop product is not one);
 * - eval.json: the full evaluation (per-anchor table, lengths, view agreement, warnings).
 */
import { createHash } from 'node:crypto';
import { round, roundVec, vertexNormals, writeGlb } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { EVAL_MANNEQUIN, EVAL_VERSION, SOURCE_LABEL, type EvalResult } from './eval';
import type { ShopPhotoScore, TurntableScore, ViewScore } from './evalView';
import type { EvalTexture } from './evalJob';
import { writeTexturedGlb } from './glbTextured';
import { materialJson, type MaterialJson } from './product';
import { renderPositions } from './templateFit';
import { hexToRgb } from './raster';

/** Display colour when neither the payload nor the reconstruction gives one; never written as product data. */
export const PLACEHOLDER_COLOR_HEX = '#A89C8E';

export interface EvalBundleFiles {
  'base.glb': Uint8Array;
  'anchors.json': string;
  'grading.json': string;
  'material.json': string;
  'qa.json': string;
  'payload.json': string;
  'eval.json': string;
}

export interface ViewAgreement {
  /** Against the pinned stills (or the synthetic masks), same camera. */
  views: ViewScore[];
  /** Against the shop photo masks: indicative only. */
  shopPhotos: ShopPhotoScore[];
  /** The mesh against the stage 2 frames' garment masks at 0°, 90° and 180° (empty without stage 2 masks). */
  turntable: TurntableScore[];
  /** Why a part is missing (no stage 1b masks, no job dir, …). */
  notes: string[];
}

const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

/** material.json for the bundle: the fabric library resolution, with a display colour whose source is stated. */
export function evalMaterial(payload: GarmentPayload, meanColorHex: string | null): MaterialJson {
  const hasColour = typeof payload.primaryColorHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(payload.primaryColorHex);
  const mat = materialJson(hasColour ? payload : { ...payload, primaryColorHex: PLACEHOLDER_COLOR_HEX });
  const colour = hasColour ? payload.primaryColorHex : meanColorHex ?? PLACEHOLDER_COLOR_HEX;
  const colourSource = hasColour ? 'product' : meanColorHex ? 'reconstruction (mean vertex colour; display only)' : 'placeholder (no colour in the product data; display only)';
  return { ...mat, baseColorHex: colour, provenance: { ...mat.provenance, baseColorHex: colourSource } };
}

export function evalBundle(result: EvalResult, payload: GarmentPayload, opts: { meanColorHex?: string | null; view?: ViewAgreement | null; inputs?: Record<string, unknown>; texture?: EvalTexture | null } = {}): { files: EvalBundleFiles; inputHash: string; bytes: number } {
  const m = result.mannequin;
  const tex = opts.texture ?? null;
  const baseMaterial = evalMaterial(payload, opts.meanColorHex ?? null);
  // With a baked texture the colour is a fallback only (the viewer draws the map from base.glb).
  const material: MaterialJson = tex ? { ...baseMaterial, provenance: { ...baseMaterial.provenance, baseColorHex: `${baseMaterial.provenance.baseColorHex === 'product' ? 'product' : 'reconstruction (mean garment colour of the frames)'}; display fallback only: base.glb carries the baked texture (stage 4t)` } } : baseMaterial;
  // Stage 4 (2DGS) and stage 4t (template fit) of a generated video are real results for a product; the rest tests the tooling.
  const synthetic = result.source.kind !== 'stage4' && result.source.kind !== 'stage4t';
  const inputHash = createHash('sha256').update(JSON.stringify({ payload, baseSize: result.baseSize, mesh: result.source.sha256, simulatedError: result.source.simulatedError, mannequin: EVAL_MANNEQUIN, eval: EVAL_VERSION })).digest('hex');
  const chartBase = result.chart.rows.find((r) => r.size === result.baseSize)?.rings ?? {};

  const anchors = {
    format: 'curtain.garment.anchors',
    formatVersion: 1,
    productId: result.productId,
    baseSize: result.baseSize,
    category: result.category,
    unit: 'cm',
    mannequin: EVAL_MANNEQUIN,
    pipelineVersion: EVAL_VERSION,
    inputHash,
    synthetic,
    source: { kind: result.source.kind, label: SOURCE_LABEL[result.source.kind], path: result.source.path, sha256: result.source.sha256 },
    /** The viewer fetches the product payload from this file (spike fixtures have none and are looked up by id). */
    payloadFile: 'payload.json',
    rings: Object.fromEntries(
      Object.entries(result.measurements.rings).map(([id, r]) => {
        const frame = m.rings.find((x) => x.id === id)!;
        return [id, {
          circumferenceCm: round(r!.circumferenceCm, 2),
          chartCm: (chartBase as Record<string, number>)[id] ?? null,
          offsetCm: r!.offsetCm ? { mean: round(r!.offsetCm.mean, 2), min: round(r!.offsetCm.min, 2), max: round(r!.offsetCm.max, 2) } : null,
          spansBothLegs: r!.spansBothLegs,
          plane: { centre: roundVec(frame.centre, 3), normal: roundVec(frame.normal, 6) },
          loop: r!.loop.map((p) => roundVec(p, 2)),
        }];
      }),
    ),
    breadths: {},
    lengths: Object.fromEntries(Object.entries(result.measurements.lengths).map(([id, l]) => [id, { lengthCm: round(l!.lengthCm, 2), start: roundVec(l!.start, 2), end: roundVec(l!.end, 2), fromMannequin: l!.fromMannequin }])),
    calibration: {
      globalScale: round(result.calibration.globalScale, 6),
      ringCorrections: Object.fromEntries(Object.entries(result.calibration.ringCorrections).map(([k, v]) => [k, round(v!, 6)])),
      sources: result.calibration.sources,
      residualAfterGlobalCm: { rms: round(result.calibration.residualAfterGlobal.rmsCm, 3), maxAbs: round(result.calibration.residualAfterGlobal.maxAbsCm, 3) },
    },
  };

  const qa = {
    format: 'curtain.garment.qa',
    formatVersion: 1,
    productId: result.productId,
    synthetic,
    inputHash,
    label: 'reconstructed and calibrated geometry: an estimate, not a measurement (AGENTS.md rule 3)',
    chartAgreement: {
      toleranceCm: result.agreement.toleranceCm,
      critical: result.critical,
      perRingCm: Object.fromEntries(Object.entries(result.agreement.perRingCm).map(([k, v]) => [k, round(v!, 3)])),
      maxAbsCm: Number.isFinite(result.agreement.maxAbsCm) ? round(result.agreement.maxAbsCm, 3) : null,
      missing: result.agreement.missing,
      pass: result.agreement.pass,
      beforeCalibrationMaxAbsCm: result.before.maxAbsCm,
      afterGlobalScaleMaxAbsCm: result.afterGlobal.maxAbsCm,
      // A recorded founder choice to read the waist at the band (`src/lowRise.ts`); the import gate surfaces it.
      ...(result.agreement.waistReading ? { waistReading: result.agreement.waistReading } : {}),
    },
    calibration: {
      globalScale: round(result.calibration.globalScale, 6),
      residualBeforeCm: { rms: round(result.calibration.residualBefore.rmsCm, 3), maxAbs: round(result.calibration.residualBefore.maxAbsCm, 3) },
      residualAfterGlobalCm: { rms: round(result.calibration.residualAfterGlobal.rmsCm, 3), maxAbs: round(result.calibration.residualAfterGlobal.maxAbsCm, 3) },
    },
    meshHealth: { ...result.health },
    insideBody: result.insideBody,
    viewAgreement: opts.view ?? null,
    gradingEstimates: result.grading?.estimates ?? null,
    warnings: result.warnings,
  };

  const color = hexToRgb(material.baseColorHex);
  const extras = { productId: result.productId, baseSize: result.baseSize, unit: 'm', synthetic, inputHash, source: result.source.kind };
  let glb: Uint8Array;
  if (tex) {
    // Render mesh (UV seams duplicate vertices) at the calibrated positions; normals of the welded mesh, so the seams do not show.
    const wn = vertexNormals(result.baseMesh);
    const normals = new Float32Array(tex.remap.length * 3);
    for (let r = 0; r < tex.remap.length; r++) for (let c = 0; c < 3; c++) normals[3 * r + c] = wn[3 * tex.remap[r]! + c]!;
    glb = writeTexturedGlb({ name: result.productId, positions: renderPositions(tex, result.baseMesh.positions), uvs: tex.uvs, indices: tex.indices, normals, image: tex.image.bytes, mimeType: tex.image.mimeType, roughness: 0.85, doubleSided: true }, {
      scale: 0.01,
      generator: `@curtain/garment-spike ${EVAL_VERSION}`,
      extras: { ...extras, texture: 'baseColorTexture (stage 4t bake)', weldedVertices: result.baseMesh.positions.length / 3 },
    });
  } else {
    glb = writeGlb([{ name: result.productId, positions: result.baseMesh.positions, normals: vertexNormals(result.baseMesh), indices: result.baseMesh.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.85, doubleSided: true }], {
      scale: 0.01,
      generator: `@curtain/garment-spike ${EVAL_VERSION}`,
      extras,
    });
  }

  const evalJson = {
    format: 'curtain.phase0.eval',
    formatVersion: 1,
    productId: result.productId,
    category: result.category,
    baseSize: result.baseSize,
    evalVersion: EVAL_VERSION,
    inputHash,
    source: anchors.source,
    simulatedError: result.source.simulatedError,
    chart: { type: result.chart.type, provenance: result.chart.provenance, rows: result.chart.rows },
    critical: result.critical,
    anchors: result.rows,
    lengths: result.lengths,
    lengthDefinitions: result.lengthDefinitions,
    agreement: qa.chartAgreement,
    globalScale: round(result.calibration.globalScale, 6),
    ringCorrections: anchors.calibration.ringCorrections,
    warnings: result.warnings,
    meshHealth: result.health,
    insideBody: result.insideBody,
    grading: result.grading ? { sizes: result.grading.sizes.map((s) => s.size), estimates: result.grading.estimates } : null,
    gradingError: result.gradingError,
    viewAgreement: opts.view ?? null,
    timingsMs: result.timingsMs,
    inputs: opts.inputs ?? null,
  };

  const files: EvalBundleFiles = {
    'base.glb': glb,
    'anchors.json': json(anchors),
    'grading.json': json(result.grading),
    'material.json': json(material),
    'qa.json': json(qa),
    'payload.json': json(payload),
    'eval.json': json(evalJson),
  };
  const bytes = Object.values(files).reduce((n, d) => n + (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength), 0);
  return { files, inputHash, bytes };
}
