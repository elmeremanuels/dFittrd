#!/usr/bin/env node
/**
 * Screenshots of the size-ring overlay (route R5 mock) for the three test bodies at chosen sizes,
 * through the dev-only harness (dev/rings.html → src/dev/ringsHarness.tsx) on a phone viewport.
 * Payloads are git-ignored bundle files (spikes/garment-engine/out/eval/<id>/payload.json).
 *
 *   node scripts/rings-shots.mjs <out dir> [payload.json …]
 * Sizes: AU 8 / 12 / 16 for every body (FORCED: a harness render, not a view a shopper can always
 * reach; the embed's "Compare sizes" only offers the sizes next to the advice).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const web = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(web, '..', '..');
const out = resolve(process.argv[2] ?? join(root, 'test-results', 'rings'));
const payloads = process.argv.slice(3).length
  ? process.argv.slice(3).map((p) => resolve(p))
  : ['crimson-wildflower-maxi-skirt', 'azure-palm-baby-doll-dress'].map((id) => join(root, 'spikes', 'garment-engine', 'out', 'eval', id, 'payload.json'));
mkdirSync(out, { recursive: true });

const server = await createServer({ root: web, configFile: join(web, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 1100 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  for (const payload of payloads) {
    if (!existsSync(payload)) {
      console.log(`skip ${payload} (absent)`);
      continue;
    }
    const id = basename(dirname(payload));
    for (const body of ['slim', 'average', 'curvy']) {
      for (const size of ['8', '12', '16']) {
        await page.goto(`${base}/dev/rings.html?payload=/@fs${payload}&body=${body}&size=${size}`);
        await page.getByTestId('size-rings').first().waitFor();
        await page.waitForTimeout(500);
        const rec = await page.getByTestId('harness').getAttribute('data-recommended');
        const file = join(out, `${id}-${body}-au${size}.png`);
        await page.locator('[data-testid="harness"]').screenshot({ path: file });
        const chips = await page.getByTestId('size-ring-text').innerText();
        // On-screen width of the waist ring (CSS px at this 390 px viewport): how much one size step moves it.
        const waistPx = await page.locator('[data-testid="size-ring-waist"] path').nth(2).evaluate((el) => el.getBoundingClientRect().width);
        console.log(`${id} ${body} AU${size} (recommended ${rec}) [waist ring ${waistPx.toFixed(1)} CSS px wide]: ${chips.replace(/\s+/g, ' ').trim()}`);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
