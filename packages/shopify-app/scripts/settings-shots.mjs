#!/usr/bin/env node
/* global document, window */
/**
 * Screenshots and a browser check of the admin page's "Settings" section and the fabric notices of
 * its product list, outside Shopify. Not part of `pnpm check` (needs Chromium from the preinstalled
 * Playwright). Run `pnpm --filter @curtain/shopify-app build` first: the page is the real
 * `renderAdminPage()` output; App Bridge is a stub with a dummy session token and the api is
 * answered in this process (settings kept in memory, products following the choice).
 *
 *   node packages/shopify-app/scripts/settings-shots.mjs <outDir>
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import * as schema from '@curtain/schema';
import { renderAdminPage, APP_BRIDGE_SCRIPT_URL } from '../dist/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out = resolve(process.argv[2] ?? 'test-results/settings');
mkdirSync(out, { recursive: true });

const API = 'https://api.curtain.test';
const SHOP = 'bohohippychic.myshopify.com';
const html = renderAdminPage({ apiKey: 'curtainadmintest01', apiUrl: API, appUrl: 'https://app.curtain.test' });
const respond = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
const ready = { key: 'ready', badge: 'Ready', tone: 'success', text: 'Shoppers get a size for this product.' };
const row = (externalId, name, extra) => ({ externalId, name, category: 'dress', status: 'active', score: 0.8, adviceScore: 80, missingFields: [], flatLayProcessedUrl: null, updatedAt: '2026-11-20T00:00:00.000Z', next: ready, notices: { defaulted: [], leftOut: [] }, ...extra });

function harness() {
  const settings = { incompleteProductData: 'let-through', showFitByCurtain: true, shopName: 'Boho Hippy Chic', platform: 'shopify', brandColor: null, logoUrl: null };
  const puts = [];
  const links = [];
  const products = () => {
    const hold = settings.incompleteProductData === 'hold-back';
    const held = { status: 'incomplete', heldBack: { reason: 'incomplete_product_data', fields: ['fabric.stretchPct'] } };
    const items = [
      row('301', 'Linen wrap dress'),
      row('302', 'Boho kaftan', { notices: { defaulted: ['fabric.stretchPct'], leftOut: [{ field: 'fabric.stretchPct', reason: 'validator text, never shown' }] }, ...(hold ? { ...held, notices: { defaulted: [], leftOut: [{ field: 'fabric.stretchPct', reason: 'validator text, never shown' }] } } : {}) }),
      row('303', 'Jersey maxi skirt', { category: 'bottom', notices: { defaulted: ['fabric.stretchPct', 'fabric.drape'], leftOut: [] }, ...(hold ? { ...held, notices: { defaulted: [], leftOut: [] } } : {}) }),
    ];
    return { items, counts: { active: items.filter((p) => p.status === 'active').length, incomplete: items.filter((p) => p.status === 'incomplete').length, archived: 0 }, nextCursor: null };
  };
  const api = async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return respond(route, 204, {});
    const p = new URL(req.url()).pathname;
    if (p === '/shopify/token-exchange') return respond(route, 200, { shop: SHOP, publicKeyPrefix: 'pk_demo', backfillQueued: false });
    if (p === '/v1/merchant/products') return respond(route, 200, products());
    if (p === '/v1/merchant/usage') return respond(route, 200, { from: '', to: '', days: [], totals: { fitSessions: 0, heroRenders: 0, costUsd: 0 }, plan: { name: 'curtain', priceUsdPerMonth: 8.99, periodStart: '2026-11-01', periodEnd: '2026-11-30', sessionsUsedThisPeriod: 0, paused: false } });
    if (p === '/v1/merchant/ledger') return respond(route, 200, { entries: [], nextCursor: null });
    if (p === '/v1/merchant/charts/templates') return respond(route, 200, schema.chartTemplatesDto());
    if (p === '/shopify/charts/onboarding') return respond(route, 200, { steps: [], next: null, headline: '', doneCount: 0, total: 5, state: { templateId: null, themeBlockConfirmed: false, tested: false } });
    if (p === '/v1/merchant/console-link' && req.method() === 'POST') {
      links.push(req.headers().authorization ?? '');
      return respond(route, 200, { url: CONSOLE_LINK, expiresAt: '2026-11-20T10:10:00.000Z' });
    }
    if (p === '/shopify/settings' && req.method() === 'GET') return respond(route, 200, settings);
    if (p === '/shopify/settings' && req.method() === 'PUT') {
      const parsed = schema.MerchantSettingsUpdateRequestSchema.safeParse(JSON.parse(req.postData() ?? '{}'));
      if (!parsed.success) return respond(route, 400, { error: { code: 'bad_request', message: 'bad request' } });
      puts.push(parsed.data);
      Object.assign(settings, parsed.data);
      return respond(route, 200, settings);
    }
    return respond(route, 404, { error: { code: 'not_found', message: `harness: ${req.method()} ${p}` } });
  };
  return { api, puts, settings, links };
}

// A made-up link in the api's shape; the console itself is a stand-in page here.
const CONSOLE_LINK = 'https://app.curtain.test/merchant/link#t=cl_' + 'demo'.repeat(10) + 'abc';
const failures = [];
const expect = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const T = schema.SHOP_SETTINGS_TEXT;
const N = schema.PRODUCT_NOTICE_TEXT;
const C = schema.CONSOLE_LINK_TEXT;

const browser = await chromium.launch();
for (const vp of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  const h = harness();
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(APP_BRIDGE_SCRIPT_URL, (r) => r.fulfill({ contentType: 'application/javascript', body: `window.shopify = { config: { shop: '${SHOP}' }, idToken: async () => 'dummy.session.token', resourcePicker: async () => [] };` }));
  await page.route(`${API}/**`, h.api);
  await page.route('https://admin.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`https://admin.test/shopify/admin?shop=${SHOP}`);
  await page.locator('#settings-policy-let-through').waitFor();
  await page.locator('[data-notices="302"]').waitFor();
  const shot = (sel, name) => page.locator(sel).screenshot({ path: join(out, `shopify-${vp.name}-${name}.png`) });

  expect(await page.locator('#settings-policy-let-through').isChecked(), `${vp.name}: "show size advice anyway" is not the chosen default`);
  expect(await page.locator('#settings-wordmark').isChecked(), `${vp.name}: the wordmark switch is not on by default`);
  expect((await page.locator('[data-notices="302"]').innerText()).includes('so size advice assumes the fabric does not stretch'), `${vp.name}: the left-out stretch line is missing`);
  expect((await page.locator('[data-notices="303"]').innerText()) === N.stretchAssumed, `${vp.name}: the "no stretch given" line is missing`);
  expect(!(await page.locator('#products').innerText()).includes('validator text'), `${vp.name}: the validator's own text is shown`);
  await shot('#settings', '01-settings-default');
  await shot('#products', '02-products-notices');

  // Keyboard only: focus the chosen radio, arrow down to "hold back".
  await page.locator('#settings-policy-let-through').focus();
  await page.keyboard.press('ArrowDown');
  await page.locator('[data-notice="held-back"]').first().waitFor();
  expect(JSON.stringify(h.puts) === JSON.stringify([{ incompleteProductData: 'hold-back' }]), `${vp.name}: PUT bodies are ${JSON.stringify(h.puts)}`);
  expect((await page.locator('#settings-status').innerText()) === T.saved, `${vp.name}: status is not "${T.saved}"`);
  expect((await page.locator('#settings-held-now').innerText()) === schema.heldNowText(2), `${vp.name}: held-now line is wrong`);
  expect((await page.evaluate(() => document.activeElement?.id)) === 'settings-policy-hold-back', `${vp.name}: focus left the chosen radio after the save`);
  expect((await page.locator('#products-body .badge-critical').count()) === 2, `${vp.name}: two products should carry the "${N.heldBack}" chip`);

  // The switch, with the space bar.
  await page.locator('#settings-wordmark').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#settings-wordmark').getAttribute('aria-checked') === 'false' && !document.querySelector('#settings-wordmark').disabled);
  expect(h.settings.showFitByCurtain === false, `${vp.name}: the switch did not save`);
  // A held-back row says where in Shopify the stretch goes, shows no score, and on a phone its chip is not cut off.
  expect((await page.locator('#products-body [data-where="fabric"]').first().innerText()) === N.heldBackWhereShopify, `${vp.name}: the "where" line of a held-back product is missing`);
  expect((await page.locator('#products-body [data-where="fabric"]').count()) === 2, `${vp.name}: each held-back product should say where the fabric goes`);
  expect((await page.locator('#products-body .score').count()) === 1, `${vp.name}: only the product that gives size advice shows a score`);
  const cut = await page.evaluate(() => {
    const box = document.querySelector('#products .products-table').parentElement;
    const edge = box.getBoundingClientRect().right;
    return { inner: box.scrollWidth - box.clientWidth, chips: Array.from(document.querySelectorAll('#products-body .badge')).filter((b) => b.getBoundingClientRect().right > edge + 0.5).length };
  });
  expect(cut.inner <= 0 && cut.chips === 0, `${vp.name}: the product list is cut off (${cut.inner}px sideways, ${cut.chips} chips past the edge)`);
  await shot('#settings', '03-settings-hold-back-wordmark-off');
  await shot('#products', '04-products-held-back');

  // "Change the setting" under a held-back product goes to the section.
  await page.locator('[data-notice="held-back"] a').first().click();
  expect((await page.evaluate(() => document.activeElement?.id)) === 'h-settings', `${vp.name}: the link did not move focus to Settings`);

  // "Open the full console": a new tab, opened in the click, sent to the one-time link.
  await page.context().route('https://app.curtain.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>console</title>' }));
  expect((await page.locator('#btn-console').innerText()) === C.open, `${vp.name}: the console button says "${await page.locator('#btn-console').innerText()}"`);
  const [tab] = await Promise.all([page.waitForEvent('popup'), page.locator('#btn-console').click()]);
  await tab.waitForURL(CONSOLE_LINK);
  expect(JSON.stringify(h.links) === JSON.stringify(['Bearer dummy.session.token']), `${vp.name}: console-link calls ${JSON.stringify(h.links)}`);
  expect((await tab.evaluate(() => window.opener)) === null, `${vp.name}: the console tab can reach the admin page (opener)`);
  await page.waitForFunction(() => !document.querySelector('#btn-console').disabled);
  expect((await page.locator('#console-link-status').innerText()) === '', `${vp.name}: a status line stayed after the console opened`);
  expect(!(await page.content()).includes('merchant/link'), `${vp.name}: the link stayed on the admin page`);
  await tab.close();

  // No sideways scroll of the page on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 0, `${vp.name}: the page scrolls sideways by ${overflow}px`);
  expect(errors.length === 0, `${vp.name}: page errors ${errors.join('; ')}`);
  await page.close();
}
await browser.close();
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`settings-shots: ok, pictures in ${out}`);
