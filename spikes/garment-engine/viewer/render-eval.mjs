/* global process, console, document, URL */
/**
 * Headless renders of evaluated Phase 0 bundles (`out/eval/<id>/`, written by
 * `report:bohohippychic`), with the same approach as smoke.mjs: Vite dev server, headless Chromium
 * with SwiftShader, the spike viewer page driven by URL parameters.
 *
 * Per product and per body (the M mannequin, and the avatar at the XS and XXL shapes' girths): sizes
 * 8, 12 and 16 side by side (the chart's sizes when it does not have those three), one screenshot
 * without and one with the fit map. On the M mannequin also at three-quarter and side view (each
 * figure turned 45° and 90° about its own axis, `view=` on the viewer page). Then the blind test page with these products pre-selected, at
 * setup and at its first size pair. Writes `out/eval/<id>/renders/*.png`, `out/eval/blind-*.png` and
 * `out/eval/renders.json` (files, drape time per size, problems). Called by the report script with
 * `--renders`; also runs alone:
 *
 *   node spikes/garment-engine/viewer/render-eval.mjs [eval/<id> …] [--blind eval/<id>,… | --no-blind]
 *
 * `--blind` lists the products to pre-select on the blind page (default: all rendered ones).
 *
 * Uses the preinstalled Playwright (`require('playwright')`), not a dependency of the package.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(here, '..', 'out');
const evalDir = join(outDir, 'eval');
const repoRoot = resolve(here, '..', '..', '..');
const TIMEOUT = 240_000;
const SHAPES = ['M', 'XS', 'XXL'];
const WANT_SIZES = ['8', '12', '16'];
/** Views per body: front everywhere, three-quarter and side on the M mannequin. */
const VIEWS = { M: ['front', 'three-quarter', 'side'], XS: ['front'], XXL: ['front'] };

const argv = process.argv.slice(2);
const blindAt = argv.indexOf('--blind');
const blindArg = blindAt >= 0 ? (argv[blindAt + 1] ?? '') : null;
const noBlind = argv.includes('--no-blind');
const args = argv.filter((a, i) => !a.startsWith('--') && !(blindAt >= 0 && i === blindAt + 1));
const ids = (args.length ? args : existsSync(evalDir) ? readdirSync(evalDir).map((d) => `eval/${d}`) : []).filter((id) => /^eval\/[a-z0-9-]+$/.test(id) && existsSync(join(outDir, id, 'grading.json')));
if (ids.length === 0) {
  console.error('No evaluated bundles in out/eval/. Run `pnpm --filter @curtain/garment-spike report:bohohippychic` first.');
  process.exit(1);
}

/** Sizes to show: 8, 12 and 16 when the chart has them, else up to three around the base size. */
function sizesFor(grading) {
  const labels = grading.sizes.map((s) => s.size);
  if (WANT_SIZES.every((s) => labels.includes(s))) return WANT_SIZES;
  if (labels.length <= 3) return labels;
  const i = Math.max(0, labels.indexOf(grading.baseSize));
  const lo = Math.max(0, Math.min(i - 1, labels.length - 3));
  return labels.slice(lo, lo + 3);
}

