import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { billingAnomalies, pairings, usageDaily, usageEvents, type BillingAnomalyKind, type UsageKind } from '../db/schema.js';
import type { Env } from '../env.js';
import { DAY, dayEnd, dayStart, utcDay } from '../lib/time.js';
import { planInfo, type ShopRow } from './shops.js';

export interface UsageWrite {
  shopId: string;
  deviceId?: string | null;
  productId?: string | null;
  kind: UsageKind;
  costUsd?: number;
  /** Unique per billable event (D7 idempotency). */
  idempotencyKey: string;
  at?: Date;
}

/** Inserts a usage event once (idempotent) and bumps usage_daily. Returns true when newly created. */
export async function recordUsage(db: Db, w: UsageWrite): Promise<boolean> {
  const at = w.at ?? new Date();
  const inserted = await db
    .insert(usageEvents)
    .values({
      shopId: w.shopId,
      deviceId: w.deviceId ?? null,
      productId: w.productId ?? null,
      kind: w.kind,
      costUsd: w.costUsd ?? 0,
      idempotencyKey: w.idempotencyKey,
      at,
    })
    .onConflictDoNothing({ target: usageEvents.idempotencyKey })
    .returning({ id: usageEvents.id });
  if (inserted.length === 0) return false;
  const day = utcDay(at);
  const fit = w.kind === 'fit_session' ? 1 : 0;
  const hero = w.kind === 'hero_render' ? 1 : 0;
  const cost = w.costUsd ?? 0;
  await db
    .insert(usageDaily)
    .values({ shopId: w.shopId, day, fitSessions: fit, heroRenders: hero, costUsd: cost })
    .onConflictDoUpdate({
      target: [usageDaily.shopId, usageDaily.day],
      set: {
        fitSessions: sql`${usageDaily.fitSessions} + ${fit}`,
        heroRenders: sql`${usageDaily.heroRenders} + ${hero}`,
        costUsd: sql`${usageDaily.costUsd} + ${cost}`,
      },
    });
  return true;
}

export async function usageDays(db: Db, shopId: string, from: string, to: string) {
  return db
    .select()
    .from(usageDaily)
    .where(and(eq(usageDaily.shopId, shopId), gte(usageDaily.day, from), sql`${usageDaily.day} <= ${to}`))
    .orderBy(usageDaily.day);
}

