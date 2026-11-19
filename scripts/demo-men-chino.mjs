#!/usr/bin/env node
/**
 * `node scripts/demo-men-chino.mjs [shots dir]` — the SYNTHETIC men's test chino W/L (not a product) end to end in the
 * real stack (men-3d-plan slices M3/M4; the tee's run is scripts/demo-men.mjs, whose server set-up this repeats). Not
 * part of `pnpm check`.
 *
 * Starts its own api (PGlite in a fresh temp folder, DEMO_MEN=1 and MEN_3D_GATE=1), web dev server and demo storefront
 * on ports of its own (8798, 3018, 5198), so it runs next to `pnpm demo` and `scripts/demo-men.mjs`. Then, in headless
 * Chromium at phone size (390 × 760 CSS px at 2×), for the male table's five bodies S to XXL:
 *   storefront → "Try it on" → About you (height, weight, waist, seat, inside leg) → the 3D view opens by itself
 *   (`requires3d`), must settle on the male body in the size the fit engine recommends (S 32/32, M 34/32, L 38/32,
 *   XL 40/32, XXL 44/32), and the result is shown only then; the view is turned front, side and back
 *   (`--5-3d-size-<size>--{front,side,back}`; `--4-3d-embed-size-…` first when the embed opened in another size) and taken zoomed in (`--close-front`, `--close-side`, `--close-back`).
 *   Then a size the fit engine calls too small for that body is picked (the M body: 30/32; the XXL body: 38/32, the
 *   fixture chart's largest): the 3D view draws the body alone and says why (`--6-size-<size>-not-drawn`, canvas
 *   `data-garment="not-drawn"`). The M body also picks 34/30 and 34/34 (the other leg lengths) and 38/32 (too large:
 *   drawn where it would sit).
 * Screenshots of every step go to the shots dir (default test-results/demo-men-chino). Exits non-zero on the first
 * failure. Needs `out/synthetic-men-chino-wl/` (`pnpm --filter @curtain/garment-spike exec tsx
 * scripts/build-chino-bundle.ts`) and built packages (`pnpm build:packages`, the SDK included).
 *
 * Flags: --width=N  phone width in CSS px (default 390).
 *        --bodies=S,M  only these bodies.
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
const width = Number((args.find((a) => a.startsWith('--width=')) ?? '--width=390').slice('--width='.length));
const shots = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'test-results', 'demo-men-chino'));
mkdirSync(shots, { recursive: true });
const CHINO_BUNDLE = join(root, 'spikes', 'garment-engine', 'out', 'synthetic-men-chino-wl', 'base.glb');
if (!existsSync(CHINO_BUNDLE)) {
  console.error(`no synthetic men's chino bundle at ${CHINO_BUNDLE}: run pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts`);
  process.exit(1);
}

const PORTS = { api: 8798, web: 3018, shop: 5198 };
const URLS = { api: `http://localhost:${PORTS.api}`, web: `http://localhost:${PORTS.web}`, shop: `http://localhost:${PORTS.shop}` };
const db = mkdtempSync(join(tmpdir(), 'curtain-demo-men-chino-'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [];
const log = (m) => console.log(`[demo-men-chino] ${m}`);

function start(name, cmd, argv, env) {
  // Its own process group, so that stopping it also stops what pnpm started (tsx, vite).
  const child = spawn(cmd, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let tail = '';
  const keep = (b) => {
    tail = (tail + b.toString()).slice(-4000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  children.push({ name, child, tail: () => tail });
  return child;
}

async function waitFor(url, name, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const c = children.find((x) => x.name === name);
  throw new Error(`${name} did not answer on ${url}\n${c?.tail() ?? ''}`);
}

function stop() {
  for (const { child } of children) {
    if (child.exitCode !== null) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));

const { chromium } = require('playwright');
let browser;
const problems = [];
try {
  start('api', pnpm, ['--filter', '@curtain/api', 'demo'], {
    PORT: String(PORTS.api),
    DEMO_DB_DIR: db,
    DEMO_MEN: '1',
    MEN_3D_GATE: '1',
    DEMO_STOREFRONT_ORIGIN: URLS.shop,
    PUBLIC_APP_URL: URLS.web,
    PUBLIC_API_URL: URLS.api,
    CORS_ORIGINS: [URLS.shop, URLS.web].join(','),
    LOG_LEVEL: 'warn',
  });
  await waitFor(`${URLS.api}/healthz`, 'api', 180_000);
  start('web', pnpm, ['--filter', '@curtain/web', 'exec', 'vite', '--port', String(PORTS.web), '--strictPort', '--host', 'localhost'], { VITE_API_URL: URLS.api });
  start('shop', process.execPath, [join(root, 'apps', 'demo-shop', 'server.mjs')], { PORT: String(PORTS.shop), DEMO_JSON: join(db, 'demo.json') });
  await waitFor(`${URLS.web}/`, 'web');
  await waitFor(`${URLS.shop}/`, 'shop');
  const demo = await (await fetch(`${URLS.shop}/demo.json`)).json();
  const shopify = demo.shops.find((s) => s.key === 'shopify');
  const chino = shopify.products.find((p) => p.externalId === 'synthetic-men-chino-wl');
  if (!chino?.asset3d) throw new Error(`the synthetic men's chino was not seeded with an approved 3D bundle: ${JSON.stringify(chino)}`);
  log(`seeded: synthetic-men-chino-wl with bundle ${chino.asset3d}`);

  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tag = `chino${width !== 390 ? `-${width}` : ''}`;
  const shot = async (page, name, locator) => {
    const path = join(shots, `${tag}--${name}.png`);
    await page.waitForTimeout(500);
    if (locator) await locator.screenshot({ path, timeout: 180_000 });
    else await page.screenshot({ path, timeout: 180_000 });
    log(`shot ${path}`);
  };
  const newPage = async () => {
    const context = await browser.newContext({ viewport: { width, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-AU' });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
    page.on('console', (m) => {
      // The storefront draws no product photo for the fixture shirt in some runs; image 404s are not failures.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console ${m.text()}`);
    });
    return page;
  };
  const openOverlay = async (page, id, pageShot) => {
    await page.goto(`${URLS.shop}/products/${id}`);
    await page.waitForSelector('[data-curtain-product][data-curtain-bound]', { timeout: 60_000 });
    if (pageShot) await shot(page, pageShot);
    await page.getByRole('button', { name: /try it on/i }).first().click();
    await page.getByRole('dialog').waitFor();
    return page.frameLocator('[role="dialog"] iframe');
  };
  const about = async (frame, body) => {
    await frame.getByRole('heading', { name: /about you/i }).waitFor({ timeout: 60_000 });
    await frame.getByLabel(/height/i).first().fill(String(body.height));
    await frame.getByLabel(/weight/i).first().fill(String(body.weight));
    // The girths sit behind "I know my measurements" (collapsed by default).
    const known = frame.getByText(/I know my measurements/i).first();
    if (await known.count()) await known.click();
    for (const [re, v] of [[/^(chest|bust)/i, body.chest], [/^waist/i, body.waist], [/^(hip|seat)/i, body.hip], [/^(inside leg|inseam)/i, body.inseam]]) {
      const field = frame.getByLabel(re).first();
      if (v && (await field.count())) await field.fill(String(v));
    }
  };

  // ---- the synthetic men's chino on the male bodies -----------------------------------------------
  // The male table's S to XXL (MALE_REFERENCE of @curtain/mannequin: stature, chest, waist, seat, inside leg); weights are round guesses that only feed the prior.
  const ALL_BODIES = [
    { name: 'S', height: 172.5, weight: 64, chest: 90, waist: 78, hip: 90.5, inseam: 83.5, expect: '32/32' },
    { name: 'M', height: 174, weight: 74, chest: 98, waist: 86, hip: 96, inseam: 84, expect: '34/32' },
    { name: 'L', height: 175.5, weight: 83, chest: 106, waist: 94, hip: 102, inseam: 84.5, expect: '38/32' },
    { name: 'XL', height: 177, weight: 92, chest: 114, waist: 102, hip: 108, inseam: 85, expect: '40/32' },
    { name: 'XXL', height: 179, weight: 103, chest: 123, waist: 111, hip: 114.5, inseam: 85.5, expect: '44/32' },
  ];
  const only = (args.find((a) => a.startsWith('--bodies=')) ?? '').slice('--bodies='.length).split(',').filter(Boolean);
  const BODIES = only.length ? ALL_BODIES.filter((b) => only.includes(b.name)) : ALL_BODIES;
  const file = (size) => size.replace('/', 'x');
  const canvasOf = (frame) => frame.locator('canvas[data-testid="garment3d-canvas"]');
  const quarter = async (page, frame) => {
    const box = await canvasOf(frame).boundingBox();
    const dx = box.height / 4;
    const y = box.y + box.height * 0.55;
    const x0 = box.x + box.width / 2 - dx / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + (dx * i) / 20, y);
    await page.mouse.up();
    await page.waitForTimeout(2500);
  };
  const zoom = async (page, frame, deltaY) => {
    const box = await canvasOf(frame).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, deltaY / 6);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(2000);
  };
  // Front, side and back of the 3D view (OrbitControls turns 2π per canvas height of drag), each also zoomed in.
  const turnShots = async (page, frame, label) => {
    const panel = frame.getByTestId('garment3d');
    // The overlay may still be scrolling (the 2D figure was scrolled to before): bring the view in, let it rest, and again.
    await canvasOf(frame).scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    await panel.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(1200);
    for (const view of ['front', 'side', 'back']) {
      await shot(page, `${label}--${view}`, panel);
      await zoom(page, frame, -900);
      await shot(page, `${label}--close-${view}`, canvasOf(frame));
      await zoom(page, frame, 900);
      if (view !== 'back') await quarter(page, frame);
    }
    // Back to the front.
    await quarter(page, frame);
    await quarter(page, frame);
  };
  const pick = async (frame, size) => {
    const btn = frame.getByRole('radio', { name: new RegExp(`^${size.replace('/', '\\/')}(\\b|$)`) }).first();
    if (!(await btn.count())) throw new Error(`no size button ${size}`);
    await btn.click();
  };
  for (const body of BODIES) {
    const page = await newPage();
    const frame = await openOverlay(page, 'synthetic-men-chino-wl', body.name === 'S' ? '0-storefront-page' : null);
    await about(frame, body);
    if (body.name === 'S') await shot(page, '1-about-you');
    await frame.getByTestId('see-my-size').click();
    const canvas = canvasOf(frame);
    // requires3d: nothing of the result before the view settles; it opens by itself.
    await frame.getByTestId('requires3d-pending').waitFor({ timeout: 60_000 });
    if (body.name === 'S') await shot(page, `body-${body.name}--2-pending`);
    await frame.locator('canvas[data-testid="garment3d-canvas"][data-state="settled"]').waitFor({ timeout: 240_000 });
    await frame.getByTestId('requires3d-shown').waitFor({ timeout: 30_000 });
    const size = await canvas.getAttribute('data-size');
    log(`chino, body ${body.name}: settled in size ${size}`);
    // The embed asks no thigh, so its fit can pick the next waist from the one a body with a taped thigh gets (`expect`): logged, not required.
    if ((await canvas.getAttribute('data-garment')) === 'not-drawn') throw new Error(`chino, body ${body.name}: the size the view opened in (${size}) is not drawn`);
    await shot(page, `body-${body.name}--3-settled-size-${file(size)}`);
    const mirror = frame.locator('[data-testid="embed-result"] [data-testid="mirror"]').first();
    if (await mirror.count()) {
      await mirror.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await shot(page, `body-${body.name}--3b-2d-figure`, mirror);
      if (!(await mirror.getByText(/Estimate/).count())) throw new Error(`chino, body ${body.name}: the 2D figure has no estimate label`);
    }
    const panel = frame.getByTestId('garment3d');
    if (!(await panel.getByText(/estimate/i).count())) throw new Error(`chino, body ${body.name}: the 3D view has no estimate label`);
    let shown = size;
    if (size !== body.expect) {
      log(`chino, body ${body.name}: the embed opened in ${size}; the table body with a taped thigh gets ${body.expect}: picking that too`);
      await turnShots(page, frame, `body-${body.name}--4-3d-embed-size-${file(size)}`);
      await pick(frame, body.expect);
      await frame.locator(`canvas[data-testid="garment3d-canvas"][data-size="${body.expect}"][data-state="settled"]`).waitFor({ timeout: 240_000 });
      if ((await canvas.getAttribute('data-garment')) === 'not-drawn') {
        const note = frame.getByTestId('garment3d-not-drawn');
        log(`chino, body ${body.name} in ${body.expect}: not drawn — ${await note.textContent()}`);
        await shot(page, `body-${body.name}--5-size-${file(body.expect)}-not-drawn`, frame.getByTestId('garment3d'));
        shown = null;
      } else shown = body.expect;
    }
    if (shown) await turnShots(page, frame, `body-${body.name}--5-3d-size-${file(shown)}`);
    if (await frame.getByText(/coming soon/i).count()) throw new Error(`chino, body ${body.name}: coming soon after the view settled`);
    const drawn = async (other, name) => {
      await pick(frame, other);
      await frame.locator(`canvas[data-testid="garment3d-canvas"][data-size="${other}"][data-state="settled"]`).waitFor({ timeout: 240_000 });
      if ((await canvas.getAttribute('data-garment')) === 'not-drawn') throw new Error(`chino, body ${body.name} in ${other}: not drawn`);
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      await shot(page, `body-${body.name}--7-size-${file(other)}-${name}--front`, panel);
      await quarter(page, frame);
      await shot(page, `body-${body.name}--7-size-${file(other)}-${name}--side`, panel);
      for (let i = 0; i < 3; i++) await quarter(page, frame);
      log(`chino, body ${body.name} in ${other}: drawn (${name})`);
    };
    const notDrawn = async (small) => {
      await pick(frame, small);
      await frame.locator(`canvas[data-testid="garment3d-canvas"][data-size="${small}"][data-garment="not-drawn"]`).waitFor({ timeout: 60_000 });
      const note = frame.getByTestId('garment3d-not-drawn');
      await note.waitFor({ timeout: 10_000 });
      log(`chino, body ${body.name} in ${small}: not drawn — ${await note.textContent()}`);
      await canvas.scrollIntoViewIfNeeded();
      await shot(page, `body-${body.name}--6-size-${file(small)}-not-drawn`, panel);
    };
    if (body.name === 'M') {
      await drawn('34/30', 'short-leg');
      await drawn('34/34', 'long-leg');
      await drawn('38/32', 'too-large');
      await notDrawn('30/32');
    }
    if (body.name === 'XXL') await notDrawn('38/32');
    await page.context().close();
  }
} catch (err) {
  problems.push(String(err instanceof Error ? (err.stack ?? err.message) : err));
} finally {
  await browser?.close();
  stop();
}
for (const p of problems) console.error(`[demo-men-chino] problem: ${p}`);
process.exit(problems.length ? 1 : 0);
