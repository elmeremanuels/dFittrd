import { ESTIMATE_DISCLAIMER } from '@paskamer/schema';
import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE_PATH, adminContentSecurityPolicy, adminPageTemplate, APP_BRIDGE_SCRIPT_URL, jsonForScript, renderAdminPage } from './admin';
import { API_KEY, SHOP } from './test/fixtures';

const cfg = { apiKey: API_KEY, apiUrl: 'https://api.paskamer.app/', appUrl: 'https://app.paskamer.app' };

describe('admin page', () => {
  it('injects the api key meta, App Bridge from Shopify CDN and the config JSON', () => {
    const html = renderAdminPage(cfg);
    expect(html).toContain(`<meta name="shopify-api-key" content="${API_KEY}" />`);
    expect(html).toContain(`<script src="${APP_BRIDGE_SCRIPT_URL}"></script>`);
    expect(html).not.toContain('__PASKAMER_');
    const json = /<script id="paskamer-config" type="application\/json">(.*?)<\/script>/s.exec(html)![1]!;
    expect(JSON.parse(json)).toEqual({ apiKey: API_KEY, apiUrl: 'https://api.paskamer.app', appUrl: 'https://app.paskamer.app', appHandle: 'paskamer', blockHandle: 'try-in-paskamer', disclaimer: ESTIMATE_DISCLAIMER });
  });

  it('cannot be broken out of with </script> in config values', () => {
    expect(jsonForScript({ a: '</script><script>alert(1)</script>' })).not.toContain('</script>');
    const html = renderAdminPage({ ...cfg, appHandle: 'x</script><script>alert(1)' });
    expect(html.split('<script').length).toBe(adminPageTemplate().split('<script').length);
  });

  it('validates its inputs', () => {
    expect(() => renderAdminPage({ ...cfg, apiKey: '<x>' })).toThrow(/client id/);
    expect(() => renderAdminPage({ ...cfg, apiUrl: 'javascript:alert(1)' })).toThrow(/origin/);
  });

  it('only talks to our api and Shopify; no storage, no secrets, no other origins', () => {
    const html = renderAdminPage(cfg);
    const urls = html.match(/https?:\/\/[a-z0-9.-]+/gi) ?? [];
    const hosts = new Set(urls.map((u) => new URL(u).host));
    expect([...hosts].sort()).toEqual(['admin.shopify.com', 'api.paskamer.app', 'app.paskamer.app', 'cdn.shopify.com']);
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(html).not.toMatch(/sk_(live|test)_/);
    expect(html).toMatch(/shopify\.idToken\(\)/);
    expect(html).toMatch(/\/shopify\/token-exchange/);
    expect(html).toMatch(/\/v1\/merchant\/products/);
    expect(html).toMatch(/\/v1\/merchant\/usage/);
    expect(html).toMatch(/\/v1\/merchant\/ledger/);
    expect(html).toMatch(/\/shopify\/billing\/subscribe/);
    expect(html).toMatch(/addAppBlockId/);
    expect(html).toContain('credentials: \'omit\'');
  });

  it('CSP restricts framing to the shop and admin.shopify.com', () => {
    expect(adminContentSecurityPolicy(SHOP)).toBe(`frame-ancestors https://${SHOP} https://admin.shopify.com;`);
    expect(adminContentSecurityPolicy('evil.example')).toBe('frame-ancestors https://admin.shopify.com;');
    expect(adminContentSecurityPolicy(undefined)).toBe('frame-ancestors https://admin.shopify.com;');
    expect(ADMIN_PAGE_PATH).toBe('/shopify/admin');
  });
});
