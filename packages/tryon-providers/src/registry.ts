import { ConfigError } from './errors.js';
import { BANNED_MODELS } from './bannedModels.js';
import type { BannedModel } from './bannedModels.js';
import type { TryOnProvider } from './types.js';

/**
 * AGENTS.md hard rule 6 / decision D4: non-commercial models may never be registered. The list lives
 * in bannedModels.ts and is matched case-insensitively and ignoring separators, so "IDM_VTON",
 * "idm-vton" and "IdmVton" are all caught. `scripts/check-banned-models.mjs` applies the same list
 * to the source tree at lint time.
 */
export { BANNED_MODELS };
export type { BannedModel };

const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const BANNED_NORMALISED: readonly string[] = BANNED_MODELS.map(normalise);

/** True when the identifier contains any banned model name. */
export function isBanned(identifier: string): boolean {
  const n = normalise(identifier);
  return BANNED_NORMALISED.some((b) => n.includes(b));
}

export function findBanned(identifier: string): BannedModel | undefined {
  const n = normalise(identifier);
  const idx = BANNED_NORMALISED.findIndex((b) => n.includes(b));
  return idx === -1 ? undefined : BANNED_MODELS[idx];
}

/** Throws ConfigError if the provider's name or any of its models is banned. */
export function assertNotBanned(provider: Pick<TryOnProvider, 'name' | 'models'>): void {
  const banned = findBanned(provider.name);
  if (banned) {
    throw new ConfigError(`provider name "${provider.name}" matches banned non-commercial model "${banned}"`);
  }
  for (const model of provider.models) {
    const b = findBanned(model);
    if (b) throw new ConfigError(`provider "${provider.name}" lists banned non-commercial model "${model}" (${b})`);
  }
}

export class ProviderRegistry {
  private readonly byName = new Map<string, TryOnProvider>();

  constructor(providers: Iterable<TryOnProvider> = []) {
    for (const p of providers) this.register(p);
  }

  register(provider: TryOnProvider): this {
    assertNotBanned(provider);
    if (this.byName.has(provider.name)) {
      throw new ConfigError(`provider "${provider.name}" registered twice`);
    }
    this.byName.set(provider.name, provider);
    return this;
  }

  get(name: string): TryOnProvider | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  all(): TryOnProvider[] {
    return [...this.byName.values()];
  }
}

export function createRegistry(providers: Iterable<TryOnProvider>): ProviderRegistry {
  return new ProviderRegistry(providers);
}
