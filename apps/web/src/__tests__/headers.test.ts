/**
 * Production and the test stack send the same security headers (OI-66).
 *
 * `config/headers.ts` is the one list. The preview server (the e2e suite, the production-shaped demo) sends
 * it as it is; Caddy cannot import it, so this file reads `infra/Caddyfile` and compares header by header.
 * A header added, changed or dropped on one side only fails here. What may differ is named in `ONLY_IN_*`.
 *
 * That holds for the whole `app.{$DOMAIN}` block, not only for its two `header @… { }` bodies: every statement
 * of the block and of the two snippets it imports is pinned below (`APP_BLOCK`), comments left out. So a
 * matcher that stops covering /assets, a further `header` line somewhere in the block, or an import that is
 * commented out fails too. What Caddy then does with the file is not tested here (no Caddy in the test run).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCAL_FRAME_ANCESTORS } from '../../config/csp';
import { BASE_HEADERS, responseHeaders, type ResponseHeaders } from '../../config/headers';
import { CSP_REPORT_PATH, previewHeaders } from '../../vite.config';

const caddyfile = readFileSync(fileURLToPath(new URL('../../../../infra/Caddyfile', import.meta.url)), 'utf8');
const API = 'https://api.{$DOMAIN}';

/** Production only: the preview is plain http on localhost, where HSTS means nothing; `Server` is Caddy's own. */
const ONLY_IN_PRODUCTION = { set: { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }, remove: ['Server'] };
/** Preview only, inside the policy: the demo storefront may frame the embed, and violations are reported to the test. */
const ONLY_IN_PREVIEW = { extraFrameAncestors: LOCAL_FRAME_ANCESTORS, reportUri: CSP_REPORT_PATH };

/** `Name "value"` and `-Name` lines of a Caddy `header` body. */
function directives(body: string): ResponseHeaders {
  const out: ResponseHeaders = { set: {}, remove: [] };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const removal = /^-([A-Za-z-]+)$/.exec(line);
    const set = /^([A-Za-z-]+) "(.*)"$/.exec(line);
    if (removal) out.remove.push(removal[1]!);
    else if (set) out.set[set[1]!] = set[2]!;
    else throw new Error(`a header line this test cannot read: ${line}`);
  }
  return out;
}

const body = (re: RegExp, text: string, what: string): string => {
  const m = re.exec(text);
  if (!m) throw new Error(`${what} not found in infra/Caddyfile`);
  return m[1]!;
};
const snippet = (name: string): string => body(new RegExp(`\\n\\(${name}\\) \\{\\n([\\s\\S]*?)\\n\\}\\n`), caddyfile, `(${name})`);
const appBlock = body(/\napp\.\{\$DOMAIN\} \{\n([\s\S]*?)\n\}\n/, caddyfile, 'app.{$DOMAIN}');

/** The statements of a Caddy block, comments and blank lines left out; a nested `{ }` body becomes ` { … }`. */
function statements(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '}') {
      depth -= 1;
      continue;
    }
    const opens = line.endsWith('{');
    if (depth === 0) out.push(opens ? `${line} … }` : line);
    if (opens) depth += 1;
  }
  return out;
}

/** Every statement of `app.{$DOMAIN}`. The two `header @… { }` bodies are compared header by header below. */
const APP_BLOCK = [
  'import security_headers',
  'root * /srv/web',
  'encode zstd gzip',
  '@embed path /embed /embed/*',
  '@app not path /embed /embed/*',
  'header @app { … }',
  'header @embed { … }',
  '@immutable path /assets/* /models/* /fonts/*',
  'header @immutable Cache-Control "public, max-age=31536000, immutable"',
  '@nocache path /index.html /sw.js /manifest.webmanifest /version.json',
  'header @nocache Cache-Control "no-cache"',
  'try_files {path} /index.html',
  'file_server',
];

/** Everything `app.{$DOMAIN}` sends on a path matched by `matcher`: the imported snippets plus the matcher's own block. */
function production(matcher: '@app' | '@embed'): ResponseHeaders {
  expect(statements(appBlock)).toContain('import security_headers');
  const security = snippet('security_headers');
  expect(statements(security)).toContain('import base_headers');
  const base = directives(body(/header \{\n([\s\S]*?)\n\t\}/, snippet('base_headers'), 'base_headers header'));
  const hsts = directives(security.split('\n').filter((l) => l.trim().startsWith('header ')).map((l) => l.trim().slice('header '.length)).join('\n'));
  const own = directives(body(new RegExp(`header ${matcher} \\{\\n([\\s\\S]*?)\\n\\t\\}`), appBlock, `header ${matcher}`));
  return { set: { ...base.set, ...hsts.set, ...own.set }, remove: [...base.remove, ...hsts.remove, ...own.remove] };
}

function preview(url: string, api?: string): ResponseHeaders {
  const out: ResponseHeaders = { set: {}, remove: [] };
  previewHeaders({ url }, { setHeader: (k: string, v: string | number | readonly string[]) => ((out.set[k] = String(v)), undefined as never), removeHeader: (k: string) => void out.remove.push(k) }, api);
  return out;
}

const sorted = (h: ResponseHeaders) => ({ set: Object.fromEntries(Object.entries(h.set).sort(([a], [b]) => a.localeCompare(b))), remove: [...h.remove].sort() });

