/**
 * The k-anonymity floor with protection against differencing (launch-readiness finding 1). Pure: no database, no
 * clock, so the property tests in `kfloor.property.test.ts` can attack it directly.
 *
 * Three rules, together:
 *
 * 1. **Fixed, disjoint periods.** Merchant analytics and cohort cells cover one calendar month in UTC. There is no
 *    from/to, so two allowed queries either cover the same month or share no row at all. Subtracting one answer from
 *    another can only ever give back a whole month's answer, which was floored on its own.
 * 2. **Closed and frozen.** A month is served only after it ended (plus a grace period for sessions that resolve
 *    after midnight), and its first answer is stored and served from then on (`analytics_snapshots`). Asking again
 *    after a shopper was erased, or after a late upload, returns the same numbers, so "before minus after" is zero.
 * 3. **Complementary suppression.** Inside one answer a cell is shown only with at least K distinct shoppers, and the
 *    hidden cells of a table together hold at least K distinct shoppers (or nothing). If the small hidden cells hold
 *    fewer, the smallest shown cells are hidden as well until they do. A total from anywhere (the usage page, a sum
 *    of rows) minus the shown cells therefore only ever reveals a group of at least K shoppers.
 *
 * Derived tables (colour, fabric, size over all products) are sums of shown cells only, so they add no new
 * information: every number a merchant receives is a sum of shown cells and hidden remainders that each clear K.
 */
import { DAY } from '../lib/time.js';
import { ANALYTICS_PERIOD_GRACE_HOURS } from '@curtain/schema';

export type HiddenReason = 'below_floor' | 'complementary';

export interface FloorCell<K extends string = string> {
  key: K;
  /** Distinct pseudonymous shoppers in the cell. */
  devices: ReadonlySet<string>;
  /** Rows in the cell (sessions, swipes). Rows without a known shopper still make the cell a hidden group. */
  rows: number;
  /** Never shown on its own (for example "no size given"): always part of the hidden remainder, never reported. */
  neverPublish?: boolean;
}

export interface FloorResult<K extends string = string> {
  /** Shown cells, in input order. */
  published: K[];
  /** Hidden cells and why (cells marked `neverPublish` are hidden but not listed). */
  hidden: Map<K, HiddenReason>;
  /** Distinct shoppers in the hidden remainder: 0 (nothing hidden) or at least k, unless everything is hidden. */
  remainderDevices: number;
}

/** One table, one floor: shown cells clear k on their own, hidden cells together clear k (or are empty). */
export function floorPartition<K extends string>(cells: readonly FloorCell<K>[], k: number): FloorResult<K> {
  const hidden = new Map<K, HiddenReason>();
  const remainder = new Set<string>();
  let remainderRows = 0;
  const shown: FloorCell<K>[] = [];
  for (const c of cells) {
    if (c.rows === 0 && c.devices.size === 0) continue;
    if (c.neverPublish || c.devices.size < k) {
      if (!c.neverPublish) hidden.set(c.key, 'below_floor');
      for (const d of c.devices) remainder.add(d);
      remainderRows += c.rows;
    } else shown.push(c);
  }
  // Complementary suppression: hide the smallest shown cells until the hidden remainder holds k shoppers.
  const bySmallest = [...shown].sort((a, b) => a.devices.size - b.devices.size || a.rows - b.rows || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  while (remainderRows > 0 && remainder.size < k && bySmallest.length) {
    const c = bySmallest.shift()!;
    hidden.set(c.key, 'complementary');
    for (const d of c.devices) remainder.add(d);
    remainderRows += c.rows;
  }
  return { published: shown.filter((c) => !hidden.has(c.key)).map((c) => c.key), hidden, remainderDevices: remainder.size };
}

export function countReasons(...results: ReadonlyArray<{ hidden: ReadonlyMap<string, HiddenReason> }>): { belowFloor: number; complementary: number } {
  const out = { belowFloor: 0, complementary: 0 };
  for (const r of results)
    for (const reason of r.hidden.values()) {
      if (reason === 'below_floor') out.belowFloor++;
      else out.complementary++;
    }
  return out;
}

// ---- calendar months ------------------------------------------------------------------------------

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const PERIOD_GRACE_MS = ANALYTICS_PERIOD_GRACE_HOURS * 3_600_000;

export const utcMonth = (d: Date): string => d.toISOString().slice(0, 7);

/** [start, end) of a month in UTC, plus its first and last day for display. */
export function monthBounds(period: string): { start: Date; end: Date; from: string; to: string } {
  const m = MONTH_RE.exec(period);
  if (!m) throw new RangeError(`not a month: ${period}`);
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  return { start, end, from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - DAY).toISOString().slice(0, 10) };
}

export const addMonths = (period: string, n: number): string => {
  const { start } = monthBounds(period);
  return utcMonth(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1)));
};

/** A month may be served once it is over and the grace period has passed. */
export const isClosed = (period: string, now: Date): boolean => monthBounds(period).end.getTime() + PERIOD_GRACE_MS <= now.getTime();

/** The newest month that may be served at `now`. */
export function lastClosedMonth(now: Date): string {
  let p = utcMonth(now);
  while (!isClosed(p, now)) p = addMonths(p, -1);
  return p;
}

/** When a month becomes servable. */
export const availableAt = (period: string): Date => new Date(monthBounds(period).end.getTime() + PERIOD_GRACE_MS);

/** Closed months from `since` (inclusive) to the newest closed one, newest first, at most `max`. */
export function closedMonthsSince(since: Date, now: Date, max = 24): string[] {
  const first = utcMonth(since);
  const out: string[] = [];
  for (let p = lastClosedMonth(now); p >= first && out.length < max; p = addMonths(p, -1)) out.push(p);
  return out;
}
