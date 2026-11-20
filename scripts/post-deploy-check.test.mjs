/**
 * The post-deploy check against the local demo stack (OI-48), and its negative controls.
 *
 *   node --test scripts/post-deploy-check.test.mjs        (part of `pnpm check:launch`)
 *
 * Starts `pnpm demo -- --preview`: the demo api, the demo storefront and the web app as its production build
 * under the production security headers. Then:
 *   - every line of the check passes, none is skipped, and the command exits 0;
 *   - with one thing broken at a time (an answer changed on its way back), the line that is about it fails
 *     and the others do not, so a PASS means something. Among them the three ways the stack answered every
 *     request and still could not run in a browser: a chunk that is not in the build, a build that calls
 *     another api address, and an api that refuses the app's origin.
 * A stack already running on the demo ports is reused; it must have been started with --preview.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startDemo, URLS } from './demo.mjs';
import { entryScript, formatLine, headerProblems, linkedFiles, namedFiles, parseArgs, policyProblems, runChecks, summary } from './post-deploy-check.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKIP_BUILD = process.argv.includes('--skip-build') || process.env.DEMO_SKIP_BUILD === '1';
// The release the stack is built as, so "the api and the app are the same release" has something to compare.
// With DEMO_SKIP_BUILD=1 the web build of an earlier run is served, so the api is started as that same release.
const builtAs = () => {
  try {
    return JSON.parse(readFileSync(join(root, '.demo-db', 'web', 'version.json'), 'utf8')).commit;
  } catch {
    return undefined;
  }
};
process.env.GIT_SHA ??= (SKIP_BUILD && builtAs()) || 'c0ffee0123456789abcdef0123456789abcdef01';

// The negative controls below run the check some twenty times within a minute; the api's per-address limits
// (30 try links a minute by default) are for shoppers, not for this.
process.env.TRY_RATE_LIMIT_PER_MIN ??= '2000';
process.env.SDK_RATE_LIMIT_PER_MIN ??= '2000';
process.env.DEVICE_CREATE_RATE_LIMIT_PER_HOUR ??= '20000';

const api = new URL(URLS.api).origin;
const app = new URL(URLS.web).origin;

/** `fetch`, with the answer to one request changed on its way back. */
function tamper(match, change) {
  return async (url, init) => {
    const res = await fetch(url, init);
    if (!match(new URL(String(url)), init ?? {})) return res;
    const headers = new Headers(res.headers);
    const body = await res.text();
    const out = change({ status: res.status, headers, body }) ?? {};
    const status = out.status ?? res.status;
    // A 204 or 304 has no body, and Response refuses one given a body.
    return new Response([204, 304].includes(status) ? null : (out.body ?? body), { status, headers: out.headers ?? headers });
  };
}
const failedLines = (r) => r.lines.filter((l) => l.status === 'fail').map((l) => l.n);

