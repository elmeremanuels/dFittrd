#!/usr/bin/env node
/**
 * Phone-size screenshots (390 × 844 CSS px, deviceScaleFactor 2) of settings slice 1: the console's
 * Settings page under both choices, the product list with its notices and with held-back products
 * (also once at 1280 px wide), the popup's stretch line, and the popup with and without "Fit by
 * Curtain".
 *
 *   pnpm exec vite --port 3111 --strictPort &
 *   node scripts/settings-slice1-shots.mjs http://127.0.0.1:3111 ../../docs/screens/claude/settings-slice1
 *
 * A dev build: the popup uses `mock:` tokens (no network), and the console shows its demo data
 * because every api request is aborted here. Nothing in the pictures comes from a real shop.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.argv[2] ?? 'http://127.0.0.1:3111';
const out = process.argv[3] ?? 'shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
/** A fresh phone-size context each time, so a remembered shopper from one picture is not in the next. */
async function phone() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-AU' });
  // Anything off the page's own origin (the api) is aborted: the console falls back to its demo data.
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort('connectionrefused')));
  return context;
}
const shot = (page, name, opts = {}) => page.screenshot({ path: join(out, `${name}.png`), ...opts });

// ---- console -----------------------------------------------------------------------------------
{
  const context = await phone();
  const page = await context.newPage();
  // Not a real key: built in two parts, and the api is unreachable here anyway.
  await page.addInitScript((k) => sessionStorage.setItem('curtain.merchantKey', k), 'sk_' + 'test_' + 'screenshots0001');
  await page.goto(`${base}/merchant/settings`);
  await page.getByTestId('merchant-settings').waitFor();
  await shot(page, '01-settings-page', { fullPage: true });

  // The product list under the standard choice: what was left out and what is assumed. Client-side
  // navigation (the menu), so the demo data keeps the choice made on the Settings page.
  const go = async (name) => {
    await page.getByRole('link', { name, exact: true }).first().click();
  };
  /** From the page title to the end of the last row that carries a notice (taller than one phone screen). */
  const listShot = async (name, lastRow) => {
    const box = await lastRow.locator('xpath=ancestor::tr').boundingBox();
    await shot(page, name, { fullPage: true, clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.ceil(box.y + box.height + 12) } });
  };
  await go('Products');
  await page.locator('[data-testid^="left-out-"]').first().waitFor();
  await listShot('03-products-notices', page.locator('[data-testid^="stretch-assumed-"]').first());

  await go('Settings');
  await page.getByTestId('policy-hold-back').check();
  await page.getByText('Saved.').waitFor();
  await page.getByTestId('show-fit-by-curtain').uncheck();
  await page.getByText('Saved.').waitFor();
  await page.getByTestId('held-now').waitFor();
  await shot(page, '02-settings-hold-back-wordmark-off', { fullPage: true });

  await go('Products');
  await page.locator('[data-testid^="held-back-"]').first().waitFor();
  await listShot('03b-products-held-back', page.locator('[data-testid^="held-back-"]').last());
  // The same list on a wide screen, where the status chip and the next-step column are on screen.
  await page.setViewportSize({ width: 1280, height: 800 });
  await listShot('03c-products-held-back-wide', page.locator('[data-testid^="held-back-"]').last());
  await context.close();
}

// ---- popup -------------------------------------------------------------------------------------
/** `result`: fill the first screen in and picture the result (the top of it, and with `bottom` its end too). */
async function popup(token, name, { result = true, bottom = null } = {}) {
  const context = await phone();
  const page = await context.newPage();
  await page.goto(`${base}/embed/${token}`);
  await page.getByLabel(/^Height/).waitFor();
  if (!result) {
    await shot(page, name, { fullPage: true });
    return context.close();
  }
  await page.getByLabel(/^Height/).fill('168');
  await page.getByLabel(/^Weight/).fill('62');
  await page.getByTestId('see-my-size').click();
  await page.getByTestId('embed-result').waitFor();
  await page.waitForTimeout(600);
  // One phone screen, as a shopper sees it: a full-page capture would draw the button that is fixed
  // to the bottom of the screen across the middle of the page.
  await shot(page, name);
  if (bottom) {
    await page.evaluate(() => {
      const el = document.scrollingElement;
      el.scrollTo(0, el.scrollHeight);
      for (const n of document.querySelectorAll('*')) if (n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY !== 'visible') n.scrollTop = n.scrollHeight;
    });
    await page.waitForTimeout(400);
    await shot(page, bottom);
  }
  await context.close();
}
await popup('mock:nostretch:aalter-studio-1', '04-popup-stretch-line');
await popup('mock:aalter-studio-1', '05-popup-about-with-wordmark', { result: false });
await popup('mock:nomark:aalter-studio-1', '06-popup-about-without-wordmark', { result: false });
await popup('mock:nomark:aalter-studio-1', '07-popup-result-without-wordmark', { bottom: '08-popup-result-end-without-wordmark' });

await browser.close();
console.log(`wrote screenshots to ${out}`);
