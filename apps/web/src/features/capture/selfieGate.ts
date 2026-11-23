/**
 * Selfie quality gate for the face step (WO-021, CUR-35, phase C).
 *
 * Pure functions over Face Landmarker results and image pixels: before the face shape
 * (WO-020) is fitted, check on the device that the selfie is usable and tell the shopper
 * what to change if it is not. No real photos live in the repo (D19); tests use synthetic
 * landmarks and synthetic image data.
 *
 * The Face Landmarker gives 478 landmarks per face and (with blendshapes on) 52 blendshape
 * scores per face. Landmarks are normalised 0..1 in x and y.
 */
import { appStrings } from '../../strings';
import { FACE_REGIONS } from './landmarks';
import type { Landmark } from './types';

// ---------------------------------------------------------------------------
// Face Landmarker blendshape names used here (MediaPipe FaceLandmarker, 52 shapes)
// ---------------------------------------------------------------------------

/** The blendshape score map: name → 0..1. Only the names this gate reads are typed. */
export interface FaceBlendshapes {
  jawOpen?: number;
  mouthOpen?: number;
  mouthSmileLeft?: number;
  mouthSmileRight?: number;
  browDownLeft?: number;
  browDownRight?: number;
  eyeBlinkLeft?: number;
  eyeBlinkRight?: number;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const SELFIE_THRESHOLDS = {
  /** Head rotation limit, degrees (yaw, pitch, roll each must be within ±this). */
  maxAngleDeg: 12,
  /** Jaw-open blendshape above which the mouth is considered open. */
  maxJawOpen: 0.3,
  /** Mouth-open blendshape above which the mouth is considered open. */
  maxMouthOpen: 0.3,
  /** Sum of left+right smile blendshapes above which the expression is not neutral. */
  maxSmileSum: 0.8,
  /** Mean luminance on the face region (0..255) below which the photo is too dark. */
  minLuminance: 60,
  /** Mean luminance on the face region (0..255) above which the photo is washed out. */
  maxLuminance: 230,
  /** |leftLum − rightLum| / max(leftLum, rightLum) above which the side light is too strong. */
  maxLuminanceImbalance: 0.45,
  /** Variance of the Laplacian on the face region below which the photo is too blurry. */
  minSharpness: 80,
  /** Inter-eye distance as a fraction of image width: face must be at least this large. */
  minEyeDistanceRatio: 0.12,
} as const;

// ---------------------------------------------------------------------------
// Landmark indices used for angle estimation
// ---------------------------------------------------------------------------

/** Nose tip. */
const NOSE_TIP = 1;
/** Chin (bottom of the face oval). */
const CHIN = 152;
/** Forehead top (approximate; the highest point of the face oval). */
const FOREHEAD = 10;
/** Left eye outer corner. */
const EYE_L_OUTER = 33;
/** Right eye outer corner. */
const EYE_R_OUTER = 263;
/** Left mouth corner. */
const MOUTH_L = 61;
/** Right mouth corner. */
const MOUTH_R = 291;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SelfieReason =
  | 'no_face'
  | 'multiple_faces'
  | 'yaw'
  | 'pitch'
  | 'roll'
  | 'mouth_open'
  | 'smiling'
  | 'too_dark'
  | 'too_bright'
  | 'side_light'
  | 'too_blurry'
  | 'too_small'
  | 'face_occluded';

export interface SelfieFeatures {
  faceCount: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  jawOpen: number;
  mouthOpen: number;
  smileSum: number;
  meanLuminance: number;
  luminanceImbalance: number;
  sharpness: number;
  eyeDistanceRatio: number;
}

export interface SelfieResult {
  ok: boolean;
  reasons: SelfieReason[];
  features: SelfieFeatures;
}

export interface SelfieImage {
  width: number;
  height: number;
  /** RGBA pixel data, row-major, length = width × height × 4. */
  data: Uint8ClampedArray | Uint8Array;
}

/** The angle and size features computed from landmarks only (no pixels). Pure: safe in the worker. */
export function selfieAngleFeatures(lm: readonly Landmark[], imageWidth: number): Pick<SelfieFeatures, 'yawDeg' | 'pitchDeg' | 'rollDeg' | 'eyeDistanceRatio'> {
  const at = (i: number): Landmark => lm[i] ?? { x: 0.5, y: 0.5 };
  const nose = at(NOSE_TIP);
  const chin = at(CHIN);
  const forehead = at(FOREHEAD);
  const eyeLO = at(EYE_L_OUTER);
  const eyeRO = at(EYE_R_OUTER);

  // Roll: tilt of the eye line. Positive = left eye higher (in image y, lower value).
  const dx = (eyeRO.x - eyeLO.x) * imageWidth;
  const dy = (eyeRO.y - eyeLO.y) * imageWidth;
  const rollDeg = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));

  // Yaw: how far the nose is off the face centre horizontally.
  // Face centre = midpoint of the eye outer corners.
  const faceCx = (eyeLO.x + eyeRO.x) / 2;
  const eyeSpan = Math.abs(eyeRO.x - eyeLO.x);
  const yawNorm = eyeSpan > 0.001 ? (nose.x - faceCx) / eyeSpan : 0;
  // A yaw normalised ratio of ~0.35 corresponds to about 30° head turn.
  const yawDeg = Math.abs(Math.asin(Math.max(-1, Math.min(1, yawNorm * 1.5))) * (180 / Math.PI));

  // Pitch: chin-to-nose vs nose-to-forehead vertical ratio.
  const chinNose = Math.abs(chin.y - nose.y);
  const noseForehead = Math.abs(nose.y - forehead.y);
  // Neutral: chin-nose ≈ 1.3× nose-forehead. Tilt down: chin-nose shrinks. Tilt up: grows.
  const ratio = noseForehead > 0.001 ? chinNose / noseForehead : 1.3;
  const pitchDeg = Math.abs((ratio - 1.3) * 25);

  // Eye distance: outer corner to outer corner as fraction of image width.
  const eyeDist = Math.hypot((eyeRO.x - eyeLO.x) * imageWidth, (eyeRO.y - eyeLO.y) * imageWidth);
  const eyeDistanceRatio = eyeDist / imageWidth;

  return { yawDeg, pitchDeg, rollDeg, eyeDistanceRatio };
}

