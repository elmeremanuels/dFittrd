#!/usr/bin/env node
/**
 * The marketing site under its production security policy, in a real browser (OI-70).
 *
 *   node scripts/site-csp-check.mjs            build apps/site, then check every page
 *   node scripts/site-csp-check.mjs --skip-build
 *
 * Production serves apps/site from Caddy with a same-origin Content-Security-Policy (`infra/Caddyfile`, the
 * `{$DOMAIN}` block). Nothing ran the built pages under that policy: `apps/api/src/caddy-site.test.ts` reads
 * three pages for inline scripts, and the site's own preview sends no policy. This script
 *
 *   1. reads the headers of the `{$DOMAIN}` block out of the Caddyfile (the policy is not copied here);
 *   2. serves apps/site/dist on a local port with exactly those headers, the same try_files and 404 page;
 *   3. opens every page of the sitemap, the 404 page and the share-card page in Chromium, on a desktop and a
 *      phone viewport, scrolls each to the end and opens the menu and every disclosure;
 *   4. fails on a policy violation, a console error, an uncaught exception, a request that failed, or a
 *      request to any other origin;
 *   5. last, asks the page to fetch another origin: that must be refused and reported, which proves the policy
 *      was on and the violation listener works.
 *
 * Prints one line per page. Exit code 0 only when every line is ok. Part of `pnpm check:launch`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib/playwright.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'apps', 'site', 'dist');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.webmanifest': 'application/manifest+json',
};

/** The headers Caddy sets on every response of the apex site: `base_headers`, its HSTS line and its own `header { }` block. */
export function siteHeaders(caddyfile) {
  const start = caddyfile.indexOf('\n{$DOMAIN} {\n');
  if (start < 0) throw new Error('no {$DOMAIN} site block in infra/Caddyfile');
  const block = caddyfile.slice(start, caddyfile.indexOf('\n}\n', start + 1));
  const base = /\n\(base_headers\) \{\n\theader \{\n([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1];
  const own = /\n\theader \{\n([\s\S]*?)\n\t\}/.exec(block)?.[1];
  if (!block.includes('import base_headers') || !base || !own) throw new Error('the {$DOMAIN} block no longer has the shape this check reads (import base_headers + one header { } block)');
  const headers = {};
  for (const raw of `${base}\n${own}`.split('\n')) {
    const line = raw.trim();
    const m = /^([A-Za-z-]+) "(.*)"$/.exec(line);
    if (m) headers[m[1]] = m[2];
    else if (line && !line.startsWith('#') && !line.startsWith('-')) throw new Error(`a header line this check cannot read: ${line}`);
  }
  if (!headers['Content-Security-Policy']) throw new Error('the {$DOMAIN} block sends no Content-Security-Policy');
  return headers;
}

/** apps/site/dist as Caddy serves it: /dir → /dir/ (308), try_files {path} {path}/index.html, the site's 404 page. */
export function createSiteServer(headers, dir = dist) {
  const file = (rel) => {
    const full = join(dir, normalize(rel).replace(/^([/\\])+/, ''));
    return full.startsWith(dir) && existsSync(full) && statSync(full).isFile() ? full : null;
  };
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const send = (status, full) => {
      res.writeHead(status, { ...headers, 'content-type': TYPES[extname(full)] ?? 'application/octet-stream' });
      res.end(readFileSync(full));
    };
    if (!path.endsWith('/') && file(`${path}/index.html`)) {
      res.writeHead(308, { ...headers, location: `${path}/` });
      return res.end();
    }
    const hit = file(path) ?? file(`${path}/index.html`);
    if (hit) return send(200, hit);
    const notFound = file('404.html');
    if (notFound) return send(404, notFound);
    res.writeHead(404, headers);
    res.end('Not found');
  });
}

/** Every page to open: the sitemap's, plus two that are not in it (the 404 page and the share-card page, when built). */
function pagePaths() {
  const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  if (paths.length === 0) throw new Error('apps/site/dist/sitemap.xml lists no page');
  if (existsSync(join(dist, 'og-card.html'))) paths.push('/og-card.html');
  paths.push('/no-such-page-for-the-policy-check');
  return [...new Set(paths)];
}

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 860 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

async function checkPage(context, origin, path) {
  const page = await context.newPage();
  const problems = [];
  // Runs before the page's own scripts; an init script is not subject to the page's policy.
  await page.exposeFunction('__curtainViolation', (v) => problems.push(`policy violation: ${v.directive} refused ${v.blocked || 'inline'}${v.sample ? ` (${v.sample})` : ''}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => window.__curtainViolation({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample }));
  });
  page.on('pageerror', (e) => problems.push(`uncaught: ${String(e)}`));
  page.on('console', (m) => {
    // A 404 on purpose prints one "Failed to load resource" for the document itself.
    if (m.type() === 'error' && !(path.startsWith('/no-such-page') && /404/.test(m.text()))) problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol !== 'data:' && u.protocol !== 'blob:' && u.origin !== origin) problems.push(`request to another origin: ${u.origin}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !(path.startsWith('/no-such-page') && r.url() === origin + path)) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  try {
    const res = await page.goto(origin + path, { waitUntil: 'load' });
    const expected = path.startsWith('/no-such-page') ? 404 : 200;
    if (res?.status() !== expected) problems.push(`HTTP ${res?.status()} for the page itself (expected ${expected})`);
    if (!(res?.headers()['content-security-policy'] ?? '').includes("default-src 'self'")) problems.push('the page came without the site policy');
    // Use the page: open what can be opened, then scroll to the end so lazy images and scroll effects run.
    await page.evaluate(async () => {
      for (const d of document.querySelectorAll('details')) d.open = true;
      for (const b of document.querySelectorAll('button[aria-expanded="false"]')) b.click();
      const step = Math.max(200, window.innerHeight / 2);
      for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    await page.waitForLoadState('networkidle');
  } catch (err) {
    problems.push(`could not load: ${String(err).split('\n')[0]}`);
  }
  await page.close();
  return problems;
}

/** The policy must refuse a request to another origin, and the listener must hear of it. */
async function canary(context, origin) {
  const page = await context.newPage();
  const seen = [];
  let left = false;
  await page.exposeFunction('__curtainViolation', (v) => seen.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => window.__curtainViolation({ directive: e.effectiveDirective, blocked: e.blockedURI }));
  });
  // Nothing leaves this machine even if the policy were off.
  await page.route((u) => u.origin !== origin, (route) => {
    left = true;
    return route.abort();
  });
  await page.goto(`${origin}/`);
  const refused = await page.evaluate(() => fetch('https://policy-canary.invalid/x').then(() => false, () => true));
  await page.waitForTimeout(200);
  await page.close();
  return refused && !left && seen.some((v) => v.directive === 'connect-src');
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    const r = spawnSync(pnpm, ['--filter', '@curtain/site', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) throw new Error(`building apps/site failed (exit ${r.status})`);
  }
  if (!existsSync(join(dist, 'index.html'))) throw new Error('apps/site/dist is missing: run without --skip-build');
  const headers = siteHeaders(readFileSync(join(root, 'infra', 'Caddyfile'), 'utf8'));
  const server = createSiteServer(headers);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  let failed = 0;
  let checked = 0;
  try {
    console.log(`site policy: ${headers['Content-Security-Policy']}`);
    for (const vp of VIEWPORTS) {
      const { name, ...options } = vp;
      const context = await browser.newContext(options);
      for (const path of pagePaths()) {
        checked++;
        const problems = [...new Set(await checkPage(context, origin, path))];
        if (problems.length) failed++;
        console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${name.padEnd(7)} ${path}${problems.map((p) => `\n        ${p}`).join('')}`);
      }
      if (name === 'desktop') {
        checked++;
        const ok = await canary(context, origin);
        if (!ok) failed++;
        console.log(`${ok ? 'ok  ' : 'FAIL'}  canary  a request to another origin is refused and reported${ok ? '' : ' (it was NOT: the policy is not enforced, so the lines above prove nothing)'}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  console.log(failed ? `\nsite-csp-check: ${failed} of ${checked} checks FAILED` : `\nsite-csp-check: ${checked} checks passed; the site works under its production policy`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`site-csp-check: ${err.message}`);
    process.exit(1);
  });
}
