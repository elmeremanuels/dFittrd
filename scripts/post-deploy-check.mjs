#!/usr/bin/env node
/**
 * The post-deploy check (OI-48): one command that says, line by line, whether a deployed Curtain stack works.
 *
 *   node scripts/post-deploy-check.mjs https://curtain.fit
 *   node scripts/post-deploy-check.mjs https://curtain.fit --shop <publishable key> --product <product id>
 *   node scripts/post-deploy-check.mjs --local            the demo stack of `pnpm demo -- --preview`
 *
 * (`pnpm check:deployed -- <same arguments>` is the same command.)
 *
 * The address is the site's domain; the api is taken as `api.<domain>` and the app as `app.<domain>`
 * (`--api <url>` and `--app <url>` override either). It only makes plain web requests, as a browser and a
 * merchant's server would: no ssh, no password, no secret. Node 22 is all it needs.
 *
 * What it checks:
 *    1  the api is up                                  GET /healthz
 *    2  the api reaches its database and job queue     GET /readyz
 *    3  the "Try it on" script is served               GET /sdk/v1.js
 *    4  the merchant routes refuse a caller without a key, and one with a made-up key
 *    5  the app is served with its security headers    GET app/  (policy, isolation, HSTS on https)
 *    6  the app's code loads as a browser loads it     every script and stylesheet the build names, each as
 *                                                      JavaScript or CSS under the policy; the api's address is in it
 *    7  the api and the app are the same release       /healthz commit = /version.json commit (= --commit)
 *    8  a shopper's phone can register                 POST /v1/devices, and the api lets the app's origin call it
 *    9  "Try it on" opens a session for the product    POST /v1/sdk/sessions
 *   10  the embed page loads with its security headers GET app/embed/<token>  (a made-up link when no shop is given)
 *   11  the product arrives with its size chart        GET /v1/try/<token>
 *   12  a shown size is accepted and not billed        POST /v1/try/<token>/fit-shown
 *   13  a made-up try link is refused                  GET /v1/try/<made-up token>
 *   14  the test shopper is deleted again              DELETE /v1/me
 *
 * 9, 11 and 12 need a shop and one of its products that has a size chart: `--shop` is the shop's publishable
 * key (the `pk_…` value in the theme block or the plugin settings; it is public), `--product` the product's id
 * in the shop. Without them those lines say NOT CHECKED, and the exit code is still 0. `--require-shop` turns
 * that into FAIL: use it wherever nobody reads the lines (a deploy workflow, a cron job), from the moment a
 * development store exists. Use a development store, not a paying shop: the check opens one try session there
 * as surface `api`, which is never billed (line 12 fails if it were), and it deletes its test shopper at the end.
 *
 * What it does not do: run the app. It reads the code a browser would load and the headers a browser would
 * obey, and it asks the api the browser's permission questions (CORS), but no page is rendered. The browser
 * suite (`pnpm check:launch`) does that against the same build before the deploy.
 *
 * Exit code: 0 when no line failed, 1 when one did, 2 when the arguments are wrong.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TIMEOUT_MS = 15_000;

/** The result of one line. */
const pass = (detail) => ({ status: 'pass', detail });
const fail = (detail) => ({ status: 'fail', detail });
const skip = (detail) => ({ status: 'skip', detail });

