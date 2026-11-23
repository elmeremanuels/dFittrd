/**
 * Tests for the selfie quality gate (WO-021, CUR-35). Synthetic face landmarks and synthetic
 * image data — no real photos in the repo (D19).
 */
import { describe, expect, it } from 'vitest';
import {
  gateSelfie,
  selfieAngleFeatures,
  selfieBlendshapeFeatures,
  selfieHint,
  selfieHintKey,
  selfieLuminanceFeatures,
  SELFIE_THRESHOLDS,
  type FaceBlendshapes,
  type SelfieImage,
} from '../selfieGate';
import type { Landmark } from '../types';

// ---------------------------------------------------------------------------
// Synthetic face landmark builder (478 points, normalised 0..1)
// ---------------------------------------------------------------------------

const IMG_W = 480;
const IMG_H = 640;

/** Indices the selfie gate reads. */
const FACE_IDX = {
  noseTip: 1,
  chin: 152,
  forehead: 10,
  eyeLOuter: 33,
  eyeROuter: 263,
  eyeLInner: 133,
  eyeRInner: 362,
  mouthL: 61,
  mouthR: 291,
  leftCheek: [50, 101, 118, 117, 123, 187, 205, 36, 142, 203],
  rightCheek: [280, 330, 347, 346, 352, 411, 425, 266, 371, 423],
  foreheadRegion: [10, 109, 338, 67, 297, 103, 332, 9, 151, 108, 337],
} as const;

interface FaceOpts {
  /** Centre of the face, normalised. */
  cx?: number;
  cy?: number;
  /** Scale of the face relative to a default. */
  scale?: number;
  /** Head yaw in degrees (positive = turn right). */
  yawDeg?: number;
  /** Head pitch in degrees (positive = tilt down). */
  pitchDeg?: number;
  /** Head roll in degrees (positive = tilt clockwise). */
  rollDeg?: number;
}

/** Build a minimal 478-point landmark array with the key points placed realistically. */
function faceLandmarks(opts: FaceOpts = {}): Landmark[] {
  const { cx = 0.5, cy = 0.45, scale = 1, yawDeg = 0, pitchDeg = 0, rollDeg = 0 } = opts;
  const lm: Landmark[] = new Array<Landmark>(478).fill(null as unknown as Landmark);

  // Default face proportions (normalised to image, face ~30% of image width).
  const faceW = 0.15 * scale; // half eye-span
  const faceH = 0.22 * scale; // half face height
  const eyeY = cy - faceH * 0.15;
  const noseY = cy + faceH * 0.05;
  const mouthY = cy + faceH * 0.35;
  const chinY = cy + faceH;
  // Forehead calibrated so chin-nose / nose-forehead ≈ 1.3 at rest (neutral pitch).
  const foreheadY = cy - faceH * 0.68;

  // Yaw: shift nose off centre horizontally.
  const yawShift = (yawDeg / 30) * faceW * 0.5;
  // Pitch: shift chin up (tilt down) or down (tilt up).
  // Multiplier calibrated so pitchDeg=20 produces a measured pitch > 12°.
  const pitchShift = (pitchDeg / 30) * faceH * 1.0;
  // Roll: rotate eye line.
  const rollRad = (rollDeg * Math.PI) / 180;
  const eyeDy = Math.sin(rollRad) * faceW;

  const put = (i: number, x: number, y: number): void => {
    lm[i] = { x, y, z: 0, visibility: 0.95 };
  };

  // Key landmarks.
  // Pitch: tilt down shrinks the chin-to-nose distance, tilt up grows it.
  // The forehead moves the opposite way to the chin.
  put(FACE_IDX.noseTip, cx + yawShift, noseY);
  put(FACE_IDX.chin, cx + yawShift * 0.5, chinY - pitchShift);
  put(FACE_IDX.forehead, cx - yawShift * 0.3, foreheadY + pitchShift * 0.5);
  put(FACE_IDX.eyeLOuter, cx - faceW, eyeY - eyeDy);
  put(FACE_IDX.eyeROuter, cx + faceW, eyeY + eyeDy);
  put(FACE_IDX.eyeLInner, cx - faceW * 0.4, eyeY - eyeDy * 0.4);
  put(FACE_IDX.eyeRInner, cx + faceW * 0.4, eyeY + eyeDy * 0.4);
  put(FACE_IDX.mouthL, cx - faceW * 0.35 + yawShift * 0.3, mouthY + pitchShift * 0.5);
  put(FACE_IDX.mouthR, cx + faceW * 0.35 + yawShift * 0.3, mouthY + pitchShift * 0.5);

  // Fill cheek and forehead regions (for bounding box in luminance computation). Deterministic.
  for (let k = 0; k < FACE_IDX.leftCheek.length; k++) {
    const t = k / FACE_IDX.leftCheek.length;
    put(FACE_IDX.leftCheek[k] as number, cx - faceW * (0.6 + t * 0.4), cy - faceH * 0.1 + (t - 0.5) * faceH * 0.4);
  }
  for (let k = 0; k < FACE_IDX.rightCheek.length; k++) {
    const t = k / FACE_IDX.rightCheek.length;
    put(FACE_IDX.rightCheek[k] as number, cx + faceW * (0.6 + t * 0.4), cy - faceH * 0.1 + (t - 0.5) * faceH * 0.4);
  }
  for (let k = 0; k < FACE_IDX.foreheadRegion.length; k++) {
    const t = k / FACE_IDX.foreheadRegion.length;
    put(FACE_IDX.foreheadRegion[k] as number, cx + (t - 0.5) * faceW, foreheadY + t * faceH * 0.1);
  }

  // Fill the rest with deterministic points inside the face bounding box.
  for (let i = 0; i < 478; i++) {
    if (!lm[i]) {
      const t = (i * 0.618033988749895) % 1; // golden-ratio based for even distribution
      const u = ((i * 0.381966011250105) % 1);
      lm[i] = { x: cx + (t - 0.5) * faceW * 2, y: cy + (u - 0.5) * faceH * 2, z: 0, visibility: 0.9 };
    }
  }

  return lm;
}

