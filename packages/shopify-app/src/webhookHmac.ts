/**
 * Webhook delivery verification (declarative subscriptions in shopify.app.toml, D6):
 * `X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(client_secret, raw body)). Compare timing-safe,
 * over the raw bytes, before parsing JSON. Respond 200 within 5 s and process asynchronously
 * (the api logs every delivery into webhook_log and queues the work).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DEFAULT_API_VERSION } from './types';

/** Topics the api handles (apps/api/src/shopify/routes.ts SHOPIFY_TOPICS) — keep in sync with shopify.app.toml. */
export const SHOPIFY_WEBHOOK_TOPICS = ['products/create', 'products/update', 'products/delete', 'app/uninstalled', 'app_subscriptions/update'] as const;
export const SHOPIFY_COMPLIANCE_TOPICS = ['customers/data_request', 'customers/redact', 'shop/redact'] as const;
export const ALL_WEBHOOK_TOPICS = [...SHOPIFY_WEBHOOK_TOPICS, ...SHOPIFY_COMPLIANCE_TOPICS] as const;
export type ShopifyWebhookTopic = (typeof ALL_WEBHOOK_TOPICS)[number];

/** Relative path declared in shopify.app.toml; the api mounts it at this path. */
export const WEBHOOK_PATH = '/shopify/webhooks' as const;

export function isComplianceTopic(topic: string): topic is (typeof SHOPIFY_COMPLIANCE_TOPICS)[number] {
  return (SHOPIFY_COMPLIANCE_TOPICS as readonly string[]).includes(topic);
}

export function isKnownTopic(topic: string): topic is ShopifyWebhookTopic {
  return (ALL_WEBHOOK_TOPICS as readonly string[]).includes(topic);
}

export function computeWebhookHmac(secret: string, rawBody: Uint8Array | string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** Constant-time check of the header against the raw body. Any missing input → false. */
export function verifyWebhookHmac(rawBody: Uint8Array | string | null | undefined, header: string | string[] | null | undefined, secret: string | null | undefined): boolean {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h || !secret || rawBody === null || rawBody === undefined) return false;
  let given: Buffer;
  try {
    given = Buffer.from(h.trim(), 'base64');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export interface WebhookHeaders {
  topic: string;
  shopDomain: string;
  hmac: string | undefined;
  /** Unique per delivery → idempotency key (webhook_log.event_id). */
  webhookId: string | undefined;
  /** Shared by all deliveries caused by one merchant action. */
  eventId: string | undefined;
  apiVersion: string | undefined;
  triggeredAt: string | undefined;
}

type HeaderBag = Record<string, string | string[] | undefined> | { get(name: string): string | null };

function readHeader(bag: HeaderBag, name: string): string | undefined {
  if (typeof (bag as { get?: unknown }).get === 'function') {
    const v = (bag as { get(name: string): string | null }).get(name);
    return v ?? undefined;
  }
  const rec = bag as Record<string, string | string[] | undefined>;
  const want = name.toLowerCase();
  let v = rec[want];
  if (v === undefined) {
    const key = Object.keys(rec).find((k) => k.toLowerCase() === want);
    if (key !== undefined) v = rec[key];
  }
  return Array.isArray(v) ? v[0] : v;
}

/** Pull the `X-Shopify-*` headers out of a Node/Fastify header object or a fetch `Headers`. */
export function parseWebhookHeaders(headers: HeaderBag): WebhookHeaders {
  return {
    topic: (readHeader(headers, 'x-shopify-topic') ?? '').toLowerCase(),
    shopDomain: (readHeader(headers, 'x-shopify-shop-domain') ?? '').toLowerCase(),
    hmac: readHeader(headers, 'x-shopify-hmac-sha256'),
    webhookId: readHeader(headers, 'x-shopify-webhook-id'),
    eventId: readHeader(headers, 'x-shopify-event-id'),
    apiVersion: readHeader(headers, 'x-shopify-api-version'),
    triggeredAt: readHeader(headers, 'x-shopify-triggered-at'),
  };
}

/** Test helper: headers Shopify would send for a delivery (used by the api's webhook tests too). */
export function signWebhook(secret: string, rawBody: string, meta: { topic: string; shopDomain: string; webhookId?: string; eventId?: string; apiVersion?: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-shopify-hmac-sha256': computeWebhookHmac(secret, rawBody),
    'x-shopify-topic': meta.topic,
    'x-shopify-shop-domain': meta.shopDomain,
    'x-shopify-webhook-id': meta.webhookId ?? `wh-${Date.now()}`,
    'x-shopify-event-id': meta.eventId ?? `ev-${Date.now()}`,
    'x-shopify-api-version': meta.apiVersion ?? DEFAULT_API_VERSION,
    'x-shopify-triggered-at': new Date().toISOString(),
  };
}
