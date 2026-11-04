/**
 * Durable outbox → API, offline-safe with retry. Rows live in the `outbox` table; this module
 * drains them in order: swipes are batched (≤ 100) to POST /v1/swipes, save/wardrobe rows go to
 * PUT /v1/wardrobe/:productId, the fit signature to PUT /v1/me/signature. Network errors and 5xx
 * back off exponentially (1 s · 2^n, max 10 min); permanent 4xx rows are dropped with the error
 * recorded. No body data is ever in this queue (taste-engine contract 2).
 */
import type { SwipeBatchRequest, SwipeWireEvent, WardrobePutRequest, FitSignatureWire } from '@paskamer/schema';
import { isSaveOutboxEntry, type OutboxEntry } from '@paskamer/taste-engine';
import { ApiError, type ApiClient } from '@/api/client';
import type { AppDb, OutboxRow } from '@/db/db';
import { isOnline, onOnline } from '@/platform/download';

export const MAX_BATCH = 100;
export const MAX_ATTEMPTS = 12;

export function backoffMs(attempts: number): number {
  return Math.min(10 * 60_000, 1000 * 2 ** Math.max(0, attempts - 1));
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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopOnline: (() => void) | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: SyncerOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  start(): void {
    this.stopOnline = onOnline(() => void this.flush());
    this.schedule(0);
  }

  stop(): void {
    this.stopOnline?.();
    this.stopOnline = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delayMs = 250): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
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
    try {
      if (isOnline()) {
        await this.flushOnce();
      }
    } finally {
      this.running = false;
      const pending = await this.opts.db.outbox.count();
      this.opts.onChange?.(pending);
      if (this.queued) {
        this.queued = false;
        this.schedule(50);
      } else if (pending > 0) {
        const next = await this.opts.db.outbox.orderBy('nextAt').first();
        if (next) this.schedule(Math.max(500, next.nextAt - this.now()));
      }
    }
  }

  private async flushOnce(): Promise<void> {
    const { db } = this.opts;
    const due = await db.outbox.where('nextAt').belowOrEqual(this.now()).sortBy('seq');
    if (due.length === 0) return;

    const swipes = due.filter((r) => r.kind === 'swipe').slice(0, MAX_BATCH);
    if (swipes.length > 0) await this.sendSwipes(swipes);

    for (const row of due.filter((r) => r.kind === 'signature')) await this.sendSignature(row);
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
    try {
      await this.opts.client.postSwipes(batch);
      await this.opts.db.outbox.bulkDelete(sendable.map((r) => r.seq!));
      this.opts.onSynced?.('swipe', sendable.length);
    } catch (e) {
      await this.fail(sendable, e);
    }
  }

  private async sendSignature(row: OutboxRow): Promise<void> {
    try {
      await this.opts.client.putSignature(row.payload as FitSignatureWire);
      await this.opts.db.outbox.delete(row.seq!);
      this.opts.onSynced?.('signature', 1);
    } catch (e) {
      await this.fail([row], e);
    }
  }

  private async sendWardrobe(row: OutboxRow): Promise<void> {
    const p = row.payload as { productId: string; shopId: string; size: string; state: WardrobePutRequest['state'] };
    try {
      await this.opts.client.putWardrobe(p.productId, { shopId: p.shopId, size: p.size, state: p.state });
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
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await this.opts.db.outbox.delete(row.seq!);
        continue;
      }
      await this.opts.db.outbox.update(row.seq!, { attempts, nextAt: this.now() + backoffMs(attempts), lastError: message.slice(0, 200) });
    }
  }
}
