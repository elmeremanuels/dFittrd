import { describe, expect, it } from 'vitest';
import {
  FS_AGE_BUCKETS,
  FS_DEMOGRAPHIC_KEYS,
  FS_GIRTH_LEVELS,
  FS_INDEX,
  FS_LENGTH,
  FS_LENGTH_KEYS,
  FS_POSTURE_KEYS,
  FS_PREF_KEYS,
  FS_SHAPE_KEYS,
  FS_VERSION,
  FitSignatureProfileSchema,
  FitSignatureVectorSchema,
  FitSignatureWireSchema,
  decodeFitSignature,
  emptyFitSignatureProfile,
  encodeFitSignature,
  fitSignatureFromBodyProfile,
  footLengthFromEu,
  quantStepForIndex,
  quantiseFitSignature,
  toFitSignatureWire,
  toFloat32,
  type FitSignatureProfile,
} from './fitSignature';
import type { BodyProfile } from './body';

const FULL: FitSignatureProfile = {
  version: 1,
  quality: 0.83,
  girths: { neck: 36, shoulder: 104.5, bust: 88, underbust: 76, waist: 70, hip: 96, thigh: 56.5, knee: 37, calf: 36, ankle: 22, upperArm: 27.5, wrist: 15.5 },
  sigmas: { neck: 1, shoulder: 2.5, bust: 1.75, underbust: 2, waist: 1.5, hip: 1.25, thigh: 3.5, knee: 2, calf: 2, ankle: 1, upperArm: 2, wrist: 1 },
  aspect: { neck: 1.1, shoulder: 1.9, bust: 1.35, underbust: 1.4, waist: 1.3, hip: 1.25, thigh: 1.1, knee: 1.05, calf: 1, ankle: 1.2, upperArm: 1.1, wrist: 1.3 },
  lengths: { stature: 168, inseam: 78, shoulderToWaistFront: 41, backWaistLength: 40, torsoShoulderToHip: 60, armLength: 58, biacromialBreadth: 38, bustPointHeight: 122, waistHeight: 104, hipHeight: 84, kneeHeight: 46, footLength: 24 },
  posture: { shoulderSlopeDeg: 21.5, forwardLeanDeg: 2.25, pelvicTilt: 0.12, bustToWaist: 1.26, waistToHip: 0.73, shoulderToHip: 1.09, waistToHeight: 0.42, limbToTorso: 1.3 },
  shape: { annyHeight: 0.512, annyWeight: 0.431, annyAge: 0.3, annyGenderProb: 0.9, annyMuscle: 0.4, annyProportions: 0.55, pca0: -0.121, pca1: 0.034, pca2: 0.002, pca3: -0.5 },
  // sizingSexM is intentionally absent: 0 means "unknown" on the wire, so a 0 never survives decode.
  demographics: { weightKg: 62, bmi: 22, ageBucket: 3, sizingSexF: 1, bodyFatProxy: 0.27 },
  prefs: { easeBust: 0.2, easeWaist: -0.1, easeHip: 0.35, length: 0.1, stretchTolerance: 0.5, snugLoose: -0.25 },
};

