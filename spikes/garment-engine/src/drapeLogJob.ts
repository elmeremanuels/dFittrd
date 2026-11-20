/**
 * Exemplar and shadow logging on a Phase 0 job dir after stage 4t (`drapeLog.ts`): reads manifest.json,
 * prediction.json (or predicts now when the job was exported before drape-prior P0, e.g. run 14), and
 * stage4t/<source>/{garment.glb, metrics.json}; writes stage4t/<source>/{exemplar.json, shadow.json} (and
 * prediction.json there when the job had none). All inputs are our own files, read as data.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANNEQUIN_VERSION, BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, type Mannequin, type Mesh } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { buildExemplar, measurePattern, predictedShape, shadowCompare, stage4tQuality, DRAPE_LOG_VERSION, type ShadowReport } from './drapeLog';
import { EVAL_VERSION } from './eval';
import { isEvalCategory } from './evalChart';
import { weldWithRemap } from './evalMesh';
import { PREDICTION_FILE } from './exportJob';
import { parseFeatures } from './features';
import { readTexturedGlb } from './glbTextured';
import { PREDICTOR_VERSION, predict, withSyntheticLength, type Exemplar, type Prediction } from './predict';
import { frontOpeningFromRecord } from './proxy';
import type { Stage4tSource } from './stage4t';
import { TAPE_VERSION } from './tape';

export interface DrapeLogResult {
  exemplar: Exemplar;
  shadow: ShadowReport;
  prediction: Prediction;
  /** Where the prediction came from: the job's prediction.json, or predicted now. */
  predictionSource: 'job' | 'predicted-now';
  files: Record<string, string>;
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : null);

/** The stage 4t mesh as the evaluation reads it: the textured glb, welded (cm, mannequin space). */
export function readStage4tMesh(path: string): Mesh {
  const g = readTexturedGlb(new Uint8Array(readFileSync(path)));
  return weldWithRemap({ positions: g.positions, indices: g.indices, vertexPart: new Uint8Array(g.positions.length / 3), partNames: ['garment'] }).mesh;
}

