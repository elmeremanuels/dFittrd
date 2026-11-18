/* global process, console, document, window, URL, requestAnimationFrame */
/**
 * The look review of 18 Nov 2026 (lighting `neutral-v2`, head `neutral-v2`): pictures and
 * measurements through `avatar.html`, which mounts the shipped viewer (`packages/garment-viewer`).
 * Same approach as avatar-renders.mjs: Vite dev server, headless Chromium with SwiftShader (a
 * software renderer, not a phone). Every picture carries the page's ESTIMATE tag.
 *
 *   node spikes/garment-engine/viewer/look-v2-renders.mjs <out dir> [--only contrast,garments,heads,neck,frames]
 *
 * - contrast: the body alone, all ten Monk swatches and the default grey, under every lighting and
 *   option (classic, neutral, neutral-v2, and neutral with only the outline, only the contact
 *   shadow, the adaptive backdrop or the rim lights): WCAG contrast of the skin along its silhouette
 *   against what is next to it (`avatarCheck.contrast()`), and the skin colour error (CIEDE2000)
 *   on four front-facing patches. One phone-sized picture each (390 x 760 CSS px at 2x).
 * - garments: the azure dress, the crimson POM skirt (a drape bake) and the photo skirt, under
 *   classic, neutral and neutral-v2 with today's head, and neutral-v2 with head v2; Monk 1, 3, 6, 9
 *   and 10 (`setLook` on one mounted view): a picture each, the skin patches and the garment's colour
 *   on three to five patches.
 * - heads: head v1 against head v2, both families, close up and at phone size.
 * - neck: the neck under both heads on large, short and tall bodies (4x).
 * - frames: frame cost in the throttled phone page (412 x 915 at 2x, DevTools CPU throttle 4x), body
 *   alone (ms per frame, 40 frames turning) and in the mount with the dress (frames per second
 *   while dragging), for both heads and the three lightings.
 * Writes PNGs and `look-v2[-<sections>].json` (after every measurement) to the out dir.
 *
 * Bundles: `out/eval/azure-palm-baby-doll-dress`, `out/pom2-bundle/crimson-wildflower-maxi-skirt`,
 * `out/eval/crimson-wildflower-maxi-skirt` (git-ignored). Uses the preinstalled Playwright.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { deltaE2000, labOf } from './colour.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const bundles = resolve(here, '..', 'out');
const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const only = onlyAt >= 0 ? new Set((argv[onlyAt + 1] ?? '').split(',')) : null;
const outDir = resolve(argv.find((a, i) => !a.startsWith('--') && i !== onlyAt + 1) ?? '');
if (!argv[0] || argv[0].startsWith('--')) {
  console.error('usage: node look-v2-renders.mjs <out dir> [--only contrast,garments,heads,neck,frames]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const want = (k) => !only || only.has(k);
/** LOOK_LIGHTING=<label>: only the options and lightings whose label starts with it (a re-run after a change to one lighting). */
const onlyLighting = process.env.LOOK_LIGHTING ?? '';
const lit = (label) => label.startsWith(onlyLighting);

/** Monk Skin Tone scale swatches 1 to 10 (`MONK_SWATCHES` in apps/web capture). */
export const MONK = ['f6ede4', 'f3e7db', 'f7ead0', 'eadaba', 'd7bd96', 'a07e56', '825c43', '604134', '3a312a', '292420'];
const GREY = '8c8c8c';
const PRODUCTS = [
  { id: 'azure-dress', dir: 'eval/azure-palm-baby-doll-dress' },
  { id: 'pom-skirt', dir: 'pom2-bundle/crimson-wildflower-maxi-skirt' },
  { id: 'photo-skirt', dir: 'eval/crimson-wildflower-maxi-skirt' },
].filter((p) => existsSync(join(bundles, p.dir, 'grading.json')));
/** The lighting options compared on the body alone (query string, label). */
const OPTIONS = [
  ['lighting=classic', 'classic'],
  ['lighting=neutral', 'neutral'],
  ['lighting=neutral-v2', 'neutral-v2'],
  ['lighting=neutral&outline=1.25', 'neutral+outline'],
  ['lighting=neutral&shadow=0.32', 'neutral+contact-shadow'],
  ['lighting=neutral&backdrop=adaptive', 'neutral+adaptive-backdrop'],
  ['lighting=neutral&rim=1.2', 'neutral+rim'],
];

const rgbOfHex = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOfRgb = (rgb) => rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const r1 = (v) => Math.round(v * 10) / 10;

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5185, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const save = () => writeFileSync(join(outDir, `look-v2${only ? `-${[...only].join('-')}` : ''}${onlyLighting ? `-${onlyLighting}` : ''}.json`), `${JSON.stringify({ ...report, problems }, null, 2)}\n`);
const report = { renderer: 'headless Chromium, SwiftShader (software); not a phone', monk: MONK, contrast: [], garments: [], frames: [], files: [] };

