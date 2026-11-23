/**
 * On-device face shape fitting from MediaPipe's 478 Face Landmarker points onto the realistic body's CC0 MakeHuman
 * head (WO-020 / CUR-34, D19, D27).
 *
 * Pure: no WebGL, no DOM, no network, no storage. Takes the 478 landmarks in memory and the realistic body asset,
 * normalises for head roll, mild yaw and scale, rejects smiles / open mouths / strongly turned or tilted heads, and
 * solves a regularised Gauss-Newton least-squares fit of dimensionless facial proportions against the asset's 12
 * signed CC0 face targets, clamping every weight to [-1, 1] so the head can never go grotesque.
 *
 * Nothing here stores or transmits landmarks, photos or weights.
 */
import {
  FACE_LANDMARK_NAMES,
  FACE_SHAPE_TARGETS,
  FACE_WEIGHT_LIMIT,
  clampFaceShape,
  type FaceLandmarkName,
  type FaceShapeTarget,
  type FaceShapeWeights,
  type RealisticBodyAsset,
} from './realisticBody';

export interface FaceLandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

/** Canonical MediaPipe Face Landmarker (478-point) indices matching `FACE_LANDMARK_NAMES` plus smile/mouth checks. */
export const MP_FACE = {
  foreheadTop: 10,
  glabella: 9,
  nasion: 168,
  noseTip: 1,
  subnasale: 2,
  upperLip: 0,
  upperLipInner: 13,
  lowerLipInner: 14,
  lowerLip: 17,
  chinFront: 199,
  chinMenton: 152,
  // MediaPipe image X increases left→right (viewer's right = subject's left when unmirrored; mirrored handled via sign).
  lCheek: 454,
  rCheek: 234,
  lJaw: 397,
  rJaw: 172,
  lChinSide: 377,
  rChinSide: 148,
  lEyeInner: 362,
  rEyeInner: 133,
  lEyeOuter: 263,
  rEyeOuter: 33,
  lBrow: 334,
  rBrow: 105,
  lNoseAlar: 358,
  rNoseAlar: 129,
  lMouthCorner: 291,
  rMouthCorner: 61,
} as const;

export const MIN_FACE_LANDMARKS = 468;

export interface FacePoseEstimate {
  rollDeg: number;
  yawDeg: number;
  pitchDeg: number;
}

export interface FaceExpressionEstimate {
  /** Positive when mouth corners pull up above the inner lip line (normalised by mouth width). */
  smileScore: number;
  /** Vertical gap between inner upper and lower lips (normalised by face height). */
  mouthOpen: number;
}

export type FaceShapeRejectReason = 'invalid_landmarks' | 'no_targets' | 'smile' | 'turned' | 'tilted';

export interface FaceShapeFitOptions {
  /** Image width / height aspect ratio when landmarks are in [0, 1] normalised image coordinates (default 1). */
  aspectRatio?: number;
  /** Maximum allowed head yaw in degrees (default 22). */
  maxYawDeg?: number;
  /** Maximum allowed head pitch in degrees (default 22). */
  maxPitchDeg?: number;
  /** Smile corner-lift threshold (default 0.055). */
  smileThreshold?: number;
  /** Open-mouth threshold relative to face height (default 0.055). */
  mouthOpenThreshold?: number;
  /** Ridge regularisation lambda for the 12x12 least-squares solve (default 1e-4). */
  regularisation?: number;
}

export type FaceShapeFitResult =
  | {
      ok: true;
      weights: Record<FaceShapeTarget, number>;
      /** 0..1 similarity between target feature vector and fitted head feature vector (1 = exact). */
      similarity: number;
      /** RMS residual in normalised feature space after fitting. */
      residual: number;
      pose: FacePoseEstimate;
      expression: FaceExpressionEstimate;
    }
  | {
      ok: false;
      reason: FaceShapeRejectReason;
      weights: null;
      pose: FacePoseEstimate;
      expression: FaceExpressionEstimate;
    };

type V3 = [number, number, number];
type AnchorMap = Record<FaceLandmarkName, V3>;

const ZERO_POSE: FacePoseEstimate = { rollDeg: 0, yawDeg: 0, pitchDeg: 0 };
const ZERO_EXPR: FaceExpressionEstimate = { smileScore: 0, mouthOpen: 0 };

