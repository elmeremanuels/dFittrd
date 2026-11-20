/**
 * Stage 4 (2DGS) against stage 4t (template fit) on one job, with the same instruments for both, CPU:
 *
 *   pnpm --filter @curtain/garment-spike stage4t:compare -- <job dir> [--source stage2|synthetic]
 *
 * Per mesh (welded): clearance to the mannequin by three methods (the grid SDF's sign and value, the
 * exact distance to mannequin.glb's triangles, the evaluation's analytic test of more than 3 mm
 * inside), and the per-view IoU against the job's garment masks, visible (mannequin in front) and
 * silhouette (garment alone), over the train and the holdout split (frame index mod 5 = 2). Writes
 * <job dir>/stage4t/<source>/compare.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, type Mesh } from '@curtain/mannequin';
import { buildBodySdf } from '../src/bodySdf';
import { clothInsideBody } from '../src/eval';
import { readGarmentGlb, weldVertices } from '../src/evalMesh';
import { distancesToMesh } from '../src/meshDistance';
import { loadJobViews, summarise, viewIous, type Stage4tSource } from '../src/stage4t';
import { splitFrames } from '../src/views';

const args = process.argv.slice(2).filter((a) => a !== '--');
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) throw new Error('usage: stage4t:compare <job dir> [--source stage2|synthetic]');
const at = args.indexOf('--source');
const source = (at >= 0 ? args[at + 1] : 'stage2') as Stage4tSource;
const jobDir = resolve(dir);
const glb = (p: string): Mesh => weldVertices(readGarmentGlb(new Uint8Array(readFileSync(join(jobDir, p)))).mesh);
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const body = glb('mannequin.glb');
const sdf = buildBodySdf(body);
const views = loadJobViews(jobDir, source);
const { train } = splitFrames(views.cameras.length);
const r4 = (x: number): number => Math.round(x * 10000) / 10000;

const meshes = [
  { label: 'stage 4 (2DGS + TSDF)', path: `stage4/${source}/garment.glb` },
  { label: 'stage 4t (template fit)', path: `stage4t/${source}/garment.glb` },
].filter((x) => existsSync(join(jobDir, x.path)));

const rows = meshes.map(({ label, path }) => {
  const mesh = glb(path);
  const nv = mesh.positions.length / 3;
  const exact = distancesToMesh(mesh.positions, body, 2);
  let sdfInside = 0, exactMin = Infinity, outsideMin = Infinity, below4 = 0, below3 = 0, insideDeeper3 = 0;
  for (let i = 0; i < nv; i++) {
    const s = sdf.at(mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!);
    const d = exact[i]!;
    exactMin = Math.min(exactMin, d);
    if (s < 0) {
      sdfInside++;
      if (d > 0.3) insideDeeper3++;
    } else {
      outsideMin = Math.min(outsideMin, d);
      if (d < 0.4) below4++;
      if (d < 0.3) below3++;
    }
  }
  const ious = viewIous(mesh, body, views, train);
  const row = {
    mesh: label,
    path,
    vertices: nv,
    insideBySdfSign: { vertices: sdfInside, share: r4(sdfInside / nv), deeperThan3mm: insideDeeper3, deeperThan3mmShare: r4(insideDeeper3 / nv) },
    analyticMoreThan3mmInside: clothInsideBody(m, mesh),
    outside: { minExactCm: Number.isFinite(outsideMin) ? r4(outsideMin) : null, below4mm: below4, below3mm: below3 },
    minExactDistanceCm: r4(exactMin),
    iou: { train: summarise(ious, 'train'), holdout: summarise(ious, 'holdout'), atAzimuth: ious.filter((x) => [0, 90, 180, 270].includes(Math.round(x.azimuthDeg))) },
  };
  console.log(
    `[compare] ${label}: inside by SDF sign ${sdfInside}/${nv} (${(row.insideBySdfSign.share * 100).toFixed(1)} %), more than 3 mm inside (SDF sign, exact depth) ${(row.insideBySdfSign.deeperThan3mmShare * 100).toFixed(1)} %, analytic ${(row.analyticMoreThan3mmInside.share * 100).toFixed(1)} %; ` +
      `outside: closest ${row.outside.minExactCm} cm (exact), ${below4} below 4 mm, ${below3} below 3 mm; ` +
      `holdout visible ${row.iou.holdout.visibleMean} (${row.iou.holdout.visibleMin}), silhouette ${row.iou.holdout.silhouetteMean} (${row.iou.holdout.silhouetteMin}); train visible ${row.iou.train.visibleMean}, silhouette ${row.iou.train.silhouetteMean}`,
  );
  return row;
});

const out = join(jobDir, 'stage4t', source);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'compare.json'), `${JSON.stringify({ format: 'curtain.phase0.stage4t-compare', formatVersion: 1, source, methods: { sdf: 'grid SDF of mannequin.glb (bodySdf.ts, union of closed parts, trilinear), sign = inside', exact: 'unsigned point-to-triangle distance to mannequin.glb (meshDistance.ts)', analytic: 'clothInsideBody: more than 0.3 cm inside the analytic mannequin sections' }, rows }, null, 2)}\n`);
console.log(`[compare] wrote ${join(out, 'compare.json')}`);
