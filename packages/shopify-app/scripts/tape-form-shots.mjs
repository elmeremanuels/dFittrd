#!/usr/bin/env node
/* global document */
/**
 * Screenshots and a browser check of the admin page's "Garment measurements" form, outside Shopify.
 * Not part of `pnpm check` (needs Chromium from the preinstalled Playwright).
 *
 * The page is the real `renderAdminPage()` output. App Bridge is replaced by a stub that hands out a
 * dummy session token, and the api is answered in this process: the garment-tape routes run the
 * real `checkGarmentTapeInput` from @curtain/schema on the pilot skirt's chart (what the api does,
 * minus Shopify); the other panels get small canned answers. So the form, its checks and its
 * estimates are real; the store, the products list and the usage panel are not.
 *
 * Flow: open the skirt → tick AU 8, 10, 14 and type the shop's numbers (as the shop sent them,
 * flat hem widths for AU 8 and 10 doubled) → pick "Pull-on" → the estimates for AU 12 and 16 appear
 * labelled → save. Then a mistake (stretched band below the relaxed one) shows the error and blocks
 * the save. Phone (390 px) and desktop (1280 px).
 *
 *   node packages/shopify-app/scripts/tape-form-shots.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { checkGarmentTapeInput, collapseSharedDepthIssues, measuredFromGarmentTape, PILOT_SKIRT_CHART_ONLY, PILOT_SKIRT_TAPE_MEASURED } from '@curtain/schema';
import { renderAdminPage, APP_BRIDGE_SCRIPT_URL } from '../dist/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out = resolve(process.argv[2] ?? 'test-results/tape-form');
mkdirSync(out, { recursive: true });

const API = 'https://api.curtain.test';
const SHOP = 'bohohippychic.myshopify.com';
const PRODUCT = '10894387020081';
const chart = PILOT_SKIRT_CHART_ONLY.sizeChart;
const html = renderAdminPage({ apiKey: 'curtainadmintest01', apiUrl: API, appUrl: 'https://app.curtain.test' });

let stored = { closure: null, garmentTape: null };
const respond = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });

function tapeAnswer(closure, measured, written = []) {
  const check = checkGarmentTapeInput({ category: 'bottom', chart, closure, measured });
  check.errors = collapseSharedDepthIssues(check.errors, measured.find((m) => m.hipDepthBelowBandCm != null)?.hipDepthBelowBandCm);
  check.ok = check.errors.length === 0;
  return {
    check,
    body: {
      productId: PRODUCT,
      category: 'bottom',
      sizes: chart.map((r) => r.size),
      closure: check.closure ?? null,
      measured: check.ok && check.garmentTape ? measuredFromGarmentTape(check.garmentTape) : measured,
      garmentTape: check.garmentTape ?? null,
      errors: check.errors,
      warnings: check.warnings,
      written,
      syncQueued: written.length > 0,
    },
  };
}

async function api(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return respond(route, 204, {});
  const url = new URL(req.url());
  const p = url.pathname;
  if (p === '/shopify/token-exchange') return respond(route, 200, { shop: SHOP, publicKeyPrefix: 'pk_demo', backfillQueued: false });
  if (p === '/v1/merchant/products')
    return respond(route, 200, { items: [{ externalId: PRODUCT, name: 'Crimson Wildflower Maxi Skirt', category: 'bottom', status: 'active', score: 0.72, missingFields: ['flatLayPhoto'], updatedAt: '2026-11-18T10:00:00.000Z' }], counts: { active: 1, incomplete: 0 }, nextCursor: null });
  if (p === '/v1/merchant/usage') return respond(route, 503, { error: { code: 'demo', message: 'not in this screenshot harness' } });
  if (p === '/v1/merchant/ledger') return respond(route, 200, { entries: [], nextCursor: null });
  if (p === '/v1/merchant/charts/templates') return respond(route, 200, { templates: [] });
  if (p === '/shopify/charts/onboarding') return respond(route, 200, { steps: [], next: null, state: { templateId: 'au-womens-body', themeBlockConfirmed: true, tested: false } });
  if (p === `/shopify/products/${PRODUCT}/checklist`)
    return respond(route, 200, { productId: PRODUCT, title: 'Crimson Wildflower Maxi Skirt', status: 'active', previewUrl: 'https://bohohippychic.com.au/products/crimson-wildflower-maxi-skirt', adminUrl: `https://${SHOP}/admin/products/${PRODUCT}`, items: [{ key: 'sizeChart', label: 'Size chart', done: true, required: true, hint: 'AU 8 to 16, body measurements' }] });
  if (p === `/shopify/products/${PRODUCT}/garment-tape` && req.method() === 'GET') {
    const measured = measuredFromGarmentTape(stored.garmentTape);
    return respond(route, 200, { ...tapeAnswer(stored.closure, measured).body, garmentTape: stored.garmentTape });
  }
  if (p === `/shopify/products/${PRODUCT}/garment-tape` && req.method() === 'PUT') {
    const body = JSON.parse(req.postData() ?? '{}');
    const { check, body: answer } = tapeAnswer(body.closure, body.measured);
    if (body.dryRun) return respond(route, 200, answer);
    if (!check.ok) return respond(route, 422, { error: { code: 'invalid_garment_tape', message: check.errors.map((e) => e.message).join(' '), details: { errors: check.errors, warnings: check.warnings } } });
    stored = { closure: check.closure ?? null, garmentTape: check.garmentTape ?? null };
    return respond(route, 200, { ...answer, written: ['closure', 'garment_tape'], syncQueued: true });
  }
  return respond(route, 404, { error: { code: 'not_found', message: `harness: ${req.method()} ${p}` } });
}

const failures = [];
const expect = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const browser = await chromium.launch();
for (const vp of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  stored = { closure: null, garmentTape: null };
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.name === 'phone' ? 2 : 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(APP_BRIDGE_SCRIPT_URL, (r) => r.fulfill({ contentType: 'application/javascript', body: `window.shopify = { config: { shop: '${SHOP}' }, idToken: async () => 'dummy.session.token' };` }));
  await page.route(`${API}/**`, api);
  await page.route('https://admin.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`https://admin.test/shopify/admin?shop=${SHOP}`);
  await page.locator(`[data-product="${PRODUCT}"]`).first().click();
  await page.locator('#tape-body tr').first().waitFor();

  await page.selectOption('#tape-closure', 'pull-on');
  for (const row of PILOT_SKIRT_TAPE_MEASURED) {
    const tr = page.locator(`#tape-body tr[data-size="${row.size}"]`);
    await tr.locator('input[type=checkbox]').check();
    for (const [field, key] of [['waistRelaxed', 'waistRelaxedCm'], ['waistStretched', 'waistStretchedCm'], ['hip', 'hipCm'], ['hemSweep', 'hemSweepCm'], ['length', 'lengthCm']]) {
      await tr.locator(`input[data-field="${field}"]`).fill(String(row[key]));
    }
  }
  await page.waitForFunction(() => document.querySelector('#tape-body tr[data-size="12"] .prov')?.textContent === 'estimated');
  const au12 = await page.locator('#tape-body tr[data-size="12"] input[data-field="waistStretched"]').inputValue();
  const au16 = await page.locator('#tape-body tr[data-size="16"] .prov').first().textContent();
  expect(au12 === '105', `${vp.name}: AU 12 stretched band estimate is ${au12}, expected 105`);
  expect(au16 === 'rough estimate', `${vp.name}: AU 16 is labelled "${au16}", expected "rough estimate"`);
  const warn = await page.locator('#tape-issues').innerText();
  expect(/Size 16 lies outside the measured sizes/.test(warn), `${vp.name}: no edge warning for AU 16`);
  expect(/no distance below the band/.test(warn), `${vp.name}: no hip depth warning`);
  await page.locator('#tape-panel').screenshot({ path: join(out, `shopify-${vp.name}-1-estimates.png`) });

  await page.fill('#tape-depth', '20');
  await page.waitForFunction(() => !/no distance below the band/.test(document.querySelector('#tape-issues')?.textContent ?? ''));
  await page.click('#tape-save');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#tape-status')?.textContent ?? ''));
  expect(stored.closure === 'pull-on' && stored.garmentTape?.length === 5, `${vp.name}: save did not store the closure and five sizes`);
  await page.locator('#tape-panel').screenshot({ path: join(out, `shopify-${vp.name}-2-saved.png`) });

  await page.locator('#tape-body tr[data-size="14"] input[data-field="waistStretched"]').fill('78');
  await page.waitForFunction(() => document.querySelector('#tape-issues .note-critical') !== null);
  expect(await page.locator('#tape-save').isDisabled(), `${vp.name}: save stays enabled with an error`);
  expect((await page.locator('#tape-body tr[data-size="14"] input[data-field="waistStretched"]').getAttribute('aria-invalid')) === 'true', `${vp.name}: the wrong input is not marked`);
  expect(await page.locator('#tape-table.stale').count() === 1 && (await page.locator('#tape-stale').isVisible()), `${vp.name}: the estimates are not marked as from the last valid numbers`);
  await page.locator('#tape-panel').screenshot({ path: join(out, `shopify-${vp.name}-3-error.png`) });

  // A hip depth out of range: one message, on the depth input, not once per size with a hip.
  await page.locator('#tape-body tr[data-size="14"] input[data-field="waistStretched"]').fill('110');
  await page.fill('#tape-depth', '90');
  await page.waitForFunction(() => /\(90 cm\)/.test(document.querySelector('#tape-issues')?.textContent ?? ''));
  const depthMsgs = (await page.locator('#tape-issues').innerText()).match(/hip depth below the band/g) ?? [];
  expect(depthMsgs.length === 1, `${vp.name}: the depth error is said ${depthMsgs.length} times`);
  expect((await page.locator('#tape-depth').getAttribute('aria-invalid')) === 'true', `${vp.name}: the depth input is not marked`);
  await page.locator('#tape-panel').screenshot({ path: join(out, `shopify-${vp.name}-4-depth-error.png`) });
  const clipped = await page.evaluate(() => { const p = document.querySelector('#tape-panel').getBoundingClientRect(); return [...document.querySelectorAll('#tape-panel input')].filter((e) => e.getBoundingClientRect().right > p.right + 0.5).length; });
  expect(clipped === 0, `${vp.name}: ${clipped} inputs reach past the panel's right edge`);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const wide = await page.evaluate((w) => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${e.className}`), vp.width);
  expect(scrollW <= vp.width, `${vp.name}: the page scrolls sideways (${scrollW} px): ${wide.join(', ')}`);
  expect(errors.length === 0, `${vp.name}: page errors ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
