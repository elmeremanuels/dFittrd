/**
 * One product through the model-free stages of the spike, producing the asset bundle files of
 * stage 8 (docs/ENGINE-HANDOFF.md): base.glb, anchors.json, grading.json, material.json, plus
 * qa.json with the stage 3, 5 and 6 metrics.
 *
 *   synthetic garment (stand-in for stages 2 + 4) → simulated reconstruction error
 *   → stage 5 anchoring + calibration → stage 6 grading → stage 3 separation on the turntable renders
 */
import { createHash } from 'node:crypto';
import { type AnchorRing } from '@curtain/anchors';
import {
  BASE_SHAPE_ID,
  MANNEQUIN_VERSION,
  bodyShape,
  buildMannequin,
  buildMannequinMesh,
  round,
  roundVec,
  topology,
  turntablePaths,
  vertexNormals,
  writeGlb,
  type Mannequin,
  type Mesh,
} from '@curtain/mannequin';
import { applyCalibration, calibrate, chartAgreement, measureGarment, ringGirths, type AnchorMeasurements, type Calibration, type ChartAgreement } from './anchoring';
import { assignChains, distortGarment, generateGarment, type Distortion } from './garment';
import { gradeGarment, type GradingJson } from './grading';
import { chartRow, garmentChart, garmentSpec, materialJson, spikeProduct, type MaterialJson, type SPIKE_PRODUCT_IDS } from './product';
import { hexToRgb } from './raster';
import { separate, type SeparationOptions, type SeparationReport } from './separation';

export const PIPELINE_VERSION = 'spike-0.1.0';

/** What the spike pretends a reconstruction got wrong. */
export const DEFAULT_DISTORTION: Distortion = { globalScale: 1.035, ringBiasCm: { chest: 1.8, waist: -1.2, hip: 0.8 }, noiseCm: 0.15, seed: 7 };

export interface BundleOptions {
  baseSize?: string;
  distortion?: Distortion;
  /** The merchant's sample measurements as girths; wins over the chart in calibration. */
  sample?: Partial<Record<AnchorRing, number>>;
  separation?: SeparationOptions & { framesPerPath?: number };
  /** Skip stage 3 (it is the slow part). */
  skipSeparation?: boolean;
}

export interface Bundle {
  productId: string;
  files: { 'base.glb': Uint8Array; 'anchors.json': string; 'grading.json': string; 'material.json': string; 'qa.json': string };
  mannequin: Mannequin;
  baseMesh: Mesh;
  measurements: AnchorMeasurements;
  calibration: Calibration;
  agreement: ChartAgreement;
  grading: GradingJson;
  material: MaterialJson;
  separation: SeparationReport | null;
}

const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

