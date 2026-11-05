/**
 * On-device persistence (Dexie, IndexedDB database `paskamer`). DECISIONS.md D3:
 *   - `bodyProfile`  — the fused BodyProfile (never synced)
 *   - `baseFrame`    — ONE front frame with the background replaced, AES-GCM encrypted with a
 *                      non-extractable WebCrypto key held in the `keys` store
 *   - `faceTile`     — the identity tile (face crop, background removed; AES-GCM encrypted with the
 *                      same key — it is a face image) + the skin estimate
 *   - `silhouette`   — the front/side category masks (compact Uint8Array) for render path B
 *   - `keys`         — CryptoKey objects (structured-cloned, non-extractable)
 * `deleteScan()` clears every store in ONE transaction. No video frame is ever written.
 */
import Dexie, { type EntityTable } from 'dexie';
import { BodyProfileSchema, type BodyProfile } from '@paskamer/schema';
import { decryptToBlob, encryptBlob, generateFrameKey, type EncryptedBytes } from './crypto';
import type { SkinEstimate } from './types';

export const DB_NAME = 'paskamer';
const SINGLETON = 'current';
const FRAME_KEY_ID = 'baseFrame';

interface BodyProfileRow {
  id: string;
  profile: BodyProfile;
  updatedAt: number;
}

interface BaseFrameRow {
  id: string;
  iv: Uint8Array;
  data: ArrayBuffer;
  alg: 'AES-GCM';
  mimeType: string;
  width: number;
  height: number;
  updatedAt: number;
}

interface FaceTileRow {
  id: string;
  /** Encrypted tile (current format). */
  iv?: Uint8Array | undefined;
  data?: ArrayBuffer | undefined;
  alg?: 'AES-GCM' | undefined;
  /** Plaintext tile written by the first build; still readable, re-encrypted on the next save. */
  blob?: Blob | undefined;
  mimeType: string;
  skin: SkinEstimate | null;
  updatedAt: number;
}

export interface SilhouetteMask {
  width: number;
  height: number;
  data: Uint8Array;
}

interface SilhouetteRow {
  id: string;
  front: SilhouetteMask | null;
  side: SilhouetteMask | null;
  updatedAt: number;
}

interface KeyRow {
  id: string;
  key: CryptoKey;
  createdAt: number;
}

export class PaskamerDb extends Dexie {
  bodyProfile!: EntityTable<BodyProfileRow, 'id'>;
  baseFrame!: EntityTable<BaseFrameRow, 'id'>;
  faceTile!: EntityTable<FaceTileRow, 'id'>;
  silhouette!: EntityTable<SilhouetteRow, 'id'>;
  keys!: EntityTable<KeyRow, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      bodyProfile: 'id',
      baseFrame: 'id',
      faceTile: 'id',
      silhouette: 'id',
      keys: 'id',
    });
  }
}

let shared: PaskamerDb | null = null;

/** Lazily opened singleton; tests may pass their own instance to every function. */
export function getDb(): PaskamerDb {
  if (!shared) shared = new PaskamerDb();
  return shared;
}

/**
 * Let the app register its own (subclassed, higher-version) instance of the `paskamer` database
 * before any capture code opens it, so both share ONE IndexedDB connection and version. The app's
 * subclass must keep the five stores above unchanged (see apps/web/src/db/db.ts).
 */
export function setDb(db: PaskamerDb): void {
  shared = db;
}

export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export async function saveBodyProfile(profile: BodyProfile, db: PaskamerDb = getDb()): Promise<void> {
  const parsed = BodyProfileSchema.parse(profile);
  await db.bodyProfile.put({ id: SINGLETON, profile: parsed, updatedAt: Date.now() });
}

export async function loadBodyProfile(db: PaskamerDb = getDb()): Promise<BodyProfile | null> {
  const row = await db.bodyProfile.get(SINGLETON);
  if (!row) return null;
  const r = BodyProfileSchema.safeParse(row.profile);
  return r.success ? r.data : null;
}

async function getOrCreateFrameKey(db: PaskamerDb): Promise<CryptoKey> {
  const row = await db.keys.get(FRAME_KEY_ID);
  if (row) return row.key;
  const key = await generateFrameKey();
  await db.keys.put({ id: FRAME_KEY_ID, key, createdAt: Date.now() });
  return key;
}

