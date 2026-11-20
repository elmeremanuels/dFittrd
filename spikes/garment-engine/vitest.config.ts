import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The spike's tests export jobs and fit meshes on the CPU (several seconds each); the root `pnpm check`
    // runs every workspace's tests at once, where vitest's default 5 s timed out on the shop export tests.
    testTimeout: 60_000,
  },
});
