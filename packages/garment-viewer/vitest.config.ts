import { defineConfig } from 'vitest/config';

// Pure logic only (bundle check, cloth, fitting, engine, parity with the spike). Rendering is covered by the demo e2e.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // At most 2 workers, as the spike's own run (`--maxWorkers=2`): under a busy machine more workers starved vitest's worker RPC
    // ("[vitest-worker] Timeout calling onTaskUpdate" ended one `pnpm check` with exit 1 although every test passed).
    maxWorkers: 2,
  },
});
