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
 *    6  the app's own script loads, under the same policy
 *    7  the api and the app are the same release       /healthz commit = /version.json commit (= --commit)
 *    8  a shopper's phone can register                 POST /v1/devices
 *    9  "Try it on" opens a session for the product    POST /v1/sdk/sessions
 *   10  the embed page loads with its security headers GET app/embed/<token>
 *   11  the product arrives with its size chart        GET /v1/try/<token>
 *   12  a shown size is accepted and not billed        POST /v1/try/<token>/fit-shown
 *   13  a made-up try link is refused                  GET /v1/try/<made-up token>
 *   14  the test shopper is deleted again              DELETE /v1/me
 *
 * 9 to 12 need a shop and one of its products that has a size chart: `--shop` is the shop's publishable key
 * (the `pk_…` value in the theme block or the plugin settings; it is public), `--product` the product's id
 * in the shop. Without them those lines say NOT CHECKED. Use a development store, not a paying shop: the
 * check opens one try session there as surface `api`, which is never billed (line 12 fails if it were),
 * and it deletes its test shopper at the end.
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
  const opts = { api: null, app: null, shop: null, product: null, commit: null, local: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') opts.local = true;
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
  const allowed = new Set(["'self'", ...(api === app ? [] : [api])]);
  const only = (directive, extra = []) => {
    const values = p.get(directive);
    if (!values) return problems.push(`no ${directive}`);
    const others = values.filter((v) => !allowed.has(v) && !extra.includes(v));
    if (others.length) problems.push(`${directive} also allows ${others.join(' ')}`);
  };
  only('default-src');
  only('connect-src');
  only('script-src', ["'wasm-unsafe-eval'"]);
  only('worker-src');
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
      result = fail(`no answer: ${err?.name === 'TimeoutError' ? `nothing within ${TIMEOUT_MS / 1000} s` : err?.message ?? String(err)}${cause ? ` (${cause})` : ''}`);
    }
    const line = { n: lines.length + 1, title, ...result };
    lines.push(line);
    onLine(line);
  };
  const noShop = 'no shop given: run again with --shop <publishable key> --product <product id> once a shop is installed';

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

  await check('The app’s own script loads, under the same policy', async () => {
    if (!state.appHtml) return fail('the app page did not load (line above)');
    const src = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(state.appHtml)?.[1] ?? /<script[^>]+src="([^"]+)"[^>]+type="module"/.exec(state.appHtml)?.[1];
    if (!src) return fail('the app page names no script');
    const url = new URL(src, `${app}/`);
    if (url.origin !== app) return fail(`the app loads its script from another origin: ${url.origin}`);
    const r = await request(url.href, { headers: { accept: '*/*' } });
    if (r.status !== 200 || !/javascript/.test(r.headers.get('content-type') ?? '')) return fail(`GET ${url.pathname} answered ${r.status} ${r.headers.get('content-type') ?? ''}`);
    const problems = policyProblems(r.headers.get('content-security-policy'), { surface: 'app', api, app });
    return problems.length ? fail(`${url.pathname}: ${problems.join('; ')}`) : pass(`${url.pathname}, ${Math.round(r.text.length / 1024)} KB`);
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
    return pass('an anonymous test shopper was created');
  });
  const auth = () => ({ authorization: `Bearer ${state.device}` });

  await check('"Try it on" opens a session for the product', async () => {
    if (!shop || !product) return skip(noShop);
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
    if (!shop || !product) return skip(noShop);
    if (!state.embedUrl) return fail('no session was opened (line above)');
    const r = await request(state.embedUrl, { headers: { accept: 'text/html' } });
    if (r.status !== 200 || !/<script[^>]+type="module"/.test(r.text)) return fail(`GET ${app}/embed/<token> answered ${r.status}`);
    const problems = [...policyProblems(r.headers.get('content-security-policy'), { surface: 'embed', api, app }), ...headerProblems(r.headers, { surface: 'embed', app })];
    return problems.length ? fail(problems.join('; ')) : pass('policy on, framable by https shop pages only, not cached, not indexed');
  });

  await check('The product arrives with its size chart', async () => {
    if (!shop || !product) return skip(noShop);
    if (!state.token || !state.device) return fail('no session or no test shopper (lines above)');
    const r = await request(`${api}/v1/try/${state.token}?caps=requires3d`, { headers: auth() });
    if (r.status !== 200 || !r.json?.garment) return fail(`GET /v1/try/<token> answered ${r.status}${errorOf(r)}`);
    state.intentToken = r.json.trySession?.intentToken;
    const sizes = (r.json.garment.sizeChart ?? []).map((row) => row.size ?? row.label).filter(Boolean);
    state.size = sizes[0];
    if (sizes.length === 0) return fail(`"${r.json.garment.name}" came without a size chart`);
    return pass(`"${r.json.garment.name}" from ${r.json.shop?.name ?? 'the shop'}, sizes ${sizes.join(', ')}`);
  });

  await check('A shown size is accepted and not billed', async () => {
    if (!shop || !product) return skip(noShop);
    if (!state.intentToken || !state.size) return fail('the product did not arrive (line above)');
    const r = await request(`${api}/v1/try/${state.token}/fit-shown`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ intentToken: state.intentToken, recommendedSize: String(state.size), confidence: 0.5 }) });
    if (r.status !== 200) return fail(`POST /v1/try/<token>/fit-shown answered ${r.status}${errorOf(r)}`);
    if (r.json?.billed !== false) return fail('THIS CHECK WAS BILLED to the shop as a try session. It must never be: tell engineering');
    return pass(`size ${state.size} recorded, nothing billed to the shop`);
  });

  await check('A made-up try link is refused', async () => {
    if (!state.device) return fail('no test shopper (line 8)');
    const r = await request(`${api}/v1/try/not-a-real-try-link`, { headers: auth() });
    return r.status === 401 || r.status === 400 ? pass(`answered ${r.status}`) : fail(`GET /v1/try/<made-up token> answered ${r.status}, not 401${errorOf(r)}`);
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
  if (skipped) return `RESULT: what was checked works (${passed} passed), but ${skipped} checks were NOT run: the try session needs --shop and --product.`;
  return `RESULT: the deployed stack works. All ${lines.length} checks passed.`;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`post-deploy-check: ${err.message}\n\nUsage: node scripts/post-deploy-check.mjs https://<domain> [--shop <publishable key> --product <product id>] [--commit <sha>]\n       node scripts/post-deploy-check.mjs --local`);
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
