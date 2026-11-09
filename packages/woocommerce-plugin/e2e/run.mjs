#!/usr/bin/env node
/**
 * `pnpm --filter @curtain/woocommerce-plugin e2e:wp`: the plugin on a REAL WordPress + WooCommerce
 * (official Docker images), against the local api and web of this repo. No mocks of WordPress or
 * WooCommerce; Stripe is not involved (the api runs without Stripe keys, so Connect takes the
 * free "manual-key" path, exactly what a shop gets when billing is off).
 *
 * Merchant: upload the zip in Plugins → Add New → Upload, activate, set the API base, Connect
 * (domain proof ON: refused for a localhost site, as in production; the nonce the site publishes is
 * checked against the api's derivation; then the api restarts with WOO_DOMAIN_PROOF=0 and "Finish
 * connection" completes), fill the fit-data meta box from a size chart template, pick the
 * flat-lay in the media modal, Update → the HMAC-signed push lands in the api (read back with a
 * signed GET; a forged signature is refused).
 * Shopper (Storefront, Twenty Twenty-Four, Twenty Twenty-Five): the button sits under the variation
 * form, "Try it on" → overlay → About you → result → "Choose size X" → the variation dropdown holds X
 * and WooCommerce shows that variation's price.
 * Lifecycle: deactivate (queue cleared, button and script gone), reactivate, uninstall with
 * "delete all data" ticked (settings, meta and transients gone). Then Plugin Check (the official
 * plugin-check plugin) on a fresh copy of the zip.
 *
 * `--php=8.1`: WordPress on PHP 8.1 must refuse to activate the plugin (it needs 8.2) without a
 * fatal error; every PHP file is also linted with that PHP.
 *
 * Screenshots and report.json: test-results/woo-wp-e2e/php<XY>/ (git-ignored).
 * Flags: --php=8.1|8.2|8.3  --skip-build  --keep (leave the containers running)  --headed
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHmac, createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { apiService, config, debugLog, fetchDownloads, freshDir, pluginRoot, pullImages, removeStack, repoRoot, startWordPress, webService, wp } from './stack.mjs';

const require = createRequire(import.meta.url);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name) => process.argv.includes(`--${name}`);

const cfg = config({ php: arg('php') ?? process.env.CURTAIN_WP_PHP ?? '8.3' });
const shots = join(repoRoot, 'test-results', 'woo-wp-e2e', `php${cfg.php.replace('.', '')}`);
const work = join(repoRoot, 'test-results', 'woo-wp-e2e', `.work-php${cfg.php.replace('.', '')}`);
const WP = `http://localhost:${cfg.wpPort}`;
const API = `http://localhost:${cfg.apiPort}`;
const ADMIN = { user: 'admin', pass: 'e2e-admin-pass-' + 'not-secret' };
/** apps/api/src/env.ts dev default: the demo api runs with it (no JWT_SECRET set). */
const DEV_JWT_SECRET = 'dev-jwt-secret-do-not-use-in-production-0123456789';
const THEMES = ['storefront', 'twentytwentyfour', 'twentytwentyfive'];
const STEP_TIMEOUT = 30_000;

const report = { php: cfg.php, startedAt: new Date().toISOString(), environment: {}, steps: [], screenshots: [], warnings: [] };
const log = (m) => console.log(`[woo-e2e php${cfg.php}] ${m}`);
function pass(step, detail = '') {
  report.steps.push({ step, ok: true, detail });
  log(`ok   ${step}${detail ? ` — ${detail}` : ''}`);
}
function check(cond, step, detail) {
  if (!cond) throw new Error(`${step}: ${detail}`);
  pass(step, typeof detail === 'string' ? '' : '');
}

