#!/usr/bin/env node
/**
 * `pnpm demo:e2e` — Playwright smoke test of the standalone flow (docs/STANDALONE.md §4).
 * Not part of `pnpm check`: it starts the full demo (api + web + storefront) and drives Chromium.
 *
 * For both product page styles of the demo storefront (WooCommerce and Shopify Dawn):
 *   storefront → "Try it on" → overlay (role=dialog) with the /embed iframe → About you →
 *   result → "Choose size X" → the overlay closes and the page's own size control holds X.
 * Size peek: on the first visit the peek iframe next to the button stays at height 0 and makes no
 * api request. After the fit, a reload shows "Your size: X" (the size just chosen) and the
 * shopper's figure inside the peek iframe, without a click; the merchant page's own DOM never
 * contains that text and cannot read the iframe; the frame is exactly 112 px (PEEK_HEIGHT, never a
 * measured height); the peek makes one read-only `GET /v1/peek`, mints no try session and never
 * calls fit-shown. Then "See how size X fits you" in the peek opens the overlay, and a
 * returning shopper ("Remember me" is on by default) must land straight on the result (§1.4).
 * Optional 3D estimate (D16): aalter-studio-1 has no bundle, so its result shows no 3D button (exactly
 * today's flow). Then, as the returning shopper, each flow opens the product with an approved bundle
 * (WooCommerce: the synthetic aalter-studio-2; Dawn: the azure babydoll from its git-ignored
 * evaluated bundle, skipped with a note when absent), clicks "See it in 3D (estimate)", waits for
 * the drape, checks the estimate label names the recommended size, and that after the click the
 * iframe only GETs code from the app origin and the five bundle files under /assets/ (no POST, no
 * body, no third party), and that the merchant page shows nothing of it.
 * Console errors and uncaught exceptions in the page or the iframe fail the flow.
 *
 * Uses the preinstalled Playwright (`require('playwright')`). Reuses services that are already
 * running (e.g. a `pnpm demo` in another terminal). Screenshots of every step go to
 * test-results/demo-e2e/ (git-ignored). Exits non-zero on the first failure.
 *
 * Env:   DEMO_E2E_SHOTS  screenshot folder (default test-results/demo-e2e)
 *        DEMO_AZURE_BUNDLE  the azure babydoll bundle folder (default spikes/garment-engine/out/eval/…)
 * Flags: --skip-build   do not build the packages first
 *        --headed       show the browser
 */
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_BUNDLES, URLS, startDemo } from './demo.mjs';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const shots = process.env.DEMO_E2E_SHOTS ? resolve(process.env.DEMO_E2E_SHOTS) : join(root, 'test-results', 'demo-e2e');
const STEP_TIMEOUT = 30_000;

const PAGES = [
  {
    name: 'woocommerce',
    path: '/product/aalter-studio-1',
    /** The size the page's own variation form now holds (the option's label). */
    pageSize: (page) => page.locator('form.variations_form select[name="attribute_pa_size"]').evaluate((s) => (s.value ? s.selectedOptions[0].text.trim() : '')),
    /** The synthetic dress bundle (built by `pnpm demo`); its absence skips the 3D step with a note. */
    threeD: { path: '/product/aalter-studio-2', bundle: DEMO_BUNDLES.synthetic },
  },
  {
    name: 'shopify-dawn',
    path: '/products/aalter-studio-1',
    pageSize: (page) => page.locator('input[type=radio][name="Size"]:checked').evaluate((r) => r.value).catch(() => ''),
    /** The azure babydoll (the founder's evaluated bundle, git-ignored); skipped with a note when absent. */
    threeD: { path: '/products/azure-palm-baby-doll-dress', bundle: DEMO_BUNDLES.azure },
  },
];

const norm = (s) => String(s).trim().toLowerCase();
const PEEK = 'iframe[src*="/embed/peek"]';

/** The peek iframe's reserved height in px (0 while collapsed or not inserted yet). */
const peekHeight = (page) => page.evaluate((sel) => parseFloat(document.querySelector(sel)?.style.height || '0') || 0, PEEK);

/**
 * Requests sent by the peek iframe (not the overlay): api calls as { method, path, body } in
 * `api`, and every other URL in `assets`.
 */
function trackPeekRequests(page) {
  const seen = { api: [], assets: [] };
  page.on('request', (r) => {
    if (!r.frame()?.url().includes('/embed/peek')) return;
    const u = new URL(r.url());
    if (u.pathname.startsWith('/v1/')) seen.api.push({ method: r.method(), path: u.pathname, body: r.postData() });
    else seen.assets.push(u.pathname);
  });
  return seen;
}