describe('post-deploy check on the local demo stack', () => {
  let demo;
  let opts;
  let commit;
  before(async () => {
    demo = await startDemo({ web: 'preview', log: 'quiet', build: !SKIP_BUILD });
    const json = JSON.parse(readFileSync(join(root, '.demo-db', 'demo.json'), 'utf8'));
    opts = { api, app, shop: json.publicKey, product: json.productExternalIds[0], commit: null };
    // The commit the running stack was built as (GIT_SHA above, or its own when a running stack was reused).
    commit = (await (await fetch(`${api}/healthz`)).json()).commit;
  }, { timeout: 600_000 });
  after(async () => {
    await demo?.stop();
  });

  it('every line passes and none is skipped', async () => {
    const r = await runChecks(opts);
    assert.deepEqual(r.lines.filter((l) => l.status !== 'pass').map(formatLine), []);
    assert.equal(r.lines.length, 14);
    assert.match(summary(r), /^RESULT: the deployed stack works\. All 14 checks passed\.$/);
  });

  it('the one command exits 0 and says so in plain lines', () => {
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'post-deploy-check.mjs'), '--local'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ 1 {2}PASS {9}The api is up: version /m);
    assert.match(r.stdout, /^10 {2}PASS {9}The embed page loads with its security headers: /m);
    assert.match(r.stdout, /RESULT: the deployed stack works\. All 14 checks passed\./);
    assert.doesNotMatch(r.stdout, /FAIL|NOT CHECKED/);
  });

  it('the release you expect: the right commit passes, another one fails line 7 only', async () => {
    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.deepEqual(failedLines(await runChecks({ ...opts, commit: commit.slice(0, 12) })), []);
    const r = await runChecks({ ...opts, commit: 'ffffffffffff' });
    assert.deepEqual(failedLines(r), [7]);
    assert.match(r.lines[6].detail, /an older release is being served/);
  });

  it('without a shop the try session is NOT CHECKED, said plainly, and nothing fails; the embed headers are still checked', async () => {
    const r = await runChecks({ ...opts, shop: null, product: null });
    assert.deepEqual(r.lines.filter((l) => l.status === 'skip').map((l) => l.n), [9, 11, 12]);
    assert.equal(r.failed, 0);
    assert.equal(r.lines[9].status, 'pass');
    assert.match(r.lines[9].detail, /framable by https shop pages only.*on a made-up link: no shop given/);
    assert.match(summary(r), /3 checks were NOT run.*Whether a shopper can try a product on is not known/);
    // The embed's framing is checked without a shop, so a broken one fails without a shop too.
    const framed = await runChecks({ ...opts, shop: null, product: null }, { fetchImpl: tamper((u) => u.pathname.startsWith('/embed/'), (res) => void res.headers.set('x-frame-options', 'DENY')) });
    assert.deepEqual(failedLines(framed), [10]);
  });

  it('--require-shop: a run without a shop fails instead of passing with lines unchecked', async () => {
    const r = await runChecks({ ...opts, shop: null, product: null, requireShop: true });
    assert.deepEqual(failedLines(r), [9, 11, 12]);
    assert.match(r.lines[8].detail, /no shop given.*--require-shop/);
    const cli = spawnSync(process.execPath, [join(root, 'scripts', 'post-deploy-check.mjs'), '--api', api, '--app', app, '--require-shop'], { cwd: root, encoding: 'utf8' });
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    const without = spawnSync(process.execPath, [join(root, 'scripts', 'post-deploy-check.mjs'), '--api', api, '--app', app], { cwd: root, encoding: 'utf8' });
    assert.equal(without.status, 0, without.stdout + without.stderr);
    assert.match(without.stdout, /^ 9 {2}NOT CHECKED/m);
    // With the shop, the option changes nothing.
    assert.deepEqual(failedLines(await runChecks({ ...opts, requireShop: true })), []);
  });

  it('a product the shop does not have fails the session line and the lines that depend on it', async () => {
    const r = await runChecks({ ...opts, product: 'no-such-product' });
    assert.deepEqual(failedLines(r), [9, 10, 11, 12]);
    assert.match(r.lines[8].detail, /does not know this product/);
  });

  describe('negative controls: one thing broken at a time', () => {
    const cases = [
      ['the api is down', (u) => u.origin === api && u.pathname === '/healthz', () => ({ status: 502, body: 'Bad Gateway' }), [1, 7], /answered 502/],
      ['the proxy and the api both set a header', (u) => u.origin === api && u.pathname === '/healthz', (r) => void r.headers.set('cross-origin-resource-policy', 'cross-origin, cross-origin'), [1], /sends cross-origin-resource-policy twice/],
      ['the SDK carries its resource policy twice', (u) => u.pathname === '/sdk/v1.js', (r) => void r.headers.set('cross-origin-resource-policy', 'cross-origin, cross-origin'), [3], /sent twice/],
      ['the database is not reachable', (u) => u.pathname === '/readyz', () => ({ status: 503, body: JSON.stringify({ ok: false, db: false, jobs: true }) }), [2], /database NO, jobs yes/],
      ['the merchant route answers a caller without a key', (u, init) => u.pathname === '/v1/merchant/products' && !init.headers?.authorization, () => ({ status: 200, body: '{"products":[]}' }), [4], /without a key answered 200/],
      ['the merchant route accepts a made-up key', (u, init) => u.pathname === '/v1/merchant/products' && Boolean(init.headers?.authorization), () => ({ status: 200, body: '{"products":[]}' }), [4], /made-up key answered 200/],
      ['the app is not cross-origin isolated', (u) => u.origin === app && u.pathname === '/', (r) => void r.headers.delete('cross-origin-embedder-policy'), [5], /cross-origin-embedder-policy is missing/],
      ['the app has no policy', (u) => u.origin === app && u.pathname === '/', (r) => void r.headers.delete('content-security-policy'), [5], /no Content-Security-Policy header/],
      ['the app may connect to a third party', (u) => u.origin === app && u.pathname === '/', (r) => void r.headers.set('content-security-policy', r.headers.get('content-security-policy').replace("connect-src 'self'", "connect-src 'self' https://stats.example")), [5], /connect-src also allows https:\/\/stats\.example/],
      ['the app can be framed', (u) => u.origin === app && u.pathname === '/', (r) => void r.headers.set('content-security-policy', r.headers.get('content-security-policy').replace("frame-ancestors 'none'", 'frame-ancestors https:')), [5], /the app can be framed/],
      ['the app script is missing', (u) => u.origin === app && u.pathname.startsWith('/assets/'), () => ({ status: 404, body: '' }), [6], /answered 404/],
      // What Caddy's `try_files {path} /index.html` answers for a file that is not there: 200, the app page.
      ['a chunk of the embed is not in the published build', (u) => /^\/assets\/EmbedRoute-/.test(u.pathname), (r) => (r.headers.set('content-type', 'text/html'), { body: '<!doctype html><div id="root"></div>' }), [6], /\/assets\/EmbedRoute-[^ ]+ is served as text\/html, not as JavaScript: the file is not in the published build/],
      ['the stylesheet is not in the published build', (u) => /^\/assets\/.*\.css$/.test(u.pathname), (r) => (r.headers.set('content-type', 'text/html'), { body: '<!doctype html>' }), [6], /\.css is served as text\/html, not as CSS/],
      ['the web build calls another api address', (u) => u.origin === app && /^\/assets\/.*\.js$/.test(u.pathname), (r) => ({ body: r.body.replaceAll(api, 'http://localhost:8788') }), [6], /none of the \d+ files names http:\/\/localhost:8787: the web build was made with another VITE_API_URL/],
      ['a worker script comes without the policy', (u) => /^\/assets\/scan\.worker-/.test(u.pathname), (r) => void r.headers.delete('content-security-policy'), [6], /\/assets\/scan\.worker-[^ ]+: no Content-Security-Policy header/],
      ['the app’s policy does not let it reach the api', (u) => u.origin === app && u.pathname === '/', (r) => void r.headers.set('content-security-policy', r.headers.get('content-security-policy').replace(`connect-src 'self' ${api}`, "connect-src 'self'")), [5], /connect-src lacks http:\/\/localhost:8787 \(the app could not reach the api\)/],
      ['the api refuses the app’s origin', (u, init) => u.origin === api && init.method === 'OPTIONS', (r) => void r.headers.delete('access-control-allow-origin'), [8, 11, 12, 13], /the api does not let the app call it from a browser: asked whether http:\/\/localhost:3000 may POST \/v1\/devices, it answered 204 without access-control-allow-origin/],
      ['the api allows another origin than the app', (u, init) => u.origin === api && init.method === 'OPTIONS', (r) => void r.headers.set('access-control-allow-origin', 'http://localhost:5180'), [8, 11, 12, 13], /allowing "http:\/\/localhost:5180"/],
      ['the api does not let the app send its token', (u, init) => u.origin === api && init.method === 'OPTIONS' && u.pathname.startsWith('/v1/try/'), (r) => void r.headers.set('access-control-allow-headers', 'content-type'), [11, 12, 13], /without authorization in access-control-allow-headers/],
      ['the web app is an older release than the api', (u) => u.pathname === '/version.json', () => ({ body: JSON.stringify({ commit: '0000000000000000000000000000000000000000' }) }), [7], /they differ: api [0-9a-f]{12}, app 000000000000/],
      ['the web app is not stamped', (u) => u.pathname === '/version.json', () => ({ body: JSON.stringify({ commit: 'unknown' }) }), [7], /not stamped/],
      ['the shop is paused', (u) => u.pathname === '/v1/sdk/sessions', () => ({ status: 402 }), [9, 10, 11, 12], /the shop is paused/],
      ['the embed sends X-Frame-Options', (u) => u.pathname.startsWith('/embed/'), (r) => void r.headers.set('x-frame-options', 'DENY'), [10], /X-Frame-Options "DENY" would stop shop pages/],
      ['the embed cannot be framed by a shop', (u) => u.pathname.startsWith('/embed/'), (r) => void r.headers.set('content-security-policy', r.headers.get('content-security-policy').replace(/frame-ancestors [^;]+/, "frame-ancestors 'none'")), [10], /shop pages cannot frame the embed/],
      ['the embed’s policy does not let it reach the api', (u) => u.pathname.startsWith('/embed/'), (r) => void r.headers.set('content-security-policy', r.headers.get('content-security-policy').replace(`connect-src 'self' ${api}`, "connect-src 'self'").replace("'wasm-unsafe-eval'", '').replace(/img-src [^;]+/, "img-src 'none'")), [10], /connect-src lacks http:\/\/localhost:8787 \(the app could not reach the api\); script-src lacks 'wasm-unsafe-eval'; img-src also allows 'none'; img-src lacks 'self' http:\/\/localhost:8787/],
      ['the embed may be cached', (u) => u.pathname.startsWith('/embed/'), (r) => void r.headers.set('cache-control', 'public, max-age=600'), [10], /cache-control is "public, max-age=600"/],
      ['the product has no size chart', (u) => /^\/v1\/try\/[^/]+$/.test(u.pathname) && u.pathname.length > 40, (r) => ({ body: JSON.stringify({ ...JSON.parse(r.body), garment: { ...JSON.parse(r.body).garment, sizeChart: [] } }) }), [11, 12], /came without a size chart/],
      ['the check itself is billed', (u) => u.pathname.endsWith('/fit-shown'), () => ({ body: '{"billed":true}' }), [12], /THIS CHECK WAS BILLED/],
      ['a made-up try link is accepted', (u) => u.pathname === '/v1/try/not-a-real-try-link', () => ({ status: 200, body: '{}' }), [13], /answered 200, not 401/],
    ];
    for (const [name, match, change, lines, detail] of cases) {
      it(`${name} → line ${lines.join(', ')} fails`, async () => {
        const r = await runChecks(opts, { fetchImpl: tamper(match, change) });
        assert.deepEqual(failedLines(r), lines, r.lines.map(formatLine).join('\n'));
        assert.match(r.lines[lines[0] - 1].detail, detail);
        assert.match(summary(r), /^RESULT: NOT WORKING\./);
      });
    }

    it('nothing answers at all → every line fails with "no answer", and the command exits 1', () => {
      const r = spawnSync(process.execPath, [join(root, 'scripts', 'post-deploy-check.mjs'), '--api', 'http://127.0.0.1:9', '--app', 'http://127.0.0.1:9'], { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stdout, /^ 1 {2}FAIL {9}The api is up: no answer from http:\/\/127\.0\.0\.1:9: /m);
      assert.match(r.stdout, /RESULT: NOT WORKING\./);
    });
  });
});

