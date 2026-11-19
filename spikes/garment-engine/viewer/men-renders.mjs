/* global process, console, document, URL, URLSearchParams */
/**
 * Pictures of the male body in the shipped viewer (men-3d-plan slice M1), through `avatar.html`,
 * which mounts `packages/garment-viewer` exactly as the embed does. Same approach as
 * avatar-renders.mjs: Vite dev server, headless Chromium with SwiftShader (a software renderer, not
 * a phone).
 *
 *   node spikes/garment-engine/viewer/men-renders.mjs <out dir> [--match <text>] [--male-shape=v2]
 *
 * `--resume`: skip pictures already in the out dir.
 * `--phone-only`: only the phone-size pictures of the body and the tee per size.
 * `--male-shape=v2`: every male body is the male shape v2 of @curtain/mannequin (`maleShape=v2` on
 * the page); the tee is still the bundle draped on the v1 body. Picture names get a `v2-` prefix.
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
const maleShapeV2 = argv.includes('--male-shape=v2');
/** `--phone-only`: only the phone-size body and tee pictures of every size (no close-ups, comparisons or refusals). */
const phoneOnly = argv.includes('--phone-only');
const args = argv.filter((a, i) => a !== '--male-shape=v2' && a !== '--phone-only' && a !== '--resume' && !(matchAt >= 0 && (i === matchAt || i === matchAt + 1)));
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
/** Wheel ticks out for the full-body pictures (see `shot`). */
const ZOOM = 8;
const q = (o) => new URLSearchParams(Object.entries(maleShapeV2 && o.family === 'male' ? { ...o, maleShape: 'v2' } : o).map(([k, v]) => [k, String(v)])).toString();

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5184, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
class PhoneOnlyDone extends Error {}
const renders = [];

/** A small grey thumbnail of the WebGL canvas (as avatarMain's `patchAt` reads it). */
const thumb = (page) =>
  page.evaluate(() => {
    const src = document.getElementById('stage');
    const c = document.createElement('canvas');
    c.width = 78;
    c.height = 152;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push((d[i] + d[i + 1] + d[i + 2]) / 3);
    return out;
  });

/**
 * Wait until the canvas is still: two thumbnails 800 ms apart differ by under 0.2 grey levels on
 * average (the orbit damping and the drape at rest; exact equality is never reached while the
 * damping decays), at most `maxMs`.
 */
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

/**
 * One picture. `turn`: drag the orbit controls this share of a quarter turn (1 = side view; the
 * garment page has no yaw parameter, the viewer's own controls turn it). The body-alone pages are
 * turned the same way (not with `yaw`), so body and tee pictures are taken at the same angle: the
 * controls damp the turn out over many frames, and the picture waits until the canvas is still, so
 * a quarter of the canvas height of drag is a full 90°. `zoomOut`: wheel ticks of 100 away from the
 * figure first, so the A-pose hands are in the picture at phone width (the shipped mount frames 60 cm
 * across, `stage.frame(60, stature)`, unchanged; the embed's wider 3D panel shows the hands).
 * `clip`: a CSS-px box.
 */
