import { defineConfig } from 'vitest/config';

// Pure logic only (bundle check, cloth, fitting, engine, parity with the spike). Rendering is covered by the demo e2e.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
