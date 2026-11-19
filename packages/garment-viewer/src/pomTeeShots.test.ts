/**
 * Pictures and numbers of the POM tee (men-3d-plan slice M3) draped on the male S…XXL bodies, for
 * the M3 reports. Skipped unless POM_SHOTS names a folder: `POM_SHOTS=/tmp/pom pnpm --filter
 * @curtain/garment-viewer exec vitest run src/pomTeeShots.test.ts`. Writes, per generator (`pom`, and
 * `m1` for the M1 lofted test garment) and body, front / side / back PNGs from the spike's software
 * renderer (not WebGL, no texture; the embed pictures come from scripts/demo-men.mjs), and `metrics.json`:
 * show-through by region (vertex proxy and pixels), strain, the shoulder line's strain, the seat lift,
 * chest girth at the POM chest line (fixed height, as the M3 report) and on the chest line's own row
 * of cloth (hull and the M3 tape), and the same for every tee size on the M body and on the XXL body
 * (off-size; a size the viewer does not draw, `sewnNotDrawn`, is recorded with its reason and not draped).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE, vertexNormals, type Mesh } from '@curtain/mannequin';
import { SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { pokes, render } from '../../../spikes/garment-engine/src/pokeThrough';
import { buildPomBundle, torsoTapeAt } from '../../../spikes/garment-engine/src/pomBundle';
import { tapeGirth } from '../../../spikes/garment-engine/src/tape';
import { SYNTHETIC_TEE_POM } from '../../../spikes/garment-engine/src/pomTeeSynthetic';
import { loadBundleFrom, type FetchLike } from './bundle';
import { strainQuantile } from './cloth';
import { gradedMesh, hullPerimeter, necklineStrain, openSession, prepareFit, relax, sewnNotDrawn, viewerMaterial, type FitInstance, type GarmentSession } from './engine';
import { fitForBody } from './fitting';
import { planAvatar } from './mount';

const out = process.env.POM_SHOTS;

const serve = (files: Record<string, string | Uint8Array>): FetchLike => async (url) => {
  const data = files[url.split('/').pop()!]!;
  return { ok: true, status: 200, json: async () => JSON.parse(data as string) as unknown, arrayBuffer: async () => { const u = data as Uint8Array; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; } };
};

/** Share of body vertices within 3 cm of the cloth lying more than 0.3 cm outside the nearest cloth vertex's plane (rim excluded), by region (as male.test.ts). */
function showThrough(pos: Float32Array, indices: Uint32Array, body: Mesh, liftCm: number, shoulderY: number, hipY: number): Record<string, number> {
  const ng = pos.length / 3;
  const normals = vertexNormals({ positions: Float64Array.from(pos), indices, vertexPart: new Uint8Array(ng), partNames: ['c'] } as Mesh);
  const uses = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) { const a = indices[t + e]!, b = indices[t + ((e + 1) % 3)]!; const k = Math.min(a, b) * ng + Math.max(a, b); uses.set(k, (uses.get(k) ?? 0) + 1); }
  const rim = new Uint8Array(ng);
  for (const [k, n] of uses) if (n === 1) { rim[Math.floor(k / ng)] = 1; rim[k % ng] = 1; }
  const seen: Record<string, [number, number]> = { cap: [0, 0], mid: [0, 0], hem: [0, 0] };
  for (let i = 0; i < body.positions.length / 3; i++) {
    const x = body.positions[3 * i]!, y = body.positions[3 * i + 1]! - liftCm, z = body.positions[3 * i + 2]!;
    let best = Infinity, j = -1;
    for (let k = 0; k < ng; k++) { const d = (pos[3 * k]! - x) ** 2 + (pos[3 * k + 1]! - y) ** 2 + (pos[3 * k + 2]! - z) ** 2; if (d < best) { best = d; j = k; } }
    if (best > 9 || rim[j]) continue;
    const o = (x - pos[3 * j]!) * normals[3 * j]! + (y - pos[3 * j + 1]!) * normals[3 * j + 1]! + (z - pos[3 * j + 2]!) * normals[3 * j + 2]!;
    const r = seen[y >= shoulderY - 6 ? 'cap' : y < hipY + 6 ? 'hem' : 'mid']!;
    r[0]++;
    if (o > 0.3) r[1]++;
  }
  return Object.fromEntries(Object.entries(seen).map(([k, [n, t]]) => [k, n ? Math.round((1000 * t) / n) / 10 : 0]));
}

