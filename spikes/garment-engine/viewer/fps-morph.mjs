/* global process, console, window, document, URL */
/**
 * R2 spike (docs/research/step3-serverdrape-spike.md): open morph.html in headless Chromium and report the girths the
 * page measures on the blended morphs and the frame rate while the camera turns, at CPU throttle 1x and 4x
 * (CDP Emulation.setCPUThrottlingRate) in a mobile viewport (412 x 915, DPR 2.625 and 1, touch). EMULATED: no real phone;
 * WebGL runs on SwiftShader (software), so the fps is a CPU-bound proxy, not a phone measurement.
 * Saves a screenshot per run to the directory given as the first argument.
 *   node viewer/fps-morph.mjs <screenDir> [band] [body]
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = fileURLToPath(new URL('.', import.meta.url));
const [screens, band = 'W-6', body = 't-0.40'] = process.argv.slice(2);
mkdirSync(screens, { recursive: true });
const server = await createServer({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn', server: { port: 5181, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = [];
try {
  for (const [glb, dpr, morph] of [['meshopt', 2.625, 1], ['meshopt', 2.625, 0], ['quant', 2.625, 1], ['meshopt', 1, 1], ['meshopt', 1, 0]]) {
    for (const throttle of [1, 4]) {
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const t0 = Date.now();
      await page.goto(`${base}morph.html?band=${band}&body=${body}&glb=${glb}&morph=${morph}`);
      await page.waitForFunction(() => ['ready', 'error'].includes(document.documentElement.dataset.state ?? ''), null, { timeout: 180000 });
      const ready = Date.now() - t0;
      await page.waitForTimeout(3000);
      const a = await page.evaluate(() => ({ f: window.__serverdrape?.frames ?? 0, s: window.__serverdrape?.seconds ?? 0 }));
      await page.waitForTimeout(8000);
      const b = await page.evaluate(() => window.__serverdrape);
      const fps = (b.frames - a.f) / (b.seconds - a.s);
      await page.screenshot({ path: join(screens, `morph-${band}-${body}-${glb}-dpr${dpr}-m${morph}-x${throttle}.png`) });
      out.push({ glb, morph, throttle, cpuBlendMs: Math.round(b.cpuBlendMs), viewport: `412x915 @${dpr}`, readyMs: ready, loadMs: Math.round(b.loadMs), glbBytes: b.glbBytes, fps: Math.round(fps * 10) / 10, t: b.t, weights: b.weights, girths: b.girths, errors });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
for (const r of out) console.log(JSON.stringify(r));
