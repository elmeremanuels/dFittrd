/* global process, console, document, window, Buffer, URL */
/**
 * The skin review (D22 point 3, branch claude/skin-v2): skin shading `flat` (today) against
 * `skin-v2`, through `avatar.html`, which mounts the shipped viewer (`packages/garment-viewer`).
 * Headless Chromium on SwiftShader (a software renderer, not a phone). Every picture carries the
 * page's ESTIMATE tag.
 *
 *   node spikes/garment-engine/viewer/skin-v2-renders.mjs <out dir> [--only faces,bodies,phone,patches,garment,frames]
 *
 * - faces: head v3 close up (front, three-quarter), all ten Monk tones, female and male, `classic`
 *   and `neutral-v2`, flat and skin-v2.
 * - bodies: the body alone, whole figure, front and three-quarter, same matrix.
 * - phone: the mount with the synthetic dress (female) and the synthetic men's tee (male) at phone
 *   size (390 x 760 CSS px at 2x), all ten tones, both lightings, flat and skin-v2.
 * - patches: skin colour at four front-facing points (forehead, neck, forearm, shin) and the median,
 *   10th and 90th percentile of every bare-skin pixel of the body alone, against the swatch (CIEDE2000).
 * - garment: garment patches on the dress and the tee, flat against skin-v2 (CIEDE2000).
 * - frames: frame cost in the throttled phone page (412 x 915 at 2x, CPU throttle 4x), body alone.
 * SKIN_TONES=1,6,10 limits the tones; SKIN_QUICK=1: female, classic, faces only.
 * Writes PNGs and `skin-v2[-<sections>].json`. Not part of `pnpm check` (needs WebGL).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { labOf, deltaE2000 } from './colour.mjs';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const bundles = resolve(here, '..', 'out');
const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const only = onlyAt >= 0 ? new Set((argv[onlyAt + 1] ?? '').split(',')) : null;
const dirArg = argv.find((a, i) => !a.startsWith('--') && i !== onlyAt + 1);
if (!dirArg) {
  console.error('usage: node skin-v2-renders.mjs <out dir> [--only faces,bodies,phone,patches,garment,frames]');
  process.exit(1);
}
const outDir = resolve(dirArg);
mkdirSync(outDir, { recursive: true });
const want = (k) => !only || only.has(k);

export const MONK = ['f6ede4', 'f3e7db', 'f7ead0', 'eadaba', 'd7bd96', 'a07e56', '825c43', '604134', '3a312a', '292420'];
const QUICK = !!process.env.SKIN_QUICK;
const TONES = process.env.SKIN_TONES ? process.env.SKIN_TONES.split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const FAMILIES = QUICK ? ['female'] : (process.env.SKIN_FAMILIES ?? 'female,male').split(',');
const LIGHTINGS = QUICK ? ['classic'] : (process.env.SKIN_LIGHTINGS ?? 'classic,neutral-v2').split(',');
const SHADINGS = ['flat', 'skin-v2'];
const HEAD = 'neutral-v3';
const DRESS = existsSync(join(bundles, 'aalter-studio-2', 'payload.json')) ? 'aalter-studio-2' : null;
const TEE = existsSync(join(bundles, 'synthetic-men-tee', 'payload.json')) ? 'synthetic-men-tee' : null;
const SAMPLES = Number(process.env.SKIN_SAMPLES ?? 8);
const r1 = (v) => Math.round(v * 10) / 10;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? r1(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
// Same decoder as look-v3-renders.mjs (that script runs on import, so it is copied).
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
  const out = new Uint8Array(w * h * 4), line = w * bpp;
  let prev = new Uint8Array(line);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (line + 1)], src = raw.subarray(y * (line + 1) + 1, (y + 1) * (line + 1)), cur = new Uint8Array(line);
    for (let i = 0; i < line; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      cur[i] = (src[i] + pred) & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = k < bpp ? cur[x * bpp + k] : 255;
    prev = cur;
  }
  return { w, h, px: out };
}
const hexRgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lab = (h) => labOf(hexRgb(h.replace('#', '')));
const de = (a, b) => r1(deltaE2000(lab(a), lab(b)));

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5187, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const report = { renderer: 'headless Chromium, SwiftShader (software); not a phone', head: HEAD, patches: [], garment: [], frames: [], files: [] };
const save = () => writeFileSync(join(outDir, `skin-v2${only ? `-${[...only].join('-')}` : ''}.json`), `${JSON.stringify({ ...report, problems }, null, 2)}\n`);

async function open(context, query, name) {
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name}: console ${msg.text()}`);
  });
  await page.goto(`${base}avatar.html?${query}`);
  await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: 900_000 });
  const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
  if (state !== 'error') await page.waitForFunction(() => !!window.avatarCheck && window.avatarCheck.view !== undefined, null, { timeout: 60_000 });
  if (state === 'error') problems.push(`${name}: ${await page.textContent('#tag')}`);
  await page.waitForTimeout(400);
  return { page, ok: state !== 'error' };
}
async function snap(page, name, clip) {
  const file = join(outDir, `${name}.png`);
  const png = await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  report.files.push(file);
  return png;
}
const q = (n, shading) => `&skin=${MONK[n - 1]}${shading === 'skin-v2' ? '&shading=skin-v2' : ''}`;

/**
 * Every bare-skin pixel of a body-alone picture: the picture and a mask render (the page's
 * `skinMask`) give the median, 10th and 90th percentile colour by lightness.
 */
