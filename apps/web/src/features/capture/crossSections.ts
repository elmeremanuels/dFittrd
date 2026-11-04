/**
 * Placement of the 12 cross-section levels from pose landmarks (handoff §2.1B, body-scan.md
 * §Capture protocol): torso levels are fractions of the shoulder-line → hip-line distance (chest at
 * 37.5 % and waist at 62.5 % of shoulder-to-high-hip, after Zong 2023 / Scott); knee, ankle, elbow
 * and wrist come directly from landmarks; thigh/calf/upper-arm are fractions along the limb.
 *
 * All coordinates are normalised (0..1). The MediaPipe hip landmarks sit at the hip joints, which we
 * treat as the "high hip" reference; the fullest-hip level is placed slightly below it. These
 * proportions are approximate and documented as such; the pilot calibration may move them.
 */
import { POSE } from './landmarks';
import type { Landmark, Level, LevelPlacement } from './types';

export const LEVELS: readonly Level[] = [
  'neck',
  'shoulder',
  'bust',
  'underbust',
  'waist',
  'hip',
  'thigh',
  'knee',
  'calf',
  'ankle',
  'upperArm',
  'wrist',
] as const;

/** Fractions along the shoulder-mid → hip-mid axis for the torso levels. */
export const TORSO_FRACTIONS = {
  neck: -0.3, // fraction of the (shoulder − nose) distance, above the shoulder line
  shoulder: 0.06,
  bust: 0.375,
  underbust: 0.5,
  waist: 0.625,
  hip: 1.1,
} as const;

/** Fractions along the limb segments. */
export const LIMB_FRACTIONS = {
  thigh: 0.25, // hip → knee
  calf: 0.3, // knee → ankle
  ankle: -0.08, // above the ankle landmark, fraction of knee → ankle
  upperArm: 0.4, // shoulder → elbow
  wrist: -0.1, // above the wrist, fraction of elbow → wrist
} as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function pt(lm: readonly Landmark[], i: number): Landmark {
  const l = lm[i];
  if (!l) throw new RangeError(`landmark ${i} missing`);
  return l;
}

function axisDeg(a: Landmark, b: Landmark, aspect: number): number {
  // angle of the a→b segment vs. vertical; aspect = width/height corrects normalised coords
  return Math.abs((Math.atan2((b.x - a.x) * aspect, b.y - a.y) * 180) / Math.PI);
}

/**
 * Place all 12 levels. `aspect` = frame width / frame height (for limb angles). Limb levels use
 * the side nearer the camera for side views; for the front view the left limbs (image right) are
 * used and the measurement is symmetric by assumption.
 */