/** Extract the 26 anatomical anchor coordinates from a 3D mesh buffer using `meta.faceLandmarks`. */
function meshAnchors(positions: ArrayLike<number>, map: Record<FaceLandmarkName, number>): AnchorMap {
  const out = {} as AnchorMap;
  for (const name of FACE_LANDMARK_NAMES) {
    const id = map[name];
    out[name] = [positions[3 * id]!, positions[3 * id + 1]!, positions[3 * id + 2]!];
  }
  return out;
}

/**
 * Dimensionless, pose- and scale-invariant facial shape descriptor (18 features) covering all 12 MakeHuman face axes:
 * overall face width/height, jaw width, chin width/height/prominence, cheekbone prominence, nose length/width,
 * inter-ocular spacing, brow height, and mouth/lip width.
 */
export function faceFeatureVector(a: AnchorMap): number[] {
  const eyeMidY = 0.25 * (a.lEyeInner[1] + a.rEyeInner[1] + a.lEyeOuter[1] + a.rEyeOuter[1]);
  const eyeMidZ = 0.25 * (a.lEyeInner[2] + a.rEyeInner[2] + a.lEyeOuter[2] + a.rEyeOuter[2]);
  const faceH = Math.max(1e-4, a.foreheadTop[1] - a.chinMenton[1]);
  const cheekW = Math.abs(a.lCheek[0] - a.rCheek[0]);
  const jawW = Math.abs(a.lJaw[0] - a.rJaw[0]);
  const chinW = Math.abs(a.lChinSide[0] - a.rChinSide[0]);
  const eyeInnerW = Math.abs(a.lEyeInner[0] - a.rEyeInner[0]);
  const eyeOuterW = Math.abs(a.lEyeOuter[0] - a.rEyeOuter[0]);
  const eyeCenterW = 0.5 * (eyeInnerW + eyeOuterW);
  const eyeAperture = Math.max(1e-4, 0.5 * (eyeOuterW - eyeInnerW));
  const noseW = Math.abs(a.lNoseAlar[0] - a.rNoseAlar[0]);
  const mouthW = Math.abs(a.lMouthCorner[0] - a.rMouthCorner[0]);
  const noseL = a.nasion[1] - a.subnasale[1];
  const noseTipDrop = a.nasion[1] - a.noseTip[1];
  const upperFaceH = a.foreheadTop[1] - eyeMidY;
  const midFaceH = eyeMidY - a.subnasale[1];
  const lowerFaceH = a.subnasale[1] - a.chinMenton[1];
  const chinH = a.lowerLip[1] - a.chinMenton[1];
  const browW = Math.abs(a.lBrow[0] - a.rBrow[0]);
  const browH = 0.5 * (a.lBrow[1] + a.rBrow[1]) - eyeMidY;
  const chinZ = 0.5 * (a.chinFront[2] + a.chinMenton[2]) - eyeMidZ;
  const cheekZ = 0.5 * (a.lCheek[2] + a.rCheek[2]) - eyeMidZ;
  const noseZ = a.noseTip[2] - eyeMidZ;

  // Stable RMS reference scale mixing horizontal and vertical span (not dominated by any single target).
  const S = Math.max(1e-4, Math.hypot(cheekW, faceH));
  return [
    cheekW / S,              // 0: faceWidth + cheekbones
    faceH / S,               // 1: faceHeight
    jawW / S,                // 2: jawWidth + faceWidth
    chinW / S,               // 3: chinWidth
    chinH / S,               // 4: chinHeight
    lowerFaceH / S,          // 5: chinHeight + faceHeight
    upperFaceH / S,          // 6: faceHeight
    midFaceH / S,            // 7: noseLength + faceHeight
    noseL / S,               // 8: noseLength
    noseTipDrop / S,         // 9: noseLength
    noseW / S,               // 10: noseWidth
    eyeInnerW / S,           // 11: eyeSpacing
    eyeCenterW / S,          // 12: eyeSpacing + faceWidth
    eyeAperture / S,         // 13: faceWidth (eye aperture scales with head width, not eyeSpacing)
    browW / S,               // 14: brow/upper-face width (disambiguates faceWidth from cheekbones/jaw)
    browH / S,               // 15: browHeight
    mouthW / S,              // 16: lipWidth
    chinZ / S,               // 17: chinProminence
    (cheekZ + 0.25 * noseZ) / S, // 18: cheekbone/profile depth cue
  ];
}

