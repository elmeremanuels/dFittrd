/**
 * The ONE on-device database (IndexedDB via Dexie, name `curtain`), shared with the capture
 * feature. Version 1 (capture, `features/capture/storage.ts`) holds bodyProfile / baseFrame /
 * faceTile / silhouette / keys; version 2 (this file) adds the app tables listed in
 * docs/ARCHITECTURE.md: taste, wardrobe, swipes, outbox, ledger, settings, pendingIntent, renders.
 * Version 3 namespaces item ids by shop (carry-over #22): the wardrobe moves to `wardrobeItems`
 * keyed by [shopId+productId], the taste seen memory is re-keyed `<shopId>:<itemId>` and wardrobe
 * outbox rows get the shop in their clientId. Version 4 drops the old `wardrobe` table (Dexie
 * cannot change a primary key in place, so the copy and the drop are two versions).
 * Nothing in here is ever synced as-is; the sync layer reads `outbox` only.
 */
import type { EntityTable, Table, Transaction } from 'dexie';
import type { GarmentPayload, ShopBranding, SwipeEvent, WardrobeState } from '@curtain/schema';
import { itemKey, SEEN_FOREVER, type OutboxEntry, type TasteState } from '@curtain/taste-engine';
import { CurtainDb, setDb } from '@/features/capture/storage';

export const SINGLETON_ID = 'current';
export const RENDERS_LRU = 50;

export interface TasteRow {
  id: string;
  state: TasteState;
  updatedAt: number;
}

export interface WardrobeRow {
  productId: string;
  shopId: string;
  /** Size label, or `WARDROBE_SIZE_UNKNOWN` when no size was known at save time (#24). */
  size: string;
  state: WardrobeState;
  updatedAt: number;
  /** Snapshot for offline display (name, brand, colour, price). */
  garment: Pick<GarmentPayload, 'id' | 'name' | 'brand' | 'primaryColorHex' | 'priceEur' | 'category' | 'productUrl'>;
}

export interface SwipeRow {
  seq?: number;
  event: SwipeEvent;
  shopId: string;
  clientId: string;
  intentToken?: string;
}

/** `signature_delete`: "Delete my scan" on the server (PRIV-1); retried until a 2xx, never dropped after N attempts. */
export type OutboxKind = 'swipe' | 'save' | 'signature' | 'signature_delete' | 'wardrobe';

export interface OutboxRow {
  seq?: number;
  kind: OutboxKind;
  /** Idempotency key (SwipeWireEvent.clientId / `wardrobeClientId(shopId, productId)` / 'signature' / 'signature:delete'). */
  clientId: string;
  shopId: string | null;
  payload: OutboxEntry | WardrobeOutboxPayload | { version: 1; vector: number[]; quality: number } | null;
  intentToken?: string;
  attempts: number;
  nextAt: number;
  createdAt: number;
  lastError?: string;
}

export interface WardrobeOutboxPayload {
  productId: string;
  shopId: string;
  /** Size label or `WARDROBE_SIZE_UNKNOWN` (same convention as `WardrobePutRequest.size`). */
  size: string;
  state: WardrobeState;
}

/** Outbox idempotency key of a wardrobe row: one pending PUT per (shop, product). */
export function wardrobeClientId(shopId: string, productId: string): string {
  return `wardrobe:${shopId}:${productId}`;
}

export interface ClientLedgerEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: 'signature_sync' | 'swipe_batch' | 'wardrobe_sync' | 'hero_render' | 'pairing' | 'erase' | 'device' | 'export' | 'fit';
  method: 'POST' | 'PUT' | 'DELETE' | 'GET';
  path: string;
  bytes: number;
  /** Top-level field names that were sent — never values. */
  fields: string[];
  status: number | 'failed';
}

export type ConsentTier = 'avatar' | 'heroOptIn';

export interface SettingsRow {
  id: string;
  onboarded: boolean;
  consentTier: ConsentTier;
  consentAcknowledgedAt: string | null;
  /** Taste-engine season key (camelCase) or null — on-device estimate, user-confirmable. */
  season: string | null;
  undertone: 'warm' | 'cool' | 'neutral' | null;
  skinHex: string | null;
  vibes: string[];
  deviceId: string | null;
  deviceToken: string | null;
  deviceTokenExpiresAt: string | null;
  signatureSyncedAt: string | null;
  pairedShops: ShopBranding[];
  updatedAt: number;
}

export interface PendingIntentRow {
  id: string;
  token: string;
  createdAt: number;
}

export interface RenderRow {
  id: string;
  at: number;
  blob: Blob;
  size: string | null;
  garmentId: string;
}

/** Primary key of a wardrobe row: [shopId, productId] (an item id is only unique within one shop). */
export type WardrobeKey = [string, string];

export class AppDb extends CurtainDb {
  taste!: EntityTable<TasteRow, 'id'>;
  /** The `wardrobeItems` table (v3+), keyed by [shopId+productId]. */
  wardrobe!: Table<WardrobeRow, WardrobeKey>;
  swipes!: EntityTable<SwipeRow, 'seq'>;
  outbox!: EntityTable<OutboxRow, 'seq'>;
  ledger!: EntityTable<ClientLedgerEntry, 'id'>;
  settings!: EntityTable<SettingsRow, 'id'>;
  pendingIntent!: EntityTable<PendingIntentRow, 'id'>;
  renders!: EntityTable<RenderRow, 'id'>;

