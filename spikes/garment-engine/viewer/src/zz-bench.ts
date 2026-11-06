// TEMP benchmark (scratch, deleted before finishing)
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { bodyField, buildAvatar, mannequinMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { strainQuantile } from './cloth';
import { openSession, prepareFit, relax, viewerMaterial } from './engine';
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
  for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
    const t0 = performance.now();
    const f = prepareFit(s, av, field, fit, size, viewerMaterial('product', bundle.material));
    const t1 = performance.now();
    relax(f);
    const t2 = performance.now();
    // neckline strain: edges with both ends above the shoulder ring - 6
    const c = f.cloth;
    let worst = 0, worstY = 0;
    const yN = m.morphHeights.shoulder - 1;
    for (let e = 0; e < c.edgeRest.length; e++) {
      const a = c.edges[2 * e]!, bb = c.edges[2 * e + 1]!;
      const r = c.edgeRest[e]!;
      const d = Math.hypot(c.pos[3*a]!-c.pos[3*bb]!, c.pos[3*a+1]!-c.pos[3*bb+1]!, c.pos[3*a+2]!-c.pos[3*bb+2]!);
      const st = d / r - 1;
      if (Math.min(c.pos[3*a+1]!, c.pos[3*bb+1]!) > yN && st > worst) { worst = st; worstY = c.pos[3*a+1]!; }
    }
    let pp = 0; for (let e = 0; e < c.edgeRest.length; e++) { const a = c.edges[2*e]!, bb = c.edges[2*e+1]!; if (c.invMass[a] !== 0 || c.invMass[bb] !== 0) continue; const d = Math.hypot(c.pos[3*a]!-c.pos[3*bb]!, c.pos[3*a+1]!-c.pos[3*bb+1]!, c.pos[3*a+2]!-c.pos[3*bb+2]!); pp = Math.max(pp, d / c.edgeRest[e]! - 1); }
    let worstAll = 0;
    for (let e = 0; e < c.edgeRest.length; e++) { const a = c.edges[2*e]!, bb = c.edges[2*e+1]!; const d = Math.hypot(c.pos[3*a]!-c.pos[3*bb]!, c.pos[3*a+1]!-c.pos[3*bb+1]!, c.pos[3*a+2]!-c.pos[3*bb+2]!); worstAll = Math.max(worstAll, d / c.edgeRest[e]! - 1); }
    console.log(`${id} ${size}: prepare ${(t1 - t0).toFixed(0)} ms, relax ${(t2 - t1).toFixed(0)} ms (${c.time.toFixed(2)} s cloth), n=${c.invMass.length}, neck max strain ${(worst * 100).toFixed(1)}% @y${worstY.toFixed(1)}, pinpin ${(pp*100).toFixed(1)}%, all max ${(worstAll*100).toFixed(1)}%, p99 ${(strainQuantile(c, 0.99)*100).toFixed(1)}%`);
  }
}
