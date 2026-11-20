/**
 * POM bundle (docs/research/step3-serverdrape-spike.md §10): how far the device avatar is from the Anny body a POM v2
 * drape was made on, at the same girths. The bake carries drapes on Anny chart bodies; the device draws the skirt on
 * its own procedural mannequin (`@curtain/garment-viewer` `buildAvatar`, the shopper's girths). This prints, per Anny
 * body:
 *   - torso girth by height, Anny (hull of the mesh slice, arms left out) against the avatar's collision ellipse
 *     (Ramanujan perimeter), for the avatar built with that body's waist and hip (bust: the mannequin's own);
 *   - the ring heights of both (waist, hip) and Anny's navel;
 *   - for every direct drape on that body: how many particles lie inside the avatar (collider, clearance 0.35 cm,
 *     as the device drape uses) and how far the device push-out would move them.
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/serverdrape/pom-body-gap.ts out/pom2 [set]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { bodyField, buildAvatar, makeCollider, mannequinMeasurements } from '../../../../../packages/garment-viewer/src/body';
import { sample as sampleTable } from '../../../../../packages/garment-viewer/src/collide';
import { girthAt } from './girth';

const [root, set = 'wear'] = [process.argv[2]!, process.argv[3]];
interface BodyMeta { id: string; label: string; achieved: { hipCm: number; waistCm: number; hipY: number; waistY: number; navelY: number } }
const bodies = (JSON.parse(readFileSync(join(root, 'bodies', 'bodies.json'), 'utf8')) as { bodies: BodyMeta[] }).bodies;
const arm = new Uint8Array(readFileSync(join(root, 'bodies', 'armmask.bin')));
const f32 = (p: string): Float32Array => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const r1 = (x: number): number => Math.round(x * 10) / 10;

function readObj(p: string): { pos: Float32Array; idx: Uint32Array } {
  const v: number[] = [], f: number[] = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (line.startsWith('v ')) { const [, x, y, z] = line.split(/\s+/); v.push(+x!, +y!, +z!); }
    else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s.split('/')[0]!, 10) - 1);
      for (let k = 1; k + 1 < ids.length; k++) f.push(ids[0]!, ids[k]!, ids[k + 1]!);
    }
  }
  return { pos: Float32Array.from(v), idx: Uint32Array.from(f) };
}

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canon = buildMannequinMesh(m);
const base = mannequinMeasurements(m);
const ringY = (id: string): number => m.rings.find((r) => r.id === id)!.centre[1];
console.log(`mannequin M: stature ${m.statureCm}, waist ring y ${r1(ringY('waist'))}, hip ring y ${r1(ringY('hip'))}, bust ${base.bust}, waist ${base.waist}, hip ${base.hip}`);
const HEIGHTS = [82, 86, 89, 92, 95, 97, 99, 101, 103, 106];
const sizes = ['8', '10', '12', '14', '16'];
for (const b of bodies) {
  const obj = readObj(join(root, 'bodies', `${b.id}.obj`));
  // Torso only: drop triangles that touch an arm vertex.
  const tidx: number[] = [];
  for (let t = 0; t < obj.idx.length; t += 3) if (!arm[obj.idx[t]!] && !arm[obj.idx[t + 1]!] && !arm[obj.idx[t + 2]!]) tidx.push(obj.idx[t]!, obj.idx[t + 1]!, obj.idx[t + 2]!);
  const meas = { bust: base.bust, waist: b.achieved.waistCm, hip: b.achieved.hipCm };
  const av = buildAvatar(m, canon, meas);
  const field = bodyField(m, av);
  const e = new Float32Array(4);
  const ell = (y: number): number => {
    if (!sampleTable(field.torso, y, e)) return NaN;
    const a = e[2]!, c = e[3]!;
    const h = ((a - c) / (a + c)) ** 2;
    return Math.PI * (a + c) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  };
  const rows = HEIGHTS.map((y) => `${y}: Anny ${girthAt(obj.pos, tidx, y)} / avatar ${r1(ell(y))}`);
  console.log(`\n${b.id} (${b.label}) hip ${b.achieved.hipCm} @ ${b.achieved.hipY}, waist ${b.achieved.waistCm} @ ${b.achieved.waistY}, navel ${b.achieved.navelY}; avatar rings waist ${r1(av.rings.waist)} hip ${r1(av.rings.hip)}`);
  console.log('  torso girth by height (cm): ' + rows.join(' | '));
  for (const s of sizes) {
    const p = join(root, 'drapes', set, `${b.id}__${s}.bin`);
    if (!existsSync(p)) continue;
    const pos = f32(p);
    const probe = Float32Array.from(pos);
    const collide = makeCollider(field, 0.35);
    // The floor is the collider's too: count it apart (the hem below the soles is the rule, not a body clash).
    let inside = 0, floor = 0;
    const d: number[] = [], ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < pos.length / 3; i++) {
      const y0 = probe[3 * i + 1]!;
      if (!collide(probe, i)) continue;
      if (y0 < 0) floor++;
      const dx = probe[3 * i]! - pos[3 * i]!, dz = probe[3 * i + 2]! - pos[3 * i + 2]!;
      const dh = Math.hypot(dx, dz);
      if (dh > 1e-6) { inside++; d.push(dh); ys.push(pos[3 * i + 1]!); zs.push(pos[3 * i + 2]!); }
    }
    const bins: Record<string, number> = {};
    ys.forEach((y, k) => { const key = `${Math.floor(y / 10) * 10}${zs[k]! < 0 ? 'back' : 'front'}`; bins[key] = (bins[key] ?? 0) + 1; });
    d.sort((x, y) => x - y);
    const q = (f: number): number => (d.length ? r1(d[Math.min(d.length - 1, Math.floor(f * d.length))]!) : 0);
    console.log(`  AU ${s}: inside the avatar ${inside} of ${pos.length / 3} (push-out p50 ${q(0.5)}, p95 ${q(0.95)}, max ${q(1)} cm); below the floor ${floor}; where (y bin, side): ${JSON.stringify(bins)}`);
  }
}
