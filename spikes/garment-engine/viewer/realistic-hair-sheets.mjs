/* global process, console, URL */
/**
 * The sheets of the realistic hair (D28) from the pictures of `realistic-hair-renders.mjs`, composed in headless
 * Chromium (an HTML page of the PNGs, screenshotted), so no image library is needed:
 *   - `sheet-types-lengths.png`: the 40 combinations, a row per type, front and back three-quarter per length;
 *   - `sheet-colours.png`: type 2B at shoulder length in the ten colours, front and back three-quarter;
 *   - `sheet-dress.png`: 4C long, 3A shoulder and 1 long in the dress, front, three-quarter and back.
 * Each 390 × 844 tile (rendered at 2×) is shown at `scale` of its CSS size (default 0.5 for the first two sheets).
 *
 *   node spikes/garment-engine/viewer/realistic-hair-sheets.mjs <dir with the renders> [<sheet dir>] [--scale 0.5]
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../node_modules/.pnpm/node_modules/playwright'));
  }
})();
const argv = process.argv.slice(2);
const si = argv.indexOf('--scale');
const scale = si >= 0 ? Number(argv[si + 1]) : 0.5;
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--scale');
if (!pos[0]) {
  console.error('usage: node realistic-hair-sheets.mjs <dir> [<sheet dir>] [--scale 0.5]');
  process.exit(1);
}
const dir = resolve(pos[0]);
const outDir = resolve(pos[1] ?? pos[0]);
const TYPES = ['1', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C'];
const LENGTHS = ['short', 'chin', 'shoulder', 'long'];
const COLOURS = ['black', 'dark-brown', 'brown', 'light-brown', 'auburn', 'copper', 'dark-blonde', 'blonde', 'platinum', 'grey'];
const TYPE_COLOUR = { 1: 'dark-brown', '2A': 'blonde', '2B': 'auburn', '2C': 'light-brown', '3A': 'dark-blonde', '3B': 'copper', '3C': 'brown', '4A': 'grey', '4B': 'platinum', '4C': 'black' };
const renders = existsSync(join(dir, 'renders.json')) ? JSON.parse(readFileSync(join(dir, 'renders.json'), 'utf8')).renders : [];
const info = (name) => renders.find((r) => r.name === name);

const cell = (name, label, s) => {
  const file = join(dir, `${name}.png`);
  const w = Math.round(390 * s), h = Math.round(844 * s);
  if (!existsSync(file)) return `<figure style="width:${w}px"><figcaption>${label}</figcaption><div style="width:${w}px;height:${h}px;background:#333">missing</div></figure>`;
  const r = info(name);
  const simpler = r?.hair?.includes('(simpler)') ? ' · SIMPLER' : '';
  const tris = r?.triangles ? ` · ${(r.triangles / 1000).toFixed(1)}k tri` : '';
  return `<figure style="width:${w}px"><figcaption>${label}${tris}${simpler}</figcaption><img style="width:${w}px;height:${h}px" src="data:image/png;base64,${readFileSync(file).toString('base64')}"></figure>`;
};
const chromePath = [process.env.CHROME_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
async function sheet(file, title, rows, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1a1612;font:600 13px system-ui;color:#f5efe7">
    <div style="padding:10px 12px 0;font-size:16px">${title}</div>
    ${rows.map(([head, cells]) => `<div style="display:flex;gap:6px;padding:6px 12px 2px;align-items:flex-start"><div style="width:70px;padding-top:24px;font-size:18px">${head}</div>${cells.join('')}</div>`).join('')}
    <style>figure{margin:0}figcaption{padding:2px 0 4px;min-height:32px;line-height:15px}img{display:block}</style></body></html>`, { timeout: 180_000 });
  await page.waitForLoadState('load', { timeout: 180_000 });
  await page.screenshot({ path: join(outDir, file), fullPage: true, timeout: 180_000 });
}
const note = 'ESTIMATE · realistic hair (D28) on the realistic body spike, mid body 168 cm · headless Chromium (SwiftShader), tiles 390 × 844 CSS px rendered at 2×';
if (existsSync(join(dir, 'tile-1-short--front.png'))) {
  const w8 = 12 + 70 + 8 * (Math.round(390 * scale) + 6) + 12;
  await sheet('sheet-types-lengths.png', `${note} · front and back three-quarter per length · one colour per type`, TYPES.map((t) => [t, LENGTHS.flatMap((l) => [cell(`tile-${t}-${l}--front`, `${t} ${l} · front · ${TYPE_COLOUR[t]}`, scale), cell(`tile-${t}-${l}--back`, `${t} ${l} · back ¾`, scale)])]), w8);
}
if (existsSync(join(dir, 'colour-black--front.png'))) {
  const w10 = 12 + 70 + 10 * (Math.round(390 * scale) + 6) + 12;
  await sheet('sheet-colours.png', `${note} · type 2B, shoulder length, the ten colours of the palette`, [['front', COLOURS.map((c) => cell(`colour-${c}--front`, c, scale))], ['back ¾', COLOURS.map((c) => cell(`colour-${c}--back`, c, scale))]], w10);
}
const closeList = [['1', 'long'], ['2B', 'shoulder'], ['3B', 'long'], ['4C', 'long']];
if (existsSync(join(dir, 'closeup-v2-1-long--tq.png'))) {
  const cs = 0.85;
  const w2 = 12 + 95 + 2 * (Math.round(390 * cs) + 6) + 12;
  await sheet(
    'sheet-closeups.png',
    `${note} · three-quarter close-ups · before (v1 strand-cards) vs. after (v2 sculpted locks)`,
    closeList.map(([t, l]) => [
      `${t} ${l}`,
      [
        cell(`closeup-v1-${t}-${l}--tq`, `Before · v1 strand-cards · ${t} ${l}`, cs),
        cell(`closeup-v2-${t}-${l}--tq`, `After · v2 sculpted · ${t} ${l}`, cs),
      ],
    ]),
    w2,
  );
}
const dress = [['4C', 'long'], ['3A', 'shoulder'], ['1', 'long']];
if (existsSync(join(dir, 'dress-4C-long--front.png'))) {
  const ds = 0.75;
  const w3 = 12 + 70 + 3 * (Math.round(390 * ds) + 6) + 12;
  await sheet('sheet-dress.png', `${note} · in the azure dress (draped on the device), full body`, dress.map(([t, l]) => [`${t} ${l}`, ['front', 'three-quarter', 'back'].map((v) => cell(`dress-${t}-${l}--${v}`, `${t} ${l} · ${v} · ${TYPE_COLOUR[t]}`, ds))]), w3);
}
await browser.close();
console.log(`sheets in ${outDir}`);
