/* global process, console, document */
/**
 * Before/after grids of the head review (19 Nov 2026): heads v1, v2 and v3 from the pictures of
 * look-v3-renders.mjs (and, when present, the embed shots of apps/web/e2e/lookV2.spec.ts in the same
 * folder, `LOOK_LABEL` classic-v1, classic-v2, classic-v3, neutral-v2-v3), one labelled PNG per grid,
 * laid out in headless Chromium.
 *
 *   node spikes/garment-engine/viewer/look-v3-grid.mjs <folder with the pictures> [out folder]
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

const TONES = [1, 3, 6, 9, 10];
const HEADS = ['v1', 'v2', 'v3'];
const LABEL = { v1: 'v1 (default)', v2: 'v2', v3: 'v3' };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function page(title, note, columns, rows, w) {
  const cell = (f) => (f && existsSync(join(src, f)) ? `<img src="${pathToFileURL(join(src, f)).href}" style="width:${w}px;display:block">` : `<div class="missing" style="width:${w}px">not rendered</div>`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:#fff;font:13px/1.35 system-ui,sans-serif;color:#1a1612}
    h1{font-size:17px;margin:0 0 4px} p{margin:0 0 10px;color:#5a524a;max-width:${(columns.length + 1) * w}px}
    table{border-collapse:collapse} td,th{padding:3px;vertical-align:top;text-align:center}
    th{font-weight:600;font-size:12px} td.l{font-weight:600;text-align:right;vertical-align:middle;white-space:nowrap;padding-right:8px}
    .missing{height:${w}px;display:flex;align-items:center;justify-content:center;background:#eee;color:#888}
  </style></head><body><h1>${esc(title)}</h1><p>${esc(note)}</p><table><tr><th></th>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
  ${rows.map(([label, ...files]) => `<tr><td class="l">${esc(label)}</td>${files.map((f) => `<td>${cell(f)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
}

const NOTE = 'ESTIMATE renders, headless Chromium on SwiftShader (software), not a phone. Every picture keeps its own ESTIMATE tag.';
const grids = [];
for (const family of ['female', 'male']) {
  for (const lighting of ['classic', 'neutral-v2']) {
    const views = ['front', 'three-quarter', 'side', 'back', 'from-below'];
    grids.push([`heads-${family}-${lighting}-views`, page(`Heads v1, v2, v3: ${family}, default grey, lighting ${lighting}`, NOTE, views, HEADS.map((h) => [LABEL[h], ...views.map((v) => `head--${family}--${h}--${v}--grey-${lighting}.png`)]), 210)]);
    grids.push([`heads-${family}-${lighting}-tones`, page(`Heads v1, v2, v3: ${family}, front, Monk 1, 3, 6, 9, 10, lighting ${lighting}`, NOTE, TONES.map((n) => `Monk ${n}`), HEADS.map((h) => [LABEL[h], ...TONES.map((n) => `head--${family}--${h}--front--monk${n}-${lighting}.png`)]), 210)]);
    grids.push([`jaw-${family}-${lighting}`, page(`Under the jaw, seen from below: ${family}, lighting ${lighting}`, `${NOTE} Head and shoulders, camera 12° below.`, ['grey front', 'grey three-quarter', 'Monk 1 three-quarter', 'Monk 6 three-quarter', 'Monk 10 three-quarter'], HEADS.map((h) => [LABEL[h], `jaw--${family}--${h}--below-front--grey-${lighting}.png`, ...['grey', 'monk1', 'monk6', 'monk10'].map((t) => `jaw--${family}--${h}--below-three-quarter--${t}-${lighting}.png`)]), 210)]);
  }
  const tones = ['grey-classic', 'monk6-classic', 'monk1-neutral-v2', 'monk10-neutral-v2'];
  grids.push([`phone-${family}`, page(`At phone size: ${family} (whole figure 390 x 760 CSS px at 2x, and its head cut out)`, NOTE, [...tones, ...tones.map((t) => `${t} (head)`)], HEADS.map((h) => [LABEL[h], ...tones.map((t) => `phone--${family}--${h}--${t}.png`), ...tones.map((t) => `phone--${family}--${h}--${t}--head-crop.png`)]), 150)]);
  const bodies = family === 'female' ? ['default', 'girths-150-140-160', '130cm', '220cm'] : ['default', 'girths-150-140-150', '130cm'];
  for (const lighting of ['classic', 'neutral-v2']) {
    grids.push([`neck-${family}-bodies-${lighting}`, page(`The neck in the mount (synthetic ${family === 'female' ? 'dress' : 'tee'}), Monk 6, lighting ${lighting}, 4x`, NOTE, bodies, HEADS.map((h) => [LABEL[h], ...bodies.map((b) => `neck--${family}--${h}--${b}--monk6-${lighting}.png`)]), 190)]);
  }
  grids.push([`neck-${family}-views`, page(`The neck, body alone: ${family}, Monk 6, classic, 4x`, NOTE, ['front', 'side', 'back'], HEADS.map((h) => [LABEL[h], ...[0, 90, 160].map((y) => `neck--${family}--${h}--yaw${y}--monk6-classic.png`)]), 200)]);
}
const builds = ['classic-v1', 'classic-v2', 'classic-v3', 'neutral-v2-v3'];
grids.push(['embed-synthetic-dress', page('In the real embed (production build, 360 x 740 at 2x): the synthetic dress', `${NOTE} One build per column (VITE_VIEWER_LIGHTING / VITE_VIEWER_HEAD).`, builds, TONES.map((n) => [`Monk ${n}`, ...builds.map((b) => `embed--${b}--synthetic-dress--monk${n}.png`)]), 200)]);
grids.push(['embed-synthetic-dress-heads', page('In the real embed: the head cut out of the 3D view (synthetic dress)', NOTE, builds, TONES.map((n) => [`Monk ${n}`, ...builds.map((b) => `embed--${b}--synthetic-dress--monk${n}--head.png`)]), 170)]);

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
