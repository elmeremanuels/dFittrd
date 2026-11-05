/**
 * The embed's own on-device storage (docs/STANDALONE.md §1.3.7, §2).
 *
 * - A separate IndexedDB database, `curtain-embed`, never the app's `curtain` database. Inside a
 *   merchant page the browser partitions it per top-level site, so each shop is its own island.
 * - Memory is always the source of truth. With "Remember me" on (the default) every write is
 *   mirrored to IndexedDB; with it off nothing is written and the database is wiped.
 * - Profiles are keyed by shop id as well, so even a browser without storage partitioning never
 *   shows one shop's remembered profile on another shop.
 * - Stored: the anonymous device token, and per shop the body profile + the About-you answers.
 *   No photo, no frame, no scan media is ever stored here.
 * - Turning "Remember me" off is itself remembered (UX-1 / F2 / SEC-3): one non-personal row,
 *   `pref:remember = false`, read by `init()` before anything else, so the next visit starts with
 *   the switch off and writes nothing. Turning it back on removes the row.
 * - If IndexedDB is unavailable (blocked third-party storage, private mode) everything stays in
 *   memory and the page still works.
 */
import Dexie, { type Table } from 'dexie';
import type { BodyProfile, DeviceTokenResponse } from '@curtain/schema';
import type { DeviceCredentials } from '@/api/client';
import type { AboutForm } from './aboutYou';

export const EMBED_DB_NAME = 'curtain-embed';

export interface RememberedProfile {
  shopId: string;
  profile: BodyProfile;
  about: AboutForm;
  savedAt: number;
}

interface KvRow {
  key: string;
  value: unknown;
}

export class EmbedDb extends Dexie {
  kv!: Table<KvRow, string>;
  constructor(name = EMBED_DB_NAME) {
    super(name);
    this.version(1).stores({ kv: 'key' });
  }
}

const DEVICE_KEY = 'device';
/** The shopper's opt-out of "Remember me". Holds no personal data. */
export const REMEMBER_PREF_KEY = 'pref:remember';
const profileKey = (shopId: string): string => `profile:${shopId}`;

const NO_DEVICE: DeviceCredentials = { deviceId: null, token: null, expiresAt: null };

export interface EmbedStore {
  readonly remember: boolean;
  /** Load the device token from IndexedDB (if any). Safe to call more than once. */
  init(): Promise<void>;
  getDevice(): DeviceCredentials;
  setDevice(d: Pick<DeviceTokenResponse, 'deviceId' | 'token' | 'expiresAt'>): Promise<void>;
  /** Re-reads the remembered device (another embed tab of this shop may have rotated it, AUTH-1). */
  reloadDevice(): Promise<DeviceCredentials>;
  loadProfile(shopId: string): Promise<RememberedProfile | null>;
  saveProfile(p: RememberedProfile): Promise<void>;
  /** Off → wipe IndexedDB (memory keeps working); on → write what is in memory. */
  setRemember(on: boolean): Promise<void>;
  /** Forget me: wipe memory and IndexedDB. */
  forget(): Promise<void>;
  /** For tests and diagnostics: which personal rows (device, profiles) are persisted right now? The opt-out flag is not listed. */
  persistedKeys(): Promise<string[]>;
}

export interface EmbedStoreOptions {
  /**
   * Forces the initial setting (tests). When omitted, the default is on unless the shopper turned it
   * off on an earlier visit (the stored opt-out, read by `init()`).
   */
  remember?: boolean;
  /** Factory for the database; null forces memory-only (no IndexedDB in this browser/context). */
  openDb?: (() => EmbedDb) | null;
}