export async function fitSessionsBetween(db: Db, shopId: string, fromDay: string, toDay: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.shopId, shopId), eq(usageEvents.kind, 'fit_session'), gte(usageEvents.at, dayStart(fromDay)), lt(usageEvents.at, dayEnd(toDay))));
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Billing integrity (carry-over #7, #8): per-plan daily cap + anomaly signal, shared by the
// standalone fit-shown path (routes/try.ts) and the app's swipe path (routes/app.ts).
// ---------------------------------------------------------------------------------------------

export { BILLING_ANOMALY_KINDS, billingAnomalies, type BillingAnomalyKind, type BillingAnomalyRow } from '../db/schema.js';

type BillingEnv = Pick<Env, 'EMBED_BILLED_SESSIONS_PER_DAY' | 'BILLED_DAILY_CAP_FACTOR' | 'BILLED_DAILY_CAP_MIN' | 'BILLING_ANOMALY_FACTOR' | 'BILLING_ANOMALY_MIN_SESSIONS' | 'BILLING_ANOMALY_TRAILING_DAYS'>;

/**
 * Daily cap on billed fit sessions, derived from the plan's monthly allowance: ten times the
 * average day of the allowance, never below BILLED_DAILY_CAP_MIN (a small shop's sale day) and
 * never above the global EMBED_BILLED_SESSIONS_PER_DAY ceiling.
 */
export function dailyBilledCap(env: BillingEnv, shop: ShopRow): number {
  const included = planInfo(shop).includedSessions;
  const fromPlan = Math.ceil((included / 30) * env.BILLED_DAILY_CAP_FACTOR);
  return Math.min(env.EMBED_BILLED_SESSIONS_PER_DAY, Math.max(env.BILLED_DAILY_CAP_MIN, fromPlan));
}

async function billedOn(db: Db, shopId: string, day: string): Promise<number> {
  const row = await db.query.usageDaily.findFirst({ where: and(eq(usageDaily.shopId, shopId), eq(usageDaily.day, day)) });
  return row?.fitSessions ?? 0;
}

/** Average billed fit sessions per day over the `days` days before `day` (days without a row count as 0). */
export async function trailingAverage(db: Db, shopId: string, day: string, days: number): Promise<number> {
  const from = utcDay(new Date(dayStart(day).getTime() - days * DAY));
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${usageDaily.fitSessions}), 0)::int` })
    .from(usageDaily)
    .where(and(eq(usageDaily.shopId, shopId), gte(usageDaily.day, from), lt(usageDaily.day, day)));
  return Math.round(((row?.n ?? 0) / days) * 100) / 100;
}

export const spikeThreshold = (env: BillingEnv, avg: number): number => Math.max(env.BILLING_ANOMALY_MIN_SESSIONS, Math.ceil(env.BILLING_ANOMALY_FACTOR * avg));

async function upsertAnomaly(
  db: Db,
  a: { shopId: string; day: string; kind: BillingAnomalyKind; billedSessions: number; deniedDelta: number; threshold: number; trailingAverage: number; at: Date },
): Promise<boolean> {
  const inserted = await db
    .insert(billingAnomalies)
    .values({ shopId: a.shopId, day: a.day, kind: a.kind, billedSessions: a.billedSessions, deniedSessions: a.deniedDelta, threshold: a.threshold, trailingAverage: a.trailingAverage, firstAt: a.at, lastAt: a.at })
    .onConflictDoUpdate({
      target: [billingAnomalies.shopId, billingAnomalies.day, billingAnomalies.kind],
      set: {
        billedSessions: sql`greatest(${billingAnomalies.billedSessions}, ${a.billedSessions})`,
        deniedSessions: sql`${billingAnomalies.deniedSessions} + ${a.deniedDelta}`,
        threshold: a.threshold,
        lastAt: a.at,
      },
    })
    .returning({ firstAt: billingAnomalies.firstAt });
  return inserted[0]?.firstAt.getTime() === a.at.getTime();
}

export interface BillingGate {
  allowed: boolean;
  cap: number;
  billedToday: number;
}

export interface BillingLog {
  warn(obj: object, msg: string): void;
}

/**
 * Called BEFORE a fit session is billed. Refuses once the shop's billed sessions for the UTC day
 * reached the plan cap, and records the refusal (`cap_reached`, `denied_sessions + 1`) so the
 * merchant sees it in GET /v1/merchant/usage/anomalies. The check reads usage_daily inside the
 * caller's transaction; concurrent requests can overshoot the cap by a handful (it is a guard
 * against runaway billing, not an exact quota).
 */
export async function checkDailyCap(db: Db, env: BillingEnv, shop: ShopRow, at: Date, log?: BillingLog): Promise<BillingGate> {
  const day = utcDay(at);
  const cap = dailyBilledCap(env, shop);
  const billedToday = await billedOn(db, shop.id, day);
  if (billedToday < cap) return { allowed: true, cap, billedToday };
  const avg = await trailingAverage(db, shop.id, day, env.BILLING_ANOMALY_TRAILING_DAYS);
  const first = await upsertAnomaly(db, { shopId: shop.id, day, kind: 'cap_reached', billedSessions: billedToday, deniedDelta: 1, threshold: cap, trailingAverage: avg, at });
  if (first) log?.warn({ shopId: shop.id, day, cap }, 'billing daily cap reached; further fit sessions today are not billed');
  return { allowed: false, cap, billedToday };
}

/**
 * Called AFTER a fit session was billed: flags a `spike` when the day's billed sessions exceed
 * BILLING_ANOMALY_FACTOR × the trailing daily average (and at least BILLING_ANOMALY_MIN_SESSIONS).
 * A signal for the merchant and for us, never a block (the cap is the block).
 */
export async function noteBilled(db: Db, env: BillingEnv, shopId: string, at: Date, log?: BillingLog): Promise<boolean> {
  const day = utcDay(at);
  const billed = await billedOn(db, shopId, day);
  if (billed <= env.BILLING_ANOMALY_MIN_SESSIONS) return false;
  const avg = await trailingAverage(db, shopId, day, env.BILLING_ANOMALY_TRAILING_DAYS);
  const threshold = spikeThreshold(env, avg);
  if (billed <= threshold) return false;
  const first = await upsertAnomaly(db, { shopId, day, kind: 'spike', billedSessions: billed, deniedDelta: 0, threshold, trailingAverage: avg, at });
  if (first) log?.warn({ shopId, day, billed, threshold, trailingAverage: avg }, 'billing anomaly: billed sessions far above the trailing average');
  return true;
}

/** The merchant's view: today's flags plus the recorded anomalies in the range (newest first). */
export async function billingAnomalyReport(db: Db, env: BillingEnv, shop: ShopRow, from: string, to: string, now: Date) {
  const day = utcDay(now);
  const billedToday = await billedOn(db, shop.id, day);
  const avg = await trailingAverage(db, shop.id, day, env.BILLING_ANOMALY_TRAILING_DAYS);
  const threshold = spikeThreshold(env, avg);
  const dailyCap = dailyBilledCap(env, shop);
  const rows = await db
    .select()
    .from(billingAnomalies)
    .where(and(eq(billingAnomalies.shopId, shop.id), gte(billingAnomalies.day, from), sql`${billingAnomalies.day} <= ${to}`))
    .orderBy(desc(billingAnomalies.day), billingAnomalies.kind);
  return {
    from,
    to,
    dailyCap,
    today: { day, billedSessions: billedToday, trailingAverage: avg, spikeThreshold: threshold, capReached: billedToday >= dailyCap, spike: billedToday > threshold },
    anomalies: rows.map((r) => ({
      day: r.day,
      kind: r.kind,
      billedSessions: r.billedSessions,
      deniedSessions: r.deniedSessions,
      threshold: r.threshold,
      trailingAverage: r.trailingAverage,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
    })),
  };
}

export type BillOutcome = 'billed' | 'duplicate' | 'not_paired' | 'capped';

/**
 * The one way a fit session gets billed, shared by POST /v1/try/:token/fit-shown and the app's
 * POST /v1/swipes (carry-over #7, #8):
 *  1. the device must be paired with the shop (GET /v1/try/:token pairs it). A free device that
 *     swipes a catalogue it was never sent to by the shop's own button bills nothing;
 *  2. D7 idempotency: an idempotency key that already billed is a `duplicate` (checked before the
 *     cap so a replay never counts as a refused session);
 *  3. the per-plan daily cap (`checkDailyCap`), then the usage event, then the spike signal.
 * Run it inside the caller's transaction.
 */
export async function billFitSession(
  db: Db,
  env: BillingEnv,
  shop: ShopRow,
  w: { deviceId: string; productId: string | null; idempotencyKey: string; at: Date },
  log?: BillingLog,
): Promise<BillOutcome> {
  const paired = await db.query.pairings.findFirst({ where: and(eq(pairings.deviceId, w.deviceId), eq(pairings.shopId, shop.id)) });
  if (!paired) return 'not_paired';
  const seen = await db.select({ id: usageEvents.id }).from(usageEvents).where(eq(usageEvents.idempotencyKey, w.idempotencyKey)).limit(1);
  if (seen.length > 0) return 'duplicate';
  const gate = await checkDailyCap(db, env, shop, w.at, log);
  if (!gate.allowed) return 'capped';
  const created = await recordUsage(db, { shopId: shop.id, deviceId: w.deviceId, productId: w.productId, kind: 'fit_session', idempotencyKey: w.idempotencyKey, at: w.at });
  if (!created) return 'duplicate';
  await noteBilled(db, env, shop.id, w.at, log);
  return 'billed';
}
