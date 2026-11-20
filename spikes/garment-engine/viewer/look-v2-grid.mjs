/* global process, console, document */
/**
 * Before/after grids of the look review (18 Nov 2026) from the pictures of look-v2-renders.mjs
 * (and, when present, the embed shots of apps/web/e2e/lookV2.spec.ts in the same folder): one
 * labelled PNG per grid, laid out in headless Chromium.
 *
 *   node spikes/garment-engine/viewer/look-v2-grid.mjs <folder with the pictures> [out folder]
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
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** A grid: a title, column heads, rows of [row label, ...file names]; `w` is the width of a cell in CSS px. */
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

const grids = [];
const NOTE = 'ESTIMATE renders, headless Chromium on SwiftShader (software), not a phone. Every picture keeps its own ESTIMATE tag.';
for (const product of ['azure-dress', 'pom-skirt', 'photo-skirt']) {
  const cols = ['classic', 'neutral', 'neutral-v2', 'neutral-v2+head-v2'];
  grids.push([`grid-${product}`, page(`${product}: lighting classic / neutral / neutral-v2, and neutral-v2 with head v2`, `${NOTE} Phone size, 390 x 760 CSS px at 2x.`, cols, TONES.map((n) => [`Monk ${n}`, ...cols.map((c) => `grid--${product}--${c}--monk${n}.png`)]), 200)]);
}
const OPTIONS = ['classic', 'neutral', 'neutral-v2', 'neutral+outline', 'neutral+contact-shadow', 'neutral+adaptive-backdrop', 'neutral+rim'];
const tones = [...Array.from({ length: 10 }, (_, i) => `monk${i + 1}`), 'grey'];
grids.push(['contrast-options', page('Lighting options on the body alone, Monk 1 to 10 and the default grey', `${NOTE} Female body, today's head.`, OPTIONS, tones.map((t) => [t, ...OPTIONS.map((o) => `contrast--female--${o}--${t}.png`)]), 130)]);
for (const family of ['female', 'male']) {
  const views = ['front', 'three-quarter', 'side', 'back', 'from-below'];
  grids.push([`heads-${family}-grey`, page(`Head v1 (today) and head v2, ${family}, default grey, lighting classic`, NOTE, ['v1 (today)', 'v2'], views.map((v) => [v, `head--${family}--v1--${v}--grey-classic.png`, `head--${family}--v2--${v}--grey-classic.png`]), 300)]);
  grids.push([`heads-${family}-tones`, page(`Head v1 and head v2, ${family}, front, lighting neutral-v2`, NOTE, TONES.map((n) => `Monk ${n}`), [['v1 (today)', ...TONES.map((n) => `head--${family}--v1--front--monk${n}-neutral-v2.png`)], ['v2', ...TONES.map((n) => `head--${family}--v2--front--monk${n}-neutral-v2.png`)]], 220)]);
  grids.push([`phone-${family}`, page(`Head v1 and v2 at phone size, ${family} (whole figure 390 x 760 CSS px; the crops are the head at 2x)`, NOTE, ['grey classic', 'Monk 6 neutral-v2', 'Monk 1 neutral-v2', 'grey classic (head)', 'Monk 6 (head)', 'Monk 1 (head)'], ['v1', 'v2'].map((h) => [h === 'v1' ? 'v1 (today)' : 'v2', `phone--${family}--${h}--grey-classic.png`, `phone--${family}--${h}--monk6-neutral-v2.png`, `phone--${family}--${h}--monk1-neutral-v2.png`, `phone--${family}--${h}--grey-classic--head-crop.png`, `phone--${family}--${h}--monk6-neutral-v2--head-crop.png`, `phone--${family}--${h}--monk1-neutral-v2--head-crop.png`]), 170)]);
  grids.push([`neck-${family}`, page(`The neck under head v1 and head v2, ${family}, Monk 6, neutral-v2 (4x)`, NOTE, ['front', 'side', 'back'], ['v1', 'v2'].map((h) => [h === 'v1' ? 'v1 (today)' : 'v2', ...[0, 90, 160].map((y) => `neck--${family}--${h}--yaw${y}.png`)]), 220)]);
}
grids.push(['neck-bodies', page('The neck under head v1 and v2 in the mount (azure dress), Monk 6, neutral-v2, 4x', NOTE, ['default', 'girths 150/140/160', 'girths 60/45/65', '130 cm', '220 cm'], ['v1', 'v2'].map((h) => [h === 'v1' ? 'v1 (today)' : 'v2', ...['default', 'girths-150-140-160', 'girths-60-45-65', '130cm', '220cm'].map((b) => `neck--${h}--${b}.png`)]), 190)]);
for (const product of ['azure-dress', 'pom-skirt', 'photo-skirt']) {
  const builds = ['classic', 'neutral', 'neutral-v2', 'neutral-v2+head-v2'];
  grids.push([`embed-${product}`, page(`In the real embed (production build, 360 x 740 at 2x): ${product}`, `${NOTE} One build per column (VITE_VIEWER_LIGHTING / VITE_VIEWER_HEAD).`, builds, TONES.map((n) => [`Monk ${n}`, ...builds.map((b) => `embed--${b}--${product}--monk${n}.png`)]), 200)]);
  grids.push([`embed-${product}-heads`, page(`In the real embed: the head, cut out of the 3D view: ${product}`, NOTE, builds, TONES.map((n) => [`Monk ${n}`, ...builds.map((b) => `embed--${b}--${product}--monk${n}--head.png`)]), 160)]);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  for (const [name, html] of grids) {
    const p = await ctx.newPage();
    // A file page, so the pictures (file URLs) load.
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
