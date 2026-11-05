#!/usr/bin/env node
/**
 * `pnpm demo:e2e` — Playwright smoke test of the standalone flow (docs/STANDALONE.md §4).
 * Not part of `pnpm check`: it starts the full demo (api + web + storefront) and drives Chromium.
 *
 * For both product page styles of the demo storefront (WooCommerce and Shopify Dawn):
 *   storefront → "Try it on" → overlay (role=dialog) with the /embed iframe → About you →
 *   result → "Choose size X" → the overlay closes and the page's own size control holds X.
 * Then, in the same browser, it reloads the page and opens the overlay again: a returning shopper
 * ("Remember me" is on by default) must land straight on the result (§1.4).
 * Console errors and uncaught exceptions in the page or the iframe fail the flow.
 *
 * Uses the preinstalled Playwright (`require('playwright')`). Reuses services that are already
 * running (e.g. a `pnpm demo` in another terminal). Screenshots of every step go to
 * test-results/demo-e2e/ (git-ignored). Exits non-zero on the first failure.
 *
 * Flags: --skip-build   do not build the packages first
 *        --headed       show the browser
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDemo } from './demo.mjs';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const shots = join(root, 'test-results', 'demo-e2e');
const STEP_TIMEOUT = 30_000;

const PAGES = [
  {
    name: 'woocommerce',
    path: '/product/aalter-studio-1',
    /** The size the page's own variation form now holds (the option's label). */
    pageSize: (page) => page.locator('form.variations_form select[name="attribute_pa_size"]').evaluate((s) => (s.value ? s.selectedOptions[0].text.trim() : '')),
  },
  {
    name: 'shopify-dawn',
    path: '/products/aalter-studio-1',
    pageSize: (page) => page.locator('input[type=radio][name="Size"]:checked').evaluate((r) => r.value).catch(() => ''),
  },
];

const norm = (s) => String(s).trim().toLowerCase();

async function flow(browser, base, spec, log) {
  // A fresh context per page: no remembered profile, so the shopper sees "About you".
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-GB' });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  const errors = [];
  // `console` and `pageerror` fire for every frame of the page, the /embed iframe included.
  page.on('pageerror', (e) => errors.push(`uncaught: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console (${m.location().url || 'page'}): ${m.text()}`);
  });
  const shot = (step) => page.screenshot({ path: join(shots, `${spec.name}-${step}.png` ) });
  try {
    log(`open ${base}${spec.path}`);
    await page.goto(base + spec.path);
    const button = page.getByRole('button', { name: /try it on/i }).first();
    await button.waitFor();
    // The SDK marks the buttons it bound; clicking before that would do nothing.
    await page.waitForSelector('[data-curtain-product][data-curtain-bound]');
    await shot('1-product');

    log('click "Try it on"');
    await button.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const frame = page.frameLocator('[role="dialog"] iframe');

    log('fill About you');
    await frame.getByRole('heading', { name: /about you/i }).waitFor();
    await frame.getByLabel(/height/i).first().fill('170');
    await frame.getByLabel(/weight/i).first().fill('64');
    const regular = frame.getByRole('radio', { name: /^regular$/i });
    if (await regular.count()) await regular.first().check({ force: true });
    else await frame.getByText(/^regular$/i).first().click();
    await shot('2-about-you');
    await frame.getByRole('button', { name: /see my size|show my size|continue/i }).first().click();

    log('wait for the result');
    const choose = frame.getByRole('button', { name: /^choose size\s+\S+/i }).first();
    await choose.waitFor();
    await shot('3-result');
    const label = (await choose.innerText()).trim();
    const size = label.replace(/^choose size\s+/i, '').trim();
    if (!size) throw new Error(`could not read the size from "${label}"`);

    log(`click "${label}"`);
    await choose.click();
    await dialog.waitFor({ state: 'detached' }).catch(() => dialog.waitFor({ state: 'hidden' }));

    const onPage = await spec.pageSize(page);
    await page.waitForTimeout(300); // let the theme's selected-state transition finish for the screenshot
    await shot('4-size-selected');
    if (norm(onPage) !== norm(size)) throw new Error(`the page's size control holds "${onPage}", expected "${size}"`);
    log(`ok: the page now has size ${onPage} selected`);

    log('returning shopper: reload and open the overlay again');
    await page.reload();
    await page.waitForSelector('[data-curtain-product][data-curtain-bound]');
    await page.getByRole('button', { name: /try it on/i }).first().click();
    await page.getByRole('dialog').waitFor();
    const again = page.frameLocator('[role="dialog"] iframe');
    await again.getByRole('button', { name: /^choose size\s+\S+/i }).first().waitFor();
    await again.getByRole('button', { name: /edit my measurements/i }).first().waitFor();
    await shot('5-returning-shopper');
    log('ok: the remembered profile skips straight to the result');

    if (errors.length) throw new Error(`errors in the page or the iframe:\n  ${errors.join('\n  ')}`);
  } catch (err) {
    await shot('failure').catch(() => {});
    throw err;
  } finally {
    await context.close();
  }
}

async function main() {
  mkdirSync(shots, { recursive: true });
  const { chromium } = require('playwright');
  const demo = await startDemo({ build: !process.argv.includes('--skip-build'), log: 'quiet' });
  const stopAll = () => void demo.stop().then(() => process.exit(130));
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  let browser;
  let failed = 0;
  try {
    browser = process.argv.includes('--headed') ? await chromium.launch({ headless: false }) : await chromium.launch();
    for (const spec of PAGES) {
      const log = (m) => console.log(`[${spec.name}] ${m}`);
      try {
        await flow(browser, demo.urls.storefront, spec, log);
      } catch (err) {
        failed++;
        console.error(`[${spec.name}] FAILED: ${err.message.split('\n')[0]}`);
      }
    }
  } finally {
    await browser?.close();
    await demo.stop();
  }
  console.log(failed ? `\ndemo:e2e: ${failed} of ${PAGES.length} flows failed (screenshots in ${shots})` : `\ndemo:e2e: ${PAGES.length} flows passed (screenshots in ${shots})`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`demo:e2e: ${err.message}`);
  process.exit(1);
});
