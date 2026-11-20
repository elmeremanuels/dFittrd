/**
 * `scripts/post-deploy-check.mjs` (OI-48) against this api and the headers production sends.
 *
 * The script's own test (`scripts/post-deploy-check.test.mjs`, part of `pnpm check:launch`) runs it against the
 * local demo stack over http. This one runs in the ordinary test suite and covers what that cannot: the
 * https rules, with the app's answers carrying exactly the headers `infra/Caddyfile` sets for
 * `app.{$DOMAIN}`, and the api's answers coming from the real routes. So a route the check calls cannot be
 * renamed, and a header it asks for cannot be dropped from the Caddyfile, without this failing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shops } from './db/schema.js';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';

const DOMAIN = 'curtain.test';
const API = `https://api.${DOMAIN}`;
const APP = `https://app.${DOMAIN}`;
const COMMIT = 'c0ffee0123456789abcdef0123456789abcdef01';

interface Line {
  n: number;
  title: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}
interface Check {
  runChecks(opts: Record<string, string | null | boolean>, io: { fetchImpl: typeof fetch }): Promise<{ lines: Line[]; failed: number; skipped: number }>;
  formatLine(l: Line): string;
  summary(r: { lines: Line[]; failed: number; skipped: number }): string;
}
// A plain script outside this package: loaded by path, typed here.
const scriptUrl = new URL('../../../scripts/post-deploy-check.mjs', import.meta.url).href;

const caddyfile = readFileSync(fileURLToPath(new URL('../../../infra/Caddyfile', import.meta.url)), 'utf8').replaceAll('{$DOMAIN}', DOMAIN);

/** What Caddy sets on `app.<domain>` for a path matched by `matcher`: base headers, HSTS and the matcher's block. */
function caddyHeaders(matcher: '@app' | '@embed'): Headers {
  const h = new Headers();
  const take = (body: string | undefined) => {
    for (const raw of (body ?? '').split('\n')) {
      const m = /^([A-Za-z-]+) "(.*)"$/.exec(raw.trim());
      if (m) h.set(m[1]!, m[2]!);
    }
  };
  take(/\n\(base_headers\) \{\n\theader \{\n([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1]);
  take(/\n\(security_headers\) \{\n([\s\S]*?)\n\}/.exec(caddyfile)?.[1]?.replace(/^\s*header /gm, ''));
  const app = caddyfile.slice(caddyfile.indexOf(`\napp.${DOMAIN} {\n`));
  take(new RegExp(`header ${matcher} \\{\\n([\\s\\S]*?)\\n\\t\\}`).exec(app)?.[1]);
  return h;
}

describe('the post-deploy check against this api behind production headers', () => {
  let t: TestApp;
  let check: Check;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  let webCommit = COMMIT;
  let dropFromApp: string | null = null;
  let missingChunk: string | null = null;

  /** `fetch` for the script: the api origin is this app, the app origin is the published web build as Caddy serves it. */
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin === API) {
      const res = await t.app.inject({ method: (init.method ?? 'GET') as 'GET', url: url.pathname + url.search, headers: init.headers as Record<string, string>, ...(init.body ? { payload: String(init.body) } : {}) });
      return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode, headers: res.headers as Record<string, string> });
    }
    if (url.origin !== APP) throw new Error(`the check asked an origin it has no business with: ${url.origin}`);
    const embed = url.pathname.startsWith('/embed/');
    const headers = caddyHeaders(embed ? '@embed' : '@app');
    if (dropFromApp) headers.delete(dropFromApp);
    if (url.pathname === '/version.json') {
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify({ commit: webCommit }), { headers });
    }
    if (url.pathname.startsWith('/assets/')) {
      headers.set('content-type', 'text/javascript');
      // The api address a build made with VITE_API_URL carries, and one further chunk for the check to follow.
      const chunk = url.pathname.includes('index-') ? `import"./embed-def456.js";const api="${API}";\n` : 'console.log("embed");\n';
      if (missingChunk && url.pathname.includes(missingChunk)) {
        // What `try_files {path} /index.html` answers for a file that is not there.
        headers.set('content-type', 'text/html; charset=utf-8');
        return new Response('<!doctype html><div id="root"></div>', { headers });
      }
      return new Response(chunk.repeat(60), { headers });
    }
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response('<!doctype html><div id="root"></div><script type="module" crossorigin src="/assets/index-abc123.js"></script>', { headers });
  }) as typeof fetch;

  const run = (over: Record<string, string | null> = {}) => check.runChecks({ api: API, app: APP, shop: shop.publicKeyPrefix, product: 'aalter-studio-1', commit: null, ...over }, { fetchImpl });
  const failed = (r: { lines: Line[] }) => r.lines.filter((l) => l.status === 'fail').map((l) => check.formatLine(l));

  beforeAll(async () => {
    check = (await import(/* @vite-ignore */ scriptUrl)) as Check;
    t = await makeApp({ PUBLIC_APP_URL: APP, PUBLIC_API_URL: API, GIT_SHA: COMMIT, TRY_RATE_LIMIT_PER_MIN: '1000' });
    shop = await seedShop(t, { platform: 'shopify', products: ['aalter-studio-1'] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('every line passes on https, with the headers of infra/Caddyfile', async () => {
    const r = await run();
    expect(failed(r)).toEqual([]);
    expect(r.lines).toHaveLength(14);
    expect(r.skipped).toBe(0);
    expect(r.lines[4]!.detail).toContain('HTTPS enforced');
    expect(check.summary(r)).toBe('RESULT: the deployed stack works. All 14 checks passed.');
  });

  it('opens its try session as surface "api" and leaves nothing behind: no bill, no shopper, no pairing', async () => {
    await run();
    const sessions = await t.handle.db.query.trySessions.findMany();
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) expect(s).toMatchObject({ surface: 'api', billedAt: null });
    expect(await t.handle.db.query.usageEvents.findMany()).toEqual([]);
    expect(await t.handle.db.query.devices.findMany()).toEqual([]);
    expect(await t.handle.db.query.pairings.findMany()).toEqual([]);
  });

  it('a web release that is not the api’s fails "the same release"', async () => {
    webCommit = '0000000000000000000000000000000000000000';
    try {
      expect(failed(await run())).toEqual([expect.stringMatching(/^ 7 {2}FAIL .*they differ: api c0ffee012345, app 000000000000/)]);
    } finally {
      webCommit = COMMIT;
    }
  });

  it('a deploy without HSTS, or without the app’s isolation, fails the header lines', async () => {
    for (const [header, lines] of [['strict-transport-security', [5, 10]], ['cross-origin-embedder-policy', [5, 10]], ['content-security-policy', [5, 6, 10]]] as const) {
      dropFromApp = header;
      try {
        expect((await run()).lines.filter((l) => l.status === 'fail').map((l) => l.n), header).toEqual(lines);
      } finally {
        dropFromApp = null;
      }
    }
  });

  it('a chunk the entry script names but the server does not have fails "the app’s code loads"', async () => {
    missingChunk = 'embed-def456';
    try {
      const r = await run();
      expect(r.lines.filter((l) => l.status === 'fail').map((l) => l.n)).toEqual([6]);
      expect(r.lines[5]!.detail).toMatch(/\/assets\/embed-def456\.js is served as text\/html; charset=utf-8, not as JavaScript/);
    } finally {
      missingChunk = null;
    }
  });

  it('an api that does not name the app’s origin fails the lines a browser would be refused on', async () => {
    // The real CORS rule of app.ts, with CORS_ORIGINS naming some other origin and PUBLIC_APP_URL not the app.
    const other = await makeApp({ PUBLIC_APP_URL: 'https://app.elsewhere.test', PUBLIC_API_URL: API, CORS_ORIGINS: 'https://shop.example', GIT_SHA: COMMIT, TRY_RATE_LIMIT_PER_MIN: '1000' });
    const previous = t;
    t = other;
    try {
      const r = await check.runChecks({ api: API, app: APP, shop: null, product: null, commit: null }, { fetchImpl });
      expect(r.lines.filter((l) => l.status === 'fail').map((l) => l.n)).toEqual([8, 13]);
      expect(r.lines[7]!.detail).toMatch(/the api does not let the app call it from a browser: asked whether https:\/\/app\.curtain\.test may POST \/v1\/devices, it answered 204 without access-control-allow-origin \(PUBLIC_APP_URL or CORS_ORIGINS/);
      expect(r.lines.filter((l) => l.status === 'skip').map((l) => l.n)).toEqual([9, 11, 12]);
    } finally {
      t = previous;
      await other.close();
    }
  });

  it('a paused shop is said to be paused, and the lines that need the session fail with it', async () => {
    const paused = await seedShop(t, { products: ['aalter-studio-1'] });
    await t.handle.db.update(shops).set({ paused: true }).where(eq(shops.id, paused.shop.id));
    const r = await run({ shop: paused.publicKeyPrefix });
    expect(r.lines.filter((l) => l.status === 'fail').map((l) => l.n)).toEqual([9, 10, 11, 12]);
    expect(r.lines[8]!.detail).toMatch(/the shop is paused/);
  });
});
