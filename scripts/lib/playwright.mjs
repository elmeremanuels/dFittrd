/**
 * Playwright for the root scripts that drive a browser (demo:e2e, check:launch). The repo's own copy is the one
 * `@playwright/test` brings into apps/web; a machine-wide install (NODE_PATH) is the fallback.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export function loadPlaywright() {
  const web = createRequire(fileURLToPath(new URL('../../apps/web/package.json', import.meta.url)));
  try {
    return createRequire(web.resolve('@playwright/test')).call(null, 'playwright');
  } catch {
    try {
      return createRequire(import.meta.url)('playwright');
    } catch {
      throw new Error('Playwright is not installed: run `pnpm install`, then `pnpm --filter @curtain/web exec playwright install chromium`');
    }
  }
}
