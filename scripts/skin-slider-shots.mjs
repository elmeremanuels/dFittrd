#!/usr/bin/env node
/**
 * `node scripts/skin-slider-shots.mjs` — screenshots of the skin slider (CUR-28, WO-015) at the
 * three widths the work order asks for (360, 390, 430 px).
 *
 * Start the demo in another terminal first:
 *     pnpm demo --skip-build
 *
 * Then run this script. It opens the WooCommerce product page of aalter-studio-1 in Chromium
 * (headless), clicks "Try it on", fills the About-you form, opens the avatar prompt, turns the
 * skin slider on, picks a value close to Medium (Monk 6, slider = 5/9) and screenshots the dialog
 * at each of the three widths. The shots go to `test-results/skin-slider/`.
 *
 * Needs Playwright's Chromium installed:
 *     pnpm --filter @curtain/web exec playwright install chromium
 */
import { mkdirSync } from 'node:fs';
import { resolve, fileURLToPath } from 'node:path';
import { loadPlaywright } from './lib/playwright.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = resolve(root, 'test-results', 'skin-slider');
mkdirSync(out, { recursive: true });

const WIDTHS = [360, 390, 430];
const STOREFRONT = process.env.DEMO_STOREFRONT ?? 'http://127.0.0.1:3100';
const PRODUCT = '/product/aalter-studio-1';

async function main() {
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        permissions: [],
      });
      const page = await context.newPage();
      await page.goto(`${STOREFRONT}${PRODUCT}`);
      // The storefront may show a cookie banner or a popup; dismiss any modal that covers the page.
      await page.waitForLoadState('networkidle');
      // Click the Curtain "Try it on" button (the SDK mounts an iframe behind it).
      const tryOn = page.locator('[data-curtain-open]');
      if ((await tryOn.count()) === 0) throw new Error(`No [data-curtain-open] on ${STOREFRONT}${PRODUCT}; is the demo running?`);
      await tryOn.click();
      // Find the embed iframe and its frame.
      const iframeEl = await page.waitForSelector('iframe[data-curtain-embed]', { timeout: 15_000 });
      const frame = await iframeEl.contentFrame();
      // Type About-you fields.
      await frame.getByLabel(/^Height/).fill('168');
      await frame.getByLabel(/^Weight/).fill('62');
      await frame.getByTestId('see-my-size').click();
      await frame.getByTestId('embed-result').waitFor({ state: 'visible' });
      // Open the avatar prompt.
      await frame.getByTestId('avatar-open').click();
      const dialog = frame.getByRole('dialog', { name: 'Make the avatar look like you' });
      await dialog.waitFor({ state: 'visible' });
      // Turn the skin slider on and set Monk 6 (slider = 5/9).
      const sw = dialog.getByTestId('avatar-skin-switch');
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
      await dialog.getByTestId('skin-slider-input').evaluate((el) => {
        const input = el;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, String(5 / 9));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // Screenshot the dialog.
      await dialog.screenshot({ path: resolve(out, `slider-${width}.png`) });
      await context.close();
      console.log(`✓ slider-${width}.png`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
