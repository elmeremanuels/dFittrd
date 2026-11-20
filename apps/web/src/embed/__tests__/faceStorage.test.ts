import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { lookForMonk } from '../look';
import { createEmbedStore, decodeFace, EMBED_DB_NAME, EmbedDb, encodeFace, FACE_CRYPTO_KEY, LOOK_CRYPTO_KEY, type EmbedStoreOptions, type StoredFace } from '../storage';

/**
 * D20 point 2 and consent copy C19, C20, C22: the face tile drawn from the shopper's photo is kept
 * in memory; only with "Remember my photo on this device" (off at first) and "Remember me" on is it
 * stored, per shop, encrypted. Switching it off, "Delete my photo" and "Forget me" remove it.
 */
const SHOP_A = '00000000-0000-4000-8000-00000000000a';
const SHOP_B = '00000000-0000-4000-8000-00000000000b';
let n = 0;
const freshDbName = (): string => `${EMBED_DB_NAME}-face-${++n}`;
const store = (name: string, o: EmbedStoreOptions = {}) => createEmbedStore({ openDb: () => new EmbedDb(name), ...o });

function face(seed = 7, look: StoredFace['look'] = { ...lookForMonk(6)!, source: 'photo' }): StoredFace {
  const w = 16;
  const h = 19;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * seed) % 251;
  return { tile: { width: w, height: h, rgba, skinLab: { L: 52.1, a: 11.2, b: 24.3 } }, look, savedAt: 1_700_000_000_000 };
}

describe('the face record', () => {
  it('round-trips and refuses anything else', () => {
    const f = face();
    expect(decodeFace(encodeFace(f))).toEqual(f);
    const bytes = encodeFace(f);
    expect(decodeFace(bytes.subarray(0, bytes.length - 4))).toBeNull();
    expect(decodeFace(new TextEncoder().encode('{"v":2}\0'))).toBeNull();
    expect(decodeFace(new Uint8Array([1, 2, 3]))).toBeNull();
    const badLook = encodeFace({ ...f, look: { ...f.look!, hex: '#123456' } });
    expect(decodeFace(badLook)).toBeNull();
  });
});

describe('embed storage: the face drawn from the photo (C19, C20, C22)', () => {
  it('"Remember my photo" off (the start): memory only, nothing on the device', async () => {
    const name = freshDbName();
    const s = store(name);
    await s.init();
    await s.saveFace(SHOP_A, face(), false);
    expect(await s.loadFace(SHOP_A)).toEqual(face());
    expect(await s.persistedKeys()).toEqual([]);
    // A new window (the iframe was closed): gone.
    const s2 = store(name);
    await s2.init();
    expect(await s2.loadFace(SHOP_A)).toBeNull();
  });

  it('"Remember my photo" on: stored for this shop only, encrypted with its own key, back after a reload', async () => {
    const name = freshDbName();
    const s = store(name);
    await s.init();
    await s.saveFace(SHOP_A, face(), true);
    expect(await s.persistedKeys()).toEqual([`face:${SHOP_A}`, FACE_CRYPTO_KEY]);
    const raw = new EmbedDb(name);
    const row = (await raw.kv.get(`face:${SHOP_A}`))!.value as { alg: string; data: ArrayBuffer };
    expect(row.alg).toBe('AES-GCM');
    const text = new TextDecoder('latin1').decode(new Uint8Array(row.data));
    expect(text).not.toContain('skinLab');
    expect(text).not.toContain('monk');
    expect(((await raw.kv.get(FACE_CRYPTO_KEY))!.value as CryptoKey).extractable).toBe(false);
    raw.close();

    const s2 = store(name);
    await s2.init();
    expect(await s2.loadFace(SHOP_A)).toEqual(face());
    expect(await s2.loadFace(SHOP_B)).toBeNull();
  });

  it('switching "Remember my photo" off again deletes the row and the key, and keeps the face for this window', async () => {
    const name = freshDbName();
    const s = store(name);
    await s.init();
    await s.saveFace(SHOP_A, face(), true);
    await s.saveFace(SHOP_A, face(), false);
    expect(await s.persistedKeys()).toEqual([]);
    expect(await s.loadFace(SHOP_A)).toEqual(face());
  });

  it('switching the face off / "Delete my photo" removes it from memory and the device', async () => {
    const name = freshDbName();
    const s = store(name);
    await s.init();
    await s.saveFace(SHOP_A, face(), true);
    await s.saveFace(SHOP_B, face(3), true);
    await s.clearFace(SHOP_A);
    expect(await s.loadFace(SHOP_A)).toBeNull();
    expect(await s.persistedKeys()).toEqual([`face:${SHOP_B}`, FACE_CRYPTO_KEY]);
    await s.clearFace(SHOP_B);
    expect(await s.persistedKeys()).toEqual([]);
  });

  it('"Forget me" removes every face, and "Remember me" off wipes it from the device', async () => {
    const name = freshDbName();
    const s = store(name);
    await s.init();
    await s.saveFace(SHOP_A, face(), true);
    await s.setRemember(false);
    expect(await s.persistedKeys()).toEqual([]);
    await s.setRemember(true);
    expect(await s.persistedKeys()).toEqual([`face:${SHOP_A}`, FACE_CRYPTO_KEY]);
    await s.forget();
    expect(await s.persistedKeys()).toEqual([]);
    expect(await s.loadFace(SHOP_A)).toBeNull();
  });

  it('"Remember me" off: nothing is written even with "Remember my photo" on', async () => {
    const name = freshDbName();
    const s = store(name, { remember: false });
    await s.init();
    await s.saveFace(SHOP_A, face(), true);
    expect(await s.persistedKeys()).toEqual([]);
  });

  it('a colour read from the photo never goes into the look row, even in the build that stores picked colours', async () => {
    const name = freshDbName();
    const s = store(name, { persistLooks: true });
    await s.init();
    await s.saveLook(SHOP_A, { ...lookForMonk(4)!, source: 'photo' });
    expect(await s.persistedKeys()).toEqual([]);
    await s.saveLook(SHOP_A, lookForMonk(4)!);
    expect(await s.persistedKeys()).toEqual([`look:${SHOP_A}`, LOOK_CRYPTO_KEY]);
  });
});
