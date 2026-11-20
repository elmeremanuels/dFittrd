/**
 * `api.{$DOMAIN}` in infra/Caddyfile: a header the api sets itself must not arrive twice.
 *
 * Caddy applies a plain `header Name "value"` before the upstream answers, and the reverse proxy then adds
 * the upstream's own copy. Found on 20 Nov 2026 by scripts/post-deploy-check.mjs against the real image behind
 * the real Caddy: `/sdk/v1.js` and `/v1/renders/*` carried `Cross-Origin-Resource-Policy: cross-origin` twice,
 * and every api response carried HSTS twice. Two copies of Cross-Origin-Resource-Policy are not a valid value,
 * so a cross-origin isolated page (the app shows renders as <img>; a shop that runs COEP loads the SDK) falls
 * back to same-origin and blocks the response. `>Name` sets the header when the response is written, in
 * place of the upstream's.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './test/helpers.js';

const caddyfile = readFileSync(fileURLToPath(new URL('../../../infra/Caddyfile', import.meta.url)), 'utf8');
const start = caddyfile.indexOf('\napi.{$DOMAIN} {\n');
const apiBlock = caddyfile.slice(start, caddyfile.indexOf('\n}\n', start));
// The /assets/* files are served by Caddy itself (file_server): nothing upstream sets a header there.
const proxied = apiBlock.replace(/\n\thandle_path \/assets\/\* \{[\s\S]*?\n\t\}\n/, '\n');

interface HeaderLine {
  matcher: string | null;
  deferred: boolean;
  name: string;
}
const lines: HeaderLine[] = [...proxied.matchAll(/^\theader (?:(@\w+) )?(>?)([A-Za-z-]+) "/gm)].map((m) => ({ matcher: m[1] ?? null, deferred: m[2] === '>', name: m[3]!.toLowerCase() }));
/** A request that each matcher of the block matches. */
const SAMPLE: Record<string, string> = { '@sdk': '/sdk/v1.js', '@renders': '/v1/renders/not-a-render' };

describe('infra/Caddyfile api block: headers the api also sets are replaced, not doubled', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('reads the header lines of the block', () => {
    expect(apiBlock).toContain('reverse_proxy api:3000');
    expect(lines.map((l) => `${l.matcher ?? '*'} ${l.name}`)).toEqual(expect.arrayContaining(['* strict-transport-security', '@sdk cross-origin-resource-policy', '@sdk cache-control', '@renders cross-origin-resource-policy']));
    for (const l of lines) if (l.matcher) expect(SAMPLE[l.matcher], `add a sample request for ${l.matcher} to this test`).toBeDefined();
  });

  it('every header line whose header the api sends on that route is deferred (>)', async () => {
    for (const l of lines) {
      const res = await t.app.inject({ method: 'GET', url: l.matcher ? SAMPLE[l.matcher]! : '/healthz' });
      if (res.headers[l.name] === undefined) continue;
      expect(l.deferred, `header ${l.matcher ?? ''} ${l.name}: the api sends it too, so Caddy must set it with ">"`).toBe(true);
    }
  });

  it('the api sends HSTS and a cross-origin resource policy itself, which is why the block must replace them', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/sdk/v1.js' });
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    // The snippet the block imports sets HSTS before the upstream answers; the deferred line is what leaves one copy.
    expect(apiBlock).toContain('import security_headers');
    expect(lines).toContainEqual({ matcher: null, deferred: true, name: 'strict-transport-security' });
  });
});
