#!/usr/bin/env node
/**
 * Phone and desktop screenshots (deviceScaleFactor 2) of the product meta box with a size chart,
 * rendered OUTSIDE WordPress by e2e/render-chart-box.php (the plugin's PHP, CSS and meta-box.js on
 * a jQuery stub-free page: the JS is not run, so the box shows what the server rendered). For the
 * real thing run e2e/run.mjs (Docker).
 *
 *   node packages/woocommerce-plugin/e2e/chart-meta-box-shots.mjs <outDir> [state,state,…]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? 'test-results/chart-meta-box');
const states = process.argv[3] ? process.argv[3].split(',') : ['women-body', 'women-garment', 'men-tee', 'men-tee-error', 'men-chino', 'men-chino-error'];
mkdirSync(out, { recursive: true });
const css = readFileSync(join(root, 'assets/admin/meta-box.css'), 'utf8');
const base = `body{margin:0;background:#f0f0f1;color:#3c434a;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif}
.postbox{background:#fff;border:1px solid #c3c4c7;margin:16px;padding:0 12px 12px}.postbox h2{font-size:14px;margin:0 -12px 8px;padding:8px 12px;border-bottom:1px solid #c3c4c7}
input[type=text],input[type=number],select,textarea{border:1px solid #8c8f94;border-radius:4px;padding:0 8px;min-height:30px;font:inherit;background:#fff;color:#2c3338;box-sizing:border-box}
@media (max-width:782px){.postbox{margin:8px 0}input[type=text],input[type=number],select{min-height:40px;font-size:16px}}`;

const failures = [];
const expect = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const browser = await chromium.launch();
for (const state of states) {
  const html = execFileSync('php', [join(root, 'e2e/render-chart-box.php'), state], { encoding: 'utf8' });
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}\n${css}</style></head><body><div class="postbox"><h2>Curtain fit data</h2>${html}</div></body></html>`;
  for (const vp of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    await page.setContent(doc);
    // The whole box (women's: compared pixel by pixel before and after) and the size chart part.
    await page.locator('.curtain-box').screenshot({ path: join(out, `woo-${vp.name}-${state}-box.png`) });
    const clip = await page.evaluate(() => {
      const hs = [...document.querySelectorAll('.curtain-box h4')];
      const a = hs.find((h) => /^Size chart/.test(h.textContent)).getBoundingClientRect();
      const next = document.querySelector('#curtain-tape') ?? hs[hs.findIndex((h) => /^Size chart/.test(h.textContent)) + 1];
      const b = next.getBoundingClientRect();
      return { x: 0, y: a.top + window.scrollY - 6, width: document.documentElement.clientWidth, height: b.top - a.top + 6 };
    });
    await page.screenshot({ path: join(out, `woo-${vp.name}-${state}-chart.png`), clip, fullPage: true });
    const text = await page.locator('.curtain-box').innerText();
    const visibleHead = await page.evaluate(() => [...document.querySelectorAll('.curtain-repeater[data-repeater="size_chart"] thead th')].filter((th) => th.offsetParent !== null).map((th) => th.textContent.trim()).filter(Boolean).join('|'));
    if (state.startsWith('women')) expect(!/neck|sleeve|rise|seat/i.test(visibleHead), `${vp.name} ${state}: men's columns visible: ${visibleHead}`);
    if (state === 'men-tee') expect(/chest/.test(visibleHead) && /neck/.test(visibleHead) && /sleeve/.test(visibleHead) && /length/.test(visibleHead), `${vp.name} ${state}: head ${visibleHead}`);
    if (state === 'men-chino') expect(/seat/.test(visibleHead) && /rise/.test(visibleHead) && /inseam/.test(visibleHead), `${vp.name} ${state}: head ${visibleHead}`);
    if (state === 'men-tee-error') expect(/where the sleeve is measured from/.test(text) && /not saved/i.test(text), `${vp.name} ${state}: no plain-English error`);
    if (state === 'men-chino-error') expect(/Size 33 is not a waist\/leg size/.test(text) && /not saved/i.test(text), `${vp.name} ${state}: no plain-English W/L error`);
    await page.close();
  }
}
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
