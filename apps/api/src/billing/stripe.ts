/**
 * Stripe for WooCommerce merchants (D6: the Stripe customer is the merchant identity).
 * Pure fetch against the REST API (form-encoded) and manual webhook signature verification, so
 * tests need no SDK or network. Everything is skipped gracefully when STRIPE_SECRET is unset.
 */
import type { Env } from '../env.js';
import { hmacHex, safeEqual } from '../lib/crypto.js';
import type { FetchLike } from '../context.js';

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export class StripeClient {
  constructor(
    private readonly env: Env,
    private readonly fetchImpl: FetchLike,
  ) {}

  configured(): boolean {
    return Boolean(this.env.STRIPE_SECRET && this.env.STRIPE_PRICE_STARTER);
  }

  webhookConfigured(): boolean {
    return Boolean(this.env.STRIPE_WEBHOOK_SECRET);
  }

  /** Subscription Checkout for the Starter plan (+ metered overage price when configured). */
  async createCheckoutSession(input: { shopId: string; shopDomain: string; successUrl: string; cancelUrl: string; email?: string }): Promise<{ id: string; url: string }> {
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', input.successUrl);
    params.set('cancel_url', input.cancelUrl);
    params.set('line_items[0][price]', this.env.STRIPE_PRICE_STARTER!);
    params.set('line_items[0][quantity]', '1');
    if (this.env.STRIPE_PRICE_OVERAGE) params.set('line_items[1][price]', this.env.STRIPE_PRICE_OVERAGE);
    params.set('metadata[shopId]', input.shopId);
    params.set('metadata[shopDomain]', input.shopDomain);
    params.set('subscription_data[metadata][shopId]', input.shopId);
    params.set('subscription_data[trial_period_days]', '14');
    params.set('client_reference_id', input.shopId);
    if (input.email) params.set('customer_email', input.email);
    const res = await this.fetchImpl(`${this.env.STRIPE_API_URL}/v1/checkout/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.env.STRIPE_SECRET}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !body.id || !body.url) throw new Error(body.error?.message ?? `stripe checkout failed (${res.status})`);
    return { id: body.id, url: body.url };
  }

  /**
   * Verifies `Stripe-Signature: t=…,v1=…` (HMAC-SHA256 of `${t}.${body}` with the webhook secret,
   * 5-minute tolerance) and returns the parsed event, or null.
   */
  verifyWebhook(rawBody: string | Uint8Array, header: string | undefined, now = Date.now()): StripeEvent | null {
    const secret = this.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !header) return null;
    // `t=<ts>,v1=<sig>[,v1=<sig>…]` — during secret rotation Stripe signs with both secrets, so
    // every v1 is tried (never only the last one parsed).
    let t: string | undefined;
    const v1s: string[] = [];
    for (const kv of header.split(',')) {
      const i = kv.indexOf('=');
      if (i <= 0) continue;
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      if (k === 't') t = v;
      else if (k === 'v1' && v) v1s.push(v);
    }
    if (!t || v1s.length === 0) return null;
    const ts = Number(t);
    if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return null;
    const bodyStr = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');
    const expected = hmacHex(secret, `${t}.${bodyStr}`);
    if (!v1s.some((v1) => safeEqual(expected, v1))) return null;
    try {
      const ev = JSON.parse(bodyStr) as StripeEvent;
      return ev && typeof ev.id === 'string' && typeof ev.type === 'string' ? ev : null;
    } catch {
      return null;
    }
  }

  /** Test helper: builds a valid signature header for a body. */
  sign(rawBody: string, now = Date.now()): string {
    const t = Math.floor(now / 1000);
    return `t=${t},v1=${hmacHex(this.env.STRIPE_WEBHOOK_SECRET ?? '', `${t}.${rawBody}`)}`;
  }
}
