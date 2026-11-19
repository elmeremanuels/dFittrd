/* global process, console, document */
/**
 * Before/after grids of head v3's hair under skin-v2 (branch claude/skin-v2): rows flat (today),
 * skin-v2 before the hair got its own terms, and skin-v2 after; from two folders of pictures by
 * skin-v2-renders.mjs. Close-ups are cut from the 2x pictures with a CSS crop.
 *
 *   node spikes/garment-engine/viewer/skin-v2-hair-grid.mjs <before folder> <after folder> <out folder>
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [before, after, out] = process.argv.slice(2).map((p) => resolve(p));
if (!before || !after || !out) {
  console.error('usage: node skin-v2-hair-grid.mjs <before folder> <after folder> <out folder>');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function cell(dir, f, w, crop) {
  const p = join(dir, f);
  if (!existsSync(p)) return `<div style="width:${w}px;height:${w}px;background:#eee;color:#888;display:flex;align-items:center;justify-content:center">not rendered</div>`;
  const url = pathToFileURL(p).href;
  if (!crop) return `<img src="${url}" style="width:${w}px;display:block">`;
  const [x, y, cw, ch] = crop, k = w / cw;
  return `<div style="width:${w}px;height:${Math.round(ch * k)}px;overflow:hidden;position:relative"><img src="${url}" style="position:absolute;left:${-x * k}px;top:${-y * k}px;transform-origin:0 0;transform:scale(${k})"></div>`;
}
function page(title, tones, file, w, crop) {
  const rows = [['flat (today)', after, 'flat'], ['skin-v2, hair shared the skin terms', before, 'skin-v2'], ['skin-v2, hair with its own terms', after, 'skin-v2']];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#fff;font:13px/1.35 system-ui,sans-serif;color:#1a1612}
    h1{font-size:17px;margin:0 0 4px} p{margin:0 0 10px;color:#5a524a}
    table{border-collapse:collapse} td,th{padding:3px;vertical-align:top;text-align:center}
    th{font-weight:600;font-size:12px} td.l{font-weight:600;text-align:right;vertical-align:middle;white-space:nowrap;padding-right:8px}
  </style></head><body><h1>${esc(title)}</h1><p>ESTIMATE renders, headless Chromium on SwiftShader (software), not a phone. Every picture keeps its own ESTIMATE tag. Head neutral-v3.</p>
  <table><tr><th></th>${tones.map((n) => `<th>Monk ${n}</th>`).join('')}</tr>
  ${rows.map(([label, dir, s]) => `<tr><td class="l">${esc(label)}</td>${tones.map((n) => `<td>${cell(dir, file(n, s), w, crop)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
}

const grids = [];
for (const family of ['female', 'male']) {
  for (const lighting of ['classic', 'neutral-v2']) {
    grids.push([`hair-faces-${family}-${lighting}`, page(`Head v3's hair under skin-v2, three-quarter close-up: ${family}, lighting ${lighting}`, [1, 3, 6, 8, 9, 10], (n, s) => `face--${family}--three-quarter--monk${n}--${lighting}--${s}.png`, 230, [100, 90, 640, 560])]);
    const product = family === 'female' ? 'aalter-studio-2' : 'synthetic-men-tee';
    grids.push([`hair-phone-${family}-${lighting}`, page(`Head v3's hair under skin-v2 at phone size (head cut from the 390 x 760 picture, 2x pixels): ${family}, lighting ${lighting}`, [6, 8, 9, 10], (n, s) => `phone--${family}--${product}--monk${n}--${lighting}--${s}.png`, 240, [240, 140, 300, 260])]);
  }
}
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1 });
  for (const [name, html] of grids) {
    const p = await ctx.newPage();
    const file = join(out, `${name}.html`);
    writeFileSync(file, html);
    await p.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    const width = await p.evaluate(() => document.body.scrollWidth);
    await p.setViewportSize({ width: Math.max(600, width), height: 600 });
    await p.screenshot({ path: join(out, `${name}.png`), fullPage: true });
    await p.close();
    rmSync(file);
  }
} finally {
  await browser.close();
}
console.log(`${grids.length} grids in ${out}`);
