/**
 * Regression tests from the platform review (Nov 2026). Each test pins a bug that was found in
 * the router / transport and fixed alongside it.
 */
import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ConfigError } from './errors.js';
import { Deadline } from './http.js';
import { MockProvider } from './providers/mock.js';
import { TryOnRouter } from './router.js';
import { garment, makePng, person } from './test-utils.js';
import type { PersonInput, TryOnProvider, TryOnResult } from './types.js';

async function fixtures() {
  return { p: person(await makePng(300, 400)), g: garment(await makePng(50, 50)) };
}

describe('TryOnRouter — a failure after a successful (paid) render', () => {
  it('does not fall through to the next provider when the ledger write fails', async () => {
    const { p, g } = await fixtures();
    const first = new MockProvider({ name: 'first', costUsd: 0.075 });
    const second = new MockProvider({ name: 'second', costUsd: 0.06 });
    const router = new TryOnRouter({
      providers: [first, second],
      policy: { order: ['first', 'second'], maxCostUsd: 1 },
      onLedger: () => {
        throw new Error('ledger_entries insert failed');
      },
    });
    const err = await router.render(p, g, { quality: 'balanced' }).catch((e: unknown) => e);
    // The ledger error surfaces as-is instead of being treated as a vendor fault…
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ledger_entries insert failed/);
    // …the second provider is never billed for a duplicate render…
    expect(second.calls).toHaveLength(0);
    expect(first.calls).toHaveLength(1);
    // …and the healthy provider is not penalised by the circuit breaker.
    expect(router.circuit.snapshot().first?.consecutiveFailures ?? 0).toBe(0);
  });

  it('does not re-render a video elsewhere when the spend store throws', async () => {
    const { g } = await fixtures();
    const a = new MockProvider({ name: 'a', costUsd: 0.48 });
    const b = new MockProvider({ name: 'b', costUsd: 0.48 });
    const router = new TryOnRouter({
      providers: [a, b],
      policy: { order: ['a', 'b'], maxCostUsd: 1 },
      spend: {
        get: () => 0,
        add: () => {
          throw new Error('usage_daily write failed');
        },
      },
    });
    await expect(router.animate(await makePng(10, 10), g, { durationSec: 6, resolution: '720p' })).rejects.toThrow(/usage_daily/);
    expect(b.calls).toHaveLength(0);
  });
});

describe('TryOnRouter — hard rule 1 at the router boundary', () => {
  it('refuses a person input that is not an avatar render even if the provider would not check', async () => {
    const { g } = await fixtures();
    const calls: PersonInput[] = [];
    const lax: TryOnProvider = {
      name: 'lax',
      models: ['lax-1'],
      capabilities: new MockProvider().capabilities,
      estimateCost: () => 0,
      healthCheck: async () => ({ ok: true }),
      tryOn: async (person): Promise<TryOnResult> => {
        calls.push(person);
        return { images: [], provider: 'lax', model: 'lax-1', costUsd: 0, latencyMs: 0, retention: { vendorDeletesAfterHours: 0, trainedOn: false }, disclaimer: 'generated-estimate' };
      },
    };
    const router = new TryOnRouter({ providers: [lax], policy: { order: ['lax'], maxCostUsd: 1 } });
    const raw = { kind: 'userPhoto', image: await makePng(10, 10), consentTier: 'heroOptIn' } as unknown as PersonInput;
    await expect(router.render(raw, g, { quality: 'balanced' })).rejects.toBeInstanceOf(ConfigError);
    const noConsent = { kind: 'avatarRender', image: await makePng(10, 10), consentTier: 'deck' } as unknown as PersonInput;
    await expect(router.render(noConsent, g, { quality: 'balanced' })).rejects.toBeInstanceOf(ConfigError);
    expect(calls).toHaveLength(0);
  });
});

describe('Deadline', () => {
  it('removes its abort listener from a long-lived parent signal on dispose', () => {
    const parent = new AbortController();
    for (let i = 0; i < 25; i++) new Deadline(1000, parent.signal).dispose();
    expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
  });

  it('still propagates a parent abort while active', () => {
    const parent = new AbortController();
    const d = new Deadline(1000, parent.signal);
    parent.abort();
    expect(d.aborted).toBe(true);
    d.dispose();
  });
});
