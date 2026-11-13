/**
 * Node drape benchmark: one drape per size (XS, S, M, L) of each spike product on the canonical mannequin,
 * printing the CPU time of `relax()` and the edge strain (p99, max) after it. Reproduces the node
 * figures in viewer/README.md ("Drape time", PBD strain). Not part of the tests; numbers vary with the machine.
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/bench-drape.ts
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { bodyField, buildAvatar, mannequinMeasurements } from '../src/body';
import { meshFromGlb, type SpikeBundle } from '../src/bundle';
import { strainQuantile } from '../src/cloth';
import { openSession, prepareFit, relax, viewerMaterial } from '../src/engine';
import { fitForBody } from '../src/fitting';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const meas = mannequinMeasurements(m);
const avatar = buildAvatar(m, buildMannequinMesh(m), meas);
const field = bodyField(m, avatar);

for (const id of ['aalter-studio-2', 'monochrome-03'] as const) {
  const b = buildBundle(id, { skipSeparation: true });
  const bundle: SpikeBundle = {
    productId: id,
    anchors: JSON.parse(b.files['anchors.json']) as SpikeBundle['anchors'],
    grading: JSON.parse(b.files['grading.json']) as SpikeBundle['grading'],
    material: JSON.parse(b.files['material.json']) as SpikeBundle['material'],
    qa: JSON.parse(b.files['qa.json']) as SpikeBundle['qa'],
    baseMesh: meshFromGlb(b.files['base.glb']),
  };
  const session = openSession(m, bundle);
  const fit = fitForBody(session.payload, meas);
  for (const size of ['XS', 'S', 'M', 'L']) {
    const f = prepareFit(session, avatar, field, fit, size, viewerMaterial('product', bundle.material));
    const t0 = performance.now();
    relax(f);
    const ms = performance.now() - t0;
    const p99 = strainQuantile(f.cloth, 0.99);
    const max = strainQuantile(f.cloth, 1);
    console.log(`[bench-drape] ${id} ${size}: relax ${ms.toFixed(0)} ms, edge strain p99 ${(p99 * 100).toFixed(1)} %, max ${(max * 100).toFixed(1)} %`);
  }
}
