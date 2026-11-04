import { defineConfig, devices } from '@playwright/test';

/**
 * Privacy e2e (DECISIONS.md D3). Runs against the production build served by `vite preview`;
 * Chromium gets a fake camera so the capture step exercises its camera path.
 * `pnpm --filter @paskamer/web e2e` builds first. Browsers come from PLAYWRIGHT_BROWSERS_PATH.
 */
const PORT = 4173;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'], browserName: 'chromium', defaultBrowserType: 'chromium' } }],
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