describe('post-deploy check: arguments and rules (no stack needed)', () => {
  it('takes the site address and finds the api and the app next to it', () => {
    for (const address of ['https://curtain.fit', 'curtain.fit', 'https://www.curtain.fit/', 'https://app.curtain.fit']) {
      assert.deepEqual(parseArgs([address]), { api: 'https://api.curtain.fit', app: 'https://app.curtain.fit', shop: null, product: null, commit: null, local: false, requireShop: false });
    }
    assert.equal(parseArgs(['https://curtain.fit', '--api', 'https://api.staging.example']).api, 'https://api.staging.example');
    assert.throws(() => parseArgs([]), /give the site address/);
    assert.throws(() => parseArgs(['https://curtain.fit', '--shop']), /--shop needs a value/);
    assert.throws(() => parseArgs(['https://curtain.fit', '--verbose']), /unknown option/);
    assert.throws(() => parseArgs(['https://curtain.fit', '--shop', 'pk_x']), /--shop and --product go together/);
    assert.equal(parseArgs(['https://curtain.fit', '--require-shop']).requireShop, true);
    const wrong = spawnSync(process.execPath, [join(root, 'scripts', 'post-deploy-check.mjs')], { encoding: 'utf8' });
    assert.equal(wrong.status, 2);
  });

  const prod = { api: 'https://api.curtain.fit', app: 'https://app.curtain.fit' };
  const policy = (surface) =>
    `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https://api.curtain.fit; img-src 'self' data: blob: https://api.curtain.fit; worker-src 'self'; object-src 'none'; frame-ancestors ${surface === 'app' ? "'none'" : 'https:'}`;

  it('accepts the production policy and names what is wrong with a looser one', () => {
    assert.deepEqual(policyProblems(policy('app'), { surface: 'app', ...prod }), []);
    assert.deepEqual(policyProblems(policy('embed'), { surface: 'embed', ...prod }), []);
    assert.deepEqual(policyProblems(`${policy('app')}; report-uri /r`, { surface: 'app', ...prod }), ['the policy reports violations to a URL (never in production)']);
    assert.deepEqual(policyProblems(policy('embed').replace('frame-ancestors https:', 'frame-ancestors https: http://localhost:*'), { surface: 'embed', ...prod }), ['frame-ancestors also allows http://localhost:*']);
    assert.deepEqual(policyProblems(policy('app').replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), { surface: 'app', ...prod }), ["script-src also allows 'unsafe-inline'"]);
    assert.deepEqual(policyProblems('', { surface: 'app', ...prod }), ['no Content-Security-Policy header']);
  });

  it('names what is wrong with a policy too tight for the app to run', () => {
    const tight = "default-src; script-src 'self'; connect-src 'self'; img-src 'none'; worker-src; object-src 'none'; frame-ancestors https:";
    assert.deepEqual(policyProblems(tight, { surface: 'embed', ...prod }), [
      "default-src lacks 'self'",
      'connect-src lacks https://api.curtain.fit (the app could not reach the api)',
      "script-src lacks 'wasm-unsafe-eval'",
      "worker-src lacks 'self'",
      "img-src also allows 'none'",
      "img-src lacks 'self' https://api.curtain.fit (the app could not reach the api)",
    ]);
    assert.deepEqual(policyProblems(policy('app').replace(/img-src [^;]+; /, ''), { surface: 'app', ...prod }), ['no img-src']);
    // One origin for both (Caddy proxying /v1): 'self' is the api.
    const same = { api: 'https://curtain.example', app: 'https://curtain.example' };
    assert.deepEqual(policyProblems("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data:; worker-src 'self'; object-src 'none'; frame-ancestors 'none'", { surface: 'app', ...same }), []);
  });

  it('reads from a page and a built script the files a browser would fetch', () => {
    const html = '<script type="module" crossorigin src="/assets/index-a.js"></script><link rel="modulepreload" crossorigin href="/assets/engines-b.js"><link rel="stylesheet" crossorigin href="/assets/index-c.css"><link rel="manifest" href="/manifest.webmanifest">';
    assert.equal(entryScript(html), '/assets/index-a.js');
    assert.equal(entryScript('<div id="root"></div>'), null);
    assert.deepEqual(linkedFiles(html), ['/assets/engines-b.js', '/assets/index-c.css']);
    const script = 'const d=["assets/mount-d.js","assets/index-c.css"];import{_ as s}from"./viewer-e.js";import"./engines-b.js";s(()=>import("./appMain-f.js"));new Worker("/assets/scan.worker-g.js");fetch("/v1/devices");const w="./models/pose.task",n="../sw.js"';
    assert.deepEqual(namedFiles(script, '/assets/index-a.js').sort(), ['/assets/appMain-f.js', '/assets/engines-b.js', '/assets/index-c.css', '/assets/mount-d.js', '/assets/scan.worker-g.js', '/assets/viewer-e.js']);
  });

  it('a deployed app must enforce HTTPS; a local one is not asked to', () => {
    const base = { 'x-content-type-options': 'nosniff', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' };
    assert.deepEqual(headerProblems(new Headers(base), { surface: 'app', app: 'http://localhost:3000' }), []);
    assert.deepEqual(headerProblems(new Headers(base), { surface: 'app', app: prod.app }), ['no Strict-Transport-Security of a year or more']);
    assert.deepEqual(headerProblems(new Headers({ ...base, 'strict-transport-security': 'max-age=31536000; includeSubDomains' }), { surface: 'app', app: prod.app }), []);
  });
});
