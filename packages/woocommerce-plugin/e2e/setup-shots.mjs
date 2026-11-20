#!/usr/bin/env node
/**
 * Phone and desktop screenshots (deviceScaleFactor 2) of the WooCommerce merchant's first run, rendered
 * OUTSIDE WordPress with the test shims: the settings page's "Get set up" box in each state, and the
 * product meta box's garment measurements with the "What to measure" drawing. For the real WordPress run
 * use e2e/run.mjs (Docker).
 *
 *   node packages/woocommerce-plugin/e2e/setup-shots.mjs [outDir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? 'test-results/woo-setup');
mkdirSync(out, { recursive: true });
const css = readFileSync(join(root, 'assets/admin/meta-box.css'), 'utf8');
const svg = readFileSync(join(root, 'assets/admin/skirt-measure.svg'));
// A stand-in for wp-admin's look.
const base = `body{margin:0;background:#f0f0f1;color:#3c434a;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{margin:10px 20px}.card{background:#fff;border:1px solid #c3c4c7;box-sizing:border-box}.description{color:#646970}
.button{display:inline-block;border:1px solid #2271b1;color:#2271b1;border-radius:3px;padding:0 10px;line-height:2.15;min-height:30px;background:#f6f7f7;text-decoration:none;font:inherit;cursor:pointer}
.button-primary{background:#2271b1;color:#fff}.notice-success{border-left:4px solid #00a32a;background:#fff;padding:1px 12px}
.postbox{background:#fff;border:1px solid #c3c4c7;margin:16px;padding:0 12px 12px}.postbox h2{font-size:14px;margin:0 -12px 8px;padding:8px 12px;border-bottom:1px solid #c3c4c7}
input[type=text],select{border:1px solid #8c8f94;border-radius:4px;padding:0 8px;min-height:30px;font:inherit;background:#fff}
@media (max-width:782px){.wrap{margin:8px}input[type=text],select{min-height:40px;font-size:16px}}`;
const doc = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}\n${css}</style></head><body>${body}</body></html>`;
const failures = [];
const browser = await chromium.launch();
const views = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
];
for (const state of ['new', 'chart', 'measured', 'done']) {
  const html = execFileSync('php', [join(root, 'e2e/render-setup.php'), state], { encoding: 'utf8' });
  for (const vp of views) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    await page.setContent(doc(`<div class="wrap"><h1>Curtain for WooCommerce</h1>${html}</div>`));
    await page.locator('.wrap').screenshot({ path: join(out, `woo-setup-${state}-${vp.name}.png`) });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > vp.width) failures.push(`${state} ${vp.name}: scrolls sideways (${sw})`);
    await page.close();
  }
}
const box = execFileSync('php', [join(root, 'e2e/render-meta-box.php'), 'measured'], { encoding: 'utf8' });
for (const vp of views) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  await page.route('https://shop.example/**/skirt-measure.svg', (r) => r.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.setContent(doc(`<div class="postbox"><h2>Curtain fit data</h2>${box}</div>`));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.locator('#curtain-tape').screenshot({ path: join(out, `woo-measure-help-${vp.name}.png`) });
  if (!/What to measure/.test(await page.locator('#curtain-tape').innerText())) failures.push(`${vp.name}: no measuring help`);
  await page.close();
}
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
