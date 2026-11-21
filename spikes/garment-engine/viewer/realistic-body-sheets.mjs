/* global process, console */
/**
 * One side-by-side sheet per test body from the pictures of `realistic-body-renders.mjs`: before and after, body alone
 * front and three-quarter, and in the dress, same camera. Composed in headless Chromium (an HTML page of the PNGs,
 * screenshotted), so no image library is needed.
 *
 *   node spikes/garment-engine/viewer/realistic-body-sheets.mjs <dir with the renders>
 *
 * Writes `<body>-sheet.png` into the same directory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node realistic-body-sheets.mjs <dir>');
  process.exit(1);
}
const BODIES = ['slim', 'mid', 'full', 'tall', 'petite'];
const COLUMNS = [
  ['body-before--front', 'Before · body · front'],
  ['body-after--front', 'After · body · front'],
  ['body-before--three-quarter', 'Before · body · ¾'],
  ['body-after--three-quarter', 'After · body · ¾'],
  ['dress-before--front', 'Before · dress · front'],
  ['dress-after--front', 'After · dress · front'],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 6 * 390 + 7 * 12, height: 844 + 90 }, deviceScaleFactor: 1 });
for (const body of BODIES) {
  const cells = COLUMNS.filter(([name]) => existsSync(join(dir, `${body}-${name}.png`))).map(([name, label]) => {
    const b64 = readFileSync(join(dir, `${body}-${name}.png`)).toString('base64');
    return `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${b64}"></figure>`;
  });
  if (!cells.length) continue;
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a1612;font:600 18px system-ui;color:#f5efe7">
    <div style="padding:10px 12px 0">ESTIMATE · realistic body spike · ${body} · headless Chromium (SwiftShader), 390 × 844 CSS px, same camera per column pair</div>
    <div style="display:flex;gap:12px;padding:8px 12px 12px">${cells.join('')}</div>
    <style>figure{margin:0;width:390px}figcaption{padding:4px 0 6px}img{width:390px;height:844px;display:block}</style></body></html>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: join(dir, `${body}-sheet.png`), fullPage: true });
}
await browser.close();
console.log(`sheets in ${dir}`);
