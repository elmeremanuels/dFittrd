/* global process, console, document */
/**
 * Before/after grids of the skin review (branch claude/skin-v2, D22 point 3): skin shading `flat`
 * (today) against `skin-v2`, from the pictures of skin-v2-renders.mjs and, when present in the same
 * folder, the 2D figures of apps/web/scripts/skin-2d-shots.mjs. One labelled PNG per grid, laid out
 * in headless Chromium; close-ups are cut from the 2x pictures with a CSS crop.
 *
 *   node spikes/garment-engine/viewer/skin-v2-grid.mjs <folder with the pictures> [out folder]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const src = resolve(process.argv[2] ?? '');
const out = resolve(process.argv[3] ?? join(src, 'grids'));
mkdirSync(out, { recursive: true });

const TONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SHADINGS = [['flat', 'flat (today)'], ['skin-v2', 'skin-v2']];
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** A cell: the picture at width `w`, or a crop of it (`crop`: [x, y, width, height] in the picture's own pixels). */
function cell(f, w, crop) {
  if (!f || !existsSync(join(src, f))) return `<div class="missing" style="width:${w}px">not rendered</div>`;
  const url = pathToFileURL(join(src, f)).href;
  if (!crop) return `<img src="${url}" style="width:${w}px;display:block">`;
  const [x, y, cw, ch] = crop, k = w / cw;
  return `<div style="width:${w}px;height:${Math.round(ch * k)}px;overflow:hidden;position:relative"><img src="${url}" style="position:absolute;left:${-x * k}px;top:${-y * k}px;transform-origin:0 0;transform:scale(${k});image-rendering:auto"></div>`;
}
function page(title, note, columns, rows, w, crop) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#fff;font:13px/1.35 system-ui,sans-serif;color:#1a1612}
    h1{font-size:17px;margin:0 0 4px} p{margin:0 0 10px;color:#5a524a;max-width:${(columns.length + 1) * w}px}
    table{border-collapse:collapse} td,th{padding:3px;vertical-align:top;text-align:center}
    th{font-weight:600;font-size:12px} td.l{font-weight:600;text-align:right;vertical-align:middle;white-space:nowrap;padding-right:8px}
    .missing{height:${w}px;display:flex;align-items:center;justify-content:center;background:#eee;color:#888}
  </style></head><body><h1>${esc(title)}</h1><p>${esc(note)}</p><table><tr><th></th>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
  ${rows.map(([label, ...files]) => `<tr><td class="l">${esc(label)}</td>${files.map((f) => `<td>${cell(f, w, crop)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
}

const NOTE = 'ESTIMATE renders, headless Chromium on SwiftShader (software), not a phone. Every 3D picture keeps its own ESTIMATE tag. Head neutral-v3.';
const NOTE2D = 'The 2D figure of the embed (AvatarView, 240 x 432 CSS px at 2x, headless Chromium). Every figure keeps its "Estimate · not measured" badge.';
const cols = TONES.map((n) => `Monk ${n}`);
const grids = [];
for (const family of ['female', 'male']) {
  for (const lighting of ['classic', 'neutral-v2']) {
    for (const view of ['front', 'three-quarter']) {
      grids.push([`faces-${family}-${lighting}-${view}`, page(`Head close up, ${view}: ${family}, lighting ${lighting}, flat against skin-v2`, NOTE, cols, SHADINGS.map(([s, l]) => [l, ...TONES.map((n) => `face--${family}--${view}--monk${n}--${lighting}--${s}.png`)]), 160)]);
      grids.push([`bodies-${family}-${lighting}-${view}`, page(`Body alone, ${view}: ${family}, lighting ${lighting}, flat against skin-v2`, NOTE, cols, SHADINGS.map(([s, l]) => [l, ...TONES.map((n) => `body--${family}--${view}--monk${n}--${lighting}--${s}.png`)]), 150)]);
    }
    const product = family === 'female' ? 'aalter-studio-2' : 'synthetic-men-tee';
    grids.push([`phone-${family}-${lighting}`, page(`At phone size in the mount (390 x 760 CSS px at 2x): ${family}, synthetic ${family === 'female' ? 'dress' : 'tee'}, lighting ${lighting}`, NOTE, cols, SHADINGS.map(([s, l]) => [l, ...TONES.map((n) => `phone--${family}--${product}--monk${n}--${lighting}--${s}.png`)]), 150)]);
    // Close-ups: the three-quarter head at its own 2x resolution (the shadow edge), Monk 1, 3, 6, 8, 10.
    const few = [1, 3, 6, 8, 10];
    grids.push([`closeup-terminator-${family}-${lighting}`, page(`Close-up of the shadow edge (three-quarter head, 2x pixels): ${family}, lighting ${lighting}`, `${NOTE} Cut from the face pictures.`, few.map((n) => `Monk ${n}`), SHADINGS.map(([s, l]) => [l, ...few.map((n) => `face--${family}--three-quarter--monk${n}--${lighting}--${s}.png`)]), 300, [150, 200, 560, 640])]);
    grids.push([`closeup-phone-${family}-${lighting}`, page(`Close-up at phone size (head and shoulders cut from the phone picture, 2x pixels): ${family}, lighting ${lighting}`, NOTE, few.map((n) => `Monk ${n}`), SHADINGS.map(([s, l]) => [l, ...few.map((n) => `phone--${family}--${product}--monk${n}--${lighting}--${s}.png`)]), 260, [220, 120, 340, 340])]);
  }
  grids.push([`figure2d-${family}`, page(`2D figure: ${family}, flat against skin-v2`, NOTE2D, cols, SHADINGS.map(([s, l]) => [l, ...TONES.map((n) => `figure2d--${family}--monk${n}--${s}.png`)]), 140)]);
  grids.push([`closeup-figure2d-${family}`, page(`2D figure close-up (head and shoulders, 2x pixels): ${family}`, NOTE2D, cols, SHADINGS.map(([s, l]) => [l, ...TONES.map((n) => `figure2d--${family}--monk${n}--${s}.png`)]), 150, [150, 30, 180, 240])]);
}
grids.push(['figure2d-dress-female', page('2D figure with the synthetic dress: female, flat against skin-v2', NOTE2D, cols, SHADINGS.map(([s, l]) => [l, ...TONES.map((n) => `figure2d-dress--female--monk${n}--${s}.png`)]), 140)]);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  for (const [name, html] of grids) {
    const p = await ctx.newPage();
    const file = join(out, `${name}.html`);
    writeFileSync(file, html);
    await p.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    const width = await p.evaluate(() => document.body.scrollWidth);
    await p.setViewportSize({ width: Math.max(600, width), height: 800 });
    await p.screenshot({ path: join(out, `${name}.png`), fullPage: true });
    await p.close();
    rmSync(file);
  }
} finally {
  await browser.close();
}
console.log(`${grids.length} grids in ${out}`);
