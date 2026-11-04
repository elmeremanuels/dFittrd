import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'neutral',
  treeshake: true,
  // Type-only imports from @paskamer/schema are elided; nothing may be bundled or required at runtime.
  external: ['@paskamer/schema'],
});
