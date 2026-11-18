/* global process, console, document, URL, URLSearchParams */
/**
 * Pictures of the male body in the shipped viewer (men-3d-plan slice M1), through `avatar.html`,
 * which mounts `packages/garment-viewer` exactly as the embed does. Same approach as
 * avatar-renders.mjs: Vite dev server, headless Chromium with SwiftShader (a software renderer, not
 * a phone).
 *
 *   node spikes/garment-engine/viewer/men-renders.mjs <out dir> [--match <text>]
 *
 * For each male table size S, M, L, XL and XXL (`MALE_REFERENCE` of @curtain/mannequin: stature,
 * chest, waist, seat and biacromial shoulder width typed in as the shopper's body), front and side:
 *   - the body alone (`mode=head&frame=body`);
 *   - wearing the SYNTHETIC men's test tee (`out/synthetic-men-tee/`, `pnpm --filter
 *     @curtain/garment-spike build:bundle`) in the same size, draped on the device.
 * Plus close-ups of the head and shoulders and of the torso, and one female-bundle-on-male-body
 * refusal (the viewer must end in `error`, never draw it). Phone size, 390 × 760 CSS px at 2×.
 * Writes PNGs and `renders.json` (state per picture) to the out dir. Every picture carries the
 * page's ESTIMATE tag.
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
const args = argv.filter((a, i) => !(matchAt >= 0 && (i === matchAt || i === matchAt + 1)));
if (!args[0]) {
  console.error('usage: node men-renders.mjs <out dir> [--match <text>]');
  process.exit(1);
}
const outDir = resolve(args[0]);
const TEE = 'synthetic-men-tee';
if (!existsSync(join(bundles, TEE, 'payload.json'))) {
  console.error(`No ${TEE} bundle in out/ (run pnpm --filter @curtain/garment-spike build:bundle).`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/** `MALE_REFERENCE` of packages/mannequin/src/families.ts (stature, chest, waist, seat, biacromial), cm. */
const SIZES = {
  S: { height: 172.5, bust: 90, waist: 78, hip: 90.5, shoulder: 40 },
  M: { height: 174, bust: 98, waist: 86, hip: 96, shoulder: 40.5 },
  L: { height: 175.5, bust: 106, waist: 94, hip: 102, shoulder: 41.5 },
  XL: { height: 177, bust: 114, waist: 102, hip: 108, shoulder: 42.5 },
  XXL: { height: 179, bust: 123, waist: 111, hip: 114.5, shoulder: 43.5 },
};
const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5184, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const renders = [];

/**
 * One picture. `turn`: drag the orbit controls this share of a quarter turn (1 = side view; the
 * garment page has no yaw parameter, the viewer's own controls turn it). `clip`: a CSS-px box.
 */
async function shot(context, query, name, { turn = 0, clip = null, expect = 'settled' } = {}) {
  if (match && !name.includes(match)) return;
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && expect !== 'error') problems.push(`${name}: console ${msg.text()}`);
  });
  await page.goto(`${base}avatar.html?${query}`);
  await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: 300_000 });
  const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
  const tag = await page.textContent('#tag');
  if (state !== expect) problems.push(`${name}: state ${state}, expected ${expect} (${tag})`);
  if (turn) {
    const box = await page.locator('#stage').boundingBox();
    // OrbitControls turns 2π per canvas height of drag: a quarter of the height is a quarter turn.
    const dx = (box.height / 4) * turn;
    const y = box.y + box.height * 0.55;
    const x0 = box.x + box.width / 2 - dx / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + (dx * i) / 20, y);
    await page.mouse.up();
  }
  await page.waitForTimeout(turn ? 1500 : 700);
  const file = join(outDir, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 180_000, ...(clip ? { clip } : {}) });
    renders.push({ name, query, state, tag });
  } catch (e) {
    problems.push(`${name}: screenshot ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  await page.close();
}

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
  for (const [size, b] of Object.entries(SIZES)) {
    const body = { family: 'male', ...b };
    await shot(phone, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `body-${size}--front`);
    await shot(phone, q({ mode: 'head', frame: 'body', ...body, yaw: 90 }), `body-${size}--side`);
    await shot(phone, q({ product: TEE, size, ...body }), `tee-${size}--front`);
    await shot(phone, q({ product: TEE, size, ...body }), `tee-${size}--side`, { turn: 1 });
  }
  // Close-ups at 3×: head and shoulders, and the torso (where the earlier report saw a boxy torso and a ledge).
  const close = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 3 });
  const torso = { x: 45, y: 90, width: 300, height: 330 };
  for (const size of ['S', 'M', 'XXL']) {
    const body = { family: 'male', ...SIZES[size] };
    await shot(close, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `close-body-${size}--torso-front`, { clip: torso });
    await shot(close, q({ mode: 'head', frame: 'body', ...body, yaw: 90 }), `close-body-${size}--torso-side`, { clip: torso });
    await shot(close, q({ mode: 'head', frame: 'body', ...body, yaw: 35 }), `close-body-${size}--torso-three-quarter`, { clip: torso });
    await shot(close, q({ product: TEE, size, ...body }), `close-tee-${size}--torso-front`, { clip: torso });
    await shot(close, q({ product: TEE, size, ...body }), `close-tee-${size}--torso-side`, { clip: torso, turn: 1 });
  }
  await shot(close, q({ mode: 'head', family: 'male', yaw: 0 }), `close-head-M--front`);
  await shot(close, q({ mode: 'head', family: 'male', yaw: 90 }), `close-head-M--side`);
  // The female body next to the male M, same page and camera, for comparison.
  await shot(phone, q({ mode: 'head', frame: 'body', family: 'female', yaw: 0 }), `compare-female-M--front`);
  await shot(phone, q({ mode: 'head', frame: 'body', family: 'female', yaw: 90 }), `compare-female-M--side`);
  // Strict family check: a female-built bundle on the male body, and the male tee on the female body, are refused.
  if (existsSync(join(bundles, 'eval', 'azure-palm-baby-doll-dress', 'payload.json'))) {
    await shot(phone, q({ product: 'eval/azure-palm-baby-doll-dress', family: 'male', ...SIZES.M }), `refused--female-dress-on-male-body`, { expect: 'error' });
  }
  await shot(phone, q({ product: TEE, family: 'female', height: 168 }), `refused--male-tee-on-female-body`, { expect: 'error' });
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(outDir, 'renders.json'), JSON.stringify({ renderer: 'headless Chromium, SwiftShader (software)', renders, problems }, null, 2));
console.log(`${renders.length} pictures and renders.json in ${outDir}`);
for (const p of problems) console.error(`problem: ${p}`);
process.exit(problems.length ? 1 : 0);
