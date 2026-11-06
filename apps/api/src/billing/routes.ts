/**
 * POST /v1/billing/stripe/webhook — plan state for WooCommerce merchants (D17: one plan, `curtain`).
 * Skipped gracefully without STRIPE_*. Events for a subscription other than the shop's current one
 * (an old subscription ending after the merchant subscribed again) never pause the shop.
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { shops, webhookLog } from '../db/schema.js';
import { unauthorized } from '../lib/errors.js';
import { findShopById, updateSettings } from '../services/shops.js';
import type { StripeEvent } from './stripe.js';

export const stripeRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, stripe, now } = app.ctx;

  app.post('/v1/billing/stripe/webhook', { config: { rateLimit: false } }, async (req, reply) => {
    if (!stripe.webhookConfigured()) {
      req.log.warn('stripe webhook received but STRIPE_WEBHOOK_SECRET is unset — ignored');
      return reply.code(202).send({ ok: false, ignored: true });
    }
    const raw = req.rawBody ?? Buffer.alloc(0);
    const sig = req.headers['stripe-signature'];
    const event = stripe.verifyWebhook(raw, Array.isArray(sig) ? sig[0] : sig, now().getTime());
    if (!event) throw unauthorized('bad stripe signature', 'bad_signature');

    const shopId = shopIdOf(event);
    const logged = await db
      .insert(webhookLog)
      .values({ platform: 'stripe', shopId: shopId && (await findShopById(db, shopId)) ? shopId : null, topic: event.type, eventId: event.id, externalId: String(event.data.object.id ?? ''), payload: event, status: 'received' })
      .onConflictDoNothing({ target: [webhookLog.platform, webhookLog.eventId] })
      .returning({ id: webhookLog.id });
    if (logged.length === 0) return reply.code(200).send({ ok: true, duplicate: true });
    const logId = logged[0]!.id;

    let status: 'processed' | 'ignored' = 'ignored';
    const obj = event.data.object;
    if (shopId && (await findShopById(db, shopId))) {
      switch (event.type) {
        case 'checkout.session.completed': {
          await updateSettings(
            db,
            shopId,
            { stripeCustomerId: str(obj.customer), stripeSubscriptionId: str(obj.subscription) },
            { plan: 'curtain', paused: false, connectState: 'paid', billingRef: str(obj.subscription) ?? null, periodStart: now().toISOString().slice(0, 10) },
          );
          status = 'processed';
          break;
        }
        case 'customer.subscription.updated': {
          const s = str(obj.status) ?? '';
          const active = s === 'active' || s === 'trialing';
          const shop = (await findShopById(db, shopId))!;
          if (!active && isOtherSubscription(shop.billingRef, str(obj.id))) {
            status = 'ignored';
            break;
          }
          await updateSettings(
            db,
            shopId,
            { subscriptionStatus: s, stripeSubscriptionId: str(obj.id) },
            { paused: !active, plan: active ? 'curtain' : 'free', ...(active && str(obj.id) ? { billingRef: str(obj.id)! } : {}) },
          );
          status = 'processed';
          break;
        }
        case 'customer.subscription.deleted': {
          const shop = (await findShopById(db, shopId))!;
          if (isOtherSubscription(shop.billingRef, str(obj.id))) {
            status = 'ignored';
            break;
          }
          await updateSettings(db, shopId, { subscriptionStatus: 'canceled' }, { paused: true, plan: 'free' });
          status = 'processed';
          break;
        }
        default:
          status = 'ignored';
      }
    }
    await db.update(webhookLog).set({ status, processedAt: now() }).where(eq(webhookLog.id, logId));
    void shops;
    return reply.code(200).send({ ok: true });
  });
};

/** True when the event is about a subscription that is not the shop's current one. */
function isOtherSubscription(current: string | null, eventSubscription: string | undefined): boolean {
  return Boolean(current && eventSubscription && current !== eventSubscription);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function shopIdOf(event: StripeEvent): string | undefined {
  const o = event.data.object;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  return str(meta.shopId) ?? str(o.client_reference_id);
}