/** React (dev: the pre-bundled dep; build: the vendor chunk). */
const REACT_ASSET = /react-dom|\/vendor-[\w-]+\.js$/;

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
  const peekRequests = trackPeekRequests(page);
  try {
    log(`open ${base}${spec.path}`);
    await page.goto(base + spec.path);
    const button = page.getByRole('button', { name: /try it on/i }).first();
    await button.waitFor();
    // The SDK marks the buttons it bound; clicking before that would do nothing.
    await page.waitForSelector('[data-curtain-product][data-curtain-bound]');

    log('first visit: the size peek stays collapsed, asks the api nothing and loads no React');
    await page.waitForSelector(PEEK, { state: 'attached' });
    await page.frameLocator(PEEK).locator('html').waitFor({ state: 'attached' });
    await page.waitForTimeout(1500); // the peek's own storage check; it must not grow
    if ((await peekHeight(page)) !== 0) throw new Error('the size peek took space on a first visit');
    if (await page.frameLocator(PEEK).getByText(/your size/i).count()) throw new Error('the size peek shows a size on a first visit');
    if (peekRequests.api.length) throw new Error(`the size peek called the api on a first visit: ${JSON.stringify(peekRequests.api)}`);
    const react = peekRequests.assets.filter((a) => REACT_ASSET.test(a));
    if (react.length) throw new Error(`the size peek downloaded React on a first visit: ${react.join(', ')}`);
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
    // ENGINE-HANDOFF item 9: a product without an approved bundle behaves exactly as today.
    if (await frame.getByTestId('garment3d-open').count()) throw new Error('aalter-studio-1 has no 3D bundle but shows the 3D button');
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

    log('reload: the size peek shows the size and the figure without a click');
    await page.reload();
    await page.waitForSelector('[data-curtain-product][data-curtain-bound]');
    const peek = page.frameLocator(PEEK);
    const peekSize = peek.getByTestId('peek-size');
    await peekSize.waitFor();
    const peekText = (await peekSize.innerText()).replace(/\s+/g, ' ').trim();
    if (norm(peekText) !== norm(`Your size: ${size}`)) throw new Error(`the peek says "${peekText}", expected "Your size: ${size}"`);
    await peek.locator('[data-testid="peek-avatar"] svg[role="img"]').waitFor();
    await peek.getByTestId('estimate-badge').waitFor();
    await page.waitForFunction((sel) => parseFloat(document.querySelector(sel)?.style.height || '0') > 40, PEEK);
    await page.waitForTimeout(300);
    // P2: one fixed height, whatever the size label or note
    if ((await peekHeight(page)) !== 112) throw new Error(`the peek frame is ${await peekHeight(page)} px, expected the fixed 112`);
    await shot('5-size-peek');
    log(`ok: the peek shows "${peekText}" and the figure`);

    log('privacy: the merchant page holds no size text and cannot read the peek');
    const leak = await page.evaluate((sel) => {
      const iframe = document.querySelector(sel);
      let readable = null;
      try {
        readable = iframe?.contentDocument?.body?.innerText ?? null;
      } catch {
        readable = null;
      }
      // "Your size:" with the colon: the iframe's title is the fixed label "Your size" (no size in it).
      return { text: /your size:/i.test(document.body.innerText), html: /your size:/i.test(document.documentElement.outerHTML), readable, attrs: Array.from(iframe?.attributes ?? []).map((a) => a.name).sort() };
    }, PEEK);
    if (leak.text || leak.html) throw new Error('the merchant page DOM contains "Your size" outside the peek iframe');
    if (leak.readable !== null) throw new Error('the merchant page can read the peek iframe');
    // The SDK writes nothing on the frame beyond what it set itself (its height is in the style).
    if (leak.attrs.join(' ') !== 'referrerpolicy src style title') throw new Error(`unexpected peek iframe attributes: ${leak.attrs.join(' ')}`);
    // C1/C2: one read-only lookup, no try session (merchant analytics and the SDK rate limit stay clean)
    const sessions = peekRequests.api.filter((r) => r.path === '/v1/sdk/sessions' || r.path.startsWith('/v1/try/'));
    if (sessions.length) throw new Error(`the peek minted or resolved a try session: ${JSON.stringify(sessions)}`);
    const lookups = peekRequests.api.filter((r) => r.path === '/v1/peek');
    if (lookups.length !== 1 || lookups[0].method !== 'GET') throw new Error(`the peek should make one GET /v1/peek, saw ${JSON.stringify(peekRequests.api)}`);
    if (peekRequests.api.some((r) => r.path.endsWith('/fit-shown'))) throw new Error('the peek reported fit-shown (billing)');
    // The detector behind the first-visit "no React" check does see React when it loads.
    if (!peekRequests.assets.some((x) => REACT_ASSET.test(x))) throw new Error('expected the peek with a profile to load React (the first-visit check would be vacuous)');
    log('ok: no size in the page DOM, the iframe is opaque, nothing billed by the peek');

    log('returning shopper: "See how it fits" in the peek opens the overlay');
    await peek.getByTestId('peek-open').click();
    await page.getByRole('dialog').waitFor();
    const again = page.frameLocator('[role="dialog"] iframe');
    await again.getByRole('button', { name: /^choose size\s+\S+/i }).first().waitFor();
    await again.getByRole('button', { name: /edit my measurements/i }).first().waitFor();
    await shot('6-returning-shopper');
    log('ok: the remembered profile skips straight to the result');

    if (spec.threeD) await threeDStep(page, base, spec, log, shot);

    if (errors.length) throw new Error(`errors in the page or the iframe:\n  ${errors.join('\n  ')}`);
  } catch (err) {
    await shot('failure').catch(() => {});
    throw err;
  } finally {
    await context.close();
  }
}

