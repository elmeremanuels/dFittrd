#!/usr/bin/env node
/**
 * `node scripts/demo-men.mjs [shots dir]` — the male path end to end in the real stack
 * (docs/research/men-3d-plan.md slice M1). Not part of `pnpm check`.
 *
 * Starts its own api (PGlite in a fresh temp folder, DEMO_MEN=1 and MEN_3D_GATE=1), web dev server
 * and demo storefront on ports of its own (8797, 3017, 5197; never the `pnpm demo` ones, which it
 * would otherwise reuse), so it runs next to a `pnpm demo`. Then, in headless Chromium at phone size
 * (390 × 760 CSS px at 2×):
 *   1. the SYNTHETIC men's test tee (not a product; bundle built on the male mannequin by the POM tee
 *      builder of slice M3, imported by the demo seed with `importBundle`, approved by the demo
 *      merchant): storefront → "Try it on" → About you → the 3D view opens by itself (`requires3d`),
 *      must settle on the male body, and the result is shown only then; for the male table's five
 *      bodies S to XXL; then the tee in each body's own size (the compare buttons) is turned front,
 *      side and back (`--5-3d-size-<size>--{front,side,back}`);
 *      With --close, the front view is also taken zoomed in on the shoulders and chest (`--close-front`, and turned
 *      a quarter, `--close-side`). With --off-size, the XXL body then picks S and XL: the tee is too small for it
 *      (the fit engine says it does not close at the chest), so the 3D view draws the body alone and says why
 *      (`--6-size-<size>-not-drawn`, canvas `data-garment="not-drawn"`);
 *   2. the men's Oxford shirt with no bundle: "Men's clothing: coming soon", no figure, no size.
 * Screenshots of every step go to the shots dir (default test-results/demo-men). Exits non-zero on
 * the first failure. Needs `out/synthetic-men-tee/` (`pnpm --filter @curtain/garment-spike
 * build:bundle`) and built packages (`pnpm build:packages`, the SDK included).
 *
 * Flags: --gate-off  run with MEN_3D_GATE off: the tee then has the optional 3D button, and the
 *                    shirt the usual 2D flow (today's behaviour).
 *        --width=N   phone width in CSS px (default 390; slice M1b's pictures use 360).
 *        --all-sizes all five bodies of the male table (S, M, L, XL, XXL) instead of S, M, XL.
 *        --skins     on every body, pick three skin tones in the avatar prompt (Monk 2, 5 and 9)
 *                    and take a close-up of the 2D figure in each.
 *
 * Slice M1b: with the gate on, the 2D figure beside the 3D view must be the male figure
 * (`data-figure="male"`) and carry its estimate label; with the gate off it is today's figure.
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
const gateOff = args.includes('--gate-off');
const allSizes = args.includes('--all-sizes');
const withSkins = args.includes('--skins');
const withClose = args.includes('--close');
const offSize = args.includes('--off-size');
const width = Number((args.find((a) => a.startsWith('--width=')) ?? '--width=390').slice('--width='.length));
const shots = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'test-results', 'demo-men'));
mkdirSync(shots, { recursive: true });
const TEE_BUNDLE = join(root, 'spikes', 'garment-engine', 'out', 'synthetic-men-tee', 'base.glb');
if (!existsSync(TEE_BUNDLE)) {
  console.error(`no synthetic men's tee bundle at ${TEE_BUNDLE}: run pnpm --filter @curtain/garment-spike build:bundle`);
  process.exit(1);
}

const PORTS = { api: 8797, web: 3017, shop: 5197 };
const URLS = { api: `http://localhost:${PORTS.api}`, web: `http://localhost:${PORTS.web}`, shop: `http://localhost:${PORTS.shop}` };
const db = mkdtempSync(join(tmpdir(), 'curtain-demo-men-'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [];
const log = (m) => console.log(`[demo-men] ${m}`);

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
    MEN_3D_GATE: gateOff ? '0' : '1',
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
  const tee = shopify.products.find((p) => p.externalId === 'synthetic-men-tee');
  if (!tee?.asset3d) throw new Error(`the synthetic men's tee was not seeded with an approved 3D bundle: ${JSON.stringify(tee)}`);
  log(`seeded: synthetic-men-tee with bundle ${tee.asset3d}; gate ${gateOff ? 'off' : 'on'}`);

  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tag = `${gateOff ? 'gate-off' : 'gate-on'}${width !== 390 ? `-${width}` : ''}`;
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
    if (body.chest && (await known.count())) await known.click();
    for (const [re, v] of [[/^(chest|bust)/i, body.chest], [/^waist/i, body.waist], [/^(hip|seat)/i, body.hip]]) {
      const field = frame.getByLabel(re).first();
      if (v && (await field.count())) await field.fill(String(v));
    }
  };

  // ---- 1. the synthetic men's tee on the male body -------------------------------------------------
  // The male table's S to XXL (MALE_REFERENCE of @curtain/mannequin: stature, chest, waist, seat); weights are round guesses that only feed the prior.
  const ALL_BODIES = [
    { name: 'S', height: 172.5, weight: 64, chest: 90, waist: 78, hip: 90.5 },
    { name: 'M', height: 174, weight: 74, chest: 98, waist: 86, hip: 96 },
    { name: 'L', height: 175.5, weight: 83, chest: 106, waist: 94, hip: 102 },
    { name: 'XL', height: 177, weight: 92, chest: 114, waist: 102, hip: 108 },
    { name: 'XXL', height: 179, weight: 103, chest: 123, waist: 111, hip: 114.5 },
  ];
  const BODIES = allSizes ? ALL_BODIES : ALL_BODIES.filter((b) => ['S', 'M', 'XL'].includes(b.name));
  // Monk skin tone scale classes picked in the avatar prompt (light, medium, dark).
  const SKINS = [2, 5, 9];
  // Front, side and back of the 3D view: OrbitControls turns 2π per canvas height of drag.
  const turnShots = async (page, frame, label) => {
    const panel = frame.getByTestId('garment3d');
    const canvas = frame.locator('canvas[data-testid="garment3d-canvas"]');
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot(page, `${label}--front`, panel);
    const quarter = async () => {
      const box = await canvas.boundingBox();
      const dx = box.height / 4;
      const y = box.y + box.height * 0.55;
      const x0 = box.x + box.width / 2 - dx / 2;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + (dx * i) / 20, y);
      await page.mouse.up();
      await page.waitForTimeout(2500);
    };
    const zoom = async (deltaY) => {
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, deltaY / 6);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(2000);
    };
    if (withClose) {
      // Zoomed in on the shoulders and chest (OrbitControls dolly towards the target, mid torso), front and a quarter turn.
      await zoom(-900);
      await shot(page, `${label}--close-front`, canvas);
      await quarter();
      await shot(page, `${label}--close-side`, canvas);
      await zoom(900);
      await shot(page, `${label}--side`, panel);
    } else {
      await quarter();
      await shot(page, `${label}--side`, panel);
    }
    await quarter();
    await shot(page, `${label}--back`, panel);
  };
  for (const body of BODIES) {
    const page = await newPage();
    const frame = await openOverlay(page, 'synthetic-men-tee', body.name === 'S' ? 'tee--0-storefront-page' : null);
    await about(frame, body);
    if (body.name === 'S') await shot(page, 'tee--1-about-you');
    await frame.getByTestId('see-my-size').click();
    const canvas = frame.locator('canvas[data-testid="garment3d-canvas"]');
    if (gateOff) {
      await frame.getByRole('button', { name: /^choose size\s+\S+/i }).first().waitFor({ timeout: 60_000 });
      await shot(page, `tee-body-${body.name}--2-result-2d`);
      await frame.getByTestId('garment3d-open').click();
    } else {
      // requires3d: nothing of the result before the view settles; it opens by itself.
      await frame.getByTestId('requires3d-pending').waitFor({ timeout: 60_000 });
      await shot(page, `tee-body-${body.name}--2-pending`);
    }
    await frame.locator('canvas[data-testid="garment3d-canvas"][data-state="settled"]').waitFor({ timeout: 240_000 });
    if (!gateOff) await frame.getByTestId('requires3d-shown').waitFor({ timeout: 30_000 });
    const size = await canvas.getAttribute('data-size');
    log(`tee, body ${body.name}: settled in size ${size}`);
    await shot(page, `tee-body-${body.name}--3-settled-size-${size}`);
    // The 2D figure the result draws above the 3D view (the male 2D figure is slice M1b, not built).
    const mirror = frame.locator('[data-testid="embed-result"] [data-testid="mirror"]').first();
    if (await mirror.count()) {
      // The sticky "Choose size" bar covers the lower edge of whatever is at the bottom of the
      // overlay; scroll the figure to the top, so its own labels (estimate, "Body from your
      // answers") are not under the bar, and check both labels are there.
      await mirror.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await shot(page, `tee-body-${body.name}--3b-2d-figure`, mirror);
      for (const label of [/Body from your answers/, /Estimate/]) {
        if (!(await mirror.getByText(label).count())) throw new Error(`tee, body ${body.name}: the 2D figure has no label ${label}`);
      }
      log(`tee, body ${body.name}: 2D figure labels present (estimate, body from your answers)`);
      // Slice M1b: beside the required 3D view on the male body the figure is the male one.
      const figure = await mirror.locator('svg').first().getAttribute('data-figure');
      if (!gateOff && figure !== 'male') throw new Error(`tee, body ${body.name}: the 2D figure beside the male 3D body is not the male figure (data-figure=${figure})`);
      if (gateOff && figure !== null) throw new Error(`tee, body ${body.name}: gate off, but the 2D figure is marked ${figure}`);
      log(`tee, body ${body.name}: 2D figure is ${figure ?? 'female (today\'s figure)'}`);
      if (withSkins) {
        for (const n of SKINS) {
          await frame.getByTestId('avatar-open').click();
          await frame.getByTestId('avatar-prompt').waitFor();
          const sw = frame.getByTestId('avatar-skin-switch');
          await sw.waitFor();
          if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
          await frame.getByTestId('skin-swatches').waitFor();
          const swatch = frame.getByTestId(`skin-swatch-${n}`);
          await swatch.check({ force: true });
          if (!(await swatch.isChecked())) throw new Error(`tee, body ${body.name}: Monk ${n} did not stay picked`);
          await frame.getByTestId('avatar-prompt-done').click();
          await frame.getByTestId('avatar-prompt').waitFor({ state: 'detached' });
          await mirror.evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await page.waitForTimeout(400);
          const skin = await mirror.locator('svg').first().getAttribute('data-skin');
          if (skin === '#DFC3A8') throw new Error(`tee, body ${body.name}: Monk ${n} picked, but the figure is in the standard colour`);
          await shot(page, `tee-body-${body.name}--3c-2d-figure-monk-${n}`, mirror);
          if (!(await mirror.getByText(/Estimate/).count())) throw new Error(`tee, body ${body.name}, monk ${n}: no estimate label on the figure`);
          log(`tee, body ${body.name}: monk ${n} → figure skin ${skin}`);
        }
        await shot(page, `tee-body-${body.name}--3d-page-monk-${SKINS[SKINS.length - 1]}`);
      }
    }
    await canvas.scrollIntoViewIfNeeded();
    await shot(page, `tee-body-${body.name}--4-3d-close-size-${size}`, frame.getByTestId('garment3d'));
    // The tee in the body's own table size (the size buttons under "Compare"), front, side and back.
    if (size !== body.name) {
      const own = frame.getByRole('radio', { name: new RegExp(`^${body.name}\\b`) }).first();
      if (await own.count()) {
        await own.click();
        await frame.locator(`canvas[data-testid="garment3d-canvas"][data-size="${body.name}"][data-state="settled"]`).waitFor({ timeout: 240_000 });
        log(`tee, body ${body.name}: switched to its own size ${body.name}`);
      } else log(`tee, body ${body.name}: no button for size ${body.name}; turning size ${size}`);
    }
    const shown = await canvas.getAttribute('data-size');
    await turnShots(page, frame, `tee-body-${body.name}--5-3d-size-${shown}`);
    if (await frame.getByText(/coming soon/i).count()) throw new Error(`tee, body ${body.name}: coming soon after the view settled`);
    if (offSize && body.name === 'XXL') {
      for (const small of ['S', 'XL']) {
        const btn = frame.getByRole('radio', { name: new RegExp(`^${small}\\b`) }).first();
        if (!(await btn.count())) throw new Error(`tee, body XXL: no size button ${small}`);
        await btn.click();
        await frame.locator(`canvas[data-testid="garment3d-canvas"][data-size="${small}"][data-garment="not-drawn"]`).waitFor({ timeout: 60_000 });
        const note = frame.getByTestId('garment3d-not-drawn');
        await note.waitFor({ timeout: 10_000 });
        log(`tee, body XXL in ${small}: not drawn — ${await note.textContent()}`);
        await shot(page, `tee-body-XXL--6-size-${small}-not-drawn`, frame.getByTestId('garment3d'));
      }
    }
    await page.context().close();
  }

  // ---- 2. a men's product with no male bundle --------------------------------------------------------
  {
    const page = await newPage();
    const frame = await openOverlay(page, 'noordman-shirt-01', 'shirt-no-bundle--0-storefront-page');
    if (gateOff) {
      await about(frame, BODIES[1]);
      await frame.getByTestId('see-my-size').click();
      await frame.getByRole('button', { name: /^choose size\s+\S+/i }).first().waitFor({ timeout: 60_000 });
      await shot(page, 'shirt-no-bundle--result-2d');
    } else {
      await frame.getByTestId('blocked-comingSoon').waitFor({ timeout: 60_000 });
      await shot(page, 'shirt-no-bundle--coming-soon');
      if (await frame.locator('canvas, svg[data-testid="avatar"], [data-testid="recommended-size"]').count()) throw new Error('coming soon shows a figure or a size');
    }
    await page.context().close();
  }
} catch (err) {
  problems.push(String(err instanceof Error ? (err.stack ?? err.message) : err));
} finally {
  await browser?.close();
  stop();
}
for (const p of problems) console.error(`[demo-men] problem: ${p}`);
process.exit(problems.length ? 1 : 0);
