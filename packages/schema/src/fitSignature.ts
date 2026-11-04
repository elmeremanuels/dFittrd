/**
 * FitSignature v1 — the ~80-float body vector, the ONLY body data that ever leaves the device
 * (handoff §2.2, docs/DECISIONS.md D3). Index map from docs/research/body-scan.md:
 *
 *   [0–11]  12 fused girths (cm)       neck, shoulder (around), bust/chest, underbust, waist, hip,
 *                                      thigh, knee, calf, ankle, upper arm, wrist
 *   [12–23] sigma per girth (cm)        quantised 0.25 cm
 *   [24–35] width/depth aspect ratio    per level, dimensionless
 *   [36–47] 12 lengths (cm)             stature, inseam, shoulder-to-waist (front), back-waist length,
 *                                      torso shoulder→hip, arm length, bi-acromial shoulder breadth,
 *                                      bust-point height, waist height, hip height, knee height, foot length
 *   [48–55] 8 posture/shape descriptors shoulder slope (deg), forward lean (deg), pelvic tilt proxy,
 *                                      bust/waist, waist/hip, shoulder/hip, waist-height ratio, limb/torso
 *   [56–65] 10 shape coefficients       Anny phenotype (height, weight, age, gender-prob, muscle, proportions)
 *                                      + 4 PCA coefficients of the residual silhouette atlas
 *   [66–71] demographics                weight kg, BMI, age bucket, sizing sex (2 one-hot), body-fat proxy
 *   [72–77] fit preferences [-1,1]      ease pref at bust, waist, hip; length pref; stretch tolerance; snug/loose
 *   [78]    schema version              1
 *   [79]    global capture quality      0..1
 *
 * No face, skin or hair values are ever encoded here. A value of 0 means "unknown / not captured".
 */
import { z } from 'zod';
import type { BodyProfile } from './body';

export const FS_LENGTH = 80 as const;
export const FS_VERSION = 1 as const;

