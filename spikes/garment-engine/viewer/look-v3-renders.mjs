/* global process, console, document, window, URL, Buffer, requestAnimationFrame, performance */
/**
 * The head review of 19 Nov 2026 (head `neutral-v3` against `neutral` and `neutral-v2`): pictures
 * and measurements through `avatar.html`, which mounts the shipped viewer (`packages/garment-viewer`).
 * Same approach as look-v2-renders.mjs: Vite dev server, headless Chromium with SwiftShader (a
 * software renderer, not a phone). Every picture carries the page's ESTIMATE tag.
 *
 *   node spikes/garment-engine/viewer/look-v3-renders.mjs <out dir> [--only heads,jaw,phone,neck,frames]
 *
 * - heads: v1, v2 and v3 close up (front, three-quarter, side, back, from below), both families,
 *   default grey under `classic` and `neutral-v2`; the front at Monk 1, 3, 6, 9 and 10 under both.
 * - jaw: the under-jaw band, measured: head and shoulders from the front and from below (pitch -12),
 *   and a three-quarter view from below, per head, family, tone and lighting. Down the middle of the
 *   front picture from the chin's front to the neck ring's front: the darkest lightness (CIE L*) in the
 *   upper two thirds against the neck's (the last third): `band` = how much darker, L* units.
 * - phone: the whole figure at phone size (390 x 760 CSS px at 2x) and its head cut out.
 * - neck: the neck in the mount on the synthetic bundles (`out/aalter-studio-2`, a dress;
 *   `out/synthetic-men-tee`): default, the largest girths, 130 cm (and 220 cm, female) bodies, per head (4x);
 *   and the body alone from the front, the side and the back.
 * - frames: frame cost in the throttled phone page (412 x 915 at 2x, CPU throttle 4x): body alone,
 *   ms per frame while turning (LOOK_SAMPLES runs of 30 frames; the first a warm-up left out of the
 *   median), per head and lighting; and the mount with the synthetic dress, frames per second while dragging.
 * LOOK_HEADS=neutral-v3 (comma list) renders only those heads; LOOK_QUICK=1 only `classic`, no tone rows. Writes PNGs and `look-v3[-<sections>].json`.
 * Exits 1 on a page error. Not part of `pnpm check`, which has no WebGL.
 * The synthetic bundles: `pnpm --filter @curtain/garment-spike build:bundle -- --skip-separation`, then
 * a `payload.json` per bundle (see docs/reports/claude-head-v3.md). Uses the preinstalled Playwright.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createServer } from 'vite';
import { labOf } from './colour.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const bundles = resolve(here, '..', 'out');
const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const only = onlyAt >= 0 ? new Set((argv[onlyAt + 1] ?? '').split(',')) : null;
const dirArg = argv.find((a, i) => !a.startsWith('--') && i !== onlyAt + 1);
if (!dirArg) {
  console.error('usage: node look-v3-renders.mjs <out dir> [--only heads,jaw,phone,neck,frames]');
  process.exit(1);
}
const outDir = resolve(dirArg);
mkdirSync(outDir, { recursive: true });
const want = (k) => !only || only.has(k);

export const MONK = ['f6ede4', 'f3e7db', 'f7ead0', 'eadaba', 'd7bd96', 'a07e56', '825c43', '604134', '3a312a', '292420'];
const TONES = [1, 3, 6, 9, 10];
const ALL_HEADS = [['neutral', 'v1'], ['neutral-v2', 'v2'], ['neutral-v3', 'v3']];
const HEADS = process.env.LOOK_HEADS ? ALL_HEADS.filter(([h]) => process.env.LOOK_HEADS.split(',').includes(h)) : ALL_HEADS;
/** LOOK_QUICK=1: `classic` only and no tone rows (a quick look while changing the head). */
const QUICK = !!process.env.LOOK_QUICK;
const LIGHTINGS = QUICK ? ['classic'] : ['classic', 'neutral-v2'];
const DRESS = existsSync(join(bundles, 'aalter-studio-2', 'payload.json')) ? 'aalter-studio-2' : null;
const TEE = existsSync(join(bundles, 'synthetic-men-tee', 'payload.json')) ? 'synthetic-men-tee' : null;
const SAMPLES = Number(process.env.LOOK_SAMPLES ?? 8);
const r1 = (v) => Math.round(v * 10) / 10;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return r1(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/** A PNG (8-bit, RGB or RGBA, not interlaced, as Chromium writes them) as width, height and RGBA pixels. */
export function decodePng(buf) {
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

/**
 * The under-jaw band in a picture of the head from the front: down the middle column (±`half` px),
 * from `fromY` to `toY` (device px), the lightness L* per row (median across the strip). Returns the
 * darkest L* in the upper part of the span (the jaw's underside), the neck's L* (median of the last
 * third), and `band` = neck minus darkest (how much darker the band is than the neck; ≤ 0: no band).
 */
function jawBand(png, cx, fromY, toY, half = 6) {
  const { w, px } = decodePng(png);
  const rows = [];
  for (let y = fromY; y < toY; y++) {
    const ls = [];
    for (let x = cx - half; x <= cx + half; x++) {
      const i = (y * w + x) * 4;
      ls.push(labOf([px[i], px[i + 1], px[i + 2]])[0]);
    }
    ls.sort((a, b) => a - b);
    rows.push(ls[ls.length >> 1]);
  }
  const n = rows.length;
  const neck = median(rows.slice(Math.floor((2 * n) / 3)));
  const darkest = r1(Math.min(...rows.slice(0, Math.floor((2 * n) / 3))));
  return { darkest, neck, band: r1(neck - darkest), profile: rows.filter((_, i) => i % 8 === 0).map(r1) };
}

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5186, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const report = { renderer: 'headless Chromium, SwiftShader (software); not a phone', jaw: [], frames: [], files: [] };
const save = () => writeFileSync(join(outDir, `look-v3${only ? `-${[...only].join('-')}` : ''}.json`), `${JSON.stringify({ ...report, problems }, null, 2)}\n`);

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
  await page.waitForTimeout(500);
  return { page, ok: state !== 'error' };
}
async function snap(page, name, clip) {
  const file = join(outDir, `${name}.png`);
  const png = await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  report.files.push(file);
  return png;
}
const skinQ = (n) => (n ? `&skin=${MONK[n - 1]}` : '');

try {
  const close = await browser.newContext({ viewport: { width: 420, height: 480 }, deviceScaleFactor: 2 });
  if (want('heads')) {
    const VIEWS = [['frame=face&yaw=0', 'front'], ['frame=face&yaw=30', 'three-quarter'], ['yaw=90', 'side'], ['yaw=160', 'back'], ['frame=face&yaw=0&pitch=-12', 'from-below']];
    for (const family of ['female', 'male']) {
      for (const [head, h] of HEADS) {
        for (const lighting of LIGHTINGS) {
          for (const [q, view] of VIEWS) {
            const name = `head--${family}--${h}--${view}--grey-${lighting}`;
            const { page } = await open(close, `mode=head&family=${family}&head=${head}&lighting=${lighting}&${q}`, name);
            await snap(page, name);
            await page.close();
          }
          for (const n of QUICK ? [] : TONES) {
            const name = `head--${family}--${h}--front--monk${n}-${lighting}`;
            const { page } = await open(close, `mode=head&family=${family}&head=${head}&frame=face&lighting=${lighting}${skinQ(n)}`, name);
            await snap(page, name);
            await page.close();
          }
        }
      }
    }
  }

  if (want('jaw')) {
    for (const family of ['female', 'male']) {
      for (const [head, h] of HEADS) {
        for (const lighting of LIGHTINGS) {
          for (const n of [0, 1, 6, 10]) {
            const tone = n ? `monk${n}` : 'grey';
            for (const [q, view] of [['frame=head&yaw=0&pitch=-12', 'below-front'], ['frame=head&yaw=35&pitch=-12', 'below-three-quarter']]) {
              const name = `jaw--${family}--${h}--${view}--${tone}-${lighting}`;
              const { page } = await open(close, `mode=head&family=${family}&head=${head}&lighting=${lighting}&${q}${skinQ(n)}`, name);
              const png = await snap(page, name);
              // From the chin's front down to the neck ring's front (device px, the picture is at 2x).
              if (view === 'below-front') {
                const { chin, neck } = await page.evaluate(() => window.avatarCheck.jawPoints());
                report.jaw.push({ family, head: h, lighting, tone, ...jawBand(png, Math.round(2 * chin.x), Math.round(2 * chin.y), Math.round(2 * neck.y) + 4) });
              }
              await page.close();
            }
          }
          save();
        }
      }
    }
  }

  if (want('phone')) {
    const phone = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
    for (const family of ['female', 'male']) {
      for (const [head, h] of HEADS) {
        for (const [tone, q] of [['grey-classic', '&lighting=classic'], ['monk6-classic', `${skinQ(6)}&lighting=classic`], ['monk1-neutral-v2', `${skinQ(1)}&lighting=neutral-v2`], ['monk10-neutral-v2', `${skinQ(10)}&lighting=neutral-v2`]]) {
          const name = `phone--${family}--${h}--${tone}`;
          const { page } = await open(phone, `mode=head&frame=body&family=${family}&head=${head}${q}`, name);
          await snap(page, name);
          await snap(page, `${name}--head-crop`, { x: 130, y: 100, width: 130, height: 130 });
          await page.close();
        }
      }
    }
  }

  if (want('neck')) {
    const closeUp = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 4 });
    const bodies = {
      female: [['default', ''], ['girths-150-140-160', '&bust=150&waist=140&hip=160'], ['130cm', '&height=130'], ['220cm', '&height=220']],
      male: [['default', ''], ['girths-150-140-150', '&bust=150&waist=140&hip=150'], ['130cm', '&height=130']],
    };
    for (const family of ['female', 'male']) {
      const product = family === 'female' ? DRESS : TEE;
      if (!product) continue;
      for (const [head, h] of HEADS) {
        for (const lighting of LIGHTINGS) {
          for (const [label, q] of bodies[family]) {
            const name = `neck--${family}--${h}--${label}--monk6-${lighting}`;
            const { page, ok } = await open(closeUp, `product=${product}&family=${family}&head=${head}&lighting=${lighting}${skinQ(6)}${q}`, name);
            if (ok) {
              const at = await page.evaluate(() => window.avatarCheck.view.toScreen('head'));
              await snap(page, name, { x: Math.max(0, at.x - 95), y: Math.max(0, at.y - 60), width: 190, height: 190 });
            }
            await page.close();
          }
        }
      }
    }
    for (const family of ['female', 'male']) {
      for (const [head, h] of HEADS) {
        for (const yaw of [0, 90, 160]) {
          const name = `neck--${family}--${h}--yaw${yaw}--monk6-classic`;
          const { page } = await open(closeUp, `mode=head&family=${family}&head=${head}&yaw=${yaw}&lighting=classic${skinQ(6)}`, name);
          await snap(page, name, { x: 95, y: 300, width: 200, height: 340 });
          await page.close();
        }
      }
    }
  }

  if (want('frames')) {
    const throttled = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
    for (const [head, h] of HEADS) {
      for (const lighting of LIGHTINGS) {
        const { page } = await open(throttled, `mode=head&frame=body&head=${head}&lighting=${lighting}${skinQ(3)}`, `frames-${h}-${lighting}`);
        const cdp = await throttled.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const ms = [];
        for (let k = 0; k < SAMPLES; k++) ms.push(await page.evaluate(() => window.avatarCheck.frameMs(30)));
        report.frames.push({ page: 'body alone, 412x915@2x, CPU 4x, turning', head: h, lighting, msPerFrame: ms.map(r1), median: median(ms.slice(1)) });
        save();
        await page.close();
      }
    }
    if (DRESS) {
      for (const [head, h] of HEADS) {
        const { page, ok } = await open(throttled, `product=${DRESS}&head=${head}&lighting=classic${skinQ(3)}`, `fps-${h}`);
        if (ok) {
          const cdp = await throttled.newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await page.evaluate(() => {
            window.__frames = 0;
            const count = () => {
              window.__frames++;
              requestAnimationFrame(count);
            };
            requestAnimationFrame(count);
          });
          const fps = [];
          for (let k = 0; k < Math.max(3, SAMPLES / 2); k++) {
            const t0 = Date.now();
            const f0 = await page.evaluate(() => window.__frames);
            await page.mouse.move(150, 450);
            await page.mouse.down();
            let x = 150, dir = 1;
            while (Date.now() - t0 < 4000) {
              x += dir * 6;
              if (x > 300 || x < 100) dir = -dir;
              await page.mouse.move(x, 450);
            }
            const f1 = await page.evaluate(() => window.__frames);
            fps.push(((f1 - f0) * 1000) / (Date.now() - t0));
            await page.mouse.up();
            await page.waitForTimeout(2000);
          }
          report.frames.push({ page: 'mount, synthetic dress (aalter-studio-2), 412x915@2x, CPU 4x, dragging, lighting classic', head: h, fps: fps.map(r1), medianFps: median(fps) });
          save();
        }
        await page.close();
      }
    }
    void performance;
  }
} finally {
  save();
  await browser.close();
  await server.close();
}
console.log(`${report.files.length} pictures and look-v3.json in ${outDir}`);
for (const p of problems) console.error(`problem: ${p}`);
process.exit(problems.length ? 1 : 0);
