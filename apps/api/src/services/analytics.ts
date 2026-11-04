/**
 * Merchant aggregates with the k-anonymity floor (D3): a group is only reported when at least
 * K distinct pseudonymous users contributed to it. Never a signature, never a device id.
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { AnalyticsSwipesResponse, FitCohortResponse } from '@paskamer/schema';
import type { Db } from '../db/client.js';
import { products, swipeEvents, trySessions, wardrobeItems } from '../db/schema.js';
import { dayEnd, dayStart } from '../lib/time.js';

type Counts = { love: number; pass: number; save: number; less: number };
const zero = (): Counts => ({ love: 0, pass: 0, save: 0, less: 0 });

interface Group {
  counts: Counts;
  devices: Set<string>;
  sizes: Record<string, number>;
  reasons: Record<string, number>;
}
const newGroup = (): Group => ({ counts: zero(), devices: new Set(), sizes: {}, reasons: {} });

export function hueBucket(hex: string | null | undefined): string {
  if (!hex) return 'unknown';
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'unknown';
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.08) return l < 0.2 ? 'black' : l > 0.85 ? 'white' : 'grey';
  let hue = 0;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 200) return 'cyan';
  if (hue < 260) return 'blue';
  if (hue < 300) return 'purple';
  return 'pink';
}

export async function swipeAnalytics(db: Db, shopId: string, from: string, to: string, k: number): Promise<AnalyticsSwipesResponse> {
  const rows = await db
    .select({
      deviceId: swipeEvents.deviceId,
      itemId: swipeEvents.itemId,
      action: swipeEvents.action,
      size: swipeEvents.sizeRecommended,
      reasons: swipeEvents.reasons,
      colour: products.primaryColorHex,
      fabric: sql<string | null>`${products.payload}->'fabric'->>'primary'`,
    })
    .from(swipeEvents)
    .leftJoin(products, eq(products.id, swipeEvents.productId))
    .where(and(eq(swipeEvents.shopId, shopId), gte(swipeEvents.at, dayStart(from)), lt(swipeEvents.at, dayEnd(to))));

  const byProduct = new Map<string, Group>();
  const byColour = new Map<string, Group>();
  const byFabric = new Map<string, Group>();
  const bySize = new Map<string, Group>();
  const bump = (map: Map<string, Group>, key: string, r: (typeof rows)[number]) => {
    const g = map.get(key) ?? newGroup();
    g.counts[r.action] += 1;
    g.devices.add(r.deviceId);
    if (r.size) g.sizes[r.size] = (g.sizes[r.size] ?? 0) + 1;
    if (r.action === 'pass') for (const reason of r.reasons ?? []) g.reasons[reason] = (g.reasons[reason] ?? 0) + 1;
    map.set(key, g);
  };
  for (const r of rows) {
    bump(byProduct, r.itemId, r);
    bump(byColour, hueBucket(r.colour), r);
    bump(byFabric, r.fabric ?? 'unknown', r);
    if (r.size) bump(bySize, r.size, r);
  }
  let suppressed = 0;
  const keep = <T>(map: Map<string, Group>, build: (key: string, g: Group) => T): T[] => {
    const out: T[] = [];
    for (const [key, g] of map) {
      if (g.devices.size < k) suppressed++;
      else out.push(build(key, g));
    }
    return out;
  };
  return {
    from,
    to,
    kAnonymityFloor: k,
    byProduct: keep(byProduct, (externalId, g) => ({ externalId, ...g.counts, sizeHistogram: g.sizes, passReasons: g.reasons })),
    byColour: keep(byColour, (hue, g) => ({ hue, ...g.counts })),
    byFabric: keep(byFabric, (fabric, g) => ({ fabric, ...g.counts })),
    bySize: keep(bySize, (size, g) => ({ size, ...g.counts })),
    suppressedGroups: suppressed,
  };
}

/** GET /v1/fit/cohort/:productId — aggregated wardrobe states only (never signatures, v1). */
export async function fitCohort(db: Db, productId: string, shopId: string | undefined, k: number): Promise<FitCohortResponse> {
  const where = shopId ? and(eq(wardrobeItems.productId, productId), eq(wardrobeItems.shopId, shopId)) : eq(wardrobeItems.productId, productId);
  const rows = await db.select({ deviceId: wardrobeItems.deviceId, size: wardrobeItems.size, state: wardrobeItems.state }).from(wardrobeItems).where(where);
  const devices = new Set(rows.map((r) => r.deviceId));
  const n = devices.size;
  if (n < k) return { productId, n, kAnonymityFloor: k, sizeHistogram: {}, keptRate: null };
  const sizeHistogram: Record<string, number> = {};
  let kept = 0;
  let decided = 0;
  for (const r of rows) {
    sizeHistogram[r.size] = (sizeHistogram[r.size] ?? 0) + 1;
    if (r.state === 'kept') {
      kept++;
      decided++;
    } else if (r.state === 'returned') decided++;
  }
  // Each size bucket must also clear the floor so a single user's size never leaks.
  for (const [size, count] of Object.entries(sizeHistogram)) if (count < k) delete sizeHistogram[size];
  return { productId, n, kAnonymityFloor: k, sizeHistogram, keptRate: decided >= k ? Math.round((kept / decided) * 1000) / 1000 : null };
}

export interface AbandonedRow {
  externalId: string;
  sessions: number;
  resolved: number;
  withFit: number;
  abandonedRate: number;
}

/** Sessions started from the merchant page that never resolved in the app, or resolved without a fit. */
export async function abandonedAnalytics(db: Db, shopId: string, from: string, to: string, k: number) {
  const rows = await db
    .select({
      externalId: products.externalId,
      sessions: sql<number>`count(*)::int`,
      resolved: sql<number>`count(${trySessions.resolvedAt})::int`,
      withFit: sql<number>`count(${trySessions.billedAt})::int`,
      devices: sql<number>`count(distinct ${trySessions.deviceId})::int`,
    })
    .from(trySessions)
    .innerJoin(products, eq(products.id, trySessions.productId))
    .where(and(eq(trySessions.shopId, shopId), gte(trySessions.createdAt, dayStart(from)), lt(trySessions.createdAt, dayEnd(to))))
    .groupBy(products.externalId);
  let suppressed = 0;
  const byProduct: AbandonedRow[] = [];
  let totals = { sessions: 0, resolved: 0, withFit: 0 };
  for (const r of rows) {
    totals = { sessions: totals.sessions + r.sessions, resolved: totals.resolved + r.resolved, withFit: totals.withFit + r.withFit };
    // Unresolved sessions have no device; the floor applies to the number of sessions per product.
    if (r.sessions < k) {
      suppressed++;
      continue;
    }
    byProduct.push({
      externalId: r.externalId,
      sessions: r.sessions,
      resolved: r.resolved,
      withFit: r.withFit,
      abandonedRate: r.sessions ? Math.round(((r.sessions - r.withFit) / r.sessions) * 1000) / 1000 : 0,
    });
  }
  return { from, to, kAnonymityFloor: k, suppressedGroups: suppressed, totals, byProduct };
}