export const FS_GIRTH_LEVELS = [
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
export type FsGirthLevel = (typeof FS_GIRTH_LEVELS)[number];

export const FS_LENGTH_KEYS = [
  'stature',
  'inseam',
  'shoulderToWaistFront',
  'backWaistLength',
  'torsoShoulderToHip',
  'armLength',
  'biacromialBreadth',
  'bustPointHeight',
  'waistHeight',
  'hipHeight',
  'kneeHeight',
  'footLength',
] as const;
export type FsLengthKey = (typeof FS_LENGTH_KEYS)[number];

export const FS_POSTURE_KEYS = [
  'shoulderSlopeDeg',
  'forwardLeanDeg',
  'pelvicTilt',
  'bustToWaist',
  'waistToHip',
  'shoulderToHip',
  'waistToHeight',
  'limbToTorso',
] as const;
export type FsPostureKey = (typeof FS_POSTURE_KEYS)[number];

export const FS_SHAPE_KEYS = [
  'annyHeight',
  'annyWeight',
  'annyAge',
  'annyGenderProb',
  'annyMuscle',
  'annyProportions',
  'pca0',
  'pca1',
  'pca2',
  'pca3',
] as const;
export type FsShapeKey = (typeof FS_SHAPE_KEYS)[number];

export const FS_DEMOGRAPHIC_KEYS = ['weightKg', 'bmi', 'ageBucket', 'sizingSexF', 'sizingSexM', 'bodyFatProxy'] as const;
export type FsDemographicKey = (typeof FS_DEMOGRAPHIC_KEYS)[number];

export const FS_PREF_KEYS = ['easeBust', 'easeWaist', 'easeHip', 'length', 'stretchTolerance', 'snugLoose'] as const;
export type FsPrefKey = (typeof FS_PREF_KEYS)[number];

/** Age buckets for index 68: 0 = unknown, 1 = <18, 2 = 18–24, 3 = 25–34, 4 = 35–44, 5 = 45–54, 6 = 55–64, 7 = 65+. */
export const FS_AGE_BUCKETS = ['unknown', '<18', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;

function indexMap<const K extends readonly string[]>(keys: K, offset: number): Record<K[number], number> {
  const out = {} as Record<K[number], number>;
  keys.forEach((k, i) => {
    out[k as K[number]] = offset + i;
  });
  return out;
}

/** Index constants. Every block is `[start, end]` inclusive; the per-key maps give the exact slot. */
export const FS_INDEX = {
  GIRTH: { start: 0, end: 11 },
  SIGMA: { start: 12, end: 23 },
  ASPECT: { start: 24, end: 35 },
  LENGTH: { start: 36, end: 47 },
  POSTURE: { start: 48, end: 55 },
  SHAPE: { start: 56, end: 65 },
  DEMOGRAPHICS: { start: 66, end: 71 },
  PREFS: { start: 72, end: 77 },
  VERSION: 78,
  QUALITY: 79,
  girth: indexMap(FS_GIRTH_LEVELS, 0),
  sigma: indexMap(FS_GIRTH_LEVELS, 12),
  aspect: indexMap(FS_GIRTH_LEVELS, 24),
  length: indexMap(FS_LENGTH_KEYS, 36),
  posture: indexMap(FS_POSTURE_KEYS, 48),
  shape: indexMap(FS_SHAPE_KEYS, 56),
  demographics: indexMap(FS_DEMOGRAPHIC_KEYS, 66),
  prefs: indexMap(FS_PREF_KEYS, 72),
} as const;

/**
 * Quantisation step per block. body-scan.md mandates girths 0.5 cm, lengths 1 cm, sigma 0.25 cm;
 * the other blocks are coarse by design (coarser vectors are harder to re-identify).
 */
export const FS_QUANT = {
  girth: 0.5,
  sigma: 0.25,
  aspect: 0.01,
  length: 1,
  posture: 0.01,
  shape: 0.001,
  demographics: { weightKg: 0.5, bmi: 0.1, ageBucket: 1, sizingSexF: 1, sizingSexM: 1, bodyFatProxy: 0.01 },
  prefs: 0.05,
  quality: 0.01,
} as const;

// ---------------------------------------------------------------------------
// Profile (structured) form
// ---------------------------------------------------------------------------

const finite = z.number().finite();
const nonneg = finite.min(0);

export const FitSignatureProfileSchema = z.object({
  version: z.literal(FS_VERSION),
  quality: z.number().min(0).max(1),
  girths: z.partialRecord(z.enum(FS_GIRTH_LEVELS), nonneg.max(300)),
  sigmas: z.partialRecord(z.enum(FS_GIRTH_LEVELS), nonneg.max(50)),
  aspect: z.partialRecord(z.enum(FS_GIRTH_LEVELS), nonneg.max(10)),
  lengths: z.partialRecord(z.enum(FS_LENGTH_KEYS), nonneg.max(300)),
  posture: z.partialRecord(z.enum(FS_POSTURE_KEYS), finite.min(-100).max(100)),
  shape: z.partialRecord(z.enum(FS_SHAPE_KEYS), finite.min(-1000).max(1000)),
  demographics: z.partialRecord(z.enum(FS_DEMOGRAPHIC_KEYS), finite.min(0).max(500)),
  prefs: z.partialRecord(z.enum(FS_PREF_KEYS), finite.min(-1).max(1)),
});
export type FitSignatureProfile = z.infer<typeof FitSignatureProfileSchema>;

/** What the encoder accepts: every block optional. */
export type FitSignatureProfileInput = Partial<Omit<FitSignatureProfile, 'version'>> & { version?: 1 };

export function emptyFitSignatureProfile(): FitSignatureProfile {
  return {
    version: FS_VERSION,
    quality: 0,
    girths: {},
    sigmas: {},
    aspect: {},
    lengths: {},
    posture: {},
    shape: {},
    demographics: {},
    prefs: {},
  };
}

// ---------------------------------------------------------------------------
// Wire form
// ---------------------------------------------------------------------------

export const FitSignatureVectorSchema = z
  .array(z.number().finite())
  .length(FS_LENGTH)
  .describe('80 floats, index map in @paskamer/schema FS_INDEX');
export type FitSignatureVector = z.infer<typeof FitSignatureVectorSchema>;

/** Body of `PUT /v1/me/signature`. */
export const FitSignatureWireSchema = z
  .object({
    version: z.literal(FS_VERSION),
    vector: FitSignatureVectorSchema,
    quality: z.number().min(0).max(1),
  })
  .superRefine((w, ctx) => {
    if (w.vector[FS_INDEX.VERSION] !== w.version) {
      ctx.addIssue({
        code: 'custom',
        path: ['vector', FS_INDEX.VERSION],
        message: `vector[${FS_INDEX.VERSION}] must equal version (${w.version})`,
      });
    }
    const q = w.vector[FS_INDEX.QUALITY] ?? 0;
    if (Math.abs(q - w.quality) > FS_QUANT.quality) {
      ctx.addIssue({
        code: 'custom',
        path: ['vector', FS_INDEX.QUALITY],
        message: `vector[${FS_INDEX.QUALITY}] must equal quality (${w.quality})`,
      });
    }
  })
  .meta({ title: 'Paskamer FitSignature v1' });
export type FitSignatureWire = z.infer<typeof FitSignatureWireSchema>;

// ---------------------------------------------------------------------------
// Quantisation
// ---------------------------------------------------------------------------

function q(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  const r = Math.round(value / step) * step;
  // Kill float noise such as 88.49999999 → round to the step's decimals (0.25 → 2 dp).
  const decimals = (String(step).split('.')[1] ?? '').length;
  const out = Number(r.toFixed(decimals));
  return Object.is(out, -0) ? 0 : out;
}

/** Quantisation step for one vector index. */
export function quantStepForIndex(i: number): number {
  if (i >= FS_INDEX.GIRTH.start && i <= FS_INDEX.GIRTH.end) return FS_QUANT.girth;
  if (i >= FS_INDEX.SIGMA.start && i <= FS_INDEX.SIGMA.end) return FS_QUANT.sigma;
  if (i >= FS_INDEX.ASPECT.start && i <= FS_INDEX.ASPECT.end) return FS_QUANT.aspect;
  if (i >= FS_INDEX.LENGTH.start && i <= FS_INDEX.LENGTH.end) return FS_QUANT.length;
  if (i >= FS_INDEX.POSTURE.start && i <= FS_INDEX.POSTURE.end) return FS_QUANT.posture;
  if (i >= FS_INDEX.SHAPE.start && i <= FS_INDEX.SHAPE.end) return FS_QUANT.shape;
  if (i >= FS_INDEX.DEMOGRAPHICS.start && i <= FS_INDEX.DEMOGRAPHICS.end) {
    const key = FS_DEMOGRAPHIC_KEYS[i - FS_INDEX.DEMOGRAPHICS.start] as FsDemographicKey;
    return FS_QUANT.demographics[key];
  }
  if (i >= FS_INDEX.PREFS.start && i <= FS_INDEX.PREFS.end) return FS_QUANT.prefs;
  if (i === FS_INDEX.VERSION) return 1;
  return FS_QUANT.quality;
}

/** Quantise every slot of a vector in place semantics (returns a new array). */
export function quantiseFitSignature(vec: ArrayLike<number>): number[] {
  const out = new Array<number>(FS_LENGTH).fill(0);
  for (let i = 0; i < FS_LENGTH; i++) out[i] = q(vec[i] ?? 0, quantStepForIndex(i));
  // The quality slot is a probability: clamp it like encode/decode do.
  out[FS_INDEX.QUALITY] = q(Math.max(0, Math.min(1, out[FS_INDEX.QUALITY] ?? 0)), FS_QUANT.quality);
  return out;
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

function fill<K extends string>(
  out: number[],
  map: Record<K, number>,
  values: Partial<Record<K, number>> | undefined,
  step: number | ((key: K) => number),
): void {
  if (!values) return;
  for (const key of Object.keys(map) as K[]) {
    const v = values[key];
    if (v === undefined || v === null) continue;
    const s = typeof step === 'function' ? step(key) : step;
    out[map[key]] = q(v, s);
  }
}

/** Encode a structured profile into the 80-float wire vector. Missing values encode as 0. */
export function encodeFitSignature(profile: FitSignatureProfileInput): number[] {
  const out = new Array<number>(FS_LENGTH).fill(0);
  fill(out, FS_INDEX.girth, profile.girths, FS_QUANT.girth);
  fill(out, FS_INDEX.sigma, profile.sigmas, FS_QUANT.sigma);
  fill(out, FS_INDEX.aspect, profile.aspect, FS_QUANT.aspect);
  fill(out, FS_INDEX.length, profile.lengths, FS_QUANT.length);
  fill(out, FS_INDEX.posture, profile.posture, FS_QUANT.posture);
  fill(out, FS_INDEX.shape, profile.shape, FS_QUANT.shape);
  fill(out, FS_INDEX.demographics, profile.demographics, (k) => FS_QUANT.demographics[k]);
  fill(out, FS_INDEX.prefs, profile.prefs, FS_QUANT.prefs);
  out[FS_INDEX.VERSION] = FS_VERSION;
  out[FS_INDEX.QUALITY] = q(Math.max(0, Math.min(1, profile.quality ?? 0)), FS_QUANT.quality);
  return out;
}

function pick<K extends string>(
  vec: ArrayLike<number>,
  map: Record<K, number>,
  step: number | ((key: K) => number),
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const key of Object.keys(map) as K[]) {
    const raw = vec[map[key]] ?? 0;
    if (!Number.isFinite(raw) || raw === 0) continue;
    const s = typeof step === 'function' ? step(key) : step;
    out[key] = q(raw, s);
  }
  return out;
}

/**
 * Decode an 80-float vector back into the structured profile. Zero slots are treated as
 * "unknown" and omitted. Throws if the vector is not 80 finite numbers or carries another version.
 */
export function decodeFitSignature(vec: ArrayLike<number>): FitSignatureProfile {
  if (vec.length !== FS_LENGTH) throw new RangeError(`fit signature must have ${FS_LENGTH} entries, got ${vec.length}`);
  for (let i = 0; i < FS_LENGTH; i++) {
    if (!Number.isFinite(vec[i])) throw new RangeError(`fit signature[${i}] is not a finite number`);
  }
  const version = vec[FS_INDEX.VERSION];
  if (version !== FS_VERSION) throw new RangeError(`unsupported fit signature version ${version}`);
  return {
    version: FS_VERSION,
    quality: q(Math.max(0, Math.min(1, vec[FS_INDEX.QUALITY] ?? 0)), FS_QUANT.quality),
    girths: pick(vec, FS_INDEX.girth, FS_QUANT.girth),
    sigmas: pick(vec, FS_INDEX.sigma, FS_QUANT.sigma),
    aspect: pick(vec, FS_INDEX.aspect, FS_QUANT.aspect),
    lengths: pick(vec, FS_INDEX.length, FS_QUANT.length),
    posture: pick(vec, FS_INDEX.posture, FS_QUANT.posture),
    shape: pick(vec, FS_INDEX.shape, FS_QUANT.shape),
    demographics: pick(vec, FS_INDEX.demographics, (k) => FS_QUANT.demographics[k]),
    prefs: pick(vec, FS_INDEX.prefs, FS_QUANT.prefs),
  };
}

/** Build the `PUT /v1/me/signature` body from a profile. */
export function toFitSignatureWire(profile: FitSignatureProfileInput): FitSignatureWire {
  const vector = encodeFitSignature(profile);
  return { version: FS_VERSION, vector, quality: vector[FS_INDEX.QUALITY] ?? 0 };
}

/** Float32 view for storage / kNN; values are chosen so the quantised grid is representable where it matters. */
export function toFloat32(vec: ArrayLike<number>): Float32Array {
  const f = new Float32Array(FS_LENGTH);
  for (let i = 0; i < FS_LENGTH; i++) f[i] = vec[i] ?? 0;
  return f;
}

// ---------------------------------------------------------------------------
// From the on-device body profile
// ---------------------------------------------------------------------------

/** EU shoe size → foot length in cm (fit-engine-spec.md: (eu − 2)·2/3). */
export function footLengthFromEu(eu: number): number {
  return ((eu - 2) * 2) / 3;
}

/**
 * Lift the on-device `BodyProfile` into a signature profile. Only the measurement block is derived
 * here; the capture pipeline merges posture/shape/aspect from the scan and the app merges prefs.
 *
 * Note: the fit point `shoulder` is a breadth (size charts list 36–39 cm), so it maps to
 * `lengths.biacromialBreadth`, not to the shoulder girth.
 */
export function fitSignatureFromBodyProfile(
  profile: BodyProfile,
  extras: Partial<Omit<FitSignatureProfile, 'version'>> = {},
): FitSignatureProfile {
  const base = emptyFitSignatureProfile();
  const m = profile.measurements;
  const girthMap: Partial<Record<keyof typeof m, FsGirthLevel>> = {
    bust: 'bust',
    waist: 'waist',
    hip: 'hip',
    thigh: 'thigh',
  };
  for (const [src, level] of Object.entries(girthMap) as [keyof typeof m, FsGirthLevel][]) {
    const v = m[src];
    if (v && v.mean > 0) {
      base.girths[level] = v.mean;
      if (v.sigma > 0) base.sigmas[level] = v.sigma;
    }
  }
  if (m.shoulder && m.shoulder.mean > 0) base.lengths.biacromialBreadth = m.shoulder.mean;
  if (m.inseam && m.inseam.mean > 0) base.lengths.inseam = m.inseam.mean;
  if (m.height && m.height.mean > 0) base.lengths.stature = m.height.mean;
  if (m.footLengthCm && m.footLengthCm.mean > 0) base.lengths.footLength = m.footLengthCm.mean;
  else if (m.foot && m.foot.mean > 0) base.lengths.footLength = m.foot.mean;
  else if (m.footEu && m.footEu.mean > 0) base.lengths.footLength = footLengthFromEu(m.footEu.mean);
  if (m.weight && m.weight.mean > 0) {
    base.demographics.weightKg = m.weight.mean;
    if (m.height && m.height.mean > 0) {
      const hm = m.height.mean / 100;
      base.demographics.bmi = m.weight.mean / (hm * hm);
    }
  }
  if (profile.captureQuality !== undefined) base.quality = profile.captureQuality;

  const merged: FitSignatureProfile = {
    ...base,
    ...extras,
    version: FS_VERSION,
    girths: { ...base.girths, ...(extras.girths ?? {}) },
    sigmas: { ...base.sigmas, ...(extras.sigmas ?? {}) },
    aspect: { ...base.aspect, ...(extras.aspect ?? {}) },
    lengths: { ...base.lengths, ...(extras.lengths ?? {}) },
    posture: { ...base.posture, ...(extras.posture ?? {}) },
    shape: { ...base.shape, ...(extras.shape ?? {}) },
    demographics: { ...base.demographics, ...(extras.demographics ?? {}) },
    prefs: { ...base.prefs, ...(extras.prefs ?? {}) },
  };
  if (extras.quality !== undefined) merged.quality = extras.quality;
  return merged;
}
