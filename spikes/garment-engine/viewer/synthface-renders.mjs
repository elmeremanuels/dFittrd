/* global process, console, document, URL */
/**
 * Render the synthetic test faces of the face-on-head spike (`synthface.html`; not photos of anybody)
 * into a folder, default `apps/web/e2e/fixtures/synthetic-faces/`:
 *   node spikes/garment-engine/viewer/synthface-renders.mjs [<out dir>]
 * Writes `person-{a,b,c}.jpg` (warm side light), `person-{a,b,c}-even.jpg` (even light) and
 * `person-b-yaw25.jpg` (head turned 25°), 720 x 900, JPEG quality 92. Vite dev
 * server, headless Chromium with SwiftShader.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.argv[2] ?? join(here, '..', '..', '..', 'apps', 'web', 'e2e', 'fixtures', 'synthetic-faces'));
mkdirSync(out, { recursive: true });
const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5193, strictPort: false, hmr: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
page.on('pageerror', (e) => {
  console.error(e);
  process.exitCode = 1;
});
const shots = [
  ...['a', 'b', 'c'].map((p) => [`person-${p}.jpg`, `person=${p}`]),
  ...['a', 'b', 'c'].map((p) => [`person-${p}-even.jpg`, `person=${p}&light=even`]),
  ['person-b-yaw25.jpg', 'person=b&yaw=25'],
];
for (const [file, q] of shots) {
  await page.goto(`${base}synthface.html?${q}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60_000 });
  await page.locator('#stage').screenshot({ path: join(out, file), type: 'jpeg', quality: 92 });
  console.log('wrote', join(out, file));
}
await browser.close();
await server.close();
