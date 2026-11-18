#!/usr/bin/env node
/**
 * Phone and desktop screenshots of the meta box's "Garment measurements" table, rendered OUTSIDE
 * WordPress by e2e/render-meta-box.php (the plugin's PHP and CSS, the test shims, a plain stand-in
 * for the WordPress admin's postbox). For the real thing run e2e/run.mjs (Docker).
 *
 *   node packages/woocommerce-plugin/e2e/tape-meta-box-shots.mjs [outDir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? 'test-results/tape-meta-box');
mkdirSync(out, { recursive: true });
const css = readFileSync(join(root, 'assets/admin/meta-box.css'), 'utf8');
// A stand-in for wp-admin's look: system font 13 px, its input borders, a white postbox.
const base = `body{margin:0;background:#f0f0f1;color:#3c434a;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif}
.postbox{background:#fff;border:1px solid #c3c4c7;margin:16px;padding:0 12px 12px}.postbox h2{font-size:14px;margin:0 -12px 8px;padding:8px 12px;border-bottom:1px solid #c3c4c7}
input[type=text],input[type=number],select,textarea{border:1px solid #8c8f94;border-radius:4px;padding:0 8px;min-height:30px;font:inherit;background:#fff;color:#2c3338;box-sizing:border-box}
@media (max-width:782px){.postbox{margin:8px 0}input[type=text],input[type=number],select{min-height:40px;font-size:16px}}`;

const failures = [];
const browser = await chromium.launch();
for (const state of ['measured', 'error']) {
  const html = execFileSync('php', [join(root, 'e2e/render-meta-box.php'), state], { encoding: 'utf8' });
  const page_ = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}\n${css}</style></head><body><div class="postbox"><h2>Curtain fit data</h2>${html}</div></body></html>`;
  for (const vp of [
    { name: 'phone', width: 390, height: 844, scale: 2 },
    { name: 'desktop', width: 1280, height: 900, scale: 1 },
  ]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale });
    await page.setContent(page_);
    await page.locator('#curtain-tape').screenshot({ path: join(out, `woo-${vp.name}-${state}.png`) });
    const text = await page.locator('#curtain-tape').innerText();
    if (state === 'measured' && !/rough estimate/.test(text)) failures.push(`${vp.name}: no rough estimate label`);
    if (state === 'error' && !/were not saved/.test(text)) failures.push(`${vp.name}: no "not saved" message`);
    // Only this section is checked: other parts of the box (the size chart repeater) are wider than a phone already.
    const wide = await page.evaluate((w) => [...document.querySelectorAll('#curtain-tape *')].filter((e) => e.getBoundingClientRect().right > w + 1).map((e) => e.tagName.toLowerCase() + '.' + e.className).slice(0, 5), vp.width);
    if (wide.length) failures.push(`${vp.name} ${state}: wider than the screen: ${wide.join(', ')}`);
    const other = await page.evaluate((w) => [...document.querySelectorAll('.curtain-box > *')].filter((e) => e.getBoundingClientRect().right > w + 1).map((e) => e.tagName.toLowerCase() + '.' + e.className), vp.width);
    if (other.length && vp.name === 'phone' && state === 'measured') console.log(`note (not this change): wider than a phone elsewhere in the box: ${[...new Set(other)].join(', ')}`);
    await page.close();
  }
}
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
