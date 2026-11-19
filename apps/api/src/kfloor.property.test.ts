/**
 * Property tests for launch-readiness finding 1: can a merchant (or anyone with a device token, for the cohort)
 * recover a group below the k floor by combining the answers they are allowed to ask for?
 *
 * The attacker model is linear and as strong as we can make it cheaply. Every number the server returns is a sum of
 * "atoms" (the finest cells: month × product × size × action and so on), so it is a vector over the atoms. The
 * attacker may add and subtract any of them, any number of times, across every allowed query (every month, every
 * scope, every cohort version as months are added), plus side knowledge a merchant really has: the grand totals per
 * month from the usage page. A group is recovered when its own vector lies in the span of all of that. We check this
 * with Gaussian elimination modulo a prime (if a vector is outside the span mod p, it is outside the span over the
 * rationals as well, so a pass here is a real pass).
 *
 * "Differencing any pair of allowed queries" and "subtracting cells from totals" are both special cases of such a
 * combination. Each property runs on many random shops (seeded, so a failure reproduces), and each has a negative
 * control: the old behaviour (arbitrary from/to, no complementary suppression) fed to the same attacker must leak,
 * which shows the attacker is strong enough to catch the bug this branch fixes.
 *
 * Not covered by the linear model (see the report): inference from non-negativity and bounds, rates (the cohort's
 * kept rate, which is a ratio of two counts of a group that already cleared the floor), and an attacker who creates
 * K−1 fake shoppers.
 */
import { describe, expect, it } from 'vitest';
import { WARDROBE_SIZE_UNKNOWN, type SwipeAction } from '@curtain/schema';
import { computeAbandoned, computeCohortCell, computeFitSizes, computeSwipes, sumCohortCells, type CohortCell, type SwipeRow } from './services/analytics.js';
import { addMonths, availableAt, closedMonthsSince, floorPartition, isClosed, lastClosedMonth, monthBounds, utcMonth } from './services/kfloor.js';

// ---- tools --------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
/** Skewed choice: early items are much more popular, so small groups appear often. */
const skewed = <T>(r: () => number, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(xs.length * r() * r()))]!;
const subsets = <T>(xs: readonly T[], max = 8): T[][] => {
  const items = xs.slice(0, max);
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
  return out;
};

const P = 1_000_003;
const mod = (a: number) => ((a % P) + P) % P;
function inv(a: number): number {
  let r = 1;
  let b = mod(a);
  for (let e = P - 2; e > 0; e >>= 1) {
    if (e & 1) r = (r * b) % P;
    b = (b * b) % P;
  }
  return r;
}

/** The atoms and everything the attacker knows about them. */
class Attacker {
  private index = new Map<string, number>();
  private basis: Array<{ pivot: number; row: Map<number, number> }> = [];
  atom(key: string): number {
    let i = this.index.get(key);
    if (i === undefined) this.index.set(key, (i = this.index.size));
    return i;
  }
  /** Atom keys matching a predicate (over the atoms seen so far). */
  atoms(pred: (key: string) => boolean): number[] {
    return [...this.index].filter(([k]) => pred(k)).map(([, i]) => i);
  }
  private reduce(v: Map<number, number>): Map<number, number> {
    const row = new Map(v);
    for (const b of this.basis) {
      const c = row.get(b.pivot);
      if (!c) continue;
      for (const [j, x] of b.row) {
        const y = mod((row.get(j) ?? 0) - c * x);
        if (y) row.set(j, y);
        else row.delete(j);
      }
    }
    return row;
  }
  /** Learn one published number: the sum of these atoms. */
  learn(atoms: readonly number[]): void {
    if (!atoms.length) return;
    const row = this.reduce(new Map(atoms.map((a) => [a, 1])));
    if (!row.size) return;
    const pivot = Math.min(...row.keys());
    const s = inv(row.get(pivot)!);
    for (const [j, x] of row) row.set(j, (x * s) % P);
    // keep the basis fully reduced so `reduce` is one pass
    for (const b of this.basis) {
      const c = b.row.get(pivot);
      if (!c) continue;
      for (const [j, x] of row) {
        const y = mod((b.row.get(j) ?? 0) - c * x);
        if (y) b.row.set(j, y);
        else b.row.delete(j);
      }
    }
    this.basis.push({ pivot, row });
  }
  private side = new Set<string>();
  /** Learn a number the merchant knows from elsewhere (not from the route under test). */
  sideKnowledge(atoms: readonly number[]): void {
    this.side.add([...atoms].sort((a, b) => a - b).join(','));
    this.learn(atoms);
  }
  isSideKnowledge(atoms: readonly number[]): boolean {
    return this.side.has([...atoms].sort((a, b) => a - b).join(','));
  }
  private count = new Map<number, number>();
  /** One real row in this atom (the attacker does not see these; they check that the model matches the server). */
  observe(atom: number): number {
    this.count.set(atom, (this.count.get(atom) ?? 0) + 1);
    return atom;
  }
  /** Rows in these atoms: a group with no rows holds nobody, and learning that it is empty reveals no one. */
  rows(atoms: readonly number[]): number {
    return atoms.reduce((n, a) => n + (this.count.get(a) ?? 0), 0);
  }
  /** Learn a published number, after checking that it really is the sum over these atoms. */
  learnValue(atoms: readonly number[], published: number, what: string): void {
    expect(atoms.reduce((n, a) => n + (this.count.get(a) ?? 0), 0), what).toBe(published);
    this.learn(atoms);
  }
  /** Can the attacker compute the sum over these atoms exactly? */
  knows(atoms: readonly number[]): boolean {
    return atoms.length > 0 && this.reduce(new Map(atoms.map((a) => [a, 1]))).size === 0;
  }
}

