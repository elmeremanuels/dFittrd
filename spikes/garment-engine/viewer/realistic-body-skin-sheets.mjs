/* global process, console */
/**
 * One sheet per skin tone from the pictures of `realistic-body-skin-renders.mjs`: per test body a row of before and after,
 * body alone front and three-quarter (same camera per pair), then a row with the mid body in the dress (front and
 * three-quarter) and the upper-body close-up, before and after. Pictures drawn at half size. Composed in headless
 * Chromium (an HTML page of the PNGs, screenshotted), so no image library is needed.
 *
 *   node spikes/garment-engine/viewer/realistic-body-skin-sheets.mjs <dir with the renders>
 *
 * Writes `<tone>-sheet.png` into the same directory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const prevAt = argv.indexOf('--prev');
const prevDir = prevAt >= 0 && argv[prevAt + 1] ? resolve(argv[prevAt + 1]) : null;
const posArgs = argv.filter((a, i) => !a.startsWith('--') && !(prevAt >= 0 && i === prevAt + 1));
const dir = resolve(posArgs[0] ?? '');
if (!posArgs[0]) {
  console.error('usage: node realistic-body-skin-sheets.mjs <dir> [--prev <prevDir>]');
  process.exit(1);
}
const TONES = { light: 'Monk 2 #f3e7db', medium: 'Monk 6 #a07e56', deep: 'Monk 9 #3a312a' };
const BODIES = ['slim', 'mid', 'full', 'tall', 'petite'];
const W = 195, H = 422;
const chromePath = [process.env.CHROME_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
const page = await browser.newPage({ viewport: { width: 6 * W + 7 * 10 + 140, height: 800 }, deviceScaleFactor: 1 });
for (const [tone, label] of Object.entries(TONES)) {
  const cell = (name, caption) => {
    const f = join(dir, `${tone}-${name}.png`);
    if (!existsSync(f)) return '';
    return `<figure><figcaption>${caption}</figcaption><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"></figure>`;
  };
  const rows = BODIES.map((b) => [
    b,
    [
      cell(`${b}-body-before--front`, 'Before · front'),
      cell(`${b}-body-after--front`, 'After · front'),
      cell(`${b}-body-before--three-quarter`, 'Before · ¾'),
      cell(`${b}-body-after--three-quarter`, 'After · ¾'),
    ],
  ]);
  rows.push([
    'mid, dress and close-up',
    [
      cell('mid-dress-before--front', 'Before · dress · front'),
      cell('mid-dress-after--front', 'After · dress · front'),
      cell('mid-dress-before--three-quarter', 'Before · dress · ¾'),
      cell('mid-dress-after--three-quarter', 'After · dress · ¾'),
      cell('mid-upper-before', 'Before · upper body'),
      cell('mid-upper-after', 'After · upper body'),
    ],
  ]);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a1612;font:600 14px system-ui;color:#f5efe7">
    <div style="padding:10px 12px 0;font-size:16px">ESTIMATE · realistic body, procedural skin and studio light · ${tone} (${label}) · before: the realistic body as today (flat material in the tone, classic light) · after: procedural skin + studio light · headless Chromium (SwiftShader), 390 × 844 CSS px at 2×, shown at half size, same camera per pair</div>
    ${rows.map(([name, cells]) => `<div style="display:flex;gap:10px;padding:6px 12px 2px;align-items:flex-start"><div style="width:130px;padding-top:30px">${name}</div>${cells.join('')}</div>`).join('')}
    <style>figure{margin:0;width:${W}px}figcaption{padding:2px 0 4px;min-height:20px}img{width:${W}px;height:${H}px;display:block}</style></body></html>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: join(dir, `${tone}-sheet.png`), fullPage: true });
}
if (prevDir) {
  const cellFrom = (base, file, caption) => {
    const f = join(base, `${file}.png`);
    if (!existsSync(f)) return '';
    return `<figure><figcaption>${caption}</figcaption><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"></figure>`;
  };
  const cmpRows = Object.entries(TONES).map(([tone, label]) => [
    `${tone}<br><span style="font-weight:400;font-size:12px;opacity:.8">${label}</span>`,
    [
      cellFrom(prevDir, `${tone}-mid-upper-after`, 'v1 (oud) · close-up'),
      cellFrom(dir, `${tone}-mid-upper-after`, 'v3 (nieuw) · close-up'),
      cellFrom(prevDir, `${tone}-mid-body-after--front`, 'v1 (oud) · mid front'),
      cellFrom(dir, `${tone}-mid-body-after--front`, 'v3 (nieuw) · mid front'),
      cellFrom(prevDir, `${tone}-mid-body-after--three-quarter`, 'v1 (oud) · mid ¾'),
      cellFrom(dir, `${tone}-mid-body-after--three-quarter`, 'v3 (nieuw) · mid ¾'),
    ],
  ]);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a1612;font:600 14px system-ui;color:#f5efe7">
    <div style="padding:10px 12px 0;font-size:16px">ESTIMATE · procedural skin v1 (old, claude/realistic-body) vs v3 (new, google/wo-002-skin-v3) · matte skin & soft studio light · headless Chromium (SwiftShader)</div>
    ${cmpRows.map(([name, cells]) => `<div style="display:flex;gap:10px;padding:6px 12px 2px;align-items:flex-start"><div style="width:130px;padding-top:30px">${name}</div>${cells.join('')}</div>`).join('')}
    <style>figure{margin:0;width:${W}px}figcaption{padding:2px 0 4px;min-height:20px}img{width:${W}px;height:${H}px;display:block}</style></body></html>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: join(dir, 'v1-vs-v3-sheet.png'), fullPage: true });
}
await browser.close();
console.log(`sheets in ${dir}`);