/** Convert MediaPipe 478 normalized landmarks into a pose-normalised AnchorMap (+X subject's left, +Y up, +Z toward camera). */
function normaliseLandmarks(
  landmarks: readonly FaceLandmarkPoint[],
  aspectRatio: number,
): { anchors: AnchorMap; pose: FacePoseEstimate; expression: FaceExpressionEstimate } | null {
  if (landmarks.length < MIN_FACE_LANDMARKS) return null;
  const pt = (idx: number): V3 | null => {
    const p = landmarks[idx];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const z = typeof p.z === 'number' && Number.isFinite(p.z) ? p.z : 0;
    return [p.x * aspectRatio, -p.y, -z * aspectRatio];
  };
  const lEO = pt(MP_FACE.lEyeOuter), rEO = pt(MP_FACE.rEyeOuter);
  const lEI = pt(MP_FACE.lEyeInner), rEI = pt(MP_FACE.rEyeInner);
  if (!lEO || !rEO || !lEI || !rEI) return null;

  // Ensure +X always points from subject's right eye to subject's left eye (handles mirrored front-camera selfies).
  const dxEye = lEO[0] - rEO[0];
  const xFlip = dxEye < 0 ? -1 : 1;
  const read = (idx: number): V3 | null => {
    const p = pt(idx);
    return p ? [p[0] * xFlip, p[1], p[2]] : null;
  };

  const lEyeO = read(MP_FACE.lEyeOuter)!, rEyeO = read(MP_FACE.rEyeOuter)!;
  const rollRad = Math.atan2(lEyeO[1] - rEyeO[1], lEyeO[0] - rEyeO[0]);
  const cosR = Math.cos(-rollRad), sinR = Math.sin(-rollRad);
  const cx = 0.5 * (lEyeO[0] + rEyeO[0]);
  const cy = 0.5 * (lEyeO[1] + rEyeO[1]);
  const cz = 0.5 * (lEyeO[2] + rEyeO[2]);
  const unroll = (p: V3): V3 => {
    const rx = p[0] - cx, ry = p[1] - cy, rz = p[2] - cz;
    return [rx * cosR - ry * sinR, rx * sinR + ry * cosR, rz];
  };

  const raw = {} as AnchorMap;
  for (const name of FACE_LANDMARK_NAMES) {
    if (name === 'mouthCenter') {
      const u = read(MP_FACE.upperLipInner), l = read(MP_FACE.lowerLipInner);
      if (!u || !l) return null;
      raw[name] = unroll([0.5 * (u[0] + l[0]), 0.5 * (u[1] + l[1]), 0.5 * (u[2] + l[2])]);
    } else {
      const p = read(MP_FACE[name]);
      if (!p) return null;
      raw[name] = unroll(p);
    }
  }
  const uIn = read(MP_FACE.upperLipInner), lIn = read(MP_FACE.lowerLipInner);
  if (!uIn || !lIn) return null;
  const uInR = unroll(uIn), lInR = unroll(lIn);

  // Pose estimation (yaw from horizontal asymmetry + cheek depth difference; pitch from forehead/chin Z tilt).
  const cheekSpan = Math.max(1e-4, Math.abs(raw.lCheek[0] - raw.rCheek[0]));
  const faceSpan = Math.max(1e-4, raw.foreheadTop[1] - raw.chinMenton[1]);
  const dLeft = Math.abs(raw.lCheek[0] - raw.nasion[0]);
  const dRight = Math.abs(raw.nasion[0] - raw.rCheek[0]);
  const asym = (dLeft - dRight) / Math.max(1e-4, dLeft + dRight);
  const zYaw = Math.atan2(raw.rCheek[2] - raw.lCheek[2], cheekSpan);
  // Combine 2D asymmetry and 3D cheek depth (when z is zero, 2D asymmetry alone gives a reliable yaw estimate).
  const yawRad = Math.abs(raw.rCheek[2] - raw.lCheek[2]) > 1e-4 ? zYaw : Math.asin(Math.max(-0.95, Math.min(0.95, asym * 1.45)));
  const pitchRad = Math.atan2(raw.foreheadTop[2] - raw.chinMenton[2], faceSpan);

  // Compensate mild yaw foreshortening on horizontal widths (cos(yaw) correction up to ±25°).
  const cosY = Math.max(0.75, Math.cos(yawRad));
  const anchors = {} as AnchorMap;
  for (const name of FACE_LANDMARK_NAMES) {
    const p = raw[name];
    anchors[name] = [p[0] / cosY, p[1], p[2]];
  }

  // Expression check: neutral face required (detect smile commissure upturn and open mouth).
  const mouthW = Math.max(1e-4, Math.abs(anchors.lMouthCorner[0] - anchors.rMouthCorner[0]));
  const cornerAvgY = 0.5 * (anchors.lMouthCorner[1] + anchors.rMouthCorner[1]);
  const innerMidY = 0.5 * (uInR[1] + lInR[1]);
  const smileScore = (cornerAvgY - innerMidY) / mouthW;
  const mouthOpen = Math.abs(uInR[1] - lInR[1]) / faceSpan;

  return {
    anchors,
    pose: {
      rollDeg: (rollRad * 180) / Math.PI,
      yawDeg: (yawRad * 180) / Math.PI,
      pitchDeg: (pitchRad * 180) / Math.PI,
    },
    expression: { smileScore, mouthOpen },
  };
}