export function placeLevels(lm: readonly Landmark[], aspect = 9 / 16, preferSide: 'left' | 'right' = 'left'): LevelPlacement[] {
  if (lm.length < 33) throw new RangeError('need 33 pose landmarks');
  const ls = pt(lm, POSE.LEFT_SHOULDER);
  const rs = pt(lm, POSE.RIGHT_SHOULDER);
  const lh = pt(lm, POSE.LEFT_HIP);
  const rh = pt(lm, POSE.RIGHT_HIP);
  const nose = pt(lm, POSE.NOSE);
  const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const torso = hm.y - sm.y;
  const shoulderToNose = sm.y - nose.y;

  const L = preferSide === 'left';
  const hip = L ? lh : rh;
  const knee = L ? pt(lm, POSE.LEFT_KNEE) : pt(lm, POSE.RIGHT_KNEE);
  const ankle = L ? pt(lm, POSE.LEFT_ANKLE) : pt(lm, POSE.RIGHT_ANKLE);
  const shoulder = L ? ls : rs;
  const elbow = L ? pt(lm, POSE.LEFT_ELBOW) : pt(lm, POSE.RIGHT_ELBOW);
  const wrist = L ? pt(lm, POSE.LEFT_WRIST) : pt(lm, POSE.RIGHT_WRIST);

  const torsoLevel = (level: Level, f: number): LevelPlacement => ({
    level,
    y: sm.y + f * torso,
    x: lerp(sm.x, hm.x, Math.max(0, Math.min(1, f))),
    axisDeg: 0,
  });

  const out: LevelPlacement[] = [
    { level: 'neck', y: sm.y + TORSO_FRACTIONS.neck * shoulderToNose, x: lerp(sm.x, nose.x, 0.3), axisDeg: 0 },
    torsoLevel('shoulder', TORSO_FRACTIONS.shoulder),
    torsoLevel('bust', TORSO_FRACTIONS.bust),
    torsoLevel('underbust', TORSO_FRACTIONS.underbust),
    torsoLevel('waist', TORSO_FRACTIONS.waist),
    torsoLevel('hip', TORSO_FRACTIONS.hip),
    {
      level: 'thigh',
      y: lerp(hip.y, knee.y, LIMB_FRACTIONS.thigh),
      x: lerp(hip.x, knee.x, LIMB_FRACTIONS.thigh),
      axisDeg: axisDeg(hip, knee, aspect),
    },
    { level: 'knee', y: knee.y, x: knee.x, axisDeg: axisDeg(hip, ankle, aspect) },
    {
      level: 'calf',
      y: lerp(knee.y, ankle.y, LIMB_FRACTIONS.calf),
      x: lerp(knee.x, ankle.x, LIMB_FRACTIONS.calf),
      axisDeg: axisDeg(knee, ankle, aspect),
    },
    {
      level: 'ankle',
      y: lerp(knee.y, ankle.y, 1 + LIMB_FRACTIONS.ankle),
      x: lerp(knee.x, ankle.x, 1 + LIMB_FRACTIONS.ankle),
      axisDeg: axisDeg(knee, ankle, aspect),
    },
    {
      level: 'upperArm',
      y: lerp(shoulder.y, elbow.y, LIMB_FRACTIONS.upperArm),
      x: lerp(shoulder.x, elbow.x, LIMB_FRACTIONS.upperArm),
      axisDeg: axisDeg(shoulder, elbow, aspect),
    },
    {
      level: 'wrist',
      y: lerp(elbow.y, wrist.y, 1 + LIMB_FRACTIONS.wrist),
      x: lerp(elbow.x, wrist.x, 1 + LIMB_FRACTIONS.wrist),
      axisDeg: axisDeg(elbow, wrist, aspect),
    },
  ];
  return out;
}

/** Key landmark-derived lengths in normalised units (multiply by the per-axis scale later). */
export function landmarkSpans(lm: readonly Landmark[]): {
  shoulderMidY: number;
  hipMidY: number;
  kneeY: number;
  ankleY: number;
  heelY: number;
  noseY: number;
  biacromialX: number;
  armLen: { dx: number; dy: number };
  shoulderSlope: { dx: number; dy: number };
} {
  const ls = pt(lm, POSE.LEFT_SHOULDER);
  const rs = pt(lm, POSE.RIGHT_SHOULDER);
  const lh = pt(lm, POSE.LEFT_HIP);
  const rh = pt(lm, POSE.RIGHT_HIP);
  const lk = pt(lm, POSE.LEFT_KNEE);
  const rk = pt(lm, POSE.RIGHT_KNEE);
  const la = pt(lm, POSE.LEFT_ANKLE);
  const ra = pt(lm, POSE.RIGHT_ANKLE);
  const lhe = pt(lm, POSE.LEFT_HEEL);
  const rhe = pt(lm, POSE.RIGHT_HEEL);
  const le = pt(lm, POSE.LEFT_ELBOW);
  const lw = pt(lm, POSE.LEFT_WRIST);
  const lear = pt(lm, POSE.LEFT_EAR);
  return {
    shoulderMidY: (ls.y + rs.y) / 2,
    hipMidY: (lh.y + rh.y) / 2,
    kneeY: (lk.y + rk.y) / 2,
    ankleY: (la.y + ra.y) / 2,
    heelY: Math.max(lhe.y, rhe.y),
    noseY: pt(lm, POSE.NOSE).y,
    biacromialX: Math.abs(ls.x - rs.x),
    armLen: { dx: Math.abs(lw.x - ls.x) + Math.abs(le.x - ls.x) * 0, dy: lw.y - ls.y },
    shoulderSlope: { dx: Math.abs(ls.x - lear.x), dy: ls.y - lear.y },
  };
}
