/**
 * Build-time guard for AGENTS.md rule 2 / DECISIONS.md D3: a `VITE_*` variable whose NAME contains
 * KEY or SECRET would be inlined into the browser bundle, so the build refuses to run.
 *
 * Vite reads `.env`, `.env.local`, `.env.[mode]` and `.env.[mode].local` itself — those values are
 * NOT in `process.env` when vite.config.ts runs — so callers must pass the merged result of
 * `loadEnv(mode, root, 'VITE_')` and `process.env`.
 */
const CLIENT_PREFIX = 'VITE_';
const SECRET_NAME = /KEY|SECRET/i;

export function findClientSecrets(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((name) => name.startsWith(CLIENT_PREFIX) && SECRET_NAME.test(name));
}

export function assertNoClientSecrets(env: Record<string, string | undefined>): void {
  const found = findClientSecrets(env);
  if (found.length > 0) {
    throw new Error(`Refusing to build: ${found.join(', ')} looks like a secret and would ship to the browser (DECISIONS.md D3). Keep provider keys in apps/api/src/env.ts.`);
  }
}
