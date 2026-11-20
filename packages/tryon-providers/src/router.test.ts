import { describe, expect, it } from 'vitest';
import { AuthError, ModerationError, NoProviderAvailableError, PoseError, PolicyError, TimeoutError } from './errors.js';
import { MockProvider } from './providers/mock.js';
import { CircuitBreaker, MemorySpendStore, TryOnRouter, parseOrder, utcDay } from './router.js';
import { garment, makePng, person } from './test-utils.js';
import type { LedgerRecord } from './types.js';

async function fixtures() {
  const avatar = await makePng(300, 400);
  const flat = await makePng(50, 50);
  return { p: person(avatar), g: garment(flat) };
}

describe('TryOnRouter', () => {
  it('picks the first provider in order that supports the category and returns a ledger record', async () => {
    const { p, g } = await fixtures();
    const ledger: LedgerRecord[] = [];
    const a = new MockProvider({ name: 'a', categories: ['top'] });
    const b = new MockProvider({ name: 'b', costUsd: 0.06, euResidency: true });
    const router = new TryOnRouter({ providers: [a, b], policy: { order: ['a', 'b'], maxCostUsd: 0.5 }, onLedger: (r) => void ledger.push(r) });
    const { result, ledger: rec, attempts } = await router.render(p, g, { quality: 'balanced' });
    expect(result.provider).toBe('b');
    expect(attempts).toEqual([{ provider: 'a', reason: 'does not support category "dress"' }]);
    expect(rec).toMatchObject({ provider: 'b', model: 'mock-stamp', costUsd: 0.06, retentionHours: 0, trainedOn: false, region: 'local', kind: 'image' });
    expect(ledger).toHaveLength(1);
    expect(await router.spentTodayUsd()).toBe(0.06);
  });

  it('falls through on PoseError and timeouts, but not on moderation', async () => {
    const { p, g } = await fixtures();
    const pose = new MockProvider({ name: 'pose', failWith: new PoseError('no pose') });
    const slow = new MockProvider({ name: 'slow', failWith: new TimeoutError('late') });
    const ok = new MockProvider({ name: 'ok' });
    const router = new TryOnRouter({ providers: [pose, slow, ok], policy: { order: ['pose', 'slow', 'ok'], maxCostUsd: 1 } });
    const out = await router.render(p, g, { quality: 'balanced' });
    expect(out.result.provider).toBe('ok');
    expect(out.attempts.map((a) => a.error?.code)).toEqual(['pose', 'timeout']);

    const mod = new MockProvider({ name: 'mod', failWith: new ModerationError('nope') });
    const router2 = new TryOnRouter({ providers: [mod, ok], policy: { order: ['mod', 'ok'], maxCostUsd: 1 } });
    await expect(router2.render(p, g, { quality: 'balanced' })).rejects.toBeInstanceOf(ModerationError);
    expect(ok.calls).toHaveLength(1);
  });

  it('enforces maxCostUsd and dailyCapUsd', async () => {
    const { p, g } = await fixtures();
    const pricey = new MockProvider({ name: 'pricey', costUsd: 0.225 });
    const cheap = new MockProvider({ name: 'cheap', costUsd: 0.06 });
    const router = new TryOnRouter({ providers: [pricey, cheap], policy: { order: ['pricey', 'cheap'], maxCostUsd: 0.1, dailyCapUsd: 0.1 } });
    const first = await router.render(p, g, { quality: 'balanced' });
    expect(first.result.provider).toBe('cheap');
    expect(first.attempts[0]?.reason).toMatch(/exceeds maxCostUsd/);
    const err = await router.render(p, g, { quality: 'balanced' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoProviderAvailableError);
    expect((err as NoProviderAvailableError).attempts.find((a) => a.provider === 'cheap')?.reason).toMatch(/daily cap/);
    expect((err as NoProviderAvailableError).attempts.find((a) => a.provider === 'cheap')?.error?.code).toBe('budget');
  });

  it('requireEuResidency skips non-EU providers and skips unhealthy / unknown ones', async () => {
    const { p, g } = await fixtures();
    const us = new MockProvider({ name: 'us', euResidency: false });
    const sick = new MockProvider({ name: 'sick', healthy: false });
    const eu = new MockProvider({ name: 'eu', euResidency: true });
    const router = new TryOnRouter({ providers: [us, sick, eu], policy: { order: ['ghost', 'us', 'sick', 'eu'], maxCostUsd: 1, requireEuResidency: true } });
    const out = await router.render(p, g, { quality: 'balanced' });
    expect(out.result.provider).toBe('eu');
    expect(out.attempts.map((a) => a.reason)).toEqual(['not registered', 'no EU residency', 'unhealthy: mock unhealthy']);
    expect(out.attempts[1]?.error).toBeInstanceOf(PolicyError);
    expect(us.calls).toHaveLength(0);
  });

  it('opens the circuit after 3 consecutive failures and closes it after 60 s', async () => {
    const { p, g } = await fixtures();
    let now = 1_700_000_000_000;
    let fails = 3;
    const flaky = new MockProvider({ name: 'flaky', failWith: () => (fails-- > 0 ? new AuthError('key expired') : undefined) });
    const backup = new MockProvider({ name: 'backup' });
    const router = new TryOnRouter({ providers: [flaky, backup], policy: { order: ['flaky', 'backup'], maxCostUsd: 1 }, clock: () => now });

    for (let i = 0; i < 3; i++) {
      const out = await router.render(p, g, { quality: 'balanced' });
      expect(out.result.provider).toBe('backup');
      expect(out.attempts[0]?.error?.code).toBe('auth');
    }
    expect(flaky.calls).toHaveLength(3);
    expect(router.circuit.snapshot().flaky).toEqual({ consecutiveFailures: 3, openUntil: now + 60_000 });

    // while open: skipped without being called
    now += 30_000;
    const skipped = await router.render(p, g, { quality: 'balanced' });
    expect(skipped.attempts[0]).toEqual({ provider: 'flaky', reason: 'circuit open' });
    expect(flaky.calls).toHaveLength(3);

    // after cooldown: probed again, succeeds, breaker resets
    now += 31_000;
    const recovered = await router.render(p, g, { quality: 'balanced' });
    expect(recovered.result.provider).toBe('flaky');
    expect(router.circuit.snapshot().flaky).toEqual({ consecutiveFailures: 0, openUntil: null });
  });

  it('a half-open probe that fails re-opens immediately', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 }, () => now);
    cb.recordFailure('x');
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(false);
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(true);
    now = 60_000;
    expect(cb.isOpen('x')).toBe(false);
    cb.recordFailure('x');
    expect(cb.isOpen('x')).toBe(true);
  });

  it('routes video to providers with animate() and ledgers it as video', async () => {
    const { g } = await fixtures();
    const stillOnly = new MockProvider({ name: 'still', video: false });
    const vid = new MockProvider({ name: 'vid', costUsd: 0.48 });
    const router = new TryOnRouter({ providers: [stillOnly, vid], policy: { order: ['still', 'vid'], maxCostUsd: 1 } });
    const out = await router.animate(await makePng(10, 10), g, { durationSec: 6, resolution: '720p' });
    expect(out.result.provider).toBe('vid');
    expect(out.ledger.kind).toBe('video');
    expect(out.attempts[0]?.reason).toBe('no video support');
    expect(vid.calls[0]?.kind).toBe('video');
  });

  it('validates policy and parses TRYON_ORDER', () => {
    expect(() => new TryOnRouter({ providers: [], policy: { order: [], maxCostUsd: 1 } })).toThrow(PolicyError);
    expect(() => new TryOnRouter({ providers: [], policy: { order: ['a'], maxCostUsd: 0 } })).toThrow(PolicyError);
    expect(parseOrder('fashn, vertex-tryon ,,mock')).toEqual(['fashn', 'vertex-tryon', 'mock']);
    expect(parseOrder(undefined)).toEqual(['fashn', 'vertex-tryon']);
    expect(parseOrder('  ')).toEqual(['fashn', 'vertex-tryon']);
    expect(utcDay(Date.UTC(2026, 10, 4, 23, 59))).toBe('2026-11-04');
    const store = new MemorySpendStore();
    store.add('2026-11-04', 0.1);
    store.add('2026-11-04', 0.2);
    expect(store.get('2026-11-04')).toBeCloseTo(0.3);
    expect(store.get('2026-11-05')).toBe(0);
  });
});
