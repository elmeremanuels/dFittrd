/**
 * Merchant aggregates and the shopper cohort with the k-anonymity floor (D3) and protection against differencing
 * (launch-readiness finding 1, see `kfloor.ts`): one closed calendar month per answer, the first answer frozen in
 * `analytics_snapshots`, and complementary suppression inside every table. Never a signature, never a device id.
 *
 * The `compute*` functions are pure (rows in, response out) so the property tests can attack them; the async
 * functions read the rows for one shop and month and freeze the result.
 */
import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import {
  WARDROBE_SIZE_UNKNOWN,
  type AnalyticsAbandonedResponse,
  type AnalyticsFitSizesResponse,
  type AnalyticsSwipesResponse,
  type FitCohortResponse,
  type SwipeAction,
} from '@curtain/schema';
import type { Db } from '../db/client.js';
import { analyticsSnapshots, products, swipeEvents, trySessions, wardrobeItems } from '../db/schema.js';
import { countReasons, floorPartition, lastClosedMonth, monthBounds, utcMonth, type FloorResult } from './kfloor.js';

type Counts = { love: number; pass: number; save: number; less: number };
const zero = (): Counts => ({ love: 0, pass: 0, save: 0, less: 0 });
const addCounts = (a: Counts, b: Counts): void => {
  a.love += b.love;
  a.pass += b.pass;
  a.save += b.save;
  a.less += b.less;
};
const byKey = <T>(a: [string, T], b: [string, T]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
/** "No size given": part of a product's hidden remainder, never a bucket. */
const NO_SIZE = '\u0000none';

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

const periodFields = (period: string, k: number, ...results: FloorResult[]) => {
  const suppression = countReasons(...results);
  const { from, to } = monthBounds(period);
  return { period, from, to, kAnonymityFloor: k, suppressedGroups: suppression.belowFloor + suppression.complementary, suppression };
};

// ---- swipes ---------------------------------------------------------------------------------------

export interface SwipeRow {
  deviceId: string;
  itemId: string;
  action: SwipeAction;
  size: string | null;
  reasons: readonly string[] | null;
  hue: string;
  fabric: string;
}

/** One label per product, whichever rows carry it: a product is never split across two colour or fabric rows. */
const productLabel = (labels: ReadonlySet<string>): string => [...labels].filter((l) => l !== 'unknown').sort()[0] ?? 'unknown';

/**
 * Products are the base table and each product's sizes are nested in it; both are floored with complementary
 * suppression. Colour, fabric and size are sums of shown products and shown size buckets only.
 */
export function computeSwipes(rows: readonly SwipeRow[], k: number, period: string): AnalyticsSwipesResponse {
  interface Leaf {
    devices: Set<string>;
    rows: number;
    counts: Counts;
  }
  interface Prod extends Leaf {
    reasons: Record<string, number>;
    sizes: Map<string, Leaf>;
    hues: Set<string>;
    fabrics: Set<string>;
  }
  const newLeaf = (): Leaf => ({ devices: new Set(), rows: 0, counts: zero() });
  const byProduct = new Map<string, Prod>();
  for (const r of rows) {
    let p = byProduct.get(r.itemId);
    if (!p) byProduct.set(r.itemId, (p = { ...newLeaf(), reasons: {}, sizes: new Map(), hues: new Set(), fabrics: new Set() }));
    p.devices.add(r.deviceId);
    p.rows++;
    p.counts[r.action]++;
    p.hues.add(r.hue);
    p.fabrics.add(r.fabric);
    if (r.action === 'pass') for (const reason of r.reasons ?? []) p.reasons[reason] = (p.reasons[reason] ?? 0) + 1;
    const sizeKey = r.size || NO_SIZE;
    let leaf = p.sizes.get(sizeKey);
    if (!leaf) p.sizes.set(sizeKey, (leaf = newLeaf()));
    leaf.devices.add(r.deviceId);
    leaf.rows++;
    leaf.counts[r.action]++;
  }
  const top = floorPartition([...byProduct].map(([key, p]) => ({ key, devices: p.devices, rows: p.rows })), k);
  const inner: FloorResult[] = [];
  const out: AnalyticsSwipesResponse['byProduct'] = [];
  const colour = new Map<string, Counts>();
  const fabric = new Map<string, Counts>();
  const size = new Map<string, Counts>();
  const bump = (m: Map<string, Counts>, key: string, c: Counts) => {
    const acc = m.get(key) ?? zero();
    addCounts(acc, c);
    m.set(key, acc);
  };
  for (const externalId of [...top.published].sort()) {
    const p = byProduct.get(externalId)!;
    const sizes = floorPartition([...p.sizes].map(([key, l]) => ({ key, devices: l.devices, rows: l.rows, neverPublish: key === NO_SIZE })), k);
    inner.push(sizes);
    const sizeHistogram: Record<string, number> = {};
    for (const s of [...sizes.published].sort()) {
      const leaf = p.sizes.get(s)!;
      sizeHistogram[s] = leaf.rows;
      bump(size, s, leaf.counts);
    }
    bump(colour, productLabel(p.hues), p.counts);
    bump(fabric, productLabel(p.fabrics), p.counts);
    out.push({ externalId, ...p.counts, sizeHistogram, passReasons: p.reasons });
  }
  const sorted = (m: Map<string, Counts>) => [...m].sort(byKey);
  return {
    ...periodFields(period, k, top, ...inner),
    byProduct: out,
    byColour: sorted(colour).map(([hue, c]) => ({ hue, ...c })),
    byFabric: sorted(fabric).map(([f, c]) => ({ fabric: f, ...c })),
    bySize: sorted(size).map(([s, c]) => ({ size: s, ...c })),
  };
}

// ---- standalone fit-shown sizes ---------------------------------------------------------------------

export interface FitSizeRow {
  /** Null once the shopper was erased: the session still counts, the person no longer does. */
  deviceId: string | null;
  size: string | null;
}

/**
 * Sizes recommended in standalone fit sessions (carry-over #18), counted per session, floored on distinct shoppers.
 * Sessions without a size label are part of the hidden remainder, so the usage page's session count minus the shown
 * sizes is never a group below the floor.
 */
export function computeFitSizes(rows: readonly FitSizeRow[], k: number, period: string): AnalyticsFitSizesResponse {
  const cells = new Map<string, { devices: Set<string>; rows: number }>();
  for (const r of rows) {
    const key = r.size || NO_SIZE;
    const c = cells.get(key) ?? { devices: new Set<string>(), rows: 0 };
    if (r.deviceId) c.devices.add(r.deviceId);
    c.rows++;
    cells.set(key, c);
  }
  const f = floorPartition([...cells].map(([key, c]) => ({ key, ...c, neverPublish: key === NO_SIZE })), k);
  const bySize = [...f.published].sort().map((s) => ({ size: s, sessions: cells.get(s)!.rows }));
  return { ...periodFields(period, k, f), bySize, totals: { sessions: bySize.reduce((n, s) => n + s.sessions, 0) } };
}

// ---- abandoned opens ------------------------------------------------------------------------------

export interface AbandonedSessionRow {
  externalId: string;
  /** The shopper who resolved the session; null for opens that never resolved (or erased shoppers). */
  deviceId: string | null;
  resolved: boolean;
  withFit: boolean;
}

/**
 * Sessions started from the merchant page that never resolved, or resolved without a fit (carry-over #19). The floor
 * counts distinct shoppers (devices that resolved a session for the product), not sessions. Totals add up the shown
 * products only.
 */
export function computeAbandoned(rows: readonly AbandonedSessionRow[], k: number, period: string): AnalyticsAbandonedResponse {
  const cells = new Map<string, { devices: Set<string>; rows: number; resolved: number; withFit: number }>();
  for (const r of rows) {
    const c = cells.get(r.externalId) ?? { devices: new Set<string>(), rows: 0, resolved: 0, withFit: 0 };
    if (r.deviceId) c.devices.add(r.deviceId);
    c.rows++;
    if (r.resolved) c.resolved++;
    if (r.withFit) c.withFit++;
    cells.set(r.externalId, c);
  }
  const f = floorPartition([...cells].map(([key, c]) => ({ key, devices: c.devices, rows: c.rows })), k);
  const totals = { sessions: 0, resolved: 0, withFit: 0 };
  const byProduct = [...f.published].sort().map((externalId) => {
    const c = cells.get(externalId)!;
    totals.sessions += c.rows;
    totals.resolved += c.resolved;
    totals.withFit += c.withFit;
    return { externalId, sessions: c.rows, resolved: c.resolved, withFit: c.withFit, abandonedRate: c.rows ? Math.round(((c.rows - c.withFit) / c.rows) * 1000) / 1000 : 0 };
  });
  return { ...periodFields(period, k, f), totals, byProduct };
}

// ---- cohort (wardrobe) ----------------------------------------------------------------------------

export interface CohortRow {
  deviceId: string;
  size: string;
  state: string;
}

/** One shop's wardrobe rows for one product in one closed month, floored. Stored as is; never sent on its own. */
export interface CohortCell {
  k: number;
  n: number;
  sizeHistogram: Record<string, number>;
  kept: number;
  decided: number;
}

export function computeCohortCell(rows: readonly CohortRow[], k: number): CohortCell {
  const devices = new Set(rows.map((r) => r.deviceId));
  if (devices.size < k) return { k, n: 0, sizeHistogram: {}, kept: 0, decided: 0 };
  const sizes = new Map<string, { devices: Set<string>; rows: number }>();
  let kept = 0;
  let decided = 0;
  for (const r of rows) {
    // 'unknown' is a marker, not a chart size: it counts towards n and the kept rate but never becomes a bucket.
    const c = sizes.get(r.size) ?? { devices: new Set<string>(), rows: 0 };
    c.devices.add(r.deviceId);
    c.rows++;
    sizes.set(r.size, c);
    if (r.state === 'kept') {
      kept++;
      decided++;
    } else if (r.state === 'returned') decided++;
  }
  const f = floorPartition([...sizes].map(([key, c]) => ({ key, ...c, neverPublish: key === WARDROBE_SIZE_UNKNOWN })), k);
  const sizeHistogram: Record<string, number> = {};
  for (const s of [...f.published].sort()) sizeHistogram[s] = sizes.get(s)!.rows;
  return decided >= k ? { k, n: devices.size, sizeHistogram, kept, decided } : { k, n: devices.size, sizeHistogram, kept: 0, decided: 0 };
}

/** The cohort a device sees: the sum of the shown cells. A cell frozen under a lower floor than today's is left out. */
export function sumCohortCells(productId: string, cells: readonly CohortCell[], k: number, through: string | null): FitCohortResponse {
  let n = 0;
  let kept = 0;
  let decided = 0;
  const hist: Record<string, number> = {};
  for (const c of cells) {
    if (c.k < k || c.n === 0) continue;
    n += c.n;
    kept += c.kept;
    decided += c.decided;
    for (const [s, v] of Object.entries(c.sizeHistogram)) hist[s] = (hist[s] ?? 0) + v;
  }
  const sizeHistogram = Object.fromEntries(Object.entries(hist).sort(byKey));
  return { productId, n, kAnonymityFloor: k, sizeHistogram, keptRate: decided >= k ? Math.round((kept / decided) * 1000) / 1000 : null, through };
}

// ---- frozen answers -------------------------------------------------------------------------------

type SnapshotKind = 'swipes' | 'fit_sizes' | 'abandoned' | 'cohort';

/**
 * The first answer for a closed month is stored and served from then on, so the same question never has two
 * different answers (an erasure or a late upload after the first answer changes nothing a merchant can see).
 */
async function frozen<T>(db: Db, shopId: string, kind: SnapshotKind, scope: string, period: string, compute: () => Promise<T>): Promise<T> {
  const read = () =>
    db
      .select({ payload: analyticsSnapshots.payload })
      .from(analyticsSnapshots)
      .where(and(eq(analyticsSnapshots.shopId, shopId), eq(analyticsSnapshots.kind, kind), eq(analyticsSnapshots.scope, scope), eq(analyticsSnapshots.period, period)))
      .limit(1);
  let [row] = await read();
  if (!row) {
    const payload = await compute();
    await db.insert(analyticsSnapshots).values({ shopId, kind, scope, period, payload }).onConflictDoNothing();
    [row] = await read();
  }
  return row!.payload as T;
}

/**
 * The floor was raised after this month was frozen: its frozen cells may sit below today's floor and recomputing
 * would be a second answer to the same question, so the month is served with every row hidden.
 */
function underRaisedFloor<T extends { kAnonymityFloor: number; suppressedGroups: number; suppression: { belowFloor: number; complementary: number } }>(r: T, k: number, shownRows: number, empty: Partial<T>): T {
  if (r.kAnonymityFloor >= k) return r;
  const belowFloor = r.suppression.belowFloor + r.suppression.complementary + shownRows;
  return { ...r, ...empty, kAnonymityFloor: k, suppressedGroups: belowFloor, suppression: { belowFloor, complementary: 0 } };
}

export async function swipeAnalytics(db: Db, shopId: string, period: string, k: number): Promise<AnalyticsSwipesResponse> {
  const { start, end } = monthBounds(period);
  const r = await frozen(db, shopId, 'swipes', '', period, async () => {
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
      // Server receive time, not the client's clock: an upload cannot be dated into an earlier month.
      .where(and(eq(swipeEvents.shopId, shopId), gte(swipeEvents.receivedAt, start), lt(swipeEvents.receivedAt, end)));
    return computeSwipes(
      rows.map((x) => ({ deviceId: x.deviceId, itemId: x.itemId, action: x.action, size: x.size, reasons: x.reasons, hue: hueBucket(x.colour), fabric: x.fabric ?? 'unknown' })),
      k,
      period,
    );
  });
  return underRaisedFloor(r, k, r.byProduct.length, { byProduct: [], byColour: [], byFabric: [], bySize: [] });
}

export async function fitSizeAnalytics(db: Db, shopId: string, period: string, k: number): Promise<AnalyticsFitSizesResponse> {
  const { start, end } = monthBounds(period);
  const r = await frozen(db, shopId, 'fit_sizes', '', period, async () => {
    const rows = await db
      .select({ deviceId: trySessions.deviceId, size: trySessions.recommendedSize })
      .from(trySessions)
      .where(and(eq(trySessions.shopId, shopId), isNotNull(trySessions.fitShownAt), gte(trySessions.fitShownAt, start), lt(trySessions.fitShownAt, end)));
    return computeFitSizes(rows, k, period);
  });
  return underRaisedFloor(r, k, r.bySize.length, { bySize: [], totals: { sessions: 0 } });
}

export async function abandonedAnalytics(db: Db, shopId: string, period: string, k: number): Promise<AnalyticsAbandonedResponse> {
  const { start, end } = monthBounds(period);
  const r = await frozen(db, shopId, 'abandoned', '', period, async () => {
    const rows = await db
      .select({
        externalId: products.externalId,
        deviceId: trySessions.deviceId,
        resolved: sql<boolean>`${trySessions.resolvedAt} is not null`,
        withFit: sql<boolean>`coalesce(${trySessions.billedAt}, ${trySessions.fitShownAt}) is not null`,
      })
      .from(trySessions)
      .innerJoin(products, eq(products.id, trySessions.productId))
      .where(and(eq(trySessions.shopId, shopId), gte(trySessions.createdAt, start), lt(trySessions.createdAt, end)));
    return computeAbandoned(rows, k, period);
  });
  return underRaisedFloor(r, k, r.byProduct.length, { byProduct: [], totals: { sessions: 0, resolved: 0, withFit: 0 } });
}

/**
 * GET /v1/fit/cohort/:productId — aggregated wardrobe states only (never signatures, v1). The cohort is the sum of
 * one floored cell per shop and closed month (by the row's last change), each frozen the first time it is counted.
 * Polling it therefore shows a change only when a whole month is added, and every month added cleared the floor.
 */
export async function fitCohort(
  db: Db,
  productId: string,
  shopId: string | undefined,
  k: number,
  /** Men's gate (`comingSoonShopIds`): cells of these shops are left out. */
  withoutShopIds: readonly string[],
  now: Date,
): Promise<FitCohortResponse> {
  const through = lastClosedMonth(now);
  const cutoff = monthBounds(through).end;
  const shopScope = shopId ? [eq(wardrobeItems.shopId, shopId)] : [];
  const live = await db
    .select({ deviceId: wardrobeItems.deviceId, shopId: wardrobeItems.shopId, size: wardrobeItems.size, state: wardrobeItems.state, updatedAt: wardrobeItems.updatedAt })
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.productId, productId), lt(wardrobeItems.updatedAt, cutoff), ...shopScope));
  const storedWhere = and(eq(analyticsSnapshots.kind, 'cohort'), eq(analyticsSnapshots.scope, productId), ...(shopId ? [eq(analyticsSnapshots.shopId, shopId)] : []));
  const readStored = () => db.select({ shopId: analyticsSnapshots.shopId, period: analyticsSnapshots.period, payload: analyticsSnapshots.payload }).from(analyticsSnapshots).where(storedWhere);
  let stored = await readStored();
  const have = new Set(stored.map((s) => `${s.shopId}|${s.period}`));
  const missing = new Map<string, { shopId: string; period: string; rows: CohortRow[] }>();
  for (const r of live) {
    const period = utcMonth(r.updatedAt);
    const key = `${r.shopId}|${period}`;
    if (have.has(key)) continue;
    const m = missing.get(key) ?? { shopId: r.shopId, period, rows: [] };
    m.rows.push({ deviceId: r.deviceId, size: r.size, state: r.state });
    missing.set(key, m);
  }
  if (missing.size) {
    await db
      .insert(analyticsSnapshots)
      .values([...missing.values()].map((m) => ({ shopId: m.shopId, kind: 'cohort' as const, scope: productId, period: m.period, payload: computeCohortCell(m.rows, k) })))
      .onConflictDoNothing();
    stored = await readStored();
  }
  const cells = stored.filter((s) => !withoutShopIds.includes(s.shopId)).map((s) => s.payload as CohortCell);
  return sumCohortCells(productId, cells, k, through);
}