interface Target {
  label: string;
  atoms: number[];
  devices: number;
}
/**
 * Targets the attacker can compute although they hold fewer than k shoppers. A target that is exactly a piece of side
 * knowledge (a month's grand total, which the usage page shows anyway) is not a finding of these routes.
 */
const leaks = (att: Attacker, targets: readonly Target[], k: number): string[] => {
  const small = targets.filter((t) => t.atoms.length && att.rows(t.atoms) > 0 && t.devices < k && !att.isSideKnowledge(t.atoms));
  attacked.groups += small.length;
  return small.filter((t) => att.knows(t.atoms)).map((t) => `${t.label} (${t.devices} shoppers)`);
};
/** How many sub-floor groups the attacker tried, so a property cannot pass by having nothing to attack. */
const attacked = { groups: 0 };

const K = 5;
const RUNS = 120;
const MONTHS = ['2026-09', '2026-10'] as const;

// ---- swipes -------------------------------------------------------------------------------------

const ACTIONS: readonly SwipeAction[] = ['love', 'pass', 'save', 'less'];
interface SwipeEvent extends SwipeRow {
  month: string;
}
function swipeShop(seed: number) {
  const r = rng(seed);
  const products = Array.from({ length: 3 + Math.floor(r() * 4) }, (_, i) => `p${i}`);
  const sizes = ['XS', 'S', 'M', 'L'];
  const label = new Map(products.map((p) => [p, { hue: pick(r, ['red', 'blue', 'black']), fabric: pick(r, ['cotton', 'linen']) }]));
  const devices = Array.from({ length: 8 + Math.floor(r() * 30) }, (_, i) => `d${i}`);
  const events: SwipeEvent[] = [];
  for (let n = 20 + Math.floor(r() * 140); n > 0; n--) {
    const itemId = skewed(r, products);
    const size = r() < 0.1 ? null : skewed(r, sizes);
    events.push({ month: pick(r, MONTHS), deviceId: skewed(r, devices), itemId, action: pick(r, ACTIONS), size, reasons: null, ...label.get(itemId)! });
  }
  return { events, products, sizes, label };
}

const swipeAtom = (att: Attacker, e: { month: string; itemId: string; size: string | null; action: string }) => att.atom(`${e.month}|${e.itemId}|${e.size ?? '-'}|${e.action}`);
const parts = (key: string) => {
  const [month, item, size, action] = key.split('|') as [string, string, string, string];
  return { month, item, size, action };
};

interface Cellish {
  month: string;
  item: string;
  /** '-' for no size */
  size: string;
  action: string;
  hue: string;
  fabric: string;
}

