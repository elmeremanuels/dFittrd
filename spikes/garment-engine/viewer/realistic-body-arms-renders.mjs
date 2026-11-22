/* global process, console, document, URL, URLSearchParams */
/**
 * WO-001 pictures: the realistic body with its procedural skin and the realistic hair, body alone, front, for the five
 * test bodies, through `avatar.html` (headless Chromium with SwiftShader). Run once on the old fit and once on the new
 * one, then `realistic-body-arms-sheet.mjs` puts them side by side.
 *
 *   node spikes/garment-engine/viewer/realistic-body-arms-renders.mjs <out dir> <before|after>
 *
 * Writes `<body>-<label>.png` (full body, front, 760 × 900 CSS px so the hands are in it) and `<body>-<label>-hair.png` (head to waist, three-quarter: the hair on
 * the skinned body). Every picture carries the page's ESTIMATE tag.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const [outArg, label] = process.argv.slice(2);
if (!outArg || !label) {
  console.error('usage: node realistic-body-arms-renders.mjs <out dir> <before|after>');
  process.exit(1);
}
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const BODIES = {
  slim: { height: 164, bust: 80, waist: 62, hip: 88 },
  mid: { height: 168, bust: 92, waist: 74, hip: 100 },
  full: { height: 170, bust: 116, waist: 98, hip: 122 },
  tall: { height: 182, bust: 92, waist: 74, hip: 100 },
  petite: { height: 152, bust: 84, waist: 66, hip: 92 },
};
const LOOK = { body: 'realistic', skinlook: 'procedural', skin: 'a07e56', hair: '2B', hairLength: 'shoulder', hairColour: 'dark-brown', render: 'demand' };
const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5187, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// Wide enough for the hands in the full-body picture; phone width for the hair close-up.
const wide = await browser.newContext({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 2 });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const problems = [];
async function shot(context, query, name) {
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  await page.goto(`${base}avatar.html?${query}`);
  await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: 300_000 });
  await page.waitForFunction(() => !['loading', undefined].includes(document.getElementById('stage').dataset.hair), null, { timeout: 120_000 }).catch(() => problems.push(`${name}: hair not settled`));
  await page.waitForTimeout(2500);
  const tag = await page.textContent('#tag');
  if (!/hair 2B-shoulder/.test(tag ?? '')) problems.push(`${name}: tag ${tag}`);
  await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 180_000 });
  await page.close();
}
for (const [name, b] of Object.entries(BODIES)) {
  await shot(wide, q({ mode: 'head', frame: 'body', ...b, ...LOOK }), `${name}-${label}`);
  await shot(phone, q({ mode: 'head', frame: 'hair', yaw: 35, ...b, ...LOOK }), `${name}-${label}-hair`);
  console.log('done', name);
}
await browser.close();
await server.close();
if (problems.length) console.log('PROBLEMS\n' + problems.join('\n'));
