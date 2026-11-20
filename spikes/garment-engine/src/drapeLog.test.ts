import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, type Mannequin } from '@curtain/mannequin';
import { mockGarment } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { measurePattern, predictedShape, shadowCompare } from './drapeLog';
import { drapeLogJob, familyIdOf } from './drapeLogJob';
import { shopPayload } from './evalFixtures';
import { encodePng } from './exportPng';
import { parseFeatures } from './features';
import { generateGarment } from './garment';
import { writeTexturedGlb } from './glbTextured';
import { PREDICTION_FILE, exportJob } from './exportJob';
import { predict, type Prediction, type PredictProduct } from './predict';
import { garmentSpec } from './product';
import { proxyRecord } from './proxy';

const m: Mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
const body = buildMannequinMesh(m);
const shopProduct = (h: string): PredictProduct => {
  const s = shopPayload(h);
  const products = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic', 'products.json'), 'utf8')) as { products: { handle: string; features?: unknown }[] };
  return { id: h, payload: s.payload, baseSize: s.baseSize, features: parseFeatures(products.products.find((p) => p.handle === h)?.features) ?? null, source: { kind: 'shop' } };
};

describe('measurePattern', () => {
  it('a hem uneven over more than a quarter of the way round still gets a hem girth (the slice moves up until the cloth closes)', () => {
    // A skirt-like tube round both legs, radius 30 cm, from 100 cm down to a hem at 5 cm, except two 40° arcs (front-left and
    // back-right) that end at 10 cm: 22 % of the sectors, above the 75th percentile the hem slice starts from (run 15's skirt).
    const C = 144, R = 96, r = 30;
    const positions: number[] = [];
    const indices: number[] = [];
    const hemAt = (deg: number): number => ((deg >= 30 && deg < 70) || (deg >= 210 && deg < 250) ? 10 : 5);
    for (let i = 0; i <= R; i++) for (let c = 0; c < C; c++) {
      const t = (2 * Math.PI * c) / C;
      const deg = (360 * c) / C;
      positions.push(r * Math.sin(t), 100 - (i / R) * (100 - hemAt(deg)), r * Math.cos(t));
    }
    for (let i = 0; i < R; i++) for (let c = 0; c < C; c++) {
      const a = i * C + c, b = i * C + ((c + 1) % C), d = (i + 1) * C + c, e = (i + 1) * C + ((c + 1) % C);
      indices.push(a, d, e, a, e, b);
    }
    const mesh = { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), vertexPart: new Uint8Array(positions.length / 3), partNames: ['garment'] } as unknown as Parameters<typeof measurePattern>[1];
    const pr = predict(shopProduct('crimson-wildflower-maxi-skirt'));
    const me = measurePattern(m, mesh, { kind: 'skirt', category: 'bottom', rule: pr.pattern.length.rule, frontOpening: null }, body);
    expect(me.hemY!).toBeCloseTo(5, 0);
    expect(me.hemGirthCm!).toBeCloseTo(2 * Math.PI * r, -1);
  });

  it('reads back the synthetic shirt dress it was built from (a-line flare 1.25, 58 cm sleeves, chart girths)', () => {
    const p = mockGarment('aalter-studio-2');
    const spec = garmentSpec(p, 'M');
    const mesh = generateGarment(m, spec);
    const pr = predict({ id: p.id, payload: p, baseSize: 'M' });
    const me = measurePattern(m, mesh, { kind: 'dress', category: 'dress', rule: pr.pattern.length.rule, frontOpening: null }, body);
    expect(me.girthsCm.chest!).toBeCloseTo(spec.rings.chest!, 0);
    expect(me.girthsCm.hip!).toBeCloseTo(spec.rings.hip!, 0);
    expect(Math.abs(me.hemFlare! - 1.25)).toBeLessThan(0.08);
    expect(Math.abs(me.sleeveCm! - 58)).toBeLessThan(2);
    expect(me.lengthDefinition).toBe('hps_surface');
    // The synthetic garment drops 112 cm vertically: its surface length is longer.
    expect(me.lengthCm!).toBeGreaterThan(112);
    expect(me.upperArmRatio!).toBeGreaterThan(1);
  });
});

