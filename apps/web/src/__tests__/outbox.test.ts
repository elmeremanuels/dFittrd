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
    vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(10);
    expect(postSwipes).toHaveBeenCalledTimes(1);
    expect(await db.outbox.count()).toBe(0);
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
