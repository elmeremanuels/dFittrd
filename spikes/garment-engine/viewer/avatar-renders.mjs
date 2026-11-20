/* global process, console, document, window, URL */
/**
 * Renders and measurements for the avatar look (plan slices 1 and 2), through `avatar.html`, which
 * mounts the shipped viewer (`packages/garment-viewer`): the founder approves the lighting change
 * from these pictures. Same approach as smoke.mjs: Vite dev server, headless Chromium with
 * SwiftShader (a software renderer, not a phone).
 *
 *   node spikes/garment-engine/viewer/avatar-renders.mjs <out dir> [eval/<id> …] [--match <text>]
 *
 * Per product (default: the pilot skirt and the azure dress, from `out/eval/`), per skin tone
 * (Monk 2, 6 and 9, and the default grey) and per lighting (`classic`, `neutral`): one phone-sized
 * picture (390 × 760 CSS px at 2×), and the colour of bare-skin patches against the requested
 * colour as CIEDE2000 and CIE76 ΔE. Then the neutral head alone, both families, three angles, and
 * a typed body. Writes PNGs and `measurements.json` to the out dir. Every picture carries the
 * page's ESTIMATE tag.
 *
 * Uses the preinstalled Playwright (`require('playwright')`), not a dependency of the package.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { deltaE2000, deltaE76, labOf } from './colour.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const bundles = resolve(here, '..', 'out');
const argv = process.argv.slice(2);
const matchAt = argv.indexOf('--match');
/** `--match <text>`: only the pictures whose name contains the text. */
const match = matchAt >= 0 ? (argv[matchAt + 1] ?? '') : '';
const args = argv.filter((a, i) => !(matchAt >= 0 && (i === matchAt || i === matchAt + 1)));
if (!args[0]) {
  console.error('usage: node avatar-renders.mjs <out dir> [eval/<id> …]');
  process.exit(1);
}
const outDir = resolve(args[0]);
const products = (args.length > 1 ? args.slice(1) : ['eval/crimson-wildflower-maxi-skirt', 'eval/azure-palm-baby-doll-dress']).filter((p) => existsSync(join(bundles, p, 'grading.json')));
if (products.length === 0) {
  console.error('No evaluated bundles in out/eval/ (see the spike README, report:bohohippychic).');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/** Monk Skin Tone scale swatches 2, 6 and 9 (the values of `MONK_SWATCHES` in apps/web capture). */
export const TONES = { light: 'f3e7db', medium: 'a07e56', deep: '3a312a' };
const LIGHTINGS = ['classic', 'neutral'];

const rgbOfHex = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const r1 = (v) => Math.round(v * 10) / 10;

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5183, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const measurements = [];
const files = [];

async function shot(context, query, name, { measure = null, clipHead = false } = {}) {
  if (match && !name.includes(match)) return;
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name}: console ${msg.text()}`);
  });
  await page.goto(`${base}avatar.html?${query}`);
  await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: 240_000 });
  const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
  if (state === 'error') problems.push(`${name}: ${await page.textContent('#tag')}`);
  await page.waitForTimeout(700);
  const file = join(outDir, `${name}.png`);
  if (clipHead && state !== 'error') {
    // Head and shoulders, cut out round the point the mount reports for the head (`view.toScreen('head')`).
    const at = await page.evaluate(() => window.avatarCheck.view.toScreen('head'));
    await page.screenshot({ path: file, clip: { x: Math.max(0, at.x - 95), y: Math.max(0, at.y - 60), width: 190, height: 170 } });
  } else await page.screenshot({ path: file });
  files.push(file);
  if (measure && state !== 'error') {
    const patches = await page.evaluate(() => window.avatarCheck.patches());
    const want = labOf(rgbOfHex(measure.hex));
    for (const [patch, p] of Object.entries(patches)) {
      const got = labOf(p.rgb);
      measurements.push({ ...measure.meta, patch, requested: `#${measure.hex}`, rendered: `#${p.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`, dE2000: r1(deltaE2000(want, got)), dE76: r1(deltaE76(want, got)), dL: r1(got[0] - want[0]), da: r1(got[1] - want[1]), db: r1(got[2] - want[2]), at: [Math.round(p.x), Math.round(p.y)] });
    }
  }
  await page.close();
}

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
  for (const product of products) {
    const id = product.replace(/^eval\//, '');
    for (const lighting of LIGHTINGS) {
      await shot(phone, `product=${product}&lighting=${lighting}`, `${id}--grey--${lighting}`, { measure: { hex: '8c8c8c', meta: { product: id, tone: 'grey', lighting } } });
      for (const [tone, hex] of Object.entries(TONES)) await shot(phone, `product=${product}&lighting=${lighting}&skin=${hex}`, `${id}--${tone}--${lighting}`, { measure: { hex, meta: { product: id, tone, lighting } } });
    }
    await shot(phone, `product=${product}&head=egg`, `${id}--grey--classic--egg-head`);
  }
  // The neutral head alone: both families, three angles, in the default grey and in a medium tone.
  const close = await browser.newContext({ viewport: { width: 420, height: 480 }, deviceScaleFactor: 2 });
  for (const family of ['female', 'male']) {
    for (const yaw of [0, 40, 90]) {
      await shot(close, `mode=head&family=${family}&yaw=${yaw}`, `head--${family}--yaw${yaw}--grey--classic`);
      await shot(close, `mode=head&family=${family}&yaw=${yaw}&skin=${TONES.medium}&lighting=neutral`, `head--${family}--yaw${yaw}--medium--neutral`);
    }
    await shot(phone, `mode=head&frame=body&family=${family}&skin=${TONES.medium}&lighting=neutral`, `body--${family}--medium--neutral`);
    await shot(phone, `mode=head&frame=body&family=${family}`, `body--${family}--grey--classic`);
  }
  // A typed body through the mount: 182 cm tall with 40 cm shoulders, against the default body.
  await shot(phone, `product=${products[0]}&height=182&shoulder=40&skin=${TONES.medium}&lighting=neutral`, `typed-body--182cm--${products[0].replace(/^eval\//, '')}`);
  // The neck under the neutral head on large and short bodies (head and shoulders at 4×), and the widest body whole.
  const dress = products[1] ?? products[0];
  const closeUp = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 4 });
  const BIG = 'bust=150&waist=140&hip=160';
  for (const [name, q] of [['default', ''], ['girths-150-140-160', `&${BIG}`], ['girths-150-140-160--150cm', `&${BIG}&height=150`], ['130cm', '&height=130'], ['girths-150-140-160--220cm', `&${BIG}&height=220`]]) await shot(closeUp, `product=${dress}${q}`, `neck--${name}`, { clipHead: true });
  await shot(phone, `product=${dress}&${BIG}`, `neck-body--girths-150-140-160`);
  await shot(phone, `product=${dress}&${BIG}&height=150&skin=${TONES.medium}&lighting=neutral`, `neck-body--girths-150-140-160--150cm--medium--neutral`);
  if (products[1]) await shot(phone, `product=${products[1]}&height=156&skin=${TONES.medium}&lighting=neutral`, `typed-body--156cm--${products[1].replace(/^eval\//, '')}`);
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(outDir, 'measurements.json'), JSON.stringify({ renderer: 'headless Chromium, SwiftShader (software)', tones: TONES, measurements, problems }, null, 2));
console.log(`${files.length} pictures and measurements.json in ${outDir}`);
for (const p of problems) console.error(`problem: ${p}`);
process.exit(problems.length ? 1 : 0);