describe('shadowCompare', () => {
  it('scores the P0 shape against itself: no parameter error, Chamfer at the sampling floor', () => {
    const p = shopProduct('crimson-wildflower-maxi-skirt');
    const pr = predict(p);
    const shape = predictedShape(m, p.payload, p.baseSize, pr, p.features);
    const ctx = { kind: pr.pattern.kind, category: 'bottom' as const, rule: pr.pattern.length.rule, frontOpening: null };
    const px = measurePattern(m, shape.mesh, ctx, body);
    const sh = shadowCompare({ m, productId: p.id, source: 'stage4t-synthetic', prediction: pr, spec: shape.spec, proxyMesh: shape.mesh, proxyPattern: px, measured: px, stage4t: shape.mesh, samples: 30000 });
    // Chamfer is sample-to-sample (chamfer.ts): against itself it is the sampling floor (about 0.6 cm at 8,000 samples on a
    // maxi skirt, 0.3 cm at 30,000), not 0; the F-score at 1 cm shows the surfaces coincide.
    expect(sh.chamfer.fscore1cm).toBeGreaterThan(0.95);
    expect(sh.chamfer.chamferCmMean).toBeLessThan(0.4);
    const hem = sh.rows.find((r) => r.parameter === 'hemY')!;
    expect(Math.abs(hem.error!)).toBeLessThan(0.6); // the proxy's hem line vs its resolved hemY (the tube's last station)
    const flare = sh.rows.find((r) => r.parameter === 'hemFlare')!;
    expect(flare.predicted).toBe(1.25);
    expect(Math.abs(flare.measured! - 1.25)).toBeLessThan(0.1);
    expect(sh.rows.map((r) => r.parameter)).toEqual(['hemFlare', 'hemY', 'length.waist_drop', 'depthRatio.hem']);
    expect(sh.v1.chamferCm).toBe(sh.chamfer.chamferCmMean);
  });

  it('reports trouser legs, default ease and sleeves where the prediction has them', () => {
    const t = shopProduct('rosewater-palazzo-pants');
    const pt = predict(t);
    const st = predictedShape(m, t.payload, t.baseSize, pt, t.features);
    const pxT = measurePattern(m, st.mesh, { kind: 'trousers', category: 'bottom', rule: pt.pattern.length.rule, frontOpening: null }, body);
    const shT = shadowCompare({ m, productId: t.id, source: 'stage4t-synthetic', prediction: pt, spec: st.spec, proxyMesh: st.mesh, proxyPattern: pxT, measured: pxT, stage4t: st.mesh, samples: 4000 });
    expect(shT.rows.map((r) => r.parameter)).toContain('legs.hemOfThigh');
    expect(shT.rows.find((r) => r.parameter === 'legs.hemOfThigh')!.measured!).toBeCloseTo(1.1, 1);
    expect(shT.rows.find((r) => r.parameter === 'length.waist_drop')!.predicted!).toBeCloseTo(99, 6); // outseam 99 cm, dropped from the waist
    const b = shopProduct('rosewater-blouse');
    const pb = predict(b);
    const sb = predictedShape(m, b.payload, b.baseSize, pb, b.features);
    const pxB = measurePattern(m, sb.mesh, { kind: 'top', category: 'top', rule: pb.pattern.length.rule, frontOpening: null }, body);
    const shB = shadowCompare({ m, productId: b.id, source: 'stage4t-synthetic', prediction: pb, spec: sb.spec, proxyMesh: sb.mesh, proxyPattern: pxB, measured: pxB, stage4t: sb.mesh, samples: 4000 });
    expect(shB.rows.map((r) => r.parameter)).toEqual(expect.arrayContaining(['defaultEase.underbust', 'sleeve.lengthCm', 'sleeve.upperArmRatio']));
    // Chart rings are the fit engine's, never scored as a prediction.
    expect(shB.rows.map((r) => r.parameter)).not.toContain('defaultEase.chest');
  });
});

