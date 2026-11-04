import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { usageDaily, usageEvents, type UsageKind } from '../db/schema.js';
import { dayEnd, dayStart, utcDay } from '../lib/time.js';

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