describe('production (infra/Caddyfile) sends config/headers.ts', () => {
  for (const [surface, matcher] of [['app', '@app'], ['embed', '@embed']] as const) {
    it(`${matcher}: the same headers, values and removals, plus only what is named as production-only`, () => {
      const want = responseHeaders(surface, { api: API });
      expect(sorted(production(matcher))).toEqual(sorted({ set: { ...want.set, ...ONLY_IN_PRODUCTION.set }, remove: [...want.remove, ...ONLY_IN_PRODUCTION.remove] }));
    });
  }

  it('the two matchers cover every path between them', () => {
    const matchers = statements(appBlock).filter((l) => /^@(app|embed) /.test(l));
    expect(matchers).toEqual(['@embed path /embed /embed/*', '@app not path /embed /embed/*']);
  });

  it('the app block holds these statements and no other: no further header line, no narrower matcher, no import left out', () => {
    expect(statements(appBlock)).toEqual(APP_BLOCK);
    expect(statements(snippet('security_headers'))).toEqual(['import base_headers', 'header Strict-Transport-Security "max-age=31536000; includeSubDomains"']);
    expect(statements(snippet('base_headers'))).toEqual(['header { … }']);
    // The only header lines outside the two compared bodies set Cache-Control, which neither body of @app sets
    // and which @embed sets itself (no-store; /embed paths match neither @immutable nor @nocache).
    const others = statements(appBlock).filter((l) => l.startsWith('header ') && !l.endsWith('{ … }'));
    expect(others.map((l) => l.split(' ')[2])).toEqual(['Cache-Control', 'Cache-Control']);
  });

  it('statements() leaves comments out and sees what a loose text search would not', () => {
    const edited = (from: string, to: string) => {
      expect(appBlock).toContain(from);
      return statements(appBlock.replace(from, to));
    };
    // The four edits a text search for the matcher lines and the import did not notice.
    expect(edited('@app not path /embed /embed/*', '@app not path /embed /embed/* /assets/*')).not.toEqual(APP_BLOCK);
    expect(edited('@embed path /embed /embed/*', '@embed path /embed /embed/* /assets/*')).not.toEqual(APP_BLOCK);
    expect(edited('\timport security_headers', '\t# import security_headers')).not.toEqual(APP_BLOCK);
    expect(edited('\ttry_files', '\theader @immutable Cross-Origin-Embedder-Policy "unsafe-none"\n\theader @immutable -Content-Security-Policy\n\ttry_files')).not.toEqual(APP_BLOCK);
    // A comment added or reworded is not a change.
    expect(edited('\troot * /srv/web', '\t# served from the web volume\n\troot * /srv/web')).toEqual(APP_BLOCK);
  });

  it('the app is cross-origin isolated and the embed is not held to require-corp', () => {
    expect(production('@app').set).toMatchObject({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' });
    expect(production('@embed').set).toMatchObject({ 'Cross-Origin-Embedder-Policy': 'credentialless', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-store' });
    expect(production('@embed').remove).toEqual(expect.arrayContaining(['X-Frame-Options', 'Cross-Origin-Opener-Policy']));
  });
});

describe('the preview (e2e, production-shaped demo) sends config/headers.ts', () => {
  const api = 'http://127.0.0.1:8787';
  it('the app: every path, worker scripts and models too', () => {
    for (const url of ['/', '/onboarding', '/assets/scan.worker-abc.js', '/models/wasm/vision_wasm_internal.wasm', '/sw.js']) {
      expect(sorted(preview(url, api)), url).toEqual(sorted(responseHeaders('app', { api, reportUri: ONLY_IN_PREVIEW.reportUri })));
    }
  });

  it('the embed and the peek', () => {
    for (const url of ['/embed/tok', '/embed/peek?shop=x&product=y']) {
      expect(sorted(preview(url, api)), url).toEqual(sorted(responseHeaders('embed', { api, ...ONLY_IN_PREVIEW })));
    }
  });

  it('differs from production in nothing but the named exceptions', () => {
    for (const [surface, matcher, url] of [['app', '@app', '/'], ['embed', '@embed', '/embed/tok']] as const) {
      const prod = production(matcher);
      const prev = preview(url, API);
      const names = (h: ResponseHeaders) => Object.keys(h.set).sort();
      expect(names(prev)).toEqual(names(prod).filter((n) => !(n in ONLY_IN_PRODUCTION.set)));
      for (const [name, value] of Object.entries(prev.set)) {
        if (name === 'Content-Security-Policy') continue;
        expect(value, `${surface} ${name}`).toBe(prod.set[name]);
      }
      // The policy: production's, with the preview's extra frame parents and report path and nothing else.
      const strip = (p: string) => p.replace(` ${LOCAL_FRAME_ANCESTORS.join(' ')}`, '').replace(`; report-uri ${CSP_REPORT_PATH}`, '');
      expect(strip(prev.set['Content-Security-Policy']!)).toBe(prod.set['Content-Security-Policy']);
      expect([...prev.remove].sort()).toEqual(prod.remove.filter((n) => !ONLY_IN_PRODUCTION.remove.includes(n)).sort());
    }
  });

  it('the base headers are on both surfaces', () => {
    for (const surface of ['app', 'embed'] as const) expect(responseHeaders(surface).set).toMatchObject(BASE_HEADERS);
  });
});
