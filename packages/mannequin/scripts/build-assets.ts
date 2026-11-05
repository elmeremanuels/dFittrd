/**
 * Writes the canonical mannequin assets to packages/mannequin/out/ (gitignored, deterministic):
 *   out/<shape>/mannequin.glb    mesh in metres, mid-grey material
 *   out/<shape>/anchors.json     rings, length lines, morph heights, rig (cm)
 *   out/<shape>/camera-paths.json turntable at three heights
 *   out/motion-clip.json          the fixed motion clip (keyframes + sampled frame times)
 *   out/manifest.json             sha256 of every file
 * Run: pnpm --filter @curtain/mannequin build:assets
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BODY_SHAPE_IDS,
  MANNEQUIN_VERSION,
  MOTION_CLIP,
  bodyShape,
  buildMannequin,
  buildMannequinMesh,
  clipFrameTimes,
  mannequinAnchorsJson,
  topology,
  turntablePaths,
  vertexNormals,
  writeGlb,
} from '../src/index';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const manifest: Record<string, string> = {};
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const write = (path: string, data: Uint8Array | string): void => {
  const full = join(out, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  manifest[path] = sha(data);
};
const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

for (const id of BODY_SHAPE_IDS) {
  const mannequin = buildMannequin(bodyShape(id));
  const mesh = buildMannequinMesh(mannequin);
  const topo = topology(mesh);
  if (!topo.watertight) throw new Error(`mannequin ${id} is not watertight: ${JSON.stringify(topo)}`);
  const glb = writeGlb([{ name: `mannequin-${id}`, positions: mesh.positions, normals: vertexNormals(mesh), indices: mesh.indices, baseColor: [0.5, 0.5, 0.5, 1], roughness: 0.9 }], {
    scale: 0.01,
    generator: `@curtain/mannequin ${MANNEQUIN_VERSION}`,
    extras: { shape: id, unit: 'm', axes: { up: '+Y', front: '+Z', left: '+X' } },
  });
  write(`${id}/mannequin.glb`, glb);
  write(`${id}/anchors.json`, json(mannequinAnchorsJson(mannequin, mesh, { glbSha256: sha(glb) })));
  write(`${id}/camera-paths.json`, json({ format: 'curtain.mannequin.camera-paths', formatVersion: 1, shape: id, unit: 'cm', paths: turntablePaths(mannequin) }));
  console.log(`[mannequin] ${id}: ${topo.vertices} vertices, ${topo.triangles} triangles, ${topo.components} closed parts`);
}
write('motion-clip.json', json({ format: 'curtain.mannequin.motion-clip', formatVersion: 1, clip: MOTION_CLIP, frameTimesS: clipFrameTimes(MOTION_CLIP) }));
writeFileSync(join(out, 'manifest.json'), json({ mannequinVersion: MANNEQUIN_VERSION, files: manifest }));
console.log(`[mannequin] wrote ${Object.keys(manifest).length} files to ${relative(process.cwd(), out) || '.'}`);