async function open(context, query, name) {
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: pageerror ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${name}: console ${msg.text()}`);
  });
  await page.goto(`${base}avatar.html?${query}`);
  await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: 600_000 });
  const state = await page.evaluate(() => document.documentElement.dataset.viewerState);
  // The mount reports `settled` before it returns the view: wait for the page's hook as well.
  if (state !== 'error') await page.waitForFunction(() => !!window.avatarCheck && (window.avatarCheck.view !== undefined), null, { timeout: 60_000 });
  if (state === 'error') problems.push(`${name}: ${await page.textContent('#tag')}`);
  await page.waitForTimeout(600);
  return { page, ok: state !== 'error' };
}
async function snap(page, name, clip) {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  report.files.push(file);
}
const skinErrors = (patches, hex) => {
  const wantLab = labOf(rgbOfHex(hex));
  return Object.fromEntries(Object.entries(patches).map(([k, p]) => [k, { rendered: `#${hexOfRgb(p.rgb)}`, dE2000: r1(deltaE2000(wantLab, labOf(p.rgb))) }]));
};

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 });
  if (want('contrast')) {
    for (const family of ['female', 'male']) {
      const tones = family === 'female' ? [...MONK.map((h, i) => [`monk${i + 1}`, h]), ['grey', GREY]] : [['monk1', MONK[0]], ['monk3', MONK[2]], ['monk6', MONK[5]], ['monk10', MONK[9]]];
      for (const [q, label] of OPTIONS) {
        if (!lit(label)) continue;
        if (family === 'male' && !['classic', 'neutral', 'neutral-v2'].includes(label)) continue;
        for (const [tone, hex] of tones) {
          const name = `contrast--${family}--${label}--${tone}`;
          const { page, ok } = await open(phone, `mode=head&frame=body&family=${family}&${q}${tone === 'grey' ? '' : `&skin=${hex}`}`, name);
          if (ok) {
            const c = await page.evaluate(() => window.avatarCheck.contrast());
            const patches = await page.evaluate(() => window.avatarCheck.patches());
            const look = await page.evaluate(() => window.avatarCheck.look);
            report.contrast.push({ family, option: label, tone, hex: `#${hex}`, ...c, outline: look?.outline ?? null, backdropPanel: look?.backdrop ?? null, skin: skinErrors(patches, hex) });
            await snap(page, name);
          }
          await page.close();
          save();
        }
      }
    }
  }

  if (want('garments')) {
    const LIGHTS = [['lighting=classic', 'classic'], ['lighting=neutral', 'neutral'], ['lighting=neutral-v2', 'neutral-v2'], ['lighting=neutral-v2&head=neutral-v2', 'neutral-v2+head-v2']];
    const TONES = [1, 3, 6, 9, 10];
    for (const p of PRODUCTS) {
      for (const [q, label] of LIGHTS) {
        if (!lit(label)) continue;
        const name = `grid--${p.id}--${label}`;
        const { page, ok } = await open(phone, `product=${p.dir}&${q}&skin=${MONK[0]}`, name);
        if (!ok) {
          await page.close();
          continue;
        }
        for (const n of TONES) {
          const hex = MONK[n - 1];
          await page.evaluate((h) => {
            window.avatarCheck.view.setLook({ skinHex: `#${h}` });
            // The page's tag names the colour of the mount: name the one shown now.
            const tag = document.getElementById('tag');
            tag.textContent = tag.textContent.replace(/skin (#[0-9a-f]{6}|default grey)/, `skin #${h}`);
          }, hex);
          await page.waitForTimeout(500);
          const patches = await page.evaluate(() => window.avatarCheck.patches());
          const cloth = await page.evaluate(() => window.avatarCheck.garmentPatches());
          report.garments.push({ product: p.id, lighting: label, tone: `monk${n}`, hex: `#${hex}`, skin: skinErrors(patches, hex), garment: Object.fromEntries(Object.entries(cloth).map(([k, v]) => [k, `#${hexOfRgb(v.rgb)}`])) });
          await snap(page, `${name}--monk${n}`);
        }
        await page.close();
        save();
      }
    }
  }

  if (want('heads')) {
    const close = await browser.newContext({ viewport: { width: 420, height: 480 }, deviceScaleFactor: 2 });
    for (const family of ['female', 'male']) {
      for (const head of ['neutral', 'neutral-v2']) {
        const h = head === 'neutral' ? 'v1' : 'v2';
        for (const [q, view] of [['frame=face&yaw=0', 'front'], ['frame=face&yaw=30', 'three-quarter'], ['yaw=90', 'side'], ['yaw=160', 'back'], ['frame=face&yaw=0&pitch=-12', 'from-below']]) {
          const name = `head--${family}--${h}--${view}--grey-classic`;
          const { page } = await open(close, `mode=head&family=${family}&head=${head}&${q}`, name);
          await snap(page, name);
          await page.close();
        }
        for (const n of [1, 3, 6, 9, 10]) {
          const name = `head--${family}--${h}--front--monk${n}-neutral-v2`;
          const { page } = await open(close, `mode=head&family=${family}&head=${head}&frame=face&lighting=neutral-v2&skin=${MONK[n - 1]}`, name);
          await snap(page, name);
          await page.close();
        }
        for (const [tone, q] of [['grey-classic', ''], ['monk6-neutral-v2', `&skin=${MONK[5]}&lighting=neutral-v2`], ['monk1-neutral-v2', `&skin=${MONK[0]}&lighting=neutral-v2`]]) {
          const name = `phone--${family}--${h}--${tone}`;
          const { page } = await open(phone, `mode=head&frame=body&family=${family}&head=${head}${q}`, name);
          await snap(page, name);
          // The head at phone size, cut out at 4x of the CSS px (the picture is at 2x).
          await snap(page, `${name}--head-crop`, { x: 130, y: 100, width: 130, height: 130 });
          await page.close();
        }
      }
    }
  }

  if (want('neck')) {
    const dress = PRODUCTS.find((p) => p.id === 'azure-dress');
    const closeUp = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 4 });
    const BIG = 'bust=150&waist=140&hip=160';
    if (dress) {
      for (const head of ['neutral', 'neutral-v2']) {
        for (const [label, q] of [['default', ''], ['girths-150-140-160', `&${BIG}`], ['girths-60-45-65', '&bust=60&waist=45&hip=65'], ['130cm', '&height=130'], ['220cm', '&height=220']]) {
          const name = `neck--${head === 'neutral' ? 'v1' : 'v2'}--${label}`;
          const { page, ok } = await open(closeUp, `product=${dress.dir}&head=${head}&lighting=neutral-v2&skin=${MONK[5]}${q}`, name);
          if (ok) {
            const at = await page.evaluate(() => window.avatarCheck.view.toScreen('head'));
            await snap(page, name, { x: Math.max(0, at.x - 95), y: Math.max(0, at.y - 60), width: 190, height: 190 });
          }
          await page.close();
        }
      }
    }
    for (const family of ['female', 'male']) {
      for (const head of ['neutral', 'neutral-v2']) {
        for (const yaw of [0, 90, 160]) {
          const name = `neck--${family}--${head === 'neutral' ? 'v1' : 'v2'}--yaw${yaw}`;
          const { page } = await open(closeUp, `mode=head&family=${family}&head=${head}&yaw=${yaw}&lighting=neutral-v2&skin=${MONK[5]}`, name);
          await snap(page, name, { x: 95, y: 300, width: 200, height: 340 });
          await page.close();
        }
      }
    }
  }

  if (want('frames')) {
    const throttled = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
    for (const head of ['neutral', 'neutral-v2']) {
      for (const lighting of ['classic', 'neutral', 'neutral-v2']) {
        const { page } = await open(throttled, `mode=head&frame=body&head=${head}&lighting=${lighting}&skin=${MONK[2]}`, `frames-${head}-${lighting}`);
        const cdp = await throttled.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const ms = [], still = [];
        for (let k = 0; k < 3; k++) ms.push(await page.evaluate(() => window.avatarCheck.frameMs(30)));
        // A frame with the outline (what a still view draws once a turn has stopped).
        if (lighting === 'neutral-v2') for (let k = 0; k < 3; k++) still.push(await page.evaluate(() => window.avatarCheck.frameMs(15, true)));
        report.frames.push({ page: 'body alone, 412x915@2x, CPU 4x, turning as a drag does (no outline while dragging)', head, lighting, msPerFrame: ms.map(r1), ...(still.length ? { msPerFrameWithOutline: still.map(r1) } : {}) });
        save();
        await page.close();
      }
    }
    const dress = PRODUCTS.find((p) => p.id === 'azure-dress');
    if (dress) {
      for (const head of ['neutral', 'neutral-v2']) {
        for (const lighting of ['classic', 'neutral-v2']) {
          const { page, ok } = await open(throttled, `product=${dress.dir}&head=${head}&lighting=${lighting}&skin=${MONK[2]}`, `fps-${head}-${lighting}`);
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
            // Drag across the canvas for 6 s: the view renders a frame for every move.
            const t0 = Date.now();
            const f0 = await page.evaluate(() => window.__frames);
            await page.mouse.move(150, 450);
            await page.mouse.down();
            let x = 150, dir = 1;
            while (Date.now() - t0 < 6000) {
              x += dir * 6;
              if (x > 300 || x < 100) dir = -dir;
              await page.mouse.move(x, 450);
            }
            await page.mouse.up();
            const f1 = await page.evaluate(() => window.__frames);
            report.frames.push({ page: 'mount, azure dress, 412x915@2x, CPU 4x, dragging', head, lighting, fps: r1(((f1 - f0) * 1000) / (Date.now() - t0)) });
            // After the drag: the still view draws the outline again.
            await page.waitForTimeout(2500);
            await snap(page, `frames--after-drag--${head}--${lighting}`);
          }
          await page.close();
        }
      }
    }
  }
} finally {
  save();
  await browser.close();
  await server.close();
}
console.log(`${report.files.length} pictures and look-v2.json in ${outDir}`);
for (const p of problems) console.error(`problem: ${p}`);
process.exit(problems.length ? 1 : 0);
