import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID } from '@paskamer/schema';
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
  dbName = `paskamer-test-${Math.random().toString(36).slice(2)}`;
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
    const store = createAppStore({ db });
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
    await store.getState().saveToWardrobe(wrap, MOCK_SHOP_ID, 'M');
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
    expect(s.taste.seen[first!.garment.id]).toBe(-1);
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
    await store.getState().setWardrobeState(wrap.id, 'returned');
    expect(store.getState().profile?.history).toEqual([{ brand: wrap.brand, size: 'M', kept: false }]);
    expect(store.getState().fitCtx?.userBody.history).toEqual([{ brand: wrap.brand, size: 'M', kept: false }]);
    await store.getState().setWardrobeState(wrap.id, 'kept');
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
