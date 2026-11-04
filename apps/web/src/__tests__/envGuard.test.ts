import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import { assertNoClientSecrets, findClientSecrets } from '../../config/envGuard';

/**
 * D3 / AGENTS.md rule 2: a VITE_* variable whose name contains KEY or SECRET must fail the build.
 * Vite reads `.env*` files itself (they are NOT in process.env), so the guard has to look at
 * `loadEnv()` output as well as the shell environment.
 */
describe('client secret guard', () => {
  it('flags VITE_* names containing KEY or SECRET, ignores public config and server-only names', () => {
    expect(findClientSecrets({ VITE_API_URL: 'http://localhost:3000', VITE_FASHN_API_KEY: 'x', VITE_SHOPIFY_SECRET: 'y', FASHN_API_KEY: 'server-only', VITE_KEYBOARD_HINTS: '1' }).sort()).toEqual(['VITE_FASHN_API_KEY', 'VITE_KEYBOARD_HINTS', 'VITE_SHOPIFY_SECRET']);
    expect(() => assertNoClientSecrets({ VITE_API_URL: 'x' })).not.toThrow();
    expect(() => assertNoClientSecrets({ VITE_XAI_KEY: 'x' })).toThrow(/VITE_XAI_KEY/);
  });

  it('catches a key placed in a .env file next to the app, the way Vite would load it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paskamer-env-'));
    writeFileSync(join(dir, '.env'), 'VITE_API_URL=http://localhost:3000\nVITE_PROVIDER_KEY=sk-should-never-ship\n');
    writeFileSync(join(dir, '.env.production'), 'VITE_GROK_SECRET=also-bad\n');
    const env = loadEnv('production', dir, 'VITE_');
    expect(findClientSecrets(env).sort()).toEqual(['VITE_GROK_SECRET', 'VITE_PROVIDER_KEY']);
    expect(() => assertNoClientSecrets({ ...process.env, ...env })).toThrow(/Refusing to build/);
  });
});