/** A synthetic RGBA image of the given size, filled with a solid grey. */
function solidImage(width: number, height: number, grey: number): SelfieImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = grey;
    data[i + 1] = grey;
    data[i + 2] = grey;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** A synthetic image with a left-right luminance gradient (left = leftGrey, right = rightGrey). */
function gradientImage(width: number, height: number, leftGrey: number, rightGrey: number): SelfieImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const midX = width / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grey = x < midX ? leftGrey : rightGrey;
      const off = (y * width + x) * 4;
      data[off] = grey;
      data[off + 1] = grey;
      data[off + 2] = grey;
      data[off + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A synthetic image with high-frequency content (sharp edges). */
function sharpImage(width: number, height: number, base: number = 128): SelfieImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Checkerboard pattern: high Laplacian variance.
      const v = (x + y) % 2 === 0 ? base + 60 : base - 60;
      const off = (y * width + x) * 4;
      data[off] = v;
      data[off + 1] = v;
      data[off + 2] = v;
      data[off + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A synthetic image with smooth content (blurry — low Laplacian variance). */
function blurryImage(width: number, height: number, base: number = 128): SelfieImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Very gradual gradient: low Laplacian variance.
      const v = base + (x / width) * 2;
      const off = (y * width + x) * 4;
      data[off] = v;
      data[off + 1] = v;
      data[off + 2] = v;
      data[off + 3] = 255;
    }
  }
  return { width, height, data };
}