class SkipBlind extends Error {}

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5180, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const result = { format: 'curtain.phase0.renders', products: {}, blindShots: [], problems: [] };

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  let pageProblems = [];
  page.on('pageerror', (e) => pageProblems.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageProblems.push(`console: ${msg.text()}`);
  });
  const settle = async () => {
    await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: TIMEOUT });
    const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
    if (state === 'error') throw new Error(`viewer error: ${await page.textContent('#status')}`);
    await page.waitForTimeout(200);
  };

  for (const id of ids) {
    const dir = join(outDir, id);
    const grading = JSON.parse(readFileSync(join(dir, 'grading.json'), 'utf8'));
    const qa = JSON.parse(readFileSync(join(dir, 'qa.json'), 'utf8'));
    const sizes = sizesFor(grading);
    const shotsDir = join(dir, 'renders');
    mkdirSync(shotsDir, { recursive: true });
    const entry = { inputHash: qa.inputHash ?? null, sizes, shots: [], problems: [] };
    result.products[id] = entry;
    for (const shape of SHAPES) {
      for (const view of VIEWS[shape]) {
        pageProblems = [];
        try {
          const url = `${base}index.html?product=${encodeURIComponent(id)}&layout=side&sizes=${sizes.map(encodeURIComponent).join(',')}&size=${encodeURIComponent(sizes[Math.floor(sizes.length / 2)])}&shape=${shape}&view=${view}`;
          const t0 = Date.now();
          await page.goto(url);
          await settle();
          const per = JSON.parse(await page.evaluate(() => document.documentElement.dataset.settle ?? '[]'));
          const settleMs = sizes.map((s) => per.find((p) => p.size === s)?.ms ?? null);
          for (const fitMap of [false, true]) {
            if (fitMap) await page.check('[data-testid="heat"]');
            else await page.uncheck('[data-testid="heat"]');
            await page.waitForTimeout(250);
            const file = join(shotsDir, `${shape}-${view === 'front' ? '' : `${view}-`}${fitMap ? 'fitmap' : 'plain'}.png`);
            await page.screenshot({ path: file });
            entry.shots.push({ file: relative(repoRoot, file), shape, view, fitMap, sizes, settleMs });
          }
          console.log(`[render-eval] ${id} ${shape} ${view}: ${sizes.join(', ')} settled in ${((Date.now() - t0) / 1000).toFixed(1)} s (${settleMs.map((ms) => (ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`)).join(', ')})`);
        } catch (err) {
          entry.problems.push(`${shape} ${view}: ${err instanceof Error ? err.message : String(err)}`);
        }
        entry.problems.push(...pageProblems.map((p) => `${shape} ${view}: ${p}`));
      }
    }
  }

  // Blind test page with these products pre-selected: setup, then the first size pair.
  const blindIds = blindArg === null ? ids : blindArg.split(',').filter((id) => ids.includes(id));
  if (noBlind || blindIds.length === 0) throw new SkipBlind();
  pageProblems = [];
  await page.goto(`${base}blind.html?products=${blindIds.map(encodeURIComponent).join(',')}`);
  await page.waitForSelector('#products input');
  const checked = await page.$$eval('#products input:checked', (els) => els.map((e) => e.value));
  if (blindIds.some((id) => !checked.includes(id)) || checked.some((id) => !blindIds.includes(id))) result.problems.push(`blind page pre-selected ${checked.join(', ')} instead of ${blindIds.join(', ')}`);
  const setupShot = join(evalDir, 'blind-setup.png');
  await page.screenshot({ path: setupShot });
  result.blindShots.push(relative(repoRoot, setupShot));
  await page.fill('[data-testid="participant"]', 'render-eval');
  await page.click('[data-testid="start"]');
  await page.waitForFunction(() => document.documentElement.dataset.blindState === 'ready', null, { timeout: TIMEOUT });
  await page.waitForTimeout(300);
  const pairShot = join(evalDir, 'blind-size-pair-1.png');
  await page.screenshot({ path: pairShot });
  result.blindShots.push(relative(repoRoot, pairShot));
  const labels = blindIds.flatMap((id) => result.products[id]?.sizes ?? []);
  const text = await page.evaluate(() => document.querySelector('main')?.textContent ?? '');
  const leaked = labels.filter((l) => new RegExp(`(^|\\s)${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text));
  if (leaked.length) result.problems.push(`blind page shows size labels: ${leaked.join(', ')}`);
  result.problems.push(...pageProblems.map((p) => `blind: ${p}`));
} catch (err) {
  if (!(err instanceof SkipBlind)) result.problems.push(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  await server.close();
}

writeFileSync(join(evalDir, 'renders.json'), `${JSON.stringify(result, null, 2)}\n`);
const problems = [...result.problems, ...Object.entries(result.products).flatMap(([id, p]) => p.problems.map((x) => `${id} ${x}`))];
console.log(`[render-eval] ${Object.values(result.products).reduce((n, p) => n + p.shots.length, 0)} screenshots, renders.json in ${relative(repoRoot, evalDir)}`);
if (problems.length) {
  console.error(`[render-eval] problems:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
