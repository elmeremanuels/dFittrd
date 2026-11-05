/**
 * Body types shared by the capture pipeline (apps/web/src/features/capture) and
 * `@curtain/fit-engine`.
 *
 * - `BodyProfile` is the rich on-device record (mean + sigma + source per measurement). It is
 *   stored in IndexedDB and NEVER synced (docs/DECISIONS.md D3). Only the fit signature leaves
 *   the device.
 * - `UserBody` is the simpler shape the fit engine reads (docs/research/fit-engine-spec.md).
 */
import { z } from 'zod';
import { FIT_POINTS, FitPointSchema, type FitPoint } from './garment';

/** Alias of `FitPoint` under the name the fit-engine spec uses. */
export type Point = FitPoint;

export const MEASUREMENT_SOURCES = ['scan', 'manual', 'fused', 'prior'] as const;
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const BODY_MEASUREMENT_KEYS = [...FIT_POINTS, 'footLengthCm', 'footEu', 'height', 'weight'] as const;
export type BodyMeasurementKey = (typeof BODY_MEASUREMENT_KEYS)[number];

export const MeasurementSchema = z.object({
  /** cm for girths/lengths, EU size for footEu, kg for weight */
  mean: z.number().finite(),
  /** Standard deviation in the same unit. 0 means "exact" (never produced by the scan). */
  sigma: z.number().min(0),
  source: z.enum(MEASUREMENT_SOURCES),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

export const BodyMeasurementsSchema = z.partialRecord(z.enum(BODY_MEASUREMENT_KEYS), MeasurementSchema);
export type BodyMeasurements = Partial<Record<BodyMeasurementKey, Measurement>>;

export const MANUAL_METHODS = ['tape', 'memory', 'guess'] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];

/** Manual-entry sigma per method (body-scan.md §manual step): tape 1.5, memory 2.5, guess 4 cm. */
export const MANUAL_SIGMA_CM: Record<ManualMethod, number> = { tape: 1.5, memory: 2.5, guess: 4 };

export const SizeHistoryEntrySchema = z.object({
  brand: z.string().min(1),
  size: z.string().min(1),
  kept: z.boolean(),
});
export type SizeHistoryEntry = z.infer<typeof SizeHistoryEntrySchema>;

export const BodyProfileSchema = z.object({
  version: z.literal(1),
  measurements: BodyMeasurementsSchema,
  /** Keys where scan and manual disagreed beyond 2·sqrt(σs² + σu²) and the user has not remeasured. */
  conflicts: z.array(z.enum(BODY_MEASUREMENT_KEYS)).optional(),
  manualMethod: z.enum(MANUAL_METHODS).optional(),
  /** Global capture quality 0..1 (segmenter clothes/skin ratio, pose gating, lighting). */
  captureQuality: z.number().min(0).max(1).optional(),
  /** Posture descriptors from the scan; feeds fit-signature indices 48–55. */
  posture: z.partialRecord(z.string(), z.number()).optional(),
  history: z.array(SizeHistoryEntrySchema).optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});
export type BodyProfile = z.infer<typeof BodyProfileSchema>;

// ---------------------------------------------------------------------------
// UserBody — exactly the fit-engine input (fit-engine-spec.md §Types)
// ---------------------------------------------------------------------------

export const USER_BODY_MEASUREMENT_KEYS = [...FIT_POINTS, 'footLengthCm', 'footEu'] as const;
export type UserBodyMeasurementKey = (typeof USER_BODY_MEASUREMENT_KEYS)[number];

export const UserBodySchema = z.object({
  measurements: z.partialRecord(z.enum(USER_BODY_MEASUREMENT_KEYS), z.number().finite()),
  /** 0..1 per point; fit engine default 0.8 (scan-only 0.6, scan+manual 0.95 per handoff §2.1C). */
  confidence: z.partialRecord(FitPointSchema, z.number().min(0).max(1)).optional(),
  history: z.array(SizeHistoryEntrySchema).optional(),
});
export type UserBody = z.infer<typeof UserBodySchema>;

/**
 * Confidence shown to the user and passed to the fit engine, from the fused sigma
 * (body-scan.md): clamp(0.95 − 0.26·(σ − 1.66), 0.2, 0.98). Reproduces the handoff targets
 * with σ_scan = 3 (→ 0.60) and σ_scan+tape fused ≈ 1.66 (→ 0.95). Rounded to 3 dp.
 */
export function confidenceFromSigma(sigma: number): number {
  if (!Number.isFinite(sigma)) return 0.2;
  const c = 0.95 - 0.26 * (sigma - 1.66);
  return Math.round(Math.max(0.2, Math.min(0.98, c)) * 1000) / 1000;
}

/**
 * Inverse-variance fusion of independent estimates (body-scan.md §manual step).
 * Returns the fused mean and sigma; entries with sigma 0 are treated as exact and win.
 */
export function fuseMeasurements(
  parts: ReadonlyArray<{ mean: number; sigma: number }>,
): { mean: number; sigma: number } | null {
  const valid = parts.filter((p) => Number.isFinite(p.mean) && Number.isFinite(p.sigma) && p.sigma >= 0);
  if (valid.length === 0) return null;
  const exact = valid.find((p) => p.sigma === 0);
  if (exact) return { mean: exact.mean, sigma: 0 };
  let num = 0;
  let den = 0;
  for (const p of valid) {
    const w = 1 / (p.sigma * p.sigma);
    num += p.mean * w;
    den += w;
  }
  return { mean: num / den, sigma: Math.sqrt(1 / den) };
}

/**
 * Agreement test between two estimates: |a − b| ≤ 2·sqrt(σa² + σb²).
 */
export function measurementsAgree(a: Measurement, b: Measurement): boolean {
  return Math.abs(a.mean - b.mean) <= 2 * Math.sqrt(a.sigma * a.sigma + b.sigma * b.sigma);
}

/**
 * Project the rich on-device profile to the fit-engine input.
 * - `measurements` = the mean of every fit point plus footLengthCm / footEu.
 * - A legacy `foot` entry (length in cm) is exposed as `footLengthCm` when that key is absent.
 * - `confidence` = confidenceFromSigma(sigma) per fit point (conflicting points are capped at 0.5
 *   so the engine nudges the user to remeasure).
 * - height / weight are not fit points and are dropped.
 */
export function toUserBody(profile: BodyProfile): UserBody {
  const measurements: UserBody['measurements'] = {};
  const confidence: NonNullable<UserBody['confidence']> = {};
  const conflicts = new Set<BodyMeasurementKey>(profile.conflicts ?? []);

  for (const point of FIT_POINTS) {
    const m = profile.measurements[point];
    if (!m || !Number.isFinite(m.mean) || m.mean <= 0) continue;
    if (point === 'foot') {
      if (profile.measurements.footLengthCm === undefined) measurements.footLengthCm = m.mean;
    } else {
      measurements[point] = m.mean;
    }
    const c = confidenceFromSigma(m.sigma);
    confidence[point] = conflicts.has(point) ? Math.min(c, 0.5) : c;
  }
  const footLen = profile.measurements.footLengthCm;
  if (footLen && footLen.mean > 0) {
    measurements.footLengthCm = footLen.mean;
    const c = confidenceFromSigma(footLen.sigma);
    confidence.foot = conflicts.has('footLengthCm') ? Math.min(c, 0.5) : c;
  }
  const footEu = profile.measurements.footEu;
  if (footEu && footEu.mean > 0) {
    measurements.footEu = footEu.mean;
    if (confidence.foot === undefined) confidence.foot = confidenceFromSigma(footEu.sigma);
  }

  const out: UserBody = { measurements };
  if (Object.keys(confidence).length > 0) out.confidence = confidence;
  if (profile.history && profile.history.length > 0) out.history = profile.history.map((h) => ({ ...h }));
  return out;
}