/** Encrypt and store the single base frame (background already replaced by the worker). */
export async function saveBaseFrame(blob: Blob, size: { width: number; height: number }, db: PaskamerDb = getDb()): Promise<void> {
  const key = await getOrCreateFrameKey(db);
  const enc = await encryptBlob(key, blob);
  await db.baseFrame.put({
    id: SINGLETON,
    iv: enc.iv,
    data: enc.data,
    alg: enc.alg,
    mimeType: enc.mimeType || 'image/webp',
    width: size.width,
    height: size.height,
    updatedAt: Date.now(),
  });
}

export async function loadBaseFrame(db: PaskamerDb = getDb()): Promise<{ blob: Blob; width: number; height: number } | null> {
  const row = await db.baseFrame.get(SINGLETON);
  if (!row) return null;
  const keyRow = await db.keys.get(FRAME_KEY_ID);
  if (!keyRow) return null;
  const enc: EncryptedBytes = { iv: row.iv, data: row.data, alg: row.alg };
  try {
    const blob = await decryptToBlob(keyRow.key, enc, row.mimeType);
    return { blob, width: row.width, height: row.height };
  } catch {
    return null;
  }
}

/** Encrypt and store the face tile (a face image, so encrypted like the base frame). */
export async function saveFaceTile(blob: Blob, skin: SkinEstimate | null, db: PaskamerDb = getDb()): Promise<void> {
  const key = await getOrCreateFrameKey(db);
  const enc = await encryptBlob(key, blob);
  await db.faceTile.put({ id: SINGLETON, iv: enc.iv, data: enc.data, alg: enc.alg, mimeType: enc.mimeType || 'image/webp', skin, updatedAt: Date.now() });
}

export async function loadFaceTile(db: PaskamerDb = getDb()): Promise<{ blob: Blob; skin: SkinEstimate | null } | null> {
  const row = await db.faceTile.get(SINGLETON);
  if (!row) return null;
  if (row.iv && row.data) {
    const keyRow = await db.keys.get(FRAME_KEY_ID);
    if (!keyRow) return null;
    try {
      const blob = await decryptToBlob(keyRow.key, { iv: row.iv, data: row.data, alg: 'AES-GCM' }, row.mimeType);
      return { blob, skin: row.skin };
    } catch {
      return null;
    }
  }
  return row.blob ? { blob: row.blob, skin: row.skin } : null;
}

export async function saveSilhouette(front: SilhouetteMask | null, side: SilhouetteMask | null, db: PaskamerDb = getDb()): Promise<void> {
  await db.silhouette.put({ id: SINGLETON, front, side, updatedAt: Date.now() });
}

export async function loadSilhouette(db: PaskamerDb = getDb()): Promise<{ front: SilhouetteMask | null; side: SilhouetteMask | null } | null> {
  const row = await db.silhouette.get(SINGLETON);
  return row ? { front: row.front, side: row.side } : null;
}

/** Erase everything the capture step stored, atomically. Called by "delete my scan" and by DELETE /v1/me. */
export async function deleteScan(db: PaskamerDb = getDb()): Promise<void> {
  await db.transaction('rw', [db.bodyProfile, db.baseFrame, db.faceTile, db.silhouette, db.keys], async () => {
    await Promise.all([db.bodyProfile.clear(), db.baseFrame.clear(), db.faceTile.clear(), db.silhouette.clear(), db.keys.clear()]);
  });
}

/** Persist a whole capture result in one go (profile first so a failure leaves nothing half-saved). */
export async function saveCapture(
  result: {
    profile: BodyProfile;
    baseFrame?: { blob: Blob; width: number; height: number } | null | undefined;
    faceTile?: { blob: Blob; skin: SkinEstimate | null } | null | undefined;
    silhouette?: { front: SilhouetteMask | null; side: SilhouetteMask | null } | null | undefined;
  },
  db: PaskamerDb = getDb(),
): Promise<void> {
  await saveBodyProfile(result.profile, db);
  if (result.baseFrame) await saveBaseFrame(result.baseFrame.blob, result.baseFrame, db);
  if (result.faceTile) await saveFaceTile(result.faceTile.blob, result.faceTile.skin, db);
  if (result.silhouette) await saveSilhouette(result.silhouette.front, result.silhouette.side, db);
}
