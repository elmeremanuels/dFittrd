import { describe, expect, it } from 'vitest';
import * as api from './index.js';

describe('public API', () => {
  it('exports the adapters, router, registry and helpers', () => {
    expect(typeof api.FashnProvider).toBe('function');
    expect(typeof api.VertexTryOnProvider).toBe('function');
    expect(typeof api.GrokVideoProvider).toBe('function');
    expect(typeof api.MockProvider).toBe('function');
    expect(typeof api.TryOnRouter).toBe('function');
    expect(typeof api.createRegistry).toBe('function');
    expect(typeof api.promptFromMetadata).toBe('function');
    expect(typeof api.normaliseImage).toBe('function');
    expect(api.DISCLAIMER).toBe('generated-estimate');
    expect(api.BANNED_MODELS.length).toBeGreaterThanOrEqual(4);
  });

  it('a PersonInput can only be an avatar render with hero opt-in (compile-time D3 guarantee)', () => {
    const ok: api.PersonInput = { kind: 'avatarRender', image: new Uint8Array(), consentTier: 'heroOptIn' };
    // @ts-expect-error — 'userPhoto' must never become a valid kind
    const bad: api.PersonInput = { kind: 'userPhoto', image: new Uint8Array(), consentTier: 'heroOptIn' };
    expect(ok.kind).toBe('avatarRender');
    expect(bad).toBeDefined();
  });
});
