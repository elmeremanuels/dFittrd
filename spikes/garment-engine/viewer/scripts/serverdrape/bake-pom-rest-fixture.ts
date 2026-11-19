/**
 * The test fixture of the import's bake check (`packages/garment-viewer/fixtures/pom-v2-rest/`): a tape-built bundle
 * in the exact POM v2 bake format (§10 of docs/research/step3-serverdrape-spike.md), made from the committed scripts
 * alone, without Blender. The real POM v2 bake (`bake-pom.ts`) needs Blender drapes in the git-ignored `out/`.
 *
 * What it is: the POM v2 rest geometry of the real skirt (`serverdrape/pom_rest.py --profile tube --edge 1.0`, built
 * from the shop's tape: AU 8, 10 and 14 measured, 12 interpolated, 16 extrapolated) laid on the device avatar of each
 * chart body (t = -1, 0, 0.5, 1: hips 94, 104, 109, 114) and pushed out of it by the device's own collider with the
 * on-device clearance (0.35 cm, `settleOnBody`). NOT a cloth simulation: there are no folds and no hang, the hem is
 * where the rest shape put it. Drapes are therefore declared at rest with zero movement, and the bake's `source` says
 * FIXTURE. Where the push-out stretches the hip line beyond the gate's ring tolerance, the size is declared not draped
 * on that body (the same refusal the real bake declares for AU 8 on the AU 16 body).
 *
 * Run (from spikes/garment-engine):
 *   python3 serverdrape/pom_rest.py <restDir> --profile tube --edge 1.0
 *   pnpm exec tsx viewer/scripts/serverdrape/bake-pom-rest-fixture.ts <restDir> ../../packages/garment-viewer/fixtures/pom-v2-rest
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { bakeRingToleranceCm } from '@curtain/schema';
import { ringLength } from '../../../../../packages/garment-viewer/src/bakeGate';
import { bodyField, buildAvatar } from '../../../../../packages/garment-viewer/src/body';
import { makeCollider } from '../../../../../packages/garment-viewer/src/collide';
import { DRAPE_BAKE_FORMAT, settleOnBody, type DrapeBakeMeta, type DrapeBakeSizeMeta } from '../../../../../packages/garment-viewer/src/drapeBake';
import { writeDrapeBake } from '../../../../../packages/garment-viewer/src/drapeBakeWrite';
import { chartBody, qaTape, tapeRings, type RestJson } from './bakeTape';

const [restDir, outDir] = [process.argv[2]!, process.argv[3]!];
const rest = JSON.parse(readFileSync(join(restDir, 'rest.json'), 'utf8')) as RestJson;
const f32 = (p: string): Float32Array => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const indices = new Uint32Array(readFileSync(join(restDir, 'indices.bin')).buffer.slice(0));
const rings = tapeRings(rest);
const BODY_T = [-1, 0, 0.5, 1];
const bodies = BODY_T.map(chartBody);
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canon = buildMannequinMesh(m, { head: 'neutral' });
const colliders = new Map(bodies.map((b) => [b.t, makeCollider(bodyField(m, buildAvatar(m, canon, { bust: b.bust, waist: b.waist, hip: b.hip })), 0.35)]));

const plan: (DrapeBakeSizeMeta & { pos: Map<number, Float32Array> })[] = [];
for (const s of rest.sizes) {
  const base = f32(join(restDir, `rest-${s.size}.bin`));
  const pos = new Map<number, Float32Array>();
  const notDraped: { t: number; reason: string }[] = [];
  for (const b of bodies) {
    const p = Float32Array.from(base);
    settleOnBody(p, colliders.get(b.t)!);
    const hip = ringLength(p, rings.hip), want = s.tape.hipCm!.cm;
    if (b.t !== 0 && hip - want > bakeRingToleranceCm(want)) {
      notDraped.push({ t: b.t, reason: `the hip line would have to stretch from ${want} to ${hip.toFixed(1)} cm to go round this body` });
      continue;
    }
    pos.set(b.t, p);
  }
  const targetT = BODY_T.filter((t) => t !== 0 && pos.has(t));
  // No refusal may sit between two drapes: drop a draped body beyond a refused one (the device holds the last drape).
  const keep = targetT.filter((t) => !notDraped.some((n) => (t > 0 ? n.t > 0 && n.t < t : n.t < 0 && n.t > t)));
  for (const t of targetT.filter((x) => !keep.includes(x))) notDraped.push({ t, reason: 'beyond a body this size could not be put on' });
  const drapes = [0, ...keep].map((t) => ({ t, atRest: true, maxMoveCmPerFrame: 0, meanMoveCmPerFrame: 0 }));
  plan.push({ size: s.size, baseT: 0, targetT: keep, provenance: s.provenance, ...(notDraped.length ? { notDraped: notDraped.sort((a, b) => a.t - b.t) } : {}), drapes, pos });
}

const meta: DrapeBakeMeta = {
  format: DRAPE_BAKE_FORMAT,
  formatVersion: 1,
  axis: { measure: 'hip', hipAtZero: 104, hipPerUnit: 10, label: 'AU body chart of the skirt: hip 104 + 10 t (t = -1, 0, 1: AU 8, 12, 16)' },
  quantStepCm: 0.05,
  plainColourHex: '#9D3F3B',
  plainColourSource: 'the POM v2 bake colour (bake-pom.ts default)',
  sizes: plan.map(({ pos: _p, ...s }) => s),
  source: 'FIXTURE, not a simulation: POM v2 rest geometry from the shop tape (pom_rest.py --profile tube --edge 1.0) pushed out of the device avatar of each chart body (settleOnBody, 0.35 cm); ESTIMATE',
  bodies,
  tapeRings: rings,
};
const glb = await writeDrapeBake({ meta, indices, drapes: plan.map((p) => ({ size: p.size, base: p.pos.get(0)!, targets: p.targetT.map((t) => p.pos.get(t)!) })), generator: 'curtain bake-pom-rest-fixture.ts' });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'base.glb'), glb);
const productId = 'crimson-wildflower-maxi-skirt';
const json = (name: string, v: unknown): void => writeFileSync(join(outDir, name), JSON.stringify(v, null, 1) + '\n');
json('anchors.json', { format: 'curtain.garment.anchors', formatVersion: 1, productId, baseSize: '12', category: 'bottom', unit: 'cm', mannequin: { version: '0.1.0', shape: 'M', family: 'female' }, synthetic: true, source: { kind: 'pom-v2-rest-fixture', label: 'test fixture of the bake check: rest geometry, not a drape. An ESTIMATE (AGENTS.md rule 3)' }, drapeBake: 'base.glb', rings: {} });
json('grading.json', { format: 'curtain.garment.grading', formatVersion: 1, productId, baseSize: '12', unit: 'cm', morph: { method: 'none: every size is its own drape (drapeBake in base.glb)' }, sizes: rest.sizes.map((s) => ({ size: s.size, provenance: s.provenance })) });
json('material.json', { format: 'curtain.garment.material', formatVersion: 1, fibres: [{ id: 'viscose', pct: 100 }], construction: null, weightGsm: 165, stretchPct: 1.5, drape: 0.85, bendStiffness: 0.04, sheen: 0.3, texture: 'plain-weave', simulation: { damping: 0.035 }, baseColorHex: '#9D3F3B', opacity: 1 });
json('qa.json', {
  format: 'curtain.garment.qa', formatVersion: 1, productId, synthetic: true,
  label: 'tape-built geometry: an estimate, not a measurement (AGENTS.md rule 3)',
  chartAgreement: { pass: true, kind: 'tape-built', basis: 'built from the shop tape; the import bake check tests the geometry against this tape', toleranceCm: 2, maxAbsCm: null },
  tape: qaTape(rest, null),
});
console.log(`${outDir}: base.glb ${glb.byteLength} bytes`);
for (const p of plan) console.log(`AU ${p.size} (${p.provenance}): bodies ${[0, ...p.targetT].join(', ')}; not draped ${(p.notDraped ?? []).map((n) => `${n.t} (${n.reason})`).join('; ') || '-'}`);
