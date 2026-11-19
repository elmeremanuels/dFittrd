import { defineConfig, devices } from '@playwright/test';

/**
 * The face-on-head spike test alone (`faceOnHead.spec.ts`): it starts its own Vite dev servers
 * (flag on and flag off, no HMR), so it needs no production build and no preview server.
 *   pnpm exec playwright test -c e2e/faceOnHead.config.ts --trace off
 */
export default defineConfig({
  testDir: '.',
  testMatch: /faceOnHead\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list']],
  use: { headless: true, trace: 'off', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium', defaultBrowserType: 'chromium' } }],
});
