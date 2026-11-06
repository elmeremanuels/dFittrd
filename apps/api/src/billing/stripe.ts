/**
 * Stripe for WooCommerce merchants (D6: the Stripe customer is the merchant identity).
 * D17: one subscription line, the Curtain price (USD 8.99 per month, licensed, no meter); nothing
 * is metered per try-on session. `STRIPE_PRICE_CURTAIN` names that price (`STRIPE_PRICE_STARTER`
 * is read as a fallback for existing deployments; it must then point at the same USD 8.99 price).
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
    return Boolean(this.env.STRIPE_SECRET && this.priceId());
  }

  /** The Curtain plan's price id. */
  priceId(): string | undefined {
    return this.env.STRIPE_PRICE_CURTAIN || this.env.STRIPE_PRICE_STARTER || undefined;
  }

  webhookConfigured(): boolean {
    return Boolean(this.env.STRIPE_WEBHOOK_SECRET);
  }

  /** Subscription Checkout parameters for the Curtain plan: one price, quantity 1, no metered line (D17). */
  checkoutParams(input: { shopId: string; shopDomain: string; successUrl: string; cancelUrl: string; email?: string; trialDays?: number }): URLSearchParams {
    const price = this.priceId();
    if (!price) throw new Error('STRIPE_PRICE_CURTAIN is not set');
    const trialDays = input.trialDays ?? this.env.BILLING_TRIAL_DAYS;
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', input.successUrl);
    params.set('cancel_url', input.cancelUrl);
    params.set('line_items[0][price]', price);
    params.set('line_items[0][quantity]', '1');
    params.set('metadata[shopId]', input.shopId);
    params.set('metadata[shopDomain]', input.shopDomain);
    params.set('metadata[plan]', 'curtain');
    params.set('subscription_data[metadata][shopId]', input.shopId);
    params.set('subscription_data[metadata][plan]', 'curtain');
    // Stripe requires at least 1 trial day when the parameter is present.
    if (trialDays > 0) params.set('subscription_data[trial_period_days]', String(trialDays));
    params.set('client_reference_id', input.shopId);
    if (input.email) params.set('customer_email', input.email);
    return params;
  }

  /** Subscription Checkout for the Curtain plan (D17). */
  async createCheckoutSession(input: { shopId: string; shopDomain: string; successUrl: string; cancelUrl: string; email?: string; trialDays?: number }): Promise<{ id: string; url: string }> {
    const params = this.checkoutParams(input);
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
