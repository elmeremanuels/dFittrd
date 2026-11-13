/**
 * Durable outbox → API, offline-safe with retry. Rows live in the `outbox` table; this module
 * drains them in order: swipes are batched (≤ 100) to POST /v1/swipes, save/wardrobe rows go to
 * PUT /v1/wardrobe/:productId, the fit signature to PUT /v1/me/signature and "Delete my scan" to
 * DELETE /v1/me/signature. The signature PUT and DELETE rows go out in queue order, one at a time,
 * so a PUT queued before a delete can never land after it (PRIV-1). The swipe route accepts a
 * batch per event (#23): the rows the server stored (`acceptedClientIds`) and the ones it rejected
 * (always permanent) are deleted; a row the response does not mention stays and is retried.
 * Network errors and 5xx back
 * off exponentially (1 s · 2^n, max 10 min); permanent 4xx rows are dropped with the error
 * recorded, and so are rows after MAX_ATTEMPTS, except the signature delete, which retries until
 * the server confirms. No body data is ever in this queue (taste-engine contract 2).
 */
import { isKnownWardrobeSize, WARDROBE_SIZE_UNKNOWN, type SwipeBatchRequest, type SwipeBatchResponse, type SwipeWireEvent, type WardrobePutRequest, type FitSignatureWire } from '@curtain/schema';
import { isSaveOutboxEntry, type OutboxEntry } from '@curtain/taste-engine';
import { ApiError, type ApiClient } from '@/api/client';
import type { AppDb, OutboxRow } from '@/db/db';
import { isOnline, onOnline } from '@/platform/download';

export const MAX_BATCH = 100;
export const MAX_ATTEMPTS = 12;

export function backoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 1000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Split the rows of one swipe batch by the server's per-event answer (#23). `rows[i]` was sent as
 * `events[i]`. Stored = clientId in `acceptedClientIds` (new or duplicate); rejected = reported in
 * `rejected` (every reason is permanent); unanswered = neither, kept for a retry.
 */
export function settleSwipeBatch(rows: readonly OutboxRow[], res: Pick<SwipeBatchResponse, 'acceptedClientIds' | 'rejected'>): { stored: OutboxRow[]; rejected: OutboxRow[]; unanswered: OutboxRow[] } {
  // A response without the per-event lists (an older server) settles nothing: every row is retried,
  // which is safe because the server deduplicates by clientId.
  const rejectedList = res.rejected ?? [];
  const acceptedIds = new Set(res.acceptedClientIds ?? []);
  const rejectedIdx = new Set(rejectedList.map((r) => r.index));
  const rejectedIds = new Set(rejectedList.map((r) => r.clientId).filter((id): id is string => id !== null));
  const stored: OutboxRow[] = [];
  const rejected: OutboxRow[] = [];
  const unanswered: OutboxRow[] = [];
  rows.forEach((row, i) => {
    if (acceptedIds.has(row.clientId)) stored.push(row);
    else if (rejectedIdx.has(i) || rejectedIds.has(row.clientId)) rejected.push(row);
    else unanswered.push(row);
  });
  return { stored, rejected, unanswered };
}

export interface SyncerOptions {
  db: AppDb;
  client: ApiClient;
  now?: () => number;
  onChange?: (pending: number) => void;
  onSynced?: (kind: OutboxRow['kind'], count: number) => void;
}

export class OutboxSyncer {
  private running = false;
  private queued = false;
  /** Between start() and stop(); a stopped syncer never re-arms its timer (an in-flight flush may finish). */
  private active = false;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopOnline: (() => void) | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: SyncerOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  start(): void {
    this.stopOnline?.(); // idempotent: never two online listeners
    this.active = true;
    this.stopOnline = onOnline(() => void this.flush().catch(() => undefined));
    this.schedule(0);
  }

  /** Stops the timer and the online listener; resolves once a flush already in flight has finished. */
  stop(): Promise<void> {
    this.active = false;
    this.stopOnline?.();
    this.stopOnline = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return (this.inflight ?? Promise.resolve()).catch(() => undefined);
  }