function skinStats(png, maskPng) {
  const a = decodePng(png), m = decodePng(maskPng);
  const px = [];
  for (let i = 0; i < a.w * a.h; i++) {
    // Inner skin only: the mask pixel and its four neighbours are skin (no anti-aliased edge).
    const x = i % a.w, y = (i / a.w) | 0;
    if (x < 1 || y < 1 || x >= a.w - 1 || y >= a.h - 1) continue;
    const s = (j) => m.px[4 * j] > 200;
    if (!(s(i) && s(i - 1) && s(i + 1) && s(i - a.w) && s(i + a.w))) continue;
    if ((x + y) % 3) continue;
    px.push([a.px[4 * i], a.px[4 * i + 1], a.px[4 * i + 2]]);
  }
  const withL = px.map((c) => [lab(hex(c))[0], c]).sort((p, r) => p[0] - r[0]);
  const at = (t) => withL[Math.min(withL.length - 1, Math.floor(t * withL.length))]?.[1] ?? [0, 0, 0];
  return { pixels: px.length, p10: hex(at(0.1)), median: hex(at(0.5)), p90: hex(at(0.9)), lRange: withL.length ? r1(withL[Math.floor(0.95 * withL.length)][0] - withL[Math.floor(0.05 * withL.length)][0]) : 0 };
}

