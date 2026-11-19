/**
 * The AI realism adapter from env (D22). Keys, when a real adapter is added, are read only in env.ts
 * (AGENTS.md hard rule 2). `fake` is refused in production by env.ts, so a fake image never reaches a
 * shopper. The banned-model check (rule 6) runs here, at build time, and again in runRealism.
 */
import { assertRealismProviderAllowed, FakeRealismProvider, FalZImageRealismProvider, type RealismProvider } from '@curtain/tryon-providers';
import type { Env } from '../env.js';

export function realismProviderFromEnv(env: Env): RealismProvider {
  let p: RealismProvider;
  switch (env.AI_REALISM_PROVIDER) {
    case 'fake':
      p = new FakeRealismProvider();
      break;
    case 'fal-z-image':
      // env.ts refuses this choice without a key.
      p = new FalZImageRealismProvider({ apiKey: env.FAL_API_KEY ?? '' });
      break;
  }
  assertRealismProviderAllowed(p);
  return p;
}
