/**
 * The size peek's gate (peekGate.ts): a raw IndexedDB look-up before React loads. A first-time
 * visitor gets `false` (collapse, nothing more downloaded), a remembered profile `true`.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_ABOUT } from '../aboutYou';
import { browserParentOrigin, isPeekPath, PEEK_DB_NAME, postCollapse, quickHasProfile } from '../peekGate';
import { createEmbedStore, EMBED_DB_NAME, EmbedDb } from '../storage';

const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';

describe('peek gate', () => {
  it('reads the same database as the embed store', () => {
    expect(PEEK_DB_NAME).toBe(EMBED_DB_NAME);
    expect(isPeekPath('/embed/peek')).toBe(true);
    expect(isPeekPath('/embed/peek/')).toBe(true);
    expect(isPeekPath('/embed/peek-token')).toBe(false);
  });

  it('no database: false, and it does not create one', async () => {
    const idb = new IDBFactory();
    expect(await quickHasProfile(idb)).toBe(false);
    expect((await idb.databases()).map((d) => d.name)).not.toContain(PEEK_DB_NAME);
  });

  it('a database with a device and units but no profile: false; with a profile: true; after Forget me: false', async () => {
    // The real store on the real database name, in the test's global (fake) IndexedDB.
    const store = createEmbedStore();
    await store.init();
    await store.setDevice({ deviceId: '11111111-1111-4111-8111-111111111111', token: 'device-token-abc', expiresAt: '2099-01-01T00:00:00.000Z' });
    await store.saveUnits('metric');
    expect(await quickHasProfile(indexedDB)).toBe(false);
    await store.saveProfile({ shopId: SHOP_ID, profile: { version: 1, measurements: { height: { mean: 170, sigma: 1, source: 'manual' } } }, about: { ...EMPTY_ABOUT, height: '170' }, savedAt: 1 });
    expect(await quickHasProfile(indexedDB)).toBe(true);
    await store.forget();
    expect(await quickHasProfile(indexedDB)).toBe(false);
    await new EmbedDb().delete();
  });

  it('cannot tell cheaply (no databases(), or an error): null, so the full peek decides', async () => {
    expect(await quickHasProfile({ open: () => null } as unknown as IDBFactory)).toBeNull();
    expect(await quickHasProfile({ databases: () => Promise.reject(new Error('blocked')) } as unknown as IDBFactory)).toBeNull();
    expect(await quickHasProfile(null)).toBe(false);
  });

  it('collapse goes to the parent origin the browser reports, with the height only', () => {
    const parent = { postMessage: vi.fn() };
    postCollapse({ parent, referrer: 'https://shop.example/products/1', ancestorOrigins: ['https://shop.example'] });
    expect(parent.postMessage).toHaveBeenCalledWith({ source: 'curtain', v: 1, type: 'curtain:peek-size', height: 0 }, 'https://shop.example');
    expect(browserParentOrigin({ parent, referrer: 'https://other.example/', ancestorOrigins: null })).toBe('https://other.example');
    expect(browserParentOrigin({ parent: null, referrer: 'https://shop.example/', ancestorOrigins: null })).toBeNull();
    const nowhere = { postMessage: vi.fn() };
    postCollapse({ parent: nowhere, referrer: '', ancestorOrigins: null });
    expect(nowhere.postMessage).not.toHaveBeenCalled();
  });
});
