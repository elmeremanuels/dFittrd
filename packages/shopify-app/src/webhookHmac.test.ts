import { describe, expect, it } from 'vitest';
import { API_SECRET, SHOP } from './test/fixtures';
import { ALL_WEBHOOK_TOPICS, computeWebhookHmac, isComplianceTopic, isKnownTopic, parseWebhookHeaders, signWebhook, verifyWebhookHmac, WEBHOOK_PATH } from './webhookHmac';

const body = JSON.stringify({ id: 8213455001, admin_graphql_api_id: 'gid://shopify/Product/8213455001', title: 'Linen Wrap Dress' });

describe('webhook HMAC', () => {
  it('verifies base64 HMAC-SHA256 over the raw body', () => {
    const hmac = computeWebhookHmac(API_SECRET, body);
    expect(verifyWebhookHmac(body, hmac, API_SECRET)).toBe(true);
    expect(verifyWebhookHmac(Buffer.from(body), hmac, API_SECRET)).toBe(true);
    expect(verifyWebhookHmac(new TextEncoder().encode(body), [hmac], API_SECRET)).toBe(true);
    expect(verifyWebhookHmac(body + ' ', hmac, API_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, hmac, 'wrong')).toBe(false);
    expect(verifyWebhookHmac(body, hmac.slice(0, -4) + 'AAAA', API_SECRET)).toBe(false);
  });

  it('fails closed on missing inputs or garbage headers', () => {
    expect(verifyWebhookHmac(body, undefined, API_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, '', API_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, 'x', '')).toBe(false);
    expect(verifyWebhookHmac(null, 'x', API_SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, 'not base64 at all!!', API_SECRET)).toBe(false);
  });

  it('signWebhook produces headers that verify and parse', () => {
    const headers = signWebhook(API_SECRET, body, { topic: 'products/update', shopDomain: SHOP, webhookId: 'wh-1', eventId: 'ev-1' });
    expect(verifyWebhookHmac(body, headers['x-shopify-hmac-sha256'], API_SECRET)).toBe(true);
    const parsed = parseWebhookHeaders(headers);
    expect(parsed).toMatchObject({ topic: 'products/update', shopDomain: SHOP, webhookId: 'wh-1', eventId: 'ev-1', apiVersion: '2026-10' });
    expect(parsed.hmac).toBe(headers['x-shopify-hmac-sha256']);
    expect(parsed.triggeredAt).toMatch(/^\d{4}-/);
  });

  it('parses header bags from Node (arrays, mixed case) and fetch Headers', () => {
    const node = parseWebhookHeaders({ 'X-Shopify-Topic': 'Products/Delete', 'x-shopify-shop-domain': ['Aalter-Studio.myshopify.com'], 'x-shopify-webhook-id': 'w' });
    expect(node).toMatchObject({ topic: 'products/delete', shopDomain: 'aalter-studio.myshopify.com', webhookId: 'w', hmac: undefined });
    const h = new Headers({ 'X-Shopify-Topic': 'shop/redact', 'X-Shopify-Hmac-Sha256': 'abc' });
    expect(parseWebhookHeaders(h)).toMatchObject({ topic: 'shop/redact', hmac: 'abc', shopDomain: '' });
  });

  it('topic helpers match the api handler list', () => {
    expect([...ALL_WEBHOOK_TOPICS]).toEqual(['products/create', 'products/update', 'products/delete', 'app/uninstalled', 'app_subscriptions/update', 'customers/data_request', 'customers/redact', 'shop/redact']);
    expect(isComplianceTopic('shop/redact')).toBe(true);
    expect(isComplianceTopic('products/update')).toBe(false);
    expect(isKnownTopic('orders/create')).toBe(false);
    expect(WEBHOOK_PATH).toBe('/shopify/webhooks');
  });
});
