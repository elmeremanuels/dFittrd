/**
 * Writes the canonical mannequin assets to packages/mannequin/out/ (gitignored, deterministic):
 * Female shapes keep their v0 paths (out/<shape>/…); male shapes are under out/male/<shape>/…
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
  BODY_FAMILIES,
  MANNEQUIN_VERSION,
  MOTION_CLIP,
  buildMannequin,
  buildMannequinMesh,
  clipFrameTimes,
  familyShape,
  familyShapeIds,
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

for (const family of BODY_FAMILIES) {
  for (const id of familyShapeIds(family)) {
    const dir = family === 'female' ? id : `${family}/${id}`;
    const mannequin = buildMannequin(familyShape(family, id)!);
    const mesh = buildMannequinMesh(mannequin);
    const topo = topology(mesh);
    if (!topo.watertight) throw new Error(`mannequin ${dir} is not watertight: ${JSON.stringify(topo)}`);
    const glb = writeGlb([{ name: `mannequin-${family === 'female' ? id : `${family}-${id}`}`, positions: mesh.positions, normals: vertexNormals(mesh), indices: mesh.indices, baseColor: [0.5, 0.5, 0.5, 1], roughness: 0.9 }], {
      scale: 0.01,
      generator: `@curtain/mannequin ${MANNEQUIN_VERSION}`,
      extras: { shape: id, ...(family === 'female' ? {} : { family }), unit: 'm', axes: { up: '+Y', front: '+Z', left: '+X' } },
    });
    write(`${dir}/mannequin.glb`, glb);
    write(`${dir}/anchors.json`, json(mannequinAnchorsJson(mannequin, mesh, { glbSha256: sha(glb) })));
    write(`${dir}/camera-paths.json`, json({ format: 'curtain.mannequin.camera-paths', formatVersion: 1, shape: id, ...(family === 'female' ? {} : { family }), unit: 'cm', paths: turntablePaths(mannequin) }));
    console.log(`[mannequin] ${dir}: ${topo.vertices} vertices, ${topo.triangles} triangles, ${topo.components} closed parts`);
  }
}
write('motion-clip.json', json({ format: 'curtain.mannequin.motion-clip', formatVersion: 1, clip: MOTION_CLIP, frameTimesS: clipFrameTimes(MOTION_CLIP) }));
writeFileSync(join(out, 'manifest.json'), json({ mannequinVersion: MANNEQUIN_VERSION, files: manifest }));
console.log(`[mannequin] wrote ${Object.keys(manifest).length} files to ${relative(process.cwd(), out) || '.'}`);
