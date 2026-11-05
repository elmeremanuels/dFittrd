/**
 * A procedural rig on the mannequin and the one fixed motion clip (handoff: "arms raise, half turn,
 * step"). Linear blend skinning with at most two joints per vertex: each part follows its chain
 * (torso: root → spine; arm: shoulder → elbow; leg: hip → knee) with a short blend zone at the middle
 * joint. Joint angles are Euler degrees in the parent's rest frame (`rotationEulerDeg`, R = Rx·Ry·Rz),
 * rotating about the joint's rest pivot.
 */
import { identity, multiply, rotationEulerDeg, sub, dot, transformPoint, translation, type Mat4, type Vec3 } from './math';
import type { Mesh } from './mesh';
import { JOINT_IDS, type JointId, type Mannequin } from './model';

export interface SkinWeights {
  /** Two joint indices (into `JOINT_IDS`) per vertex. */
  joints: Uint8Array;
  /** Two weights per vertex, summing to 1. */
  weights: Float64Array;
}

const J = (id: JointId): number => JOINT_IDS.indexOf(id);

/** Half-width of the blend zone around the spine, elbow and knee, cm. */
export const BLEND_HALF_WIDTH_CM = 4;

const blend = (s: number, at: number): number => Math.min(1, Math.max(0, (s - (at - BLEND_HALF_WIDTH_CM)) / (2 * BLEND_HALF_WIDTH_CM)));

/** Skin weights of a mesh built from (or around) the mannequin, from each vertex's part and position. */
export function skinWeights(mannequin: Mannequin, mesh: Mesh): SkinWeights {
  const n = mesh.positions.length / 3;
  const joints = new Uint8Array(n * 2);
  const weights = new Float64Array(n * 2);
  const pivot = (id: JointId): Vec3 => mannequin.joints.find((j) => j.id === id)!.pivot;
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
    const part = mesh.partNames[mesh.vertexPart[i]!] ?? 'torso';
    let a: JointId, b: JointId, t: number;
    if (part.startsWith('arm') || part.startsWith('sleeve')) {
      const left = part.endsWith('_l');
      const arm = left ? mannequin.arms.left : mannequin.arms.right;
      a = left ? 'shoulder_l' : 'shoulder_r';
      b = left ? 'elbow_l' : 'elbow_r';
      t = blend(dot(sub(p, arm.joint), arm.axis), arm.upperArmCm);
    } else if (part.startsWith('leg')) {
      const left = part.endsWith('_l');
      a = left ? 'hip_l' : 'hip_r';
      b = left ? 'knee_l' : 'knee_r';
      t = 1 - blend(p[1], pivot(b)[1]);
    } else {
      a = 'root';
      b = 'spine';
      t = blend(p[1], pivot('spine')[1]);
    }
    joints[2 * i] = J(a);
    joints[2 * i + 1] = J(b);
    weights[2 * i] = 1 - t;
    weights[2 * i + 1] = t;
  }
  return { joints, weights };
}

export interface Pose {
  /** Euler degrees per joint (missing = rest). */
  joints: Partial<Record<JointId, Vec3>>;
  /** Translation of the whole body, cm (world). */
  rootTranslation?: Vec3;
}

/** World matrix per joint (index = `JOINT_IDS`). */
export function jointMatrices(mannequin: Mannequin, pose: Pose): Mat4[] {
  const out: Mat4[] = new Array<Mat4>(JOINT_IDS.length);
  const byId = new Map(mannequin.joints.map((j) => [j.id, j]));
  const compute = (id: JointId): Mat4 => {
    const k = J(id);
    if (out[k]) return out[k]!;
    const joint = byId.get(id)!;
    const local = multiply(translation(joint.pivot), multiply(rotationEulerDeg(pose.joints[id] ?? [0, 0, 0]), translation([-joint.pivot[0], -joint.pivot[1], -joint.pivot[2]])));
    const parent = joint.parent ? compute(joint.parent) : translation(pose.rootTranslation ?? [0, 0, 0]);
    out[k] = multiply(parent, local);
    return out[k]!;
  };
  for (const id of JOINT_IDS) compute(id);
  return out;
}