async function shot(context, query, rawName, { turn = 0, zoomOut = 0, clip = null, expect = 'settled' } = {}) {
  const name = maleShapeV2 ? `v2-${rawName}` : rawName;
  if (match && !name.includes(match)) return;
  if (argv.includes('--resume') && existsSync(join(outDir, `${name}.png`))) return;
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
  const box = await page.locator('#stage').boundingBox();
  if (zoomOut) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.55);
    for (let i = 0; i < zoomOut; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(60);
    }
  }
  if (turn) {
    // OrbitControls turns 2π per canvas height of drag: a quarter of the height is a quarter turn.
    const dx = (box.height / 4) * turn;
    const y = box.y + box.height * 0.55;
    const x0 = box.x + box.width / 2 - dx / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + (dx * i) / 20, y);
    await page.mouse.up();
  }
  await page.waitForTimeout(700);
  if (!(await still(page))) problems.push(`${name}: the canvas did not come to rest in 40 s`);
  const file = join(outDir, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 180_000, ...(clip ? { clip } : {}) });
    renders.push({ name, query, state, tag, turn, zoomOut });
  } catch (e) {
    problems.push(`${name}: screenshot ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  await page.close();
}

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
  for (const [size, b] of Object.entries(SIZES)) {
    const body = { family: 'male', ...b };
    await shot(phone, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `body-${size}--front`, { zoomOut: ZOOM });
    await shot(phone, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `body-${size}--side`, { zoomOut: ZOOM, turn: 1 });
    await shot(phone, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `body-${size}--back`, { zoomOut: ZOOM, turn: 2 });
    await shot(phone, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `body-${size}--three-quarter`, { zoomOut: ZOOM, turn: 0.5 });
    await shot(phone, q({ product: TEE, size, ...body }), `tee-${size}--front`, { zoomOut: ZOOM });
    await shot(phone, q({ product: TEE, size, ...body }), `tee-${size}--side`, { zoomOut: ZOOM, turn: 1 });
    await shot(phone, q({ product: TEE, size, ...body }), `tee-${size}--back`, { zoomOut: ZOOM, turn: 2 });
    await shot(phone, q({ product: TEE, size, ...body }), `tee-${size}--three-quarter`, { zoomOut: ZOOM, turn: 0.5 });
  }
  if (phoneOnly) throw new PhoneOnlyDone();
  // Close-ups at 3×: head and shoulders, and the torso (where the earlier report saw a boxy torso and a ledge).
  const close = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 3 });
  const torso = { x: 45, y: 90, width: 300, height: 330 };
  for (const size of ['S', 'M', 'XXL']) {
    const body = { family: 'male', ...SIZES[size] };
    await shot(close, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `close-body-${size}--torso-front`, { clip: torso });
    await shot(close, q({ mode: 'head', frame: 'body', ...body, yaw: 0 }), `close-body-${size}--torso-side`, { clip: torso, turn: 1 });
    await shot(close, q({ mode: 'head', frame: 'body', ...body, yaw: 35 }), `close-body-${size}--torso-three-quarter`, { clip: torso });
  }
  // The tee in every size, where the review saw holes: torso front, side and three-quarter.
  for (const size of Object.keys(SIZES)) {
    const body = { family: 'male', ...SIZES[size] };
    await shot(close, q({ product: TEE, size, ...body }), `close-tee-${size}--torso-front`, { clip: torso });
    await shot(close, q({ product: TEE, size, ...body }), `close-tee-${size}--torso-side`, { clip: torso, turn: 1 });
    await shot(close, q({ product: TEE, size, ...body }), `close-tee-${size}--torso-three-quarter`, { clip: torso, turn: 0.5 });
  }
  await shot(close, q({ mode: 'head', family: 'male', yaw: 0 }), `close-head-M--front`);
  await shot(close, q({ mode: 'head', family: 'male', yaw: 90 }), `close-head-M--side`);
  // The female body next to the male M, same page and camera, for comparison.
  await shot(phone, q({ mode: 'head', frame: 'body', family: 'female', yaw: 0 }), `compare-female-M--front`, { zoomOut: ZOOM });
  await shot(phone, q({ mode: 'head', frame: 'body', family: 'female', yaw: 0 }), `compare-female-M--side`, { zoomOut: ZOOM, turn: 1 });
  // Strict family check: a female-built bundle on the male body, and the male tee on the female body, are refused.
  if (existsSync(join(bundles, 'eval', 'azure-palm-baby-doll-dress', 'payload.json'))) {
    await shot(phone, q({ product: 'eval/azure-palm-baby-doll-dress', family: 'male', ...SIZES.M }), `refused--female-dress-on-male-body`, { expect: 'error' });
  }
  await shot(phone, q({ product: TEE, family: 'female', height: 168 }), `refused--male-tee-on-female-body`, { expect: 'error' });
} catch (e) {
  if (!(e instanceof PhoneOnlyDone)) throw e;
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(outDir, 'renders.json'), JSON.stringify({ renderer: 'headless Chromium, SwiftShader (software)', renders, problems }, null, 2));
console.log(`${renders.length} pictures and renders.json in ${outDir}`);
for (const p of problems) console.error(`problem: ${p}`);
process.exit(problems.length ? 1 : 0);
