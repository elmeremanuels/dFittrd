import { defineConfig } from 'vitest/config';

// Pure logic only (bundle check, cloth, fitting, engine, parity with the spike). Rendering is covered by the demo e2e.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // At most 2 workers: the cloth tests are CPU-bound, more workers only slow each other down.
    maxWorkers: 2,
    // The event loop turns between tests. Without it a file of long synchronous tests ended a run with every test
    // passing, "[vitest-worker] Timeout calling onTaskUpdate" and exit 1; fewer workers alone did not stop that (see the file).
    setupFiles: ['./vitest.setup.ts'],
  },
});