/** Positions of the posed mesh (linear blend skinning). */
export function poseMesh(mannequin: Mannequin, mesh: Mesh, skin: SkinWeights, pose: Pose): Float64Array {
  const mats = jointMatrices(mannequin, pose);
  const n = mesh.positions.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 2; k++) {
      const w = skin.weights[2 * i + k]!;
      if (w === 0) continue;
      const q = transformPoint(mats[skin.joints[2 * i + k]!]!, p);
      x += w * q[0];
      y += w * q[1];
      z += w * q[2];
    }
    out[3 * i] = x;
    out[3 * i + 1] = y;
    out[3 * i + 2] = z;
  }
  return out;
}

/** A point carried rigidly by one joint (e.g. a ring centre). */
export function posePoint(mannequin: Mannequin, joint: JointId, p: Vec3, pose: Pose): Vec3 {
  return transformPoint(jointMatrices(mannequin, pose)[J(joint)] ?? identity(), p);
}

// ---------------------------------------------------------------------------
// Motion clip
// ---------------------------------------------------------------------------

export interface Keyframe extends Pose {
  /** Seconds. */
  t: number;
}

export interface MotionClip {
  id: string;
  fps: number;
  durationS: number;
  /** Ascending in `t`; every keyframe is a full pose (unlisted joints are at rest). */
  keyframes: Keyframe[];
  description: string;
}

/**
 * The one fixed clip: arms raise (0–2 s), half turn (2–4 s), one step forward (4–5.2 s), hold.
 * Shoulder Z rotates the arm outward (left +, right −) on top of the A-pose; hip X − swings the
 * leg forward; knee X + bends the shin back. After the half turn the mannequin faces −Z.
 */
export const MOTION_CLIP: MotionClip = {
  id: 'arms-raise-half-turn-step',
  fps: 24,
  durationS: 6,
  description: 'Arms raise 70° and lower (0–2 s), half turn to the back (2–4 s), left step forward 25 cm (4–5.2 s), hold (5.2–6 s).',
  keyframes: [
    { t: 0, joints: {} },
    { t: 1, joints: { shoulder_l: [0, 0, 70], shoulder_r: [0, 0, -70], elbow_l: [0, 0, 10], elbow_r: [0, 0, -10] } },
    { t: 2, joints: {} },
    { t: 4, joints: { root: [0, 180, 0] } },
    { t: 4.6, joints: { root: [0, 180, 0], hip_l: [-25, 0, 0], knee_l: [30, 0, 0], hip_r: [8, 0, 0] }, rootTranslation: [0, 0, -12] },
    { t: 5.2, joints: { root: [0, 180, 0] }, rootTranslation: [0, 0, -25] },
    { t: 6, joints: { root: [0, 180, 0] }, rootTranslation: [0, 0, -25] },
  ],
};

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Pose at time `t` (s): smoothstep-eased interpolation between neighbouring keyframes, clamped to the clip. */
export function sampleClip(clip: MotionClip, t: number): Pose {
  const ks = clip.keyframes;
  if (ks.length === 0) return { joints: {} };
  if (t <= ks[0]!.t) return ks[0]!;
  if (t >= ks[ks.length - 1]!.t) return ks[ks.length - 1]!;
  let k = 0;
  while (t > ks[k + 1]!.t) k++;
  const a = ks[k]!, b = ks[k + 1]!;
  const w = smoothstep((t - a.t) / (b.t - a.t));
  const joints: Partial<Record<JointId, Vec3>> = {};
  for (const id of JOINT_IDS) {
    const p = a.joints[id] ?? [0, 0, 0];
    const q = b.joints[id] ?? [0, 0, 0];
    if (p.some((x) => x !== 0) || q.some((x) => x !== 0)) joints[id] = [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w, p[2] + (q[2] - p[2]) * w];
  }
  const ta = a.rootTranslation ?? [0, 0, 0];
  const tb = b.rootTranslation ?? [0, 0, 0];
  return { joints, rootTranslation: [ta[0] + (tb[0] - ta[0]) * w, ta[1] + (tb[1] - ta[1]) * w, ta[2] + (tb[2] - ta[2]) * w] };
}

/** Frame times of the clip: `fps · durationS + 1` samples from 0 to the end. */
export function clipFrameTimes(clip: MotionClip): number[] {
  const n = Math.round(clip.fps * clip.durationS);
  return Array.from({ length: n + 1 }, (_, i) => i / clip.fps);
}
