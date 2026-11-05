import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDb } from '@/db/db';
import { OutboxSyncer } from '@/sync/outbox';
import type { ApiClient } from '@/api/client';

let db: AppDb;
let dbName = '';

beforeEach(() => {
  dbName = `paskamer-outbox-${Math.random().toString(36).slice(2)}`;
  db = new AppDb(dbName);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  db.close();
  await AppDb.delete(dbName);
});

const EVENT = { itemId: 'x', action: 'love' as const, at: 1, sizeAtSwipe: 'M', fitScore: 0.9, dealIndex: 1 };

describe('OutboxSyncer offline behaviour', () => {
  it('does not poll the database every 500 ms while offline; it waits for the online event', async () => {
    const listeners: (() => void)[] = [];
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('window', { addEventListener: (_: string, cb: () => void) => listeners.push(cb), removeEventListener: () => {} });
    // only the syncer's timers: fake-indexeddb needs the real setImmediate
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await db.outbox.add({ kind: 'swipe', clientId: 'c1', shopId: '00000000-0000-4000-8000-000000000001', payload: EVENT, attempts: 0, nextAt: 0, createdAt: 0 });
    const postSwipes = vi.fn(async () => ({ accepted: 1, duplicates: 0, usageEventsCreated: 0, ledgerEntryId: 'l' }));
    const syncer = new OutboxSyncer({ db, client: { postSwipes } as unknown as ApiClient, now: () => Date.now() });
    const schedule = vi.spyOn(syncer, 'schedule');
    syncer.start();
    await vi.advanceTimersByTimeAsync(10);
    await syncer.flush();
    const after = schedule.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(postSwipes).not.toHaveBeenCalled();
    expect(schedule.mock.calls.length - after, 'reschedules while offline').toBe(0);

    // back online → the listener flushes
    (navigator as { onLine: boolean }).onLine = true;
    for (const l of listeners) l();
    await vi.waitFor(() => expect(postSwipes).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    syncer.stop();
  });

  it('backs off exponentially after a network failure and drops permanent 4xx rows', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    let now = 1_000_000;
    await db.outbox.add({ kind: 'swipe', clientId: 'c1', shopId: '00000000-0000-4000-8000-000000000001', payload: EVENT, attempts: 0, nextAt: 0, createdAt: 0 });
    const { NetworkError, ApiError } = await import('@/api/client');
    const postSwipes = vi.fn<() => Promise<unknown>>().mockRejectedValueOnce(new NetworkError('offline')).mockRejectedValueOnce(new ApiError(422, 'bad', 'invalid'));
    const syncer = new OutboxSyncer({ db, client: { postSwipes } as unknown as ApiClient, now: () => now });
    await syncer.flush();
    const row = (await db.outbox.toArray())[0]!;
    expect(row.attempts).toBe(1);
    expect(row.nextAt).toBe(now + 1000);
    now += 1000;
    await syncer.flush();
    expect(await db.outbox.count()).toBe(0);
    syncer.stop();
  });
});

describe('OutboxSyncer batching', () => {
  it('sends one batch per shop, so one unknown shop (422) cannot drop the other shops’ swipes', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    await db.outbox.bulkAdd([
      { kind: 'swipe', clientId: 'a1', shopId: A, payload: EVENT, attempts: 0, nextAt: 0, createdAt: 0 },
      { kind: 'swipe', clientId: 'b1', shopId: B, payload: { ...EVENT, itemId: 'y' }, attempts: 0, nextAt: 0, createdAt: 0 },
      { kind: 'swipe', clientId: 'a2', shopId: A, payload: { ...EVENT, itemId: 'z' }, attempts: 0, nextAt: 0, createdAt: 0 },
    ]);
    const { ApiError } = await import('@/api/client');
    const sent: string[][] = [];
    const postSwipes = vi.fn(async (batch: { events: { shopId: string; clientId: string }[] }) => {
      sent.push(batch.events.map((e) => e.clientId));
      if (batch.events.some((e) => e.shopId === A)) throw new ApiError(422, 'unknown_shop', `unknown shop ${A}`);
      return { accepted: batch.events.length, duplicates: 0, usageEventsCreated: 0, ledgerEntryId: 'l' };
    });
    const syncer = new OutboxSyncer({ db, client: { postSwipes } as unknown as ApiClient, now: () => 1 });
    await syncer.flush();
    expect(sent).toContainEqual(['b1']);
    expect(sent).toContainEqual(['a1', 'a2']);
    expect(await db.outbox.count()).toBe(0); // B delivered, A permanently rejected
    await syncer.stop();
  });
});