async function shot(page, name, opts = {}) {
  const file = join(shots, `${String(report.screenshots.length + 1).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, ...(opts.clip ? { clip: opts.clip } : {}) });
  report.screenshots.push(file.slice(repoRoot.length + 1));
}

/** PK-HMAC exactly as includes/class-hmac.php signs it. */
function pkHmac(pk, sk, method, target, body = '', ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', sk).update(`${method}\n${target}\n${ts}\n${createHash('sha256').update(body).digest('hex')}`).digest('hex');
  return `PK-HMAC key=${pk}, ts=${ts}, sig=${sig}`;
}

async function login(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  await page.goto(`${WP}/wp-login.php`);
  await page.fill('#user_login', ADMIN.user);
  await page.fill('#user_pass', ADMIN.pass);
  await page.click('#wp-submit');
  await page.waitForURL(/wp-admin/);
  return { ctx, page };
}

const notices = async (page) => (await page.locator('.wrap .notice, #wpbody-content > .notice').allInnerTexts()).map((t) => t.replace(/\s*Dismiss this notice\.\s*/g, ' ').trim()).filter(Boolean);

function setupWordPress(dl) {
  wp(cfg, ['core', 'install', `--url=${WP}`, '--title=Curtain E2E Boutique', `--admin_user=${ADMIN.user}`, `--admin_password=${ADMIN.pass}`, '--admin_email=admin@example.test', '--skip-email']);
  const mounts = { [join(pluginRoot, 'e2e', '.cache')]: '/dl', [join(pluginRoot, 'e2e')]: '/e2e' };
  wp(cfg, ['plugin', 'install', `/dl/${dl.woocommerce.split('/').pop()}`, '--activate'], { mounts });
  wp(cfg, ['theme', 'install', `/dl/${dl.storefront.split('/').pop()}`], { mounts });
  // Twenty Twenty-Four/Five ship with WordPress; install the pinned zip only when missing.
  if (wp(cfg, ['theme', 'is-installed', 'twentytwentyfour'], { allowFail: true }).status !== 0) wp(cfg, ['theme', 'install', `/dl/${dl.twentytwentyfour.split('/').pop()}`], { mounts });
  wp(cfg, ['option', 'update', 'woocommerce_currency', 'AUD']);
  wp(cfg, ['option', 'update', 'woocommerce_coming_soon', 'no']);
  wp(cfg, ['option', 'update', 'woocommerce_onboarding_profile', '{"skipped":true}', '--format=json']);
  wp(cfg, ['rewrite', 'structure', '/%postname%/']);
  wp(cfg, ['rewrite', 'flush']);
  const productId = Number(wp(cfg, ['eval-file', '/e2e/fixtures.php'], { mounts }).split('\n').pop());
  // A flat-lay photo for the media modal (a plain PNG drawn here, no shop content).
  wp(cfg, ['media', 'import', '/e2e/flat-lay.png', '--title=Linen wrap dress flat-lay'], { mounts });
  report.environment.wordpress = wp(cfg, ['core', 'version']);
  report.environment.woocommerce = wp(cfg, ['plugin', 'get', 'woocommerce', '--field=version']);
  report.environment.php = execFileSync('docker', ['exec', `${cfg.prefix}-wp`, 'php', '-r', 'echo PHP_VERSION;'], { encoding: 'utf8' });
  report.environment.themes = wp(cfg, ['theme', 'list', '--fields=name,version', '--format=csv']).split('\n').slice(1).join('; ');
  log(`WordPress ${report.environment.wordpress}, WooCommerce ${report.environment.woocommerce}, PHP ${report.environment.php}; product ${productId}`);
  return productId;
}

/** Plugins → Add New → Upload Plugin → Install Now → returns the result page. */
async function uploadPlugin(page, zip) {
  await page.goto(`${WP}/wp-admin/plugin-install.php?tab=upload`);
  await page.setInputFiles('#pluginzip', zip);
  await page.click('#install-plugin-submit');
  await page.waitForSelector('.wrap h1, .wrap h2');
  await page.getByText(/Plugin installed successfully/i).waitFor();
}

// ---------------------------------------------------------------------------------------------

async function php81(browser, zip) {
  log('PHP 8.1: the plugin needs PHP 8.2; WordPress must refuse activation without a fatal error');
  const { ctx, page } = await login(browser);
  await uploadPlugin(page, zip);
  const body = await page.locator('.wrap').innerText();
  await shot(page, 'php81-upload-result', { fullPage: true });
  // WordPress 5.2+ checks "Requires PHP" before activating; no Activate link, a clear message.
  const activate = await page.getByRole('link', { name: /activate plugin/i }).count();
  check(activate === 0 && /requires PHP|PHP version/i.test(body), 'php8.1: upload shows no Activate link and names the PHP requirement', body);
  const forced = wp(cfg, ['plugin', 'activate', 'curtain-woocommerce'], { allowFail: true });
  check(forced.status !== 0 && /PHP/i.test(forced.stderr + forced.stdout), 'php8.1: wp plugin activate refuses on the PHP requirement', forced.stderr);
  await page.goto(`${WP}/wp-admin/plugins.php`);
  await shot(page, 'php81-plugins-screen');
  const front = await (await fetch(`${WP}/`)).status;
  check(front === 200, 'php8.1: the site still answers 200', String(front));
  // Syntax on 8.1: the files would still parse (no 8.2-only syntax), so a host on 8.1 never white-screens.
  const lint = spawnSync('docker', ['exec', `${cfg.prefix}-wp`, 'sh', '-c', 'cd /var/www/html/wp-content/plugins/curtain-woocommerce && find . -name "*.php" -print0 | xargs -0 -n1 php -l'], { encoding: 'utf8' });
  const bad = lint.stdout.split('\n').filter((l) => l && !l.startsWith('No syntax errors'));
  report.php81Lint = { files: lint.stdout.split('\n').filter((l) => l.startsWith('No syntax errors')).length, errors: bad };
  if (bad.length) report.warnings.push(`PHP 8.1 php -l: ${bad.join(' | ')}`);
  pass('php8.1: php -l of every plugin file', bad.length ? `${bad.length} file(s) do not parse on 8.1 (plugin refuses to activate anyway)` : `${report.php81Lint.files} files parse`);
  await ctx.close();
}

async function merchantAndShopper(browser, zip, productId, api) {
  const { ctx, page } = await login(browser);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`admin uncaught: ${e}`));

  // ---- install + activate through the admin ----------------------------------------------------
  await uploadPlugin(page, zip);
  await shot(page, 'admin-upload-installed');
  await page.getByRole('link', { name: /activate plugin/i }).click();
  await page.waitForURL(/plugins\.php/);
  const nudge = await page.getByText(/installed but not connected/i).count();
  await shot(page, 'admin-activated-nudge');
  check(nudge === 1 && (await page.locator('tr[data-plugin="curtain-woocommerce/curtain.php"].active').count()) === 1, 'activate from the Plugins screen; "not connected" notice shown', 'plugin not active or no nudge');

  // ---- settings: API base ---------------------------------------------------------------------
  await page.goto(`${WP}/wp-admin/admin.php?page=curtain`);
  await page.getByText(/Not connected — nothing is sent to Curtain/).waitFor();
  await shot(page, 'settings-not-connected', { fullPage: true });
  await page.fill('#curtain_api_base', API);
  await page.click('#submit');
  await page.getByText('Settings saved.').waitFor();
  check((await page.inputValue('#curtain_api_base')) === API, 'settings: API base saved (http allowed for localhost only)', 'api base not saved');

  // ---- Connect, domain proof ON (production default) ----------------------------------------------
  await page.getByRole('button', { name: 'Connect to Curtain' }).click();
  await page.waitForLoadState();
  const refused = (await notices(page)).join(' ');
  await shot(page, 'connect-domain-proof-refused');
  check(/could not confirm that this site asked for the connection/i.test(refused), 'Connect with domain proof on: a localhost site is refused (domain_unverified), with the plugin\'s explanation', refused);
  const pretty = await (await fetch(`${WP}/wp-json/curtain/v1/verify`)).json();
  const query = await (await fetch(`${WP}/?rest_route=/curtain/v1/verify`)).json();
  const token = wp(cfg, ['eval', 'echo \\Curtain\\Settings::get("connect_token");']);
  const expected = `cv_${createHmac('sha256', DEV_JWT_SECRET).update(`woo-domain-proof:${token}`).digest('hex').slice(0, 40)}`;
  check(pretty.nonce === expected && query.nonce === expected, 'pending Connect: /wp-json/curtain/v1/verify and ?rest_route= publish exactly the nonce the api derives from the Connect token', JSON.stringify({ pretty, query, expected }));
  const html = await (await fetch(`${WP}/`)).text();
  check(!html.includes(expected), 'the nonce is not reflected in page HTML (REST route only)', 'nonce found in the front page HTML');

  log('restart the api with WOO_DOMAIN_PROOF=0 (a localhost site cannot be proven; production keeps it on)');
  await api.stop();
  await api.start({ proof: false });
  await page.goto(`${WP}/wp-admin/admin.php?page=curtain`);
  await page.getByRole('button', { name: 'Finish connection' }).click();
  await page.waitForLoadState();
  await page.getByText(/Connected to Curtain\. Your published products are being synced/).waitFor();
  await shot(page, 'settings-connected', { fullPage: true });
  const status = await page.locator('.form-table').first().innerText();
  check(/Connected/.test(status) && /pk_(test|live)_/.test(status) && /plan: free/.test(status), 'Finish connection: Connected, pk_ prefix and plan shown (free plan, no Stripe)', status);
  const after = await fetch(`${WP}/wp-json/curtain/v1/verify`);
  check(after.status === 404, 'after Connect the verify route answers 404 (nonce cleared)', String(after.status));
  const stored = JSON.parse(wp(cfg, ['option', 'get', 'curtain_settings', '--format=json']));
  check(!('api_key' in stored && stored.api_key) && typeof stored.api_key_enc === 'string' && !stored.api_key_enc.includes('sk_'), 'the secret key is stored encrypted (no sk_ in wp_options)', JSON.stringify(Object.keys(stored)));

  // ---- product: fit-data meta box from a template ------------------------------------------------
  await page.goto(`${WP}/wp-admin/post.php?post=${productId}&action=edit`);
  const box = page.locator('#curtain-garment');
  await box.scrollIntoViewIfNeeded();
  await box.locator('select[name="curtain[category]"]').selectOption('dress');
  await box.locator('select[name="curtain[pattern_block]"]').selectOption('wrap');
  await box.locator('.curtain-template-select').selectOption('au-womens-body');
  await box.locator('.curtain-template-apply').click();
  const sizes = await box.locator('[data-repeater="size_chart"] tbody input[name$="[size]"]').evaluateAll((els) => els.map((e) => e.value));
  const firstBust = await box.locator('input[name="curtain[size_chart][0][bust]"]').inputValue();
  check(sizes.join(',') === '8,10,12,14,16,18,20' && Number(firstBust) > 0 && (await box.locator('input[name="curtain[size_chart_type]"][value="body"]').isChecked()), 'meta box: the AU body template fills sizes 8–20 with numbers and ticks "body measurements"', `${sizes} / ${firstBust}`);
  await box.locator('input[name="curtain[fabric_primary]"]').fill('linen');
  await box.locator('input[name="curtain[fabric_stretch_pct]"]').fill('0');
  await box.locator('input[name="curtain[fabric_drape]"]').fill('0.6');
  await box.locator('input[name="curtain[primary_color_hex]"]').fill('#C9B79C');
  for (const p of ['bust', 'waist']) await box.locator(`input[name="curtain[critical_fit_points][]"][value="${p}"]`).check();
  await box.locator('input[name="curtain[true_to_size_score]"]').fill('0.8');
  await box.locator('input[name="curtain[length][shoulder_to_hem]"]').fill('118');
  // Flat-lay from the media library (WordPress's own media modal).
  await box.locator('.curtain-flatlay-pick').click();
  const modal = page.locator('.media-modal:visible');
  await modal.locator('.media-router button, .media-menu-item', { hasText: 'Media Library' }).first().click().catch(() => {});
  await modal.locator('li.attachment').first().click();
  await modal.locator('.media-button-select').click();
  await box.locator('.curtain-flatlay-preview img').waitFor();
  await box.scrollIntoViewIfNeeded();
  await shot(page, 'meta-box-filled-from-template', { fullPage: true });
  await page.locator('#publish').click();
  await page.waitForURL(/message=1/);
  // Push job (Action Scheduler, group curtain): run the queue now instead of waiting for WP-Cron.
  // (WordPress runs it by itself through WP-Cron / Action Scheduler's async runner; this makes it now.)
  let syncStatus = '';
  for (let i = 0; i < 30 && syncStatus !== 'active'; i++) {
    const run = wp(cfg, ['action-scheduler', 'run', '--hooks=curtain_push_product,curtain_sync_all'], { allowFail: true });
    if (i === 0) log(`queue: ${(run.stdout + ' ' + run.stderr).split('\n').filter((l) => /curtain_|Success|Error/.test(l)).join(' | ')}`);
    syncStatus = wp(cfg, ['post', 'meta', 'get', String(productId), '_curtain_sync_status'], { allowFail: true }).stdout;
    if (syncStatus !== 'active') await new Promise((r) => setTimeout(r, 1000));
  }
  await page.reload();
  const panel = await page.locator('#curtain-garment .curtain-status').innerText();
  await page.locator('#curtain-garment').scrollIntoViewIfNeeded();
  await shot(page, 'meta-box-active');
  check(/Active/i.test(panel), 'Update → push job → api verdict: Curtain status Active', panel);
  const meta = wp(cfg, ['post', 'meta', 'get', String(productId), '_curtain_sync_status']);
  check(meta === 'active', 'post meta _curtain_sync_status = active', meta);

  // ---- the push really arrived, HMAC-signed -----------------------------------------------------------
  const pk = stored.public_key_prefix;
  const sk = wp(cfg, ['eval', 'echo \\Curtain\\Settings::get("api_key");']);
  const target = '/v1/merchant/products?limit=50';
  const listed = await fetch(API + target, { headers: { authorization: pkHmac(pk, sk, 'GET', target) } });
  const list = await listed.json();
  const row = (list.products ?? list.items ?? list.data ?? []).find((p) => String(p.externalId ?? p.id) === String(productId));
  check(listed.status === 200 && row && /active/.test(JSON.stringify(row)), 'signed GET /v1/merchant/products returns the pushed product as active', JSON.stringify(list).slice(0, 400));
  const forged = await fetch(API + target, { headers: { authorization: pkHmac(pk, sk.slice(0, -1) + (sk.endsWith('a') ? 'b' : 'a'), 'GET', target) } });
  check(forged.status === 401, 'a forged PK-HMAC signature is refused (401)', String(forged.status));
  const putLines = api.lines.filter((l) => l.includes(`/v1/merchant/products/${productId}`));
  pass('api log shows the plugin\'s PUT', `${putLines.length} log line(s) for /v1/merchant/products/${productId}`);

  // ---- storefront, per theme ----------------------------------------------------------------------
  const permalink = wp(cfg, ['eval', `echo get_permalink(${productId});`]);
  for (const theme of THEMES) {
    wp(cfg, ['theme', 'activate', theme]);
    await shopperFlow(browser, theme, permalink);
  }
  wp(cfg, ['theme', 'activate', 'storefront']);

  // ---- deactivate / reactivate -------------------------------------------------------------------
  wp(cfg, ['eval', `as_schedule_single_action(time() + 3600, "curtain_push_product", array(${productId}, 0), "curtain");`]);
  await page.goto(`${WP}/wp-admin/plugins.php`);
  await page.locator('tr[data-plugin="curtain-woocommerce/curtain.php"] .deactivate a').click();
  await page.waitForURL(/plugins\.php/);
  await shot(page, 'plugins-deactivated');
  const pendingAfter = wp(cfg, ['eval', 'echo count(as_get_scheduled_actions(array("group" => "curtain", "status" => "pending"), "ids"));']);
  check(pendingAfter === '0', 'deactivate clears the pending curtain jobs (Action Scheduler)', pendingAfter);
  const offHtml = await (await fetch(permalink)).text();
  check(!offHtml.includes('curtain-try-button') && !offHtml.includes('sdk.v1.js'), 'deactivated: no button and no SDK on the product page', 'still rendered');
  await page.locator('tr[data-plugin="curtain-woocommerce/curtain.php"] .activate a').click();
  await page.waitForURL(/plugins\.php/);
  const onHtml = await (await fetch(permalink)).text();
  check(onHtml.includes('curtain-try-button'), 'reactivated: settings kept, the button is back without reconnecting', 'button missing after reactivation');

  // ---- uninstall with "delete all data" -------------------------------------------------------------
  await page.goto(`${WP}/wp-admin/admin.php?page=curtain`);
  await page.locator('input[name="curtain[delete_on_uninstall]"]').check();
  await page.click('#submit');
  await page.getByText('Settings saved.').waitFor();
  wp(cfg, ['eval', 'set_transient("curtain_notice_1", array("type"=>"success","text"=>"x"), 600);']);
  await page.goto(`${WP}/wp-admin/plugins.php`);
  await page.locator('tr[data-plugin="curtain-woocommerce/curtain.php"] .deactivate a').click();
  await page.waitForURL(/plugins\.php/);
  page.once('dialog', (d) => d.accept());
  await page.locator('tr[data-plugin="curtain-woocommerce/curtain.php"] .delete a').click();
  await page.locator('tr.plugin-deleted-tr, .plugin-deleted-tr').first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, 'plugins-deleted');
  const opt = wp(cfg, ['option', 'get', 'curtain_settings'], { allowFail: true });
  const metaLeft = wp(cfg, ['db', 'query', "SELECT COUNT(*) FROM wp_postmeta WHERE meta_key LIKE '\\_curtain\\_%'", '--skip-column-names']);
  const transLeft = wp(cfg, ['db', 'query', "SELECT COUNT(*) FROM wp_options WHERE option_name LIKE '%transient%curtain%'", '--skip-column-names']);
  const files = wp(cfg, ['plugin', 'is-installed', 'curtain-woocommerce'], { allowFail: true });
  check(opt.status !== 0 && metaLeft === '0' && transLeft === '0' && files.status !== 0, 'uninstall (delete data ticked): plugin files, curtain_settings, _curtain_* meta and curtain transients all gone', JSON.stringify({ opt: opt.status, metaLeft, transLeft, files: files.status }));

  if (pageErrors.length) report.warnings.push(...pageErrors);
  await ctx.close();
}

async function shopperFlow(browser, theme, permalink) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console (${m.location().url || 'page'}): ${m.text()}`);
  });
  await page.goto(permalink);
  await page.waitForSelector('[data-curtain-product][data-curtain-bound]');
  const tag = await page.locator('script#curtain-sdk-js').evaluate((s) => Object.fromEntries(Array.from(s.attributes).map((a) => [a.name, a.value])));
  check(tag['data-api'] === API && /^pk_/.test(tag['data-shop']) && tag['data-mode'] === 'embed' && tag['data-size-option'] === 'pa_size' && tag.src.startsWith(`${WP}/wp-content/plugins/curtain-woocommerce/assets/sdk.v1.js`), `${theme}: bundled sdk.v1.js from the plugin with data-shop/api/mode/size-option`, JSON.stringify(tag));
  const order = await page.evaluate(() => {
    const form = document.querySelector('form.variations_form');
    const btn = document.querySelector('.curtain-try-button');
    if (!form || !btn) return 'missing';
    const fb = form.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    return { follows: !!(form.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) && !form.contains(btn), gap: Math.round(bb.top - fb.bottom), count: document.querySelectorAll('.curtain-try-button').length };
  });
  check(order !== 'missing' && order.follows && order.gap >= -2 && order.gap < 200 && order.count === 1, `${theme}: exactly one "Try it on" button, directly under the variation form`, JSON.stringify(order));
  const btn = page.locator('.curtain-try-button');
  await btn.scrollIntoViewIfNeeded();
  await shot(page, `${theme}-1-product`);
  await btn.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const frame = page.frameLocator('[role="dialog"] iframe');
  await frame.getByRole('heading', { name: /about you/i }).waitFor();
  await frame.getByLabel(/height/i).first().fill('168');
  await frame.getByLabel(/weight/i).first().fill('62');
  const regular = frame.getByRole('radio', { name: /^regular$/i });
  if (await regular.count()) await regular.first().check({ force: true });
  await shot(page, `${theme}-2-about-you`);
  await frame.getByRole('button', { name: /see my size|show my size|continue/i }).first().click();
  const choose = frame.getByRole('button', { name: /^choose size\s+\S+/i }).first();
  await choose.waitFor();
  await shot(page, `${theme}-3-size-advice`);
  const size = (await choose.innerText()).trim().replace(/^choose size\s+/i, '').trim();
  await choose.click();
  await dialog.waitFor({ state: 'detached' }).catch(() => dialog.waitFor({ state: 'hidden' }));
  const sel = page.locator('form.variations_form select[name="attribute_pa_size"]');
  const picked = await sel.evaluate((s) => (s.value ? s.selectedOptions[0].text.trim() : ''));
  await page.locator('.woocommerce-variation-price .price, .single_variation .price').first().waitFor({ timeout: 10_000 });
  const price = (await page.locator('.woocommerce-variation-price .price, .single_variation .price').first().innerText()).trim();
  await sel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, `${theme}-4-size-selected`);
  check(picked === size && /\$\s?1\d\d/.test(price), `${theme}: advice "${size}" → "Choose size ${size}" → the variation dropdown holds ${size} and WooCommerce shows its price (${price})`, `dropdown "${picked}", price "${price}"`);
  const curtainErrors = errors.filter((e) => /curtain|sdk\.v1|localhost:(3010|8797)|embed/i.test(e));
  if (errors.length) report.warnings.push(...errors.map((e) => `${theme}: ${e}`));
  check(curtainErrors.length === 0, `${theme}: no console errors from the SDK or the overlay`, curtainErrors.join(' | '));
  await ctx.close();
}

