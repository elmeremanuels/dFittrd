import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { bodyField, buildAvatar } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import * as NEW from './engine';
import * as OLD from './zz-oldengine';
import { fitForBody } from './fitting';
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canonical = buildMannequinMesh(m);
const id = 'aalter-studio-2';
const b = buildBundle(id, { skipSeparation: true });
const bundle: SpikeBundle = { productId: id, anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa: JSON.parse(b.files['qa.json']), baseMesh: meshFromGlb(b.files['base.glb']) };
for (const body of [{ bust: 92, waist: 74, hip: 100 }, { bust: 104, waist: 90, hip: 112 }]) {
  const av = buildAvatar(m, canonical, body);
  const field = bodyField(m, av);
  for (const [name, E] of [['old', OLD], ['new', NEW]] as const) {
    const s = E.openSession(m, bundle);
    const fit = fitForBody(s.payload, body);
    for (const size of ['XS', 'S', 'M', 'L']) {
      const f = E.prepareFit(s, av, field, fit, size, E.viewerMaterial('product', bundle.material));
      E.relax(f as never);
      const c = f.cloth; const y0 = m.morphHeights.shoulder - 1; const st: number[] = [];
      for (let e = 0; e < c.edgeRest.length; e++) { const a = c.edges[2*e]!, bb = c.edges[2*e+1]!; if (s.chains[a] || s.chains[bb] || c.pos[3*a+1]! < y0 || c.pos[3*bb+1]! < y0) continue; st.push(Math.hypot(c.pos[3*a]!-c.pos[3*bb]!, c.pos[3*a+1]!-c.pos[3*bb+1]!, c.pos[3*a+2]!-c.pos[3*bb+2]!) / c.edgeRest[e]! - 1); }
      st.sort((p, q) => p - q);
      const q = (x: number) => (st[Math.floor(x * (st.length - 1))]! * 100).toFixed(1);
      console.log(`${JSON.stringify(body)} ${name} ${size}: neck strain median ${q(0.5)}% p90 ${q(0.9)}% max ${q(1)}%; chest ${f.placement.anchors.find(a => a.anchor === 'chest')?.state}`);
    }
  }
}