/**
 * The optional 3D estimate (D16) on the product with an approved bundle, as the returning shopper:
 * the overlay lands on the result; "See it in 3D (estimate)" loads the viewer and drapes the
 * recommended size on a model with the shopper's girths. After the click the iframe may only GET
 * bundle files under /assets/ from the api (and the viewer's own code from the app origin): no POST,
 * no request body, no third party. The merchant page learns nothing.
 */
async function threeDStep(page, base, spec, log, shot) {
  const { path, bundle } = spec.threeD;
  if (!existsSync(join(bundle, 'base.glb'))) {
    log(`3D: SKIPPED, no bundle at ${bundle} (git-ignored; see docs/PLUGIN.md)`);
    return;
  }
  log(`3D: open ${base}${path}`);
  await page.goto(base + path);
  await page.waitForSelector('[data-curtain-product][data-curtain-bound]');
  await page.getByRole('button', { name: /try it on/i }).first().click();
  await page.getByRole('dialog').waitFor();
  const frame = page.frameLocator('[role="dialog"] iframe');
  const choose = frame.getByRole('button', { name: /^choose size\s+\S+/i }).first();
  await choose.waitFor();
  const size = (await choose.innerText()).trim().replace(/^choose size\s+/i, '').trim();
  const open = frame.getByTestId('garment3d-open');
  await open.waitFor();
  await page.waitForTimeout(500); // let fit-shown (billing) go out before the 3D requests are recorded

  const after = [];
  const onRequest = (r) => {
    if (!r.frame()?.url().includes('/embed')) return;
    const u = new URL(r.url());
    after.push({ method: r.method(), origin: u.origin, path: u.pathname, body: r.postData() ?? null });
  };
  page.on('request', onRequest);
  log('3D: click "See it in 3D (estimate)"');
  await open.click();
  const canvas = frame.locator('canvas[data-testid="garment3d-canvas"]');
  await frame.locator('canvas[data-testid="garment3d-canvas"][data-state="draping"], canvas[data-testid="garment3d-canvas"][data-state="settled"]').first().waitFor({ timeout: 60_000 });
  log('3D: first frame drawn, draping');
  const settled = await frame
    .locator('canvas[data-testid="garment3d-canvas"][data-state="settled"]')
    .waitFor({ timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  log(settled ? '3D: drape settled' : '3D: still draping after 45 s (only the first frame is required)');
  await page.waitForTimeout(400);
  page.off('request', onRequest);
  const label = (await frame.getByTestId('garment3d-label').innerText()).replace(/\s+/g, ' ');
  if (!/estimate/i.test(label)) throw new Error(`3D label does not say estimate: "${label}"`);
  if (!label.includes(`Size ${size} was picked by the size advice`)) throw new Error(`3D label does not name the recommended size ${size}: "${label}"`);
  if ((await canvas.getAttribute('data-size'))?.toLowerCase() !== size.toLowerCase()) throw new Error(`3D view shows size ${await canvas.getAttribute('data-size')}, the advice picked ${size}`);
  await frame.getByTestId('garment3d').scrollIntoViewIfNeeded();
  await shot('7-3d-estimate');

  const app = new URL(URLS.web).origin;
  const api = new URL(URLS.api).origin;
  const bad = after.filter((r) => r.method !== 'GET' || r.body || (r.origin !== app && r.origin !== api) || (r.origin === api && !r.path.startsWith('/assets/')));
  if (bad.length) throw new Error(`3D view made requests other than GETs of its code and /assets/: ${JSON.stringify(bad.slice(0, 5))}`);
  const files = after.filter((r) => r.origin === api).map((r) => r.path.split('/').pop());
  for (const f of ['base.glb', 'anchors.json', 'grading.json', 'material.json', 'qa.json']) if (!files.includes(f)) throw new Error(`3D view did not load ${f} from /assets/`);
  const leak = await page.evaluate(() => /3D estimate|picked by the size advice/i.test(document.body.innerText) || /garment3d/.test(document.documentElement.outerHTML));
  if (leak) throw new Error('the merchant page DOM shows the 3D estimate outside the iframe');
  log(`ok: 3D estimate of size ${size}, labelled an estimate; ${files.length} asset GETs and nothing else went to the api`);
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
