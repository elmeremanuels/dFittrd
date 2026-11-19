/**
 * Writes one asset bundle per spike product to spikes/garment-engine/out/<productId>/ (gitignored):
 * base.glb, anchors.json, grading.json, material.json, qa.json. Deterministic.
 * Run: pnpm --filter @curtain/garment-spike build:bundle
 *
 * Also the SYNTHETIC men's test tee on the male mannequin (`synthetic-men-tee`, men-3d-plan slice
 * M1), with payload.json for the spike viewer's avatar page (the api import never copies that file).
 *
 * Flags (used by the api's end-to-end test of the male path): `--only <productId>` builds one
 * product, `--out <dir>` writes there instead of out/, `--skip-separation` skips stage 3 (slow).
 * `--male-shape=v2` builds the men's bundles on the male shape v2 (into the same folder: the bundle
 * names the shape it was built on, and a viewer or an api set to the other shape refuses it).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildBundle } from '../src/bundle';
import { SPIKE_MALE_PRODUCT_IDS, SPIKE_PRODUCT_IDS, spikeProduct, type SpikeBundleProductId } from '../src/product';

const { values } = parseArgs({ options: { only: { type: 'string' }, out: { type: 'string' }, 'skip-separation': { type: 'boolean' }, 'male-shape': { type: 'string' } } });
if (values['male-shape'] !== undefined && values['male-shape'] !== 'v1' && values['male-shape'] !== 'v2') {
  console.error(`--male-shape is v1 or v2, not ${values['male-shape']}`);
  process.exit(2);
}
const maleShape = values['male-shape'] === 'v2' ? ({ maleShape: 'v2' } as const) : {};
const out = values.out ? resolve(values.out) : join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const all: SpikeBundleProductId[] = [...SPIKE_PRODUCT_IDS, ...SPIKE_MALE_PRODUCT_IDS];
if (values.only !== undefined && !(all as string[]).includes(values.only)) {
  console.error(`unknown product ${values.only}; the spike builds ${all.join(', ')}`);
  process.exit(2);
}
const ids = values.only === undefined ? all : all.filter((id) => id === values.only);
let failed = false;
for (const id of ids) {
  const t0 = Date.now();
  const b = buildBundle(id, { ...maleShape, ...(values['skip-separation'] ? { skipSeparation: true } : { separation: { framesPerPath: 72, frameStride: 3, width: 192, height: 192 } }) });
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(b.files)) writeFileSync(join(dir, name), data);
  if ((SPIKE_MALE_PRODUCT_IDS as readonly string[]).includes(id)) writeFileSync(join(dir, 'payload.json'), `${JSON.stringify(spikeProduct(id), null, 2)}\n`);
  const bytes = Object.values(b.files).reduce((n, d) => n + (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength), 0);
  console.log(
    `[garment-spike] ${id} (${b.mannequin.shape.family} mannequin${b.mannequin.maleShape ? `, shape ${b.mannequin.maleShape}` : ''}): ${JSON.parse(b.files['qa.json']).chartAgreement.kind === 'tape-built' ? 'built from the tape (POM), own tape max' : 'chart agreement max'} ${b.agreement.maxAbsCm.toFixed(2)} cm (${b.agreement.pass ? 'pass' : 'FAIL'}), ` +
      `residual after global ${b.calibration.residualAfterGlobal.maxAbsCm.toFixed(2)} cm, ` +
      `separation IoU ${b.separation ? b.separation.iou.toFixed(4) : 'skipped'} over ${b.separation?.frames ?? 0} frames, ` +
      `${b.baseMesh.indices.length / 3} triangles, ${(bytes / 1024).toFixed(0)} KB, ${Date.now() - t0} ms`,
  );
  if (!b.agreement.pass || (b.separation && b.separation.iou < 0.95)) failed = true;
}
if (failed) process.exit(1);
