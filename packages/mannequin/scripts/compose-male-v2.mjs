/* global process, console, document */
/**
 * Lays the panels of `render-male-v2.ts` out at phone size (390 × 844 CSS px at 2×, headless
 * Chromium through the preinstalled Playwright): one picture per size and view with v1 (left) and
 * v2 (right) at 390 × 844; one sheet per view with all sizes and close-ups of the M's shoulders and
 * seat at 390 px wide, as tall as their content.
 *
 *   node packages/mannequin/scripts/compose-male-v2.mjs <panels dir> <out dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [src, dst] = process.argv.slice(2).map((p) => resolve(p));
if (!src || !dst) {
  console.error('usage: compose-male-v2.mjs <panels dir> <out dir>');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
const meta = JSON.parse(readFileSync(join(src, 'panels.json'), 'utf8'));
const sizes = [...new Set(meta.panels.map((p) => p.size))];
const views = [...new Set(meta.panels.map((p) => p.view))];
const url = (f) => pathToFileURL(join(src, f)).href;
const css = `
  :root { --coral: #FF5A3C; --cream: #F5EFE7; --ink: #1A1612; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--cream); color: var(--ink); font: 13px/1.35 Inter, system-ui, sans-serif; padding: 14px 16px; }
  h1 { font: 600 19px/1.2 Fraunces, Georgia, serif; margin-bottom: 2px; }
  .sub { color: #5c534b; font-size: 12px; margin-bottom: 8px; }
  .tag { display: inline-block; background: var(--ink); color: var(--cream); font-size: 10px; letter-spacing: .04em; padding: 2px 6px; border-radius: 3px; margin-bottom: 8px; }
  .row { display: grid; gap: 4px; }
  figure { text-align: center; }
  figure img { width: 100%; display: block; }
  figcaption { font-weight: 600; font-size: 12px; margin-top: 2px; }
  figcaption.new { color: var(--coral); }
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><h1>${title}</h1><div class="sub">${sub}</div><div class="tag">ESTIMATE · procedural body, not a person</div>${body}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const shots = [];
async function snap(name, html, fit = false) {
  const file = join(dst, `${name}.png`);
  const htmlFile = join(src, `${name}.html`);
  writeFileSync(htmlFile, html);
  await p.goto(pathToFileURL(htmlFile).href);
  await p.waitForLoadState('load');
  if (fit) await p.setViewportSize({ width: 390, height: Math.ceil(await p.evaluate(() => document.body.scrollHeight)) + 14 });
  await p.screenshot({ path: file, fullPage: false });
  if (fit) await p.setViewportSize({ width: 390, height: 844 });
  shots.push(name);
}
const crop = (f, view, box) => `<div style="overflow:hidden;aspect-ratio:${box.w}/${box.h}"><img style="width:${(100 * meta.widthCm) / box.w}%;margin-left:-${(100 * box.x) / box.w}%;margin-top:-${(100 * box.y) / box.w}%" src="${url(f)}"></div>`;
// One size, one view: v1 | v2, the whole body.
let n = 10;
for (const view of views) {
  for (const size of sizes) {
    const fig = (v) => `<figure>${crop(`${size}-${v}-${view}.png`, view, { x: 10, y: 0, w: 90, h: 190 })}<figcaption class="${v === 'v2' ? 'new' : ''}">${v === 'v1' ? 'v1 (default, ellipses)' : 'v2 (maleShape: v2)'}</figcaption></figure>`;
    await snap(`${n}-${size}-${view}-v1-vs-v2`, page(`Male ${size}, ${view}`, 'Same table girths at every ring (within 0.5 %). Left: today; right: shape v2.', `<div class="row" style="grid-template-columns:1fr 1fr">${fig('v1')}${fig('v2')}</div>`));
  }
  n++;
}
// One view, all sizes, torso close-up: v1 row above, v2 row below.
for (const view of views) {
  const cells = (v) => sizes.map((s) => `<figure>${crop(`${s}-${v}-${view}.png`, view, { x: 30, y: 30, w: 50, h: 80 })}<figcaption class="${v === 'v2' ? 'new' : ''}">${s}</figcaption></figure>`).join('');
  await snap(`${n}-torso-${view}-S-to-XXL`, page(`Torso, ${view}, S to XXL`, 'Top row v1 (default), bottom row v2. Shoulder line to mid thigh.', `<div class="row" style="grid-template-columns:repeat(${sizes.length},1fr)">${cells('v1')}</div><div style="height:10px"></div><div class="row" style="grid-template-columns:repeat(${sizes.length},1fr)">${cells('v2')}</div>`), true);
  n++;
}
// Close-ups of M: shoulders and crotch, every view.
for (const [label, box] of [['shoulders', { x: 30, y: 25, w: 50, h: 34 }], ['seat-and-crotch', { x: 35, y: 82, w: 40, h: 30 }]]) {
  const cells = (v) => views.map((view) => `<figure>${crop(`M-${v}-${view}.png`, view, box)}<figcaption class="${v === 'v2' ? 'new' : ''}">${v} ${view}</figcaption></figure>`).join('');
  await snap(`${n}-M-${label}-close-up`, page(`Male M, ${label.replace(/-/g, ' ')}`, 'Left column v1, right column v2.', `<div class="row" style="grid-template-columns:1fr 1fr">${views.map((view) => [ 'v1', 'v2' ].map((v) => `<figure>${crop(`M-${v}-${view}.png`, view, box)}<figcaption class="${v === 'v2' ? 'new' : ''}">${v} ${view}</figcaption></figure>`).join('')).join('')}</div>`), true);
  void cells;
  n++;
}
await browser.close();
console.log(`${shots.length} pictures → ${dst}`);
