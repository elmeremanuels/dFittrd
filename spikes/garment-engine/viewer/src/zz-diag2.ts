import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { radialMorph } from '../../src/garment';
import { bodyField, buildAvatar, mannequinMeasurements, torsoSection } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { gradedMesh, openSession, yokeHeight } from './engine';
import { fitForBody, gapsForSize, placeGarment, placementMorph } from './fitting';
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canonical = buildMannequinMesh(m);
const id = 'aalter-studio-2';
const b = buildBundle(id, { skipSeparation: true });
const bundle: SpikeBundle = { productId: id, anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa: JSON.parse(b.files['qa.json']), baseMesh: meshFromGlb(b.files['base.glb']) };
const s = openSession(m, bundle);
const meas = mannequinMeasurements(m);
const av = buildAvatar(m, canonical, meas);
const field = bodyField(m, av);
const fit = fitForBody(s.payload, meas);
const g = gradedMesh(s, 'S');
const pl = placeGarment(bundle.grading, 'S', gapsForSize(fit, 'S'), av.rings);
const placed = radialMorph(m, g, s.chains, placementMorph(pl, m.morphHeights));
const yoke = yokeHeight(m);
const e = new Float32Array(4);
const rows = new Map<number, number[]>();
for (let i = 0; i < s.chains.length; i++) { if (s.chains[i] !== 0) continue; const y = placed.positions[3*i+1]!; if (y < yoke) continue; const k = Math.round(y*100); (rows.get(k) ?? rows.set(k, []).get(k)!).push(i); }
for (const [k, row] of [...rows.entries()].sort((a,b)=>a[0]-b[0])) {
  const y = k/100; torsoSection(field, y, e);
  let kmax = 1, at = '';
  let xs = row.map(i => placed.positions[3*i]!);
  for (const i of row) { const x = placed.positions[3*i]!, z = placed.positions[3*i+2]!; if (Math.abs(x) >= 14) continue; const q = ((x-e[0]!)**2)/((e[2]!+0.35)**2) + ((z-e[1]!)**2)/((e[3]!+0.35)**2); if (q < 1 && 1/Math.sqrt(q) > kmax) { kmax = 1/Math.sqrt(q); at = `(${x.toFixed(1)},${z.toFixed(1)}) nc=${s.noCollide[i]}`; } }
  console.log(y.toFixed(2), 'n', row.length, 'xrange', Math.min(...xs).toFixed(1), Math.max(...xs).toFixed(1), 'ell', Array.from(e).map(v=>v.toFixed(1)).join(','), 'k', kmax.toFixed(3), at);
}
