/**
 * Stage 4t (template fit + texture bake) on a Phase 0 job dir, CPU:
 *
 *   pnpm --filter @curtain/garment-spike stage4t -- <job dir> [--source stage2|synthetic] [--no-previews] [--template-size <size>] [--views 0,80]
 *
 * Trousers (the manifest's proxy kind) are fitted with one tube per leg. --template-size fits from the
 * product's proxy at another chart size instead of control/proxy.glb (a template that is not the garment:
 * on a synthetic job of a skirt, trousers or outerwear the truth IS the base-size proxy, opened).
 *
 * --views 0,80 is the predicted route's two-view fit (docs/PREDICTION-ENGINE.md §4.5, V0): fitted and baked
 * from those frames only (the pinned front and back stills are frames 0 and N/2), depth from the template
 * (`depthPrior: 'template'`), scored on the usual holdout frames; written to stage4t/<source>-views-0-80/.
 *
 * Writes <job dir>/stage4t/<source>/{garment.glb, texture.jpg, metrics.json, preview/*.png}. The job
 * dir is under out/ (gitignored). `report:bohohippychic` then evaluates stage4t/stage2/garment.glb when
 * it exists, ahead of the 2DGS mesh.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin } from '@curtain/mannequin';
import { mockGarment, type GarmentPayload } from '@curtain/schema';
import { parseFeatures } from '../src/features';
import { buildProxy } from '../src/proxy';
import { runStage4t, type Stage4tSource } from '../src/stage4t';

const args = process.argv.slice(2).filter((a) => a !== '--');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) throw new Error('usage: stage4t <job dir> [--source stage2|synthetic] [--no-previews]');
const at = args.indexOf('--source');
const source = (at >= 0 ? args[at + 1] : 'stage2') as Stage4tSource;
if (source !== 'stage2' && source !== 'synthetic') throw new Error(`--source must be stage2 or synthetic, got ${source}`);
const jobDir = resolve(dir);
const manifest = JSON.parse(readFileSync(join(jobDir, 'manifest.json'), 'utf8')) as {
  category?: string;
  product_id?: string;
  base_size?: string;
  features?: unknown;
  control?: { proxy?: { kind?: string } | null };
  hash_inputs?: { product?: GarmentPayload };
};
const kind = manifest.control?.proxy?.kind;
const tAt = args.indexOf('--template-size');
const templateSize = tAt >= 0 ? args[tAt + 1] : undefined;
const category = (['dress', 'top', 'outerwear', 'bottom'].includes(manifest.category ?? '') ? manifest.category : 'dress') as 'dress' | 'top' | 'outerwear' | 'bottom';
// A job exported before the proxy existed (the synthetic product's export 0.1.0) has no control/proxy.glb: build it from the schema fixture.
let proxy = null;
let proxyLabel: string | undefined;
if (templateSize) {
  const payload = manifest.hash_inputs?.product;
  if (!payload) throw new Error('--template-size needs the product payload in manifest.hash_inputs');
  const features = parseFeatures(manifest.features);
  proxy = buildProxy(buildMannequin(bodyShape(BASE_SHAPE_ID)), payload, templateSize, features ? { features } : {}).mesh;
  proxyLabel = `buildProxy(${manifest.product_id}, size ${templateSize}) (--template-size: not the job's base size ${manifest.base_size})`;
} else try {
  readFileSync(join(jobDir, 'control/proxy.glb'));
} catch {
  try {
    proxy = buildProxy(buildMannequin(bodyShape(BASE_SHAPE_ID)), mockGarment(manifest.product_id ?? ''), manifest.base_size ?? 'M').mesh;
    proxyLabel = `buildProxy(${manifest.product_id}, ${manifest.base_size}) (no control/proxy.glb in the job)`;
  } catch {
    proxy = null;
  }
}
const vAt = args.indexOf('--views');
const views = vAt >= 0 ? (args[vAt + 1] ?? '').split(',').map((x) => Number(x.trim())) : undefined;
if (views && views.some((v) => !Number.isInteger(v))) throw new Error(`--views takes frame indices separated by commas, got ${args[vAt + 1]}`);
const t0 = performance.now();
const res = runStage4t({ dir: jobDir, source, ...(views ? { views } : {}), category, fit: { legs: kind === 'trousers' }, proxy, ...(proxyLabel ? { proxyLabel } : {}), previews: !args.includes('--no-previews'), log: (m) => console.log(`[stage4t] ${m}`) });
const out = join(jobDir, 'stage4t', views ? `${source}-views-${views.join('-')}` : source);
mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries(res.files)) {
  if (name === 'previews') continue;
  writeFileSync(join(out, name), data as Uint8Array | string);
}
for (const [name, png] of Object.entries(res.files.previews)) {
  mkdirSync(dirname(join(out, name)), { recursive: true });
  writeFileSync(join(out, name), png);
}
const mt = res.metrics;
console.log(
  `[stage4t] ${mt.mesh.triangles} triangles (${mt.mesh.withinBudget ? 'in' : 'OUT OF'} budget), inside body ${mt.insideBody.sdfInside}/${mt.insideBody.vertices} (analytic ${(mt.insideBody.analytic.share * 100).toFixed(2)} %), ` +
    `IoU visible/silhouette train ${mt.iou.train.visibleMean}/${mt.iou.train.silhouetteMean}, holdout ${mt.iou.holdout.visibleMean}/${mt.iou.holdout.silhouetteMean}` +
    (mt.vsTruth ? `, Chamfer vs truth ${mt.vsTruth.chamferCmMean} cm` : '') +
    `, texture ${(mt.bake.jpegBytes / 1024).toFixed(0)} KB, glb ${(mt.glbBytes / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
console.log(`[stage4t] texture: ${(mt.bake.seenShare * 100).toFixed(1)} % of the chart texels sampled from frames; shoulder caps (within ${mt.bake.capTexture.radiusCm} cm of the cap tops) ${(mt.bake.capTexture.seenShare * 100).toFixed(1)} % of ${mt.bake.capTexture.texels}`);
if (mt.bake.holdoutMean) console.log(`[stage4t] holdout photometric: texture MAE ${mt.bake.holdoutMean.maeTexture} (PSNR ${mt.bake.holdoutMean.psnrTexture} dB), one mean colour MAE ${mt.bake.holdoutMean.maeMeanColour} (PSNR ${mt.bake.holdoutMean.psnrMeanColour} dB); on 8×8 blocks texture ${mt.bake.holdoutMean.maeTextureBlock8} vs mean colour ${mt.bake.holdoutMean.maeMeanColourBlock8}`);
console.log(`[stage4t] wrote ${out}`);
