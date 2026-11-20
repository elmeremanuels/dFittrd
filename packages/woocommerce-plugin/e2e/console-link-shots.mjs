#!/usr/bin/env node
/* global document, sessionStorage, history */
/**
 * Browser walk and phone screenshots (deviceScaleFactor 2) of "Open the Curtain console": the
 * WooCommerce settings page's button, the one-time sign-in link, and the web console after it.
 * Not part of `pnpm check` (needs Chromium from the preinstalled Playwright, php, and free ports).
 *
 * What is real: the api (apps/api/src/test/consoleLinkDemo.ts: the real app on PGlite, a seeded
 * shop), the web console (its vite dev server), and the plugin's own PHP (Settings::render and
 * Settings::console_link, which signs with the shop's key and checks the answer).
 * What is a stand-in: WordPress. The settings page is rendered with tests/shims.php, and this
 * script plays admin-post.php: it runs e2e/console-redirect.php and sends the browser on, with the
 * headers the plugin's handler sets. Nonce and capability checks are WordPress' and do not run here.
 *
 *   node packages/woocommerce-plugin/e2e/console-link-shots.mjs [outDir]
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..', '..');
const out = resolve(process.argv[2] ?? 'test-results/console-link');
mkdirSync(out, { recursive: true });

const API_PORT = Number(process.env.API_PORT ?? 8791);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5199);
const WP_PORT = Number(process.env.WP_PORT ?? 5198);
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const WP = `http://localhost:${WP_PORT}`;

const children = [];
const failures = [];
const expect = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('exit', stop);

/** Starts a child and resolves with the first stdout line that matches. Everything it prints is kept. */
function start(cmd, args, opts, until) {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const log = { text: '' };
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`${cmd} ${args.join(' ')} did not start:\n${log.text}`)), 120_000);
    const on = (chunk) => {
      log.text += chunk;
      const hit = log.text.split('\n').find((l) => until.test(l));
      if (hit) {
        clearTimeout(timer);
        done({ line: hit, log });
      }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('exit', (code) => fail(new Error(`${cmd} exited with ${code}:\n${log.text}`)));
  });
}

const api = await start('pnpm', ['--filter', '@curtain/api', 'exec', 'tsx', 'src/test/consoleLinkDemo.ts', String(API_PORT), WEB], { cwd: repo }, /"apiKey"/);
const creds = JSON.parse(api.line);
await start('pnpm', ['--filter', '@curtain/web', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: repo, env: { ...process.env, VITE_API_URL: API } }, /Local:|ready in/);