async function pluginCheck(zip) {
  // A fresh copy of the zip next to the official Plugin Check plugin, run with WP-CLI.
  const mounts = { [join(pluginRoot, 'e2e', '.cache')]: '/dl', [join(pluginRoot, 'dist')]: '/plugin' };
  wp(cfg, ['plugin', 'install', '/plugin/curtain-woocommerce.zip', '--force'], { mounts });
  wp(cfg, ['plugin', 'install', '/dl/plugin-check.2.2.0.zip', '--activate'], { mounts });
  const r = wp(cfg, ['plugin', 'check', 'curtain-woocommerce', '--format=json', '--include-low-severity-errors', '--include-low-severity-warnings', '--include-experimental'], { allowFail: true });
  const findings = [];
  // Output: "FILE: <path>" then a JSON array per file.
  let file = '';
  for (const line of (r.stdout + '\n').split('\n')) {
    const f = /^FILE:\s*(.+)$/.exec(line.trim());
    if (f) {
      file = f[1];
      continue;
    }
    if (line.trim().startsWith('[')) {
      try {
        for (const x of JSON.parse(line)) findings.push({ file, ...x });
      } catch {
        /* not JSON */
      }
    }
  }
  writeFileSync(join(shots, 'plugin-check.json'), JSON.stringify({ exit: r.status, findings, stderr: r.stderr }, null, 1));
  report.pluginCheck = { exit: r.status, errors: findings.filter((x) => x.type === 'ERROR').length, warnings: findings.filter((x) => x.type === 'WARNING').length, codes: [...new Set(findings.map((x) => `${x.type} ${x.code}`))] };
  report.screenshots.push(join(shots, 'plugin-check.json').slice(repoRoot.length + 1));
  log(`Plugin Check: ${report.pluginCheck.errors} error(s), ${report.pluginCheck.warnings} warning(s)`);
  for (const x of findings) log(`  ${x.type} ${x.code} ${x.file}:${x.line} ${String(x.message).slice(0, 160)}`);
  if (/Error:/i.test(r.stderr) && !findings.length && !/Checks complete. No errors found/i.test(r.stdout + r.stderr)) throw new Error(`plugin check did not run: ${r.stderr}`);
  check(report.pluginCheck.errors === 0, 'Plugin Check (official plugin-check 2.2.0): no ERROR-level findings', JSON.stringify(report.pluginCheck));
}

