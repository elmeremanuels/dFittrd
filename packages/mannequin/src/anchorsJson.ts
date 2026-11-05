/**
 * `anchors.json` of a mannequin shape: per anchor ring its 3D centre, plane, axes and girth (table
 * value and measured on the mesh), the length lines, the morph heights for `@curtain/anchors`
 * grading, and the rig. Units: cm, mannequin space (+Y up, +Z front, +X the mannequin's left).
 * The .glb next to it is in metres (glTF convention).
 */
import { type AnchorRing } from '@curtain/anchors';
import { round, roundVec, type Vec3 } from './math';
import type { Mesh } from './mesh';
import type { Mannequin, RingFrame } from './model';
import { loopAround, loopLength, slice } from './slice';

/** Girth of the mesh at a ring: the loop of the ring's own part, around the ring centre, in the ring plane. */
export function meshRingCircumference(mesh: Mesh, ring: Pick<RingFrame, 'centre' | 'normal' | 'u' | 'v' | 'part'>): number | null {
  const partIndex = mesh.partNames.indexOf(ring.part);
  const filter = partIndex < 0 ? undefined : (t: number) => mesh.vertexPart[mesh.indices[3 * t]!] === partIndex;
  const loop = loopAround(slice(mesh.positions, mesh.indices, { origin: ring.centre, normal: ring.normal }, filter), ring.centre, ring.u, ring.v);
  return loop ? loopLength(loop) : null;
}

export interface MannequinAnchorsJson {
  format: 'curtain.mannequin.anchors';
  formatVersion: 1;
  mannequinVersion: string;
  shape: string;
  unit: 'cm';
  axes: { up: '+Y'; front: '+Z'; left: '+X' };
  statureCm: number;
  rings: Record<string, {
    side: RingFrame['side'];
    part: string;
    centre: Vec3;
    normal: Vec3;
    u: Vec3;
    v: Vec3;
    a: number;
    b: number;
    circumferenceCm: number;
    meshCircumferenceCm: number | null;
    source: 'table' | 'proportion';
  }>;
  lengths: Record<string, { measure: string; start: Vec3; direction: Vec3; bodyEnd: Vec3; bodyLengthCm: number }>;
  morphHeights: Record<AnchorRing, number>;
  landmarks: { hps: Vec3; waistFront: Vec3; crotch: Vec3 };
  joints: { id: string; parent: string | null; pivot: Vec3 }[];
  mesh: { vertices: number; triangles: number; glbSha256?: string };
}

export function mannequinAnchorsJson(mannequin: Mannequin, mesh: Mesh, extra: { glbSha256?: string } = {}): MannequinAnchorsJson {
  const rings: MannequinAnchorsJson['rings'] = {};
  for (const r of mannequin.rings) {
    const measured = meshRingCircumference(mesh, r);
    rings[r.id] = {
      side: r.side,
      part: r.part,
      centre: roundVec(r.centre),
      normal: roundVec(r.normal, 6),
      u: roundVec(r.u, 6),
      v: roundVec(r.v, 6),
      a: round(r.a),
      b: round(r.b),
      circumferenceCm: r.circumferenceCm,
      meshCircumferenceCm: measured === null ? null : round(measured),
      source: mannequin.shape.provenance[r.id],
    };
  }
  const lengths: MannequinAnchorsJson['lengths'] = {};
  for (const l of mannequin.lengths) {
    lengths[l.id] = { measure: l.measure, start: roundVec(l.start), direction: roundVec(l.direction, 6), bodyEnd: roundVec(l.bodyEnd), bodyLengthCm: round(l.bodyLengthCm, 2) };
  }
  const morphHeights = {} as Record<AnchorRing, number>;
  for (const [k, v] of Object.entries(mannequin.morphHeights) as [AnchorRing, number][]) morphHeights[k] = round(v);
  return {
    format: 'curtain.mannequin.anchors',
    formatVersion: 1,
    mannequinVersion: mannequin.version,
    shape: mannequin.shape.id,
    unit: 'cm',
    axes: { up: '+Y', front: '+Z', left: '+X' },
    statureCm: mannequin.statureCm,
    rings,
    lengths,
    morphHeights,
    landmarks: { hps: roundVec(mannequin.landmarks.hps), waistFront: roundVec(mannequin.landmarks.waistFront), crotch: roundVec(mannequin.landmarks.crotch) },
    joints: mannequin.joints.map((j) => ({ id: j.id, parent: j.parent, pivot: roundVec(j.pivot) })),
    mesh: { vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3, ...extra },
  };
}
