import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { bodyField, buildAvatar } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import * as E from './engine';
import { fitForBody } from './fitting';
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canonical = buildMannequinMesh(m);
const id = 'aalter-studio-2';
const b = buildBundle(id, { skipSeparation: true });
const bundle: SpikeBundle = { productId: id, anchors: JSON.parse(b.files['anchors.json']), grading: JSON.parse(b.files['grading.json']), material: JSON.parse(b.files['material.json']), qa: JSON.parse(b.files['qa.json']), baseMesh: meshFromGlb(b.files['base.glb']) };
const body = { bust: 104, waist: 90, hip: 112 };
const av = buildAvatar(m, canonical, body);
const s = E.openSession(m, bundle);
const f = E.prepareFit(s, av, bodyField(m, av), fitForBody(s.payload, body), process.env.SIZE ?? 'S', E.viewerMaterial('product', bundle.material));
const c = f.cloth; const y0 = m.morphHeights.shoulder - 1; const out: [number, string][] = [];
for (let e = 0; e < c.edgeRest.length; e++) { const a = c.edges[2*e]!, bb = c.edges[2*e+1]!; if (s.chains[a] || s.chains[bb] || c.pos[3*a+1]! < y0 || c.pos[3*bb+1]! < y0) continue; const v = Math.hypot(c.pos[3*a]!-c.pos[3*bb]!, c.pos[3*a+1]!-c.pos[3*bb+1]!, c.pos[3*a+2]!-c.pos[3*bb+2]!) / c.edgeRest[e]! - 1; if (v > 0.12) out.push([v, `${(v*100).toFixed(0)}% rest ${c.edgeRest[e]!.toFixed(2)} pin=${f.pinned[a]}${f.pinned[bb]} nc=${f.noCollide[a]}${f.noCollide[bb]} a=(${c.pos[3*a]!.toFixed(1)},${c.pos[3*a+1]!.toFixed(1)},${c.pos[3*a+2]!.toFixed(1)}) b=(${c.pos[3*bb]!.toFixed(1)},${c.pos[3*bb+1]!.toFixed(1)},${c.pos[3*bb+2]!.toFixed(1)})`]); }
out.sort((p,q)=>q[0]-p[0]); console.log(out.length, out.slice(0, 10).map(x=>x[1]));