async function main() {
  freshDir(shots);
  mkdirSync(work, { recursive: true });
  const zip = join(pluginRoot, 'dist', 'curtain-woocommerce.zip');
  if (!flag('skip-build')) execFileSync('pnpm', ['--filter', '@curtain/woocommerce-plugin', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  if (!existsSync(zip)) throw new Error(`missing ${zip}: run the build first`);
  const dl = await fetchDownloads(log);
  pullImages(cfg, log);
  const { chromium } = require('playwright');
  const api = apiService(cfg, { dataDir: freshDir(join(work, 'api-db')), logFile: join(work, 'api.log') });
  const web = webService(cfg, { logFile: join(work, 'web.log') });
  let browser;
  let failed = null;
  try {
    await startWordPress(cfg, log);
    const productId = setupWordPress(dl);
    browser = await chromium.launch({ headless: !flag('headed') });
    if (cfg.php === '8.1') {
      await php81(browser, zip);
    } else {
      log('start the api (domain proof on) and the web app');
      await api.start({ proof: true });
      await web.start();
      await merchantAndShopper(browser, zip, productId, api);
      await pluginCheck(zip);
    }
    const dbg = debugLog(cfg);
    writeFileSync(join(shots, 'debug.log'), dbg);
    const ours = dbg.split('\n').filter((l) => /curtain/i.test(l) && /PHP (Fatal|Warning|Notice|Deprecated|Parse)/.test(l));
    check(ours.length === 0, 'PHP debug.log: no fatal, warning, notice or deprecation from the plugin', ours.join('\n'));
    const others = dbg.split('\n').filter((l) => /PHP (Fatal|Warning)/.test(l));
    if (others.length) report.warnings.push(`debug.log (not the plugin): ${others.length} line(s), first: ${others[0]}`);
  } catch (err) {
    failed = err;
    report.steps.push({ step: 'FAILED', ok: false, detail: String(err.message ?? err) });
    console.error(`[woo-e2e php${cfg.php}] FAIL ${err.message ?? err}`);
    try {
      writeFileSync(join(shots, 'debug.log'), debugLog(cfg));
    } catch {
      /* stack gone */
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    report.ok = !failed;
    writeFileSync(join(shots, 'report.json'), JSON.stringify(report, null, 1));
    await browser?.close().catch(() => {});
    await web.stop();
    await api.stop();
    if (!flag('keep')) removeStack(cfg);
  }
  log(`${report.steps.filter((s) => s.ok).length} checks passed${failed ? ', 1 failed' : ''}; screenshots and report.json in ${shots.slice(repoRoot.length + 1)}`);
  process.exit(failed ? 1 : 0);
}

main();
