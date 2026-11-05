import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { AppConfigError, renderAppConfig, validateAppConfig } from './appConfig';
import { ALL_WEBHOOK_TOPICS, SHOPIFY_COMPLIANCE_TOPICS, SHOPIFY_WEBHOOK_TOPICS } from './webhookHmac';

const template = readFileSync(new URL('../shopify.app.toml', import.meta.url), 'utf8');
const vars = { SHOPIFY_API_KEY: '0123456789abcdef0123456789abcdef', PUBLIC_API_URL: 'https://api.curtain.fit', PUBLIC_APP_URL: 'https://app.curtain.fit' };

describe('shopify.app.toml template', () => {
  it('renders to valid TOML that passes validation against the api contracts', () => {
    const toml = renderAppConfig(template, vars);
    const nonComment = toml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(nonComment).not.toMatch(/\{\{/);
    const parsed = parse(toml) as Record<string, unknown>;
    const v = validateAppConfig(parsed, { apiUrl: vars.PUBLIC_API_URL });
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
    expect(parsed.client_id).toBe(vars.SHOPIFY_API_KEY);
    expect(parsed.application_url).toBe('https://api.curtain.fit/shopify/admin');
    expect(parsed.embedded).toBe(true);
    expect(parsed.handle).toBe('curtain');
    expect((parsed.access_scopes as { scopes: string; use_legacy_install_flow: boolean }).use_legacy_install_flow).toBe(false);
    expect(v.scopes).toEqual(['read_products', 'write_products']);
    expect(v.topics.sort()).toEqual([...SHOPIFY_WEBHOOK_TOPICS].sort());
    expect(v.complianceTopics.sort()).toEqual([...SHOPIFY_COMPLIANCE_TOPICS].sort());
    expect((parsed.webhooks as { api_version: string }).api_version).toBe('2025-10');
    // the optional dev_store_url line is dropped when SHOPIFY_DEV_STORE is empty
    expect((parsed.build as Record<string, unknown>).dev_store_url).toBeUndefined();
  });

  it('keeps dev store and a custom api version when given', () => {
    const parsed = parse(renderAppConfig(template, { ...vars, SHOPIFY_DEV_STORE: 'curtain-dev.myshopify.com', SHOPIFY_API_VERSION: '2026-01' })) as Record<string, unknown>;
    expect((parsed.build as Record<string, unknown>).dev_store_url).toBe('curtain-dev.myshopify.com');
    expect((parsed.webhooks as { api_version: string }).api_version).toBe('2026-01');
  });

  it('refuses to render with a missing or unknown placeholder', () => {
    expect(() => renderAppConfig(template, { ...vars, SHOPIFY_API_KEY: undefined })).toThrow(AppConfigError);
    try {
      renderAppConfig('x = "{{NOPE}}"', vars);
      expect.unreachable();
    } catch (e) {
      expect((e as AppConfigError).issues).toEqual(['unknown placeholder {{NOPE}}']);
    }
  });

  it('escapes TOML string content', () => {
    expect(renderAppConfig('a = "{{PUBLIC_APP_URL}}"', { ...vars, PUBLIC_APP_URL: 'https://x/"q"' })).toBe('a = "https://x/\\"q\\""');
  });
});

describe('validateAppConfig', () => {
  const good = () => parse(renderAppConfig(template, vars)) as Record<string, unknown>;

  it('flags the legacy install flow, missing topics, wrong uri, extra scopes and non-https urls', () => {
    const c = good();
    (c.access_scopes as Record<string, unknown>).use_legacy_install_flow = true;
    (c.access_scopes as Record<string, unknown>).scopes = 'read_products,write_products,read_customers';
    (c.webhooks as { subscriptions: Array<Record<string, unknown>> }).subscriptions = [{ topics: ['products/update', 'orders/create'], uri: '/hooks' }];
    (c.auth as Record<string, unknown>).redirect_urls = ['http://insecure'];
    c.client_id = 'placeholder';
    const v = validateAppConfig(c);
    expect(v.ok).toBe(false);
    expect(v.issues).toEqual(
      expect.arrayContaining([
        'client_id must be the 32-hex client id from the Partner Dashboard',
        'use_legacy_install_flow must be false (managed installation, D6)',
        'unexpected scope read_customers (Protected Customer Data minimum, D7)',
        "subscription uri must be /shopify/webhooks (relative) or https://<api>/shopify/webhooks: got '/hooks'",
        'topic orders/create has no handler in the api',
        'compliance topic shop/redact is not declared',
        'webhook topic app/uninstalled is not subscribed',
        'auth.redirect_urls entry is not https: http://insecure',
      ]),
    );
  });

  it('accepts a relative webhook uri and the full handler topic list', () => {
    const c = good();
    (c.webhooks as { subscriptions: Array<Record<string, unknown>> }).subscriptions = [{ topics: [...SHOPIFY_WEBHOOK_TOPICS], compliance_topics: [...SHOPIFY_COMPLIANCE_TOPICS], uri: '/shopify/webhooks' }];
    const v = validateAppConfig(c);
    expect(v.issues).toEqual([]);
    expect([...v.topics, ...v.complianceTopics].sort()).toEqual([...ALL_WEBHOOK_TOPICS].sort());
  });

  it('tolerates garbage input', () => {
    expect(validateAppConfig(null).ok).toBe(false);
    expect(validateAppConfig('nope').issues.length).toBeGreaterThan(5);
  });
});
