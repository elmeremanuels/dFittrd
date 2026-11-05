/**
 * App state: a zustand store hydrated from, and persisted to, the on-device Dexie database
 * (`src/db/db.ts`). Everything here stays on the device; what leaves goes through the outbox
 * (`src/sync/outbox.ts`) and the API client, both of which write the privacy ledger.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { FitResult } from '@paskamer/fit-engine';
import { MOCK_GARMENTS, type BodyProfile, type FitSignatureWire, type GarmentPayload, type ShopBranding, type SwipeAction, type SwipeEvent, type WardrobeState } from '@paskamer/schema';
import {
  applyOnboardingVibes,
  applySwipe,
  dealNext as dealNextCard,
  drainOutbox,
  isSaveOutboxEntry,
  type FitResultLike,
  type ScoredItem,
  type TasteState,
} from '@paskamer/taste-engine';
import { deleteScan, saveBodyProfile } from '@/features/capture/storage';
import type { SkinEstimate } from '@/features/capture/types';
import { clearAppTables, type AppDb, type ClientLedgerEntry, type ConsentTier, type OutboxRow, type PendingIntentRow, type SettingsRow, SINGLETON_ID, type WardrobeRow } from '@/db/db';
import type { ApiClient, DeviceCredentials } from '@/api/client';
import { newId } from '@/lib/ids';
import { seasonKey } from '@/lib/season';
import { fitContextFromProfile, fitFor, hasMeasurements, type FitContext } from './fit';
import { defaultSettings, loadSnapshot, normaliseTaste, saveLedgerEntry, saveSettings, saveTaste, LEDGER_KEEP } from './persist';
import { OutboxSyncer } from '@/sync/outbox';

/** Shop id used for the bundled fixtures until a real shop is paired (valid uuid, never a real shop). */
export const MOCK_SHOP_ID = '00000000-0000-4000-8000-000000000001';
export const MOCK_SHOP: ShopBranding = { id: MOCK_SHOP_ID, name: 'Paskamer demo rail', platform: 'shopify', paused: false };

/** Without measurements the deck still deals (fit unknown, score weight 0); events then carry null size/score. */
const NO_FIT: FitResultLike = { recommendedSize: 'unknown', score: null };

export interface CatalogItem {
  garment: GarmentPayload;
  shopId: string;
}

export interface DeckState {
  current: ScoredItem<GarmentPayload> | null;
  notInYourSize: number;
  exhausted: boolean;
}

export interface SwipeContext {
  garment?: GarmentPayload;
  shopId?: string;
  intentToken?: string;
}

export interface AppState {
  hydrated: boolean;
  settings: SettingsRow;
  profile: BodyProfile | null;
  fitCtx: FitContext | null;
  taste: TasteState;
  wardrobe: WardrobeRow[];
  ledger: ClientLedgerEntry[];
  pendingIntent: PendingIntentRow | null;
  catalog: CatalogItem[];
  catalogSource: 'mock' | 'paired';
  deck: DeckState;
  outboxPending: number;
  lastSync: { kind: OutboxRow['kind']; count: number; at: number } | null;

  hydrate: () => Promise<void>;
  fit: (garment: GarmentPayload) => FitResult | null;
  hasMeasurements: () => boolean;
  /** Shop of a catalogue garment (by object first: ids are only unique within one shop). */
  shopIdFor: (garment: GarmentPayload) => string;

  setProfile: (profile: BodyProfile, extras?: { skin?: SkinEstimate | null; signature?: FitSignatureWire | null }) => Promise<void>;
  completeOnboarding: (vibes: string[]) => Promise<void>;
  updateSettings: (patch: Partial<SettingsRow>) => Promise<void>;
  setConsent: (tier: ConsentTier) => Promise<void>;

  dealNext: () => void;
  swipe: (action: SwipeAction, ctx?: SwipeContext) => Promise<SwipeEvent | null>;
  saveToWardrobe: (garment: GarmentPayload, shopId: string, size: string | null, intentToken?: string) => Promise<void>;
  setWardrobeState: (productId: string, state: WardrobeState) => Promise<void>;

  setPendingIntent: (token: string | null) => Promise<void>;
  addPairedShop: (shop: ShopBranding, products: GarmentPayload[]) => Promise<void>;
  appendLedger: (entry: ClientLedgerEntry) => Promise<void>;

  deleteScanLocal: () => Promise<void>;
  deleteEverything: () => Promise<void>;
  exportLocal: () => Promise<Record<string, unknown>>;
  flushOutbox: () => Promise<void>;
  deviceCredentials: () => DeviceCredentials;
  setDeviceCredentials: (d: { deviceId: string; token: string; expiresAt: string }) => Promise<void>;
}

