/* global process, console, document, window, URL, URLSearchParams */
/**
 * Pictures and frame times of the realistic hair (D28, docs/reports/claude/realistic-hair.md), through `avatar.html`,
 * which builds the hair with the shipped `packages/garment-viewer` code (`createHair`; with a garment through
 * `mountGarmentView`'s `MountOptions.hair`). Vite dev server, headless Chromium with SwiftShader (a software renderer
 * on the CPU: not a phone and not a GPU).
 *
 *   node spikes/garment-engine/viewer/realistic-hair-renders.mjs <out dir> [--match <text>] [--no-frames] [--no-tiles] [--jobs n]
 *
 * At 390 × 844 CSS px, 2×, the mid body (168 cm, 92 / 74 / 100):
 *   - `tile-<type>-<length>--front` and `--back` (back three-quarter, the controls turned 135°), head to waist, all 40
 *     combinations, one colour per type (`TYPE_COLOUR`);
 *   - `colour-<colour>--front` and `--back`: type 2B at shoulder length in the ten colours;
 *   - `dress-<type>-<length>--front|three-quarter|back`: 4C long, 3A shoulder and 1 long in the evaluated azure dress
 *     (when its bundle is in `out/eval/`), full body;
 * then frame times (the mean interval between animation frames while the view is dragged for 4 s, `avatarCheck.rafMs`),
 * full-body view: the empty stage (`nobody=1`), the body alone, the body with hair per type group and length, and the
 * dress with and without the hair; alternating, `RUNS` runs each. Writes PNGs and `renders.json`.
 * The sheets are `realistic-hair-sheets.mjs`. Uses the preinstalled Playwright (`require('playwright')`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../node_modules/.pnpm/node_modules/playwright'));
  }
})();
const here = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const match = opt('--match') ?? '';
const jobs = Number(opt('--jobs') ?? 2);
const args = argv.filter((a, i) => !a.startsWith('--') && !['--match', '--jobs'].includes(argv[i - 1]));
if (!args[0]) {
  console.error('usage: node realistic-hair-renders.mjs <out dir> [--match <text>] [--no-frames] [--no-tiles] [--jobs n]');
  process.exit(1);
}
const outDir = resolve(args[0]);
mkdirSync(outDir, { recursive: true });
const DRESS = 'eval/azure-palm-baby-doll-dress';
const hasDress = existsSync(resolve(here, '..', 'out', DRESS, 'payload.json'));

export const TYPES = ['1', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C'];
export const LENGTHS = ['short', 'chin', 'shoulder', 'long'];
export const COLOURS = ['black', 'dark-brown', 'brown', 'light-brown', 'auburn', 'copper', 'dark-blonde', 'blonde', 'platinum', 'grey'];
/** One colour per type on the 40-combination sheet, so every colour is seen on some type. */
export const TYPE_COLOUR = { 1: 'dark-brown', '2A': 'blonde', '2B': 'auburn', '2C': 'light-brown', '3A': 'dark-blonde', '3B': 'copper', '3C': 'brown', '4A': 'grey', '4B': 'platinum', '4C': 'black' };
const BODY = { family: 'female', height: 168, bust: 92, waist: 74, hip: 100 };
const ZOOM = 8;
const RUNS = Number(opt('--runs') ?? 2);
const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
const hairQ = (type, length, colour) => ({ hair: type, hairLength: length, hairColour: colour });

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5187, strictPort: false, hmr: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const chromePath = [process.env.CHROME_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const browser = await chromium.launch({ ...(chromePath ? { executablePath: chromePath } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const renders = [];
const frames = [];

async function open(context, query, name) {
  const page = await context.newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name}: console ${msg.text()}`);
  });
  await page.goto(`${base}avatar.html?${query}`);
  if (query.includes('mode=head')) await page.waitForFunction(() => (document.getElementById('tag').textContent ?? '').startsWith('ESTIMATE ·'), null, { timeout: 300_000 });
  else await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: 300_000 });
  if (query.includes('hair=')) {
    await page.waitForFunction(() => /^[0-9][ABC]?-|failed/.test(document.getElementById('stage').dataset.hair ?? ''), null, { timeout: 120_000 });
    const h = await page.evaluate(() => document.getElementById('stage').dataset.hair);
    if (h === 'failed') problems.push(`${name}: hair failed`);
  }
  if (!query.includes('mode=head')) {
    const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
    if (state !== 'settled') problems.push(`${name}: state ${state}`);
  }
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

async function turnBy(page, turn) {
  for (let left = turn; Math.abs(left) > 1e-9; ) {
    const step = Math.sign(left) * Math.min(1, Math.abs(left));
    await drag(page, step);
    left -= step;
    await page.waitForTimeout(400);
  }
}

/** One page, several views in order: each `[suffix, turn from the previous view]`. */
async function shots(context, query, name, views, { zoom = 0 } = {}) {
  if (match && !name.includes(match)) return;
  const page = await open(context, query, name);
  if (zoom) {
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.55);
    for (let i = 0; i < zoom; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(60);
    }
  }
  for (const [suffix, turn] of views) {
    if (turn) await turnBy(page, turn);
    // The orbit controls damp out over about a second.
    await page.waitForTimeout(2200);
    await page.screenshot({ path: join(outDir, `${name}--${suffix}.png`), timeout: 240_000 });
    const data = await page.evaluate(() => ({ ...document.getElementById('stage').dataset, tag: document.getElementById('tag').textContent }));
    renders.push({ name: `${name}--${suffix}`, query, tag: data.tag, hair: data.hair ?? null, triangles: data.hairTriangles ? Number(data.hairTriangles) : null, textureBytes: data.hairTextureBytes ? Number(data.hairTextureBytes) : null, buildMs: data.hairBuildMs ? Number(data.hairBuildMs) : null, garment: data.garment ?? null, body: data.body ?? null });
  }
  await page.close();
}

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
  const hair = await page.evaluate(() => ({ hair: document.getElementById('stage').dataset.hair ?? null, triangles: Number(document.getElementById('stage').dataset.hairTriangles ?? 0) }));
  frames.push({ name, query, raf, ...hair });
  await page.close();
}

/** Run tasks `jobs` at a time (each in its own page; SwiftShader shares the CPU, so frame times run one at a time). */
async function pool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      try {
        await t();
      } catch (e) {
        problems.push(String(e?.message ?? e).split('\n')[0]);
      }
    }
  }));
}

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const head = { mode: 'head', frame: 'hair', body: 'realistic', render: 'demand', ...BODY };
  const tasks = [];
  if (!argv.includes('--no-tiles')) {
    for (const type of TYPES) for (const length of LENGTHS) tasks.push(() => shots(phone, q({ ...head, ...hairQ(type, length, TYPE_COLOUR[type]) }), `tile-${type}-${length}`, [['front', 0], ['back', 1.5]]));
    for (const colour of COLOURS) tasks.push(() => shots(phone, q({ ...head, ...hairQ('2B', 'shoulder', colour) }), `colour-${colour}`, [['front', 0], ['back', 1.5]]));
  }
  if (argv.includes('--closeups')) {
    const closeBase = { mode: 'head', frame: 'closeup', body: 'realistic', render: 'demand', yaw: 34, ...BODY };
    const closeList = [['1', 'long'], ['2B', 'shoulder'], ['3B', 'long'], ['4C', 'long']];
    for (const [type, length] of closeList) {
      for (const [tagStyle, hairStyle] of [['v1', 'strand-cards'], ['v2', 'sculpted']]) {
        tasks.push(() => shots(phone, q({ ...closeBase, ...hairQ(type, length, TYPE_COLOUR[type]), hairStyle }), `closeup-${tagStyle}-${type}-${length}`, [['tq', 0]]));
      }
    }
  }
  if (hasDress) {
    for (const [type, length] of [['4C', 'long'], ['3A', 'shoulder'], ['1', 'long']]) {
      tasks.push(() => shots(phone, q({ product: DRESS, ...BODY, body: 'realistic', ...hairQ(type, length, TYPE_COLOUR[type]) }), `dress-${type}-${length}`, [['front', 0], ['three-quarter', 0.5], ['back', 1.5]], { zoom: ZOOM }));
    }
  }
  await pool(tasks, jobs);
  if (!argv.includes('--no-frames')) {
    const full = { mode: 'head', frame: 'body', body: 'realistic', ...BODY };
    const configs = [['empty-stage', { ...full, nobody: 1 }], ['body', full]];
    const frameTypes = argv.includes('--all-frames') ? TYPES : ['1', '2B', '3B', '3C', '4C'];
    for (const type of frameTypes) for (const length of LENGTHS) configs.push([`hair-${type}-${length}`, { ...full, ...hairQ(type, length, TYPE_COLOUR[type]) }]);
    if (hasDress) {
      configs.push(['dress', { product: DRESS, ...BODY, body: 'realistic' }]);
      for (const [type, length] of [['4C', 'long'], ['1', 'long']]) configs.push([`dress-hair-${type}-${length}`, { product: DRESS, ...BODY, body: 'realistic', ...hairQ(type, length, TYPE_COLOUR[type]) }]);
    }
    for (let run = 1; run <= RUNS; run++) for (const [name, query] of configs) await frameTime(phone, q(query), `frames-${name}-${run}`);
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
