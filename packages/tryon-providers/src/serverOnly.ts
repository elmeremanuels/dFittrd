/**
 * Runtime guard for decision D3: this package must never be evaluated in a browser. Together
 * with `"browser": false` in package.json and the ESLint `no-restricted-globals` rule it makes a
 * bundling mistake fail loudly instead of leaking provider traffic (and keys) to the client.
 */
export class ServerOnlyViolation extends Error {
  constructor() {
    super(
      '@paskamer/tryon-providers is server-only: it was loaded in an environment with a `window` ' +
        'global. Provider adapters and keys must stay in apps/api (decision D3).',
    );
    this.name = 'ServerOnlyViolation';
  }
}

export function isBrowserLike(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return typeof g.window !== 'undefined' || typeof g.document !== 'undefined';
}

export function assertServerOnly(): void {
  if (isBrowserLike()) throw new ServerOnlyViolation();
}
