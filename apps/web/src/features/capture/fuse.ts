/**
 * Fusion of scan, manual and population-prior estimates into a `BodyProfile` (body-scan.md §Manual
 * step and fusion, handoff §2.1C).
 *
 * Per fit point:
 *   - scan + manual agree (|s − u| ≤ 2·sqrt(σs² + σu²)) → inverse-variance fusion, source 'fused'
 *   - they conflict → the scan is kept with σ inflated by the disagreement, the key is listed in
 *     `conflicts` and the UI asks the user to remeasure that one item; after a remeasure that still
 *     disagrees the (inflated) scan stays and the flag is cleared
 *   - scan only → σ_scan (≈ 3 cm → 60 % confidence)
 *   - manual only → σ from the "how did you measure" method (tape 1.5 / memory 2.5 / guess 4)
 *   - neither → population prior (σ ≈ 3.5 cm) when available, else absent
 * Height, weight and foot are manual-only (σ 1 cm / 1 kg / 0.5 EU).
 *
 * Confidence = clamp(0.95 − 0.26·(σ − 1.66), 0.2, 0.98) via `confidenceFromSigma` from the schema.
 */
import {
  MANUAL_SIGMA_CM,
  confidenceFromSigma,
  fuseMeasurements,
  measurementsAgree,
  type BodyMeasurementKey,
  type BodyProfile,
  type ManualMethod,
  type Measurement,
} from '@curtain/schema';
import { populationPrior, type PriorLevel } from './prior';
import type { ScanMeasurements, Sex } from './types';

/** Scan girth level → body measurement key (only the fit points the engine reads are fused). */
export const SCAN_TO_BODY: Partial<Record<keyof ScanMeasurements['girths'], BodyMeasurementKey>> = {
  bust: 'bust',
  waist: 'waist',
  hip: 'hip',
  thigh: 'thigh',
};

export const MANUAL_FIXED_SIGMA: Partial<Record<BodyMeasurementKey, number>> = {
  height: 1.0,
  weight: 1.0,
  footEu: 0.5,
  footLengthCm: 0.5,
};

export interface ManualEntry {
  value: number;
  /** Overrides the profile-wide method (e.g. a remeasure with the tape). */
  method?: ManualMethod;
}

export type ManualEntries = Partial<Record<BodyMeasurementKey, ManualEntry | number>>;

export interface FuseInput {
  scan?: ScanMeasurements | null | undefined;
  manual?: ManualEntries | undefined;
  manualMethod?: ManualMethod | undefined;
  sex?: Sex | undefined;
  /** Keys the user has already remeasured once; a remaining disagreement is no longer a conflict. */
  remeasured?: ReadonlySet<BodyMeasurementKey> | readonly BodyMeasurementKey[] | undefined;
  /** Previous profile to carry `createdAt` and `history` over. */
  previous?: BodyProfile | null | undefined;
  now?: number | undefined;
}

export interface FusedPoint {
  key: BodyMeasurementKey;
  measurement: Measurement;
  confidence: number;
  scan?: Measurement | undefined;
  manual?: Measurement | undefined;
  prior?: Measurement | undefined;
  conflict: boolean;
  /** |scan − manual| in cm when both exist. */
  disagreementCm?: number | undefined;
}

export interface FuseResult {
  profile: BodyProfile;
  points: FusedPoint[];
  conflicts: BodyMeasurementKey[];
}

function manualMeasurement(key: BodyMeasurementKey, entry: ManualEntry | number, method: ManualMethod): Measurement | null {
  const value = typeof entry === 'number' ? entry : entry.value;
  if (!Number.isFinite(value) || value <= 0) return null;
  const m = typeof entry === 'number' ? method : (entry.method ?? method);
  const sigma = MANUAL_FIXED_SIGMA[key] ?? MANUAL_SIGMA_CM[m];
  return { mean: value, sigma, source: 'manual' };
}

/** Inflate the scan sigma by the disagreement: σ' = sqrt(σs² + (|s−u|/2)²). */
export function inflateByDisagreement(scan: Measurement, manual: Measurement): Measurement {
  const d = Math.abs(scan.mean - manual.mean) / 2;
  return { mean: scan.mean, sigma: round2(Math.sqrt(scan.sigma * scan.sigma + d * d)), source: 'scan' };
}

