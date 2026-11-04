/** prune-renders (hourly), purge-shop (48 h after shop/redact), usage-rollup (nightly, Shopify + Stripe). */
import { and, eq, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import type { App } from '../app.js';
import { renderJobs, shops, usageDaily } from '../db/schema.js';
import { DAY, utcDay } from '../lib/time.js';
import { planInfo } from '../services/shops.js';
import { fitSessionsBetween } from '../services/usage.js';
import { periodFor } from '../lib/time.js';

export function makePruneRendersHandler(app: App) {
  const { db, now } = app.ctx;
  return async (): Promise<number> => {
    const due = await db.select().from(renderJobs).where(and(lt(renderJobs.expiresAt, now()), ne(renderJobs.status, 'expired')));
    for (const j of due) {
      await app.renders.remove(j.personPath);
      await app.renders.remove(j.resultPath);
      await app.renders.remove(j.videoPath);
      await db.update(renderJobs).set({ status: 'expired', personPath: null, resultPath: null, videoPath: null }).where(eq(renderJobs.id, j.id));
    }
    return due.length;
  };
}

export interface PurgeShopJob {
  shopId: string;
}

/** Deletes the shop row (cascades to products, pairings, sessions, usage, logs) and its render files. */
export function makePurgeShopHandler(app: App) {
  const { db, shopify } = app.ctx;
  return async ({ shopId }: PurgeShopJob): Promise<void> => {
    const jobs = await db.select().from(renderJobs).where(eq(renderJobs.shopId, shopId));
    for (const j of jobs) {
      await app.renders.remove(j.personPath);
      await app.renders.remove(j.resultPath);
      await app.renders.remove(j.videoPath);
    }
    await shopify.deleteSessions(shopId);
    await db.delete(shops).where(eq(shops.id, shopId));
    app.log.info({ shopId }, 'shop purged');
  };
}

/** Also run by the prune cron: shops whose purge_after passed without a shop/redact webhook. */
export function makePurgeDueShopsHandler(app: App) {
  const purge = makePurgeShopHandler(app);
  const { db, now } = app.ctx;
  return async (): Promise<number> => {
    const due = await db.select({ id: shops.id }).from(shops).where(and(isNotNull(shops.purgeAfter), lt(shops.purgeAfter, now())));
    for (const s of due) await purge({ shopId: s.id });
    return due.length;
  };
}

export interface RollupResult {
  pushed: number;
  skipped: number;
  errors: number;
}

/**
 * Nightly usage push (D7): for every paid shop, yesterday's fit sessions above the plan's included
 * quota go to Shopify `appUsageRecordCreate` (usage line item) or a Stripe meter event. Idempotent
 * per (shop, day) via usage_daily.pushed_at and the vendor idempotency key.
 */
export function makeUsageRollupHandler(app: App) {
  const { db, env, shopify, fetch: fetchImpl, now } = app.ctx;
  return async (data: { day?: string } = {}): Promise<RollupResult> => {
    const day = data.day ?? utcDay(new Date(now().getTime() - DAY));
    const rows = await db
      .select()
      .from(usageDaily)
      .innerJoin(shops, eq(shops.id, usageDaily.shopId))
      .where(and(eq(usageDaily.day, day), isNull(usageDaily.pushedAt)));
    const result: RollupResult = { pushed: 0, skipped: 0, errors: 0 };
    for (const { usage_daily: u, shops: shop } of rows) {
      try {
        const spec = planInfo(shop);
        const period = periodFor(shop.periodStart, new Date(`${day}T12:00:00Z`));
        const usedThrough = await fitSessionsBetween(db, shop.id, period.start, day);
        const before = usedThrough - u.fitSessions;
        const billable = Math.max(0, usedThrough - spec.includedSessions) - Math.max(0, before - spec.includedSessions);
        const amountEur = Math.round(billable * spec.overageEurPerSession * 100) / 100;
        if (shop.plan === 'free' || billable <= 0 || amountEur <= 0) {
          await db.update(usageDaily).set({ pushedAt: now(), pushedSessions: 0 }).where(and(eq(usageDaily.shopId, shop.id), eq(usageDaily.day, day)));
          result.skipped++;
          continue;
        }
        if (shop.platform === 'shopify') {
          const lineItemId = shop.settings.usageLineItemId;
          const token = await shopify.accessTokenFor(shop.domain);
          if (!lineItemId || !token) {
            result.skipped++;
            continue;
          }
          await shopify.appUsageRecordCreate(shop.domain, token, {
            lineItemId,
            description: `Paskamer: ${billable} try-on sessions above plan on ${day}`,
            amountEur,
            idempotencyKey: `${shop.id}:${day}`,
          });
        } else {
          const customer = shop.settings.stripeCustomerId;
          if (!env.STRIPE_SECRET || !customer) {
            result.skipped++;
            continue;
          }
          const params = new URLSearchParams({
            event_name: 'paskamer_fit_sessions',
            'payload[stripe_customer_id]': customer,
            'payload[value]': String(billable),
            identifier: `${shop.id}:${day}`,
            timestamp: String(Math.floor(new Date(`${day}T23:59:00Z`).getTime() / 1000)),
          });
          const res = await fetchImpl(`${env.STRIPE_API_URL}/v1/billing/meter_events`, {
            method: 'POST',
            headers: { authorization: `Bearer ${env.STRIPE_SECRET}`, 'content-type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });
          if (!res.ok) throw new Error(`stripe meter event failed (${res.status})`);
        }
        await db.update(usageDaily).set({ pushedAt: now(), pushedSessions: billable }).where(and(eq(usageDaily.shopId, shop.id), eq(usageDaily.day, day)));
        result.pushed++;
      } catch (err) {
        app.log.error({ err, shopId: shop.id, day }, 'usage rollup failed for shop');
        result.errors++;
      }
    }
    return result;
  };
}