export interface StoreDeps {
  db: AppDb;
  /** Attached after construction (the client needs the store for credentials + ledger). */
  client?: ApiClient;
  now?: () => number;
  /** Starting catalogue; defaults to the schema fixtures. */
  catalog?: CatalogItem[];
}

export type AppStore = UseBoundStore<StoreApi<AppState>>;

function mockCatalog(): CatalogItem[] {
  return MOCK_GARMENTS.map((garment) => ({ garment, shopId: MOCK_SHOP_ID }));
}

export function createAppStore(deps: StoreDeps): AppStore & { attachClient: (c: ApiClient) => void; syncer: OutboxSyncer | null } {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());
  let client: ApiClient | null = deps.client ?? null;
  let syncer: OutboxSyncer | null = null;

  const store = create<AppState>()((set, get) => {
    const garmentsOf = (catalog: CatalogItem[]): GarmentPayload[] => catalog.map((c) => c.garment);

    const enqueue = async (rows: Omit<OutboxRow, 'seq' | 'attempts' | 'nextAt' | 'createdAt'>[]): Promise<void> => {
      if (rows.length === 0) return;
      const t = now();
      await db.outbox.bulkAdd(rows.map((r) => ({ ...r, attempts: 0, nextAt: t, createdAt: t })));
      set({ outboxPending: await db.outbox.count() });
      syncer?.schedule();
    };

    const persistProfile = async (profile: BodyProfile): Promise<void> => {
      await saveBodyProfile(profile, db);
    };

    return {
      hydrated: false,
      settings: defaultSettings(),
      profile: null,
      fitCtx: null,
      taste: normaliseTaste(null),
      wardrobe: [],
      ledger: [],
      pendingIntent: null,
      catalog: deps.catalog ?? mockCatalog(),
      catalogSource: 'mock',
      deck: { current: null, notInYourSize: 0, exhausted: false },
      outboxPending: 0,
      lastSync: null,

      async hydrate() {
        const snap = await loadSnapshot(db);
        set({
          hydrated: true,
          settings: snap.settings,
          profile: snap.profile,
          fitCtx: fitContextFromProfile(snap.profile),
          taste: snap.taste,
          wardrobe: snap.wardrobe,
          ledger: snap.ledger,
          pendingIntent: snap.pendingIntent,
          outboxPending: snap.outboxPending,
        });
        if (snap.settings.pairedShops.length > 0 && client) {
          const items: CatalogItem[] = [];
          for (const shop of snap.settings.pairedShops) {
            try {
              const res = await client.shopProducts(shop.id);
              items.push(...res.items.map((garment) => ({ garment, shopId: shop.id })));
            } catch {
              /* offline: keep what we have */
            }
          }
          // The deck may already hold a card dealt from the bundled demo rail: re-deal from the shops.
          if (items.length > 0) set({ catalog: items, catalogSource: 'paired', deck: { current: null, notInYourSize: 0, exhausted: false } });
        }
        syncer?.start();
      },

      fit(garment) {
        return fitFor(get().fitCtx, garment);
      },

      hasMeasurements() {
        return hasMeasurements(get().fitCtx);
      },

      shopIdFor(garment) {
        const { catalog } = get();
        return (catalog.find((c) => c.garment === garment) ?? catalog.find((c) => c.garment.id === garment.id))?.shopId ?? MOCK_SHOP_ID;
      },

      async setProfile(profile, extras) {
        const next: BodyProfile = { ...profile, updatedAt: now(), createdAt: profile.createdAt ?? now() };
        await persistProfile(next);
        const patch: Partial<SettingsRow> = {};
        if (extras?.skin) {
          patch.season = seasonKey(extras.skin.season?.season ?? null);
          patch.undertone = extras.skin.undertone;
          patch.skinHex = extras.skin.srgbHex;
        }
        set({ profile: next, fitCtx: fitContextFromProfile(next), deck: { current: null, notInYourSize: 0, exhausted: false } });
        if (Object.keys(patch).length > 0) await get().updateSettings(patch);
        if (extras?.signature) {
          // The ONLY body-derived thing that may sync: the 80-float fit signature (D3).
          await db.outbox.where('clientId').equals('signature').delete();
          await enqueue([{ kind: 'signature', clientId: 'signature', shopId: null, payload: extras.signature }]);
        }
      },

      async completeOnboarding(vibes) {
        // Re-entering onboarding (remeasure) must not reset axes the swipes have since moved:
        // only vibes that were not chosen before are applied.
        const before = new Set(get().settings.onboarded ? get().settings.vibes : []);
        const taste = applyOnboardingVibes(get().taste, vibes.filter((v) => !before.has(v)));
        await saveTaste(db, taste);
        set({ taste });
        await get().updateSettings({ onboarded: true, vibes: [...vibes] });
      },

      async updateSettings(patch) {
        const settings = { ...get().settings, ...patch, id: SINGLETON_ID };
        await saveSettings(db, settings);
        set({ settings });
      },

      async setConsent(tier) {
        await get().updateSettings({ consentTier: tier, consentAcknowledgedAt: tier === 'heroOptIn' ? new Date(now()).toISOString() : null });
      },

      dealNext() {
        const { catalog, taste } = get();
        const res = dealNextCard(garmentsOf(catalog), taste, (g) => get().fit(g) ?? NO_FIT);
        if (!res.card) {
          set({ deck: { current: null, notInYourSize: res.notInYourSize, exhausted: true } });
          return;
        }
        set({ taste: res.state, deck: { current: res.card, notInYourSize: res.notInYourSize, exhausted: false } });
        void saveTaste(db, res.state);
      },

      async swipe(action, ctx = {}) {
        const { deck, taste } = get();
        const garment = ctx.garment ?? deck.current?.garment;
        if (!garment) return null;
        const shopId = ctx.shopId ?? get().shopIdFor(garment);
        const fit = get().fit(garment);
        const applied = applySwipe(taste, garment, fit, action, now());
        const { state, entries } = drainOutbox(applied.state);
        set({ taste: state });
        await saveTaste(db, state);

        const rows: Omit<OutboxRow, 'seq' | 'attempts' | 'nextAt' | 'createdAt'>[] = [];
        for (const entry of entries) {
          if (isSaveOutboxEntry(entry)) continue; // mirrored via saveToWardrobe below
          const clientId = newId();
          await db.swipes.add({ event: entry, shopId, clientId, ...(ctx.intentToken ? { intentToken: ctx.intentToken } : {}) });
          // The bundled demo rail is not a shop on the server: keep its swipes on the device.
          if (shopId !== MOCK_SHOP_ID) rows.push({ kind: 'swipe', clientId, shopId, payload: entry, ...(ctx.intentToken ? { intentToken: ctx.intentToken } : {}) });
        }
        await enqueue(rows);

        if (action === 'save') {
          await get().saveToWardrobe(garment, shopId, fit?.recommendedSize ?? fit?.closestSize ?? null, ctx.intentToken);
        }
        // Advance only if the swiped card is still the one on the deck: the awaits above can outlive a
        // deck reset (paired catalogue arrived, re-measure) and must not skip the freshly dealt card.
        const dealt = deck.current;
        if (dealt && dealt.garment.id === garment.id && get().deck.current === dealt) get().dealNext();
        return applied.event;
      },

      async saveToWardrobe(garment, shopId, size, intentToken) {
        const row: WardrobeRow = {
          productId: garment.id,
          shopId,
          size: size ?? 'ONE',
          state: 'saved',
          updatedAt: now(),
          garment: {
            id: garment.id,
            name: garment.name,
            brand: garment.brand,
            primaryColorHex: garment.primaryColorHex,
            priceEur: garment.priceEur,
            category: garment.category,
            ...(garment.productUrl ? { productUrl: garment.productUrl } : {}),
          },
        };
        await db.wardrobe.put(row);
        set({ wardrobe: [row, ...get().wardrobe.filter((w) => w.productId !== row.productId)] });
        if (shopId === MOCK_SHOP_ID) return; // demo rail: on-device only
        await enqueue([
          {
            kind: 'wardrobe',
            clientId: `wardrobe:${garment.id}`,
            shopId,
            payload: { productId: garment.id, shopId, size: row.size, state: 'saved' },
            ...(intentToken ? { intentToken } : {}),
          },
        ]);
      },

      async setWardrobeState(productId, state) {
        const existing = get().wardrobe.find((w) => w.productId === productId);
        if (!existing) return;
        const row: WardrobeRow = { ...existing, state, updatedAt: now() };
        await db.wardrobe.put(row);
        set({ wardrobe: get().wardrobe.map((w) => (w.productId === productId ? row : w)) });
        if (row.shopId !== MOCK_SHOP_ID) await enqueue([{ kind: 'wardrobe', clientId: `wardrobe:${productId}`, shopId: row.shopId, payload: { productId, shopId: row.shopId, size: row.size, state } }]);

        // kept / returned feed the fit engine's history tie-break (handoff §4.2)
        const profile = get().profile;
        if (profile && (state === 'kept' || state === 'returned')) {
          const history = (profile.history ?? []).filter((h) => !(h.brand === row.garment.brand && h.size === row.size));
          history.push({ brand: row.garment.brand, size: row.size, kept: state === 'kept' });
          const next: BodyProfile = { ...profile, history, updatedAt: now() };
          await persistProfile(next);
          set({ profile: next, fitCtx: fitContextFromProfile(next) });
        }
      },

      async setPendingIntent(token) {
        if (!token) {
          await db.pendingIntent.delete(SINGLETON_ID);
          set({ pendingIntent: null });
          return;
        }
        const row: PendingIntentRow = { id: SINGLETON_ID, token, createdAt: now() };
        await db.pendingIntent.put(row);
        set({ pendingIntent: row });
      },

      async addPairedShop(shop, products) {
        const shops = [...get().settings.pairedShops.filter((s) => s.id !== shop.id), shop];
        await get().updateSettings({ pairedShops: shops });
        const others = get().catalogSource === 'paired' ? get().catalog.filter((c) => c.shopId !== shop.id) : [];
        const items = [...others, ...products.map((garment) => ({ garment, shopId: shop.id }))];
        if (items.length > 0) set({ catalog: items, catalogSource: 'paired', deck: { current: null, notInYourSize: 0, exhausted: false } });
      },

      async appendLedger(entry) {
        await saveLedgerEntry(db, entry);
        set({ ledger: [entry, ...get().ledger].slice(0, LEDGER_KEEP) });
      },

      async deleteScanLocal() {
        await deleteScan(db);
        await db.outbox.where('clientId').equals('signature').delete();
        set({ profile: null, fitCtx: null, deck: { current: null, notInYourSize: 0, exhausted: false }, outboxPending: await db.outbox.count() });
        await get().updateSettings({ season: null, undertone: null, skinHex: null, signatureSyncedAt: null });
      },

      async deleteEverything() {
        const startedAt = new Date(now()).toISOString();
        // A device that never registered has nothing on the server: do not create one just to erase it.
        if (client && get().settings.deviceId) {
          try {
            await client.deleteMe();
          } catch {
            /* the local erase still happens; the ledger has the failed attempt */
          }
        }
        // The record of the erase request itself survives the wipe (it is the proof it was sent).
        const eraseEntries = get().ledger.filter((l) => l.kind === 'erase' && l.at >= startedAt);
        await deleteScan(db);
        await clearAppTables(db);
        if (eraseEntries.length > 0) await db.ledger.bulkPut(eraseEntries);
        set({
          settings: defaultSettings(),
          profile: null,
          fitCtx: null,
          taste: normaliseTaste(null),
          wardrobe: [],
          ledger: eraseEntries,
          pendingIntent: null,
          catalog: mockCatalog(),
          catalogSource: 'mock',
          deck: { current: null, notInYourSize: 0, exhausted: false },
          outboxPending: 0,
        });
      },

      async exportLocal() {
        const s = get();
        let server: unknown = null;
        if (client && s.settings.deviceId) {
          try {
            server = await client.exportMe();
          } catch (e) {
            server = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        return {
          exportedAt: new Date(now()).toISOString(),
          device: { onboarded: s.settings.onboarded, consentTier: s.settings.consentTier, season: s.settings.season, undertone: s.settings.undertone },
          measurements: s.profile,
          taste: s.taste.profile,
          wardrobe: s.wardrobe,
          swipes: await db.swipes.toArray(),
          ledger: s.ledger,
          server,
        };
      },

      async flushOutbox() {
        await syncer?.flush();
      },

      deviceCredentials() {
        const s = get().settings;
        return { deviceId: s.deviceId, token: s.deviceToken, expiresAt: s.deviceTokenExpiresAt };
      },

      async setDeviceCredentials(d) {
        await get().updateSettings({ deviceId: d.deviceId || get().settings.deviceId, deviceToken: d.token || null, deviceTokenExpiresAt: d.expiresAt });
      },
    };
  });

  const attachClient = (c: ApiClient): void => {
    client = c;
    syncer = new OutboxSyncer({
      db,
      client: c,
      now,
      onChange: (pending) => store.setState({ outboxPending: pending }),
      onSynced: (kind, count) => {
        const patch: Partial<AppState> = { lastSync: { kind, count, at: now() } };
        store.setState(patch);
        if (kind === 'signature') void store.getState().updateSettings({ signatureSyncedAt: new Date(now()).toISOString() });
      },
    });
    if (store.getState().hydrated) syncer.start();
  };

  return Object.assign(store, {
    attachClient,
    get syncer() {
      return syncer;
    },
  });
}
