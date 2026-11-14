import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { lookForMonk } from '../look';
import { createEmbedStore, EMBED_DB_NAME, EmbedDb, LOOK_CRYPTO_KEY } from '../storage';

const SHOP_A = '00000000-0000-4000-8000-00000000000a';
const SHOP_B = '00000000-0000-4000-8000-00000000000b';
let n = 0;
const freshDbName = (): string => `${EMBED_DB_NAME}-look-${++n}`;
const look = lookForMonk(7)!;

describe('embed storage: the picked skin colour (avatar prompt, C30 / C14 / C22)', () => {
  it('remember on: stored per shop, encrypted, and back after a reload', async () => {
    const name = freshDbName();
    const s1 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s1.init();
    await s1.saveLook(SHOP_A, look);
    expect(await s1.persistedKeys()).toEqual([`look:${SHOP_A}`, LOOK_CRYPTO_KEY]);

    // The row holds ciphertext: neither the colour nor the class is readable in it.
    const raw = new EmbedDb(name);
    const row = (await raw.kv.get(`look:${SHOP_A}`))!.value as { alg: string; iv: Uint8Array; data: ArrayBuffer };
    expect(row.alg).toBe('AES-GCM');
    expect(row.iv.byteLength).toBe(12);
    const bytes = new TextDecoder('latin1').decode(new Uint8Array(row.data));
    expect(bytes).not.toContain(look.hex);
    expect(bytes).not.toContain('monk');
    const key = (await raw.kv.get(LOOK_CRYPTO_KEY))!.value as CryptoKey;
    expect(key.extractable).toBe(false);
    raw.close();

    const s2 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s2.init();
    expect(await s2.loadLook(SHOP_A)).toEqual(look);
    expect(await s2.loadLook(SHOP_B)).toBeNull();
  });

  it('remember off: the colour lives in memory only', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ remember: false, openDb: () => new EmbedDb(name) });
    await s.init();
    await s.saveLook(SHOP_A, look);
    expect(await s.loadLook(SHOP_A)).toEqual(look);
    expect(await s.persistedKeys()).toEqual([]);
    // Switching "Remember me" on writes what is in memory.
    await s.setRemember(true);
    expect(await s.persistedKeys()).toEqual([`look:${SHOP_A}`, LOOK_CRYPTO_KEY]);
    // And off again wipes it from the device, not from the open window.
    await s.setRemember(false);
    expect(await s.persistedKeys()).toEqual([]);
    expect(await s.loadLook(SHOP_A)).toEqual(look);
  });

  it('switching the colour off deletes it from the device, and the key with the last colour', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    await s.saveLook(SHOP_A, look);
    await s.saveLook(SHOP_B, lookForMonk(2)!);
    await s.clearLook(SHOP_A);
    expect(await s.loadLook(SHOP_A)).toBeNull();
    expect(await s.persistedKeys()).toEqual([`look:${SHOP_B}`, LOOK_CRYPTO_KEY]);
    await s.clearLook(SHOP_B);
    expect(await s.persistedKeys()).toEqual([]);
    const s2 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s2.init();
    expect(await s2.loadLook(SHOP_A)).toBeNull();
  });

  it('"Forget me" removes the colour from memory and from the device', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    await s.saveLook(SHOP_A, look);
    await s.forget();
    expect(await s.loadLook(SHOP_A)).toBeNull();
    expect(await s.persistedKeys()).toEqual([]);
  });

  it('a row that was tampered with is not shown as a colour', async () => {
    const name = freshDbName();
    const s1 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s1.init();
    await s1.saveLook(SHOP_A, look);
    const raw = new EmbedDb(name);
    await raw.kv.put({ key: `look:${SHOP_A}`, value: { monk: 3, hex: '#FFFFFF', source: 'picked' } });
    raw.close();
    const s2 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s2.init();
    expect(await s2.loadLook(SHOP_A)).toBeNull();
  });

  it('without a database the colour still works for this window', async () => {
    const s = createEmbedStore({ openDb: null });
    await s.init();
    await s.saveLook(SHOP_A, look);
    expect(await s.loadLook(SHOP_A)).toEqual(look);
    await s.clearLook(SHOP_A);
    expect(await s.loadLook(SHOP_A)).toBeNull();
  });
});
