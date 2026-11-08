/** Forked from spikes/garment-engine/src/evalMesh.ts (`weldWithRemap`): weld a mesh by position, keeping the map from old to new vertex. */
import type { Mesh } from '@curtain/mannequin';

export function weldWithRemap(mesh: Mesh, epsCm = 1e-4): { mesh: Mesh; remap: Uint32Array } {
  const map = new Map<string, number>();
  const remap = new Uint32Array(mesh.positions.length / 3);
  const pos: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[3 * i]!, y = mesh.positions[3 * i + 1]!, z = mesh.positions[3 * i + 2]!;
    const key = `${Math.round(x / epsCm)},${Math.round(y / epsCm)},${Math.round(z / epsCm)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = pos.length / 3;
      map.set(key, j);
      pos.push(x, y, z);
    }
    remap[i] = j;
  }
  const idx: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!, b = remap[mesh.indices[t + 1]!]!, c = remap[mesh.indices[t + 2]!]!;
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const positions = Float64Array.from(pos);
  return { mesh: { positions, indices: Uint32Array.from(idx), vertexPart: new Uint8Array(positions.length / 3), partNames: mesh.partNames }, remap };
}
