/**
 * Population prior for chest/bust, waist, hip and thigh from height, weight and sizing sex.
 *
 * Bartol et al. 2022 (Sensors 22(5):1885, "Linear Regression vs. Deep Learning: A Simple Yet
 * Effective Baseline for Human Body Measurement") fit sex-specific linear models with height, weight
 * and an interaction term on ANSUR and report chest 29.1 / waist 37.9 / hip 21.6 mm MAE (female chest
 * 34.0, waist 39.4, hip 22.3 mm). The coefficients below are NOT the published ones: they are
 * approximate, anchored on population means (female 165 cm / 62 kg → 90/72/97, male 178 cm / 78 kg →
 * 98/86/98) with weight and height slopes in the same range as the published fits. σ is taken from
 * the published residuals (≈ 2.2–3.9 cm, documented as ≈ 3.5 cm in DECISIONS.md D5). Replace with
 * fitted coefficients once the consented pilot data exist.
 */
import type { Level, Sex } from './types';

export type PriorLevel = Extract<Level, 'bust' | 'waist' | 'hip' | 'thigh'>;
export const PRIOR_LEVELS: readonly PriorLevel[] = ['bust', 'waist', 'hip', 'thigh'] as const;

interface Coef {
  /** value at the anchor (cm) */
  base: number;
  /** anchor height (cm) and weight (kg) */
  h0: number;
  w0: number;
  /** cm per kg */
  kw: number;
  /** cm per cm of height */
  kh: number;
  /** interaction cm per (kg·cm)/1000 */
  kwh: number;
  sigma: number;
}

export const PRIOR_COEFFICIENTS: Record<Exclude<Sex, 'unspecified'>, Record<PriorLevel, Coef>> = {
  female: {
    bust: { base: 90, h0: 165, w0: 62, kw: 0.5, kh: -0.2, kwh: -0.6, sigma: 3.4 },
    waist: { base: 72, h0: 165, w0: 62, kw: 0.62, kh: -0.3, kwh: -0.8, sigma: 3.9 },
    hip: { base: 97, h0: 165, w0: 62, kw: 0.55, kh: -0.15, kwh: -0.5, sigma: 2.2 },
    thigh: { base: 57, h0: 165, w0: 62, kw: 0.4, kh: -0.12, kwh: -0.4, sigma: 3.0 },
  },
  male: {
    bust: { base: 98, h0: 178, w0: 78, kw: 0.5, kh: -0.18, kwh: -0.5, sigma: 2.9 },
    waist: { base: 86, h0: 178, w0: 78, kw: 0.66, kh: -0.3, kwh: -0.8, sigma: 3.8 },
    hip: { base: 98, h0: 178, w0: 78, kw: 0.45, kh: -0.12, kwh: -0.4, sigma: 2.2 },
    thigh: { base: 56, h0: 178, w0: 78, kw: 0.38, kh: -0.1, kwh: -0.3, sigma: 3.0 },
  },
};

export const PRIOR_INPUT_RANGE = { height: [120, 230], weight: [30, 250] } as const;

export interface PriorInput {
  heightCm: number;
  weightKg: number;
  sex: Sex;
}

export interface PriorEstimate {
  mean: number;
  sigma: number;
}

function evalCoef(c: Coef, h: number, w: number): number {
  const dh = h - c.h0;
  const dw = w - c.w0;
  return c.base + c.kw * dw + c.kh * dh + (c.kwh * dw * dh) / 1000;
}

/** Returns null when height/weight are outside the plausible range or missing. */
export function populationPrior(input: PriorInput): Partial<Record<PriorLevel, PriorEstimate>> | null {
  const { heightCm: h, weightKg: w, sex } = input;
  if (!Number.isFinite(h) || !Number.isFinite(w)) return null;
  if (h < PRIOR_INPUT_RANGE.height[0] || h > PRIOR_INPUT_RANGE.height[1]) return null;
  if (w < PRIOR_INPUT_RANGE.weight[0] || w > PRIOR_INPUT_RANGE.weight[1]) return null;
  const out: Partial<Record<PriorLevel, PriorEstimate>> = {};
  for (const level of PRIOR_LEVELS) {
    if (sex === 'unspecified') {
      const f = PRIOR_COEFFICIENTS.female[level];
      const m = PRIOR_COEFFICIENTS.male[level];
      const mf = evalCoef(f, h, w);
      const mm = evalCoef(m, h, w);
      // Mixture of the two sex-specific models: mean of means, sigma includes the between-model spread.
      const mean = (mf + mm) / 2;
      const spread = Math.abs(mf - mm) / 2;
      const sigma = Math.sqrt(((f.sigma * f.sigma + m.sigma * m.sigma) / 2) + spread * spread);
      out[level] = { mean: round1(mean), sigma: round2(sigma) };
    } else {
      const c = PRIOR_COEFFICIENTS[sex][level];
      out[level] = { mean: round1(evalCoef(c, h, w)), sigma: c.sigma };
    }
  }
  return out;
}

export function bmi(heightCm: number, weightKg: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
