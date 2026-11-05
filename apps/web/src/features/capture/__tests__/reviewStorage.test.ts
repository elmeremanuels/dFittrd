/**
 * Review regression: the face tile is a face image and is now encrypted at rest with the same
 * non-extractable AES-GCM key as the base frame (it used to be stored as a plaintext Blob while the
 * UI said "Stored encrypted"). `deleteScan` removes the key, so nothing stays decryptable.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { PaskamerDb, deleteScan, loadFaceTile, saveFaceTile } from '../storage';
import type { SkinEstimate } from '../types';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
let n = 0;
const dbs: PaskamerDb[] = [];
const freshDb = (): PaskamerDb => {
  const db = new PaskamerDb(`paskamer-review-${++n}`);
  dbs.push(db);
  return db;
};

afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});

describe('face tile at rest', () => {
  it('is stored encrypted and round-trips through loadFaceTile', async () => {
    const db = freshDb();
    const skin = { monk: 4 } as unknown as SkinEstimate;
    await saveFaceTile(new Blob([PNG], { type: 'image/webp' }), skin, db);

    const row = await db.faceTile.get('current');
    expect(row?.blob).toBeUndefined();
    expect(row?.data).toBeDefined();
    expect(new Uint8Array(row!.data!)).not.toEqual(PNG);
    expect(row?.iv).toHaveLength(12);

    const back = await loadFaceTile(db);
    expect(back?.skin).toEqual(skin);
    expect(back?.blob.type).toBe('image/webp');
    expect(new Uint8Array(await back!.blob.arrayBuffer())).toEqual(PNG);
  });

  it('is unreadable after deleteScan, and legacy plaintext rows still load', async () => {
    const db = freshDb();
    await saveFaceTile(new Blob([PNG], { type: 'image/webp' }), null, db);
    await deleteScan(db);
    expect(await loadFaceTile(db)).toBeNull();
    expect(await db.keys.count()).toBe(0);

    await db.faceTile.put({ id: 'current', blob: new Blob([PNG], { type: 'image/webp' }), mimeType: 'image/webp', skin: null, updatedAt: 1 });
    const legacy = await loadFaceTile(db);
    expect(legacy?.blob).toBeDefined();
  });
});