/**
 * Groups worth protecting. A group is a predicate over cells; its vector is every atom of the full grid that matches
 * (empty atoms included), its shoppers are the devices of the rows that match `base`.
 */
function swipeTargets(att: Attacker, events: readonly SwipeEvent[], label: ReadonlyMap<string, { hue: string; fabric: string }>, hiddenProducts: Map<string, string[]>, hiddenSizes: Map<string, string[]>): Target[] {
  const groups: Array<{ label: string; pred: (c: Cellish) => boolean; base: (c: Cellish) => boolean }> = [];
  const add = (l: string, pred: (c: Cellish) => boolean, base = pred) => groups.push({ label: l, pred, base });
  const items = [...label.keys()];
  const sizes = [...new Set([...events.map((e) => e.size ?? '-'), '-'])];
  for (const m of MONTHS) {
    for (const p of items) {
      add(`${m} product ${p}`, (c) => c.month === m && c.item === p);
      for (const z of sizes) add(`${m} product ${p} size ${z}`, (c) => c.month === m && c.item === p && c.size === z);
      // Actions are measures of a product's group (D3): "1 of the 7 shoppers loved it" is a count inside a group
      // that cleared the floor. They are targets only where the product itself is below the floor.
      for (const a of ACTIONS) add(`${m} product ${p} ${a}`, (c) => c.month === m && c.item === p && c.action === a, (c) => c.month === m && c.item === p);
    }
    for (const z of sizes) add(`${m} size ${z} (all products)`, (c) => c.month === m && c.size === z);
    for (const h of new Set(events.map((e) => e.hue))) add(`${m} colour ${h}`, (c) => c.month === m && c.hue === h);
    for (const f of new Set(events.map((e) => e.fabric))) add(`${m} fabric ${f}`, (c) => c.month === m && c.fabric === f);
    // every union of hidden products, and of hidden size buckets inside one shown product
    for (const set of subsets(hiddenProducts.get(m) ?? [])) add(`${m} hidden products ${set.join('+')}`, (c) => c.month === m && set.includes(c.item));
    for (const [key, hs] of hiddenSizes) {
      const [hm, p] = key.split('|') as [string, string];
      if (hm !== m) continue;
      for (const set of subsets(hs)) add(`${m} product ${p} hidden sizes ${set.join('+')}`, (c) => c.month === m && c.item === p && set.includes(c.size));
    }
  }
  const ofAtom = (key: string): Cellish => {
    const x = parts(key);
    return { ...x, ...label.get(x.item)! };
  };
  const ofEvent = (e: SwipeEvent): Cellish => ({ month: e.month, item: e.itemId, size: e.size ?? '-', action: e.action, hue: e.hue, fabric: e.fabric });
  return groups.map((g) => ({
    label: g.label,
    atoms: att.atoms((k) => g.pred(ofAtom(k))),
    devices: new Set(events.filter((e) => g.base(ofEvent(e))).map((e) => e.deviceId)).size,
  }));
}

