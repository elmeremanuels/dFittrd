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
 * - The shopper's choice of units (cm/kg or in/lb), `pref:units`, once they pick one. Like the
 *   profile it is only written with "Remember me" on, and "Forget me" clears it. Without a choice
 *   the embed follows the browser's locale.
 * - The skin colour the shopper picked for the avatar (avatar prompt, D19) is kept in MEMORY ONLY
 *   by default: it is gone when the window closes. Skin colour can be read as data about ethnic
 *   origin, the published privacy policy does not mention it, and whether it may be saved under
 *   the on-by-default "Remember me" is a decision for the founder and counsel
 *   (docs/legal/avatar-consent-copy.md, gaps 6 and 8). `persistLooks` (the build flag
 *   `VITE_AVATAR_REMEMBER_LOOK=1`) switches the stored variant on: then `look:<shop id>`, per shop,
 *   only with "Remember me" on, encrypted with a non-extractable AES-GCM key that lives in this
 *   database (`lookkey`). The key keeps other sites out, not another person on this device.
 *   Switching the colour off, "Remember me" off and "Forget me" each delete it. Without WebCrypto
 *   the colour stays in memory only. It is never sent anywhere.
 *   Every write and delete that touches a look row runs on one queue, in the order it was asked
 *   for, so a slow save can never land after the delete that followed it.
 * - If IndexedDB is unavailable (blocked third-party storage, private mode) everything stays in
 *   memory and the page still works.
 */
import Dexie, { type Table } from 'dexie';
import type { BodyProfile, DeviceTokenResponse } from '@curtain/schema';
import type { DeviceCredentials } from '@/api/client';
import { decryptBytes, encryptBytes, generateFrameKey, type EncryptedBytes } from '@/features/capture/crypto';
import type { AboutForm } from './aboutYou';
import { parseLook, type SkinLook } from './look';
import { isUnits, type Units } from './units';

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
/** The shopper's explicit choice of units. */
export const UNITS_PREF_KEY = 'pref:units';
const profileKey = (shopId: string): string => `profile:${shopId}`;
const LOOK_PREFIX = 'look:';
const lookKey = (shopId: string): string => `${LOOK_PREFIX}${shopId}`;
/** The non-extractable AES-GCM key of the look rows. Exists only while a look is stored. */
export const LOOK_CRYPTO_KEY = 'lookkey';

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
  /**
   * Is any profile remembered in this browser partition? A local read only, no network: the size
   * peek (`/embed/peek`) asks this before it contacts the api at all, so a shopper who never
   * entered measurements on this shop causes no request beyond the peek page itself.
   */
  hasProfiles(): Promise<boolean>;
  saveProfile(p: RememberedProfile): Promise<void>;
  /** The units the shopper chose on this shop (null: never chose, follow the locale). */
  loadUnits(): Promise<Units | null>;
  saveUnits(units: Units): Promise<void>;
  /** The skin colour the shopper picked for the avatar on this shop (null: the standard colour). */
  loadLook(shopId: string): Promise<SkinLook | null>;
  /** Does this store save the picked colour on the device (with "Remember me" on)? Default: no, memory only. */
  readonly persistsLooks: boolean;
  /** Keeps the look in memory; only with `persistsLooks` and "Remember me" on is it also stored, encrypted, for this shop. */
  saveLook(shopId: string, look: SkinLook): Promise<void>;
  /** The colour is switched off: gone from memory and from this device. */
  clearLook(shopId: string): Promise<void>;
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
  /**
   * Save the picked skin colour on the device under "Remember me" (C30). Default false: memory
   * only, until the founder and counsel have decided (consent copy, gap 6).
   */
  persistLooks?: boolean;
}