/** Blendshape features (pure, safe in worker). */
export function selfieBlendshapeFeatures(bs: FaceBlendshapes | null | undefined): Pick<SelfieFeatures, 'jawOpen' | 'mouthOpen' | 'smileSum'> {
  const jawOpen = bs?.jawOpen ?? 0;
  const mouthOpen = bs?.mouthOpen ?? 0;
  const smileSum = (bs?.mouthSmileLeft ?? 0) + (bs?.mouthSmileRight ?? 0);
  return { jawOpen, mouthOpen, smileSum };
}

/** Face-region luminance features from the image pixels. */
export function selfieLuminanceFeatures(
  lm: readonly Landmark[],
  img: SelfieImage,
): Pick<SelfieFeatures, 'meanLuminance' | 'luminanceImbalance' | 'sharpness'> {
  const { width, height, data } = img;

  // Bounding box of the face from cheek, forehead, chin, and nose landmarks.
  const faceIds = [
    ...FACE_REGIONS.leftCheek,
    ...FACE_REGIONS.rightCheek,
    ...FACE_REGIONS.forehead,
    CHIN,
    NOSE_TIP,
    MOUTH_L,
    MOUTH_R,
  ];
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const i of faceIds) {
    const l = lm[i];
    if (!l) continue;
    if (l.x < minX) minX = l.x;
    if (l.x > maxX) maxX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.y > maxY) maxY = l.y;
  }
  const x0 = Math.max(0, Math.floor(minX * width));
  const x1 = Math.min(width - 1, Math.ceil(maxX * width));
  const y0 = Math.max(0, Math.floor(minY * height));
  const y1 = Math.min(height - 1, Math.ceil(maxY * height));

  if (x1 <= x0 || y1 <= y0) return { meanLuminance: 0, luminanceImbalance: 1, sharpness: 0 };

  // Mean luminance and left-right balance over the face bounding box.
  let sumLum = 0;
  let leftLum = 0, rightLum = 0, leftN = 0, rightN = 0;
  const midX = (x0 + x1) / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const off = (y * width + x) * 4;
      const lum = 0.299 * (data[off] as number) + 0.587 * (data[off + 1] as number) + 0.114 * (data[off + 2] as number);
      sumLum += lum;
      if (x < midX) { leftLum += lum; leftN++; }
      else { rightLum += lum; rightN++; }
    }
  }
  const n = (x1 - x0 + 1) * (y1 - y0 + 1);
  const meanLuminance = n > 0 ? sumLum / n : 0;
  const avgLeft = leftN > 0 ? leftLum / leftN : 0;
  const avgRight = rightN > 0 ? rightLum / rightN : 0;
  const maxSide = Math.max(avgLeft, avgRight);
  const luminanceImbalance = maxSide > 0 ? Math.abs(avgLeft - avgRight) / maxSide : 0;

  // Sharpness: variance of the Laplacian on the face region (L channel only).
  const sharpness = laplacianVariance(data, width, height, x0, y0, x1, y1);

  return { meanLuminance, luminanceImbalance, sharpness };
}

