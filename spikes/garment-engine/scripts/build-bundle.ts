/**
 * Writes one asset bundle per spike product to spikes/garment-engine/out/<productId>/ (gitignored):
 * base.glb, anchors.json, grading.json, material.json, qa.json. Deterministic.
 * Run: pnpm --filter @curtain/garment-spike build:bundle
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../src/bundle';
import { SPIKE_PRODUCT_IDS } from '../src/product';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
let failed = false;
for (const id of SPIKE_PRODUCT_IDS) {
  const t0 = Date.now();
  const b = buildBundle(id, { separation: { framesPerPath: 72, frameStride: 3, width: 192, height: 192 } });
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(b.files)) writeFileSync(join(dir, name), data);
  const bytes = Object.values(b.files).reduce((n, d) => n + (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength), 0);
  console.log(
    `[garment-spike] ${id}: chart agreement max ${b.agreement.maxAbsCm.toFixed(2)} cm (${b.agreement.pass ? 'pass' : 'FAIL'}), ` +
      `residual after global ${b.calibration.residualAfterGlobal.maxAbsCm.toFixed(2)} cm, ` +
      `separation IoU ${b.separation?.iou.toFixed(4)} over ${b.separation?.frames} frames, ` +
      `${b.baseMesh.indices.length / 3} triangles, ${(bytes / 1024).toFixed(0)} KB, ${Date.now() - t0} ms`,
  );
  if (!b.agreement.pass || (b.separation && b.separation.iou < 0.95)) failed = true;
}
if (failed) process.exit(1);
