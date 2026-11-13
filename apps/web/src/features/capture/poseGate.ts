/**
 * Pose gating and view selection — pure functions over MediaPipe landmark arrays so the logic can be
 * unit-tested in node with synthetic landmarks (the worker only feeds them frames).
 *
 * Protocol (docs/research/body-scan.md §Capture protocol): 8 s video, user 2–3 m away, phone upright,
 * neutral A-pose. Every frame is gated on: full body visible (nose, shoulders, hips, ankles, heels with
 * visibility > 0.8, inside the frame), tilt < 5°, arms away from the torso (elbow–hip gap), stable
 * height span. The 0° (front) and 90° (side) frames are chosen from the shoulder-width/torso-height
 * ratio and ear/nose visibility.
 */
import { POSE } from './landmarks';
import type { FrameFeatures, GateFeatures, GateReason, GateResult, Landmark, SideSelection, ViewKind } from './types';

export const GATE_THRESHOLDS = {
  visibility: 0.8,
  edgeMargin: 0.02,
  maxTiltDeg: 5,
  maxRollDeg: 8,
  /** elbow–hip horizontal gap must be ≥ this × shoulder width (front view only). */
  minArmGapRatio: 0.3,
  /** nose→heel span must cover at least this fraction of the frame height. */
  minHeightSpan: 0.45,
  /** relative height-span deviation over the stability window. */
  stabilityTolerance: 0.02,
  stabilityWindow: 8,
  /** frontalRatio above → frontal-ish, below `side` → side-on. */
  frontal: 0.45,
  side: 0.28,
} as const;

const REQUIRED_FULL_BODY = [
  POSE.NOSE,
  POSE.LEFT_SHOULDER,
  POSE.RIGHT_SHOULDER,
  POSE.LEFT_HIP,
  POSE.RIGHT_HIP,
  POSE.LEFT_ANKLE,
  POSE.RIGHT_ANKLE,
  POSE.LEFT_HEEL,
  POSE.RIGHT_HEEL,
] as const;

export interface FrameSize {
  width: number;
  height: number;
}

const vis = (l: Landmark | undefined): number => (l ? (l.visibility ?? 1) : 0);
const rad2deg = (r: number): number => (r * 180) / Math.PI;

