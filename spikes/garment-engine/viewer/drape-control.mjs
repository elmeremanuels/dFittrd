/* global process, console, document, requestAnimationFrame, performance, URL */
/**
 * Step-3 control (docs/research/shortcut-to-step3.md §4, days 1-2): headless renders of one evaluated bundle with
 * several drape settings (the spike page's `cling`, `loops`, `rings` and `band` URL parameters, `drapeOptionsFrom`),
 * sizes 8, 12 and 16 side by side, front and side view, plus the cost of each setting in a CPU-throttled phone-sized
 * page: drape wall and worker time per size (`data-settle`) and frames per second while the three sizes drape.
 *
 * Emulated, not a phone: Chromium with SwiftShader (rendering on the CPU too), a 412×915 viewport at DPR 2 and the
 * DevTools CPU throttle (default 4×). Numbers compare settings against each other on this machine only.
 *
 *   node spikes/garment-engine/viewer/drape-control.mjs eval/<id> --out <dir> [--throttle 4]
 *        [--set name=query ...]   e.g. --set base= --set best=cling=0&loops=1&rings=hip,waist
 *
 * Uses the preinstalled Playwright (`require('playwright')`), not a dependency of the package.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const TIMEOUT = 300_000;

const argv = process.argv.slice(2);
const take = (name) => {
  const out = [];
  for (let k = argv.indexOf(`--${name}`); k >= 0; k = argv.indexOf(`--${name}`)) out.push(argv.splice(k, 2)[1]);
  return out;
};
const outDir = resolve(take('out')[0] ?? join(here, '..', 'out', 'drape-control'));
const throttle = Number(take('throttle')[0] ?? 4);
const sets = take('set').map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]);
if (sets.length === 0) sets.push(['base', ''], ['nocling', 'cling=0'], ['best', 'cling=0&loops=1&rings=hip,waist']);
const id = argv[0];
if (!id) {
  console.error('usage: drape-control.mjs eval/<id> --out <dir> [--set name=query ...]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5181, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const result = { id, throttle, emulated: 'Chromium + SwiftShader, CPU throttle via DevTools, not a phone', sets: {} };
const settle = async (page) => {
  await page.waitForFunction(() => ['settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: TIMEOUT });
  if ((await page.evaluate(() => document.documentElement.dataset.viewerState)) === 'error') throw new Error(`viewer error: ${await page.textContent('#status')}`);
  await page.waitForTimeout(300);
};
const sizesQ = 'layout=side&sizes=8,12,16&size=12';
try {
  for (const [name, q] of sets) {
    const entry = { query: q, shots: [], problems: [] };
    result.sets[name] = entry;
    // Renders: desktop viewport, unthrottled.
    const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
    page.on('pageerror', (e) => entry.problems.push(`pageerror: ${e.message}`));
    for (const view of ['front', 'side']) {
      await page.goto(`${base}index.html?product=${encodeURIComponent(id)}&${sizesQ}&view=${view}${q ? `&${q}` : ''}`);
      await settle(page);
      const file = join(outDir, `${id.replace(/\W+/g, '_')}-${name}-${view}.png`);
      await page.screenshot({ path: file });
      entry.shots.push(file);
    }
    entry.lines = await page.evaluate(() => document.querySelector('#lines')?.textContent ?? '');
    await page.close();
    // Cost: phone-sized, throttled; fps while the three sizes drape, then the settle times.
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const phone = await ctx.newPage();
    const cdp = await ctx.newCDPSession(phone);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const t0 = Date.now();
    await phone.goto(`${base}index.html?product=${encodeURIComponent(id)}&${sizesQ}${q ? `&${q}` : ''}`);
    await phone.waitForFunction(() => ['draping', 'settled', 'error'].includes(document.documentElement.dataset.viewerState ?? ''), null, { timeout: TIMEOUT });
    const fps = await phone.evaluate(
      () =>
        new Promise((done) => {
          const times = [];
          const t = performance.now();
          const tick = (now) => {
            times.push(now);
            if (now - t < 4000 && document.documentElement.dataset.viewerState === 'draping') requestAnimationFrame(tick);
            else {
              const gaps = times.slice(1).map((x, i) => x - times[i]).sort((a, b) => a - b);
              done({ frames: times.length, seconds: (times[times.length - 1] - times[0]) / 1000, medianMs: gaps[Math.floor(gaps.length / 2)] ?? null, p95Ms: gaps[Math.floor(gaps.length * 0.95)] ?? null });
            }
          };
          requestAnimationFrame(tick);
        }),
    );
    await settle(phone);
    entry.phone = { fpsWhileDraping: fps.seconds > 0 ? Math.round((fps.frames - 1) / fps.seconds * 10) / 10 : null, frameMedianMs: fps.medianMs && Math.round(fps.medianMs), frameP95Ms: fps.p95Ms && Math.round(fps.p95Ms), sampledS: Math.round(fps.seconds * 10) / 10, wallToSettledS: (Date.now() - t0) / 1000, settle: JSON.parse(await phone.evaluate(() => document.documentElement.dataset.settle ?? '[]')) };
    await ctx.close();
    console.log(`[drape-control] ${id} ${name}: ${JSON.stringify(entry.phone)}${entry.problems.length ? ` problems ${entry.problems.join('; ')}` : ''}`);
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(outDir, `${id.replace(/\W+/g, '_')}-drape-control.json`), `${JSON.stringify(result, null, 2)}\n`);