export function buildBundle(productId: (typeof SPIKE_PRODUCT_IDS)[number], options: BundleOptions = {}): Bundle {
  const baseSize = options.baseSize ?? 'M';
  const payload = spikeProduct(productId);
  const chart = garmentChart(payload);
  const spec = garmentSpec(payload, baseSize);
  const mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));

  // Stand-in for stages 2 + 4: the true garment and what a reconstruction would return.
  const truth = generateGarment(mannequin, spec);
  const truthGirths = ringGirths(measureGarment(mannequin, truth, spec.category));
  const recon = distortGarment(mannequin, truth, truthGirths, options.distortion ?? DEFAULT_DISTORTION);

  // Stage 5: anchoring + calibration.
  const chains = assignChains(mannequin, recon);
  const raw = measureGarment(mannequin, recon, spec.category, chains);
  const chartBase = chartRow(chart, baseSize).rings;
  const calibration = calibrate({ measured: ringGirths(raw), chart: chartBase, ...(options.sample ? { sample: options.sample } : {}) });
  const baseMesh = applyCalibration(mannequin, recon, ringGirths(raw), calibration, chains);
  const measurements = measureGarment(mannequin, baseMesh, spec.category, chains);
  const critical = Object.keys(chartBase) as AnchorRing[];
  const agreement = chartAgreement(ringGirths(measurements), chartBase, critical);

  // Stage 6: grading.
  const grading = gradeGarment(mannequin, chart, baseSize, measurements);

  // Stage 3: separation on synthetic turntable renders of the calibrated garment.
  let separation: SeparationReport | null = null;
  if (!options.skipSeparation) {
    const body = buildMannequinMesh(mannequin);
    const paths = turntablePaths(mannequin, { frames: options.separation?.framesPerPath ?? 24 });
    separation = separate(body, { positions: baseMesh.positions, indices: baseMesh.indices, color: hexToRgb(spec.colorHex) }, paths, options.separation);
  }

  const material = materialJson(payload);
  const health = topology(baseMesh);
  const inputHash = createHash('sha256').update(JSON.stringify({ payload, baseSize, distortion: options.distortion ?? DEFAULT_DISTORTION, sample: options.sample ?? null, mannequin: MANNEQUIN_VERSION, pipeline: PIPELINE_VERSION })).digest('hex');

  const anchors = {
    format: 'curtain.garment.anchors',
    formatVersion: 1,
    productId,
    baseSize,
    category: spec.category,
    unit: 'cm',
    mannequin: { version: MANNEQUIN_VERSION, shape: BASE_SHAPE_ID },
    pipelineVersion: PIPELINE_VERSION,
    inputHash,
    synthetic: true,
    rings: Object.fromEntries(
      Object.entries(measurements.rings).map(([id, r]) => {
        const frame = mannequin.rings.find((x) => x.id === id)!;
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
    lengths: Object.fromEntries(Object.entries(measurements.lengths).map(([id, l]) => [id, { lengthCm: round(l!.lengthCm, 2), start: roundVec(l!.start, 2), end: roundVec(l!.end, 2), fromMannequin: l!.fromMannequin }])),
    calibration: {
      globalScale: round(calibration.globalScale, 6),
      ringCorrections: Object.fromEntries(Object.entries(calibration.ringCorrections).map(([k, v]) => [k, round(v!, 6)])),
      sources: calibration.sources,
      residualAfterGlobalCm: { rms: round(calibration.residualAfterGlobal.rmsCm, 3), maxAbs: round(calibration.residualAfterGlobal.maxAbsCm, 3) },
    },
  };

  const qa = {
    format: 'curtain.garment.qa',
    formatVersion: 1,
    productId,
    synthetic: true,
    inputHash,
    chartAgreement: { ...agreement, perRingCm: Object.fromEntries(Object.entries(agreement.perRingCm).map(([k, v]) => [k, round(v!, 3)])), maxAbsCm: round(agreement.maxAbsCm, 3) },
    calibration: {
      globalScale: round(calibration.globalScale, 6),
      residualBeforeCm: { rms: round(calibration.residualBefore.rmsCm, 3), maxAbs: round(calibration.residualBefore.maxAbsCm, 3) },
      residualAfterGlobalCm: { rms: round(calibration.residualAfterGlobal.rmsCm, 3), maxAbs: round(calibration.residualAfterGlobal.maxAbsCm, 3) },
    },
    meshHealth: { triangles: health.triangles, vertices: health.vertices, boundaryEdges: health.boundaryEdges, nonManifoldEdges: health.nonManifoldEdges, inconsistentEdges: health.inconsistentEdges, triangleBudget: [8000, 15000], withinBudget: health.triangles <= 15000 },
    separation: separation && { width: separation.width, height: separation.height, frames: separation.frames, iou: round(separation.iou, 4), minFrameIou: round(separation.minFrameIou, 4), meanAmbiguous: round(separation.meanAmbiguous, 4) },
    gradingEstimates: grading.estimates,
  };

  const color = hexToRgb(spec.colorHex);
  const glb = writeGlb([{ name: productId, positions: baseMesh.positions, normals: vertexNormals(baseMesh), indices: baseMesh.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.85, doubleSided: true }], {
    scale: 0.01,
    generator: `@curtain/garment-spike ${PIPELINE_VERSION}`,
    extras: { productId, baseSize, unit: 'm', synthetic: true, inputHash },
  });

  return {
    productId,
    files: { 'base.glb': glb, 'anchors.json': json(anchors), 'grading.json': json(grading), 'material.json': json(material), 'qa.json': json(qa) },
    mannequin,
    baseMesh,
    measurements,
    calibration,
    agreement,
    grading,
    material,
    separation,
  };
}
