/**
 * The procedural canonical mannequin (v0): a fixed A-pose body made of five lofted parts (torso with
 * head, two legs, two arms). Every part is a stack of elliptical cross-sections; the anchor rings of
 * `@curtain/anchors` are exact sections, so the girth of the mesh at every anchor is the shape's
 * table value. Between rings the axes follow the monotone cubic of `@curtain/anchors`
 * (`monotoneProfile`), the same interpolation the grading morph uses.
 *
 * Proportions (fractions of stature) follow the nominal ring heights of `@curtain/anchors`
 * (`NOMINAL_RING_HEIGHTS`) and common drafting proportions for limbs and head. Everything is a pure
 * function of the body shape: same shape in, same numbers out.
 */
import {
  NOMINAL_RING_HEIGHTS,
  ellipseCircumference,
  ellipseFromCircumference,
  monotoneProfile,
  type AnchorLength,
  type AnchorRing,
  type Ellipse,
} from '@curtain/anchors';
import { along, lerp, normalize, type Vec3 } from './math';
import type { BodyShape } from './shapes';

export const MANNEQUIN_VERSION = '0.1.0';

/** Arm angle from the vertical in the A-pose, degrees. */
export const A_POSE_ARM_DEG = 32;

export const PART_IDS = ['torso', 'leg_l', 'leg_r', 'arm_l', 'arm_r'] as const;
export type PartId = (typeof PART_IDS)[number];

/** `+1` for the mannequin's left (+X), `−1` for its right. */
export type Side = 1 | -1;

/** One elliptical cross-section: points `centre + a·sin(t)·u + b·cos(t)·v` (t = 0 at the front, as `ellipseRingPoints`). */
export interface Section {
  centre: Vec3;
  /** Width axis (unit). */
  u: Vec3;
  /** Depth axis (unit, towards the front). */
  v: Vec3;
  a: number;
  b: number;
}

export interface PartSpec {
  id: PartId;
  /** Vertices per cross-section. */
  segments: number;
  sections: Section[];
  /** Closing vertex before the first section and after the last one. */
  startPole: Vec3;
  endPole: Vec3;
}

export interface RingFrame {
  id: AnchorRing;
  /** Torso rings are `centre`; limb rings are given for the left side (mirror X for the right). */
  side: 'centre' | 'left';
  part: PartId;
  centre: Vec3;
  /** Plane normal: +Y for torso and legs, the arm axis (pointing to the hand) for arm rings. */
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  /** Semi-axes of the analytic ellipse (its circumference is `circumferenceCm`). */
  a: number;
  b: number;
  circumferenceCm: number;
  /** Position along the ring's grading chain: height above the floor (body) or distance from the shoulder joint along the arm (arm). */
  morphHeight: number;
}

/**
 * A length anchor on the mannequin. `drop` lines run straight down from `start`; `rise` runs up;
 * `axis` runs along the arm. A garment's length is where its edge meets the line; the body length
 * is the distance from `start` to `bodyEnd`.
 */
export interface LengthLine {
  id: AnchorLength;
  measure: 'drop' | 'rise' | 'axis';
  start: Vec3;
  direction: Vec3;
  bodyEnd: Vec3;
  bodyLengthCm: number;
}

export const JOINT_IDS = ['root', 'spine', 'shoulder_l', 'elbow_l', 'shoulder_r', 'elbow_r', 'hip_l', 'knee_l', 'hip_r', 'knee_r'] as const;
export type JointId = (typeof JOINT_IDS)[number];

export interface Joint {
  id: JointId;
  parent: JointId | null;
  /** Rest pivot in mannequin space, cm. */
  pivot: Vec3;
}

export interface ArmFrame {
  side: Side;
  /** Shoulder joint (the sleeve line starts here). */
  joint: Vec3;
  /** Unit axis towards the hand. */
  axis: Vec3;
  u: Vec3;
  v: Vec3;
  upperArmCm: number;
  forearmCm: number;
  handCm: number;
}

