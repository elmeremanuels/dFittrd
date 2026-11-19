#!/usr/bin/env node
/**
 * The 2D figure in all ten Monk swatches, flat (today) and skin-v2 (branch claude/skin-v2, D22
 * point 3), through the dev-only harness (dev/skin.html → src/dev/skinHarness.tsx): pictures at
 * 240 x 432 CSS px at 2x (the embed's figure frame) and, per tone, the colour of every inner
 * pixel of the body fill (median, 10th and 90th percentile by lightness) against the swatch,
 * CIEDE2000. Optional garment payload (the synthetic spike dress).
 *
 *   node scripts/skin-2d-shots.mjs <out dir> [payload.json]
 * Writes PNGs and `skin-2d.json`. Headless Chromium; not part of `pnpm check`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createServer } from 'vite';
import { deltaE2000, labOf } from '../../../spikes/garment-engine/viewer/colour.mjs';

const require = createRequire(import.meta.url);
const web = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(web, '..', '..');
const out = resolve(process.argv[2] ?? join(root, 'test-results', 'skin-2d'));
const payload = process.argv[3] ? resolve(process.argv[3]) : join(root, 'spikes', 'garment-engine', 'out', 'aalter-studio-2', 'payload.json');
mkdirSync(out, { recursive: true });
const MONK = ['f6ede4', 'f3e7db', 'f7ead0', 'eadaba', 'd7bd96', 'a07e56', '825c43', '604134', '3a312a', '292420'];

// The same CIELAB and CIEDE2000 as the 3D measurements.
const lab = labOf;
const de2000 = deltaE2000;
function decodePng(buf) {
  let p = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') ({ w, h, type } = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), type: data[9] });
    if (kind === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 4), stride = w * bpp;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      cur[i] = (line[i] + pr) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) px[4 * (y * w + x) + k] = k < bpp ? cur[x * bpp + k] : 255;
    prev = cur;
  }
  return { w, h, px };
}
const r1 = (v) => Math.round(v * 10) / 10;
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));

/** Inner fill pixels (mask white with four white neighbours, two pixels in), sorted by lightness. */
function stats(png, maskPng) {
  const a = decodePng(png), m = decodePng(maskPng);
  const inside = (j) => m.px[4 * j] > 200;
  const px = [];
  for (let y = 2; y < a.h - 2; y++) for (let x = 2; x < a.w - 2; x++) {
    const i = y * a.w + x;
    if (!(inside(i) && inside(i - 2) && inside(i + 2) && inside(i - 2 * a.w) && inside(i + 2 * a.w))) continue;
    px.push([a.px[4 * i], a.px[4 * i + 1], a.px[4 * i + 2]]);
  }
  const sorted = px.map((c) => [lab(c)[0], c]).sort((p, q) => p[0] - q[0]);
  const at = (t) => sorted[Math.min(sorted.length - 1, Math.floor(t * sorted.length))][1];
  return { pixels: px.length, p10: hex(at(0.1)), median: hex(at(0.5)), p90: hex(at(0.9)) };
}

const server = await createServer({ root: web, configFile: join(web, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 240, height: 432 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const rows = [];
const shot = async (query, file) => {
  await page.goto(`${base}/dev/skin.html?${query}`);
  await page.locator('[data-testid="figure-body"]').first().waitFor();
  await page.waitForTimeout(250);
  return page.locator('[data-testid="harness"]').screenshot(file ? { path: file } : {});
};
try {
  for (const family of (process.env.SKIN2D_FAMILIES ?? 'female,male').split(',')) {
    for (let n = 1; n <= 10; n++) {
      for (const shading of ['flat', 'skin-v2']) {
        const q = `monk=${n}&shading=${shading}&family=${family}`;
        const png = await shot(q, join(out, `figure2d--${family}--monk${n}--${shading}.png`));
        const mask = await shot(`${q}&mask=1`, n === 6 && shading === 'flat' && family === 'female' ? join(out, 'mask-check.png') : null);
        const s = stats(png, mask);
        const sw = `#${MONK[n - 1]}`;
        const d = (h) => r1(de2000(lab(rgbOf(sw)), lab(rgbOf(h))));
        rows.push({ family, monk: n, shading, swatch: sw, ...s, dEmedian: d(s.median), dEp10: d(s.p10), dEp90: d(s.p90), Lswatch: r1(lab(rgbOf(sw))[0]), Lp10: r1(lab(rgbOf(s.p10))[0]), Lmedian: r1(lab(rgbOf(s.median))[0]), Lp90: r1(lab(rgbOf(s.p90))[0]), outline: await page.locator('[data-testid="figure-body"]').first().getAttribute('data-outline') });
        if (existsSync(payload) && family === 'female') await shot(`${q}&payload=/@fs${payload}`, join(out, `figure2d-dress--${family}--monk${n}--${shading}.png`));
      }
    }
  }
} finally {
  writeFileSync(join(out, 'skin-2d.json'), `${JSON.stringify({ renderer: 'headless Chromium (Skia), 240 x 432 CSS px at 2x', rows, errors }, null, 2)}\n`);
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
for (const r of rows) console.log(r.family, r.monk, r.shading.padEnd(7), 'median', r.median, 'dE', r.dEmedian, 'p10', r.dEp10, 'p90', r.dEp90, 'L', r.Lswatch, '→', r.Lp10, r.Lmedian, r.Lp90, 'outline', r.outline);
