/* global process, console, document, window, URL, URLSearchParams */
/**
 * Before / after pictures of the realistic body spike (docs/reports/claude/realistic-body-spike.md), through
 * `avatar.html`, which mounts `packages/garment-viewer` as the embed does. Vite dev server, headless Chromium with
 * SwiftShader (a software renderer on the CPU, not a phone and not a GPU).
 *
 *   node spikes/garment-engine/viewer/realistic-body-renders.mjs <out dir> [--match <text>] [--no-frames]
 *
 * Per test body (slim, mid, full, tall, petite; typed height and girths), at 390 × 844 CSS px, 2×, same camera:
 *   - the body alone, front and three-quarter, before (procedural body, head neutral-v3, the embed's default head)
 *     and after (`body=realistic`);
 *   - wearing the evaluated azure dress (`out/eval/azure-palm-baby-doll-dress`, draped on the device) before and after,
 *     front, three-quarter (the controls turned 45°) and back (180°), when the bundle is there; after also unconformed
 *     (`conform=0`, `-dress-after-raw`, front). Where the fit engine's advice blocks every size of the dress on a body
 *     the dress is not drawn, and the tag says so.
 * Then the frame time, three runs each: the mean interval between animation frames while the view is dragged round for 4 s
 * (`avatarCheck.rafMs`), body alone and with the dress, before and after; and, body alone, `avatarCheck.frameMs`
 * (60 synchronous renders with a one-pixel read-back each, so each includes the renderer's work).
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
const args = argv.filter((a, i) => !a.startsWith('--') && !(matchAt >= 0 && i === matchAt + 1));
if (!args[0]) {
  console.error('usage: node realistic-body-renders.mjs <out dir> [--match <text>] [--no-frames]');
  process.exit(1);
}
const outDir = resolve(args[0]);
mkdirSync(outDir, { recursive: true });
const DRESS = 'eval/azure-palm-baby-doll-dress';
const hasDress = existsSync(join(bundles, DRESS, 'payload.json'));

/** The five test bodies (cm): the female table XS, M, XXL and two typed statures with mid girths. */
export const BODIES = {
  slim: { height: 164, bust: 80, waist: 62, hip: 88 },
  mid: { height: 168, bust: 92, waist: 74, hip: 100 },
  full: { height: 170, bust: 116, waist: 98, hip: 122 },
  tall: { height: 182, bust: 92, waist: 74, hip: 100 },
  petite: { height: 152, bust: 84, waist: 66, hip: 92 },
};
const ZOOM = 8;
const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5186, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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

async function shot(context, query, name, { turn = 0 } = {}) {
  if (match && !name.includes(match)) return;
  const page = await open(context, query, name);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.55);
  for (let i = 0; i < ZOOM; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(60);
  }
  if (turn) await drag(page, turn);
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
  const sync = query.includes('mode=head') ? await page.evaluate(() => window.avatarCheck.frameMs(60)) : null;
  frames.push({ name, query, raf, syncMs: sync });
  await page.close();
}

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const before = { head: 'neutral-v3' };
  const after = { body: 'realistic' };
  for (const [id, b] of Object.entries(BODIES)) {
    const body = { family: 'female', ...b };
    for (const [tag, look] of [['before', before], ['after', after]]) {
      await shot(phone, q({ mode: 'head', frame: 'body', ...body, ...look }), `${id}-body-${tag}--front`);
      await shot(phone, q({ mode: 'head', frame: 'body', ...body, ...look }), `${id}-body-${tag}--three-quarter`, { turn: 0.5 });
      if (hasDress) {
        await shot(phone, q({ product: DRESS, ...body, ...look }), `${id}-dress-${tag}--front`);
        await shot(phone, q({ product: DRESS, ...body, ...look }), `${id}-dress-${tag}--three-quarter`, { turn: 0.5 });
        await shot(phone, q({ product: DRESS, ...body, ...look }), `${id}-dress-${tag}--back`, { turn: 2 });
      }
    }
    // The realistic body drawn as fitted under the dress too (not conformed): where its skin is outside the ring table's field.
    if (hasDress) await shot(phone, q({ product: DRESS, ...body, ...after, conform: 0 }), `${id}-dress-after-raw--front`);
  }
  if (!noFrames) {
    for (const id of ['mid', 'full']) {
      const body = { family: 'female', ...BODIES[id] };
      // Three runs each, alternating before and after, so a slow spell of the machine does not land on one side only.
      for (let run = 1; run <= 3; run++) {
        for (const [tag, look] of [['before', before], ['after', after]]) {
          await frameTime(phone, q({ mode: 'head', frame: 'body', ...body, ...look }), `frames-${id}-body-${tag}-${run}`);
          if (hasDress) await frameTime(phone, q({ product: DRESS, ...body, ...look }), `frames-${id}-dress-${tag}-${run}`);
        }
      }
    }
  }
} finally {
  writeFileSync(join(outDir, 'renders.json'), JSON.stringify({ when: new Date().toISOString(), renderer: 'headless Chromium, SwiftShader (CPU), 390x844 CSS px at 2x', hasDress, renders, frames, problems }, null, 1));
  await browser.close();
  await server.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
console.log(`${renders.length} pictures, ${frames.length} frame timings in ${outDir}`);
