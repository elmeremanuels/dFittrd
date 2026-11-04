import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { LedgerEntry } from '@paskamer/schema';
import type { Db } from '../db/client.js';
import { ledgerEntries } from '../db/schema.js';

export interface LedgerWrite {
  deviceId: string;
  kind: LedgerEntry['kind'];
  payloadSummary: LedgerEntry['payloadSummary'];
  shopId?: string;
  productExternalId?: string;
  inputs?: string[];
}

/** Server copy of the privacy ledger: every network write the app makes gets one line (D3). */
export async function writeLedger(db: Db, w: LedgerWrite): Promise<LedgerEntry> {
  const [row] = await db
    .insert(ledgerEntries)
    .values({
      deviceId: w.deviceId,
      kind: w.kind,
      payloadSummary: w.payloadSummary,
      shopId: w.shopId ?? null,
      productExternalId: w.productExternalId ?? null,
      inputs: w.inputs ?? null,
    })
    .returning();
  return toDto(row!);
}

export function toDto(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
  return { id: row.id, kind: row.kind, at: row.at.toISOString(), payloadSummary: row.payloadSummary };
}

/** Field names of a JSON body (top-level only — never values). */
export function fieldNames(body: unknown): string[] {
  return body && typeof body === 'object' ? Object.keys(body as object).slice(0, 64) : [];
}

export function byteLength(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body ?? null));
}

export interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeCursor(s: string | undefined): Cursor | null {
  if (!s) return null;
  try {
    const [at, id] = Buffer.from(s, 'base64url').toString('utf8').split('|');
    if (!at || !id) return null;
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? null : { at: d, id };
  } catch {
    return null;
  }
}

export async function listLedger(db: Db, deviceId: string, cursor: string | undefined, limit: number) {
  const c = decodeCursor(cursor);
  const where = c
    ? and(eq(ledgerEntries.deviceId, deviceId), or(lt(ledgerEntries.at, c.at), and(eq(ledgerEntries.at, c.at), lt(ledgerEntries.id, c.id))))
    : eq(ledgerEntries.deviceId, deviceId);
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(where)
    .orderBy(desc(ledgerEntries.at), desc(ledgerEntries.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { entries: page.map(toDto), nextCursor: rows.length > limit && last ? encodeCursor({ at: last.at, id: last.id }) : null };
}
