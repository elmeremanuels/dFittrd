import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { lookForMonk } from '../look';
import { createEmbedStore, EMBED_DB_NAME, EmbedDb, LOOK_CRYPTO_KEY, lookStorageEnabled, type EmbedStoreOptions } from '../storage';

const SHOP_A = '00000000-0000-4000-8000-00000000000a';
const SHOP_B = '00000000-0000-4000-8000-00000000000b';
let n = 0;
const freshDbName = (): string => `${EMBED_DB_NAME}-look-${++n}`;
const look = lookForMonk(7)!;
/** A store of the build that saves the colour (flag on). */
const saving = (name: string, o: EmbedStoreOptions = {}) => createEmbedStore({ persistLooks: true, openDb: () => new EmbedDb(name), ...o });

describe('embed storage: the picked skin colour, stored variant (flag on; C30 / C14 / C22)', () => {
  it('remember on: stored per shop, encrypted, and back after a reload', async () => {
    const name = freshDbName();
    const s1 = saving(name);
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

    const s2 = saving(name);
    await s2.init();
    expect(await s2.loadLook(SHOP_A)).toEqual(look);
    expect(await s2.loadLook(SHOP_B)).toBeNull();
  });

  it('remember off: the colour lives in memory only', async () => {
    const name = freshDbName();
    const s = saving(name, { remember: false });
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
    const s = saving(name);
    await s.init();
    await s.saveLook(SHOP_A, look);
    await s.saveLook(SHOP_B, lookForMonk(2)!);
    await s.clearLook(SHOP_A);
    expect(await s.loadLook(SHOP_A)).toBeNull();
    expect(await s.persistedKeys()).toEqual([`look:${SHOP_B}`, LOOK_CRYPTO_KEY]);
    await s.clearLook(SHOP_B);
    expect(await s.persistedKeys()).toEqual([]);
    const s2 = saving(name);
    await s2.init();
    expect(await s2.loadLook(SHOP_A)).toBeNull();
  });

  it('"Forget me" removes the colour from memory and from the device', async () => {
    const name = freshDbName();
    const s = saving(name);
    await s.init();
    await s.saveLook(SHOP_A, look);
    await s.forget();
    expect(await s.loadLook(SHOP_A)).toBeNull();
    expect(await s.persistedKeys()).toEqual([]);
  });

  it('a row that was tampered with is not shown as a colour', async () => {
    const name = freshDbName();
    const s1 = saving(name);
    await s1.init();
    await s1.saveLook(SHOP_A, look);
    const raw = new EmbedDb(name);
    await raw.kv.put({ key: `look:${SHOP_A}`, value: { monk: 3, hex: '#FFFFFF', source: 'picked' } });
    raw.close();
    const s2 = saving(name);
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

describe('embed storage: the picked skin colour is in memory only by default', () => {
  it('the flag is off unless the build sets it', () => {
    expect(lookStorageEnabled({})).toBe(false);
    expect(lookStorageEnabled({ VITE_AVATAR_REMEMBER_LOOK: 'true' })).toBe(false);
    expect(lookStorageEnabled({ VITE_AVATAR_REMEMBER_LOOK: '1' })).toBe(true);
    expect(lookStorageEnabled()).toBe(false);
    expect(createEmbedStore({ openDb: null }).persistsLooks).toBe(false);
  });

  it('"Remember me" on (the default): the colour works in this window and no row is written, now or on switching Remember me', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    expect(s.remember).toBe(true);
    await s.saveLook(SHOP_A, look);
    expect(await s.loadLook(SHOP_A)).toEqual(look);
    expect(await s.persistedKeys()).toEqual([]);
    await s.setRemember(false);
    await s.setRemember(true);
    expect(await s.persistedKeys()).toEqual([]);
    // A new window: the standard colour again.
    const next = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await next.init();
    expect(await next.loadLook(SHOP_A)).toBeNull();
  });

  it('a row left by a build that did store the colour is removed, never read', async () => {
    const name = freshDbName();
    const old = saving(name);
    await old.init();
    await old.saveLook(SHOP_A, look);
    expect(await old.persistedKeys()).toEqual([`look:${SHOP_A}`, LOOK_CRYPTO_KEY]);
    const now = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await now.init();
    expect(await now.loadLook(SHOP_A)).toBeNull();
    expect(await now.persistedKeys()).toEqual([]);
  });
});

describe('embed storage: a slow save never lands after the delete that followed it (C14, C22)', () => {
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  };

  it('pick, then switch the colour off at once (neither awaited): no row is left', async () => {
    const name = freshDbName();
    const s = saving(name);
    await s.init();
    void s.saveLook(SHOP_A, look);
    const cleared = s.clearLook(SHOP_A);
    await cleared;
    await settle();
    expect(await s.persistedKeys()).toEqual([]);
    const next = saving(name);
    await next.init();
    expect(await next.loadLook(SHOP_A)).toBeNull();
  });

  it('pick, then "Remember me" off at once: no row is left; the window keeps the colour', async () => {
    const name = freshDbName();
    const s = saving(name);
    await s.init();
    void s.saveLook(SHOP_A, look);
    await s.setRemember(false);
    await settle();
    expect(await s.persistedKeys()).toEqual([]);
    expect(await s.loadLook(SHOP_A)).toEqual(look);
  });

  it('pick, then "Forget me" at once: no row is left', async () => {
    const name = freshDbName();
    const s = saving(name);
    await s.init();
    void s.saveLook(SHOP_A, look);
    await s.forget();
    await settle();
    expect(await s.persistedKeys()).toEqual([]);
    expect(await s.loadLook(SHOP_A)).toBeNull();
  });

  it('several first picks at once (a held arrow key): one key, and the last colour reads back', async () => {
    const name = freshDbName();
    const s = saving(name);
    await s.init();
    await Promise.all([3, 4, 5, 6].map((n) => s.saveLook(SHOP_A, lookForMonk(n)!)));
    expect(await s.persistedKeys()).toEqual([`look:${SHOP_A}`, LOOK_CRYPTO_KEY]);
    const next = saving(name);
    await next.init();
    expect(await next.loadLook(SHOP_A)).toEqual(lookForMonk(6));
  });

  it('pick, off, pick again at once: the last pick is what is stored', async () => {
    const name = freshDbName();
    const s = saving(name);
    await s.init();
    void s.saveLook(SHOP_A, look);
    void s.clearLook(SHOP_A);
    await s.saveLook(SHOP_A, lookForMonk(2)!);
    await settle();
    const next = saving(name);
    await next.init();
    expect(await next.loadLook(SHOP_A)).toEqual(lookForMonk(2));
  });
});