const PRIOR_KEYS: readonly PriorLevel[] = ['bust', 'waist', 'hip', 'thigh'];

export function fuseProfile(input: FuseInput): FuseResult {
  const method = input.manualMethod ?? 'memory';
  const manual = input.manual ?? {};
  const remeasured = new Set<BodyMeasurementKey>(input.remeasured ? [...input.remeasured] : []);
  const points: FusedPoint[] = [];
  const conflicts: BodyMeasurementKey[] = [];
  const measurements: BodyProfile['measurements'] = {};

  const height = manualMeasurement('height', manual.height ?? Number.NaN, method);
  const weight = manualMeasurement('weight', manual.weight ?? Number.NaN, method);
  const prior =
    height && weight ? populationPrior({ heightCm: height.mean, weightKg: weight.mean, sex: input.sex ?? 'unspecified' }) : null;

  const keys = new Set<BodyMeasurementKey>();
  for (const k of Object.keys(manual) as BodyMeasurementKey[]) keys.add(k);
  if (input.scan) for (const level of Object.keys(input.scan.girths) as (keyof ScanMeasurements['girths'])[]) {
    const k = SCAN_TO_BODY[level];
    if (k) keys.add(k);
  }
  for (const k of PRIOR_KEYS) if (prior?.[k]) keys.add(k);

  for (const key of keys) {
    const u = manual[key] !== undefined ? manualMeasurement(key, manual[key] as ManualEntry | number, method) : null;
    let s: Measurement | null = null;
    if (input.scan) {
      const level = (Object.keys(SCAN_TO_BODY) as (keyof ScanMeasurements['girths'])[]).find((l) => SCAN_TO_BODY[l] === key);
      const g = level ? input.scan.girths[level] : undefined;
      if (g && Number.isFinite(g.mean) && g.mean > 0) s = { mean: g.mean, sigma: g.sigma, source: 'scan' };
    }
    const p = (PRIOR_KEYS as readonly string[]).includes(key) && prior ? prior[key as PriorLevel] : undefined;
    const pm: Measurement | undefined = p ? { mean: p.mean, sigma: p.sigma, source: 'prior' } : undefined;

    let out: Measurement | null = null;
    let conflict = false;
    let disagreementCm: number | undefined;
    if (s && u) {
      disagreementCm = round1(Math.abs(s.mean - u.mean));
      if (measurementsAgree(s, u)) {
        const f = fuseMeasurements([s, u]);
        if (f) out = { mean: round1(f.mean), sigma: round2(f.sigma), source: 'fused' };
      } else {
        out = inflateByDisagreement(s, u);
        if (!remeasured.has(key)) {
          conflict = true;
          conflicts.push(key);
        }
      }
    } else if (s) {
      out = { mean: round1(s.mean), sigma: round2(s.sigma), source: 'scan' };
    } else if (u) {
      out = { mean: round1(u.mean), sigma: round2(u.sigma), source: 'manual' };
    } else if (pm) {
      out = { mean: round1(pm.mean), sigma: round2(pm.sigma), source: 'prior' };
    }
    if (!out) continue;
    measurements[key] = out;
    points.push({
      key,
      measurement: out,
      confidence: confidenceFromSigma(out.sigma),
      scan: s ?? undefined,
      manual: u ?? undefined,
      prior: pm,
      conflict,
      disagreementCm,
    });
  }

  const now = input.now ?? Date.now();
  const profile: BodyProfile = {
    version: 1,
    measurements,
    manualMethod: method,
    createdAt: input.previous?.createdAt ?? now,
    updatedAt: now,
  };
  if (conflicts.length > 0) profile.conflicts = conflicts;
  if (input.scan) {
    profile.captureQuality = input.scan.quality;
    const posture: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.scan.posture)) if (v !== undefined && Number.isFinite(v)) posture[k] = v;
    if (Object.keys(posture).length > 0) profile.posture = posture;
  }
  if (input.previous?.history && input.previous.history.length > 0) profile.history = input.previous.history.map((h) => ({ ...h }));

  const order: readonly BodyMeasurementKey[] = ['height', 'weight', 'bust', 'waist', 'hip', 'thigh', 'shoulder', 'inseam', 'footEu', 'footLengthCm', 'foot'];
  points.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { profile, points, conflicts };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