const neutralBlendshapes: FaceBlendshapes = {
  jawOpen: 0.05,
  mouthOpen: 0.02,
  mouthSmileLeft: 0.2,
  mouthSmileRight: 0.2,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selfieGate', () => {
  it('passes a good selfie: one face, neutral, well-lit, sharp, large enough', () => {
    const lm = faceLandmarks({ scale: 1.2 });
    const img = sharpImage(IMG_W, IMG_H, 140);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.features.faceCount).toBe(1);
    expect(r.features.eyeDistanceRatio).toBeGreaterThan(SELFIE_THRESHOLDS.minEyeDistanceRatio);
  });

  it('rejects when no face is detected', () => {
    const lm: Landmark[] = [];
    const img = solidImage(IMG_W, IMG_H, 128);
    const r = gateSelfie(0, lm, img);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('no_face');
    expect(selfieHintKey(r.reasons)).toBe('noFace');
  });

  it('rejects when multiple faces are detected', () => {
    const lm = faceLandmarks();
    const img = solidImage(IMG_W, IMG_H, 128);
    const r = gateSelfie(2, lm, img, neutralBlendshapes);
    expect(r.reasons).toContain('multiple_faces');
    expect(selfieHintKey(r.reasons)).toBe('multipleFaces');
  });

  it('rejects excessive yaw (> 12°)', () => {
    const lm = faceLandmarks({ yawDeg: 20 });
    const img = sharpImage(IMG_W, IMG_H, 140);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.yawDeg).toBeGreaterThan(SELFIE_THRESHOLDS.maxAngleDeg);
    expect(r.reasons).toContain('yaw');
    expect(selfieHintKey(r.reasons)).toBe('faceTheCamera');
  });

  it('rejects excessive pitch (> 12°)', () => {
    const lm = faceLandmarks({ pitchDeg: 20 });
    const img = sharpImage(IMG_W, IMG_H, 140);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.pitchDeg).toBeGreaterThan(SELFIE_THRESHOLDS.maxAngleDeg);
    expect(r.reasons).toContain('pitch');
  });

  it('rejects excessive roll (> 12°)', () => {
    const lm = faceLandmarks({ rollDeg: 18 });
    const img = sharpImage(IMG_W, IMG_H, 140);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.rollDeg).toBeGreaterThan(SELFIE_THRESHOLDS.maxAngleDeg);
    expect(r.reasons).toContain('roll');
  });

  it('rejects open mouth (jawOpen above threshold)', () => {
    const lm = faceLandmarks({ scale: 1.2 });
    const img = sharpImage(IMG_W, IMG_H, 140);
    const bs: FaceBlendshapes = { ...neutralBlendshapes, jawOpen: 0.6, mouthOpen: 0.5 };
    const r = gateSelfie(1, lm, img, bs);
    expect(r.reasons).toContain('mouth_open');
    expect(selfieHintKey(r.reasons)).toBe('neutralExpression');
  });

  it('rejects broad smile (smileSum above threshold)', () => {
    const lm = faceLandmarks({ scale: 1.2 });
    const img = sharpImage(IMG_W, IMG_H, 140);
    const bs: FaceBlendshapes = { ...neutralBlendshapes, mouthSmileLeft: 0.7, mouthSmileRight: 0.7 };
    const r = gateSelfie(1, lm, img, bs);
    expect(r.reasons).toContain('smiling');
  });

  it('rejects a too-dark image', () => {
    const lm = faceLandmarks({ scale: 1.2 });
    const img = sharpImage(IMG_W, IMG_H, 30);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.meanLuminance).toBeLessThan(SELFIE_THRESHOLDS.minLuminance);
    expect(r.reasons).toContain('too_dark');
    expect(selfieHintKey(r.reasons)).toBe('moreLight');
  });

  it('rejects a too-bright (washed out) image', () => {
    const lm = faceLandmarks({ scale: 1.2 });
    const img = solidImage(IMG_W, IMG_H, 248);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.meanLuminance).toBeGreaterThan(SELFIE_THRESHOLDS.maxLuminance);
    expect(r.reasons).toContain('too_bright');
  });

  it('rejects strong side light (luminance imbalance)', () => {
    const lm = faceLandmarks({ scale: 1.2 });
    const img = gradientImage(IMG_W, IMG_H, 180, 60);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.luminanceImbalance).toBeGreaterThan(SELFIE_THRESHOLDS.maxLuminanceImbalance);
    expect(r.reasons).toContain('side_light');
    expect(selfieHintKey(r.reasons)).toBe('lessSideLight');
  });

  it('rejects a blurry image (low Laplacian variance)', () => {
    const lm = faceLandmarks({ scale: 1.2 });
    const img = blurryImage(IMG_W, IMG_H, 128);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.sharpness).toBeLessThan(SELFIE_THRESHOLDS.minSharpness);
    expect(r.reasons).toContain('too_blurry');
    expect(selfieHintKey(r.reasons)).toBe('holdSteady');
  });

  it('rejects a face that is too small (eye distance < 12% of image width)', () => {
    const lm = faceLandmarks({ scale: 0.35 });
    const img = sharpImage(IMG_W, IMG_H, 140);
    const r = gateSelfie(1, lm, img, neutralBlendshapes);
    expect(r.features.eyeDistanceRatio).toBeLessThan(SELFIE_THRESHOLDS.minEyeDistanceRatio);
    expect(r.reasons).toContain('too_small');
    expect(selfieHintKey(r.reasons)).toBe('moveCloser');
  });

  it('returns multiple reasons at once', () => {
    const lm = faceLandmarks({ yawDeg: 20, rollDeg: 15, scale: 0.35 });
    const img = sharpImage(IMG_W, IMG_H, 30);
    const bs: FaceBlendshapes = { ...neutralBlendshapes, jawOpen: 0.5 };
    const r = gateSelfie(1, lm, img, bs);
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(1);
    // yaw and roll both trigger 'faceTheCamera'
    expect(r.reasons).toContain('yaw');
    expect(r.reasons).toContain('too_dark');
  });

  it('each bad case gives its own message', () => {
    // Verify that the hint key mapping covers every reason.
    const allReasons = [
      'no_face',
      'multiple_faces',
      'yaw',
      'pitch',
      'roll',
      'mouth_open',
      'smiling',
      'too_dark',
      'too_bright',
      'side_light',
      'too_blurry',
      'too_small',
      'face_occluded',
    ] as const;
    for (const reason of allReasons) {
      const key = selfieHintKey([reason]);
      expect(key).not.toBe('perfect');
    }
  });
});