// ---- the WordPress stand-in -------------------------------------------------------------------
const base = `body{margin:0;background:#f0f0f1;color:#3c434a;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{margin:10px 20px}h1{font-size:23px;font-weight:400}h2{font-size:1.3em}.description{color:#646970}code{background:#e0e0e0;padding:2px 4px}
.button{display:inline-block;border:1px solid #2271b1;color:#2271b1;border-radius:3px;padding:0 10px;line-height:2.15;min-height:30px;background:#f6f7f7;text-decoration:none;font:inherit;cursor:pointer;margin:0 4px 4px 0}
.button-primary{background:#2271b1;color:#fff}.button-link-delete{border-color:transparent;background:none;color:#b32d2e}
.notice{border-left:4px solid #72aee6;background:#fff;padding:1px 12px;margin:10px 0}.notice-success{border-left-color:#00a32a}.notice-error{border-left-color:#d63638}.notice-warning{border-left-color:#dba617}
.form-table{border-collapse:collapse;width:100%}.form-table th{text-align:left;vertical-align:top;padding:20px 10px 20px 0;width:200px;font-weight:600}.form-table td{padding:15px 10px;vertical-align:top}
input[type=text],input[type=url],input[type=number],input[type=password],select{border:1px solid #8c8f94;border-radius:4px;padding:0 8px;min-height:30px;font:inherit;background:#fff;max-width:100%}
@media (max-width:782px){.wrap{margin:8px 10px}.form-table th,.form-table td{display:block;width:auto;padding:8px 0}.button{min-height:40px;line-height:2.9;font-size:14px}input,select{min-height:40px;font-size:16px}}`;
const doc = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Curtain ‹ Fixture Shop — WordPress</title><style>${base}</style></head><body>${body}</body></html>`;
// The rendered page posts to the shims' admin URL; here that is this stand-in.
const settingsPage = () => execFileSync('php', [join(root, 'e2e/render-settings.php'), 'connected'], { encoding: 'utf8' }).replaceAll('https://shop.example/wp-admin/', `${WP}/wp-admin/`);
const links = [];
const wp = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/wp-admin/admin-post.php') {
    const r = JSON.parse(execFileSync('php', [join(root, 'e2e/console-redirect.php')], { encoding: 'utf8', env: { ...process.env, CURTAIN_API_BASE: API, CURTAIN_SK: creds.apiKey, CURTAIN_PK: creds.publicKeyPrefix } }));
    if (r.ok) {
      links.push(r.url);
      // As Settings::handle_console(): nocache_headers(), no referrer, then the redirect.
      res.writeHead(302, { location: r.url, 'cache-control': 'no-cache, must-revalidate, max-age=0, no-store, private', 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(doc(`<div class="wrap"><div class="notice notice-error"><p>${r.notice}</p></div></div>`));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(doc(settingsPage()));
});
await new Promise((done) => wp.listen(WP_PORT, '127.0.0.1', done));

// ---- the walk ---------------------------------------------------------------------------------
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const requests = [];
  context.on('request', (r) => requests.push({ method: r.method(), url: r.url(), referer: r.headers().referer ?? '', body: r.postData() ?? '' }));
  const errors = [];
  context.on('weberror', (e) => errors.push(String(e.error())));

  const page = await context.newPage();
  await page.goto(`${WP}/wp-admin/admin.php?page=curtain`);
  const button = page.getByRole('button', { name: 'Open the Curtain console' });
  await button.scrollIntoViewIfNeeded();
  expect((await button.count()) === 1, 'the settings page has no "Open the Curtain console" button');
  expect((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'the settings page scrolls sideways on a phone');
  await page.locator('#curtain-connection').evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(out, 'woo-phone-01-open-the-console.png') });

  // The button: a new tab, through the plugin's signed request, to the console.
  const [tab] = await Promise.all([context.waitForEvent('page'), button.click()]);
  await tab.waitForURL(`${WEB}/merchant`, { timeout: 60_000 });
  await tab.getByRole('navigation', { name: 'Console sections' }).waitFor();
  await tab.getByText('Loading your shop…').waitFor({ state: 'detached', timeout: 60_000 });
  const link = links[0] ?? '';
  const token = link.split('#t=')[1] ?? '';
  expect(links.length === 1 && token.length > 30, `expected one link with a token, got ${links.length}`);
  expect(!tab.url().includes('#') && !tab.url().includes(token), `the address bar still holds something of the link: ${tab.url()}`);
  const stored = await tab.evaluate(() => ({ session: sessionStorage.getItem('curtain.merchantKey') ?? '', entries: history.length, html: document.documentElement.outerHTML }));
  expect(stored.session.startsWith('cs_'), 'the tab holds no console session');
  expect(!stored.html.includes(token), 'the page holds the link token');
  expect((await tab.getByText('API unreachable').count()) === 0, 'the console shows demo data, not the shop');
  // The token went to the api once, in a request body, and nowhere else.
  const withToken = requests.filter((r) => r.url.includes(token) || r.body.includes(token) || r.referer.includes(token));
  expect(withToken.length === 1 && withToken[0].method === 'POST' && withToken[0].url === `${API}/v1/merchant/console-session` && !withToken[0].url.includes(token), `the token travelled in ${JSON.stringify(withToken.map((r) => `${r.method} ${r.url}`))}`);
  expect(requests.every((r) => !r.referer.includes('/merchant/link#')), 'a referer names the link');
  await tab.screenshot({ path: join(out, 'console-phone-02-signed-in-by-link.png') });

  // "Back" does not bring the link (or its token) up again.
  await tab.goBack({ timeout: 5000 }).catch(() => null);
  expect(!tab.url().includes(token), `"Back" shows the token: ${tab.url()}`);
  await tab.goto(`${WEB}/merchant/products`);
  await tab.getByText('Boho kaftan').first().waitFor({ timeout: 60_000 });
  await tab.screenshot({ path: join(out, 'console-phone-03-products-after-link.png') });
  await tab.goto(`${WEB}/merchant/settings`);
  await tab.getByRole('radio', { name: /Show size advice anyway/ }).waitFor({ timeout: 60_000 });
  expect((await tab.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'the console scrolls sideways on a phone');

  // The same link a second time, in another tab: a plain message, no session, no token left.
  const again = await context.newPage();
  await again.goto(link);
  await again.getByRole('alert').waitFor({ timeout: 60_000 });
  const second = await again.evaluate(() => ({ session: sessionStorage.getItem('curtain.merchantKey'), text: document.body.innerText }));
  expect(second.session === null, 'a used link gave a session');
  expect(second.text.includes('This sign-in link does not work any more'), `a used link says: ${second.text}`);
  expect(!again.url().includes('#') && !again.url().includes(token), `a refused link stays in the address bar: ${again.url()}`);
  await again.screenshot({ path: join(out, 'console-phone-04-used-link.png') });

  // "Sign out" ends the session at the api: the old bearer is refused afterwards.
  await tab.getByRole('button', { name: 'Sign out' }).click();
  await tab.waitForURL(`${WEB}/merchant/login`);
  await new Promise((r) => setTimeout(r, 500));
  const after = await fetch(`${API}/v1/merchant/settings`, { headers: { authorization: `Bearer ${stored.session}` } });
  expect(after.status === 401, `after "Sign out" the session still answers ${after.status}`);

  // Nothing of either token is in the api's log.
  expect(!api.log.text.includes(token) && !api.log.text.includes(stored.session), 'the api log holds a token');
  expect(api.log.text.includes('/v1/merchant/console-session'), 'the api log has no line for the exchange (is logging on?)');
  expect(errors.length === 0, `page errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
  wp.close();
  stop();
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`console-link-shots: ok, pictures in ${out}`);
process.exit(0);
