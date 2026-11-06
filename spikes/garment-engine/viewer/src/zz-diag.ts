import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { bodyField, buildAvatar, mannequinMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { openSession, prepareFit, relax, viewerMaterial, yokeHeight } from './engine';
import { fitForBody } from './fitting';
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
console.log('heights', m.morphHeights, 'yoke', yokeHeight(m), 'hps', m.landmarks.hps, 'jointL', m.arms.left.joint, 'axis', m.arms.left.axis);
const canonical = buildMannequinMesh(m);
for (const id of ['aalter-studio-2', 'monochrome-03'] as const) {
  const b = buildBundle(id, { skipSeparation: true });
  console.log(id, 'grading base', b.grading.base);
  const bundle: SpikeBundle = { productId: id, anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa: JSON.parse(b.files['qa.json']), baseMesh: meshFromGlb(b.files['base.glb']) };
  const s = openSession(m, bundle);
  const meas = mannequinMeasurements(m);
  const av = buildAvatar(m, canonical, meas);
  const f0 = prepareFit(s, av, bodyField(m, av), fitForBody(s.payload, meas), 'S', viewerMaterial('product', bundle.material));
  const c = f0.cloth;
  const strainAt = () => { const out: string[] = []; for (let e = 0; e < c.edgeRest.length; e++) { const a = c.edges[2*e]!, bb = c.edges[2*e+1]!; const d = Math.hypot(c.pos[3*a]!-c.pos[3*bb]!, c.pos[3*a+1]!-c.pos[3*bb+1]!, c.pos[3*a+2]!-c.pos[3*bb+2]!); const st = d / c.edgeRest[e]! - 1; if (st > 0.15) out.push(`${(st*100).toFixed(0)}% pins=${c.invMass[a]===0?1:0}${c.invMass[bb]===0?1:0} nc=${f0.noCollide[a]}${f0.noCollide[bb]} a=(${c.pos[3*a]!.toFixed(1)},${c.pos[3*a+1]!.toFixed(1)},${c.pos[3*a+2]!.toFixed(1)})`); } return out; };
  console.log('before relax', strainAt().slice(0, 8));
  relax(f0);
  const after = strainAt();
  console.log('after relax', after.length, after.slice(0, 12));
}
