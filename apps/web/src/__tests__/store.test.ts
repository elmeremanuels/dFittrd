import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { AppDb, setAppDb } from '@/db/db';
import { createAppStore, MOCK_SHOP_ID } from '@/store/store';

const PROFILE = {
  version: 1 as const,
  measurements: {
    height: { mean: 168, sigma: 1, source: 'manual' as const },
    bust: { mean: 88, sigma: 1.5, source: 'manual' as const },
    waist: { mean: 70, sigma: 1.5, source: 'manual' as const },
    hip: { mean: 96, sigma: 1.5, source: 'manual' as const },
  },
};

let dbName = '';
let db: AppDb;

beforeEach(() => {
  dbName = `curtain-test-${Math.random().toString(36).slice(2)}`;
  db = new AppDb(dbName);
  setAppDb(db);
});

afterEach(async () => {
  db.close();
  await AppDb.delete(dbName);
  setAppDb(null);
});

describe('app store persistence', () => {
  it('round-trips settings, profile, taste, wardrobe, ledger and outbox through IndexedDB', async () => {
    // a paired shop's catalogue (the demo rail never syncs; see 'the bundled demo rail stays on the device')
    const SHOP = '55555555-5555-4555-8555-555555555555';
    const store = createAppStore({ db, catalog: MOCK_GARMENTS.map((garment) => ({ garment, shopId: SHOP })) });
    await store.getState().hydrate();
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().settings.onboarded).toBe(false);

    await store.getState().setProfile(PROFILE, { signature: { version: 1, vector: Array.from({ length: 80 }, (_, i) => (i === 78 ? 1 : i === 79 ? 0.7 : 0)), quality: 0.7 } });
    await store.getState().completeOnboarding(['Minimal', 'Eclectic']);
    expect(store.getState().taste.profile.axes.minimal).toBeCloseTo(0.75, 4);
    expect(store.getState().taste.profile.explorationBonus).toBe(0.2);

    store.getState().dealNext();
    const first = store.getState().deck.current;
    expect(first).not.toBeNull();
    const event = await store.getState().swipe('love');
    expect(event?.action).toBe('love');
    expect(event?.itemId).toBe(first!.garment.id);
    expect(event?.sizeAtSwipe).toBeTypeOf('string');
    expect(store.getState().deck.current?.garment.id).not.toBe(first!.garment.id);

    const wrap = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    await store.getState().saveToWardrobe(wrap, SHOP, 'M');
    await store.getState().setConsent('heroOptIn');
    await store.getState().appendLedger({ id: 'l1', at: new Date().toISOString(), kind: 'signature_sync', method: 'PUT', path: '/v1/me/signature', bytes: 10, fields: ['version'], status: 200 });

    // the outbox holds the signature, the swipe and the wardrobe row — all without body data
    const outbox = await db.outbox.toArray();
    expect(outbox.map((r) => r.kind).sort()).toEqual(['signature', 'swipe', 'wardrobe']);
    for (const row of outbox) expect(JSON.stringify(row.payload)).not.toMatch(/measurements|bust|waist|hip/);

    // a second connection (fresh app start) sees the same state
    const db2 = new AppDb(dbName);
    const again = createAppStore({ db: db2 });
    await again.getState().hydrate();
    const s = again.getState();
    expect(s.settings.onboarded).toBe(true);
    expect(s.settings.consentTier).toBe('heroOptIn');
    expect(s.settings.vibes).toEqual(['Minimal', 'Eclectic']);
    expect(s.profile?.measurements.bust?.mean).toBe(88);
    expect(s.taste.profile).toEqual(store.getState().taste.profile);
    // the seen memory is keyed by shop and item (#22)
    expect(s.taste.seen[`${SHOP}:${first!.garment.id}`]).toBe(-1);
    expect(s.taste.seen[first!.garment.id]).toBeUndefined();
    expect(s.wardrobe).toHaveLength(1);
    expect(s.wardrobe[0]?.size).toBe('M');
    expect(s.ledger.map((l) => l.id)).toContain('l1');
    expect(s.outboxPending).toBe(3);
    db2.close();
  });

  it('kept / returned wardrobe states feed the fit-engine history', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    const wrap = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    await store.getState().saveToWardrobe(wrap, MOCK_SHOP_ID, 'M');
    await store.getState().setWardrobeState(MOCK_SHOP_ID, wrap.id, 'returned');
    expect(store.getState().profile?.history).toEqual([{ brand: wrap.brand, size: 'M', kept: false }]);
    expect(store.getState().fitCtx?.userBody.history).toEqual([{ brand: wrap.brand, size: 'M', kept: false }]);
    await store.getState().setWardrobeState(MOCK_SHOP_ID, wrap.id, 'kept');
    expect(store.getState().profile?.history).toEqual([{ brand: wrap.brand, size: 'M', kept: true }]);
  });

  it('delete my scan removes the profile and the pending signature but keeps the taste', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE, { signature: { version: 1, vector: new Array(80).fill(0), quality: 0.5 } });
    await store.getState().completeOnboarding(['Sporty']);
    await store.getState().deleteScanLocal();
    expect(store.getState().profile).toBeNull();
    expect(await db.bodyProfile.count()).toBe(0);
    expect(await db.outbox.where('kind').equals('signature').count()).toBe(0);
    expect(store.getState().taste.profile.axes.sporty).toBeCloseTo(0.75, 4);
    expect(store.getState().settings.onboarded).toBe(true);
  });

  it('delete my scan also erases the server signature for a registered device', async () => {
    const store = createAppStore({ db });
    const deleteSignature = vi.fn(async () => ({ deleted: true, ledgerEntryId: 'l', at: new Date().toISOString() }));
    store.attachClient({ deleteSignature } as unknown as Parameters<typeof store.attachClient>[0]);
    await store.getState().hydrate();
    await store.getState().setDeviceCredentials({ deviceId: '44444444-4444-4444-8444-444444444444', token: 't', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await store.getState().updateSettings({ signatureSyncedAt: new Date().toISOString() });
    await store.getState().setProfile(PROFILE);
    await store.getState().deleteScanLocal();
    expect(deleteSignature).toHaveBeenCalledTimes(1);
    expect(store.getState().profile).toBeNull();
    expect(await db.bodyProfile.count()).toBe(0);
    await vi.waitFor(() => expect(store.getState().settings.signatureSyncedAt).toBeNull());
    expect(await db.outbox.count()).toBe(0);
    await store.syncer?.stop();
  });

  it('PRIV-1: offline, delete my scan drops the pending signature PUT and keeps a durable DELETE until the server confirms', async () => {
    const store = createAppStore({ db });
    const { NetworkError } = await import('@/api/client');
    const putSignature = vi.fn(async () => ({ updatedAt: new Date().toISOString(), ledgerEntryId: 'l' }));
    const deleteSignature = vi.fn<() => Promise<unknown>>().mockRejectedValue(new NetworkError('offline'));
    store.attachClient({ deleteSignature, putSignature } as unknown as Parameters<typeof store.attachClient>[0]);
    await store.getState().hydrate();
    await store.syncer?.stop(); // no background drain: this test drives the flushes
    await store.getState().setDeviceCredentials({ deviceId: '44444444-4444-4444-8444-444444444444', token: 't', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const synced = new Date().toISOString();
    await store.getState().updateSettings({ signatureSyncedAt: synced });
    await store.getState().setProfile(PROFILE, { signature: { version: 1, vector: new Array(80).fill(0), quality: 0.5 } });
    await store.getState().deleteScanLocal();
    // The local delete happened, the PUT never went out, and the DELETE waits in the outbox.
    expect(store.getState().profile).toBeNull();
    expect(putSignature).not.toHaveBeenCalled();
    expect(deleteSignature).toHaveBeenCalledTimes(1);
    const rows = await db.outbox.toArray();
    expect(rows.map((r) => r.kind)).toEqual(['signature_delete']);
    expect(rows[0]!.attempts).toBe(1);
    // Not confirmed: the app does not pretend the server copy is gone.
    expect(store.getState().settings.signatureSyncedAt).toBe(synced);
    // Back online: the retry succeeds and only then is the sync mark cleared.
    deleteSignature.mockResolvedValue({ deleted: true, ledgerEntryId: 'l2', at: new Date().toISOString() });
    await db.outbox.toCollection().modify({ nextAt: 0 });
    await store.getState().flushOutbox();
    expect(deleteSignature).toHaveBeenCalledTimes(2);
    expect(await db.outbox.count()).toBe(0);
    await vi.waitFor(() => expect(store.getState().settings.signatureSyncedAt).toBeNull());
  });

  it('AUTH-1: a tab with a stale in-memory token never reverts the token another tab rotated', async () => {
    const tabA = createAppStore({ db });
    const tabB = createAppStore({ db });
    await tabA.getState().hydrate();
    await tabB.getState().hydrate();
    const id = '44444444-4444-4444-8444-444444444444';
    await tabA.getState().setDeviceCredentials({ deviceId: id, token: 'old', expiresAt: '2026-11-07T10:00:00.000Z' });
    await tabB.getState().reloadDeviceCredentials();
    await tabA.getState().setDeviceCredentials({ deviceId: id, token: 'new', expiresAt: '2026-12-04T10:00:00.000Z' });
    // Tab B still has 'old' in memory and writes an unrelated setting.
    expect(tabB.getState().deviceCredentials().token).toBe('old');
    await tabB.getState().updateSettings({ season: 'autumn' });
    expect((await db.settings.toArray())[0]).toMatchObject({ deviceToken: 'new', season: 'autumn' });
    expect(tabB.getState().deviceCredentials().token).toBe('new');
    expect((await tabB.getState().reloadDeviceCredentials()).token).toBe('new');
  });

  it('delete my scan does not call the server for a device that never registered', async () => {
    const store = createAppStore({ db });
    const deleteSignature = vi.fn(async () => ({}));
    store.attachClient({ deleteSignature } as unknown as Parameters<typeof store.attachClient>[0]);
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    await store.getState().deleteScanLocal();
    expect(deleteSignature).not.toHaveBeenCalled();
    expect(store.getState().profile).toBeNull();
    await store.syncer?.stop();
  });

  it('delete everything wipes every table and resets onboarding', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    await store.getState().completeOnboarding([]);
    await store.getState().deleteEverything();
    expect(store.getState().settings.onboarded).toBe(false);
    expect(await db.settings.count()).toBe(0);
    expect(await db.taste.count()).toBe(0);
    expect(await db.bodyProfile.count()).toBe(0);
  });
});

describe('shop-scoped garment ids (schema: `id` is the merchant external id, not globally unique)', () => {
  const base = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
  const SHOP_A = '11111111-1111-4111-8111-111111111111';
  const SHOP_B = '22222222-2222-4222-8222-222222222222';
  // same id in two shops, very different charts → different fits
  const inA = { ...base, brand: 'Shop A' };
  const inB = { ...base, brand: 'Shop B', sizeChart: base.sizeChart.map((r) => ({ ...r, bust: (r.bust ?? 0) + 30, waist: (r.waist ?? 0) + 30, hip: (r.hip ?? 0) + 30 })) };

  it('computes the fit per garment object, not per id', async () => {
    const store = createAppStore({ db, catalog: [{ garment: inA, shopId: SHOP_A }, { garment: inB, shopId: SHOP_B }] });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    const a = store.getState().fit(inA)!;
    const b = store.getState().fit(inB)!;
    expect(a.recommendedSize).toBe('M');
    expect(b.recommendedSize).not.toBe(a.recommendedSize);
  });

  it('attributes a swipe to the shop the dealt card came from', async () => {
    const store = createAppStore({ db, catalog: [{ garment: inA, shopId: SHOP_A }, { garment: inB, shopId: SHOP_B }] });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    expect(store.getState().shopIdFor(inB)).toBe(SHOP_B);
    expect(store.getState().shopIdFor(inA)).toBe(SHOP_A);
    // a swipe on the shop-B garment without an explicit shopId (the deck path) is attributed to B
    await store.getState().swipe('love', { garment: inB });
    const rows = await db.outbox.where('kind').equals('swipe').toArray();
    expect(rows.at(-1)?.shopId).toBe(SHOP_B);
    // and saving it files it under shop B
    await store.getState().swipe('save', { garment: inB });
    expect(store.getState().wardrobe[0]?.shopId).toBe(SHOP_B);
  });
});

describe('delete everything keeps the record of the erase itself', () => {
  it('the ledger still shows the DELETE /v1/me entry after the local wipe', async () => {
    const store = createAppStore({ db });
    const fakeClient = {
      deleteMe: async () => {
        await store.getState().appendLedger({ id: 'erase-1', at: new Date().toISOString(), kind: 'erase', method: 'DELETE', path: '/v1/me', bytes: 0, fields: [], status: 200 });
        return { erased: true, at: new Date().toISOString() };
      },
    };
    store.attachClient(fakeClient as unknown as Parameters<typeof store.attachClient>[0]);
    await store.getState().hydrate();
    await store.getState().setDeviceCredentials({ deviceId: '33333333-3333-4333-8333-333333333333', token: 't', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await store.getState().setProfile(PROFILE);
    await store.getState().appendLedger({ id: 'old-1', at: new Date(1).toISOString(), kind: 'signature_sync', method: 'PUT', path: '/v1/me/signature', bytes: 10, fields: ['vector'], status: 200 });
    await store.getState().deleteEverything();
    expect(store.getState().ledger.map((l) => l.id)).toEqual(['erase-1']);
    expect((await db.ledger.toArray()).map((l) => l.id)).toEqual(['erase-1']);
    expect(store.getState().profile).toBeNull();
    expect(store.getState().settings.onboarded).toBe(false);
    await store.syncer?.stop();
  });
});

describe('delete everything / export for a device that never registered', () => {
  it('does not register a device on the server just to erase or export it', async () => {
    const store = createAppStore({ db });
    const deleteMe = vi.fn(async () => ({ erased: true, at: new Date().toISOString() }));
    const exportMe = vi.fn(async () => ({}));
    store.attachClient({ deleteMe, exportMe } as unknown as Parameters<typeof store.attachClient>[0]);
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    expect(store.getState().settings.deviceId).toBeNull();
    const exported = await store.getState().exportLocal();
    expect(exported.server).toBeNull();
    await store.getState().deleteEverything();
    expect(exportMe).not.toHaveBeenCalled();
    expect(deleteMe).not.toHaveBeenCalled();
    expect(store.getState().profile).toBeNull();
    await store.syncer?.stop();
  });
});

describe('re-entering onboarding keeps what the swipes learned', () => {
  it('only applies vibes that were not chosen before', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().completeOnboarding(['Minimal']);
    expect(store.getState().taste.profile.axes.minimal).toBeCloseTo(0.75, 4);
    // swipes moved the axis down since onboarding
    store.setState({ taste: { ...store.getState().taste, profile: { ...store.getState().taste.profile, axes: { ...store.getState().taste.profile.axes, minimal: 0.3 } } } });
    await store.getState().completeOnboarding(['Minimal', 'Sporty']);
    expect(store.getState().taste.profile.axes.minimal).toBeCloseTo(0.3, 4);
    expect(store.getState().taste.profile.axes.sporty).toBeCloseTo(0.75, 4);
    expect(store.getState().settings.vibes).toEqual(['Minimal', 'Sporty']);
  });
});

describe('paired catalogue arriving during hydrate', () => {
  it('drops a card dealt from the demo rail so the deck re-deals from the shop', async () => {
    const SHOP = '44444444-4444-4444-8444-444444444444';
    const seedStore = createAppStore({ db });
    await seedStore.getState().hydrate();
    await seedStore.getState().updateSettings({ onboarded: true, pairedShops: [{ id: SHOP, name: 'Shop', platform: 'shopify', paused: false }] });
    const store = createAppStore({ db });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const shopProducts = vi.fn(async () => {
      await gate;
      return { items: [MOCK_GARMENTS_BY_ID['aalter-studio-1']!], nextCursor: null };
    });
    store.attachClient({ shopProducts } as unknown as Parameters<typeof store.attachClient>[0]);
    const hydrating = store.getState().hydrate();
    await vi.waitFor(() => expect(store.getState().hydrated).toBe(true));
    store.getState().dealNext(); // the deck mounts and deals from the demo rail meanwhile
    expect(store.getState().deck.current).not.toBeNull();
    release();
    await hydrating;
    expect(store.getState().catalogSource).toBe('paired');
    expect(store.getState().deck.current).toBeNull();
    store.getState().dealNext();
    expect(store.getState().deck.current?.garment.id).toBe('aalter-studio-1');
    expect(store.getState().shopIdFor(store.getState().deck.current!.garment)).toBe(SHOP);
    await store.syncer?.stop();
  });
});

describe('a swipe that resolves after the deck was reset', () => {
  it('does not skip the card dealt after the reset', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    store.getState().dealNext();
    const pending = store.getState().swipe('pass'); // persists asynchronously
    // meanwhile the deck is reset and a new card is dealt (what the deck does after hydrate / re-measure)
    store.setState({ deck: { current: null, notInYourSize: 0, exhausted: false } });
    store.getState().dealNext();
    const fresh = store.getState().deck.current;
    await pending;
    expect(store.getState().deck.current).toBe(fresh);
  });
});

describe('the bundled demo rail stays on the device', () => {
  it('queues no server write for swipes / saves on demo garments (the API rejects the whole batch for an unknown shop)', async () => {
    const store = createAppStore({ db });
    await store.getState().hydrate();
    await store.getState().setProfile(PROFILE);
    store.getState().dealNext();
    await store.getState().swipe('love');
    await store.getState().swipe('save');
    expect(await db.outbox.where('kind').anyOf('swipe', 'wardrobe', 'save').count()).toBe(0);
    // still recorded locally: taste, swipe history, wardrobe
    expect(await db.swipes.count()).toBeGreaterThanOrEqual(2);
    expect(store.getState().wardrobe).toHaveLength(1);
    expect(store.getState().taste.profile.swipeCount).toBe(2);
  });
});