export function parseArgs(argv) {
  const opts = { api: null, app: null, shop: null, product: null, commit: null, local: false, requireShop: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') opts.local = true;
    else if (a === '--require-shop') opts.requireShop = true;
    else if (['--api', '--app', '--shop', '--product', '--commit'].includes(a)) {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length > 1) throw new Error('give one address only');
  if (opts.local) {
    opts.api ??= 'http://localhost:8787';
    opts.app ??= 'http://localhost:3000';
    if (!opts.shop || !opts.product) {
      // The demo api writes its shop's public key and product ids here (apps/api/src/demo.ts).
      const demo = JSON.parse(readFileSync(join(root, '.demo-db', 'demo.json'), 'utf8'));
      opts.shop ??= demo.publicKey;
      opts.product ??= demo.productExternalIds[0];
    }
  } else if (rest[0]) {
    const base = new URL(/^https?:\/\//.test(rest[0]) ? rest[0] : `https://${rest[0]}`);
    const host = base.host.replace(/^(www|app|api)\./, '');
    opts.api ??= `${base.protocol}//api.${host}`;
    opts.app ??= `${base.protocol}//app.${host}`;
  }
  if (Boolean(opts.shop) !== Boolean(opts.product)) throw new Error('--shop and --product go together: give both or neither');
  if (!opts.api || !opts.app) throw new Error('give the site address (for example https://curtain.fit), or --local, or both --api and --app');
  opts.api = new URL(opts.api).origin;
  opts.app = new URL(opts.app).origin;
  return opts;
}

/** A Content-Security-Policy header as directive → values. */
export function parsePolicy(header) {
  const m = new Map();
  for (const part of (header ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) m.set(name, values);
  }
  return m;
}

const isLocal = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

/**
 * What is wrong with a page's policy; an empty list when nothing is. The rule is the privacy wall (D3):
 * scripts from our origin only, connections to our origin and the api only, and the right framing.
 */
export function policyProblems(header, { surface, api, app }) {
  const p = parsePolicy(header);
  const problems = [];
  if (p.size === 0) return ['no Content-Security-Policy header'];
  const apiSources = api === app ? [] : [api];
  const allowed = new Set(["'self'", ...apiSources]);
  // `extra` may be there; `required` must be: a policy that is too tight stops the app as surely as a loose one leaks.
  const only = (directive, { extra = [], required = ["'self'"] } = {}) => {
    const values = p.get(directive);
    if (!values) return problems.push(`no ${directive}`);
    const others = values.filter((v) => !allowed.has(v) && !extra.includes(v) && !required.includes(v));
    if (others.length) problems.push(`${directive} also allows ${others.join(' ')}`);
    const missing = required.filter((v) => !values.includes(v));
    if (missing.length) problems.push(`${directive} lacks ${missing.join(' ')}${missing.includes(api) ? ' (the app could not reach the api)' : ''}`);
  };
  only('default-src');
  only('connect-src', { required: ["'self'", ...apiSources] });
  // The body scan and the drape are WebAssembly.
  only('script-src', { required: ["'self'", "'wasm-unsafe-eval'"] });
  only('worker-src');
  // Product photos come through the api's media proxy; data: and blob: are the app's own pictures.
  only('img-src', { extra: ['data:', 'blob:'], required: ["'self'", ...apiSources] });
  if ((p.get('object-src') ?? []).join(' ') !== "'none'") problems.push("object-src is not 'none'");
  const ancestors = p.get('frame-ancestors') ?? [];
  if (surface === 'app') {
    if (ancestors.join(' ') !== "'none'") problems.push(`the app can be framed (frame-ancestors ${ancestors.join(' ') || 'missing'})`);
  } else {
    if (!ancestors.includes('https:')) problems.push('shop pages cannot frame the embed (frame-ancestors lacks https:)');
    // A local stack also lets the localhost demo shop frame it; a deployed one must not.
    const extra = ancestors.filter((a) => a !== 'https:' && !(isLocal(app) && /^http:\/\/(localhost|127\.0\.0\.1):\*$/.test(a)));
    if (extra.length) problems.push(`frame-ancestors also allows ${extra.join(' ')}`);
  }
  // A report would carry page addresses, try tokens included, to wherever it points.
  if (!isLocal(app) && (p.has('report-uri') || p.has('report-to'))) problems.push('the policy reports violations to a URL (never in production)');
  return problems;
}

/** What is wrong with the other security headers of a page of the app origin. */
export function headerProblems(headers, { surface, app }) {
  const h = (name) => headers.get(name) ?? '';
  const problems = [];
  const want = (name, value) => {
    if (h(name).toLowerCase() !== value) problems.push(`${name} is ${h(name) ? `"${h(name)}"` : 'missing'} (expected "${value}")`);
  };
  want('x-content-type-options', 'nosniff');
  if (surface === 'app') {
    want('cross-origin-opener-policy', 'same-origin');
    want('cross-origin-embedder-policy', 'require-corp');
    want('cross-origin-resource-policy', 'same-origin');
  } else {
    want('cross-origin-embedder-policy', 'credentialless');
    want('cross-origin-resource-policy', 'cross-origin');
    want('cache-control', 'no-store');
    want('x-robots-tag', 'noindex');
    if (h('x-frame-options')) problems.push(`X-Frame-Options "${h('x-frame-options')}" would stop shop pages from framing the embed`);
    if (h('cross-origin-opener-policy')) problems.push('Cross-Origin-Opener-Policy is set on the embed');
  }
  if (app.startsWith('https:') && !/max-age=\d{7,}/.test(h('strict-transport-security'))) problems.push('no Strict-Transport-Security of a year or more');
  return problems;
}

/** How many files line 6 follows at most; the build has about forty. */
const MAX_FILES = 300;

/** The `src` of the page's module script. */
export function entryScript(html) {
  return /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? /<script[^>]+src="([^"]+)"[^>]+type="module"/.exec(html)?.[1] ?? null;
}