export interface Landmarks {
  /** High point shoulder (left), where shoulder-to-hem lengths start. */
  hps: Vec3;
  /** Front centre of the waist ring. */
  waistFront: Vec3;
  /** Crotch point (centre), start of inseam and rise. */
  crotch: Vec3;
  /** Centre of the left leg. */
  legX: number;
}

/** A torso or leg cross-section at a height: analytic ellipse plus its centre. */
export interface BodySection extends Ellipse {
  cx: number;
  cz: number;
}

export interface Mannequin {
  version: string;
  shape: BodyShape;
  statureCm: number;
  parts: PartSpec[];
  rings: RingFrame[];
  lengths: LengthLine[];
  joints: Joint[];
  landmarks: Landmarks;
  arms: Record<'left' | 'right', ArmFrame>;
  /** Torso ellipse at height `y` (cm), or `null` outside the torso. */
  torsoAt(y: number): BodySection | null;
  /** Leg ellipse at height `y` (cm), or `null` outside the leg. */
  legAt(y: number, side: Side): BodySection | null;
  /** Arm ellipse at distance `s` from the shoulder joint along the arm axis, or `null` outside. */
  armAt(s: number, side: Side): (Ellipse & { centre: Vec3 }) | null;
  /** Ring heights for `gradingMorph(…, { heights })`: y for the body chain, distance along the arm for the arm chain. */
  morphHeights: Record<AnchorRing, number>;
}

export interface BuildOptions {
  /** Vertices per section (default 48 torso, 32 legs, 24 arms). */
  torsoSegments?: number;
  legSegments?: number;
  armSegments?: number;
  /** Target spacing between sections, cm (default 1.6 torso, 2.0 legs, 1.8 arms). */
  torsoStepCm?: number;
  legStepCm?: number;
  armStepCm?: number;
}

interface Knot {
  x: number;
  a: number;
  b: number;
  cz?: number;
}

const H = NOMINAL_RING_HEIGHTS;