/**
 * Variance of the discrete Laplacian over a rectangular region of the image (grey channel).
 * The Laplacian at (x, y) = L(x-1,y) + L(x+1,y) + L(x,y-1) + L(x,y+1) − 4·L(x,y).
 * A higher variance means sharper edges.
 */
function laplacianVariance(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  _height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const grey = (x: number, y: number): number => {
    const off = (y * width + x) * 4;
    return 0.299 * (data[off] as number) + 0.587 * (data[off + 1] as number) + 0.114 * (data[off + 2] as number);
  };
  if (x1 - x0 < 3 || y1 - y0 < 3) return 0;
  let sum = 0, sumSq = 0, n = 0;
  for (let y = y0 + 1; y < y1; y++) {
    for (let x = x0 + 1; x < x1; x++) {
      const lap = grey(x - 1, y) + grey(x + 1, y) + grey(x, y - 1) + grey(x, y + 1) - 4 * grey(x, y);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n < 2) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Gate one selfie. `faceCount` is the number of faces the Face Landmarker detected.
 * `blendshapes` is the blendshape map of the first (or only) face, or null/undefined
 * when the model did not produce them.
 */
export function gateSelfie(
  faceCount: number,
  lm: readonly Landmark[],
  img: SelfieImage,
  blendshapes?: FaceBlendshapes | null,
): SelfieResult {
  const T = SELFIE_THRESHOLDS;
  const reasons: SelfieReason[] = [];
  const angles = selfieAngleFeatures(lm, img.width);
  const bs = selfieBlendshapeFeatures(blendshapes);
  const lum = faceCount === 1 && lm.length > 0 ? selfieLuminanceFeatures(lm, img) : { meanLuminance: 0, luminanceImbalance: 1, sharpness: 0 };

  if (faceCount === 0) reasons.push('no_face');
  if (faceCount > 1) reasons.push('multiple_faces');

  if (faceCount >= 1 && lm.length > 0) {
    if (angles.yawDeg > T.maxAngleDeg) reasons.push('yaw');
    if (angles.pitchDeg > T.maxAngleDeg) reasons.push('pitch');
    if (angles.rollDeg > T.maxAngleDeg) reasons.push('roll');
    if (bs.jawOpen > T.maxJawOpen || bs.mouthOpen > T.maxMouthOpen) reasons.push('mouth_open');
    if (bs.smileSum > T.maxSmileSum) reasons.push('smiling');
    if (lum.meanLuminance < T.minLuminance) reasons.push('too_dark');
    else if (lum.meanLuminance > T.maxLuminance) reasons.push('too_bright');
    if (lum.luminanceImbalance > T.maxLuminanceImbalance) reasons.push('side_light');
    if (lum.sharpness < T.minSharpness) reasons.push('too_blurry');
    if (angles.eyeDistanceRatio < T.minEyeDistanceRatio) reasons.push('too_small');
  }

  const features: SelfieFeatures = { faceCount, ...angles, ...bs, ...lum };
  return { ok: reasons.length === 0, reasons, features };
}

// ---------------------------------------------------------------------------
// Hint key and text (page side only, not safe in the worker)
// ---------------------------------------------------------------------------

export type SelfieHintKey =
  | 'noFace'
  | 'multipleFaces'
  | 'faceTheCamera'
  | 'neutralExpression'
  | 'moreLight'
  | 'lessSideLight'
  | 'holdSteady'
  | 'moveCloser'
  | 'clearFace'
  | 'perfect';

/** The hint key for a set of selfie reasons. Order = priority. Pure: safe in the worker. */
export function selfieHintKey(reasons: readonly SelfieReason[]): SelfieHintKey {
  if (reasons.includes('no_face')) return 'noFace';
  if (reasons.includes('multiple_faces')) return 'multipleFaces';
  if (reasons.includes('yaw') || reasons.includes('pitch') || reasons.includes('roll')) return 'faceTheCamera';
  if (reasons.includes('mouth_open') || reasons.includes('smiling')) return 'neutralExpression';
  if (reasons.includes('too_dark')) return 'moreLight';
  if (reasons.includes('too_bright')) return 'moreLight';
  if (reasons.includes('side_light')) return 'lessSideLight';
  if (reasons.includes('too_blurry')) return 'holdSteady';
  if (reasons.includes('too_small')) return 'moveCloser';
  if (reasons.includes('face_occluded')) return 'clearFace';
  return 'perfect';
}

/** Human-readable hint in the page's interface locale. Page side only. */
export function selfieHint(reasons: readonly SelfieReason[]): string {
  return appStrings().capture.selfieGate[selfieHintKey(reasons)];
}
