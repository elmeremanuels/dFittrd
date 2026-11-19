#!/usr/bin/env node
/**
 * `node scripts/demo-dress.mjs [shots dir] [--heights]` — the SYNTHETIC tape-built babydoll dress (not a product;
 * spikes/garment-engine `pomDress.ts`) end to end in the real stack, for docs/reports/claude/dress-from-tape.md.
 * Not part of `pnpm check`.
 *
 * Starts its own api (PGlite in a fresh temp folder, DEMO_DRESS=1), web dev server and demo storefront on ports of its
 * own (8798, 3018, 5198), then in headless Chromium at phone size (390 × 760 CSS px at 2×): storefront → "Try it on" →
 * About you (the AU chart body of each size, AU 8 to 16) → the result → the 3D estimate, in the body's own size, turned
 * front, side and back, and zoomed in on the bodice and seam (`--close-front`, `--close-side`).
 *
 * --heights: the web app is built with VITE_WOMEN_3D_HEIGHT=1 (a preview switch, off in every normal build) and the AU
 * 8, 12 and 16 bodies are typed at 156 and 180 cm. Without it every body is typed at 168 cm and the 3D body keeps the
 * bundle body's stature, as the embed does for a women's product today.
 *
 * Needs `out/synthetic-tape-babydoll-dress/` (`pnpm --filter @curtain/garment-spike exec tsx
 * scripts/build-dress-bundle.ts`) and built packages (`pnpm build:packages`). Exits non-zero on the first failure.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const heights = args.includes('--heights');
const shots = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'test-results', 'demo-dress'));
mkdirSync(shots, { recursive: true });
const ID = 'synthetic-tape-babydoll-dress';
if (!existsSync(join(root, 'spikes', 'garment-engine', 'out', ID, 'base.glb'))) {
  console.error('no dress bundle: run pnpm --filter @curtain/garment-spike exec tsx scripts/build-dress-bundle.ts');
  process.exit(1);
}
const PORTS = { api: 8798, web: 3018, shop: 5198 };
const URLS = { api: `http://localhost:${PORTS.api}`, web: `http://localhost:${PORTS.web}`, shop: `http://localhost:${PORTS.shop}` };
const db = mkdtempSync(join(tmpdir(), 'curtain-demo-dress-'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [];
const log = (m) => console.log(`[demo-dress] ${m}`);
function start(name, cmd, argv, env) {
  const child = spawn(cmd, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let tail = '';
  const keep = (b) => { tail = (tail + b.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  children.push({ name, child, tail: () => tail });
}
async function waitFor(url, name, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${name} did not answer on ${url}\n${children.find((x) => x.name === name)?.tail() ?? ''}`);
}
function stop() {
  for (const { child } of children) {
    if (child.exitCode !== null) continue;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
}
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));

// AU body chart (AU_WOMENS_BODY_CHART of @curtain/schema); weights are round guesses that only feed the prior.
const CHART = { 8: [85, 67.5, 94, 55], 10: [90, 72.5, 99, 62], 12: [95, 77.5, 104, 69], 14: [100, 82.5, 109, 77], 16: [105, 87.5, 114, 85] };
const BODIES = heights
  ? [156, 180].flatMap((h) => [8, 12, 16].map((n) => ({ name: `AU${n}-${h}cm`, size: String(n), height: h, n })))
  : [8, 10, 12, 14, 16].map((n) => ({ name: `AU${n}`, size: String(n), height: 168, n }));

const { chromium } = require('playwright');
let browser;
const problems = [];
try {
  start('api', pnpm, ['--filter', '@curtain/api', 'demo'], { PORT: String(PORTS.api), DEMO_DB_DIR: db, DEMO_DRESS: '1', DEMO_STOREFRONT_ORIGIN: URLS.shop, PUBLIC_APP_URL: URLS.web, PUBLIC_API_URL: URLS.api, CORS_ORIGINS: [URLS.shop, URLS.web].join(','), LOG_LEVEL: 'warn' });
  await waitFor(`${URLS.api}/healthz`, 'api');
  start('web', pnpm, ['--filter', '@curtain/web', 'exec', 'vite', '--port', String(PORTS.web), '--strictPort', '--host', 'localhost'], { VITE_API_URL: URLS.api, ...(heights ? { VITE_WOMEN_3D_HEIGHT: '1' } : {}) });
  start('shop', process.execPath, [join(root, 'apps', 'demo-shop', 'server.mjs')], { PORT: String(PORTS.shop), DEMO_JSON: join(db, 'demo.json') });
  await waitFor(`${URLS.web}/`, 'web');
  await waitFor(`${URLS.shop}/`, 'shop');
  const demo = await (await fetch(`${URLS.shop}/demo.json`)).json();
  const dress = demo.shops.find((s) => s.key === 'shopify').products.find((p) => p.externalId === ID);
  if (!dress?.asset3d) throw new Error(`the dress was not seeded with an approved 3D bundle (the import gate refused it?): ${JSON.stringify(dress)}`);
  log(`seeded: ${ID} with bundle ${dress.asset3d}, flags [${(dress.asset3dFlags ?? []).join(', ')}]`);

  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tag = heights ? 'height' : 'embed';
  const shot = async (page, name, locator) => {
    const path = join(shots, `${tag}-${name}.png`);
    await page.waitForTimeout(500);
    if (locator) await locator.screenshot({ path, timeout: 180_000 });
    else await page.screenshot({ path, timeout: 180_000 });
    log(`shot ${path}`);
  };
  for (const body of BODIES) {
    const context = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-AU' });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console ${m.text()}`); });
    await page.goto(`${URLS.shop}/products/${ID}`);
    await page.waitForSelector('[data-curtain-product][data-curtain-bound]', { timeout: 60_000 });
    if (body === BODIES[0]) await shot(page, '0-storefront-page');
    await page.getByRole('button', { name: /try it on/i }).first().click();
    await page.getByRole('dialog').waitFor();
    const frame = page.frameLocator('[role="dialog"] iframe');
    await frame.getByRole('heading', { name: /about you/i }).waitFor({ timeout: 60_000 });
    const [bust, waist, hip, weight] = CHART[body.n];
    await frame.getByLabel(/height/i).first().fill(String(body.height));
    await frame.getByLabel(/weight/i).first().fill(String(weight));
    const known = frame.getByText(/I know my measurements/i).first();
    if (await known.count()) await known.click();
    for (const [re, v] of [[/^(chest|bust)/i, bust], [/^waist/i, waist], [/^(hip|seat)/i, hip]]) {
      const field = frame.getByLabel(re).first();
      if (await field.count()) await field.fill(String(v));
    }
    if (body === BODIES[0]) await shot(page, '1-about-you');
    await frame.getByTestId('see-my-size').click();
    await frame.getByRole('button', { name: /^choose size\s+\S+/i }).first().waitFor({ timeout: 60_000 });
    if (body === BODIES[0]) await shot(page, `${body.name}--2-result`);
    await frame.getByTestId('garment3d-open').click();
    const canvas = frame.locator('canvas[data-testid="garment3d-canvas"]');
    await frame.locator('canvas[data-testid="garment3d-canvas"][data-state="settled"]').waitFor({ timeout: 300_000 });
    let size = await canvas.getAttribute('data-size');
    log(`body ${body.name}: the size advice picked ${size}`);
    if (size !== body.size) {
      const own = frame.getByRole('radio', { name: new RegExp(`^${body.size}\\b`) }).first();
      if (await own.count()) {
        await own.click();
        await frame.locator(`canvas[data-testid="garment3d-canvas"][data-size="${body.size}"][data-state="settled"]`).waitFor({ timeout: 300_000 });
        size = body.size;
      }
    }
    const panel = frame.getByTestId('garment3d');
    if (!(await panel.getByText(/estimate/i).count())) throw new Error(`body ${body.name}: the 3D view has no estimate label`);
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const label = `${body.name}--size-${size}`;
    await shot(page, `${label}--front`, panel);
    const quarter = async () => {
      const box = await canvas.boundingBox();
      const dx = box.height / 4, y = box.y + box.height * 0.55, x0 = box.x + box.width / 2 - dx / 2;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + (dx * i) / 20, y);
      await page.mouse.up();
      await page.waitForTimeout(2500);
    };
    const zoom = async (deltaY) => {
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, deltaY / 6); await page.waitForTimeout(120); }
      await page.waitForTimeout(2000);
    };
    await zoom(-900);
    await shot(page, `${label}--close-front`, canvas);
    await quarter();
    await shot(page, `${label}--close-side`, canvas);
    await zoom(900);
    await shot(page, `${label}--side`, panel);
    await quarter();
    await shot(page, `${label}--back`, panel);
    await context.close();
  }
} catch (err) {
  problems.push(String(err instanceof Error ? (err.stack ?? err.message) : err));
} finally {
  await browser?.close();
  stop();
}
for (const p of problems) console.error(`[demo-dress] problem: ${p}`);
process.exit(problems.length ? 1 : 0);