/** Perimeter of the `n`-gon with vertices at uniform parameter angles on the ellipse. */
export function polygonPerimeter(a: number, b: number, n: number): number {
  let p = 0;
  let px = 0;
  let pz = b;
  for (let i = 1; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = a * Math.sin(t);
    const z = b * Math.cos(t);
    p += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return p;
}

/**
 * Scale factor that makes the inscribed `n`-gon's perimeter equal the ellipse circumference. The
 * mesh uses it on every section, so the girth measured on the mesh is the table girth, not the
 * slightly shorter polygon.
 */
export function polygonCompensation(a: number, b: number, n: number): number {
  const p = polygonPerimeter(a, b, n);
  return p > 0 ? ellipseCircumference(a, b) / p : 1;
}

function profile(knots: readonly Knot[]): (x: number) => { a: number; b: number; cz: number } {
  const fa = monotoneProfile(knots.map((k) => ({ x: k.x, y: k.a })));
  const fb = monotoneProfile(knots.map((k) => ({ x: k.x, y: k.b })));
  const fz = monotoneProfile(knots.map((k) => ({ x: k.x, y: k.cz ?? 0 })));
  return (x) => ({ a: fa(x), b: fb(x), cz: fz(x) });
}

/** Stations from `from` to `to` (either order) about `step` apart, with every `required` value present exactly. */
export function stations(from: number, to: number, step: number, required: readonly number[]): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const n = Math.max(1, Math.round((hi - lo) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n);
  const req = required.filter((r) => r >= lo && r <= hi);
  const kept = out.filter((x) => req.every((r) => Math.abs(x - r) > step * 0.35));
  const all = [...kept, ...req].sort((p, q) => p - q);
  const dedup = all.filter((x, i) => i === 0 || x - all[i - 1]! > 1e-9);
  return from <= to ? dedup : dedup.reverse();
}

function mix(p: Ellipse, q: Ellipse, t: number): Ellipse {
  return { a: lerp(p.a, q.a, t), b: lerp(p.b, q.b, t) };
}

export function buildMannequin(shape: BodyShape, options: BuildOptions = {}): Mannequin {
  const S = shape.statureCm;
  const torsoSegments = options.torsoSegments ?? 48;
  const legSegments = options.legSegments ?? 32;
  const armSegments = options.armSegments ?? 24;
  const ring = (id: AnchorRing): Ellipse => ellipseFromCircumference(shape.rings[id].circumferenceCm, shape.rings[id].aspect);
  const y = (f: number): number => f * S;
  const E = {} as Record<AnchorRing, Ellipse>;
  for (const id of Object.keys(shape.rings) as AnchorRing[]) E[id] = ring(id);

  // --- Torso with head --------------------------------------------------------------------------
  const torsoKnots: Knot[] = [
    { x: y(0.462), a: E.hip.a * 0.55, b: E.hip.b * 0.6 },
    { x: y(0.475), a: E.hip.a * 0.82, b: E.hip.b * 0.85 },
    { x: y(0.495), a: E.hip.a * 0.96, b: E.hip.b * 0.97 },
    ...(['hip', 'waist', 'underbust', 'chest', 'shoulder'] as const).map((id) => ({ x: y(H[id]), ...E[id] })),
    { x: y(0.818), a: lerp(E.shoulder.a, E.neck.a, 0.6), b: lerp(E.shoulder.b, E.neck.b, 0.35) },
    { x: y(H.neck), ...E.neck },
    { x: y(0.865), a: E.neck.a * 1.04, b: E.neck.b * 1.08 },
    { x: y(0.885), a: 0.04 * S, b: 0.05 * S },
    { x: y(0.91), a: 0.045 * S, b: 0.056 * S },
    { x: y(0.94), a: 0.046 * S, b: 0.057 * S },
    { x: y(0.965), a: 0.041 * S, b: 0.051 * S },
    { x: y(0.985), a: 0.028 * S, b: 0.035 * S },
  ];
  const torsoProfile = profile(torsoKnots);
  const torsoLo = y(0.462);
  const torsoHi = y(0.985);
  const torsoRings = ['hip', 'waist', 'underbust', 'chest', 'shoulder', 'neck'] as const;
  const torsoSections: Section[] = stations(torsoLo, torsoHi, options.torsoStepCm ?? 1.6, torsoRings.map((id) => y(H[id]))).map((yy) => {
    const p = torsoProfile(yy);
    const k = polygonCompensation(p.a, p.b, torsoSegments);
    return { centre: [0, yy, p.cz], u: [1, 0, 0], v: [0, 0, 1], a: p.a * k, b: p.b * k };
  });

  // --- Legs -------------------------------------------------------------------------------------
  const legX = Math.max(0.5 * E.hip.a, E.thigh.a + 0.4);
  const legKnots: Knot[] = [
    { x: y(0.505), a: E.thigh.a * 1.08, b: E.thigh.b * 1.08 },
    { x: y(H.thigh), ...E.thigh },
    { x: y(0.355), ...mix(E.thigh, E.knee, 0.55) },
    { x: y(H.knee), ...E.knee },
    { x: y(H.calf), ...E.calf },
    { x: y(0.12), ...mix(E.calf, E.ankle, 0.6) },
    { x: y(H.ankle), ...E.ankle },
    { x: y(0.03), a: E.ankle.a * 1.05, b: E.ankle.b * 1.5, cz: 0.012 * S },
    { x: y(0.012), a: E.ankle.a, b: E.ankle.b * 1.8, cz: 0.02 * S },
  ];
  const legProfile = profile(legKnots);
  const legHi = y(0.505);
  const legLo = y(0.012);
  const legRings = ['thigh', 'knee', 'calf', 'ankle'] as const;
  const legStations = stations(legHi, legLo, options.legStepCm ?? 2.0, legRings.map((id) => y(H[id])));
  const legPart = (side: Side): PartSpec => ({
    id: side === 1 ? 'leg_l' : 'leg_r',
    segments: legSegments,
    sections: legStations.map((yy) => {
      const p = legProfile(yy);
      const k = polygonCompensation(p.a, p.b, legSegments);
      return { centre: [side * legX, yy, p.cz], u: [1, 0, 0], v: [0, 0, 1], a: p.a * k, b: p.b * k };
    }),
    startPole: [side * legX, y(0.515), 0],
    endPole: [side * legX, 0, 0.02 * S],
  });

  // --- Arms -------------------------------------------------------------------------------------
  const theta = (A_POSE_ARM_DEG * Math.PI) / 180;
  const UA = 0.186 * S;
  const FA = 0.146 * S;
  const HAND = 0.108 * S;
  const upperArmS = 0.4 * UA;
  const wristS = UA + FA;
  const armKnots: Knot[] = [
    { x: 0, a: E.upper_arm.a * 1.18, b: E.upper_arm.b * 1.12 },
    { x: upperArmS, ...E.upper_arm },
    { x: UA, ...mix(E.upper_arm, E.wrist, 0.35) },
    { x: UA + 0.3 * FA, ...mix(E.upper_arm, E.wrist, 0.45) },
    { x: wristS, ...E.wrist },
    { x: wristS + 0.45 * HAND, a: E.wrist.a * 1.5, b: E.wrist.b * 0.62 },
    { x: wristS + 0.85 * HAND, a: E.wrist.a * 1.15, b: E.wrist.b * 0.45 },
  ];
  const armProfile = profile(armKnots);
  const armStations = stations(0, wristS + 0.85 * HAND, options.armStepCm ?? 1.8, [upperArmS, wristS]);
  const armFrame = (side: Side): ArmFrame => {
    const axis: Vec3 = normalize([side * Math.sin(theta), -Math.cos(theta), 0]);
    return {
      side,
      joint: [side * (E.shoulder.a - 0.3 * E.upper_arm.a), y(0.795), 0],
      axis,
      u: [Math.cos(theta), side * Math.sin(theta), 0],
      v: [0, 0, 1],
      upperArmCm: UA,
      forearmCm: FA,
      handCm: HAND,
    };
  };
  const arms = { left: armFrame(1), right: armFrame(-1) };
  const armPart = (side: Side): PartSpec => {
    const f = side === 1 ? arms.left : arms.right;
    return {
      id: side === 1 ? 'arm_l' : 'arm_r',
      segments: armSegments,
      sections: armStations.map((s) => {
        const p = armProfile(s);
        const k = polygonCompensation(p.a, p.b, armSegments);
        return { centre: along(f.joint, f.axis, s), u: f.u, v: f.v, a: p.a * k, b: p.b * k };
      }),
      startPole: along(f.joint, f.axis, -0.9 * E.upper_arm.a),
      endPole: along(f.joint, f.axis, wristS + HAND),
    };
  };

  const torso: PartSpec = { id: 'torso', segments: torsoSegments, sections: torsoSections, startPole: [0, y(0.452), 0], endPole: [0, S, 0] };
  const parts = [torso, legPart(1), legPart(-1), armPart(1), armPart(-1)];

  // --- Rings ------------------------------------------------------------------------------------
  const rings: RingFrame[] = [];
  const morphHeights = {} as Record<AnchorRing, number>;
  for (const id of torsoRings) {
    rings.push({ id, side: 'centre', part: 'torso', centre: [0, y(H[id]), 0], normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], ...E[id], circumferenceCm: shape.rings[id].circumferenceCm, morphHeight: y(H[id]) });
    morphHeights[id] = y(H[id]);
  }
  for (const id of legRings) {
    const cz = legProfile(y(H[id])).cz;
    rings.push({ id, side: 'left', part: 'leg_l', centre: [legX, y(H[id]), cz], normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], ...E[id], circumferenceCm: shape.rings[id].circumferenceCm, morphHeight: y(H[id]) });
    morphHeights[id] = y(H[id]);
  }
  for (const [id, s] of [['upper_arm', upperArmS], ['wrist', wristS]] as const) {
    const f = arms.left;
    rings.push({ id, side: 'left', part: 'arm_l', centre: along(f.joint, f.axis, s), normal: f.axis, u: f.u, v: f.v, ...E[id], circumferenceCm: shape.rings[id].circumferenceCm, morphHeight: s });
    morphHeights[id] = s;
  }
  const order: readonly AnchorRing[] = ['neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'upper_arm', 'wrist'];
  rings.sort((p, q) => order.indexOf(p.id) - order.indexOf(q.id));

  // --- Landmarks and length lines -----------------------------------------------------------------
  const waistY = y(H.waist);
  const crotchY = y(0.455);
  const landmarks: Landmarks = {
    hps: [E.neck.a + 1, y(0.825), 0],
    waistFront: [0, waistY, E.waist.b],
    crotch: [0, crotchY, 0],
    legX,
  };
  const down: Vec3 = [0, -1, 0];
  const { hps, waistFront, crotch } = landmarks;
  const lengths: LengthLine[] = [
    { id: 'shoulder_to_waist', measure: 'drop', start: hps, direction: down, bodyEnd: [hps[0], waistY, hps[2]], bodyLengthCm: hps[1] - waistY },
    { id: 'shoulder_to_hem', measure: 'drop', start: hps, direction: down, bodyEnd: [hps[0], 0, hps[2]], bodyLengthCm: hps[1] },
    { id: 'waist_to_hem', measure: 'drop', start: waistFront, direction: down, bodyEnd: [waistFront[0], 0, waistFront[2]], bodyLengthCm: waistY },
    { id: 'sleeve', measure: 'axis', start: arms.left.joint, direction: arms.left.axis, bodyEnd: along(arms.left.joint, arms.left.axis, wristS), bodyLengthCm: wristS },
    { id: 'inseam', measure: 'drop', start: crotch, direction: down, bodyEnd: [0, 0, 0], bodyLengthCm: crotchY },
    { id: 'rise', measure: 'rise', start: crotch, direction: [0, 1, 0], bodyEnd: [0, waistY, 0], bodyLengthCm: waistY - crotchY },
  ];

  // --- Rig --------------------------------------------------------------------------------------
  const joints: Joint[] = [
    { id: 'root', parent: null, pivot: [0, y(H.hip), 0] },
    { id: 'spine', parent: 'root', pivot: [0, waistY, 0] },
    { id: 'shoulder_l', parent: 'spine', pivot: arms.left.joint },
    { id: 'elbow_l', parent: 'shoulder_l', pivot: along(arms.left.joint, arms.left.axis, UA) },
    { id: 'shoulder_r', parent: 'spine', pivot: arms.right.joint },
    { id: 'elbow_r', parent: 'shoulder_r', pivot: along(arms.right.joint, arms.right.axis, UA) },
    { id: 'hip_l', parent: 'root', pivot: [legX, y(0.49), 0] },
    { id: 'knee_l', parent: 'hip_l', pivot: [legX, y(H.knee), 0] },
    { id: 'hip_r', parent: 'root', pivot: [-legX, y(0.49), 0] },
    { id: 'knee_r', parent: 'hip_r', pivot: [-legX, y(H.knee), 0] },
  ];

  return {
    version: MANNEQUIN_VERSION,
    shape,
    statureCm: S,
    parts,
    rings,
    lengths,
    joints,
    landmarks,
    arms,
    morphHeights,
    torsoAt(yy) {
      if (!(yy >= torsoLo && yy <= torsoHi)) return null;
      const p = torsoProfile(yy);
      return { a: p.a, b: p.b, cx: 0, cz: p.cz };
    },
    legAt(yy, side) {
      if (!(yy >= legLo && yy <= legHi)) return null;
      const p = legProfile(yy);
      return { a: p.a, b: p.b, cx: side * legX, cz: p.cz };
    },
    armAt(s, side) {
      if (!(s >= 0 && s <= wristS + 0.85 * HAND)) return null;
      const f = side === 1 ? arms.left : arms.right;
      const p = armProfile(s);
      return { a: p.a, b: p.b, centre: along(f.joint, f.axis, s) };
    },
  };
}