/** Everything a merchant learns from the swipes answers for every month, plus the usage-page style grand totals. */
function attackSwipes(seed: number, compute: typeof computeSwipes = computeSwipes, colourModel: 'shown' | 'all' = 'shown'): { leaked: string[]; shownBelowFloor: string[] } {
  const { events, label, products, sizes } = swipeShop(seed);
  const att = new Attacker();
  // The full grid, empty cells included: the attacker does not know which combinations never happened.
  for (const month of MONTHS) for (const itemId of products) for (const size of [...sizes, null]) for (const action of ACTIONS) swipeAtom(att, { month, itemId, size, action });
  for (const e of events) att.observe(swipeAtom(att, e));
  const hiddenProducts = new Map<string, string[]>();
  const hiddenSizes = new Map<string, string[]>();
  const shownBelowFloor: string[] = [];
  for (const m of MONTHS) {
    const rows = events.filter((e) => e.month === m);
    const res = compute(rows, K, m);
    const shown = new Set(res.byProduct.map((p) => p.externalId));
    hiddenProducts.set(m, [...new Set(rows.map((e) => e.itemId))].filter((p) => !shown.has(p)));
    const shownLeaves = new Set<string>();
    for (const p of res.byProduct) {
      const ds = new Set(rows.filter((e) => e.itemId === p.externalId).map((e) => e.deviceId));
      if (ds.size < K) shownBelowFloor.push(`${m} ${p.externalId}`);
      for (const a of ACTIONS) att.learnValue(att.atoms((k) => parts(k).month === m && parts(k).item === p.externalId && parts(k).action === a), p[a], `${m} ${p.externalId} ${a}`);
      for (const s of Object.keys(p.sizeHistogram)) {
        shownLeaves.add(`${p.externalId}|${s}`);
        const sd = new Set(rows.filter((e) => e.itemId === p.externalId && e.size === s).map((e) => e.deviceId));
        if (sd.size < K) shownBelowFloor.push(`${m} ${p.externalId} ${s}`);
        att.learnValue(att.atoms((k) => parts(k).month === m && parts(k).item === p.externalId && parts(k).size === s), p.sizeHistogram[s]!, `${m} ${p.externalId} size ${s}`);
      }
      hiddenSizes.set(
        `${m}|${p.externalId}`,
        [...new Set(rows.filter((e) => e.itemId === p.externalId).map((e) => e.size ?? '-'))].filter((s) => !(s in p.sizeHistogram)),
      );
    }
    const inColour = (item: string) => colourModel === 'all' || shown.has(item);
    for (const c of res.byColour) for (const a of ACTIONS) att.learnValue(att.atoms((k) => parts(k).month === m && inColour(parts(k).item) && label.get(parts(k).item)!.hue === c.hue && parts(k).action === a), c[a], `${m} colour ${c.hue} ${a}`);
    for (const f of res.byFabric) for (const a of ACTIONS) att.learnValue(att.atoms((k) => parts(k).month === m && shown.has(parts(k).item) && label.get(parts(k).item)!.fabric === f.fabric && parts(k).action === a), f[a], `${m} fabric ${f.fabric} ${a}`);
    for (const z of res.bySize) for (const a of ACTIONS) att.learnValue(att.atoms((k) => parts(k).month === m && shownLeaves.has(`${parts(k).item}|${parts(k).size}`) && parts(k).size === z.size && parts(k).action === a), z[a], `${m} size ${z.size} ${a}`);
    // side knowledge: this month's grand totals, overall and per action
    att.sideKnowledge(att.atoms((k) => parts(k).month === m));
    for (const a of ACTIONS) att.sideKnowledge(att.atoms((k) => parts(k).month === m && parts(k).action === a));
    // the published numbers themselves agree with the atoms
    expect(res.byProduct.reduce((n, p) => n + p.love + p.pass + p.save + p.less, 0)).toBe(rows.filter((e) => shown.has(e.itemId)).length);
  }
  return { leaked: leaks(att, swipeTargets(att, events, label, hiddenProducts, hiddenSizes), K), shownBelowFloor };
}

// ---- fit-shown sizes ----------------------------------------------------------------------------

const FIT_SIZES = ['6', '8', '10', '12', '14', '16'];
function fitSizeShop(seed: number) {
  const r = rng(seed);
  const devices = Array.from({ length: 6 + Math.floor(r() * 30) }, (_, i) => `d${i}`);
  const sizes = FIT_SIZES;
  const days = Array.from({ length: 10 }, (_, i) => i + 1);
  return Array.from({ length: 15 + Math.floor(r() * 120) }, () => ({
    month: pick(r, MONTHS),
    day: pick(r, days),
    deviceId: r() < 0.05 ? null : skewed(r, devices),
    size: r() < 0.08 ? null : skewed(r, sizes),
  }));
}