export function drapeLogJob(dir: string, source: Stage4tSource, o: { familyId?: string | null; mannequin?: Mannequin; samples?: number; write?: boolean } = {}): DrapeLogResult {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Json;
  const payload = obj(manifest.hash_inputs)?.product as GarmentPayload | undefined;
  if (!payload) throw new Error(`${dir}: manifest.hash_inputs.product missing`);
  if (!isEvalCategory(payload.category)) throw new Error(`${dir}: no drape log for category ${payload.category}`);
  const baseSize = String(manifest.base_size);
  const productId = String(manifest.product_id);
  const features = parseFeatures(manifest.features) ?? null;
  const out = join(dir, 'stage4t', source);
  const glb = join(out, 'garment.glb');
  if (!existsSync(glb)) throw new Error(`${glb} missing: run stage4t first`);
  const notes: string[] = [];
  let prediction: Prediction;
  let predictionSource: DrapeLogResult['predictionSource'] = 'job';
  const pj = join(dir, PREDICTION_FILE);
  if (existsSync(pj)) {
    prediction = JSON.parse(readFileSync(pj, 'utf8')) as Prediction;
    if (prediction.format !== 'curtain.drape.prediction') throw new Error(`${pj}: not a drape prediction`);
    if (prediction.productId !== productId) throw new Error(`${pj}: prediction for ${prediction.productId}, the job is ${productId}`);
  } else {
    prediction = predict({ id: productId, payload, baseSize, features, source: { kind: String(obj(manifest.product_source)?.kind ?? 'spike') } });
    predictionSource = 'predicted-now';
    notes.push(`the job has no ${PREDICTION_FILE} (exported by ${String(manifest.exporter)}, before drape-prior P0): predicted now with ${PREDICTOR_VERSION}; its control proxy was ${String(obj(obj(manifest.control)?.proxy)?.version ?? 'none')}, the P0 shape is today's proxy`);
  }
  // A synthetic-stills job of a lofted kind exported before the override went into prediction.json (drape-prior-p0-0.1.0):
  // its control proxy took the synthetic garment's length (manifest control.proxy.length_source). Apply it here, so the P0
  // shape is the shape the control and the template had.
  const controlProxy = obj(obj(manifest.control)?.proxy);
  const ctlSource = typeof controlProxy?.length_source === 'string' ? controlProxy.length_source : '';
  if (ctlSource.startsWith('synthetic stills') && prediction.pattern.length.provenance !== 'synthetic') {
    const cm = Number(controlProxy!.length_cm);
    if (!Number.isFinite(cm)) throw new Error(`${dir}: control proxy length_cm missing for a synthetic length override`);
    prediction = withSyntheticLength(prediction, cm, ctlSource);
    notes.push(`the job's ${PREDICTION_FILE} predates the synthetic length override in the prediction: the control proxy's length (${cm} cm, "${ctlSource}") applied here`);
  }
  const m = o.mannequin ?? buildMannequin(bodyShape(BASE_SHAPE_ID));
  const body = buildMannequinMesh(m);
  const stage4t = readStage4tMesh(glb);
  const metrics = existsSync(join(out, 'metrics.json')) ? (JSON.parse(readFileSync(join(out, 'metrics.json'), 'utf8')) as Json) : null;
  const shape = predictedShape(m, payload, baseSize, prediction, features);
  // The P0 shape must be the job's control proxy (girths, hem); say so when it is not (a proxy version change, an old job).
  if (controlProxy) {
    const diffs: string[] = [];
    const hemRec = Number(controlProxy.hem_y_cm);
    if (Number.isFinite(hemRec) && Math.abs(hemRec - shape.spec.hemY) > 0.05) diffs.push(`hem_y ${hemRec} vs ${Math.round(shape.spec.hemY * 100) / 100} cm`);
    for (const [ring, g] of Object.entries(obj(controlProxy.girths_cm) ?? {})) {
      const now = shape.spec.girths[ring as keyof typeof shape.spec.girths];
      if (typeof g === 'number' && (now === undefined || Math.abs(now - g) > 0.05)) diffs.push(`${ring} ${g} vs ${now === undefined ? 'none' : Math.round(now * 100) / 100} cm`);
    }
    if (diffs.length) notes.push(`the P0 shape differs from the job's control proxy (${String(controlProxy.version)}): ${diffs.join(', ')}`);
  }
  const kind = prediction.pattern.kind;
  const ctx = { kind, category: payload.category, rule: prediction.pattern.length.rule };
  // The stage 4t mesh is measured as the evaluation measures it (the job's own proxy front opening is what the tape may bridge).
  const measured = measurePattern(m, stage4t, { ...ctx, frontOpening: frontOpeningFromRecord(obj(obj(manifest.control)?.proxy)?.front_opening) }, body);
  const proxyPattern = measurePattern(m, shape.mesh, { ...ctx, frontOpening: shape.spec.frontOpening }, body);
  const exSource: Exemplar['source'] = source === 'stage2' ? 'stage4t-stage2' : 'stage4t-synthetic';
  const versions: Record<string, string> = {
    stage4t: String(metrics?.version ?? 'unknown'),
    exporter: String(manifest.exporter ?? 'unknown'),
    controlProxy: String(obj(obj(manifest.control)?.proxy)?.version ?? 'none'),
    mannequin: `${MANNEQUIN_VERSION} ${BASE_SHAPE_ID}`,
    tape: TAPE_VERSION,
    eval: EVAL_VERSION,
    jobId: String(manifest.job_id ?? ''),
  };
  const exemplar = buildExemplar({ productId, familyId: o.familyId ?? null, source: exSource, prediction, pattern: measured, quality: stage4tQuality(metrics), versions, mesh: stage4t });
  const syntheticJob = Array.isArray(manifest.photos) && (manifest.photos as Json[]).some((p) => p.synthetic === true);
  // On a synthetic job of a skirt, trousers or outerwear the truth is the proxy built from this very prediction (exportJob:
  // syntheticGarmentFromProxy), so the shadow there is circular by construction.
  const truthIsPrediction = source === 'synthetic' && syntheticJob && kind !== 'dress' && kind !== 'top' ? `synthetic ${kind}: the truth is the proxy built from this prediction (syntheticGarmentFromProxy), so truth = template = prediction` : null;
  const shadow = shadowCompare({ m, productId, source: exSource, prediction, spec: shape.spec, proxyMesh: shape.mesh, proxyPattern, measured, stage4t, truthIsPrediction, ...(o.samples ? { samples: o.samples } : {}) });
  shadow.notes.unshift(...notes);
  if (source === 'synthetic' && syntheticJob) {
    shadow.notes.push('synthetic job: the frames show the spike\'s synthetic garment (a lofted dress/top dropped vertically to its length, or the proxy itself for skirt, trousers, outerwear), so the shadow measures the prediction against that truth through stage 4t, not against a real garment');
  }
  const files: Record<string, string> = {
    'exemplar.json': `${JSON.stringify(exemplar, null, 2)}\n`,
    'shadow.json': `${JSON.stringify(shadow, null, 2)}\n`,
    ...(predictionSource === 'predicted-now' ? { 'prediction.json': `${JSON.stringify(prediction, null, 2)}\n` } : {}),
  };
  if (o.write ?? true) for (const [name, data] of Object.entries(files)) writeFileSync(join(out, name), data);
  return { exemplar, shadow, prediction, predictionSource, files };
}

/** The family id of a shop product from data/<shop>/families.json (data), or null. */
export function familyIdOf(familiesJson: unknown, handle: string): string | null {
  const f = obj(familiesJson);
  for (const fam of (Array.isArray(f?.families) ? f!.families : []) as Json[]) {
    if (((fam.members as Json[] | undefined) ?? []).some((m) => m.handle === handle)) return String(fam.id);
  }
  for (const s of (Array.isArray(f?.singleProductFamilies) ? f!.singleProductFamilies : []) as Json[]) if (s.handle === handle) return String(s.id);
  return null;
}

export { DRAPE_LOG_VERSION };
