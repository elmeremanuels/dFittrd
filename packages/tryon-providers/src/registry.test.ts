import { describe, expect, it } from 'vitest';
import { ConfigError } from './errors.js';
import { FashnProvider } from './providers/fashn.js';
import { GrokVideoProvider } from './providers/grokVideo.js';
import { MockProvider } from './providers/mock.js';
import { VertexTryOnProvider } from './providers/vertexTryOn.js';
import { BANNED_MODELS, ProviderRegistry, assertNotBanned, findBanned, isBanned } from './registry.js';
import type { TryOnProvider } from './types.js';

const builtIns: TryOnProvider[] = [
  new FashnProvider({ apiKey: 'k' }),
  new FashnProvider({ apiKey: 'k', model: 'tryon-max' }),
  new VertexTryOnProvider({ enabled: false, projectId: 'p', location: 'europe-west4', getAccessToken: async () => 't' }),
  new GrokVideoProvider({ apiKey: 'k' }),
  new MockProvider(),
];

describe('banned non-commercial models (AGENTS.md rule 6, D4)', () => {
  it('lists the models the decision log bans', () => {
    expect(BANNED_MODELS).toEqual(expect.arrayContaining(['idm-vton', 'ootdiffusion', 'catvton', 'fitdit']));
  });

  it('matches regardless of case and separators', () => {
    expect(isBanned('IDM_VTON')).toBe(true);
    expect(isBanned('cuuupid/idm-vton')).toBe(true);
    expect(isBanned('OOTDiffusion-dc')).toBe(true);
    expect(isBanned('fal-ai/cat-vton')).toBe(true);
    expect(isBanned('FitDiT')).toBe(true);
    expect(findBanned('tryon-v1.6')).toBeUndefined();
    expect(isBanned('virtual-try-on-001')).toBe(false);
    expect(isBanned('grok-imagine-video-1.5')).toBe(false);
  });

  it('no built-in provider name or model is banned', () => {
    for (const p of builtIns) {
      expect(isBanned(p.name)).toBe(false);
      for (const m of p.models) expect(isBanned(m)).toBe(false);
      expect(() => assertNotBanned(p)).not.toThrow();
    }
  });

  it('refuses to register a banned provider', () => {
    const bad = { name: 'replicate', models: ['cuuupid/idm-vton'] };
    expect(() => assertNotBanned(bad)).toThrow(ConfigError);
    expect(() => new ProviderRegistry([{ ...new MockProvider(), name: 'OOTDiffusion' } as unknown as TryOnProvider])).toThrow(
      /banned/,
    );
  });

  it('registry rejects duplicate names and resolves by name', () => {
    const reg = new ProviderRegistry(builtIns);
    expect(reg.names()).toEqual(['fashn', 'fashn-max', 'vertex-tryon', 'grok-video', 'mock']);
    expect(reg.get('fashn')?.models).toEqual(['tryon-v1.6']);
    expect(() => reg.register(new MockProvider())).toThrow(/twice/);
  });
});