/** The chest line's own row of cloth after the drape: hull in x–z and the M3 tape (as male.test.ts `chestRow`). */
function chestRow(session: GarmentSession, f: FitInstance, pos: Float32Array, size: string, chestLineY: number): { hull: number; tape: number } {
  const g = gradedMesh(session, size).positions;
  let best = Infinity;
  for (let i = 0; i < g.length / 3; i++) if (f.chains[i] === 0) best = Math.min(best, Math.abs(g[3 * i + 1]! - chestLineY));
  const ids: number[] = [];
  for (let i = 0; i < g.length / 3; i++) if (f.chains[i] === 0 && Math.abs(Math.abs(g[3 * i + 1]! - chestLineY) - best) < 1e-3) ids.push(i);
  let cy = 0;
  for (const i of ids) cy += pos[3 * i + 1]!;
  cy /= ids.length;
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return { hull: r1(hullPerimeter(ids.map((i) => [pos[3 * i]!, pos[3 * i + 2]!] as [number, number]))), tape: r1(tapeGirth(ids.map((i) => [pos[3 * i]!, cy, pos[3 * i + 2]!] as [number, number, number]), [0, cy, 0], [1, 0, 0], [0, 0, 1])?.girthCm ?? NaN) };
}

describe.skipIf(!out)('POM tee shots (POM_SHOTS)', () => {
  it('drapes, measures and renders', async () => {
    mkdirSync(out!, { recursive: true });
    const pom = buildPomBundle('synthetic-men-tee', SYNTHETIC_MENS_TEE, SYNTHETIC_TEE_POM, 'M', { texture: 'synthetic-print' });
    const m1 = buildBundle('synthetic-men-tee', { skipSeparation: true, generator: 'm1' });
    const chestLine = pom.base.levels.chestLineY;
    const metrics: Record<string, unknown>[] = [];
    const cases: [string, Record<string, string | Uint8Array>, (typeof MALE_BODY_SHAPE_IDS)[number], string, boolean][] = [];
    for (const id of MALE_BODY_SHAPE_IDS) { cases.push(['pom', pom.files, id, id, true]); cases.push(['m1', m1.files, id, id, true]); }
    for (const size of MALE_BODY_SHAPE_IDS) { cases.push(['pom', pom.files, 'M', size, false]); cases.push(['pom', pom.files, 'XXL', size, false]); }
    for (const [gen, files, id, size, pictures] of cases) {
      const bundle = await loadBundleFrom(serve(files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
      const r = MALE_REFERENCE[id];
      const plan = planAvatar(bundle.anchors, { family: 'male', heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth });
      const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
      const fit = fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements);
      const notDrawn = sewnNotDrawn(session, plan.avatar, fit, size);
      if (notDrawn) {
        metrics.push({ generator: gen, body: id, size, sewn: session.sewn, notDrawn });
        continue;
      }
      const f = prepareFit(session, plan.avatar, plan.field, fit, size, viewerMaterial('product', bundle.material));
      const placedChest = torsoTapeAt({ positions: Float64Array.from(f.cloth.pos), indices: f.indices }, chestLine);
      const t0 = Date.now();
      const pos = relax(f);
      const ms = Date.now() - t0;
      const lifted = Float64Array.from(pos);
      for (let i = 1; i < lifted.length; i += 3) lifted[i] = lifted[i]! + plan.garmentLiftCm;
      const sh = plan.m.morphHeights.shoulder + plan.garmentLiftCm, hp = plan.m.morphHeights.hip + plan.garmentLiftCm;
      const region = (y: number): string => (y >= sh - 6 ? 'cap' : y < hp + 6 ? 'hem' : 'mid');
      const px: Record<string, number> = { cap: 0, mid: 0, hem: 0 };
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const [k, v] of Object.entries(pokes(plan.avatar.mesh, { positions: lifted, indices: f.indices }, yaw, region))) px[k.split(' ')[1]!] = (px[k.split(' ')[1]!] ?? 0) + v;
      const row = SYNTHETIC_TEE_POM.find((x) => x.size === size)!;
      metrics.push({
        generator: gen, body: id, size, sewn: session.sewn, drapeMs: ms,
        showThroughPct: showThrough(pos, f.indices, plan.avatar.mesh, plan.garmentLiftCm, plan.m.morphHeights.shoulder, plan.m.morphHeights.hip),
        showThroughPixels: px,
        strainP99Pct: Math.round(strainQuantile(f.cloth, 0.99) * 1000) / 10,
        necklineStrainPct: Math.round(necklineStrain(f, plan.m) * 1000) / 10,
        seat: f.seat,
        loops: f.loops.length,
        chestCm: { tape: 2 * row.chestWidthCm, placed: placedChest && Math.round(placedChest * 10) / 10, draped: Math.round(torsoTapeAt({ positions: Float64Array.from(pos), indices: f.indices }, chestLine)! * 10) / 10 },
        chestRowCm: chestRow(session, f, pos, size, chestLine),
      });
      if (pictures) for (const [view, yaw] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]] as const)
        render([{ mesh: plan.avatar.mesh, color: [150, 150, 150] }, { mesh: { positions: lifted, indices: f.indices }, color: [62, 110, 142] }], yaw, join(out!, `${gen}-body-${id}-size-${size}-${view}.png`), 400, 600, { cx: 0, cy: 118, half: 45 });
    }
    writeFileSync(join(out!, 'metrics.json'), `${JSON.stringify({ chestLineY: chestLine, metrics }, null, 2)}\n`);
  }, 600_000);
});