function attackFitSizes(seed: number, compute: typeof computeFitSizes = computeFitSizes): string[] {
  const rows = fitSizeShop(seed);
  const att = new Attacker();
  const atom = (x: { month: string; size: string | null }) => att.atom(`${x.month}|${x.size ?? '-'}`);
  for (const month of MONTHS) for (const size of [...FIT_SIZES, null]) atom({ month, size });
  for (const x of rows) att.observe(atom(x));
  const targets: Target[] = [];
  for (const m of MONTHS) {
    const mine = rows.filter((x) => x.month === m);
    const res = compute(mine, K, m);
    for (const s of res.bySize) att.learnValue([att.atom(`${m}|${s.size}`)], s.sessions, `${m} size ${s.size}`);
    att.learnValue(res.bySize.map((s) => att.atom(`${m}|${s.size}`)), res.totals.sessions, `${m} total`);
    att.sideKnowledge(att.atoms((k) => k.startsWith(`${m}|`))); // the usage page's session count
    const cells = [...FIT_SIZES, '-'];
    const hidden = cells.filter((c) => !res.bySize.some((s) => s.size === c));
    for (const set of [...cells.map((c) => [c]), ...subsets(hidden)]) {
      const g = mine.filter((x) => set.includes(x.size ?? '-'));
      targets.push({ label: `${m} sizes ${set.join('+')}`, atoms: set.map((z) => att.atom(`${m}|${z}`)), devices: new Set(g.map((x) => x.deviceId).filter(Boolean)).size });
    }
  }
  return leaks(att, targets, K);
}

/** The behaviour before this branch: any from/to (here: every range of days), floor without complementary suppression. */
function attackFitSizesLegacy(seed: number): string[] {
  const rows = fitSizeShop(seed).map((x) => ({ ...x, month: '2026-10' }));
  const att = new Attacker();
  const atom = (x: { day: number; size: string | null }) => att.atom(`${x.day}|${x.size ?? '-'}`);
  for (let day = 1; day <= 10; day++) for (const size of [...FIT_SIZES, null]) atom({ day, size });
  for (const x of rows) att.observe(atom(x));
  for (let a = 1; a <= 10; a++)
    for (let b = a; b <= 10; b++) {
      const win = rows.filter((x) => x.day >= a && x.day <= b && x.size);
      for (const s of new Set(win.map((x) => x.size!))) {
        const g = win.filter((x) => x.size === s);
        if (new Set(g.map((x) => x.deviceId).filter(Boolean)).size >= K) att.learn([...new Set(g.map(atom))]);
      }
    }
  const targets: Target[] = [];
  for (let d = 1; d <= 10; d++)
    for (const s of new Set(rows.map((x) => x.size).filter(Boolean))) {
      const g = rows.filter((x) => x.day === d && x.size === s);
      targets.push({ label: `day ${d} size ${s}`, atoms: [atom({ day: d, size: s! })], devices: new Set(g.map((x) => x.deviceId).filter(Boolean)).size });
    }
  return leaks(att, targets, K);
}

// ---- abandoned opens ----------------------------------------------------------------------------

function attackAbandoned(seed: number): string[] {
  const r = rng(seed);
  const devices = Array.from({ length: 6 + Math.floor(r() * 25) }, (_, i) => `d${i}`);
  const products = ['a', 'b', 'c', 'd', 'e'];
  const rows = Array.from({ length: 10 + Math.floor(r() * 100) }, () => {
    const resolved = r() < 0.7;
    return { month: pick(r, MONTHS), externalId: skewed(r, products), deviceId: resolved ? skewed(r, devices) : null, resolved, withFit: resolved && r() < 0.6 };
  });
  const att = new Attacker();
  const atom = (x: Omit<(typeof rows)[number], 'deviceId'>) => att.atom(`${x.month}|${x.externalId}|${x.resolved ? 1 : 0}|${x.withFit ? 1 : 0}`);
  // full grid; a fit without a resolution cannot happen, and the attacker knows it
  for (const month of MONTHS) for (const externalId of products) for (const [resolved, withFit] of [[false, false], [true, false], [true, true]] as const) atom({ month, externalId, resolved, withFit });
  for (const x of rows) att.observe(atom(x));
  const targets: Target[] = [];
  for (const m of MONTHS) {
    const mine = rows.filter((x) => x.month === m);
    const res = computeAbandoned(mine, K, m);
    const of = (p: string, f: (k: string[]) => boolean) => att.atoms((key) => key.startsWith(`${m}|${p}|`) && f(key.split('|')));
    for (const p of res.byProduct) {
      att.learnValue(of(p.externalId, () => true), p.sessions, `${m} ${p.externalId} sessions`);
      att.learnValue(of(p.externalId, (k) => k[2] === '1'), p.resolved, `${m} ${p.externalId} resolved`);
      att.learnValue(of(p.externalId, (k) => k[3] === '1'), p.withFit, `${m} ${p.externalId} withFit`);
    }
    att.sideKnowledge(att.atoms((k) => k.startsWith(`${m}|`))); // every open this month
    att.sideKnowledge(att.atoms((k) => k.startsWith(`${m}|`) && k.endsWith('|1'))); // every fit this month (usage page)
    const hidden = products.filter((p) => !res.byProduct.some((x) => x.externalId === p));
    for (const set of [...products.map((p) => [p]), ...subsets(hidden)]) {
      const g = mine.filter((x) => set.includes(x.externalId));
      const devices = new Set(g.map((x) => x.deviceId).filter(Boolean)).size;
      targets.push({ label: `${m} products ${set.join('+')}`, atoms: att.atoms((k) => k.startsWith(`${m}|`) && set.includes(k.split('|')[1]!)), devices });
      // what share of a hidden group got a fit, or resolved, is as private as its size
      targets.push({ label: `${m} products ${set.join('+')} fits`, atoms: att.atoms((k) => k.startsWith(`${m}|`) && set.includes(k.split('|')[1]!) && k.endsWith('|1')), devices });
    }
  }
  return leaks(att, targets, K);
}

