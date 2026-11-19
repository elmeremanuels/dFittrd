/**
 * The face texture frame of head v2 (slice 6 spike of docs/research/photo-avatar-plan.md): a flat
 * frame in front of the v2 head, in the head's own unit cm (chin 0, top 22, x across, as in
 * `headV2.ts`), into which a face texture is baked. A vertex of the head gets the texture point
 * straight in front of it (a planar projection along z), so the frame needs no UV seams and the
 * same numbers serve the bake (in the capture worker) and the viewer.
 *
 * The bake side never sees the mannequin: it reads the frame and the head's landmarks through the
 * face mesh asset (`apps/web/src/features/capture/faceMeshUv.json`), which records the values it was
 * built for; `faceUv.test.ts` fails when they drift from these.
 *
 * Own numbers only. No face model, scan or photo is in this file.
 */
import { FACE_LEVELS_V2 } from './headV2';
import type { Mesh } from './mesh';

/** Unit height of the v2 head (as `headV2.ts`). */
const UNIT = 22;

/** The frame, unit cm of head v2: u runs from x0 to x1, v from y1 (top row, v = 0) down to y0. */
export const FACE_UV_FRAME = { x0: -9, x1: 9, y0: -2, y1: 16 } as const;

/** The head v2 landmarks a face texture is aligned to (unit cm): eye centres, nose tip, mouth line. */
export const FACE_UV_LANDMARKS = {
  eyeX: FACE_LEVELS_V2.eyeX,
  eyeY: FACE_LEVELS_V2.eyes,
  noseTipY: FACE_LEVELS_V2.noseTip,
  mouthY: FACE_LEVELS_V2.mouth,
} as const;

/** Texture coordinates (u right, v down from the top, both 0..1) of a point of the unit head. */
export function faceUvAt(x: number, y: number): [number, number] {
  const f = FACE_UV_FRAME;
  return [(x - f.x0) / (f.x1 - f.x0), (f.y1 - y) / (f.y1 - f.y0)];
}

/**
 * The face texture coordinates of every vertex of a mesh with the v2 head (two per vertex, u then
 * v, v down from the top). Vertices of other parts, and of the head outside the frame, get -1.
 * Null for a mesh without the v2 head. The head's x is read as built: a head widened by the
 * viewer's morph (`calmHead`, at most a few per cent) maps a little narrower than it is drawn.
 */
export function faceUvOf(mesh: Pick<Mesh, 'positions' | 'vertexPart' | 'partNames' | 'headLevels'>): Float32Array | null {
  const head = mesh.partNames.indexOf('head');
  if (head < 0 || !mesh.headLevels) return null;
  const { chinY, topY } = mesh.headLevels;
  const k = (topY - chinY) / UNIT;
  const n = mesh.vertexPart.length;
  const out = new Float32Array(2 * n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (mesh.vertexPart[i] !== head) continue;
    const [u, v] = faceUvAt(mesh.positions[3 * i]! / k, (mesh.positions[3 * i + 1]! - chinY) / k);
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    out[2 * i] = u;
    out[2 * i + 1] = v;
  }
  return out;
}