/** The build flag of the stored skin colour. Default off: the colour lives in memory only. */
export function lookStorageEnabled(env: { VITE_AVATAR_REMEMBER_LOOK?: string } = import.meta.env): boolean {
  return env.VITE_AVATAR_REMEMBER_LOOK === '1';
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
  const persistLooks = options.persistLooks ?? false;
  const factory = options.openDb === undefined ? (indexedDbAvailable() ? () => new EmbedDb() : null) : options.openDb;
  let db: EmbedDb | null = null;
  let dbBroken = false;
  let device: DeviceCredentials = NO_DEVICE;
  const profiles = new Map<string, RememberedProfile>();
  let units: Units | null = null;
  const looks = new Map<string, SkinLook>();
  /** Shared by every caller, so a second `init()` (StrictMode, retry) waits for the same read. */
  let loading: Promise<void> | null = null;
  /**
   * One queue for everything that writes or deletes a look row (and the wipes that take the rows
   * with them). Memory is changed at once, by the caller; the database follows in call order.
   */
  let lookQueue: Promise<void> = Promise.resolve();
  const queued = (job: () => Promise<void>): Promise<void> => {
    const run = lookQueue.then(job, job);
    lookQueue = run.catch(() => undefined);
    return run;
  };
  let staleLooksPurged = false;

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

  /** The look rows' key; created on the first stored look. Null: no WebCrypto, or no database. */
  const lookCryptoKey = async (create: boolean): Promise<CryptoKey | null> => {
    const row = await safe((d) => d.kv.get(LOOK_CRYPTO_KEY));
    const stored = row?.value;
    if (stored && typeof stored === 'object' && (stored as CryptoKey).type === 'secret') return stored as CryptoKey;
    if (!create) return null;
    try {
      const key = await generateFrameKey();
      const ok = await safe(async (d) => {
        await d.kv.put({ key: LOOK_CRYPTO_KEY, value: key });
        return true;
      });
      return ok ? key : null;
    } catch {
      return null;
    }
  };

  /**
   * Writes what memory holds for this shop now, not what the caller held when it asked: a colour
   * that was switched off, forgotten or replaced meanwhile is not written. Only ever called from
   * inside the queue.
   */
  const persistLook = async (shopId: string): Promise<void> => {
    if (!persistLooks || !remember || !looks.has(shopId)) return;
    const key = await lookCryptoKey(true);
    if (!key) return;
    const look = looks.get(shopId);
    if (!look || !remember) return;
    let enc: EncryptedBytes;
    try {
      enc = await encryptBytes(key, new TextEncoder().encode(JSON.stringify(look)));
    } catch {
      return;
    }
    // Checked again right before the put: the colour may have gone while the key was made.
    if (!remember || looks.get(shopId) !== look) return;
    await safe((d) => d.kv.put({ key: lookKey(shopId), value: enc }));
  };

  const deleteLookRows = async (shopId: string | null): Promise<void> => {
    if (shopId === null) await safe((d) => d.kv.where('key').startsWith(LOOK_PREFIX).delete());
    else await safe((d) => d.kv.delete(lookKey(shopId)));
    const left = await safe((d) => d.kv.where('key').startsWith(LOOK_PREFIX).count());
    if (left === 0) await safe((d) => d.kv.delete(LOOK_CRYPTO_KEY));
  };

  const writeAll = async (): Promise<void> => {
    const rows: KvRow[] = [];
    if (device.token) rows.push({ key: DEVICE_KEY, value: device });
    for (const p of profiles.values()) rows.push({ key: profileKey(p.shopId), value: p });
    if (units) rows.push({ key: UNITS_PREF_KEY, value: units });
    if (rows.length > 0) await safe((d) => d.kv.bulkPut(rows));
    for (const shopId of Array.from(looks.keys())) await persistLook(shopId);
  };

  return {
    get remember() {
      return remember;
    },
    persistsLooks: persistLooks,
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
    async hasProfiles() {
      if (profiles.size > 0) return true;
      if (!remember) return false;
      const n = await safe((d) => d.kv.where('key').startsWith('profile:').count());
      return (n ?? 0) > 0;
    },
    async saveProfile(p) {
      profiles.set(p.shopId, p);
      if (remember) await safe((d) => d.kv.put({ key: profileKey(p.shopId), value: p }));
    },
    async loadUnits() {
      if (units || !remember) return units;
      const row = await safe((d) => d.kv.get(UNITS_PREF_KEY));
      const v = row?.value;
      if (isUnits(v)) units = v;
      return units;
    },
    async saveUnits(u) {
      units = u;
      if (remember) await safe((d) => d.kv.put({ key: UNITS_PREF_KEY, value: u }));
    },
    async loadLook(shopId) {
      const mem = looks.get(shopId);
      if (mem) return mem;
      if (!persistLooks) {
        // Memory only: a row left by a build that did store the colour is removed, never read.
        if (!staleLooksPurged) {
          staleLooksPurged = true;
          await queued(() => deleteLookRows(null));
        }
        return null;
      }
      if (!remember) return null;
      // After the queue: a save that is still on its way is read, not missed.
      await lookQueue;
      const row = await safe((d) => d.kv.get(lookKey(shopId)));
      const enc = row?.value as EncryptedBytes | undefined;
      if (!enc || enc.alg !== 'AES-GCM') return null;
      const key = await lookCryptoKey(false);
      if (!key) return null;
      try {
        const look = parseLook(JSON.parse(new TextDecoder().decode(await decryptBytes(key, enc))));
        if (look && !looks.has(shopId)) looks.set(shopId, look);
        return looks.get(shopId) ?? null;
      } catch {
        return null;
      }
    },
    saveLook(shopId, look) {
      looks.set(shopId, look);
      return queued(() => persistLook(shopId));
    },
    clearLook(shopId) {
      looks.delete(shopId);
      return queued(() => deleteLookRows(shopId));
    },
    setRemember(on) {
      if (on === remember) return Promise.resolve();
      remember = on;
      return queued(async () => {
        // A later call may have changed it again before this one's turn: act on what holds now.
        if (remember !== on) return;
        if (on) {
          await safe((d) => d.kv.delete(REMEMBER_PREF_KEY));
          await writeAll();
        } else {
          await safe((d) => d.kv.clear());
          await safe((d) => d.kv.put({ key: REMEMBER_PREF_KEY, value: false }));
        }
      });
    },
    forget() {
      device = NO_DEVICE;
      profiles.clear();
      units = null;
      looks.clear();
      return queued(async () => {
        await safe((d) => d.kv.clear());
        // Forgetting the data keeps the shopper's choice not to be remembered.
        if (!remember) await safe((d) => d.kv.put({ key: REMEMBER_PREF_KEY, value: false }));
      });
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