// ---- cohort -------------------------------------------------------------------------------------

const COHORT_MONTHS = ['2026-07', '2026-08', '2026-09', '2026-10'];
const COHORT_SIZES = ['S', 'M', 'L', 'XL', WARDROBE_SIZE_UNKNOWN];
function cohortShop(seed: number) {
  const r = rng(seed);
  const shops = ['s1', 's2'];
  const devices = Array.from({ length: 6 + Math.floor(r() * 30) }, (_, i) => `d${i}`);
  const sizes = COHORT_SIZES;
  // one row per (device, shop) for the product, as in wardrobe_items, dated by its last change
  const rows: Array<{ month: string; shop: string; deviceId: string; size: string; state: string }> = [];
  for (const shop of shops) for (const d of devices) if (r() < 0.6) rows.push({ month: skewed(r, COHORT_MONTHS), shop, deviceId: d, size: skewed(r, sizes), state: pick(r, ['kept', 'returned', 'saved']) });
  return rows;
}

function attackCohort(seed: number, legacy = false): string[] {
  const rows = cohortShop(seed);
  const att = new Attacker();
  const atom = (x: { month: string; shop: string; size: string }) => att.atom(`${x.month}|${x.shop}|${x.size}`);
  for (const month of COHORT_MONTHS) for (const shop of ['s1', 's2']) for (const size of COHORT_SIZES) atom({ month, shop, size });
  for (const x of rows) att.observe(atom(x));
  const scopes = [['s1'], ['s2'], ['s1', 's2']];
  if (legacy) {
    // before: live over all rows so far (a poll after each month), n always shown, buckets floored, no complement
    for (let t = 0; t < COHORT_MONTHS.length; t++)
      for (const scope of scopes) {
        const g = rows.filter((x) => COHORT_MONTHS.indexOf(x.month) <= t && scope.includes(x.shop));
        att.learn([...new Set(g.map(atom))]);
        for (const s of new Set(g.map((x) => x.size)))
          if (s !== WARDROBE_SIZE_UNKNOWN && g.filter((x) => x.size === s).length >= K) att.learn([...new Set(g.filter((x) => x.size === s).map(atom))]);
      }
  } else {
    const cells = new Map<string, CohortCell>();
    for (const m of COHORT_MONTHS) for (const shop of ['s1', 's2']) cells.set(`${m}|${shop}`, computeCohortCell(rows.filter((x) => x.month === m && x.shop === shop), K));
    for (let t = 0; t < COHORT_MONTHS.length; t++)
      for (const scope of scopes) {
        const inScope = [...cells].filter(([key]) => COHORT_MONTHS.indexOf(key.split('|')[0]!) <= t && scope.includes(key.split('|')[1]!));
        const res = sumCohortCells('p', inScope.map(([, c]) => c), K, COHORT_MONTHS[t]!);
        const shownCells = inScope.filter(([, c]) => c.n > 0).map(([key]) => key);
        att.learnValue(att.atoms((k) => shownCells.some((c) => k.startsWith(`${c}|`))), res.n, `cohort n through ${COHORT_MONTHS[t]}`);
        for (const [z, v] of Object.entries(res.sizeHistogram))
          att.learnValue(att.atoms((k) => shownCells.some((c) => k.startsWith(`${c}|`) && cells.get(c)!.sizeHistogram[z] !== undefined) && k.endsWith(`|${z}`)), v, `cohort ${z} through ${COHORT_MONTHS[t]}`);
      }
  }
  const targets: Target[] = [];
  const group = (label: string, pred: (x: { month: string; shop: string; size: string }) => boolean) => {
    const atoms = att.atoms((k) => {
      const [month, shop, size] = k.split('|') as [string, string, string];
      return pred({ month, shop, size });
    });
    targets.push({ label, atoms, devices: new Set(rows.filter(pred).map((x) => x.deviceId)).size });
  };
  for (const shop of ['s1', 's2']) {
    for (const z of COHORT_SIZES) group(`${shop} size ${z} (all months)`, (x) => x.shop === shop && x.size === z);
    for (const m of COHORT_MONTHS) {
      group(`${shop} ${m}`, (x) => x.shop === shop && x.month === m);
      for (const set of subsets(COHORT_SIZES)) group(`${shop} ${m} sizes ${set.join('+')}`, (x) => x.shop === shop && x.month === m && set.includes(x.size));
    }
  }
  for (const z of COHORT_SIZES) group(`size ${z} (all shops, all months)`, (x) => x.size === z);
  return leaks(att, targets, K);
}

