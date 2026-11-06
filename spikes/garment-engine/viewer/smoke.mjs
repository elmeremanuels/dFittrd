/* global process, console, document, URL, localStorage */
/**
 * Smoke test of the spike viewer (outside `pnpm check`): starts the Vite dev server, opens the
 * viewer in headless Chromium, switches sizes, layout, fit map, outlines, fabric and body, opens the
 * blind test page, and saves screenshots to spikes/garment-engine/out/screens/. Fails on a page
 * error, a console error, a viewer that does not settle, or a torn neckline (any neckline edge more
 * than 12 % over its rest length, the regression check for the small-size tears).
 *
 * Prints, per step, the wall time from the action to settled and each shown size's drape time
 * (`dataset.settle`) against the 2 s per-size budget. The budget is reported, not enforced: it is a
 * phone target and this is headless Chromium with SwiftShader on whatever machine runs it.
 *
 *   pnpm --filter @curtain/garment-spike build:bundle
 *   pnpm --filter @curtain/garment-spike viewer:smoke
 *
 * Uses the preinstalled Playwright (`require('playwright')`), not a dependency of the package.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(here, '..', 'out');
const screens = join(outDir, 'screens');
const TIMEOUT = 180_000;
const NECK_STRAIN_MAX = 0.12;
const BUDGET_MS = 2000;

const products = existsSync(outDir) ? readdirSync(outDir).filter((d) => existsSync(join(outDir, d, 'grading.json'))).sort() : [];
if (products.length === 0) {
  console.error('No bundles in out/. Run `pnpm --filter @curtain/garment-spike build:bundle` first.');
  process.exit(1);
}
mkdirSync(screens, { recursive: true });

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5179, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const saved = [];

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });

  const settle = async () => {
    await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: TIMEOUT });
    const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
    if (state === 'error') throw new Error(`viewer error: ${await page.textContent('#status')}`);
    await page.waitForTimeout(150);
    return page.textContent('#status');
  };
  const shot = async (name) => {
    const file = join(screens, `${name}.png`);
    await page.screenshot({ path: file });
    saved.push(file);
  };
  const timings = [];
  const drapes = [];
  const step = async (name, action, { expectStretch = false } = {}) => {
    const t0 = Date.now();
    await action();
    const status = await settle();
    const wall = (Date.now() - t0) / 1000;
    const data = await page.evaluate(() => ({ settle: document.documentElement.dataset.settle ?? '[]', neck: document.documentElement.dataset.neckStrain ?? '0', workers: document.documentElement.dataset.drapeWorkers ?? '0' }));
    const per = JSON.parse(data.settle);
    const neck = Number(data.neck);
    if (neck > NECK_STRAIN_MAX && !expectStretch) problems.push(`${name}: neckline edge strain ${(neck * 100).toFixed(1)} % > ${NECK_STRAIN_MAX * 100} % (torn neckline)`);
    for (const p of per) if (!drapes.some((d) => d.key === p.key)) drapes.push({ step: name, ...p });
    const sizes = per.map((p) => `${p.size} ${(p.ms / 1000).toFixed(2)} s (cpu ${(p.computeMs / 1000).toFixed(2)} s, cloth ${p.clothS} s)`).join(', ');
    const neckNote = expectStretch && neck > NECK_STRAIN_MAX ? ' (body wider at the shoulders than the garment: known gap, not checked)' : '';
    timings.push(`${name}: ${wall.toFixed(1)} s wall · workers ${data.workers} · ${sizes} · neck ${(neck * 100).toFixed(1)} %${neckNote} · ${status}`);
    await shot(name);
  };

  const first = products[0];
  await page.goto(`${base}index.html?product=${encodeURIComponent(first)}&size=M`);
  await step(`${first}-M`, async () => {});
  for (const size of ['S', 'L', 'XS', 'M']) await step(`${first}-${size}`, () => page.click(`[data-testid="size-${size}"]`));
  await step(`${first}-outlines`, () => page.check('[data-testid="outlines"]'));
  await page.uncheck('[data-testid="outlines"]');
  await step(`${first}-side-by-side`, () => page.click('[data-testid="layout-side"]'));
  const labels = await page.$$eval('#anchor-labels div', (els) => els.map((e) => e.textContent ?? ''));
  if (!labels.some((t) => /^chest \d/.test(t)) || !labels.some((t) => /^shoulders /.test(t))) problems.push(`side by side shows no per-anchor labels (${labels.length} found)`);
  await step(`${first}-side-by-side-outlines`, () => page.check('[data-testid="outlines"]'));
  await page.uncheck('[data-testid="outlines"]');
  await step(`${first}-side-by-side-fitmap`, () => page.check('[data-testid="heat"]'));
  await page.uncheck('[data-testid="heat"]');
  await step(`${first}-side-by-side-silk`, () => page.click('[data-testid="fabric-silk"]'));
  await step(`${first}-side-by-side-linen`, () => page.click('[data-testid="fabric-linen"]'));
  await page.click('[data-testid="fabric-product"]');
  await settle();
  await step(`${first}-body-104-90-112-fitmap`, async () => {
    await page.check('[data-testid="heat"]');
    await page.fill('#m-bust', '104');
    await page.fill('#m-waist', '90');
    await page.fill('#m-hip', '112');
    await page.press('#m-hip', 'Enter');
    await page.locator('#m-hip').blur();
  }, { expectStretch: true });
  for (const p of products.slice(1)) {
    await step(`${p}-side-by-side`, async () => {
      await page.uncheck('[data-testid="heat"]');
      await page.check('[data-testid="body-mannequin"]');
      await page.selectOption('[data-testid="product"]', p);
    });
  }

  // Blind test page: start a size test and answer the first pair.
  await page.goto(`${base}blind.html`);
  await page.fill('[data-testid="participant"]', 'smoke');
  await page.click('[data-testid="start"]');
  await page.waitForFunction(() => document.documentElement.dataset.blindState === 'ready', null, { timeout: TIMEOUT });
  await page.waitForTimeout(300);
  await shot('blind-size-pair-1');
  const leaked = await page.evaluate(() => /\b(XS|S|M|L|XL)\b/.test(document.querySelector('main')?.textContent ?? ''));
  if (leaked) problems.push('blind page shows a size label');
  await page.click('[data-testid="pick-left"]');
  await page.waitForFunction(() => ['ready', 'done'].includes(document.documentElement.dataset.blindState ?? ''), null, { timeout: TIMEOUT });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('curtain.spike.blind.v1') ?? '[]').length);
  if (stored !== 1) problems.push(`blind page stored ${stored} answers, expected 1`);

  console.log(timings.join('\n'));
  // Each drape once (a cached size shows its first drape time again).
  const fresh = drapes;
  const over = fresh.filter((d) => d.ms > BUDGET_MS);
  const worst = fresh.reduce((w, d) => Math.max(w, d.ms), 0);
  console.log(`Drape per size: ${fresh.length} fresh drapes, worst ${(worst / 1000).toFixed(2)} s, ${over.length} over the ${BUDGET_MS / 1000} s budget${over.length ? ` (${over.map((d) => `${d.step} ${d.size} ${(d.ms / 1000).toFixed(2)} s`).join('; ')})` : ''}.`);
} catch (err) {
  problems.push(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  await server.close();
}

console.log(`${saved.length} screenshots in ${screens}`);
if (problems.length) {
  console.error(`Smoke failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('Smoke passed.');
