#!/usr/bin/env node
/* global document, scrollY */
/**
 * Screenshots and a browser check of the admin page's "Size charts" builder, outside Shopify.
 * Not part of `pnpm check` (needs Chromium from the preinstalled Playwright).
 *
 * The page is the real `renderAdminPage()` output; App Bridge is a stub that hands out a dummy
 * session token. The api is answered in this process with the real @curtain/schema code:
 * templates are `chartTemplatesDto()`, and "Assign chart" runs `ChartAssignRequestSchema`,
 * `resolveChartSpec` and `checkChart`, as apps/api/src/shopify/charts.ts does (minus Shopify).
 *
 * Flows (phone 390 px and desktop 1280 px, deviceScaleFactor 2):
 *   women-body     the default AU women's body template, as the page opens
 *   women-garment  "dresses & tops, AU 8–16" garment template, empty
 *   men-tee        the men's tee garment template, filled with neck and sleeve, no sleeve convention
 *                  → the plain-English error, then the convention picked → assigned (men's only)
 *   men-chino      the men's chino W/L template, filled, with a size that is not waist/leg (men's only)
 *
 *   node packages/shopify-app/scripts/chart-builder-shots.mjs <outDir> [flow,flow,…]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import * as schema from '@curtain/schema';
import { renderAdminPage, APP_BRIDGE_SCRIPT_URL } from '../dist/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out = resolve(process.argv[2] ?? 'test-results/chart-builder');
const only = process.argv[3] ? process.argv[3].split(',') : ['women-body', 'women-garment', 'men-tee', 'men-chino'];
mkdirSync(out, { recursive: true });

const API = 'https://api.curtain.test';
const SHOP = 'bohohippychic.myshopify.com';
const html = renderAdminPage({ apiKey: 'curtainadmintest01', apiUrl: API, appUrl: 'https://app.curtain.test' });
const respond = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
const assigned = [];

async function api(route) {
  const req = route.request();
  if (req.method() === 'OPTIONS') return respond(route, 204, {});
  const p = new URL(req.url()).pathname;
  if (p === '/shopify/token-exchange') return respond(route, 200, { shop: SHOP, publicKeyPrefix: 'pk_demo', backfillQueued: false });
  if (p === '/v1/merchant/products') return respond(route, 200, { items: [], counts: { active: 0, incomplete: 0 }, nextCursor: null });
  if (p === '/v1/merchant/usage') return respond(route, 503, { error: { code: 'demo', message: 'not in this screenshot harness' } });
  if (p === '/v1/merchant/ledger') return respond(route, 200, { entries: [], nextCursor: null });
  if (p === '/v1/merchant/charts/templates') return respond(route, 200, schema.chartTemplatesDto());
  if (p === '/shopify/charts/onboarding') return respond(route, 200, { steps: [], next: null, state: { templateId: null, themeBlockConfirmed: false, tested: false } });
  if (p === '/shopify/charts/onboarding' && req.method() === 'PUT') return respond(route, 200, {});
  if (p === '/shopify/charts/assign') {
    const parsed = schema.ChartAssignRequestSchema.safeParse(JSON.parse(req.postData() ?? '{}'));
    if (!parsed.success) return respond(route, 400, { error: { code: 'bad_request', message: parsed.error.issues[0]?.message ?? 'bad request' } });
    let chart;
    try {
      chart = schema.resolveChartSpec(parsed.data.chart);
    } catch (err) {
      return respond(route, 400, { error: { code: 'bad_chart', message: err.message } });
    }
    const check = schema.checkChart(chart);
    if (!check.ok) return respond(route, 400, { error: { code: 'invalid_chart', message: check.errors.join(' '), details: { errors: check.errors } } });
    assigned.push(chart);
    return respond(route, 200, { written: ['1'], skipped: [], failed: [], syncQueued: 1, nextCursor: null, chart: { sizeChartType: chart.sizeChartType, sizeChart: chart.sizeChart }, warnings: check.warnings });
  }
  return respond(route, 404, { error: { code: 'not_found', message: `harness: ${req.method()} ${p}` } });
}

const failures = [];
const expect = (cond, msg) => {
  if (!cond) failures.push(msg);
};

async function fill(page, size, point, value) {
  await page.locator(`#chart-body input[aria-label^="Size ${size} "][aria-label*=" ${point} in"]`).fill(String(value));
  await page.locator(`#chart-body input[aria-label^="Size ${size} "][aria-label*=" ${point} in"]`).dispatchEvent('change');
}

const browser = await chromium.launch();
for (const vp of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  for (const flow of only) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(APP_BRIDGE_SCRIPT_URL, (r) => r.fulfill({ contentType: 'application/javascript', body: `window.shopify = { config: { shop: '${SHOP}' }, idToken: async () => 'dummy.session.token', resourcePicker: async () => [{ id: 'gid://shopify/Product/1', title: 'Test product' }] };` }));
    await page.route(`${API}/**`, api);
    await page.route('https://admin.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(`https://admin.test/shopify/admin?shop=${SHOP}`);
    await page.locator('#tpl-list input[type=radio]').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#chart-head th').length > 1);
    const shot = async (step) => {
      await page.locator('#charts').screenshot({ path: join(out, `shopify-${vp.name}-${flow}${step ? '-' + step : ''}.png`) });
      // The editor alone (type, unit, sizes, table, help): compared pixel by pixel before and after for women's charts.
      if (flow.startsWith('women')) {
        // The template list above is longer now (men's garment templates): hide it so the editor sits at the same place.
        await page.addStyleTag({ content: '#tpl-list, #tpl-sources { display: none !important; }' });
        const box = await page.evaluate(() => { const a = document.querySelector('#h-edit').getBoundingClientRect(); const b = document.querySelector('#chart-check').getBoundingClientRect(); return { x: 0, y: a.top + scrollY, width: document.documentElement.clientWidth, height: b.bottom - a.top }; });
        await page.screenshot({ path: join(out, `shopify-${vp.name}-${flow}-editor.png`), clip: box, fullPage: true });
      }
    };

    if (flow === 'women-body') {
      const head = await page.locator('#chart-head').innerText();
      expect(/Bust \(cm\)/.test(head) && /Hip \(cm\)/.test(head), `${vp.name} ${flow}: header is ${head}`);
      await shot('');
    }
    if (flow === 'women-garment') {
      await page.locator('#tpl-garment-au-dress-top').check();
      await page.waitForFunction(() => /Bust/.test(document.querySelector('#chart-head')?.textContent ?? '') && document.querySelectorAll('#chart-body input').length === 15);
      await shot('');
    }
    if (flow === 'men-tee') {
      await page.locator('#tpl-garment-mens-tee').check();
      await page.waitForFunction(() => /Neck/.test(document.querySelector('#chart-head')?.textContent ?? ''));
      const head = await page.locator('#chart-head').innerText();
      expect(/Chest/.test(head) && /Sleeve/.test(head) && /Length/.test(head) && /Neck/.test(head) && !/Bust/.test(head), `${vp.name} ${flow}: header is ${head}`);
      const tee = [
        ['S', 98, 43.5, 70, 20, 42],
        ['M', 106, 44, 72, 21, 43],
        ['L', 114, 45, 74, 22, 44],
        ['XL', 122, 46, 76, 23, 45],
        ['XXL', 131, 47, 78, 24, 46],
      ];
      for (const [size, chest, shoulder, length, sleeve, neck] of tee) {
        await fill(page, size, 'Chest', chest);
        await fill(page, size, 'Shoulder', shoulder);
        await fill(page, size, 'Length', length);
        await fill(page, size, 'Sleeve', sleeve);
        await fill(page, size, 'Neck', neck);
      }
      expect(await page.locator('#sleeve-convention').isVisible(), `${vp.name} ${flow}: no sleeve convention question`);
      await page.locator('#sk-products').check();
      await page.click('#btn-pick-products');
      await page.click('#btn-assign');
      await page.waitForFunction(() => document.querySelector('#chart-check .note-critical') !== null);
      const msg = await page.locator('#chart-check').innerText();
      expect(/where the sleeve is measured from/i.test(msg), `${vp.name} ${flow}: no plain-English convention error: ${msg}`);
      await shot('1-convention-missing');
      await page.locator('input[name="sleeve-convention"][value="shoulder_point"]').check();
      await page.click('#btn-assign');
      await page.waitForFunction(() => /Chart assigned/.test(document.querySelector('#assign-status')?.textContent ?? ''));
      const last = assigned[assigned.length - 1];
      expect(last?.sleeveConvention === 'shoulder_point' && last.sizeChart[0].neck === 42 && last.sizeChart[0].sleeve === 20, `${vp.name} ${flow}: assigned chart is ${JSON.stringify(last)}`);
      await shot('2-assigned');
    }
    if (flow === 'men-chino') {
      await page.locator('#tpl-garment-mens-chino-wl').check();
      await page.waitForFunction(() => /Rise/.test(document.querySelector('#chart-head')?.textContent ?? ''));
      const head = await page.locator('#chart-head').innerText();
      expect(/Seat/.test(head) && /Rise/.test(head) && /Inseam/.test(head) && !/Hip/.test(head), `${vp.name} ${flow}: header is ${head}`);
      const sizes = await page.locator('#chart-body th[scope=row]').allInnerTexts();
      for (const label of sizes) {
        const [w, l] = label.trim().split('/');
        const wi = (Number(w) - 30) / 2;
        await fill(page, label.trim(), 'Waist', 78.5 + 5 * wi);
        await fill(page, label.trim(), 'Seat', 99 + 5 * wi);
        await fill(page, label.trim(), 'Rise', 26 + 0.5 * wi);
        await fill(page, label.trim(), 'Inseam', { 30: 76, 32: 81, 34: 86 }[l]);
      }
      await page.fill('#custom-size', '33');
      await page.click('#btn-add-size');
      await fill(page, '33', 'Waist', 86);
      await page.locator('#sk-products').check();
      await page.click('#btn-pick-products');
      await page.click('#btn-assign');
      await page.waitForFunction(() => document.querySelector('#chart-check .note-critical, #assign-status .note-critical') !== null);
      const msg = (await page.locator('#chart-check').innerText()) + (await page.locator('#assign-status').innerText());
      expect(/waist\/leg/.test(msg), `${vp.name} ${flow}: no plain-English W/L error: ${msg}`);
      await shot('1-not-wl');
      await page.locator('#size-boxes input[value="33"]').uncheck();
      await page.click('#btn-assign');
      await page.waitForFunction(() => /Chart assigned/.test(document.querySelector('#assign-status')?.textContent ?? ''));
      const last = assigned[assigned.length - 1];
      expect(last?.sizeChart.every((r) => r.axes && `${r.axes.waist}/${r.axes.leg}` === r.size) && last.sizeChart.some((r) => r.rise === 26), `${vp.name} ${flow}: assigned chart is ${JSON.stringify(last?.sizeChart?.slice(0, 2))}`);
      writeFileSync(join(out, `assigned-${vp.name}-${flow}.json`), JSON.stringify(last, null, 1));
      await shot('2-assigned');
    }
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollW <= vp.width, `${vp.name} ${flow}: the page scrolls sideways (${scrollW} px)`);
    expect(errors.length === 0, `${vp.name} ${flow}: page errors ${errors.join(' | ')}`);
    await page.close();
  }
}
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
