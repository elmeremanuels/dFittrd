import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG_DEFAULTS } from './appConfig';
import { adminGraphqlUrl } from './graphql/client';
import { DEFAULT_API_VERSION } from './types';
import { signWebhook } from './webhookHmac';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('Admin API version (#4): one constant, re-used everywhere', () => {
  it('is the latest stable version as of Nov 2026', () => {
    expect(DEFAULT_API_VERSION).toBe('2026-10');
  });

  it('feeds the toml default, the GraphQL URL and the webhook test headers', () => {
    expect(APP_CONFIG_DEFAULTS.SHOPIFY_API_VERSION).toBe(DEFAULT_API_VERSION);
    expect(adminGraphqlUrl('a.myshopify.com')).toBe(`https://a.myshopify.com/admin/api/${DEFAULT_API_VERSION}/graphql.json`);
    expect(signWebhook('s', '{}', { topic: 't', shopDomain: 'a.myshopify.com' })['x-shopify-api-version']).toBe(DEFAULT_API_VERSION);
  });

  it('infra/.env.example and the toml template carry no other version', () => {
    const env = readFileSync(join(repo, 'infra', '.env.example'), 'utf8');
    expect(env).toMatch(new RegExp(`^SHOPIFY_API_VERSION=${DEFAULT_API_VERSION}\\b`, 'm'));
    const toml = readFileSync(join(repo, 'packages', 'shopify-app', 'shopify.app.toml'), 'utf8');
    expect(toml).toContain('api_version = "{{SHOPIFY_API_VERSION}}"');
    expect(toml.replace(/^#.*$/gm, '')).not.toMatch(/\d{4}-\d{2}/);
  });
});