function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function createEmbedStore(options: EmbedStoreOptions = {}): EmbedStore {
  let remember = options.remember ?? true;
  const factory = options.openDb === undefined ? (indexedDbAvailable() ? () => new EmbedDb() : null) : options.openDb;
  let db: EmbedDb | null = null;
  let dbBroken = false;
  let device: DeviceCredentials = NO_DEVICE;
  const profiles = new Map<string, RememberedProfile>();
  /** Shared by every caller, so a second `init()` (StrictMode, retry) waits for the same read. */
  let loading: Promise<void> | null = null;

  const getDb = (): EmbedDb | null => {
    if (dbBroken || !factory) return null;
    if (!db) {
      try {
        db = factory();
      } catch {
        dbBroken = true;
        return null;
      }
    }
    return db;
  };

  /** Run an IndexedDB operation; any failure flips us to memory-only for the rest of the page. */
  const safe = async <T>(fn: (d: EmbedDb) => Promise<T>): Promise<T | null> => {
    const d = getDb();
    if (!d) return null;
    try {
      return await fn(d);
    } catch {
      dbBroken = true;
      return null;
    }
  };

  const writeAll = async (): Promise<void> => {
    const rows: KvRow[] = [];
    if (device.token) rows.push({ key: DEVICE_KEY, value: device });
    for (const p of profiles.values()) rows.push({ key: profileKey(p.shopId), value: p });
    if (rows.length > 0) await safe((d) => d.kv.bulkPut(rows));
  };

  return {
    get remember() {
      return remember;
    },
    init() {
      // A boolean "loaded" flag would let a concurrent second caller run on before the device
      // token is read: it then registers a fresh device and resolves the try link with it, and
      // the remembered device's resolve gets 409 already_resolved ("expired" for a returning shopper).
      loading ??= (async () => {
        if (options.remember === undefined) {
          const pref = await safe((d) => d.kv.get(REMEMBER_PREF_KEY));
          if (pref?.value === false) remember = false;
        }
        if (!remember) return;
        const row = await safe((d) => d.kv.get(DEVICE_KEY));
        const v = row?.value as DeviceCredentials | undefined;
        if (v && typeof v.token === 'string' && v.token.length > 0 && !device.token) device = { deviceId: v.deviceId ?? null, token: v.token, expiresAt: v.expiresAt ?? null };
      })();
      return loading;
    },
    getDevice() {
      return device;
    },
    async reloadDevice() {
      if (!remember) return device;
      const row = await safe((d) => d.kv.get(DEVICE_KEY));
      const v = row?.value as DeviceCredentials | undefined;
      if (v && typeof v.token === 'string' && v.token.length > 0) device = { deviceId: v.deviceId ?? null, token: v.token, expiresAt: v.expiresAt ?? null };
      return device;
    },
    async setDevice(d) {
      device = d.token ? { deviceId: d.deviceId || null, token: d.token, expiresAt: d.expiresAt } : { deviceId: d.deviceId || device.deviceId, token: null, expiresAt: null };
      if (!remember) return;
      if (device.token) await safe((db) => db.kv.put({ key: DEVICE_KEY, value: device }));
      else await safe((db) => db.kv.delete(DEVICE_KEY));
    },
    async loadProfile(shopId) {
      const mem = profiles.get(shopId);
      if (mem) return mem;
      if (!remember) return null;
      const row = await safe((d) => d.kv.get(profileKey(shopId)));
      const v = row?.value as RememberedProfile | undefined;
      if (!v || v.shopId !== shopId || !v.profile || !v.about) return null;
      profiles.set(shopId, v);
      return v;
    },
    async saveProfile(p) {
      profiles.set(p.shopId, p);
      if (remember) await safe((d) => d.kv.put({ key: profileKey(p.shopId), value: p }));
    },
    async setRemember(on) {
      if (on === remember) return;
      remember = on;
      if (on) {
        await safe((d) => d.kv.delete(REMEMBER_PREF_KEY));
        await writeAll();
      } else {
        await safe((d) => d.kv.clear());
        await safe((d) => d.kv.put({ key: REMEMBER_PREF_KEY, value: false }));
      }
    },
    async forget() {
      device = NO_DEVICE;
      profiles.clear();
      await safe((d) => d.kv.clear());
      // Forgetting the data keeps the shopper's choice not to be remembered.
      if (!remember) await safe((d) => d.kv.put({ key: REMEMBER_PREF_KEY, value: false }));
    },
    async persistedKeys() {
      const keys = await safe((d) => d.kv.toCollection().primaryKeys());
      return (keys ?? [])
        .map(String)
        .filter((k) => k !== REMEMBER_PREF_KEY)
        .sort();
    },
  };
}
