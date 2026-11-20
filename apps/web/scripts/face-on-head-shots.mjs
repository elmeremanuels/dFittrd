/* global process, console, document, window, URL, Buffer */
/**
 * Slice 6 spike: pictures and timings of the face on the 3D head (`dev/face-on-head.html`), with
 * the synthetic test faces of `e2e/fixtures/synthetic-faces/` (rendered from the mannequin's own
 * head, not photos of anybody). Starts a Vite dev server with `VITE_AVATAR_FACE_ON_HEAD=1` and no
 * HMR, headless Chromium with SwiftShader (a software renderer, not a phone).
 *
 *   node apps/web/scripts/face-on-head-shots.mjs <out dir> [--throttle 4] [--runs 3] [--people a,b,c] [--no-timing]
 *
 * Needs the models (`pnpm --filter @curtain/web models`). Writes PNGs (phone page 412 x 915 at 2x;
 * close-ups of the canvas) and `face-on-head.json`: per person the bake's numbers and, in the
 * throttled phone page (DevTools CPU throttle, default 4x), the time of each step for a cold start
 * (empty cache: the worker downloads the WASM runtime and the face model) and warm runs, with the
 * landmarker on the CPU and on the "GPU" (SwiftShader here: a software GPU, so the GPU numbers say
 * nothing about a phone's GPU), plus the bytes of every model file the page fetched. The pictures
 * use the CPU delegate. Exits 1 on a page error.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const web = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const outArg = argv.find((a, i) => !a.startsWith('--') && !['--throttle', '--runs', '--people'].includes(argv[i - 1]));
if (!outArg) {
  console.error('usage: node face-on-head-shots.mjs <out dir> [--throttle 4] [--runs 3]');
  process.exit(1);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const THROTTLE = Number(opt('--throttle', 4));
const RUNS = Number(opt('--runs', 3));
const FACES = join(web, 'e2e', 'fixtures', 'synthetic-faces');
const ALL_PEOPLE = [
  { id: 'a', monk: 2, label: 'Monk 2 (light)' },
  { id: 'b', monk: 6, label: 'Monk 6 (medium)' },
  { id: 'c', monk: 9, label: 'Monk 9 (deep)' },
];
const only = opt('--people', null);
const PEOPLE = only ? ALL_PEOPLE.filter((p) => only.split(',').includes(p.id)) : ALL_PEOPLE;
const TIMING = !argv.includes('--no-timing');

process.env.VITE_AVATAR_FACE_ON_HEAD = '1';
const server = await createServer({ root: web, configFile: join(web, 'vite.config.ts'), logLevel: 'warn', server: { port: 5195, strictPort: false, hmr: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { emulated: 'headless Chromium, SwiftShader (software WebGL), DevTools CPU throttle; Vite dev server on localhost (no network latency); not a phone', throttle: THROTTLE, viewport: '412x915@2x', people: {} };
let failed = false;

async function phonePage(dsf = 2) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: dsf, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    console.error('pageerror', e.message);
    failed = true;
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('console', m.text().slice(0, 300));
  });
  return { context, page };
}

async function openWith(page, query) {
  await page.goto(`${base}/dev/face-on-head.html?${query}`);
  await page.waitForFunction(() => window.faceSpike?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(800);
}

async function bake(page, file) {
  await page.getByTestId('avatar-face-switch').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('avatar-face-yes').click();
  await (await chooser).setFiles(file);
  await page.waitForFunction(() => window.faceSpike.last !== null || window.faceSpike.error !== null, null, { timeout: 240_000 });
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ last: window.faceSpike.last, bytes: window.faceSpike.textureBytes, hasFace: window.faceSpike.viewHasFace(), error: window.faceSpike.error }));
}

const canvasShot = async (page, path) => page.getByTestId('figure-canvas').screenshot({ path });

for (const p of PEOPLE) {
  const photo = join(FACES, `person-${p.id}.jpg`);
  const rec = { label: p.label, photo: `e2e/fixtures/synthetic-faces/person-${p.id}.jpg` };
  // Pictures (no throttle): the prompt, the phone page with and without the face, close-ups, turned.
  {
    const { context, page } = await phonePage(2);
    await openWith(page, `skin=${p.monk}&prompt=1&delegate=cpu`);
    if (p.id === 'a') {
      await page.screenshot({ path: join(out, 'prompt-face-row.png') });
      await page.getByTestId('avatar-face-switch').click();
      await page.getByTestId('avatar-face-ask').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(out, 'prompt-face-ask.png') });
      await page.getByTestId('avatar-face-no').click();
    }
    await page.evaluate(() => window.faceSpike.closePrompt());
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `phone-${p.id}-before.png`) });
    await page.evaluate(() => window.faceSpike.openPrompt());
    const r = await bake(page, photo);
    rec.bake = r;
    if (r.error || !r.hasFace) {
      console.error(`person ${p.id}: no face on the head`, r);
      failed = true;
    }
    await page.screenshot({ path: join(out, `phone-${p.id}-prompt-after.png`) });
    const png = await page.evaluate(() => window.faceSpike.textureDataUrl());
    if (png) writeFileSync(join(out, `texture-${p.id}.png`), Buffer.from(png.split(',')[1], 'base64'));
    await page.evaluate(() => window.faceSpike.closePrompt());
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `phone-${p.id}-face.png`) });
    await page.evaluate(() => window.faceSpike.setFrame('face'));
    for (const yaw of [0, 30, 55, 80]) {
      await page.evaluate((y) => window.faceSpike.setYaw(y), yaw);
      await page.waitForTimeout(400);
      await canvasShot(page, join(out, `close-${p.id}-yaw${yaw}.png`));
    }
    await page.evaluate(() => {
      window.faceSpike.setYaw(0);
      window.faceSpike.setFrame('body');
    });
    await page.waitForTimeout(400);
    await canvasShot(page, join(out, `body-${p.id}.png`));
    await context.close();
  }
  // The same close-up without the face (the standard head in the same skin colour), for comparison.
  {
    const { context, page } = await phonePage(2);
    await openWith(page, `skin=${p.monk}&frame=face`);
    await canvasShot(page, join(out, `close-${p.id}-standard.png`));
    await context.close();
  }
  // Timings in the throttled phone page, per delegate of the landmarker: run 1 cold (fresh context, empty cache:
  // the worker downloads the WASM runtime and the face model), then warm runs on the same page. Each run starts a new
  // worker, as the flow does (the worker is disposed after each bake).
  rec.throttled = {};
  for (const delegate of TIMING ? ['cpu', 'gpu'] : []) {
    const runs = [];
    const { context, page } = await phonePage(2);
    const models = new Map();
    page.on('response', async (res) => {
      const u = new URL(res.url());
      if (!u.pathname.startsWith('/models/')) return;
      try {
        models.set(u.pathname, (await res.body()).byteLength);
      } catch {
        /* redirected or aborted */
      }
    });
    const cdp = await context.newCDPSession(page);
    await openWith(page, `skin=${p.monk}&prompt=1&delegate=${delegate}`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    for (let i = 0; i < RUNS; i++) {
      if (i > 0) {
        await page.getByTestId('avatar-face-switch').click();
        await page.evaluate(() => {
          window.faceSpike.last = null;
        });
      }
      const t0 = Date.now();
      const r = await bake(page, photo);
      runs.push({ run: i + 1, cache: i === 0 ? 'cold' : 'warm', ...r.last.timings, wallToFaceMs: Date.now() - t0 - 600, delegate: r.last.delegate });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    rec.throttled[delegate] = runs;
    rec.modelBytes = Object.fromEntries(models);
    await context.close();
  }
  report.people[p.id] = rec;
  writeFileSync(join(out, 'face-on-head.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(p.id, JSON.stringify(rec.bake?.last?.stats), JSON.stringify(Object.fromEntries(Object.entries(rec.throttled).map(([d, r]) => [d, r.map((x) => x.totalMs)]))));
}

// A turned head: the bake warns, the face is still drawn.
{
  const { context, page } = await phonePage(2);
  await openWith(page, 'skin=6&prompt=1&delegate=cpu');
  const r = await bake(page, join(FACES, 'person-b-yaw25.jpg'));
  report.turned = r.last;
  await page.screenshot({ path: join(out, 'phone-b-turned-prompt.png') });
  await page.evaluate(() => {
    window.faceSpike.closePrompt();
    window.faceSpike.setFrame('face');
  });
  await page.waitForTimeout(500);
  await canvasShot(page, join(out, 'close-b-turned.png'));
  await context.close();
}
// Even light against side light (what the crude de-light leaves).
for (const p of PEOPLE) {
  const { context, page } = await phonePage(2);
  await openWith(page, `skin=${p.monk}&prompt=1&frame=face&delegate=cpu`);
  const r = await bake(page, join(FACES, `person-${p.id}-even.jpg`));
  report.people[p.id].even = r.last?.stats ?? null;
  await page.evaluate(() => window.faceSpike.closePrompt());
  await page.waitForTimeout(500);
  await canvasShot(page, join(out, `close-${p.id}-even.png`));
  await context.close();
}
report.photoBytes = Object.fromEntries(PEOPLE.map((p) => [p.id, readFileSync(join(FACES, `person-${p.id}.jpg`)).byteLength]));
writeFileSync(join(out, 'face-on-head.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
await server.close();
if (failed) process.exit(1);
