/**
 * The pilot merchant's first run, timed: from "installs the Shopify app" to "the first product shows the
 * Try it on button with good size advice", as a brand-new Bohohippychic would walk it (Australian boho
 * women's fashion, AU sizes 8 to 16, maxi skirts and dresses).
 *
 *   pnpm --filter @curtain/api walk:onboarding [outDir]       (default docs/screens/claude/merchant-onboarding)
 *
 * Not part of `pnpm check` (needs Chromium from the preinstalled Playwright and a Vite dev server).
 *
 * What is real and what is not:
 *   real     the api (this repository's Fastify app on PGlite, every route the admin calls), the embedded
 *            admin page (`GET /shopify/admin`, the real HTML and script), the token exchange, the backfill
 *            job, the chart assign, the garment-tape check and save, the product sync job, the checklist,
 *            the SDK (`/sdk/v1.js`), the storefront button (the demo Dawn page with the theme block's
 *            markup and CSS) and the fitting room (`apps/web` /embed on Vite) that shows the size.
 *   stubbed  Shopify itself: the Admin GraphQL API, webhooks and bulk exports are the offline fake of
 *            `src/test/fakeShopify` (validated against the 2026-10 schema excerpt); App Bridge is a stub
 *            that hands out the fake's session tokens and answers the collection picker. The theme editor
 *            (a Shopify screen) is not driven: its deep link is checked, then the walk goes on.
 *   stand-in The QR code on the phone step points to the shop's real product page on bohohippychic.com.au;
 *            the phone opens the same product on the local demo storefront instead.
 *
 * Every step is timed (machine time) and counted (clicks, characters typed, words on the screens the
 * merchant has to read); `report.json` in the output folder has the numbers and the human-time estimate
 * the report explains.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT_SKIRT_CHART_ONLY, PILOT_SKIRT_TAPE_MEASURED } from '@curtain/schema';
import { upsertProduct } from '../services/products.js';
import { FakeShopify } from '../test/fakeShopify/index.js';
import { makeApp, seedShop } from '../test/helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at run time (not a dependency of the api) */
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright') as any;
// Functions passed to page.evaluate run in the browser; this package compiles without the DOM lib.
declare const document: any;
type HTMLDetailsElement = { open: boolean };

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const out = resolve(process.argv[2] ?? join(repoRoot, 'docs/screens/claude/merchant-onboarding'));
mkdirSync(out, { recursive: true });

const API_PORT = 8788;
const WEB_PORT = 3011;
const STORE_PORT = 5181;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const STORE = `http://localhost:${STORE_PORT}`;
const SHOP = 'bohohippychic.myshopify.com';
const API_KEY = 'b0b0c0c0d0d0e0e0f0f0a1a1b2b2c3c3';
const API_SECRET = 'walk' + '_client_secret_' + 'y'.repeat(24);
const COLLECTION = '501';

// ---- the pilot shop's catalogue (titles, types and AU sizes as Bohohippychic sells them) -------------
const AU = ['8', '10', '12', '14', '16'];
const CATALOGUE = [
  { title: 'Crimson Wildflower Maxi Skirt', handle: 'crimson-wildflower-maxi-skirt', productType: 'Skirts', category: { id: 'gid://shopify/TaxonomyCategory/aa-1-15', name: 'Skirts', fullName: 'Apparel & Accessories > Clothing > Skirts' }, price: '89.95' },
  { title: 'Indigo Tiered Gypsy Maxi Skirt', handle: 'indigo-tiered-gypsy-maxi-skirt', productType: 'Skirts', category: { id: 'gid://shopify/TaxonomyCategory/aa-1-15', name: 'Skirts', fullName: 'Apparel & Accessories > Clothing > Skirts' }, price: '79.95' },
  { title: 'Azure Palm Baby Doll Dress', handle: 'azure-palm-baby-doll-dress', productType: 'Dresses', category: null, price: '99.95' },
  { title: 'Sunset Paisley Wrap Maxi Dress', handle: 'sunset-paisley-wrap-maxi-dress', productType: 'Dresses', category: null, price: '119.95' },
  { title: 'Sage Embroidered Peasant Maxi Dress', handle: 'sage-embroidered-peasant-maxi-dress', productType: 'Dresses', category: null, price: '129.95' },
  { title: 'Rust Crochet Kimono', handle: 'rust-crochet-kimono', productType: 'Kimonos', category: { id: 'gid://shopify/TaxonomyCategory/aa-1-10', name: 'Outerwear', fullName: 'Apparel & Accessories > Clothing > Outerwear' }, price: '69.95', notInCollection: true },
];

