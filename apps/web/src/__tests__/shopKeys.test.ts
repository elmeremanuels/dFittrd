/**
 * Carry-over #22 (item ids namespaced by shop in the app) and #24 (an unknown wardrobe size is
 * explicit, never "ONE"): store, local database migration and the cohort call.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_GARMENTS_BY_ID, WARDROBE_SIZE_UNKNOWN } from '@curtain/schema';
import { emptyState, SEEN_FOREVER } from '@curtain/taste-engine';
import { AppDb, migrateSeen, setAppDb, SINGLETON_ID, wardrobeClientId } from '@/db/db';
import { createAppStore, MOCK_SHOP_ID } from '@/store/store';
import { ApiClient, withoutUnknownSize } from '@/api/client';

const PROFILE = {
  version: 1 as const,
  measurements: {
    height: { mean: 168, sigma: 1, source: 'manual' as const },
    bust: { mean: 88, sigma: 1.5, source: 'manual' as const },
    waist: { mean: 70, sigma: 1.5, source: 'manual' as const },
    hip: { mean: 96, sigma: 1.5, source: 'manual' as const },
  },
};
const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';
const WRAP = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;

let dbName = '';
let db: AppDb;

beforeEach(() => {
  dbName = `curtain-keys-${Math.random().toString(36).slice(2)}`;
  db = new AppDb(dbName);
  setAppDb(db);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(dbName);
  setAppDb(null);
});

describe('#22 the same item id in two shops is two items', () => {
  const inA = { ...WRAP, brand: 'Shop A' };
  const inB = { ...WRAP, brand: 'Shop B' };

  it('a love in shop A leaves the shop-B item in the deck', async () => {
    const store = createAppStore({ db, catalog: [{ garment: inA, shopId: SHOP_A }, { garment: inB, shopId: SHOP_B }] });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    store.getState().dealNext();
    const first = store.getState().deck.current!;
    expect(first.garment.shopId).toBe(SHOP_A);
    await store.getState().swipe('love');
    expect(store.getState().taste.seen[`${SHOP_A}:${WRAP.id}`]).toBe(SEEN_FOREVER);
    expect(store.getState().taste.seen[`${SHOP_B}:${WRAP.id}`]).toBeUndefined();
    // the deck advanced to the same id, from shop B
    const next = store.getState().deck.current!;
    expect(next.garment.id).toBe(WRAP.id);
    expect(next.garment.shopId).toBe(SHOP_B);
    expect(store.getState().shopIdFor(next.garment)).toBe(SHOP_B);
  });

  it('shopIdFor never guesses: an id two shops share is ambiguous without the object', async () => {
    const store = createAppStore({ db, catalog: [{ garment: inA, shopId: SHOP_A }, { garment: inB, shopId: SHOP_B }] });
    await store.getState().hydrate();
    expect(store.getState().shopIdFor(inA)).toBe(SHOP_A);
    expect(store.getState().shopIdFor({ ...WRAP })).toBeNull();
    expect(store.getState().shopIdFor({ ...WRAP, shopId: SHOP_B } as typeof WRAP)).toBe(SHOP_B);
    // a swipe that cannot be attributed is not recorded at all
    expect(await store.getState().swipe('love', { garment: { ...WRAP } })).toBeNull();
    expect(store.getState().taste.profile.swipeCount).toBe(0);
    expect(await db.swipes.count()).toBe(0);
  });

  it('shopIdFor resolves an id that only one shop has, without the object', async () => {
    const other = MOCK_GARMENTS_BY_ID['raw-denim-01']!;
    const store = createAppStore({ db, catalog: [{ garment: inA, shopId: SHOP_A }, { garment: other, shopId: SHOP_B }] });
    expect(store.getState().shopIdFor({ ...other })).toBe(SHOP_B);
    expect(store.getState().shopIdFor({ ...MOCK_GARMENTS_BY_ID['monochrome-02']! })).toBeNull();
  });

  it('the wardrobe keeps one row per shop and item; states and outbox ids are per shop', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().saveToWardrobe(inA, SHOP_A, 'M');
    await store.getState().saveToWardrobe(inB, SHOP_B, 'L');
    expect(store.getState().wardrobe).toHaveLength(2);
    expect(await db.wardrobe.count()).toBe(2);
    await store.getState().setWardrobeState(SHOP_B, WRAP.id, 'bought');
    expect(store.getState().wardrobe.find((w) => w.shopId === SHOP_A)?.state).toBe('saved');
    expect(store.getState().wardrobe.find((w) => w.shopId === SHOP_B)?.state).toBe('bought');
    expect((await db.wardrobe.get([SHOP_B, WRAP.id]))?.state).toBe('bought');
    const ids = (await db.outbox.where('kind').equals('wardrobe').toArray()).map((r) => r.clientId).sort();
    expect(ids).toEqual([wardrobeClientId(SHOP_A, WRAP.id), wardrobeClientId(SHOP_B, WRAP.id), wardrobeClientId(SHOP_B, WRAP.id)].sort());
    expect(wardrobeClientId(SHOP_A, WRAP.id)).toBe(`wardrobe:${SHOP_A}:${WRAP.id}`);

    const db2 = new AppDb(dbName);
    const again = createAppStore({ db: db2 });
    await again.getState().hydrate();
    expect(again.getState().wardrobe.map((w) => `${w.shopId}:${w.state}`).sort()).toEqual([`${SHOP_A}:saved`, `${SHOP_B}:bought`]);
    db2.close();
  });
});

describe('#24 an unknown size is stored and sent as the explicit marker', () => {
  it('saving without measurements stores "unknown", never "ONE", and teaches the fit history nothing', async () => {
    const store = createAppStore({ db, catalog: [{ garment: WRAP, shopId: SHOP_A }] });
    await store.getState().hydrate();
    store.getState().dealNext();
    await store.getState().swipe('save');
    const row = store.getState().wardrobe[0]!;
    expect(row.size).toBe(WARDROBE_SIZE_UNKNOWN);
    const out = await db.outbox.where('kind').equals('wardrobe').first();
    expect(out?.payload).toMatchObject({ productId: WRAP.id, shopId: SHOP_A, size: WARDROBE_SIZE_UNKNOWN, state: 'saved' });

    await store.getState().setProfile(PROFILE);
    await store.getState().setWardrobeState(SHOP_A, WRAP.id, 'kept');
    expect(store.getState().profile?.history ?? []).toEqual([]);
  });

  it('a real size is kept as is', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().saveToWardrobe(WRAP, MOCK_SHOP_ID, 'ONE');
    await store.getState().saveToWardrobe(MOCK_GARMENTS_BY_ID['raw-denim-01']!, MOCK_SHOP_ID, null);
    expect(store.getState().wardrobe.map((w) => w.size).sort()).toEqual(['ONE', WARDROBE_SIZE_UNKNOWN]);
  });
});

describe('#22 migration of a version-2 database', () => {
  async function seedV2(name: string): Promise<void> {
    const legacy = new Dexie(name);
    legacy.version(1).stores({ bodyProfile: 'id', baseFrame: 'id', faceTile: 'id', silhouette: 'id', keys: 'id' });
    legacy.version(2).stores({
      taste: 'id',
      wardrobe: 'productId, state, updatedAt',
      swipes: '++seq, clientId, [shopId+seq]',
      outbox: '++seq, kind, nextAt, clientId',
      ledger: 'id, at',
      settings: 'id',
      pendingIntent: 'id',
      renders: 'id, at, garmentId',
    });
    await legacy.open();
    const garment = { id: WRAP.id, name: WRAP.name, brand: WRAP.brand, primaryColorHex: WRAP.primaryColorHex, priceEur: WRAP.priceEur, category: WRAP.category };
    await legacy.table('wardrobe').put({ productId: WRAP.id, shopId: SHOP_A, size: 'M', state: 'kept', updatedAt: 5, garment });
    const ev = (itemId: string, action: string) => ({ itemId, action, at: 1, sizeAtSwipe: null, fitScore: null, dealIndex: 0 });
    await legacy.table('swipes').bulkAdd([
      { event: ev(WRAP.id, 'save'), shopId: SHOP_A, clientId: 'c1' },
      { event: ev('raw-denim-01', 'pass'), shopId: SHOP_A, clientId: 'c2' },
      { event: ev('raw-denim-01', 'pass'), shopId: SHOP_B, clientId: 'c3' },
    ]);
    await legacy.table('taste').put({ id: SINGLETON_ID, state: { ...emptyState(), seen: { [WRAP.id]: SEEN_FOREVER, 'raw-denim-01': 3, 'never-swiped-here': 4 } }, updatedAt: 1 });
    await legacy.table('outbox').bulkAdd([
      { kind: 'wardrobe', clientId: `wardrobe:${WRAP.id}`, shopId: SHOP_A, payload: { productId: WRAP.id, shopId: SHOP_A, size: 'M', state: 'kept' }, attempts: 0, nextAt: 0, createdAt: 0 },
      { kind: 'swipe', clientId: 'c3', shopId: SHOP_B, payload: ev('raw-denim-01', 'pass'), attempts: 0, nextAt: 0, createdAt: 0 },
    ]);
    legacy.close();
  }

  it('moves the wardrobe to [shopId+productId], re-keys the seen memory and the wardrobe outbox ids', async () => {
    db.close();
    await Dexie.delete(dbName);
    await seedV2(dbName);
    db = new AppDb(dbName);
    setAppDb(db);
    await db.open();
    expect(db.verno).toBe(4);
    expect(db.tables.map((t) => t.name)).not.toContain('wardrobe');
    expect(await db.wardrobe.get([SHOP_A, WRAP.id])).toMatchObject({ size: 'M', state: 'kept' });

    const taste = await db.taste.get(SINGLETON_ID);
    expect(taste?.state.seen).toEqual({ [`${SHOP_A}:${WRAP.id}`]: SEEN_FOREVER, [`${SHOP_A}:raw-denim-01`]: 3, [`${SHOP_B}:raw-denim-01`]: 3 });

    const outbox = await db.outbox.toArray();
    expect(outbox.find((r) => r.kind === 'wardrobe')?.clientId).toBe(wardrobeClientId(SHOP_A, WRAP.id));
    expect(outbox.find((r) => r.kind === 'swipe')?.clientId).toBe('c3');

    const store = createAppStore({ db });
    await store.getState().hydrate();
    expect(store.getState().wardrobe).toHaveLength(1);
    expect(store.getState().taste.seen[`${SHOP_A}:${WRAP.id}`]).toBe(SEEN_FOREVER);
  });

  it('migrateSeen keeps the strongest memory when two bare keys meet', () => {
    const shops = new Map([['x', new Set([SHOP_A])]]);
    expect(migrateSeen({ x: 9 }, shops)).toEqual({ [`${SHOP_A}:x`]: 9 });
    expect(migrateSeen({ x: SEEN_FOREVER }, shops)).toEqual({ [`${SHOP_A}:x`]: SEEN_FOREVER });
    expect(migrateSeen({ y: 1 }, shops)).toEqual({});
  });
});

describe('cohort calls carry the shop and skip the unknown size', () => {
  it('GET /v1/fit/cohort/:productId?shopId=… and drops the "unknown" bucket', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ productId: 'p 1', n: 12, kAnonymityFloor: 5, sizeHistogram: { M: 6, unknown: 6 }, keptRate: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getDevice: () => ({ deviceId: 'd', token: 't', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }),
      setDevice: () => undefined,
      onLedger: () => undefined,
    });
    const res = await client.fitCohort('p 1', SHOP_A);
    expect(urls[0]).toBe(`https://api.test/v1/fit/cohort/p%201?shopId=${SHOP_A}`);
    expect(res.sizeHistogram).toEqual({ M: 6 });
    const same = { productId: 'p', n: 0, kAnonymityFloor: 5, sizeHistogram: { S: 5 }, keptRate: null };
    expect(withoutUnknownSize(same)).toBe(same);
  });
});