function mid(a: Landmark, b: Landmark): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Shoulder width / torso height in pixel space. */
export function frontalRatio(lm: readonly Landmark[], size: FrameSize): number {
  const ls = lm[POSE.LEFT_SHOULDER];
  const rs = lm[POSE.RIGHT_SHOULDER];
  const lh = lm[POSE.LEFT_HIP];
  const rh = lm[POSE.RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return 0;
  const sw = Math.abs(ls.x - rs.x) * size.width;
  const torso = Math.abs(mid(lh, rh).y - mid(ls, rs).y) * size.height;
  return torso > 0 ? sw / torso : 0;
}

/**
 * Classify the view from the shoulder/torso ratio and ear/nose visibility.
 * - front: frontal ratio high, nose + both ears visible
 * - back: frontal ratio high, nose not visible
 * - left/right: ratio low; the visible ear names the side facing the camera
 */
export function classifyView(lm: readonly Landmark[], size: FrameSize): ViewKind {
  if (lm.length < 33) return 'none';
  const r = frontalRatio(lm, size);
  const nose = vis(lm[POSE.NOSE]);
  const lEar = vis(lm[POSE.LEFT_EAR]);
  const rEar = vis(lm[POSE.RIGHT_EAR]);
  if (r >= GATE_THRESHOLDS.frontal) {
    if (nose >= 0.5 && lEar >= 0.5 && rEar >= 0.5) return 'front';
    if (nose < 0.5) return 'back';
    return 'oblique';
  }
  if (r <= GATE_THRESHOLDS.side) {
    // Side-on: one ear is occluded. The visible one is on the camera side.
    if (lEar - rEar > 0.2) return 'left';
    if (rEar - lEar > 0.2) return 'right';
    // ears equally (in)visible: fall back on nose x vs. ear midpoint
    const n = lm[POSE.NOSE];
    const em = mid(lm[POSE.LEFT_EAR] as Landmark, lm[POSE.RIGHT_EAR] as Landmark);
    if (n && Math.abs(n.x - em.x) * size.width > 0.02 * size.width) return n.x > em.x ? 'right' : 'left';
    return 'oblique';
  }
  return 'oblique';
}

/** Extract the gate features for one frame (no verdict). */
export function gateFeatures(lm: readonly Landmark[], size: FrameSize): GateFeatures {
  if (lm.length < 33) {
    return { visibilityMin: 0, tiltDeg: 90, rollDeg: 90, armGapRatio: 0, heightSpan: 0, frontalRatio: 0, view: 'none' };
  }
  const ls = lm[POSE.LEFT_SHOULDER] as Landmark;
  const rs = lm[POSE.RIGHT_SHOULDER] as Landmark;
  const lh = lm[POSE.LEFT_HIP] as Landmark;
  const rh = lm[POSE.RIGHT_HIP] as Landmark;
  const le = lm[POSE.LEFT_ELBOW] as Landmark;
  const re = lm[POSE.RIGHT_ELBOW] as Landmark;
  const nose = lm[POSE.NOSE] as Landmark;
  const heelY = Math.max(
    (lm[POSE.LEFT_HEEL] as Landmark).y,
    (lm[POSE.RIGHT_HEEL] as Landmark).y,
    (lm[POSE.LEFT_ANKLE] as Landmark).y,
    (lm[POSE.RIGHT_ANKLE] as Landmark).y,
  );

  const sm = mid(ls, rs);
  const hm = mid(lh, rh);
  const dx = (hm.x - sm.x) * size.width;
  const dy = (hm.y - sm.y) * size.height;
  const tiltDeg = Math.abs(rad2deg(Math.atan2(dx, dy)));
  const rollDeg = Math.abs(rad2deg(Math.atan2((rs.y - ls.y) * size.height, (rs.x - ls.x) * size.width)));
  const rollNorm = rollDeg > 90 ? 180 - rollDeg : rollDeg;

  const shoulderW = Math.abs(ls.x - rs.x) * size.width;
  const gapL = Math.abs(le.x - lh.x) * size.width;
  const gapR = Math.abs(re.x - rh.x) * size.width;
  const armGapRatio = shoulderW > 0 ? Math.min(gapL, gapR) / shoulderW : 0;

  let visibilityMin = 1;
  for (const i of REQUIRED_FULL_BODY) visibilityMin = Math.min(visibilityMin, vis(lm[i]));

  return {
    visibilityMin,
    tiltDeg,
    rollDeg: rollNorm,
    armGapRatio,
    heightSpan: heelY - nose.y,
    frontalRatio: frontalRatio(lm, size),
    view: classifyView(lm, size),
  };
}

/** Relative deviation of the height span over the stability window. */
export function heightSpanStable(spans: readonly number[], tolerance = GATE_THRESHOLDS.stabilityTolerance): boolean {
  const w = spans.slice(-GATE_THRESHOLDS.stabilityWindow);
  if (w.length < 3) return false;
  const mean = w.reduce((s, v) => s + v, 0) / w.length;
  if (mean <= 0) return false;
  const maxDev = Math.max(...w.map((v) => Math.abs(v - mean)));
  return maxDev / mean <= tolerance;
}

/**
 * Gate one frame. `spanHistory` holds the heightSpan of previous frames (including or excluding
 * this one). The arm test only applies to frontal/back views: side-on the elbow–hip gap collapses.
 */
export function gateFrame(lm: readonly Landmark[], size: FrameSize, spanHistory: readonly number[] = []): GateResult {
  const f = gateFeatures(lm, size);
  const reasons: GateReason[] = [];
  if (lm.length < 33) {
    reasons.push('no_person');
    return { ok: false, reasons, features: f };
  }
  const T = GATE_THRESHOLDS;
  let edge = false;
  for (const i of REQUIRED_FULL_BODY) {
    const l = lm[i] as Landmark;
    if (l.x < T.edgeMargin || l.x > 1 - T.edgeMargin || l.y < T.edgeMargin || l.y > 1 - T.edgeMargin) edge = true;
  }
  if (f.visibilityMin < T.visibility) reasons.push(f.visibilityMin < 0.3 ? 'not_full_body' : 'low_visibility');
  if (edge) reasons.push('too_close_to_edge');
  if (f.heightSpan < T.minHeightSpan) reasons.push('too_small');
  if (f.tiltDeg > T.maxTiltDeg) reasons.push('tilted');
  if ((f.view === 'front' || f.view === 'back' || f.view === 'oblique') && f.frontalRatio >= T.frontal) {
    if (f.rollDeg > T.maxRollDeg) reasons.push('tilted');
    if (f.armGapRatio < T.minArmGapRatio) reasons.push('arms_not_in_a_pose');
  }
  const spans = [...spanHistory, f.heightSpan];
  if (!heightSpanStable(spans)) reasons.push('unstable');
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], features: f };
}