try {
  const close = await browser.newContext({ viewport: { width: 420, height: 480 }, deviceScaleFactor: 2 });
  if (want('faces')) {
    const VIEWS = QUICK ? [['frame=face&yaw=0', 'front']] : [['frame=face&yaw=0', 'front'], ['frame=face&yaw=35', 'three-quarter']];
    for (const family of FAMILIES) for (const lighting of LIGHTINGS) for (const n of TONES) for (const shading of SHADINGS) for (const [v, view] of VIEWS) {
      const name = `face--${family}--${view}--monk${n}--${lighting}--${shading}`;
      const { page } = await open(close, `mode=head&family=${family}&head=${HEAD}&lighting=${lighting}&${v}${q(n, shading)}`, name);
      await snap(page, name);
      await page.close();
    }
  }

  const tall = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
  if (want('bodies') || want('patches')) {
    for (const family of FAMILIES) for (const lighting of LIGHTINGS) for (const n of TONES) for (const shading of SHADINGS) {
      for (const [v, view] of want('bodies') ? [['yaw=0', 'front'], ['yaw=35', 'three-quarter']] : [['yaw=0', 'front']]) {
        const name = `body--${family}--${view}--monk${n}--${lighting}--${shading}`;
        const { page } = await open(tall, `mode=head&frame=body&family=${family}&head=${HEAD}&lighting=${lighting}&${v}${q(n, shading)}`, name);
        const png = await snap(page, name);
        if (want('patches') && view === 'front') {
          const patches = await page.evaluate(() => window.avatarCheck.patches());
          const maskPng = Buffer.from(await page.evaluate(() => window.avatarCheck.skinMask()), 'base64');
          const stats = skinStats(png, maskPng);
          const sw = `#${MONK[n - 1]}`;
          const contrast = await page.evaluate(() => window.avatarCheck.contrast());
          delete patches.forehead; // head v3's hair covers the forehead point
          const four = Object.fromEntries(Object.entries(patches).map(([k, p]) => [k, { hex: hex(p.rgb), dE: de(hex(p.rgb), sw) }]));
          report.patches.push({ family, lighting, monk: n, shading, swatch: sw, contrast: { median: contrast.edge.median, p10: contrast.edge.p10, under3: contrast.edge.under3 }, four, meanFour: r1(Object.values(four).reduce((s, p) => s + p.dE, 0) / Object.keys(four).length), all: { ...stats, dEmedian: de(stats.median, sw), dEp10: de(stats.p10, sw), dEp90: de(stats.p90, sw), Lp10: r1(lab(stats.p10)[0]), Lmedian: r1(lab(stats.median)[0]), Lp90: r1(lab(stats.p90)[0]) } });
        }
        await page.close();
      }
      save();
    }
  }

  if (want('phone') || want('garment')) {
    for (const [family, product] of [['female', DRESS], ['male', TEE]]) {
      if (!product || !FAMILIES.includes(family)) continue;
      for (const lighting of LIGHTINGS) for (const n of TONES) {
        const seen = {};
        for (const shading of SHADINGS) {
          const name = `phone--${family}--${product}--monk${n}--${lighting}--${shading}`;
          const { page, ok } = await open(tall, `product=${product}&family=${family}&head=${HEAD}&lighting=${lighting}${q(n, shading)}`, name);
          if (!ok) { await page.close(); continue; }
          if (want('phone')) await snap(page, name);
          if (want('garment')) seen[shading] = await page.evaluate(() => window.avatarCheck.garmentPatches());
          await page.close();
        }
        if (seen.flat && seen['skin-v2']) {
          const rows = Object.keys(seen.flat).filter((k) => k !== 'knee').map((k) => ({ patch: k, flat: hex(seen.flat[k].rgb), skinV2: hex(seen['skin-v2'][k].rgb), dE: de(hex(seen.flat[k].rgb), hex(seen['skin-v2'][k].rgb)) }));
          report.garment.push({ family, product, lighting, monk: n, rows, max: Math.max(...rows.map((r) => r.dE)) });
        }
        save();
      }
    }
  }

  if (want('frames')) {
    const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
    for (const family of FAMILIES) for (const lighting of LIGHTINGS) for (const shading of SHADINGS) {
      const runs = [];
      for (let s = 0; s < SAMPLES; s++) {
        const name = `frames--${family}--${lighting}--${shading}`;
        const { page } = await open(phone, `mode=head&frame=body&family=${family}&head=${HEAD}&lighting=${lighting}${q(6, shading)}`, name);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        runs.push(await page.evaluate(() => window.avatarCheck.frameMs(30)));
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await page.close();
      }
      report.frames.push({ family, lighting, shading, warmup: r1(runs[0]), median: median(runs.slice(1)), min: r1(Math.min(...runs.slice(1))), max: r1(Math.max(...runs.slice(1))) });
      save();
    }
  }
} finally {
  save();
  await browser.close();
  await server.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`wrote ${report.files.length} pictures to ${outDir}`);
