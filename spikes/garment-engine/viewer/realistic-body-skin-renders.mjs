/* global process, console, document, window, URL, URLSearchParams */
/**
 * Before / after pictures of the realistic body's procedural skin and studio light
 * (docs/reports/claude/realistic-body-skin.md), through `avatar.html`, which mounts `packages/garment-viewer` as the embed
 * does. Vite dev server, headless Chromium with SwiftShader (a software renderer on the CPU, not a phone and not a GPU).
 *
 *   node spikes/garment-engine/viewer/realistic-body-skin-renders.mjs <out dir> [--match <text>] [--no-frames] [--no-shots]
 *
 * Three skin tones from the Monk swatches of the repo (`MONK_SWATCHES`, apps/web faceSkin.ts): light Monk 2, medium
 * Monk 6, deep Monk 9 (the tones of the README's colour tables). Per tone, at 390 × 844 CSS px, 2×, same camera:
 *   - each of the five test bodies alone, front and three-quarter, before (the realistic body as it is today: the flat
 *     material in the tone, the `classic` rig) and after (`skinlook=procedural`: the procedural skin and the studio light);
 *   - the mid body in the evaluated azure dress (draped on the device), front and three-quarter, before and after;
 *   - a close-up of the mid body's upper body (`frame=upper`), before and after.
 * Then the frame time, three runs each, alternating: the mean interval between animation frames while the view is
 * dragged round for 4 s (`avatarCheck.rafMs`), mid body with the dress and alone: grey before (the configuration of
 * `docs/screens/claude/realistic-body/renders.json`), medium tone before, medium tone after.
 * Writes PNGs and `renders.json`. Every picture carries the page's ESTIMATE tag.
 *
 * Uses the preinstalled Playwright (`require('playwright')`), not a dependency of the package.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const bundles = resolve(here, '..', 'out');
const argv = process.argv.slice(2);
const matchAt = argv.indexOf('--match');
const match = matchAt >= 0 ? (argv[matchAt + 1] ?? '') : '';
const noFrames = argv.includes('--no-frames');
const noShots = argv.includes('--no-shots');
const args = argv.filter((a, i) => !a.startsWith('--') && !(matchAt >= 0 && i === matchAt + 1));
if (!args[0]) {
  console.error('usage: node realistic-body-skin-renders.mjs <out dir> [--match <text>] [--no-frames] [--no-shots]');
  process.exit(1);
}
const outDir = resolve(args[0]);
mkdirSync(outDir, { recursive: true });
const DRESS = 'eval/azure-palm-baby-doll-dress';
const hasDress = existsSync(join(bundles, DRESS, 'payload.json'));

/** The five test bodies (cm), as realistic-body-renders.mjs. */
export const BODIES = {
  slim: { height: 164, bust: 80, waist: 62, hip: 88 },
  mid: { height: 168, bust: 92, waist: 74, hip: 100 },
  full: { height: 170, bust: 116, waist: 98, hip: 122 },
  tall: { height: 182, bust: 92, waist: 74, hip: 100 },
  petite: { height: 152, bust: 84, waist: 66, hip: 92 },
};
/** Monk 2, 6 and 9 of `MONK_SWATCHES`. */
export const TONES = { light: 'f3e7db', medium: 'a07e56', deep: '3a312a' };
const ZOOM = 8;
const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5187, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const chromePath = [process.env.CHROME_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const browser = await chromium.launch({ ...(chromePath ? { executablePath: chromePath } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const renders = [];
const frames = [];

const thumb = (page) =>
  page.evaluate(() => {
    const src = document.getElementById('stage');
    const c = document.createElement('canvas');
    c.width = 78;
    c.height = 168;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push((d[i] + d[i + 1] + d[i + 2]) / 3);
    return out;
  });

async function still(page, maxMs = 40_000) {
  const t0 = Date.now();
  let prev = await thumb(page);
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(800);
    const next = await thumb(page);
    let diff = 0;
    for (let i = 0; i < next.length; i++) diff += Math.abs(next[i] - prev[i]);
    if (diff / next.length < 0.2) return true;
    prev = next;
  }
  return false;
}

/** Open the page and wait for the view (and, for `body=realistic` with a garment, for the swapped-in body). */
async function open(context, query, name) {
  const page = await context.newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name}: console ${msg.text()}`);
  });
  await page.goto(`${base}avatar.html?${query}`);
  await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: 300_000 });
  if (query.includes('body=realistic') && query.includes('product=')) {
    await page.waitForFunction(() => ['realistic', 'realistic-conformed', 'procedural-fallback'].includes(document.getElementById('stage').dataset.body ?? ''), null, { timeout: 120_000 });
    const drawn = await page.evaluate(() => document.getElementById('stage').dataset.body);
    if (!drawn.startsWith('realistic')) problems.push(`${name}: body ${drawn}`);
  }
  const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
  if (state !== 'settled') problems.push(`${name}: state ${state} (${await page.textContent('#tag')})`);
  return page;
}

async function drag(page, turn, steps = 20) {
  const box = await page.locator('#stage').boundingBox();
  const dx = (box.height / 4) * turn;
  const y = box.y + box.height * 0.55;
  const x0 = box.x + box.width / 2 - dx / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + (dx * i) / steps, y);
  await page.mouse.up();
}

async function shot(context, query, name, { turn = 0, zoom = ZOOM } = {}) {
  if (noShots || (match && !name.includes(match))) return;
  const page = await open(context, query, name);
  if (query.includes('skinlook=procedural') && query.includes('product=')) {
    await page.waitForFunction(() => document.getElementById('stage').dataset.bodySkin === 'procedural-skin', null, { timeout: 120_000 }).catch(() => problems.push(`${name}: no procedural skin`));
  }
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.55);
  for (let i = 0; i < zoom; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(60);
  }
  // A drag of more than a quarter turn would start outside the canvas (its width is under half its height): in steps.
  for (let left = turn; Math.abs(left) > 1e-9; ) {
    const step = Math.sign(left) * Math.min(1, Math.abs(left));
    await drag(page, step);
    left -= step;
  }
  await page.waitForTimeout(700);
  if (!(await still(page))) problems.push(`${name}: the canvas did not come to rest in 40 s`);
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, timeout: 180_000 });
  renders.push({ name, query, tag: await page.textContent('#tag'), garment: await page.evaluate(() => document.getElementById('stage').dataset.garment ?? null), body: await page.evaluate(() => document.getElementById('stage').dataset.body ?? null), girths: await page.evaluate(() => document.getElementById('stage').dataset.bodyGirths ?? null), girthsConformed: await page.evaluate(() => document.getElementById('stage').dataset.bodyGirthsConformed ?? null) });
  await page.close();
}

/** Mean animation-frame interval while the view is dragged round continuously for 4 s. */
async function frameTime(context, query, name) {
  if (match && !name.includes(match)) return;
  const page = await open(context, query, name);
  if (query.includes('skinlook=procedural') && query.includes('product=')) {
    await page.waitForFunction(() => document.getElementById('stage').dataset.bodySkin === 'procedural-skin', null, { timeout: 120_000 }).catch(() => problems.push(`${name}: no procedural skin`));
  }
  await page.waitForTimeout(500);
  const box = await page.locator('#stage').boundingBox();
  const y = box.y + box.height * 0.55;
  const measuring = page.evaluate(() => window.avatarCheck.rafMs(4000));
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < 4200) {
    await page.mouse.move(box.x + 40 + ((k * 7) % (box.width - 80)), y);
    k++;
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const raf = await measuring;
  frames.push({ name, query, raf });
  await page.close();
}

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  for (const [tone, skin] of Object.entries(TONES)) {
    const looks = [
      ['before', { body: 'realistic', skin }],
      ['after', { body: 'realistic', skin, skinlook: 'procedural' }],
    ];
    for (const [id, b] of Object.entries(BODIES)) {
      const body = { family: 'female', ...b };
      for (const [tag, look] of looks) {
        await shot(phone, q({ mode: 'head', frame: 'body', ...body, ...look }), `${tone}-${id}-body-${tag}--front`);
        await shot(phone, q({ mode: 'head', frame: 'body', ...body, ...look }), `${tone}-${id}-body-${tag}--three-quarter`, { turn: 0.5 });
      }
    }
    const mid = { family: 'female', ...BODIES.mid };
    for (const [tag, look] of looks) {
      if (hasDress) {
        await shot(phone, q({ product: DRESS, ...mid, ...look }), `${tone}-mid-dress-${tag}--front`);
        await shot(phone, q({ product: DRESS, ...mid, ...look }), `${tone}-mid-dress-${tag}--three-quarter`, { turn: 0.5 });
      }
      await shot(phone, q({ mode: 'head', frame: 'upper', ...mid, ...look }), `${tone}-mid-upper-${tag}`, { zoom: 0 });
    }
  }
  if (!noFrames) {
    const body = { family: 'female', ...BODIES.mid };
    const configs = [
      ['grey-before', { body: 'realistic' }],
      ['medium-before', { body: 'realistic', skin: TONES.medium }],
      ['medium-after', { body: 'realistic', skin: TONES.medium, skinlook: 'procedural' }],
    ];
    // Three runs each, alternating, so a slow spell of the machine does not land on one side only.
    for (let run = 1; run <= 3; run++) {
      for (const [tag, look] of configs) {
        if (hasDress) await frameTime(phone, q({ product: DRESS, ...body, ...look }), `frames-mid-dress-${tag}-${run}`);
        await frameTime(phone, q({ mode: 'head', frame: 'body', ...body, ...look }), `frames-mid-body-${tag}-${run}`);
      }
    }
  }
} finally {
  writeFileSync(join(outDir, 'renders.json'), JSON.stringify({ when: new Date().toISOString(), renderer: 'headless Chromium, SwiftShader (CPU), 390x844 CSS px at 2x', tones: TONES, hasDress, renders, frames, problems }, null, 1));
  await browser.close();
  await server.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
console.log(`${renders.length} pictures, ${frames.length} frame timings in ${outDir}`);