describe('selfieAngleFeatures', () => {
  it('returns near-zero angles for a face-on selfie', () => {
    const lm = faceLandmarks();
    const f = selfieAngleFeatures(lm, IMG_W);
    expect(f.yawDeg).toBeLessThan(3);
    expect(f.pitchDeg).toBeLessThan(5);
    expect(f.rollDeg).toBeLessThan(2);
    expect(f.eyeDistanceRatio).toBeGreaterThan(0.2);
  });

  it('detects yaw from a turned head', () => {
    const lm = faceLandmarks({ yawDeg: 25 });
    const f = selfieAngleFeatures(lm, IMG_W);
    expect(f.yawDeg).toBeGreaterThan(10);
  });

  it('detects roll from a tilted head', () => {
    const lm = faceLandmarks({ rollDeg: 15 });
    const f = selfieAngleFeatures(lm, IMG_W);
    expect(f.rollDeg).toBeGreaterThan(10);
  });
});

describe('selfieBlendshapeFeatures', () => {
  it('reads blendshapes from a valid map', () => {
    const bs: FaceBlendshapes = { jawOpen: 0.4, mouthOpen: 0.3, mouthSmileLeft: 0.5, mouthSmileRight: 0.3 };
    const f = selfieBlendshapeFeatures(bs);
    expect(f.jawOpen).toBe(0.4);
    expect(f.mouthOpen).toBe(0.3);
    expect(f.smileSum).toBeCloseTo(0.8);
  });

  it('defaults to zero when blendshapes are missing', () => {
    const f = selfieBlendshapeFeatures(null);
    expect(f.jawOpen).toBe(0);
    expect(f.mouthOpen).toBe(0);
    expect(f.smileSum).toBe(0);
  });
});

describe('selfieLuminanceFeatures', () => {
  it('computes mean luminance from a solid image', () => {
    const lm = faceLandmarks({ scale: 1.5 });
    const img = solidImage(IMG_W, IMG_H, 120);
    const f = selfieLuminanceFeatures(lm, img);
    expect(f.meanLuminance).toBeCloseTo(120, 0);
    expect(f.luminanceImbalance).toBeLessThan(0.05);
  });

  it('detects a strong left-right luminance imbalance', () => {
    const lm = faceLandmarks({ scale: 1.5 });
    const img = gradientImage(IMG_W, IMG_H, 200, 80);
    const f = selfieLuminanceFeatures(lm, img);
    expect(f.luminanceImbalance).toBeGreaterThan(SELFIE_THRESHOLDS.maxLuminanceImbalance);
  });

  it('computes higher sharpness on a checkerboard than a smooth gradient', () => {
    const lm = faceLandmarks({ scale: 1.5 });
    const sharp = sharpImage(IMG_W, IMG_H);
    const blurry = blurryImage(IMG_W, IMG_H);
    const sharpF = selfieLuminanceFeatures(lm, sharp);
    const blurryF = selfieLuminanceFeatures(lm, blurry);
    expect(sharpF.sharpness).toBeGreaterThan(blurryF.sharpness);
    expect(sharpF.sharpness).toBeGreaterThan(SELFIE_THRESHOLDS.minSharpness);
  });
});

describe('selfieHint', () => {
  it('returns the correct English text for each hint key', () => {
    expect(selfieHint(['no_face'])).toMatch(/no face/i);
    expect(selfieHint(['yaw'])).toMatch(/camera/i);
    expect(selfieHint(['mouth_open'])).toMatch(/relax/i);
    expect(selfieHint(['too_dark'])).toMatch(/light/i);
    expect(selfieHint(['too_blurry'])).toMatch(/steady/i);
    expect(selfieHint(['too_small'])).toMatch(/closer/i);
    expect(selfieHint([])).toMatch(/great/i);
  });
});
