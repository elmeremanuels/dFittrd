import { defineConfig } from 'tsup';

/**
 * Only the server-side bake check (`bakeGate.ts`) is built: the api's compiled import (`node dist/scripts/import-asset.js`)
 * runs it. The embed consumes this package as TypeScript source (`.` → src/index.ts), so nothing else is built.
 * The workspace's mannequin and anchors are bundled in; @curtain/schema and the meshopt decoder stay external.
 */
export default defineConfig({
  entry: { bakeGate: 'src/bakeGate.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  treeshake: true,
  noExternal: ['@curtain/mannequin', '@curtain/anchors'],
  external: ['@curtain/schema', 'meshoptimizer'],
});