// ---- the properties ------------------------------------------------------------------------------

describe('kfloor: no sub-floor group is recoverable from any combination of allowed answers', () => {
  it('swipes: products, nested sizes, colour, fabric and size tables across months, plus the grand totals', () => {
    attacked.groups = 0;
    for (let seed = 1; seed <= RUNS; seed++) {
      const { leaked, shownBelowFloor } = attackSwipes(seed);
      expect(shownBelowFloor, `seed ${seed}`).toEqual([]);
      expect(leaked, `seed ${seed}`).toEqual([]);
    }
    expect(attacked.groups).toBeGreaterThan(RUNS * 10);
  });

  it('fit-shown sizes: every month, the shown sizes, their total and the usage page count', () => {
    attacked.groups = 0;
    for (let seed = 1; seed <= RUNS; seed++) expect(attackFitSizes(seed), `seed ${seed}`).toEqual([]);
    expect(attacked.groups).toBeGreaterThan(RUNS * 2);
  });

  it('abandoned opens: every month, per product sessions, resolutions and fits, plus all opens and all fits', () => {
    attacked.groups = 0;
    for (let seed = 1; seed <= RUNS; seed++) expect(attackAbandoned(seed), `seed ${seed}`).toEqual([]);
    expect(attacked.groups).toBeGreaterThan(RUNS * 2);
  });

  it('cohort: every version as months are added, for each shop and for all shops together', () => {
    attacked.groups = 0;
    for (let seed = 1; seed <= RUNS; seed++) expect(attackCohort(seed), `seed ${seed}`).toEqual([]);
    expect(attacked.groups).toBeGreaterThan(RUNS * 2);
  });

  it('negative controls: the same attacker recovers small groups from the old behaviour', () => {
    let fitLeaks = 0;
    let cohortLeaks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      fitLeaks += attackFitSizesLegacy(seed).length;
      cohortLeaks += attackCohort(seed, true).length;
    }
    expect(fitLeaks).toBeGreaterThan(0);
    expect(cohortLeaks).toBeGreaterThan(0);
  });

  it('negative controls: each rule is needed (no complementary suppression; colour over every product)', () => {
    // floor only: every size with k shoppers is shown, the rest dropped
    const floorOnly: typeof computeFitSizes = (rows, k, period) => {
      const res = computeFitSizes(rows, 1, period);
      const bySize = res.bySize.filter((x) => new Set(rows.filter((r) => r.size === x.size && r.deviceId).map((r) => r.deviceId)).size >= k);
      return { ...res, kAnonymityFloor: k, bySize, totals: { sessions: bySize.reduce((n, x) => n + x.sessions, 0) } };
    };
    // colour counted over every product, as before this branch, while the product table hides small products
    const colourOverAll: typeof computeSwipes = (rows, k, period) => {
      const res = computeSwipes(rows, k, period);
      const all = computeSwipes(rows, 1, period);
      return { ...res, byColour: all.byColour };
    };
    let fit = 0;
    let colour = 0;
    for (let seed = 1; seed <= 60; seed++) {
      fit += attackFitSizes(seed, floorOnly).length;
      colour += attackSwipes(seed, colourOverAll, 'all').leaked.length;
    }
    expect(fit).toBeGreaterThan(0);
    expect(colour).toBeGreaterThan(0);
  });

  it('negative control: without complementary suppression, total minus the shown cells is a hidden group', () => {
    // two sizes clear the floor, one person is hidden; the usage page tells the merchant the month's total
    const rows = [...Array.from({ length: 5 }, (_, i) => ({ deviceId: `m${i}`, size: 'M' })), ...Array.from({ length: 5 }, (_, i) => ({ deviceId: `l${i}`, size: 'L' })), { deviceId: 'x', size: 'XL' }];
    const res = computeFitSizes(rows, K, '2026-10');
    expect(rows.length - res.totals.sessions).toBeGreaterThanOrEqual(K + 1); // the remainder holds XL and one whole size
    expect(res.suppression).toEqual({ belowFloor: 1, complementary: 1 });
  });
});