/** The scripts and stylesheets a page preloads or links. */
export function linkedFiles(html) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (href && /\brel="(modulepreload|stylesheet)"/.test(tag)) out.push(href);
  }
  return out;
}

/**
 * The files under /assets/ a built script names, as paths: static imports (`from"./a.js"`), lazy chunks and their
 * preload lists (`import("./a.js")`, `__vite__mapDeps` → `"assets/a.js"`) and workers (`"/assets/a.worker.js"`).
 * Read as text, the way the build wrote them: any quoted .js or .css name that lands in /assets/.
 */
export function namedFiles(script, path) {
  const out = new Set();
  for (const m of script.matchAll(/["'`]((?:\.{1,2}\/|\/?assets\/)[A-Za-z0-9_.\-/]+\.(?:m?js|css))["'`]/g)) {
    const ref = m[1];
    const resolved = new URL(ref, `http://x${ref.startsWith('assets/') ? '/' : path}`).pathname;
    if (resolved.startsWith('/assets/')) out.add(resolved);
  }
  return [...out];
}

const short = (commit) => (/^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 12) : commit);

/**
 * Run every check. `fetchImpl` is replaceable for tests. Returns `{ lines, failed, skipped }`; each line is
 * `{ n, title, status: 'pass' | 'fail' | 'skip', detail }`.
 */
export async function runChecks(opts, { fetchImpl = fetch, onLine = () => {} } = {}) {
  const { api, app, shop, product } = opts;
  const lines = [];
  const state = {};

  const request = async (url, init = {}) => {
    state.asked = String(url);
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, text, json };
  };
  const errorOf = (r) =>
    r.status === 429
      ? ' (too many requests from this address within a minute: wait a minute and run the check again)'
      : r.json?.error?.code
        ? ` (${r.json.error.code}${r.json.error.message ? `: ${r.json.error.message}` : ''})`
        : '';
  const check = async (title, fn) => {
    let result;
    try {
      result = await fn();
    } catch (err) {
      const cause = err?.cause?.code ?? err?.cause?.message;
      const from = (() => {
        try {
          return ` from ${new URL(state.asked).origin}`;
        } catch {
          return '';
        }
      })();
      result = fail(`no answer${from}: ${err?.name === 'TimeoutError' ? `nothing within ${TIMEOUT_MS / 1000} s` : err?.message ?? String(err)}${cause ? ` (${cause})` : ''}`);
    }
    const line = { n: lines.length + 1, title, ...result };
    lines.push(line);
    onLine(line);
  };
  const noShopText = 'no shop given: run again with --shop <publishable key> --product <product id> once a shop is installed';
  const noShop = () => (opts.requireShop ? fail(`${noShopText} (--require-shop: a run without one does not count)`) : skip(noShopText));

  /**
   * The browser's permission question. The app calls the api from another origin with an Authorization header,
   * so the browser first asks the api (a preflight) whether that origin may; this check's own requests come
   * from Node, which asks nobody. Returns what is wrong, or null.
   */
  const corsProblem = async (method, path, requestHeaders) => {
    if (api === app) return null;
    const r = await request(`${api}${path}`, { method: 'OPTIONS', headers: { origin: app, 'access-control-request-method': method, 'access-control-request-headers': requestHeaders.join(',') } });
    const shown = path.replace(/\/try\/[^/]{20,}/, '/try/<token>');
    const origin = r.headers.get('access-control-allow-origin');
    const why = (what) => `the api does not let the app call it from a browser: asked whether ${app} may ${method} ${shown}, it answered ${r.status} ${what}`;
    if (origin !== app && origin !== '*') return why(`${origin ? `allowing "${origin}"` : 'without access-control-allow-origin'} (PUBLIC_APP_URL or CORS_ORIGINS on the server does not name ${app})`);
    const list = (name) => (r.headers.get(name) ?? '').toLowerCase().split(',').map((v) => v.trim());
    if (!list('access-control-allow-methods').some((m) => m === method.toLowerCase() || m === '*')) return why(`without ${method} in access-control-allow-methods`);
    const refused = requestHeaders.filter((h) => !list('access-control-allow-headers').some((a) => a === h || a === '*'));
    return refused.length ? why(`without ${refused.join(' and ')} in access-control-allow-headers`) : null;
  };

  await check('The api is up', async () => {
    const r = await request(`${api}/healthz`);
    if (r.status !== 200 || r.json?.ok !== true) return fail(`GET ${api}/healthz answered ${r.status}`);
    state.apiCommit = r.json.commit;
    // A header set by both the proxy and the api arrives twice, joined with a comma. Browsers do not read
    // two copies of Cross-Origin-Resource-Policy as a value, and a cross-origin isolated page then blocks the response.
    const twice = ['cross-origin-resource-policy', 'strict-transport-security', 'x-content-type-options'].filter((name) => /,/.test((r.headers.get(name) ?? '').replace(/;[^,]*/g, '')));
    if (twice.length) return fail(`up, but it sends ${twice.join(' and ')} twice (the proxy and the api both set it)`);
    if (api.startsWith('https:') && !/max-age=\d{7,}/.test(r.headers.get('strict-transport-security') ?? '')) return fail('up, but without Strict-Transport-Security of a year or more');
    return pass(`version ${r.json.version}, commit ${short(r.json.commit ?? 'not reported')}`);
  });

  await check('The api reaches its database and its job queue', async () => {
    const r = await request(`${api}/readyz`);
    if (r.status === 200 && r.json?.ok === true) return pass('database yes, jobs yes');
    return fail(`GET ${api}/readyz answered ${r.status}: database ${r.json?.db ? 'yes' : 'NO'}, jobs ${r.json?.jobs ? 'yes' : 'NO'}`);
  });

  await check('The "Try it on" script for shop pages is served', async () => {
    const r = await request(`${api}/sdk/v1.js`, { headers: { accept: '*/*' } });
    if (r.status !== 200) return fail(`GET ${api}/sdk/v1.js answered ${r.status}`);
    if (!/javascript/.test(r.headers.get('content-type') ?? '')) return fail(`it is served as ${r.headers.get('content-type')}, not as JavaScript`);
    if (r.text.length < 2000) return fail(`it is only ${r.text.length} bytes`);
    const corp = r.headers.get('cross-origin-resource-policy') ?? '';
    if (corp !== 'cross-origin') return fail(`shop pages that isolate themselves may not load it: Cross-Origin-Resource-Policy is ${corp ? `"${corp}"` : 'missing'}, not "cross-origin"${corp.includes(',') ? ' (sent twice: the proxy and the api both set it)' : ''}`);
    return pass(`${Math.round(r.text.length / 1024)} KB, loadable from any shop page`);
  });

  await check('The merchant routes refuse a caller without a key', async () => {
    const none = await request(`${api}/v1/merchant/products`);
    if (none.status !== 401) return fail(`GET /v1/merchant/products without a key answered ${none.status}, not 401`);
    // Not a real key: built here, in the shape of one.
    const madeUp = ['sk', 'live', 'postdeploycheck0000000000000000'].join('_');
    const wrong = await request(`${api}/v1/merchant/products`, { headers: { authorization: `Bearer ${madeUp}` } });
    if (wrong.status !== 401) return fail(`GET /v1/merchant/products with a made-up key answered ${wrong.status}, not 401`);
    // A write as well as a read: nothing may be stored for a caller without a key.
    const write = await request(`${api}/v1/merchant/products/post-deploy-check`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'post-deploy-check', name: 'Post-deploy check', brand: 'Curtain' }) });
    if (write.status !== 401) return fail(`PUT /v1/merchant/products/<id> without a key answered ${write.status}, not 401`);
    return pass('401 without a key (read and write), 401 with a made-up key');
  });

  await check('The app is served with its security headers', async () => {
    const r = await request(`${app}/`, { headers: { accept: 'text/html' } });
    if (r.status !== 200) return fail(`GET ${app}/ answered ${r.status}`);
    if (!/<div id="root"|<script[^>]+type="module"/.test(r.text)) return fail('the page is not the app (no script in it)');
    state.appHtml = r.text;
    const problems = [...policyProblems(r.headers.get('content-security-policy'), { surface: 'app', api, app }), ...headerProblems(r.headers, { surface: 'app', app })];
    return problems.length ? fail(problems.join('; ')) : pass(`policy on, never framed, cross-origin isolated${app.startsWith('https:') ? ', HTTPS enforced' : ''}`);
  });

  await check('The app’s code loads as a browser loads it', async () => {
    if (!state.appHtml) return fail('the app page did not load (line above)');
    const entry = entryScript(state.appHtml);
    if (!entry) return fail('the app page names no script');
    state.entry = entry;
    // Every file the build names, followed from the page: its entry script, its preloads and stylesheets, then
    // whatever each script names in turn (static imports, lazy chunks, workers). The embed's own chunks are
    // among them: the page is the same file for / and for /embed/<token>.
    const start = [entry, ...linkedFiles(state.appHtml)].map((ref) => new URL(ref, `${app}/`));
    const foreign = start.find((u) => u.origin !== app);
    if (foreign) return fail(`the app loads code from another origin: ${foreign.origin}`);
    const seen = new Set(start.map((u) => u.pathname));
    let queue = [...seen];
    let bytes = 0;
    let namesApi = false;
    while (queue.length) {
      if (seen.size > MAX_FILES) return fail(`the build names more than ${MAX_FILES} files: this check does not follow that many`);
      const batch = queue.splice(0, 6);
      const answers = await Promise.all(batch.map(async (path) => ({ path, r: await request(`${app}${path}`, { headers: { accept: '*/*' } }) })));
      for (const { path, r } of answers) {
        const type = r.headers.get('content-type') ?? '';
        const css = path.endsWith('.css');
        if (r.status !== 200) return fail(`GET ${path} answered ${r.status}: the page names a file the server does not have`);
        if (!(css ? /text\/css/ : /javascript/).test(type)) {
          return fail(`${path} is served as ${type || 'nothing'}, not as ${css ? 'CSS' : 'JavaScript'}${/text\/html/.test(type) ? ': the file is not in the published build, so the server answers with the app page and a browser refuses it' : ''}`);
        }
        bytes += r.text.length;
        if (css) continue;
        // A worker's policy is its own script's response, so every script carries it, not only the page.
        const problems = policyProblems(r.headers.get('content-security-policy'), { surface: 'app', api, app });
        if (problems.length) return fail(`${path}: ${problems.join('; ')}`);
        if (r.text.includes(api)) namesApi = true;
        for (const next of namedFiles(r.text, path)) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
    }
    if (api !== app && !namesApi) return fail(`none of the ${seen.size} files names ${api}: the web build was made with another VITE_API_URL, or none, so the app would call the wrong address`);
    return pass(`${seen.size} files, ${Math.round(bytes / 1024)} KB, each served as what it is${api !== app ? `; the build calls ${api}` : ''}`);
  });

  await check('The api and the app are the same release', async () => {
    const r = await request(`${app}/version.json`);
    const webCommit = r.status === 200 && typeof r.json?.commit === 'string' ? r.json.commit : null;
    const apiCommit = state.apiCommit ?? null;
    if (!apiCommit) return fail('the api does not say which commit it was built from (/healthz has no commit: an image from before this check)');
    if (!webCommit) return fail(`the app does not say which commit it was built from (GET ${app}/version.json answered ${r.status})`);
    if (apiCommit === 'unknown' || webCommit === 'unknown') return fail(`not stamped: api "${apiCommit}", app "${webCommit}" (a build made without GIT_SHA; the deploy workflow sets it)`);
    if (apiCommit !== webCommit) return fail(`they differ: api ${short(apiCommit)}, app ${short(webCommit)}. One of the two was not swapped by the deploy`);
    if (opts.commit && !apiCommit.startsWith(opts.commit) && !opts.commit.startsWith(apiCommit)) return fail(`both are ${short(apiCommit)}, but you expected ${short(opts.commit)}: an older release is being served`);
    return pass(`both are commit ${short(apiCommit)}${opts.commit ? ', the one you expected' : ''}`);
  });

  await check('A shopper’s phone can register', async () => {
    const r = await request(`${api}/v1/devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'web', appVersion: 'post-deploy-check' }) });
    if (r.status !== 201 || !r.json?.token) return fail(`POST /v1/devices answered ${r.status}${errorOf(r)}`);
    state.device = r.json.token;
    const cors = await corsProblem('POST', '/v1/devices', ['content-type']);
    if (cors) return fail(`a test shopper was created, but ${cors}`);
    return pass(`an anonymous test shopper was created${api !== app ? ', and the app’s origin may ask for one' : ''}`);
  });
  const auth = () => ({ authorization: `Bearer ${state.device}` });

  await check('"Try it on" opens a session for the product', async () => {
    if (!shop || !product) return noShop();
    const r = await request(`${api}/v1/sdk/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopKeyPrefix: shop, productExternalId: product, pageUrl: `${app}/post-deploy-check`, surface: 'api' }) });
    if (r.status === 402) return fail('the shop is paused: its plan is not active, so the button is hidden on its product pages');
    if (r.status === 404) return fail(`the api does not know this ${r.json?.error?.message?.includes('product') ? `product ("${product}") in the shop` : `shop or product${errorOf(r)}`}`);
    if (r.status !== 200 || !r.json?.embedUrl) return fail(`POST /v1/sdk/sessions answered ${r.status}${errorOf(r)}`);
    const embed = new URL(r.json.embedUrl);
    if (embed.origin !== app) return fail(`the session points shoppers at ${embed.origin}, not at ${app}: PUBLIC_APP_URL is wrong on the server`);
    state.embedUrl = embed.href;
    state.token = embed.pathname.split('/').pop();
    return pass(`product "${product}"${r.json.productState === 'coming_soon' ? ' (shown as coming soon)' : ''}, link valid until ${r.json.expiresAt}`);
  });

  await check('The embed page loads with its security headers', async () => {
    const real = Boolean(shop && product);
    if (real && !state.embedUrl) return fail('no session was opened (line above)');
    // The headers do not depend on the token (the page is the same file for every link), so without a shop a
    // made-up link still shows whether shop pages can frame the embed and whether it is kept out of caches.
    const url = real ? state.embedUrl : `${app}/embed/post-deploy-check`;
    const r = await request(url, { headers: { accept: 'text/html' } });
    const shown = `GET ${app}/embed/<${real ? 'token' : 'made-up link'}>`;
    if (r.status !== 200 || !/<script[^>]+type="module"/.test(r.text)) return fail(`${shown} answered ${r.status}`);
    const problems = [...policyProblems(r.headers.get('content-security-policy'), { surface: 'embed', api, app }), ...headerProblems(r.headers, { surface: 'embed', app })];
    if (state.entry && entryScript(r.text) !== state.entry) problems.push(`the embed page starts another script (${entryScript(r.text) ?? 'none'}) than the app page (${state.entry}), which line 6 read`);
    if (problems.length) return fail(problems.join('; '));
    return pass(`policy on, framable by https shop pages only, not cached, not indexed${real ? '' : ' (on a made-up link: no shop given)'}`);
  });

  await check('The product arrives with its size chart', async () => {
    if (!shop || !product) return noShop();
    if (!state.token || !state.device) return fail('no session or no test shopper (lines above)');
    const r = await request(`${api}/v1/try/${state.token}?caps=requires3d`, { headers: auth() });
    if (r.status !== 200 || !r.json?.garment) return fail(`GET /v1/try/<token> answered ${r.status}${errorOf(r)}`);
    state.intentToken = r.json.trySession?.intentToken;
    const sizes = (r.json.garment.sizeChart ?? []).map((row) => row.size ?? row.label).filter(Boolean);
    state.size = sizes[0];
    if (sizes.length === 0) return fail(`"${r.json.garment.name}" came without a size chart`);
    const cors = await corsProblem('GET', `/v1/try/${state.token}`, ['authorization']);
    if (cors) return fail(`it arrives here, but ${cors}`);
    return pass(`"${r.json.garment.name}" from ${r.json.shop?.name ?? 'the shop'}, sizes ${sizes.join(', ')}`);
  });

  await check('A shown size is accepted and not billed', async () => {
    if (!shop || !product) return noShop();
    if (!state.intentToken || !state.size) return fail('the product did not arrive (line above)');
    const r = await request(`${api}/v1/try/${state.token}/fit-shown`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ intentToken: state.intentToken, recommendedSize: String(state.size), confidence: 0.5 }) });
    if (r.status !== 200) return fail(`POST /v1/try/<token>/fit-shown answered ${r.status}${errorOf(r)}`);
    if (r.json?.billed !== false) return fail('THIS CHECK WAS BILLED to the shop as a try session. It must never be: tell engineering');
    const cors = await corsProblem('POST', `/v1/try/${state.token}/fit-shown`, ['authorization', 'content-type']);
    if (cors) return fail(`recorded and not billed, but ${cors}`);
    return pass(`size ${state.size} recorded, nothing billed to the shop`);
  });

  await check('A made-up try link is refused', async () => {
    if (!state.device) return fail('no test shopper (line 8)');
    const r = await request(`${api}/v1/try/not-a-real-try-link`, { headers: auth() });
    if (r.status !== 401 && r.status !== 400) return fail(`GET /v1/try/<made-up token> answered ${r.status}, not 401${errorOf(r)}`);
    // Needs no shop, so the try route's answer to the app's origin is checked on every run.
    const cors = await corsProblem('GET', '/v1/try/not-a-real-try-link', ['authorization']);
    return cors ? fail(`refused (${r.status}), but ${cors}`) : pass(`answered ${r.status}`);
  });

  await check('The test shopper is deleted again', async () => {
    if (!state.device) return fail('no test shopper was created (line 8)');
    const r = await request(`${api}/v1/me`, { method: 'DELETE', headers: auth() });
    if (r.status !== 200) return fail(`DELETE /v1/me answered ${r.status}${errorOf(r)}: the test shopper is still there`);
    const again = await request(`${api}/v1/me/ledger`, { headers: auth() });
    return again.status === 401 ? pass('deleted, and its token no longer works') : fail(`deleted, but its token still works (GET /v1/me/ledger answered ${again.status})`);
  });

  return { lines, failed: lines.filter((l) => l.status === 'fail').length, skipped: lines.filter((l) => l.status === 'skip').length };
}

