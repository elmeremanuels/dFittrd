/**
 * Build the FitSignature v1 (the only body data that syncs, DECISIONS.md D3) from the fused
 * BodyProfile and the scan's per-level girths/aspects/lengths/posture. Encoding, quantisation and
 * the wire shape come from `@paskamer/schema`; this module only maps our data into it.
 *
 * Invariant (asserted here and in tests): no face, skin, hair or colour value is ever encoded.
 */
import {
  FS_AGE_BUCKETS,
  FS_GIRTH_LEVELS,
  FS_LENGTH_KEYS,
  FS_POSTURE_KEYS,
  encodeFitSignature,
  fitSignatureFromBodyProfile,
  toFitSignatureWire,
  type BodyProfile,
  type FitSignatureProfile,
  type FitSignatureWire,
} from '@paskamer/schema';
import { bmi } from './prior';
import type { ScanMeasurements, Sex } from './types';

export interface SignatureExtras {
  sex?: Sex | undefined;
  ageYears?: number | undefined;
  prefs?: Partial<FitSignatureProfile['prefs']> | undefined;
}

export interface BuiltSignature {
  profile: FitSignatureProfile;
  vector: number[];
  wire: FitSignatureWire;
}

export function ageBucket(ageYears: number | undefined): number {
  if (ageYears === undefined || !Number.isFinite(ageYears)) return 0;
  const label = ageYears < 18 ? '<18' : ageYears < 25 ? '18-24' : ageYears < 35 ? '25-34' : ageYears < 45 ? '35-44' : ageYears < 55 ? '45-54' : ageYears < 65 ? '55-64' : '65+';
  return FS_AGE_BUCKETS.indexOf(label);
}

export function buildFitSignature(profile: BodyProfile, scan?: ScanMeasurements | null, extras: SignatureExtras = {}): BuiltSignature {
  const girths: FitSignatureProfile['girths'] = {};
  const sigmas: FitSignatureProfile['sigmas'] = {};
  const aspect: FitSignatureProfile['aspect'] = {};
  const lengths: FitSignatureProfile['lengths'] = {};
  const posture: FitSignatureProfile['posture'] = {};
  if (scan) {
    for (const level of FS_GIRTH_LEVELS) {
      const g = scan.girths[level];
      if (!g || !(g.mean > 0)) continue;
      girths[level] = g.mean;
      if (g.sigma > 0) sigmas[level] = g.sigma;
      if (g.aspect !== undefined && g.aspect > 0) aspect[level] = g.aspect;
    }
    for (const k of FS_LENGTH_KEYS) {
      const v = scan.lengths[k];
      if (v !== undefined && v > 0) lengths[k] = v;
    }
    for (const k of FS_POSTURE_KEYS) {
      const v = scan.posture[k];
      if (v !== undefined && Number.isFinite(v)) posture[k] = v;
    }
  }
  const demographics: FitSignatureProfile['demographics'] = {};
  const h = profile.measurements.height?.mean;
  const w = profile.measurements.weight?.mean;
  if (h && w) demographics.bmi = Math.round(bmi(h, w) * 10) / 10;
  if (extras.sex === 'female') demographics.sizingSexF = 1;
  if (extras.sex === 'male') demographics.sizingSexM = 1;
  const ab = ageBucket(extras.ageYears);
  if (ab > 0) demographics.ageBucket = ab;

  // The fused profile (scan ⊕ manual) wins over the raw scan for the fit points.
  const sig = fitSignatureFromBodyProfile(profile, {
    girths,
    sigmas,
    aspect,
    lengths,
    posture,
    demographics,
    prefs: extras.prefs ?? {},
  });
  // fitSignatureFromBodyProfile merges extras over the base; re-apply the fused fit points on top.
  for (const key of ['bust', 'waist', 'hip', 'thigh'] as const) {
    const m = profile.measurements[key];
    if (m && m.mean > 0) {
      sig.girths[key] = m.mean;
      if (m.sigma > 0) sig.sigmas[key] = m.sigma;
    }
  }
  assertNoColourData(sig);
  const vector = encodeFitSignature(sig);
  const wire = toFitSignatureWire(sig);
  return { profile: sig, vector, wire };
}

const FORBIDDEN = /skin|face|hair|colour|color|monk|season|lab|hex|ita/i;

/** Guard: the signature profile must not carry any colour/identity key (hard rule D3). */
export function assertNoColourData(sig: FitSignatureProfile): void {
  const walk = (obj: unknown, path: string): void => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      if (FORBIDDEN.test(k)) throw new Error(`fit signature must not contain colour/identity data (${path}${k})`);
      walk((obj as Record<string, unknown>)[k], `${path}${k}.`);
    }
  };
  walk(sig, '');
}