describe('FS_INDEX', () => {
  it('matches the body-scan.md index map exactly', () => {
    expect(FS_LENGTH).toBe(80);
    expect(FS_INDEX.GIRTH).toEqual({ start: 0, end: 11 });
    expect(FS_INDEX.SIGMA).toEqual({ start: 12, end: 23 });
    expect(FS_INDEX.ASPECT).toEqual({ start: 24, end: 35 });
    expect(FS_INDEX.LENGTH).toEqual({ start: 36, end: 47 });
    expect(FS_INDEX.POSTURE).toEqual({ start: 48, end: 55 });
    expect(FS_INDEX.SHAPE).toEqual({ start: 56, end: 65 });
    expect(FS_INDEX.DEMOGRAPHICS).toEqual({ start: 66, end: 71 });
    expect(FS_INDEX.PREFS).toEqual({ start: 72, end: 77 });
    expect(FS_INDEX.VERSION).toBe(78);
    expect(FS_INDEX.QUALITY).toBe(79);

    expect(FS_GIRTH_LEVELS).toEqual(['neck', 'shoulder', 'bust', 'underbust', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'upperArm', 'wrist']);
    expect(FS_INDEX.girth.neck).toBe(0);
    expect(FS_INDEX.girth.wrist).toBe(11);
    expect(FS_INDEX.sigma.neck).toBe(12);
    expect(FS_INDEX.aspect.wrist).toBe(35);
    expect(FS_INDEX.length.stature).toBe(36);
    expect(FS_INDEX.length.footLength).toBe(47);
    expect(FS_INDEX.posture.shoulderSlopeDeg).toBe(48);
    expect(FS_INDEX.posture.limbToTorso).toBe(55);
    expect(FS_INDEX.shape.annyHeight).toBe(56);
    expect(FS_INDEX.shape.pca3).toBe(65);
    expect(FS_INDEX.demographics.weightKg).toBe(66);
    expect(FS_INDEX.demographics.bodyFatProxy).toBe(71);
    expect(FS_INDEX.prefs.easeBust).toBe(72);
    expect(FS_INDEX.prefs.snugLoose).toBe(77);
  });

  it('every slot 0..79 is covered exactly once', () => {
    const slots = [
      ...Object.values(FS_INDEX.girth),
      ...Object.values(FS_INDEX.sigma),
      ...Object.values(FS_INDEX.aspect),
      ...Object.values(FS_INDEX.length),
      ...Object.values(FS_INDEX.posture),
      ...Object.values(FS_INDEX.shape),
      ...Object.values(FS_INDEX.demographics),
      ...Object.values(FS_INDEX.prefs),
      FS_INDEX.VERSION,
      FS_INDEX.QUALITY,
    ].sort((a, b) => a - b);
    expect(slots).toEqual(Array.from({ length: 80 }, (_, i) => i));
    expect(FS_LENGTH_KEYS).toHaveLength(12);
    expect(FS_POSTURE_KEYS).toHaveLength(8);
    expect(FS_SHAPE_KEYS).toHaveLength(10);
    expect(FS_DEMOGRAPHIC_KEYS).toHaveLength(6);
    expect(FS_PREF_KEYS).toHaveLength(6);
    expect(FS_AGE_BUCKETS).toHaveLength(8);
  });

  it('never carries face, skin or hair values', () => {
    const keys = [...FS_GIRTH_LEVELS, ...FS_LENGTH_KEYS, ...FS_POSTURE_KEYS, ...FS_SHAPE_KEYS, ...FS_DEMOGRAPHIC_KEYS, ...FS_PREF_KEYS].join(' ');
    expect(keys).not.toMatch(/skin|face|hair|iris|eye|lab|ita|monk|season/i);
  });
});

describe('encode / decode', () => {
  it('encodes a full profile into 80 numbers with version and quality in the last slots', () => {
    const v = encodeFitSignature(FULL);
    expect(v).toHaveLength(80);
    expect(v[78]).toBe(FS_VERSION);
    expect(v[79]).toBe(0.83);
    expect(v[FS_INDEX.girth.bust]).toBe(88);
    expect(v[FS_INDEX.sigma.bust]).toBe(1.75);
    expect(v[FS_INDEX.length.stature]).toBe(168);
    expect(v[FS_INDEX.demographics.sizingSexF]).toBe(1);
    expect(v[FS_INDEX.prefs.snugLoose]).toBe(-0.25);
    expect(FitSignatureVectorSchema.safeParse(v).success).toBe(true);
  });

  it('round-trips a profile that is already on the quantisation grid', () => {
    const v = encodeFitSignature(FULL);
    const back = decodeFitSignature(v);
    expect(back).toEqual(FULL);
    expect(encodeFitSignature(back)).toEqual(v);
    expect(FitSignatureProfileSchema.safeParse(back).success).toBe(true);
  });

  it('quantises girths to 0.5 cm, sigmas to 0.25 cm and lengths to 1 cm', () => {
    const v = encodeFitSignature({
      girths: { bust: 88.26, waist: 70.74 },
      sigmas: { bust: 1.62, waist: 2.9 },
      lengths: { stature: 167.5, inseam: 77.49 },
    });
    expect(v[FS_INDEX.girth.bust]).toBe(88.5);
    expect(v[FS_INDEX.girth.waist]).toBe(70.5);
    expect(v[FS_INDEX.sigma.bust]).toBe(1.5);
    expect(v[FS_INDEX.sigma.waist]).toBe(3);
    expect(v[FS_INDEX.length.stature]).toBe(168);
    expect(v[FS_INDEX.length.inseam]).toBe(77);
    expect(quantStepForIndex(0)).toBe(0.5);
    expect(quantStepForIndex(12)).toBe(0.25);
    expect(quantStepForIndex(36)).toBe(1);
    expect(quantStepForIndex(78)).toBe(1);
    expect(quantStepForIndex(79)).toBe(0.01);
  });

  it('quantiseFitSignature is idempotent and equals encode(decode(v))', () => {
    const raw = Array.from({ length: 80 }, (_, i) => (i === 78 ? 1 : Math.sin(i) * 50 + 60));
    const q1 = quantiseFitSignature(raw);
    const q2 = quantiseFitSignature(q1);
    expect(q2).toEqual(q1);
    // decode drops zeros; raw has no exact zeros, so the structured round-trip must agree.
    expect(encodeFitSignature(decodeFitSignature(q1))).toEqual(q1);
  });

  it('treats missing values as 0 and drops zeros on decode', () => {
    const v = encodeFitSignature({ girths: { bust: 88 } });
    expect(v.filter((x) => x !== 0)).toHaveLength(2); // bust + version
    const back = decodeFitSignature(v);
    expect(back.girths).toEqual({ bust: 88 });
    expect(back.sigmas).toEqual({});
    expect(back.quality).toBe(0);
    expect(decodeFitSignature(encodeFitSignature({}))).toEqual(emptyFitSignatureProfile());
  });

  it('clamps quality to 0..1 and rejects wrong length / non-finite / other versions', () => {
    expect(encodeFitSignature({ quality: 1.7 })[79]).toBe(1);
    expect(() => decodeFitSignature(new Array(79).fill(0))).toThrow(/80/);
    const nan = encodeFitSignature({});
    nan[3] = Number.NaN;
    expect(() => decodeFitSignature(nan)).toThrow(/finite/);
    const v2 = encodeFitSignature({});
    v2[78] = 2;
    expect(() => decodeFitSignature(v2)).toThrow(/version/);
  });

  it('decodes a Float32Array as well as a plain array', () => {
    const v = encodeFitSignature(FULL);
    const f = toFloat32(v);
    expect(f).toBeInstanceOf(Float32Array);
    expect(f.length).toBe(80);
    expect(decodeFitSignature(f).girths).toEqual(FULL.girths);
    expect(decodeFitSignature(f).sigmas).toEqual(FULL.sigmas);
    expect(decodeFitSignature(f).lengths).toEqual(FULL.lengths);
  });
});

