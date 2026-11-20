/**
 * Exemplar and shadow logging after stage 4t (docs/PREDICTION-ENGINE.md §5 step 1, §7 V1; `src/drapeLog.ts`):
 *
 *   pnpm --filter @curtain/garment-spike predict:log -- <job dir> [<job dir> ...] [--source stage2|synthetic]
 *
 * Writes <job dir>/stage4t/<source>/{exemplar.json, shadow.json} (+ prediction.json there when the job predates P0).
 * `stage4t` runs this itself after the fit; this script re-logs existing stage 4t outputs (run 14, older jobs).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drapeLogJob, familyIdOf } from '../src/drapeLogJob';
import type { Stage4tSource } from '../src/stage4t';

const args = process.argv.slice(2).filter((a) => a !== '--');
const at = args.indexOf('--source');
const source = (at >= 0 ? args[at + 1] : 'stage2') as Stage4tSource;
if (source !== 'stage2' && source !== 'synthetic') throw new Error(`--source must be stage2 or synthetic, got ${source}`);
const dirs = args.filter((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
if (!dirs.length) throw new Error('usage: predict:log <job dir> [...] [--source stage2|synthetic]');
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const d of dirs) {
  const dir = resolve(d);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { product_source?: { kind?: string; shop?: string; handle?: string } };
  const ps = manifest.product_source;
  const famFile = ps?.kind === 'shop' && ps.shop ? join(pkg, 'data', ps.shop, 'families.json') : null;
  const familyId = famFile && existsSync(famFile) && ps?.handle ? familyIdOf(JSON.parse(readFileSync(famFile, 'utf8')), ps.handle) : null;
  const t0 = performance.now();
  const r = drapeLogJob(dir, source, { familyId });
  const s = r.shadow;
  console.log(`[predict:log] ${s.productId} (${source}, cell ${s.cell}, prediction ${r.predictionSource}): P0 shape vs stage 4t Chamfer ${s.chamfer.chamferCmMean} cm (F@1cm ${s.chamfer.fscore1cm}); regions ${s.regions.map((x) => `${x.region} ${x.chamferCmMean ?? '–'}`).join(', ')}; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  for (const row of s.rows) console.log(`[predict:log]   ${row.parameter.padEnd(24)} predicted ${String(row.predicted).padStart(8)}  proxy ${String(row.proxy).padStart(8)}  measured ${String(row.measured).padStart(8)}  error ${String(row.error).padStart(8)}  z ${row.z ?? '–'}`);
  console.log(`[predict:log]   V1: hem height ${s.v1.hemHeightErrCm} cm, length ${s.v1.lengthErrCm} cm, hem girth ${s.v1.hemGirthErrPct} %, upper arm ${s.v1.upperArmErrCm} cm, within 1.28σ ${s.v1.sigmaWithin128}; holdout IoU ${r.exemplar.quality.holdoutVisibleIou}/${r.exemplar.quality.holdoutSilhouetteIou}`);
  for (const n of s.notes) console.log(`[predict:log]   note: ${n}`);
}
