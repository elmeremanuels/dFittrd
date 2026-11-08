/**
 * Node: drape every size of an evaluation bundle (out/eval/<id>/) on the canonical mannequin and print, per size, the
 * garment's girth (convex hull of the slice, cm) at fixed heights for the graded mesh, the placed start and the draped
 * cloth: how much the sizes differ in the viewer and where the difference goes. Not part of the tests.
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/sizes-drape.ts out/eval/<id> [y1,y2,...]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { bodyField, buildAvatar, mannequinMeasurements } from '../src/body';
import { strainQuantile } from '../src/cloth';
import { meshFromGlb, type SpikeBundle } from '../src/bundle';
import { gradedMesh, openSession, prepareFit, relax, sizeLabels, viewerMaterial } from '../src/engine';
import { fitForBody } from '../src/fitting';

const dir = process.argv[2]!;
const ys = (process.argv[3] ?? '100,95,87,75,60,40,20').split(',').map(Number);
const rd = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const bundle: SpikeBundle = { productId: String((rd('anchors.json') as { productId: string }).productId), anchors: rd('anchors.json') as SpikeBundle['anchors'], grading: rd('grading.json') as SpikeBundle['grading'], material: rd('material.json') as SpikeBundle['material'], qa: rd('qa.json') as SpikeBundle['qa'], baseMesh: meshFromGlb(new Uint8Array(readFileSync(join(dir, 'base.glb')))), payload: rd('payload.json') as GarmentPayload };
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const meas = mannequinMeasurements(m);
const avatar = buildAvatar(m, buildMannequinMesh(m), meas);
const field = bodyField(m, avatar);
const session = openSession(m, bundle);
const fit = fitForBody(session.payload, meas);
/** Perimeter of the convex hull of the mesh's slice at height y (x–z), cm. */
function girth(pos: ArrayLike<number>, idx: ArrayLike<number>, y: number): number {
  const pts: [number, number][] = [];
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k]!, b = idx[t + ((k + 1) % 3)]!;
    const ya = pos[3 * a + 1]! - y, yb = pos[3 * b + 1]! - y;
    if ((ya < 0) !== (yb < 0)) { const s = ya / (ya - yb); pts.push([pos[3 * a]! + s * (pos[3 * b]! - pos[3 * a]!), pos[3 * a + 2]! + s * (pos[3 * b + 2]! - pos[3 * a + 2]!)]); }
  }
  if (pts.length < 3) return NaN;
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i]!, b = h[(i + 1) % h.length]!; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return Math.round(per * 10) / 10;
}
console.log(`heights ${ys.join(' / ')} cm; body ${ys.map((y) => girth(avatar.mesh.positions, avatar.mesh.indices, y)).join(' / ')}`);
for (const size of sizeLabels(session)) {
  const g = gradedMesh(session, size);
  const f = prepareFit(session, avatar, field, fit, size, viewerMaterial('product', bundle.material));
  const start = Float32Array.from(f.cloth.pos);
  const out = relax(f);
  const row = (p: ArrayLike<number>): string => ys.map((y) => girth(p, f.indices, y)).join(' / ');
  const minY = (p: ArrayLike<number>): number => { let v = Infinity; for (let i = 1; i < p.length; i += 3) v = Math.min(v, p[i]!); return Math.round(v * 10) / 10; };
  console.log(`${size}: hem y start ${minY(start)} draped ${minY(out)}, strain p50 ${(strainQuantile(f.cloth, 0.5) * 100).toFixed(1)} % p99 ${(strainQuantile(f.cloth, 0.99) * 100).toFixed(1)} %, pinned ${f.pinned.reduce((a, b) => a + b, 0)}, band ${JSON.stringify(f.band)}`);
  console.log(`${size}: graded ${row(g.positions)} | start ${row(start)} | draped ${row(out)} | placement ${f.placement.anchors.map((a) => `${a.anchor} ${a.state} ${a.placedCm.toFixed(1)}`).join(', ')}`);
}