  schedule(delayMs = 250): void {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // a background drain must never surface as an unhandled rejection (e.g. the db closed meanwhile)
      void this.flush().catch(() => undefined);
    }, delayMs);
  }

  async pending(): Promise<number> {
    return this.opts.db.outbox.count();
  }

  /** Drain everything that is due. Re-entrancy safe: a flush requested while one runs queues one more. */
  async flush(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    const run = this.drain();
    this.inflight = run;
    try {
      await run;
    } finally {
      if (this.inflight === run) this.inflight = null;
    }
  }

  private async drain(): Promise<void> {
    const online = isOnline();
    try {
      if (online) {
        await this.flushOnce();
      }
    } finally {
      this.running = false;
      const pending = await this.opts.db.outbox.count();
      this.opts.onChange?.(pending);
      if (this.queued) {
        this.queued = false;
        this.schedule(50);
      } else if (pending > 0 && online) {
        // Offline: no polling (battery); the `online` listener from start() resumes the drain.
        const next = await this.opts.db.outbox.orderBy('nextAt').first();
        if (next) this.schedule(Math.max(500, next.nextAt - this.now()));
      }
    }
  }

  private async flushOnce(): Promise<void> {
    const { db } = this.opts;
    const due = await db.outbox.where('nextAt').belowOrEqual(this.now()).sortBy('seq');
    if (due.length === 0) return;

    // One batch per shop. The API reports rejected events one by one (#23), so a shop erased by
    // shop/redact no longer fails the others; per-shop batches still keep a whole-batch failure
    // (a permanent 4xx on the envelope) from taking other shops' swipes, and their billable intent
    // tokens, with it, and give the privacy ledger one shop per entry.
    const swipes = due.filter((r) => r.kind === 'swipe').slice(0, MAX_BATCH);
    const byShop = new Map<string, OutboxRow[]>();
    for (const row of swipes) {
      const key = row.shopId ?? '';
      byShop.set(key, [...(byShop.get(key) ?? []), row]);
    }
    for (const rows of byShop.values()) await this.sendSwipes(rows);

    for (const row of due.filter((r) => r.kind === 'signature' || r.kind === 'signature_delete')) {
      if (row.kind === 'signature') await this.sendSignature(row);
      else await this.sendSignatureDelete(row);
    }
    for (const row of due.filter((r) => r.kind === 'wardrobe' || r.kind === 'save')) await this.sendWardrobe(row);
  }

  private async sendSwipes(rows: OutboxRow[]): Promise<void> {
    const events: SwipeWireEvent[] = [];
    const sendable: OutboxRow[] = [];
    for (const row of rows) {
      const entry = row.payload as OutboxEntry;
      if (isSaveOutboxEntry(entry) || !row.shopId) {
        // save markers are mirrored through the wardrobe route; a swipe without a shop cannot be billed/stored.
        await this.opts.db.outbox.delete(row.seq!);
        continue;
      }
      const wire: SwipeWireEvent = { ...entry, shopId: row.shopId, clientId: row.clientId };
      if (row.intentToken) wire.intentToken = row.intentToken;
      events.push(wire);
      sendable.push(row);
    }
    if (events.length === 0) return;
    const batch: SwipeBatchRequest = { events };
    let res: SwipeBatchResponse;
    try {
      res = await this.opts.client.postSwipes(batch);
    } catch (e) {
      await this.fail(sendable, e);
      return;
    }
    const { stored, rejected, unanswered } = settleSwipeBatch(sendable, res);
    await this.opts.db.outbox.bulkDelete([...stored, ...rejected].map((r) => r.seq!));
    if (stored.length > 0) this.opts.onSynced?.('swipe', stored.length);
    // A row the server neither stored nor rejected (should not happen) is retried with backoff.
    if (unanswered.length > 0) await this.fail(unanswered, new Error('swipe not acknowledged by the server'));
  }

  private async sendSignature(row: OutboxRow): Promise<void> {
    try {
      await this.opts.client.putSignature(row.payload as FitSignatureWire);
      // "Delete my scan" may have removed this row while the PUT was in flight; its DELETE row
      // then goes out after this PUT (same drain, queue order), and this PUT must not report a sync.
      const current = await this.opts.db.outbox.get(row.seq!);
      if (!current) return;
      await this.opts.db.outbox.delete(row.seq!);
      this.opts.onSynced?.('signature', 1);
    } catch (e) {
      await this.fail([row], e);
    }
  }

  private async sendSignatureDelete(row: OutboxRow): Promise<void> {
    try {
      await this.opts.client.deleteSignature();
      await this.opts.db.outbox.delete(row.seq!);
      this.opts.onSynced?.('signature_delete', 1);
    } catch (e) {
      await this.fail([row], e);
    }
  }

  private async sendWardrobe(row: OutboxRow): Promise<void> {
    const p = row.payload as { productId: string; shopId: string; size: string | null; state: WardrobePutRequest['state'] };
    // An unknown size is sent as the explicit marker (#24); a row queued by an older build may hold null.
    const size = isKnownWardrobeSize(p.size) ? p.size : WARDROBE_SIZE_UNKNOWN;
    try {
      await this.opts.client.putWardrobe(p.productId, { shopId: p.shopId, size, state: p.state });
      await this.opts.db.outbox.delete(row.seq!);
      this.opts.onSynced?.('wardrobe', 1);
    } catch (e) {
      await this.fail([row], e);
    }
  }

  private async fail(rows: OutboxRow[], e: unknown): Promise<void> {
    const permanent = e instanceof ApiError && e.permanent;
    const message = e instanceof Error ? e.message : String(e);
    for (const row of rows) {
      const attempts = row.attempts + 1;
      // An erase is never given up on for being slow: only a permanent 4xx (nothing to delete) ends it.
      if (permanent || (attempts >= MAX_ATTEMPTS && row.kind !== 'signature_delete')) {
        await this.opts.db.outbox.delete(row.seq!);
        continue;
      }
      await this.opts.db.outbox.update(row.seq!, { attempts, nextAt: this.now() + backoffMs(attempts), lastError: message.slice(0, 200) });
    }
  }
}
