import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { bodyField, buildAvatar, mannequinMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { stepCloth, strainQuantile } from './cloth';
import { openSession, prepareFit, viewerMaterial, FABRIC_PRESETS } from './engine';
import { fitForBody } from './fitting';
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canonical = buildMannequinMesh(m);
for (const id of ['aalter-studio-2', 'monochrome-03'] as const) {
  const b = buildBundle(id, { skipSeparation: true });
  const bundle: SpikeBundle = { productId: id, anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa: JSON.parse(b.files['qa.json']), baseMesh: meshFromGlb(b.files['base.glb']) };
  const s = openSession(m, bundle);
  const meas = mannequinMeasurements(m);
  const av = buildAvatar(m, canonical, meas);
  const field = bodyField(m, av);
  const fit = fitForBody(s.payload, meas);
  for (const fab of FABRIC_PRESETS) for (const size of ['S', 'L']) {
    const mk = () => prepareFit(s, av, field, fit, size, viewerMaterial(fab, bundle.material), 3);
    const ref = mk();
    const moves: number[] = [];
    for (let f = 0; f < 180; f++) moves.push(stepCloth(ref.cloth, ref.params, ref.collide, 1));
    const refPos = Float32Array.from(ref.cloth.pos);
    const dev = (p: Float32Array) => { let mx = 0, sum = 0; for (let i = 0; i < p.length / 3; i++) { const d = Math.hypot(p[3*i]!-refPos[3*i]!, p[3*i+1]!-refPos[3*i+1]!, p[3*i+2]!-refPos[3*i+2]!); mx = Math.max(mx, d); sum += d; } return `max ${mx.toFixed(2)} mean ${(sum / (p.length/3)).toFixed(3)} cm`; };
    const line = [`${id} ${fab} ${size}: move/frame@0.25s..3s`, [15,30,45,60,90,120,179].map(f => moves[f]!.toFixed(3)).join(' ')];
    for (const [sub, it, frames] of [[2, 6, 90], [1, 6, 90], [1, 8, 90], [1, 8, 60], [2, 6, 60], [1,10,60]] as const) {
      const f = mk(); f.params.substeps = sub; f.params.iterations = it;
      const t0 = performance.now(); stepCloth(f.cloth, f.params, f.collide, frames); const ms = performance.now() - t0;
      line.push(`\n   sub${sub} it${it} ${frames}f: ${ms.toFixed(0)} ms, vs 3s-ref ${dev(f.cloth.pos)}, p99 ${(strainQuantile(f.cloth, 0.99)*100).toFixed(1)}%`);
    }
    console.log(line.join(' '));
  }
}
