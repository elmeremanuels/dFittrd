import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests of the viewer's pure logic (fitting, cloth, heat map, blind test). Rendering is covered by smoke.mjs, outside `pnpm check`.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
