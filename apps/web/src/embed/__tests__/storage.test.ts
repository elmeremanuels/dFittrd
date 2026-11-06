import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { EMPTY_ABOUT } from '../aboutYou';
import { createEmbedStore, EMBED_DB_NAME, EmbedDb, REMEMBER_PREF_KEY, UNITS_PREF_KEY, type RememberedProfile } from '../storage';

const SHOP_A = '00000000-0000-4000-8000-00000000000a';
const SHOP_B = '00000000-0000-4000-8000-00000000000b';
const remembered = (shopId: string): RememberedProfile => ({
  shopId,
  profile: { version: 1, measurements: { height: { mean: 170, sigma: 1, source: 'manual' } } },
  about: { ...EMPTY_ABOUT, height: '170', weight: '65' },
  savedAt: 1,
});
const device = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'device-token-abc', expiresAt: '2099-01-01T00:00:00.000Z' };

let n = 0;
const freshDbName = (): string => `${EMBED_DB_NAME}-test-${++n}`;

describe('embed storage (remember / forget)', () => {
  it('uses its own database name, never the app database', () => {
    expect(EMBED_DB_NAME).toBe('curtain-embed');
    expect(new EmbedDb().name).toBe('curtain-embed');
  });

  it('remember on (default): device and profile survive a reload', async () => {
    const name = freshDbName();
    const s1 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    expect(s1.remember).toBe(true);
    await s1.init();
    await s1.setDevice(device);
    await s1.saveProfile(remembered(SHOP_A));
    expect(await s1.persistedKeys()).toEqual(['device', `profile:${SHOP_A}`]);

    const s2 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s2.init();
    expect(s2.getDevice().token).toBe('device-token-abc');
    expect((await s2.loadProfile(SHOP_A))?.about.height).toBe('170');
    // another shop never sees it
    expect(await s2.loadProfile(SHOP_B)).toBeNull();
  });

  it('a concurrent second init() waits for the stored device (returning shopper, StrictMode)', async () => {
    const name = freshDbName();
    const s1 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s1.init();
    await s1.setDevice(device);

    const s2 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    const first = s2.init();
    // The second caller must not see an empty device while the first read is still running.
    await s2.init();
    expect(s2.getDevice().token).toBe('device-token-abc');
    await first;
  });

  it('remember off: memory only, and turning it off wipes what was stored', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    await s.setDevice(device);
    await s.saveProfile(remembered(SHOP_A));
    await s.setRemember(false);
    expect(await s.persistedKeys()).toEqual([]);
    // still works in memory
    expect(s.getDevice().token).toBe('device-token-abc');
    expect(await s.loadProfile(SHOP_A)).not.toBeNull();
    await s.saveProfile(remembered(SHOP_B));
    expect(await s.persistedKeys()).toEqual([]);

    const reload = createEmbedStore({ openDb: () => new EmbedDb(name), remember: false });
    await reload.init();
    expect(reload.getDevice().token).toBeNull();
    expect(await reload.loadProfile(SHOP_A)).toBeNull();
  });

  it('the opt-out itself is remembered: a new store (no options) starts off and writes nothing', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    await s.setDevice(device);
    await s.saveProfile(remembered(SHOP_A));
    await s.setRemember(false);
    // Only the non-personal flag is stored.
    expect(await new EmbedDb(name).kv.toArray()).toEqual([{ key: REMEMBER_PREF_KEY, value: false }]);

    const next = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await next.init();
    expect(next.remember).toBe(false);
    expect(next.getDevice().token).toBeNull();
    await next.setDevice(device);
    await next.saveProfile(remembered(SHOP_A));
    expect(await next.persistedKeys()).toEqual([]);

    // Forget me keeps the opt-out; turning it back on removes the flag.
    await next.forget();
    const afterForget = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await afterForget.init();
    expect(afterForget.remember).toBe(false);
    await afterForget.setRemember(true);
    await afterForget.setDevice(device);
    expect(await new EmbedDb(name).kv.get(REMEMBER_PREF_KEY)).toBeUndefined();
    const on = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await on.init();
    expect(on.remember).toBe(true);
    expect(on.getDevice().token).toBe('device-token-abc');
  });

  it('turning remember back on writes the in-memory state', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name), remember: false });
    await s.init();
    await s.setDevice(device);
    await s.saveProfile(remembered(SHOP_A));
    expect(await s.persistedKeys()).toEqual([]);
    await s.setRemember(true);
    expect(await s.persistedKeys()).toEqual(['device', `profile:${SHOP_A}`]);
  });

  it('forget me wipes memory and IndexedDB', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    await s.setDevice(device);
    await s.saveProfile(remembered(SHOP_A));
    await s.forget();
    expect(s.getDevice()).toEqual({ deviceId: null, token: null, expiresAt: null });
    expect(await s.loadProfile(SHOP_A)).toBeNull();
    expect(await s.persistedKeys()).toEqual([]);
  });

  it('works memory-only when IndexedDB is unavailable or throws', async () => {
    const none = createEmbedStore({ openDb: null });
    await none.init();
    await none.setDevice(device);
    await none.saveProfile(remembered(SHOP_A));
    expect(none.getDevice().token).toBe('device-token-abc');
    expect(await none.loadProfile(SHOP_A)).not.toBeNull();

    const broken = createEmbedStore({
      openDb: () => {
        throw new Error('SecurityError: storage blocked');
      },
    });
    await broken.init();
    await broken.setDevice(device);
    expect(broken.getDevice().token).toBe('device-token-abc');
  });

  it('a cleared token (401 retry) removes the stored device', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    await s.setDevice(device);
    await s.setDevice({ deviceId: device.deviceId, token: '', expiresAt: new Date(0).toISOString() });
    expect(s.getDevice().token).toBeNull();
    expect(await s.persistedKeys()).toEqual([]);
  });

  it('remembers the chosen units across visits, only with "Remember me" on', async () => {
    const name = freshDbName();
    const s1 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s1.init();
    expect(await s1.loadUnits()).toBeNull();
    await s1.saveUnits('imperial');
    expect(await s1.persistedKeys()).toEqual([UNITS_PREF_KEY]);

    const s2 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s2.init();
    expect(await s2.loadUnits()).toBe('imperial');

    // off: wiped from the database, kept in memory for this page only
    await s2.setRemember(false);
    expect(await s2.loadUnits()).toBe('imperial');
    expect(await s2.persistedKeys()).toEqual([]);
    await s2.saveUnits('metric');
    expect(await s2.persistedKeys()).toEqual([]);
    const s3 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s3.init();
    expect(await s3.loadUnits()).toBeNull();

    // back on: what is in memory is written again
    await s2.setRemember(true);
    expect(await s2.persistedKeys()).toEqual([UNITS_PREF_KEY]);

    // forget me clears it
    await s2.forget();
    expect(await s2.loadUnits()).toBeNull();
    expect(await s2.persistedKeys()).toEqual([]);
  });

  it('ignores a stored units value it does not know', async () => {
    const name = freshDbName();
    await new EmbedDb(name).kv.put({ key: UNITS_PREF_KEY, value: 'furlongs' });
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    expect(await s.loadUnits()).toBeNull();
  });

  it('hasProfiles (the local check of the size peek): false when empty, after Forget me or with Remember me off; true for any remembered shop', async () => {
    const name = freshDbName();
    const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s.init();
    expect(await s.hasProfiles()).toBe(false);
    await s.setDevice(device);
    await s.saveUnits('imperial');
    expect(await s.hasProfiles()).toBe(false);
    await s.saveProfile(remembered(SHOP_A));
    const reload = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await reload.init();
    expect(await reload.hasProfiles()).toBe(true);
    await reload.forget();
    expect(await reload.hasProfiles()).toBe(false);
    const off = createEmbedStore({ openDb: () => new EmbedDb(freshDbName()), remember: false });
    await off.init();
    expect(await off.hasProfiles()).toBe(false);
  });
});