const LABEL = { pass: 'PASS       ', fail: 'FAIL       ', skip: 'NOT CHECKED' };
export const formatLine = (l) => `${String(l.n).padStart(2)}  ${LABEL[l.status]}  ${l.title}: ${l.detail}`;

export function summary({ lines, failed, skipped }) {
  const passed = lines.length - failed - skipped;
  if (failed) return `RESULT: NOT WORKING. ${failed} of ${lines.length} checks failed (${passed} passed${skipped ? `, ${skipped} not checked` : ''}). Read the FAIL lines above.`;
  if (skipped) return `RESULT: what was checked works (${passed} passed), but ${skipped} checks were NOT run: the try session needs --shop and --product. Whether a shopper can try a product on is not known from this run.`;
  return `RESULT: the deployed stack works. All ${lines.length} checks passed.`;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`post-deploy-check: ${err.message}\n\nUsage: node scripts/post-deploy-check.mjs https://<domain> [--shop <publishable key> --product <product id>] [--require-shop] [--commit <sha>]\n       node scripts/post-deploy-check.mjs --local`);
    process.exit(2);
  }
  console.log(`Curtain post-deploy check, ${new Date().toISOString()}\n  api  ${opts.api}\n  app  ${opts.app}\n  shop ${opts.shop ? `${opts.shop}, product ${opts.product}` : 'none given'}\n`);
  const result = await runChecks(opts, { onLine: (l) => console.log(formatLine(l)) });
  console.log(`\n${summary(result)}`);
  process.exit(result.failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`post-deploy-check: ${err.stack ?? err}`);
    process.exit(1);
  });
}
