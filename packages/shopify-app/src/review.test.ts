// @vitest-environment jsdom
/**
 * Regression tests from the platform review (Nov 2026).
 *  - The embedded admin page must not build admin links from an unvalidated `?shop=` parameter.
 *  - `normaliseShopDomain` must understand the unified admin URL (admin.shopify.com/store/<x>).
 *  - `renderAdminPage` must insert config values literally (String.replace `$` patterns).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAdminPage } from './admin';
import { normaliseShopDomain } from './types';
import { API_KEY } from './test/fixtures';

// jsdom's URL cannot be fed to fileURLToPath, so the template is read here (vitest runs in the package dir).
const template = readFileSync(join(process.cwd(), 'admin', 'index.html'), 'utf8');
// This package compiles without the DOM lib (it is server code); the jsdom globals are typed
// minimally here instead of adding `lib: dom` to the whole program.
interface El {
  id: string;
  type: string;
  textContent: string | null;
  innerHTML: string;
  getAttribute(name: string): string | null;
  append(...nodes: El[]): void;
}
interface Dom {
  document: { head: El; body: El; createElement(tag: string): El; getElementById(id: string): El | null };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  window: { shopify?: unknown };
}
const { document, history, window } = globalThis as unknown as Dom;

const cfg = { apiKey: API_KEY, apiUrl: 'https://api.paskamer.app', appUrl: 'https://app.paskamer.app', template };

/** Mount the rendered admin page into the jsdom document and run its inline script. */
function runAdminPage(search: string, shopifyGlobal?: unknown): void {
  history.replaceState(null, '', `/shopify/admin${search}`);
  const html = renderAdminPage(cfg);
  const config = /<script id="paskamer-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const body = /<body>([\s\S]*?)<script>/.exec(html)![1]!;
  const script = /<script>\s*([\s\S]*?)<\/script>\s*<\/body>/.exec(html)![1]!;
  document.head.innerHTML = '';
  const cfgEl = document.createElement('script');
  cfgEl.id = 'paskamer-config';
  cfgEl.type = 'application/json';
  cfgEl.textContent = config;
  document.head.append(cfgEl);
  document.body.innerHTML = body;
  window.shopify = shopifyGlobal;
  // The page talks to our api only after App Bridge hands out a token; fail fast here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
  new Function(script)();
}

afterEach(() => {
  delete window.shopify;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('embedded admin page: shop parameter', () => {
  it('ignores a ?shop= that is not a *.myshopify.com domain (no links to foreign hosts)', () => {
    runAdminPage('?shop=evil.example%23');
    const theme = document.getElementById('lnk-theme')!;
    expect(theme.getAttribute('href') ?? '').not.toContain('evil.example');
    expect(document.getElementById('shop-domain')!.textContent).not.toContain('evil');
  });

  it('prefers the shop App Bridge reports over the query string', () => {
    runAdminPage('?shop=other-store.myshopify.com', { config: { shop: 'aalter-studio.myshopify.com' }, idToken: () => new Promise(() => {}) });
    const theme = document.getElementById('lnk-theme')!;
    expect(theme.getAttribute('href')).toMatch(/^https:\/\/aalter-studio\.myshopify\.com\/admin\/themes\/current\/editor\?/);
  });

  it('still works with a valid ?shop= when App Bridge has not reported one', () => {
    runAdminPage('?shop=Aalter-Studio.myshopify.com');
    const theme = document.getElementById('lnk-theme')!;
    expect(theme.getAttribute('href')).toMatch(/^https:\/\/aalter-studio\.myshopify\.com\/admin\/themes\/current\/editor\?/);
  });
});

describe('normaliseShopDomain', () => {
  it('maps the unified admin URL to the store domain instead of returning admin.shopify.com', () => {
    expect(normaliseShopDomain('https://admin.shopify.com/store/aalter-studio')).toBe('aalter-studio.myshopify.com');
    expect(normaliseShopDomain('https://admin.shopify.com/store/aalter-studio/products/42')).toBe('aalter-studio.myshopify.com');
    expect(normaliseShopDomain('admin.shopify.com/store/aalter-studio')).toBe('aalter-studio.myshopify.com');
    expect(normaliseShopDomain('https://admin.shopify.com/')).toBeNull();
    expect(normaliseShopDomain('admin.shopify.com')).toBeNull();
  });
});

describe('renderAdminPage', () => {
  it('inserts config values literally even when they contain $ replacement patterns', () => {
    const html = renderAdminPage({ ...cfg, appHandle: "pas$'kamer$&" });
    const json = /<script id="paskamer-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(json).appHandle).toBe("pas$'kamer$&");
    expect(html.split('<script').length).toBe(template.split('<script').length);
  });
});