describe('kfloor: the periods themselves', () => {
  it('two allowed periods either are the same month or share no instant', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const t = Date.UTC(2024, 0, 1) + Math.floor(r() * 4 * 365 * 86_400_000);
      const m = utcMonth(new Date(t));
      const { start, end } = monthBounds(m);
      expect(start.getTime() <= t && t < end.getTime()).toBe(true);
      // the instant belongs to no other month
      expect(t < monthBounds(addMonths(m, 1)).start.getTime() && t >= monthBounds(addMonths(m, -1)).end.getTime()).toBe(true);
      const other = addMonths(m, 1 + Math.floor(r() * 30));
      const o = monthBounds(other);
      expect(o.start.getTime() >= end.getTime()).toBe(true);
    }
    expect(monthBounds('2028-02')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthBounds('2026-12').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(() => monthBounds('2026-13')).toThrow();
  });

  it('a month is servable only after it ended plus the grace day; the newest servable month is never open', () => {
    const r = rng(11);
    for (let i = 0; i < 2000; i++) {
      const now = new Date(Date.UTC(2025, 0, 1) + Math.floor(r() * 2 * 365 * 86_400_000));
      const last = lastClosedMonth(now);
      expect(isClosed(last, now)).toBe(true);
      expect(isClosed(addMonths(last, 1), now)).toBe(false);
      expect(availableAt(addMonths(last, 1)).getTime()).toBeGreaterThan(now.getTime());
      expect(monthBounds(last).end.getTime()).toBeLessThanOrEqual(now.getTime() - 86_400_000);
    }
    const now = new Date('2026-11-19T12:00:00Z');
    expect(closedMonthsSince(new Date('2026-08-15T00:00:00Z'), now)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(lastClosedMonth(new Date('2026-12-01T23:59:59Z'))).toBe('2026-10');
    expect(lastClosedMonth(new Date('2026-12-02T00:00:00Z'))).toBe('2026-11');
  });

  it('floorPartition: shown cells clear k; the hidden remainder holds at least k shoppers or nothing', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed);
      const cells = Array.from({ length: 1 + Math.floor(r() * 7) }, (_, i) => {
        const n = Math.floor(r() * r() * 14);
        const devices = new Set(Array.from({ length: n }, () => `d${Math.floor(r() * 25)}`));
        return { key: `c${i}`, devices, rows: devices.size + Math.floor(r() * 3), neverPublish: r() < 0.1 };
      });
      const f = floorPartition(cells, K);
      for (const key of f.published) expect(cells.find((c) => c.key === key)!.devices.size).toBeGreaterThanOrEqual(K);
      const hiddenCells = cells.filter((c) => !f.published.includes(c.key) && c.rows > 0);
      const remainder = new Set(hiddenCells.flatMap((c) => [...c.devices]));
      if (f.published.length) expect(hiddenCells.length === 0 || remainder.size >= K, `seed ${seed}`).toBe(true);
      expect(f.remainderDevices).toBe(remainder.size);
    }
  });
});