describe('wire schema', () => {
  it('validates PUT /v1/me/signature bodies', () => {
    const wire = toFitSignatureWire(FULL);
    expect(wire.version).toBe(1);
    expect(wire.quality).toBe(0.83);
    expect(FitSignatureWireSchema.safeParse(wire).success).toBe(true);
    expect(FitSignatureWireSchema.safeParse(JSON.parse(JSON.stringify(wire))).success).toBe(true);
  });

  it('rejects a vector whose version or quality slot disagrees with the envelope', () => {
    const wire = toFitSignatureWire(FULL);
    const badVersion = { ...wire, vector: wire.vector.map((x, i) => (i === 78 ? 2 : x)) };
    expect(FitSignatureWireSchema.safeParse(badVersion).success).toBe(false);
    const badQuality = { ...wire, quality: 0.2 };
    expect(FitSignatureWireSchema.safeParse(badQuality).success).toBe(false);
    expect(FitSignatureWireSchema.safeParse({ ...wire, vector: wire.vector.slice(0, 79) }).success).toBe(false);
  });
});

describe('fitSignatureFromBodyProfile', () => {
  const profile: BodyProfile = {
    version: 1,
    measurements: {
      bust: { mean: 88.3, sigma: 1.7, source: 'fused' },
      waist: { mean: 70, sigma: 1.5, source: 'fused' },
      hip: { mean: 96, sigma: 1.25, source: 'fused' },
      shoulder: { mean: 38, sigma: 2, source: 'scan' },
      thigh: { mean: 56, sigma: 3.5, source: 'scan' },
      height: { mean: 168, sigma: 1, source: 'manual' },
      weight: { mean: 62, sigma: 1, source: 'manual' },
      footEu: { mean: 38, sigma: 0.5, source: 'manual' },
    },
    captureQuality: 0.8,
  };

  it('maps girths, sigmas, stature, weight, BMI and foot length; shoulder goes to biacromial breadth', () => {
    const sig = fitSignatureFromBodyProfile(profile);
    expect(sig.girths).toEqual({ bust: 88.3, waist: 70, hip: 96, thigh: 56 });
    expect(sig.sigmas).toEqual({ bust: 1.7, waist: 1.5, hip: 1.25, thigh: 3.5 });
    expect(sig.lengths.biacromialBreadth).toBe(38);
    expect(sig.lengths.stature).toBe(168);
    expect(sig.lengths.footLength).toBeCloseTo(footLengthFromEu(38), 6);
    expect(sig.demographics.weightKg).toBe(62);
    expect(sig.demographics.bmi).toBeCloseTo(21.97, 2);
    expect(sig.girths.shoulder).toBeUndefined();
    expect(sig.quality).toBe(0.8);
    const v = encodeFitSignature(sig);
    expect(v[FS_INDEX.girth.bust]).toBe(88.5);
    expect(v[FS_INDEX.length.footLength]).toBe(24);
  });

  it('merges extras from the scan (posture, aspect, prefs) without losing measurements', () => {
    const sig = fitSignatureFromBodyProfile(profile, { posture: { shoulderSlopeDeg: 20 }, prefs: { snugLoose: 0.5 }, quality: 0.9 });
    expect(sig.posture).toEqual({ shoulderSlopeDeg: 20 });
    expect(sig.prefs).toEqual({ snugLoose: 0.5 });
    expect(sig.girths.bust).toBe(88.3);
    expect(sig.quality).toBe(0.9);
  });
});
