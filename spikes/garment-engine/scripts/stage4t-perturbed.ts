/**
 * Stage 4t with a template that is NOT the garment (review F1), on the synthetic product with ground
 * truth, CPU:
 *
 *   pnpm --filter @curtain/garment-spike stage4t:perturbed -- <synthetic job dir>
 *
 * The exported proxy of `aalter-studio-2` is built from the same garment spec as
 * `synthetic/garment_truth.glb`, so it already lies about 0.3 cm (Chamfer) from the truth. Here the
 * fit starts from (a) that proxy, (b) two deformed copies (`PERTURBATIONS`: girth, hem height,
 * sleeve width and length) and (c) the proxy of a different dress (`linde-dress-01`, a knee-length
 * sheath with 20 cm sleeves), all fitted to the same 128 training masks. Per template: the Chamfer
 * distance to the truth before the fit (the template itself) and after it, overall and per region,
 * and the holdout IoU. Writes <job dir>/stage4t/synthetic/perturbed.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, type Mesh } from '@curtain/mannequin';
import { mockGarment } from '@curtain/schema';
import { buildBodySdf } from '../src/bodySdf';
import { chamfer, regionChamfer } from '../src/chamfer';
import { readGarmentGlb, weldVertices } from '../src/evalMesh';
import { garmentSpec } from '../src/product';
import { buildProxy } from '../src/proxy';
import { loadJobViews, summarise, viewIous } from '../src/stage4t';
import { fitTemplate, TEMPLATE_FIT_VERSION } from '../src/templateFit';
import { GARMENT_REGIONS, garmentRegion, PERTURBATIONS, perturbTemplate } from '../src/templatePerturb';
import { splitFrames } from '../src/views';

const args = process.argv.slice(2).filter((a) => a !== '--');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) throw new Error('usage: stage4t:perturbed <synthetic job dir>');
const jobDir = resolve(dir);
const glb = (p: string): Mesh => weldVertices(readGarmentGlb(new Uint8Array(readFileSync(join(jobDir, p)))).mesh);
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const body = glb('mannequin.glb');
const truth = glb('synthetic/garment_truth.glb');
// The exporter's proxy, rebuilt with its parts (control/proxy.glb carries one merged mesh): the
// synthetic stills' proxy ends at the synthetic garment's vertical length, as the exporter passes it.
const payload = mockGarment('aalter-studio-2');
const proxy = buildProxy(m, payload, 'M', { shoulderToHemCm: garmentSpec(payload, 'M').shoulderToHemCm }).mesh;
const exported = glb('control/proxy.glb');
if (Math.abs(exported.positions.length / 3 - weldVertices(proxy).positions.length / 3) > 0) console.warn(`[perturbed] rebuilt proxy has ${weldVertices(proxy).positions.length / 3} welded vertices, control/proxy.glb ${exported.positions.length / 3}`);
const views = loadJobViews(jobDir, 'synthetic');
const { train, holdout } = splitFrames(views.cameras.length);
const sdf = buildBodySdf(body);
const region = garmentRegion(m);
const SAMPLES = 50000;

const templates: { label: string; mesh: Mesh }[] = [
  { label: 'exported proxy (same spec as the truth)', mesh: proxy },
  ...PERTURBATIONS.map((p) => ({ label: `exported proxy, ${p.label}`, mesh: perturbTemplate(m, proxy, p) })),
  { label: 'another product: linde-dress-01 proxy (knee-length sheath, 20 cm sleeves), size 38', mesh: buildProxy(m, mockGarment('linde-dress-01'), '38').mesh },
];

const rows = templates.map(({ label, mesh }) => {
  const t0 = performance.now();
  const before = chamfer(mesh, truth, SAMPLES);
  const beforeRegions = regionChamfer(mesh, truth, GARMENT_REGIONS, region, SAMPLES);
  const fit = fitTemplate({ mannequin: m, body, sdf, proxy: mesh, views: { cameras: views.cameras, masks: views.masks, train, holdout, frames: views.frames }, options: { category: 'dress' } });
  const after = chamfer(fit.mesh, truth, SAMPLES);
  const afterRegions = regionChamfer(fit.mesh, truth, GARMENT_REGIONS, region, SAMPLES);
  const ious = viewIous(fit.mesh, body, views, train);
  const row = {
    template: label,
    before: { chamferCmMean: before.chamferCmMean, fscore1cm: before.fscore1cm, regions: beforeRegions },
    after: { chamferCmMean: after.chamferCmMean, fscore1cm: after.fscore1cm, fscore2cm: after.fscore2cm, regions: afterRegions },
    holdout: summarise(ious, 'holdout'),
    triangles: fit.mesh.indices.length / 3,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
  };
  const reg = (rs: typeof beforeRegions): string => rs.map((r) => `${r.region} ${r.chamferCmMean ?? '—'}`).join(', ');
  console.log(`[perturbed] ${label}: Chamfer ${before.chamferCmMean} → ${after.chamferCmMean} cm (before: ${reg(beforeRegions)}; after: ${reg(afterRegions)}), holdout visible ${row.holdout.visibleMean}, ${row.seconds} s`);
  return row;
});

const out = join(jobDir, 'stage4t', 'synthetic');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'perturbed.json'),
  `${JSON.stringify({ format: 'curtain.phase0.stage4t-perturbed', formatVersion: 1, fitVersion: TEMPLATE_FIT_VERSION, samples: SAMPLES, regions: 'sleeves: above the waist, more than 2 cm outside the torso half-width; shoulders: above the chest ring; bodice: waist to chest; skirt: below the waist', split: { train: train.length, holdout: holdout.length }, rows }, null, 2)}\n`,
);
console.log(`[perturbed] wrote ${join(out, 'perturbed.json')}`);