/** Score how "front" a gated frame is: higher ratio + all head landmarks visible. */
export function frontScore(f: GateFeatures): number {
  if (f.view !== 'front') return 0;
  return f.frontalRatio * (1 - Math.min(1, f.tiltDeg / 10)) * (1 - Math.min(1, f.rollDeg / 15));
}

/** Score how "side" a frame is: low ratio wins; must be upright and stable. */
export function sideScore(f: GateFeatures, reasons: readonly GateReason[]): number {
  if (f.view !== 'left' && f.view !== 'right') return 0;
  // Side frames are allowed to fail the A-pose test, and the far-side landmarks are naturally
  // occluded (visibility drops below 0.8), so 'low_visibility' is tolerated down to 0.5.
  const blocking = reasons.filter((r) => r !== 'arms_not_in_a_pose' && !(r === 'low_visibility' && f.visibilityMin >= 0.5));
  if (blocking.length > 0) return 0;
  return (1 - f.frontalRatio / GATE_THRESHOLDS.side) * (1 - Math.min(1, f.tiltDeg / 10));
}

/**
 * Pick the best front and side frames from the per-frame features of the recording.
 * Returns null when no usable front frame exists; `sideIndex` is -1 when no side frame exists
 * (the measurer then falls back to population depth ratios with inflated sigma).
 */
export function selectFrames(frames: readonly FrameFeatures[]): SideSelection | null {
  let best: SideSelection = { frontIndex: -1, sideIndex: -1, frontScore: 0, sideScore: 0 };
  for (const fr of frames) {
    if (fr.gate.ok) {
      const fs = frontScore(fr.gate.features);
      if (fs > best.frontScore) best = { ...best, frontIndex: fr.index, frontScore: fs };
    }
    const ss = sideScore(fr.gate.features, fr.gate.reasons);
    if (ss > best.sideScore) best = { ...best, sideIndex: fr.index, sideScore: ss };
  }
  return best.frontIndex < 0 ? null : best;
}

/** Human-readable hint for the on-screen guidance (aria-live). Order = priority. */
export function gateHint(reasons: readonly GateReason[]): string {
  if (reasons.includes('no_person')) return 'Step into the frame';
  if (reasons.includes('not_full_body') || reasons.includes('too_small')) return 'Step back so your whole body is visible, head to heels';
  if (reasons.includes('too_close_to_edge')) return 'Move towards the centre of the frame';
  if (reasons.includes('low_visibility')) return 'Make sure your feet and head are clearly visible';
  if (reasons.includes('tilted')) return 'Stand straight and keep the phone upright';
  if (reasons.includes('arms_not_in_a_pose')) return 'Hold your arms slightly away from your body';
  if (reasons.includes('unstable')) return 'Hold still…';
  return 'Perfect, hold that pose';
}