/** Solve an m×m symmetric positive-definite linear system A·x = b via Gauss-Jordan with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const m = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (piv !== col) [M[col], M[piv]] = [M[piv]!, M[col]!];
    const diag = M[col]![col]!;
    if (Math.abs(diag) < 1e-12) continue;
    for (let c = col; c <= m; c++) M[col]![c] = M[col]![c]! / diag;
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (!f) continue;
      for (let c = col; c <= m; c++) M[r]![c] = M[r]![c]! - f * M[col]![c]!;
    }
  }
  return M.map((row) => row[m]!);
}

/**
 * Fit the realistic body's 12 CC0 MakeHuman face targets to a shopper's 478 MediaPipe landmarks.
 * Pure, deterministic, on-device only.
 */
export function fitFaceShape(
  landmarks: readonly FaceLandmarkPoint[],
  asset: RealisticBodyAsset,
  options: FaceShapeFitOptions = {},
): FaceShapeFitResult {
  const lmMap = asset.meta.faceLandmarks;
  if (!lmMap || !asset.faceTargets || !asset.meta.faceTargetNames?.length) {
    return { ok: false, reason: 'no_targets', weights: null, pose: ZERO_POSE, expression: ZERO_EXPR };
  }
  const norm = normaliseLandmarks(landmarks, options.aspectRatio ?? 1);
  if (!norm) {
    return { ok: false, reason: 'invalid_landmarks', weights: null, pose: ZERO_POSE, expression: ZERO_EXPR };
  }
  const maxYaw = options.maxYawDeg ?? 22;
  const maxPitch = options.maxPitchDeg ?? 22;
  const smileThr = options.smileThreshold ?? 0.055;
  const openThr = options.mouthOpenThreshold ?? 0.055;

  if (Math.abs(norm.pose.yawDeg) > maxYaw) {
    return { ok: false, reason: 'turned', weights: null, pose: norm.pose, expression: norm.expression };
  }
  if (Math.abs(norm.pose.pitchDeg) > maxPitch) {
    return { ok: false, reason: 'tilted', weights: null, pose: norm.pose, expression: norm.expression };
  }
  if (norm.expression.smileScore > smileThr || norm.expression.mouthOpen > openThr) {
    return { ok: false, reason: 'smile', weights: null, pose: norm.pose, expression: norm.expression };
  }

  // Extract sparse delta rows only for the 26 landmark vertices (super fast: 26 vertices × 12 targets).
  const lmIds = FACE_LANDMARK_NAMES.map((name) => lmMap[name]);
  const idToSlot = new Map<number, number>();
  lmIds.forEach((id, slot) => idToSlot.set(id, slot));

  const basePos = new Float64Array(3 * lmIds.length);
  lmIds.forEach((id, slot) => {
    basePos[3 * slot] = asset.positions[3 * id]!;
    basePos[3 * slot + 1] = asset.positions[3 * id + 1]!;
    basePos[3 * slot + 2] = asset.positions[3 * id + 2]!;
  });

  const targetDeltas = FACE_SHAPE_TARGETS.map((t) => {
    const out = new Float64Array(3 * lmIds.length);
    const entry = asset.faceTargets?.[t];
    if (!entry) return out;
    for (let j = 0; j < entry.ids.length; j++) {
      const slot = idToSlot.get(entry.ids[j]!);
      if (slot === undefined) continue;
      out[3 * slot] = entry.deltas[3 * j]!;
      out[3 * slot + 1] = entry.deltas[3 * j + 1]!;
      out[3 * slot + 2] = entry.deltas[3 * j + 2]!;
    }
    return out;
  });

  const anchorsAt = (w: readonly number[]): AnchorMap => {
    const out = {} as AnchorMap;
    for (let slot = 0; slot < FACE_LANDMARK_NAMES.length; slot++) {
      let x = basePos[3 * slot]!, y = basePos[3 * slot + 1]!, z = basePos[3 * slot + 2]!;
      for (let k = 0; k < FACE_SHAPE_TARGETS.length; k++) {
        const wk = w[k]!;
        if (!wk) continue;
        const d = targetDeltas[k]!;
        x += wk * d[3 * slot]!;
        y += wk * d[3 * slot + 1]!;
        z += wk * d[3 * slot + 2]!;
      }
      out[FACE_LANDMARK_NAMES[slot]!] = [x, y, z];
    }
    return out;
  };

  // Target feature vector from the shopper's normalised landmarks; neutral base head baseline.
  const fTarget = faceFeatureVector(norm.anchors);
  const fBase = faceFeatureVector(anchorsAt(new Array(FACE_SHAPE_TARGETS.length).fill(0)));
  const m = FACE_SHAPE_TARGETS.length;
  const fDim = fTarget.length;
  const lambda = options.regularisation ?? 5e-6;
  // Slightly lighter weight on depth features (indices 17..18) since monocular Z is noisier than frontal XY,
  // while still keeping chinProminence and cheekbone depth responsive.
  const fWeight = fTarget.map((_, i) => (i >= 17 ? 0.85 : 1.0));

  // 3 Gauss-Newton iterations with finite-difference Jacobian and clamping to [-FACE_WEIGHT_LIMIT, FACE_WEIGHT_LIMIT].
  const w = new Array<number>(m).fill(0);
  const eps = 1e-3;
  for (let iter = 0; iter < 3; iter++) {
    const fCur = faceFeatureVector(anchorsAt(w));
    const r = fTarget.map((v, i) => v - fCur[i]!);
    const J: number[][] = Array.from({ length: fDim }, () => new Array<number>(m).fill(0));
    for (let k = 0; k < m; k++) {
      const wp = [...w];
      wp[k] = wp[k]! + eps;
      const fp = faceFeatureVector(anchorsAt(wp));
      for (let i = 0; i < fDim; i++) J[i]![k] = (fp[i]! - fCur[i]!) / eps;
    }
    const JTJ: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
    const JTr = new Array<number>(m).fill(0);
    for (let a = 0; a < m; a++) {
      JTJ[a]![a] = lambda;
      for (let i = 0; i < fDim; i++) {
        const wa = fWeight[i]! * J[i]![a]!;
        JTr[a] = JTr[a]! + wa * r[i]!;
        for (let b = 0; b < m; b++) JTJ[a]![b] = JTJ[a]![b]! + wa * J[i]![b]!;
      }
    }
    const dw = solveLinear(JTJ, JTr);
    for (let k = 0; k < m; k++) {
      w[k] = Math.max(-FACE_WEIGHT_LIMIT, Math.min(FACE_WEIGHT_LIMIT, w[k]! + dw[k]!));
    }
  }

  const fFinal = faceFeatureVector(anchorsAt(w));
  let errSq = 0, baseSq = 0;
  for (let i = 0; i < fDim; i++) {
    const e = fTarget[i]! - fFinal[i]!;
    const b = fTarget[i]! - fBase[i]!;
    errSq += e * e;
    baseSq += b * b;
  }
  const residual = Math.sqrt(errSq / fDim);
  const similarity = Math.max(0, Math.min(1, 1 - Math.sqrt(errSq) / Math.max(0.05, Math.sqrt(baseSq) + 0.05)));

  const weights = {} as Record<FaceShapeTarget, number>;
  FACE_SHAPE_TARGETS.forEach((t, k) => {
    weights[t] = Math.round(w[k]! * 1000) / 1000;
  });

  return {
    ok: true,
    weights: clampFaceShape(weights),
    similarity: Math.round(similarity * 1000) / 1000,
    residual: Math.round(residual * 10000) / 10000,
    pose: norm.pose,
    expression: norm.expression,
  };
}

