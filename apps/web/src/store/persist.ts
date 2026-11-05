import type { TasteState } from '@curtain/taste-engine';
import { emptyState } from '@curtain/taste-engine';
import { loadBodyProfile } from '@/features/capture/storage';
import { type AppDb, type ClientLedgerEntry, type PendingIntentRow, type SettingsRow, SINGLETON_ID, type WardrobeRow } from '@/db/db';
import type { BodyProfile } from '@curtain/schema';

export const LEDGER_KEEP = 500;

export function defaultSettings(): SettingsRow {
  return {
    id: SINGLETON_ID,
    onboarded: false,
    consentTier: 'avatar',
    consentAcknowledgedAt: null,
    season: null,
    undertone: null,
    skinHex: null,
    vibes: [],
    deviceId: null,
    deviceToken: null,
    deviceTokenExpiresAt: null,
    signatureSyncedAt: null,
    pairedShops: [],
    updatedAt: 0,
  };
}

/** A TasteState persisted by an older build may lack fields; default them under the stored object. */
export function normaliseTaste(stored: Partial<TasteState> | null | undefined): TasteState {
  const base = emptyState();
  if (!stored) return base;
  return { ...base, ...stored, profile: { ...base.profile, ...(stored.profile ?? {}) }, loveCounts: { ...base.loveCounts, ...(stored.loveCounts ?? {}) } };
}

export interface Snapshot {
  settings: SettingsRow;
  taste: TasteState;
  wardrobe: WardrobeRow[];
  ledger: ClientLedgerEntry[];
  pendingIntent: PendingIntentRow | null;
  profile: BodyProfile | null;
  outboxPending: number;
}

export async function loadSnapshot(db: AppDb): Promise<Snapshot> {
  const [settings, taste, wardrobe, ledger, pendingIntent, profile, outboxPending] = await Promise.all([
    db.settings.get(SINGLETON_ID),
    db.taste.get(SINGLETON_ID),
    db.wardrobe.orderBy('updatedAt').reverse().toArray(),
    db.ledger.orderBy('at').reverse().limit(LEDGER_KEEP).toArray(),
    db.pendingIntent.get(SINGLETON_ID),
    loadBodyProfile(db),
    db.outbox.count(),
  ]);
  return {
    settings: { ...defaultSettings(), ...(settings ?? {}) },
    taste: normaliseTaste(taste?.state),
    wardrobe,
    ledger,
    pendingIntent: pendingIntent ?? null,
    profile,
    outboxPending,
  };
}

export async function saveSettings(db: AppDb, settings: SettingsRow): Promise<void> {
  await db.settings.put({ ...settings, id: SINGLETON_ID, updatedAt: Date.now() });
}

export async function saveTaste(db: AppDb, state: TasteState): Promise<void> {
  await db.taste.put({ id: SINGLETON_ID, state, updatedAt: Date.now() });
}

export async function saveLedgerEntry(db: AppDb, entry: ClientLedgerEntry): Promise<void> {
  await db.ledger.put(entry);
}
