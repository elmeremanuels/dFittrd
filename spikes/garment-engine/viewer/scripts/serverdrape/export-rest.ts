/**
 * R2 spike (docs/research/step3-serverdrape-spike.md), step 3 input: the per-size REST geometry of an evaluation bundle
 * for the server drape. For every size: the graded mesh (`gradedMesh`: base.glb + grading.json, exactly what the viewer
 * drapes), the waistband particles (`waistbandPins`: the top 4 cm under the garment's top edge) and the band girth as
 * graded (convex hull of the top 2 cm, as `slideWaistband` measures it). Plus the girth table at fixed heights
 * (`girthAt`, the measure of viewer/scripts/sizes-drape.ts) so the drape numbers compare 1:1 with the viewer's.
 *
 * Writes <outDir>/rest-<size>.bin (Float32 xyz per vertex, cm, mannequin frame) once per size, <outDir>/indices.bin
 * (Uint32, shared by every size: grading moves vertices only) and <outDir>/rest.json.
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/serverdrape/export-rest.ts out/eval/<id> out/serverdrape/rest
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { meshFromGlb, type SpikeBundle } from '../../src/bundle';
import { gradedMesh, openSession, sizeLabels, waistbandPins } from '../../src/engine';
import { girthAt } from './girth';

const [dir, outDir] = [process.argv[2]!, process.argv[3]!];
const rd = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const bundle: SpikeBundle = {
  productId: String((rd('anchors.json') as { productId: string }).productId),
  anchors: rd('anchors.json') as SpikeBundle['anchors'],
  grading: rd('grading.json') as SpikeBundle['grading'],
  material: rd('material.json') as SpikeBundle['material'],
  qa: rd('qa.json') as SpikeBundle['qa'],
  baseMesh: meshFromGlb(new Uint8Array(readFileSync(join(dir, 'base.glb')))),
  payload: rd('payload.json') as GarmentPayload,
};
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const session = openSession(m, bundle);
mkdirSync(outDir, { recursive: true });
const HEIGHTS = [100, 95, 87, 75, 60, 40, 20];
const indices = Uint32Array.from(bundle.baseMesh.indices);
writeFileSync(join(outDir, 'indices.bin'), Buffer.from(indices.buffer));
const sizes = [];
for (const size of sizeLabels(session)) {
  const g = gradedMesh(session, size);
  const pos = Float32Array.from(g.positions);
  writeFileSync(join(outDir, `rest-${size}.bin`), Buffer.from(pos.buffer));
  const band = waistbandPins(pos, indices, session.chains);
  let top = -Infinity, minY = Infinity;
  for (let i = 1; i < pos.length; i += 3) { top = Math.max(top, pos[i]!); minY = Math.min(minY, pos[i]!); }
  sizes.push({
    size,
    file: `rest-${size}.bin`,
    topY: top,
    hemY: minY,
    bandGradedGirthCm: girthAt(pos, indices, top - 2),
    girths: Object.fromEntries(HEIGHTS.map((y) => [y, girthAt(pos, indices, y)])),
  });
  if (sizes.length === 1) writeFileSync(join(outDir, 'band.bin'), Buffer.from(band.buffer));
}
const uvs = (bundle.baseMesh as { uvs?: ArrayLike<number> }).uvs;
if (uvs) writeFileSync(join(outDir, 'uvs.bin'), Buffer.from(Float32Array.from(uvs).buffer));
const meta = {
  productId: bundle.productId,
  source: dir,
  vertexCount: pos0Count(),
  triangleCount: indices.length / 3,
  baseSize: bundle.grading.baseSize,
  material: bundle.material.simulation,
  weightGsm: bundle.material.weightGsm,
  stretchPct: bundle.material.stretchPct,
  drape: bundle.material.drape,
  colour: bundle.material.baseColorHex,
  stretchZones: bundle.payload?.stretchZones ?? [],
  mannequin: { waistY: m.morphHeights.waist, hipY: m.morphHeights.hip },
  heights: HEIGHTS,
  sizes,
};
writeFileSync(join(outDir, 'rest.json'), JSON.stringify(meta, null, 1));
console.log(JSON.stringify({ ...meta, sizes: sizes.map((s) => ({ size: s.size, band: s.bandGradedGirthCm, top: s.topY.toFixed(1), hem: s.hemY.toFixed(1), girths: s.girths })) }, null, 1));

function pos0Count(): number {
  return bundle.baseMesh.positions.length / 3;
}