// ---- measurement of the merchant's effort -----------------------------------------------------------
interface StepLog {
  key: string;
  title: string;
  machineMs: number;
  clicks: number;
  typedChars: number;
  wordsRead: number;
  /** Work off the screen that the walk cannot do (measuring, the theme editor, picking up a phone), in seconds. */
  offScreenSec: number;
  offScreenWhat: string;
  shots: string[];
}
const steps: StepLog[] = [];
let cur: StepLog | null = null;
let t0 = 0;
function begin(key: string, title: string, offScreenSec = 0, offScreenWhat = ''): void {
  cur = { key, title, machineMs: 0, clicks: 0, typedChars: 0, wordsRead: 0, offScreenSec, offScreenWhat, shots: [] };
  t0 = performance.now();
}
function end(): void {
  if (!cur) return;
  cur.machineMs += performance.now() - t0;
  steps.push(cur);
  cur = null;
}
/** Screenshots are not part of the merchant's time. */
async function untimed<T>(fn: () => Promise<T>): Promise<T> {
  const s = performance.now();
  try {
    return await fn();
  } finally {
    t0 += performance.now() - s;
  }
}
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

async function main(): Promise<void> {
  // ---- the api with the fake Shopify ---------------------------------------------------------------
  const t = await makeApp({
    SHOPIFY_API_KEY: API_KEY,
    SHOPIFY_API_SECRET: API_SECRET,
    SHOPIFY_DISTRIBUTION: 'custom',
    PUBLIC_API_URL: API,
    PUBLIC_APP_URL: WEB,
    CORS_ORIGINS: [STORE, WEB, API].join(','),
    LOG_LEVEL: 'warn',
  });
  const fake = new FakeShopify({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    distribution: 'custom',
    now: () => new Date(),
    deliver: async ({ url, headers, body }) => (await t.app.inject({ method: 'POST', url, headers, payload: body })).statusCode,
  });
  t.fetchMock.on(() => true, (url, init) => fake.fetch(url, init));
  fake.addStore(SHOP, { name: 'Bohohippychic', shopCurrency: 'AUD', billingCurrency: 'AUD', primaryDomain: 'bohohippychic.com.au' });
  const gids: Record<string, string> = {};
  for (const p of CATALOGUE) {
    const fp = fake.addProduct(SHOP, { title: p.title, handle: p.handle, productType: p.productType, price: p.price, currencyCode: 'AUD', sizes: AU, collections: p.notInCollection ? [] : [COLLECTION], ...(p.category ? { category: p.category } : {}), descriptionHtml: '<p>Rayon, lined. Model wears size 10.</p>' });
    gids[p.handle] = fp.id;
  }
  const jobs = setInterval(() => void t.queue.drain().catch(() => {}), 200);
  await t.app.listen({ host: '127.0.0.1', port: API_PORT });

  // ---- the fitting room (Vite) and the demo storefront ---------------------------------------------
  const web: ChildProcess = spawn('pnpm', ['--filter', '@curtain/web', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: repoRoot, env: { ...process.env, VITE_API_URL: API }, stdio: 'ignore', detached: true });
  const demoJson = join(mkdtempSync(join(tmpdir(), 'curtain-walk-')), 'demo.json');
  const { createDemoShopServer } = await import(join(repoRoot, 'apps/demo-shop/server.mjs'));
  const store = createDemoShopServer({ demoJsonPath: demoJson });
  await new Promise<void>((done) => store.listen(STORE_PORT, '127.0.0.1', () => done()));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(WEB + '/')).status < 500) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const browser = await chromium.launch();
  const failures: string[] = [];
  const check = (ok: unknown, msg: string) => {
    if (!ok) failures.push(msg);
  };
  const appBridge = (picker: string) => `window.shopify = { config: { shop: '${SHOP}' }, idToken: () => window.__curtainIdToken(), resourcePicker: async (o) => (${picker})[o.type] || [] };`;
  const pickerAnswer = JSON.stringify({ collection: [{ id: `gid://shopify/Collection/${COLLECTION}`, title: 'Maxi skirts & dresses' }] });
  async function adminPage(viewport: { width: number; height: number }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'en-AU' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', (e: Error) => failures.push(`admin ${viewport.width}px: ${String(e)}`));
    await page.exposeFunction('__curtainIdToken', () => fake.idToken(SHOP));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r: any) => r.fulfill({ contentType: 'application/javascript', body: appBridge(pickerAnswer) }));
    // The admin page opens Shopify screens with target=_top; inside this walk they are not followed.
    await page.route(`https://${SHOP}/**`, (r: any) => r.fulfill({ contentType: 'text/html', body: '<p>Shopify admin (not part of this walk)</p>' }));
    return page;
  }
  const desk = await adminPage({ width: 1280, height: 900 });
  const phoneAdmin = await adminPage({ width: 390, height: 844 });
  const adminUrl = `${API}/shopify/admin?shop=${SHOP}&embedded=1`;

  const shot = async (name: string, opts: { el?: string; full?: boolean } = {}) =>
    untimed(async () => {
      const file = `${name}-desktop.png`;
      if (opts.el) await desk.locator(opts.el).screenshot({ path: join(out, file) });
      else await desk.screenshot({ path: join(out, file), fullPage: opts.full ?? false });
      cur?.shots.push(file);
      // The same screen on a phone, from the same server state.
      await phoneAdmin.goto(adminUrl);
      await phoneAdmin.locator('#setup-list [data-step="connect"] .num.done').waitFor();
      await phoneAdmin.waitForTimeout(300);
      const pfile = `${name}-phone.png`;
      if (opts.el) {
        await phoneAdmin.evaluate((sel: string) => document.querySelector(sel)?.classList.remove('hidden'), opts.el);
        await phoneAdmin.locator(opts.el).screenshot({ path: join(out, pfile) }).catch(() => phoneAdmin.screenshot({ path: join(out, pfile) }));
      } else await phoneAdmin.screenshot({ path: join(out, pfile), fullPage: opts.full ?? false });
      cur?.shots.push(pfile);
    });
  const readStep = async (key: string) => desk.locator(`#setup-list [data-step="${key}"]`).innerText();
  const stepDone = (key: string) => desk.locator(`#setup-list [data-step="${key}"] .num.done`).waitFor({ timeout: 30_000 });
  const click = async (loc: any) => {
    await loc.click();
    if (cur) cur.clicks++;
  };
  const type = async (loc: any, value: string) => {
    await loc.fill(value);
    if (cur) cur.typedChars += value.length;
  };

  // ---- 0. install: the merchant opens the private install link and approves (a Shopify screen) -------
  begin('install', 'Install the app from the private link', 60, 'open the e-mailed install link, read the permissions (products only) and press Install: Shopify screens, not driven');
  fake.install(SHOP);
  end();

  // ---- 1. connect: the app opens in the admin, the token exchange runs, the catalogue comes in -------
  begin('connect', '1. Connect');
  await desk.goto(adminUrl);
  await desk.locator('#setup-list [data-step="connect"] .num.done').waitFor();
  if (cur) cur.wordsRead += words(await desk.locator('#setup').innerText());
  await untimed(async () => {
    // The very first screen, before the import has finished (empty products list).
    await desk.screenshot({ path: join(out, '01-first-open-desktop.png') });
    cur?.shots.push('01-first-open-desktop.png');
  });
  await desk.waitForFunction(() => /6 products brought in/.test(document.querySelector('#setup-list [data-step="connect"]')?.textContent ?? ''), null, { timeout: 60_000 });
  check(/We are bringing in|brought in/.test(await readStep('connect')), 'connect: no import message');
  await shot('01-connected');
  await shot('01-products-before', { el: '#products' });
  end();

  // ---- 2. add a size chart: AU template, untick 18 and 20, assign to the "Maxi skirts & dresses" collection
  begin('chart', '2. Add a size chart');
  await click(desk.locator('#setup-list [data-step="chart"] .acts button').first());
  await desk.locator('input[name="tpl"][value="au-womens-body"]:checked').waitFor();
  if (cur) cur.wordsRead += words(await desk.locator('#charts').innerText()) / 3; // skims the template list, reads the steps
  for (const size of ['18', '20', '6']) {
    const box = desk.locator(`#size-boxes input[value="${size}"]`);
    if ((await box.count()) && (await box.isChecked())) await click(box);
  }
  await shot('02-chart-template', { el: '#charts' });
  await click(desk.locator('#btn-pick-collection'));
  await desk.locator('#sel-collection', { hasText: 'Maxi skirts' }).waitFor();
  await click(desk.locator('#btn-preview'));
  await desk.locator('#assign-status', { hasText: 'match' }).waitFor();
  check(/5 product\(s\) match/.test(await desk.locator('#assign-status').innerText()), 'chart: preview does not count 5 products');
  await click(desk.locator('#btn-assign'));
  await desk.locator('#assign-status .note-success').waitFor();
  await shot('02-chart-assigned', { el: '#charts' });
  await stepDone('chart');
  check(/5 products have a size chart/.test(await readStep('chart')), `chart: ${await readStep('chart')}`);
  await shot('02-checklist');
  end();

  // ---- 3. measure one skirt: the step opens the skirt's measurements with the help next to them -------
  begin('measure', '3. Measure one skirt', 3 * 180, 'measure AU 8, 10 and 14 of the skirt on a table (3 minutes a size, docs/MERCHANT-MEASUREMENTS.md)');
  await click(desk.locator('#setup-list [data-step="measure"] .acts button').first());
  await desk.locator('#tape-body tr').first().waitFor();
  check(/Maxi Skirt/.test(await desk.locator('#h-product').innerText()), `measure: opened ${await desk.locator('#h-product').innerText()} instead of a skirt`);
  if (cur) cur.wordsRead += words(await desk.locator('#tape-panel').innerText());
  await shot('03-measure-help', { el: '#tape-panel' });
  await desk.selectOption('#tape-closure', 'pull-on');
  if (cur) cur.clicks += 2;
  await type(desk.locator('#tape-depth'), '20');
  for (const row of PILOT_SKIRT_TAPE_MEASURED) {
    const tr = desk.locator(`#tape-body tr[data-size="${row.size}"]`);
    await click(tr.locator('input[type=checkbox]'));
    for (const [field, key] of [['waistRelaxed', 'waistRelaxedCm'], ['waistStretched', 'waistStretchedCm'], ['hip', 'hipCm'], ['hemSweep', 'hemSweepCm'], ['length', 'lengthCm']] as const) {
      await type(tr.locator(`input[data-field="${field}"]`), String(row[key]));
    }
  }
  await desk.waitForFunction(() => document.querySelector('#tape-body tr[data-size="12"] .prov')?.textContent === 'estimated');
  await shot('03-measure-filled', { el: '#tape-panel' });
  await click(desk.locator('#tape-save'));
  await desk.waitForFunction(() => /Saved/.test(document.querySelector('#tape-status')?.textContent ?? ''));
  await stepDone('measure');
  await shot('03-measure-saved', { el: '#tape-panel' });
  await shot('03-checklist');
  end();

  // ---- 4. turn the button on: the step links to the theme editor with the block placed ----------------
  begin('button', '4. Turn the button on', 120, 'in the Shopify theme editor: look at the placed block, drag it under the size picker, press Save (a Shopify screen, not driven)');
  const themeHref = await desk.locator('#setup-list [data-step="button"] .acts a').getAttribute('href');
  check(themeHref && themeHref.startsWith(`https://${SHOP}/admin/themes/current/editor?`) && themeHref.includes(`addAppBlockId=${API_KEY}%2Ftry-it-on`) && themeHref.includes('template=product'), `button: theme link ${themeHref}`);
  if (cur) {
    cur.wordsRead += words(await readStep('button'));
    cur.clicks += 1; // "Open the theme editor"
  }
  await shot('04-button');
  end();

  // ---- 5. check it on your phone: the QR code, then the phone opens the product and gets a size --------
  begin('phone', '5. Check it on your phone', 30, 'pick up the phone and point the camera at the code');
  await click(desk.locator('#setup-list [data-step="phone"] .acts button').first());
  await desk.locator('#phone-panel:not(.hidden)').waitFor();
  const qrUrl = await desk.locator('#phone-link').getAttribute('href');
  check(qrUrl === 'https://bohohippychic.com.au/products/crimson-wildflower-maxi-skirt', `phone: the code points to ${qrUrl}`);
  if (cur) cur.wordsRead += words(await desk.locator('#phone-panel').innerText());
  await shot('05-phone-code', { el: '#setup' });

  // The storefront the phone opens: the shop's public key and products as the api has them.
  const installed = await t.handle.db.query.shops.findFirst({ where: (s, { eq }) => eq(s.domain, SHOP) });
  const prods = await t.handle.db.query.products.findMany({ where: (p, { eq }) => eq(p.shopId, installed!.id) });
  const skirtId = gids['crimson-wildflower-maxi-skirt']!.split('/').pop()!;
  writeFileSync(
    demoJson,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      apiUrl: API,
      appUrl: WEB,
      sdkUrl: `${API}/sdk/v1.js`,
      storefrontOrigin: STORE,
      publicKey: installed!.apiKeyPrefix,
      productExternalIds: prods.map((p) => p.externalId),
      shops: [
        {
          key: 'shopify',
          shopId: installed!.id,
          name: 'Bohohippychic',
          platform: 'shopify',
          publicKey: installed!.apiKeyPrefix,
          allowedOrigins: [STORE],
          products: prods.map((p) => ({
            externalId: p.externalId,
            name: p.payload.name,
            brand: 'Bohohippychic',
            category: p.payload.category ?? 'dress',
            priceEur: p.payload.priceEur ?? 60,
            sizes: AU,
            photo: null,
            status: p.status,
            asset3d: null,
            details: { name: p.payload.name, category: p.payload.category ?? 'dress', primaryColorHex: p.payload.name.startsWith('Crimson') ? '#A3243B' : '#7A8F6A', colorways: [{ name: p.payload.name.split(' ')[0], hex: p.payload.name.startsWith('Crimson') ? '#A3243B' : '#7A8F6A' }], sizeChart: p.payload.sizeChart ?? [], sizeChartType: p.payload.sizeChartType, lengthCm: p.payload.lengthCm ?? {} },
          })),
        },
      ],
    }),
  );
  const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-AU' });
  const shopper = await phone.newPage();
  shopper.setDefaultTimeout(45_000);
  shopper.on('pageerror', (e: Error) => failures.push(`storefront: ${String(e)}`));
  await shopper.goto(`${STORE}/products/${skirtId}?peek=off`);
  await shopper.waitForSelector('[data-curtain-product][data-curtain-bound]');
  await untimed(() => shopper.screenshot({ path: join(out, '05-phone-product.png') }));
  cur?.shots.push('05-phone-product.png');
  await click(shopper.getByRole('button', { name: /try it on/i }).first());
  await shopper.getByRole('dialog').waitFor();
  const frame = shopper.frameLocator('[role="dialog"] iframe');
  await frame.getByRole('heading', { name: /about you/i }).waitFor();
  await type(frame.getByLabel(/height/i).first(), '168');
  await type(frame.getByLabel(/weight/i).first(), '64');
  await click(frame.getByRole('button', { name: /see my size|show my size|continue/i }).first());
  const choose = frame.getByRole('button', { name: /^choose size\s+\S+/i }).first();
  await choose.waitFor();
  const size = (await choose.innerText()).replace(/^choose size\s+/i, '').trim();
  check(AU.includes(size), `phone: recommended "${size}", not an AU size`);
  check(/estimate/i.test(await frame.locator('body').innerText()), 'phone: the size is not labelled an estimate');
  await untimed(() => shopper.screenshot({ path: join(out, '05-phone-size.png') }));
  cur?.shots.push('05-phone-size.png');
  // Back at the admin: steps 4 and 5 tick themselves (a Try it on was opened, a size was shown).
  await desk.reload();
  await stepDone('phone');
  await stepDone('button');
  check(/All done/.test(await desk.locator('#setup-progress').innerText()), 'phone: the list is not all done');
  await shot('05-all-done');
  await shot('06-products-after', { el: '#products' });
  end();

  // ---- extra screens: the plan with "Leaving Curtain" open, and two error states ----------------------
  await desk.evaluate(() => {
    const d = document.getElementById('leaving') as HTMLDetailsElement | null;
    if (d) d.open = true;
  });
  await desk.locator('#h-usage').scrollIntoViewIfNeeded();
  await desk.locator('section[aria-labelledby="h-usage"]').screenshot({ path: join(out, '07-plan-and-leaving-desktop.png') });
  await phoneAdmin.goto(adminUrl);
  await phoneAdmin.locator('#setup-list [data-step="connect"] .num.done').waitFor();
  await phoneAdmin.evaluate(() => {
    const d = document.getElementById('leaving') as HTMLDetailsElement | null;
    if (d) d.open = true;
  });
  await phoneAdmin.locator('section[aria-labelledby="h-usage"]').screenshot({ path: join(out, '07-plan-and-leaving-phone.png') });
  // Curtain unreachable: the merchant is told what to do, without an HTTP code.
  const offline = await adminPage({ width: 1280, height: 700 });
  await offline.route(`${API}/v1/**`, (r: any) => r.abort('internetdisconnected'));
  await offline.route(`${API}/shopify/token-exchange`, (r: any) => r.abort('internetdisconnected'));
  await offline.goto(adminUrl);
  await offline.locator('#banner.show').waitFor();
  check(/could not reach Curtain/.test(await offline.locator('#banner').innerText()), 'offline: no plain message');
  await offline.screenshot({ path: join(out, '08-error-offline-desktop.png') });
  // Opened outside Shopify (no App Bridge): one plain sentence on where to open it.
  const bare = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await bare.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r: any) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await bare.goto(`${API}/shopify/admin?shop=${SHOP}`);
  await bare.locator('#banner.show').waitFor();
  check(/Apps → Curtain/.test(await bare.locator('#banner').innerText()), 'outside Shopify: no plain message');
  await bare.screenshot({ path: join(out, '08-error-outside-shopify-phone.png') });

  // ---- the merchant console, for a WooCommerce pilot shop (same checklist, from GET /v1/merchant/setup) --
  {
    const woo = await seedShop(t, { platform: 'woocommerce', domain: 'bohohippychic.com.au', name: 'Bohohippychic', products: [] });
    await upsertProduct(t.handle.db, woo.shop.id, 'crimson-wildflower-maxi-skirt', { ...PILOT_SKIRT_CHART_ONLY, productUrl: 'https://bohohippychic.com.au/product/crimson-wildflower-maxi-skirt/' });
    const { sizeChart: _c, sizeChartType: _t, ...noChart } = PILOT_SKIRT_CHART_ONLY;
    await upsertProduct(t.handle.db, woo.shop.id, 'sunset-paisley-wrap-maxi-dress', { ...noChart, name: 'Sunset Paisley Wrap Maxi Dress', category: 'dress' });
    for (const vp of [
      { name: 'desktop', viewport: { width: 1280, height: 900 } },
      { name: 'phone', viewport: { width: 390, height: 844 } },
    ]) {
      const ctx = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: 2, locale: 'en-AU' });
      const page = await ctx.newPage();
      page.on('pageerror', (e: Error) => failures.push(`console ${vp.name}: ${String(e)}`));
      await page.goto(`${WEB}/merchant/login`);
      await page.locator('#merchant-key').fill('not-a-key');
      await page.getByRole('button', { name: /open console/i }).click();
      await page.locator('#merchant-key-error').waitFor();
      await page.screenshot({ path: join(out, `09-console-login-error-${vp.name}.png`) });
      await page.locator('#merchant-key').fill(woo.apiKey);
      await page.getByRole('button', { name: /open console/i }).click();
      await page.getByTestId('setup-checklist').waitFor();
      check(/2 of 5 done/.test(await page.getByTestId('setup-progress').innerText()), `console ${vp.name}: ${await page.getByTestId('setup-progress').innerText()}`);
      await page.screenshot({ path: join(out, `09-console-setup-${vp.name}.png`), fullPage: true });
      await page.getByRole('button', { name: /show the code/i }).click();
      await page.getByTestId('phone-check').waitFor();
      await page.getByTestId('setup-checklist').screenshot({ path: join(out, `09-console-phone-code-${vp.name}.png`) });
      await page.goto(`${WEB}/merchant/products`);
      await page.getByTestId('where-to-do-it').waitFor();
      check(/Curtain” box/.test(await page.getByTestId('where-to-do-it').innerText()), `console ${vp.name}: no WordPress hint`);
      await page.screenshot({ path: join(out, `09-console-products-${vp.name}.png`), fullPage: true });
      await page.goto(`${WEB}/merchant/usage`);
      await page.getByTestId('leaving').waitFor();
      await page.evaluate(() => {
        const d = document.querySelector('[data-testid="leaving"]') as HTMLDetailsElement | null;
        if (d) d.open = true;
      });
      await page.screenshot({ path: join(out, `09-console-plan-${vp.name}.png`), fullPage: true });
      await ctx.close();
    }
  }

  // ---- uninstall: the button goes, the shop is paused, its data is due for deletion in 48 hours -------
  begin('uninstall', 'Uninstall (when leaving)', 30, 'Settings → Apps and sales channels → Curtain → Uninstall (a Shopify screen)');
  await fake.uninstall(SHOP);
  const gone = await t.handle.db.query.shops.findFirst({ where: (s, { eq }) => eq(s.domain, SHOP) });
  check(gone?.uninstalledAt && gone.paused && gone.purgeAfter && gone.purgeAfter.getTime() - gone.uninstalledAt.getTime() === 48 * 3600_000, 'uninstall: the shop is not paused with a 48-hour purge');
  const sess = await fetch(`${API}/v1/sdk/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', origin: STORE }, body: JSON.stringify({ shopKeyPrefix: installed!.apiKeyPrefix, productExternalId: skirtId, surface: 'embed', pageUrl: `${STORE}/products/${skirtId}` }) });
  check(sess.status === 404, `uninstall: the button still opens a session (${sess.status})`);
  end();

  // ---- the numbers -------------------------------------------------------------------------------------
  const SEC_PER_CLICK = 3;
  const SEC_PER_CHAR = 0.4;
  const WORDS_PER_MIN = 180;
  const rows = steps.map((s) => {
    const screenSec = s.clicks * SEC_PER_CLICK + s.typedChars * SEC_PER_CHAR + (s.wordsRead / WORDS_PER_MIN) * 60;
    return { ...s, machineSec: Math.round(s.machineMs / 100) / 10, onScreenSec: Math.round(screenSec), humanMin: Math.round(((screenSec + s.offScreenSec) / 60) * 10) / 10 };
  });
  const setupRows = rows.filter((r) => r.key !== 'uninstall');
  const total = {
    machineSec: Math.round(setupRows.reduce((n, r) => n + r.machineSec, 0) * 10) / 10,
    humanMin: Math.round(setupRows.reduce((n, r) => n + r.humanMin, 0) * 10) / 10,
    humanMinWithoutMeasuring: Math.round(setupRows.reduce((n, r) => n + r.humanMin - (r.key === 'measure' ? r.offScreenSec / 60 : 0), 0) * 10) / 10,
  };
  const report = { ranAt: new Date().toISOString(), assumptions: { SEC_PER_CLICK, SEC_PER_CHAR, WORDS_PER_MIN }, steps: rows.map(({ machineMs: _m, ...r }) => r), total, failures };
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.table(rows.map((r) => ({ step: r.title, machineSec: r.machineSec, clicks: r.clicks, typed: r.typedChars, words: Math.round(r.wordsRead), offScreenSec: r.offScreenSec, humanMin: r.humanMin })));
  console.log(`total: machine ${total.machineSec} s; estimated merchant time ${total.humanMin} min (${total.humanMinWithoutMeasuring} min without the tape measuring)`);

  clearInterval(jobs);
  await browser.close();
  store.close();
  try {
    if (web.pid) process.kill(-web.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  await t.close();
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`ok: screenshots and report.json in ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