  constructor(name?: string) {
    super(name);
    this.version(2).stores({
      // capture stores (v1) are kept unchanged by Dexie
      taste: 'id',
      wardrobe: 'productId, state, updatedAt',
      swipes: '++seq, clientId, [shopId+seq]',
      outbox: '++seq, kind, nextAt, clientId',
      ledger: 'id, at',
      settings: 'id',
      pendingIntent: 'id',
      renders: 'id, at, garmentId',
    });
    this.version(3)
      .stores({ wardrobeItems: '[shopId+productId], productId, shopId, state, updatedAt' })
      .upgrade((tx) => migrateToShopKeys(tx));
    this.version(4).stores({ wardrobe: null });
    // `db.wardrobe` keeps its name for callers; the rows live in `wardrobeItems` now.
    this.wardrobe = this.table('wardrobeItems');
  }
}

/** Wardrobe key of a row. */
export function wardrobeKey(row: Pick<WardrobeRow, 'shopId' | 'productId'>): WardrobeKey {
  return [row.shopId, row.productId];
}

/**
 * Seen-memory keys written before v3 are bare item ids. Each is re-keyed with the shop of the
 * latest local swipe on that id (the `swipes` table keeps the shop of every swipe); a bare id
 * swiped in two shops is re-keyed for both. Ids with no local swipe are dropped: at worst that
 * item is dealt once more.
 */
export function migrateSeen(seen: Readonly<Record<string, number>>, shopsByItem: ReadonlyMap<string, ReadonlySet<string>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, at] of Object.entries(seen)) {
    const shops = shopsByItem.get(key);
    if (!shops || shops.size === 0) continue;
    for (const shopId of shops) {
      const k = itemKey(shopId, key);
      const prev = out[k];
      // keep the strongest memory: SEEN_FOREVER beats a pass; a later pass beats an earlier one
      out[k] = prev === undefined ? at : prev === SEEN_FOREVER || at === SEEN_FOREVER ? SEEN_FOREVER : Math.max(prev, at);
    }
  }
  return out;
}

/** v2 → v3 (carry-over #22, #24): wardrobe rows, taste seen memory and wardrobe outbox ids get the shop. */
export async function migrateToShopKeys(tx: Transaction): Promise<void> {
  const oldWardrobe = (await tx.table('wardrobe').toArray()) as WardrobeRow[];
  // A stored "ONE" stays: it may be a real one-size label, and nothing tells the two apart now.
  await tx.table('wardrobeItems').bulkPut(oldWardrobe);

  const shopsByItem = new Map<string, Set<string>>();
  await tx
    .table('swipes')
    .toCollection()
    .each((row: SwipeRow) => {
      const set = shopsByItem.get(row.event.itemId) ?? new Set<string>();
      set.add(row.shopId);
      shopsByItem.set(row.event.itemId, set);
    });
  for (const w of oldWardrobe) {
    const set = shopsByItem.get(w.productId) ?? new Set<string>();
    set.add(w.shopId);
    shopsByItem.set(w.productId, set);
  }
  await tx
    .table('taste')
    .toCollection()
    .modify((row: TasteRow) => {
      if (!row.state?.seen) return;
      row.state = { ...row.state, seen: migrateSeen(row.state.seen, shopsByItem) };
    });

  await tx
    .table('outbox')
    .toCollection()
    .modify((row: OutboxRow) => {
      if (row.kind !== 'wardrobe' || !row.shopId) return;
      const p = row.payload as WardrobeOutboxPayload | null;
      if (p && typeof p.productId === 'string') row.clientId = wardrobeClientId(row.shopId, p.productId);
    });
}

let shared: AppDb | null = null;

/** Singleton; also registered with the capture feature so it opens the same connection. */
export function getAppDb(): AppDb {
  if (!shared) {
    shared = new AppDb();
    setDb(shared);
  }
  return shared;
}

/** Tests inject their own instance (fake-indexeddb). */
export function setAppDb(db: AppDb | null): void {
  shared = db;
  if (db) setDb(db);
}

export async function putRenderLru(db: AppDb, row: RenderRow): Promise<void> {
  await db.transaction('rw', db.renders, async () => {
    await db.renders.put(row);
    const count = await db.renders.count();
    if (count > RENDERS_LRU) {
      const oldest = await db.renders.orderBy('at').limit(count - RENDERS_LRU).primaryKeys();
      await db.renders.bulkDelete(oldest);
    }
  });
}

/** Wipe every app table (not the capture stores — `deleteScan()` owns those). */
export async function clearAppTables(db: AppDb): Promise<void> {
  await db.transaction('rw', [db.taste, db.wardrobe, db.swipes, db.outbox, db.ledger, db.settings, db.pendingIntent, db.renders], async () => {
    await Promise.all([
      db.taste.clear(),
      db.wardrobe.clear(),
      db.swipes.clear(),
      db.outbox.clear(),
      db.ledger.clear(),
      db.settings.clear(),
      db.pendingIntent.clear(),
      db.renders.clear(),
    ]);
  });
}
