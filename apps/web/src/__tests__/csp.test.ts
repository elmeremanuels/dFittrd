/**
 * One Content-Security-Policy for the fitting room (config/csp.ts): Caddy sends it in production, the
 * Vite preview sends it to the e2e suite. Caddy cannot import the module, so this pins its two policies
 * to it, and pins the properties the privacy wall depends on (D3: zero third-party requests).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appCsp, cspDirectives } from '../../config/csp';
import { apiOriginOf, CSP_REPORT_PATH, previewHeaders } from '../../vite.config';

const caddyfile = readFileSync(fileURLToPath(new URL('../../../../infra/Caddyfile', import.meta.url)), 'utf8');
const API = 'https://api.{$DOMAIN}';

/** The body of the `app.{$DOMAIN}` site block. */
const appBlock = (() => {
  const start = caddyfile.indexOf('\napp.{$DOMAIN} {\n');
  return caddyfile.slice(start, caddyfile.indexOf('\n}\n', start));
})();
const headerBlock = (matcher: string): string => new RegExp(`header ${matcher} \\{([\\s\\S]*?)\\n\\t\\}`).exec(appBlock)?.[1] ?? '';
const policyIn = (body: string): string | undefined => /Content-Security-Policy "([^"]+)"/.exec(body)?.[1];

function parse(policy: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) m.set(name, values);
  }
  return m;
}

function run(url: string, api?: string): { headers: Map<string, string>; removed: string[] } {
  const headers = new Map<string, string>();
  const removed: string[] = [];
  previewHeaders({ url }, { setHeader: (k: string, v: string | number | readonly string[]) => (headers.set(k, String(v)), undefined as never), removeHeader: (k: string) => void removed.push(k) }, api);
  return { headers, removed };
}

describe('infra/Caddyfile sends config/csp.ts', () => {
  it('@app (every path that is not the embed, worker scripts included) has appCsp("app")', () => {
    expect(appBlock).toContain('@app not path /embed /embed/*');
    expect(policyIn(headerBlock('@app'))).toBe(appCsp('app', { api: API }));
  });

  it('@embed (the overlay and the size peek) has appCsp("embed")', () => {
    expect(appBlock).toContain('@embed path /embed /embed/*');
    expect(policyIn(headerBlock('@embed'))).toBe(appCsp('embed', { api: API }));
  });

  it('no report-uri in production: a report would carry page URLs (try tokens) to wherever it points', () => {
    for (const m of ['@app', '@embed']) expect(policyIn(headerBlock(m))).not.toMatch(/report-(uri|to)/);
  });
});

describe('the policy', () => {
  for (const surface of ['app', 'embed'] as const) {
    const p = new Map(cspDirectives(surface, { api: API }));
    it(`${surface}: connects to our origin and the api only`, () => {
      expect(p.get('default-src')).toEqual(["'self'"]);
      expect(p.get('connect-src')).toEqual(["'self'", API]);
      for (const d of ['img-src', 'media-src', 'font-src', 'worker-src', 'script-src', 'style-src', 'manifest-src']) {
        for (const v of p.get(d)!) expect(v, `${d} ${v}`).toMatch(/^('self'|'wasm-unsafe-eval'|data:|blob:|https:\/\/api\.\{\$DOMAIN\})$/);
      }
    });
    it(`${surface}: no inline script, no eval; WebAssembly may compile (MediaPipe, meshopt)`, () => {
      expect(p.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
      expect(p.get('style-src')).toEqual(["'self'"]);
      expect(p.get('object-src')).toEqual(["'none'"]);
      expect(p.get('base-uri')).toEqual(["'self'"]);
    });
  }

  it('the app is never framed; the embed is framed by https shop pages only', () => {
    expect(parse(appCsp('app')).get('frame-ancestors')).toEqual(["'none'"]);
    expect(parse(appCsp('embed')).get('frame-ancestors')).toEqual(['https:']);
  });

  it('without an api origin (same-origin api) the api source is simply absent', () => {
    expect(parse(appCsp('app')).get('connect-src')).toEqual(["'self'"]);
  });
});

describe('vite preview headers', () => {
  it('every response of the app gets the full app policy, worker scripts too, with the preview-only report path', () => {
    for (const url of ['/onboarding', '/assets/scan.worker-abc.js', '/models/wasm/vision_wasm_module_internal.js', '/']) {
      const { headers } = run(url);
      expect(headers.get('Content-Security-Policy'), url).toBe(appCsp('app', { reportUri: CSP_REPORT_PATH }));
    }
  });

  it('the embed and the peek: the embed policy, framable by the localhost demo shop too, cross-origin resource', () => {
    for (const url of ['/embed/tok', '/embed/peek?shop=x&product=y']) {
      const { headers, removed } = run(url, 'http://127.0.0.1:3001');
      const p = parse(headers.get('Content-Security-Policy')!);
      expect(p.get('frame-ancestors')).toEqual(['https:', 'http://localhost:*', 'http://127.0.0.1:*']);
      expect(p.get('connect-src')).toEqual(["'self'", 'http://127.0.0.1:3001']);
      expect(headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
      // As production (headers.test.ts): no opener policy, and credentialless rather than no embedder policy.
      expect(removed).toEqual(expect.arrayContaining(['X-Frame-Options', 'Cross-Origin-Opener-Policy']));
      expect(headers.get('Cross-Origin-Embedder-Policy')).toBe('credentialless');
    }
  });

  it('apiOriginOf takes the origin of VITE_API_URL', () => {
    expect(apiOriginOf('https://api.example.com/')).toBe('https://api.example.com');
    expect(apiOriginOf(' ')).toBeUndefined();
    expect(apiOriginOf(undefined)).toBeUndefined();
    expect(apiOriginOf('not a url')).toBeUndefined();
  });
});
