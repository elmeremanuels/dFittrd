/**
 * The ONE on-device database (IndexedDB via Dexie, name `paskamer`), shared with the capture
 * feature. Version 1 (capture, `features/capture/storage.ts`) holds bodyProfile / baseFrame /
 * faceTile / silhouette / keys; version 2 (this file) adds the app tables listed in
 * docs/ARCHITECTURE.md: taste, wardrobe, swipes, outbox, ledger, settings, pendingIntent, renders.
 * Nothing in here is ever synced as-is; the sync layer reads `outbox` only.
 */
import type { EntityTable } from 'dexie';
import type { GarmentPayload, ShopBranding, SwipeEvent, WardrobeState } from '@paskamer/schema';
import type { OutboxEntry, TasteState } from '@paskamer/taste-engine';
import { PaskamerDb, setDb } from '@/features/capture/storage';

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

export type OutboxKind = 'swipe' | 'save' | 'signature' | 'wardrobe';

export interface OutboxRow {
  seq?: number;
  kind: OutboxKind;
  /** Idempotency key (SwipeWireEvent.clientId / wardrobe productId / 'signature'). */
  clientId: string;
  shopId: string | null;
  payload: OutboxEntry | { productId: string; shopId: string; size: string; state: WardrobeState } | { version: 1; vector: number[]; quality: number };
  intentToken?: string;
  attempts: number;
  nextAt: number;
  createdAt: number;
  lastError?: string;
}

export interface ClientLedgerEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: 'signature_sync' | 'swipe_batch' | 'wardrobe_sync' | 'hero_render' | 'pairing' | 'erase' | 'device' | 'export';
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

export class AppDb extends PaskamerDb {
  taste!: EntityTable<TasteRow, 'id'>;
  wardrobe!: EntityTable<WardrobeRow, 'productId'>;
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
  }
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