describe('drapeLogJob', () => {
  it('writes exemplar.json and shadow.json (numbers only) from a job with a stage 4t mesh, and predicts now for a job without prediction.json', () => {
    const p = shopProduct('crimson-wildflower-maxi-skirt');
    const pr = predict(p);
    const shape = predictedShape(m, p.payload, p.baseSize, pr, p.features);
    const dir = mkdtempSync(join(tmpdir(), 'drapelog-'));
    const out = join(dir, 'stage4t', 'synthetic');
    mkdirSync(out, { recursive: true });
    const nv = shape.mesh.positions.length / 3;
    const png = encodePng({ width: 2, height: 2, channels: 3, bitDepth: 8, data: new Uint8Array(12).fill(200) });
    // The "stage 4t mesh" here is the P0 shape itself, in metres as stage 4t writes it.
    writeFileSync(join(out, 'garment.glb'), writeTexturedGlb({ name: 'garment', positions: shape.mesh.positions, indices: shape.mesh.indices, uvs: new Float32Array(nv * 2), image: png, mimeType: 'image/png' }, { scale: 0.01 }));
    writeFileSync(join(out, 'metrics.json'), JSON.stringify({ version: 'stage4t-0.3.0', iou: { holdout: { visibleMean: 0.97, silhouetteMean: 0.96 }, train: { visibleMean: 0.98 } }, insideBody: { share: 0 } }));
    const manifest = { exporter: 'test', job_id: 'x-1', product_id: p.id, base_size: p.baseSize, features: p.features, product_source: { kind: 'shop' }, control: { proxy: { ...proxyRecord(shape.spec) } }, photos: [{ role: 'front', synthetic: true }], hash_inputs: { product: p.payload } };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const r = drapeLogJob(dir, 'synthetic', { familyId: 'skirts/x', samples: 30000 });
    expect(r.predictionSource).toBe('predicted-now');
    expect(JSON.stringify(r.prediction)).toBe(JSON.stringify(pr));
    const ex = JSON.parse(readFileSync(join(out, 'exemplar.json'), 'utf8'));
    const sh = JSON.parse(readFileSync(join(out, 'shadow.json'), 'utf8'));
    expect(JSON.parse(readFileSync(join(out, 'prediction.json'), 'utf8')).cell).toBe(pr.cell);
    expect(ex).toMatchObject({ format: 'curtain.drape.exemplar', productId: p.id, familyId: 'skirts/x', cell: 'skirt|a-line|maxi|fluid', source: 'stage4t-synthetic', quality: { holdoutVisibleIou: 0.97, approved: false } });
    expect(ex.versions).toMatchObject({ stage4t: 'stage4t-0.3.0', predictor: pr.predictorVersion });
    expect(sh.chamfer.fscore1cm).toBeGreaterThan(0.9); // the same surface
    // Numbers only: no image bytes, no long base64 runs, a few KB.
    const exText = readFileSync(join(out, 'exemplar.json'), 'utf8');
    expect(exText.length).toBeLessThan(12000);
    expect(exText).not.toMatch(/[A-Za-z0-9+/]{200,}/);
    expect(sh.notes.join(' ')).toMatch(/no prediction.json/);
    // A synthetic skirt's truth is the proxy built from this prediction: the report says it cannot test the prediction.
    expect(sh.informative).toEqual({ value: false, reason: expect.stringMatching(/truth = template = prediction/) });
    expect(sh.rows.every((x: { informative: boolean }) => !x.informative)).toBe(true);
    expect(sh.v1).toMatchObject({ chamferCm: null, hemHeightErrCm: null, lengthErrCm: null, hemGirthErrPct: null, sigmaWithin128: null });
    expect(sh.v1.excluded).toContain('chamfer');
    // The exemplar's material and cell are the prediction's prior, flagged so calibration never reads them as observations.
    expect(ex).toMatchObject({ materialSource: 'prediction-prior', cellSource: 'prediction' });
  });

  it('a lofted synthetic job: the P0 shape is the control proxy the job had (synthetic length), and the length rows are left out of v1', () => {
    const files = new Map<string, Uint8Array | string>();
    exportJob({ productId: 'aalter-studio-2', frames: 8, width: 64, height: 112, motionFrames: 5, syntheticPhotos: true }, (path, d) => files.set(path, d));
    const manifest = JSON.parse(files.get('manifest.json') as string) as { control: { proxy: { hem_y_cm: number; length_cm: number } } };
    const current = JSON.parse(files.get(PREDICTION_FILE) as string) as Prediction;
    expect(current.pattern.length.provenance).toBe('synthetic');
    const legacy = predict({ id: 'aalter-studio-2', payload: mockGarment('aalter-studio-2'), baseSize: 'M', source: { kind: 'spike' } });
    const shape = predictedShape(m, mockGarment('aalter-studio-2'), 'M', current, null);
    expect(Math.round(shape.spec.hemY * 100) / 100).toBe(manifest.control.proxy.hem_y_cm);
    const results = [current, legacy].map((pr) => {
      const dir = mkdtempSync(join(tmpdir(), 'drapelog-lofted-'));
      const out = join(dir, 'stage4t', 'synthetic');
      mkdirSync(out, { recursive: true });
      const nv = shape.mesh.positions.length / 3;
      const png = encodePng({ width: 2, height: 2, channels: 3, bitDepth: 8, data: new Uint8Array(12).fill(200) });
      writeFileSync(join(out, 'garment.glb'), writeTexturedGlb({ name: 'garment', positions: shape.mesh.positions, indices: shape.mesh.indices, uvs: new Float32Array(nv * 2), image: png, mimeType: 'image/png' }, { scale: 0.01 }));
      writeFileSync(join(dir, 'manifest.json'), files.get('manifest.json') as string);
      writeFileSync(join(dir, PREDICTION_FILE), JSON.stringify(pr));
      return drapeLogJob(dir, 'synthetic', { samples: 4000, write: false });
    });
    for (const [i, r] of results.entries()) {
      const sh = r.shadow;
      const hem = sh.rows.find((x) => x.parameter === 'hemY')!;
      // The predicted hem is the control's (the synthetic garment's), not the printed 112 cm flat-lay length's.
      expect(hem.predicted).toBeCloseTo(manifest.control.proxy.hem_y_cm, 2);
      expect(hem.informative).toBe(false);
      expect(sh.rows.find((x) => x.parameter.startsWith('length.'))!.informative).toBe(false);
      expect(sh.rows.find((x) => x.parameter === 'hemFlare')!.informative).toBe(true);
      expect(sh.informative.value).toBe(true);
      expect(sh.v1.hemHeightErrCm).toBeNull();
      expect(sh.v1.excluded).toEqual(expect.arrayContaining(['hemY']));
      expect(sh.notes.join(' ')).not.toMatch(/differs from the job's control proxy/);
      if (i === 1) expect(sh.notes.join(' ')).toMatch(/predates the synthetic length override/);
    }
    expect(results[0]!.shadow.rows).toEqual(results[1]!.shadow.rows);
  });

  it('refuses a prediction.json of another product', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drapelog-other-'));
    const out = join(dir, 'stage4t', 'synthetic');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'garment.glb'), '');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ product_id: 'aalter-studio-2', base_size: 'M', hash_inputs: { product: mockGarment('aalter-studio-2') } }));
    writeFileSync(join(dir, PREDICTION_FILE), JSON.stringify(predict({ id: 'other', payload: mockGarment('aalter-studio-2'), baseSize: 'M' })));
    expect(() => drapeLogJob(dir, 'synthetic', { write: false })).toThrow(/prediction for other, the job is aalter-studio-2/);
  });

  it('finds a shop product\'s family id', () => {
    const fam = { families: [{ id: 'dresses/a', members: [{ handle: 'h1' }, { handle: 'h2' }] }], singleProductFamilies: [{ id: 'tops/b', handle: 'h3' }] };
    expect(familyIdOf(fam, 'h2')).toBe('dresses/a');
    expect(familyIdOf(fam, 'h3')).toBe('tops/b');
    expect(familyIdOf(fam, 'nope')).toBeNull();
    expect(familyIdOf(null, 'h1')).toBeNull();
  });
});