export interface SyntheticLandmarkOptions {
  rollDeg?: number;
  yawDeg?: number;
  pitchDeg?: number;
  /** Uniform 2D scale factor in normalised image coordinates (default 0.022 ≈ face fills ~55% of frame). */
  scale?: number;
  /** Simulated smile lift (0 = neutral, 0.12 = clear smile). */
  smile?: number;
  /** Simulated open mouth gap (0 = closed, 0.09 = wide open). */
  mouthOpen?: number;
}

/**
 * Generate a synthetic 478-point MediaPipe-indexed landmark array from the CC0 MakeHuman head with known face-shape
 * weights (for round-trip tests and privacy-clean synthetic comparison sheets — zero real photos, D19).
 */
export function syntheticFaceLandmarks(
  asset: RealisticBodyAsset,
  weights: FaceShapeWeights,
  opts: SyntheticLandmarkOptions = {},
): FaceLandmarkPoint[] {
  const lmMap = asset.meta.faceLandmarks;
  if (!lmMap) throw new Error('realistic body asset has no faceLandmarks');
  // Apply unclamped weights so tests can also test extreme/out-of-range inputs and verify clamping!
  const pos = Float64Array.from(asset.positions);
  if (asset.faceTargets) {
    for (const t of FACE_SHAPE_TARGETS) {
      const k = weights[t];
      if (!k) continue;
      const entry = asset.faceTargets[t];
      if (!entry) continue;
      for (let j = 0; j < entry.ids.length; j++) {
        const id = entry.ids[j]!;
        pos[3 * id] = pos[3 * id]! + k * entry.deltas[3 * j]!;
        pos[3 * id + 1] = pos[3 * id + 1]! + k * entry.deltas[3 * j + 1]!;
        pos[3 * id + 2] = pos[3 * id + 2]! + k * entry.deltas[3 * j + 2]!;
      }
    }
  }
  const anchors = meshAnchors(pos, lmMap);
  const cx = 0.5 * (anchors.lEyeOuter[0] + anchors.rEyeOuter[0]);
  const cy = 0.5 * (anchors.lEyeOuter[1] + anchors.rEyeOuter[1]);
  const cz = 0.5 * (anchors.lEyeOuter[2] + anchors.rEyeOuter[2]);

  const roll = ((opts.rollDeg ?? 0) * Math.PI) / 180;
  const yaw = ((opts.yawDeg ?? 0) * Math.PI) / 180;
  const pitch = ((opts.pitchDeg ?? 0) * Math.PI) / 180;
  const scale = opts.scale ?? 0.022;
  const faceH = Math.max(1, anchors.foreheadTop[1] - anchors.chinMenton[1]);
  const mouthW = Math.max(1, Math.abs(anchors.lMouthCorner[0] - anchors.rMouthCorner[0]));
  const smile = opts.smile ?? 0;
  const mouthOpen = opts.mouthOpen ?? 0;

  const project = (p: V3): FaceLandmarkPoint => {
    let x = p[0] - cx, y = p[1] - cy, z = p[2] - cz;
    // Pitch (around X)
    const cyP = Math.cos(pitch), syP = Math.sin(pitch);
    [y, z] = [y * cyP - z * syP, y * syP + z * cyP];
    // Yaw (around Y)
    const cyY = Math.cos(yaw), syY = Math.sin(yaw);
    [x, z] = [x * cyY + z * syY, -x * syY + z * cyY];
    // Roll (around Z)
    const cR = Math.cos(roll), sR = Math.sin(roll);
    [x, y] = [x * cR - y * sR, x * sR + y * cR];
    return { x: 0.5 + x * scale, y: 0.45 - y * scale, z: -z * scale };
  };

  const out: FaceLandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const name of FACE_LANDMARK_NAMES) {
    let p: V3 = [...anchors[name]] as V3;
    if (smile && (name === 'lMouthCorner' || name === 'rMouthCorner')) {
      p = [p[0] * (1 + 0.35 * smile), p[1] + smile * mouthW, p[2]];
    }
    if (name === 'mouthCenter') {
      const gap = 0.5 * mouthOpen * faceH;
      out[MP_FACE.upperLipInner] = project([p[0], p[1] + gap, p[2]]);
      out[MP_FACE.lowerLipInner] = project([p[0], p[1] - gap, p[2]]);
    } else {
      out[MP_FACE[name]] = project(p);
    }
  }
  return out;
}
