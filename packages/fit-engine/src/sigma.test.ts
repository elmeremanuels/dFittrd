/** Sigma-aware extension (decision D5): band probabilities under N(gap, σ²). */
import type { BodyProfile } from '@paskamer/schema';
import { describe, expect, it } from 'vitest';
import { bandFor, bandForWithSigma } from './bands';
import { computeFit } from './computeFit';
import { normalCdf } from './math';
import { sigmaFromBodyProfile } from './sigma';
import { REF, WRAP } from './test/fixtures';
import { isPointFit, type BandEdges } from './types';

const edges: BandEdges = { tightLimit: -2.5, easeTarget: 5.7, goodSlack: 2, looseSlack: 4, snugOk: false };

describe('bandForWithSigma', () => {
  it('sigma 0 / missing reproduces bandFor with a one-hot distribution', () => {
    for (const gap of [-10, -3, -2.5, -1, 0, 3, 7.7, 8, 9.7, 10, 14, 20]) {
      const det = bandFor(gap, edges);
      for (const sigma of [0, -1, Number.NaN]) {
        const r = bandForWithSigma(gap, sigma, edges);
        expect(r.band).toBe(det.band);
        expect(r.score).toBe(det.score);
        expect(r.probabilities[det.band]).toBe(1);
        expect(Object.values(r.probabilities).reduce((a, b) => a + b, 0)).toBe(1);
      }
    }
  });
  it('probabilities sum to 1 and the band is the argmax', () => {
    for (const gap of [-6, -2.5, -1, 0, 2, 7.7, 9, 12, 16]) {
      for (const sigma of [0.5, 1.5, 3, 6]) {
        const r = bandForWithSigma(gap, sigma, edges);
        const sum = Object.values(r.probabilities).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 6);
        const max = Math.max(...Object.values(r.probabilities));
        expect(r.probabilities[r.band]).toBe(max);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    }
  });
  it('a gap deep inside the good band is unaffected by a small sigma', () => {
    const r = bandForWithSigma(3, 0.5, edges);
    expect(r.band).toBe('good');
    expect(r.score).toBeCloseTo(1, 4);
  });
  it('a gap exactly on the tight edge splits between tight and snug', () => {
    const r = bandForWithSigma(-2.5, 1, edges);
    expect(r.probabilities.tight).toBeCloseTo(0.5, 3);
    expect(r.probabilities.snug).toBeCloseTo(normalCdf(2.5) - 0.5, 3);
    expect(r.score).toBeCloseTo(0.7 * r.probabilities.snug + 1 * r.probabilities.good + 0.6 * r.probabilities.roomy, 6);
  });
  it('a tight gap with a large sigma scores above 0 (some mass in snug/good)', () => {
    expect(bandFor(-4, edges).score).toBe(0);
    const r = bandForWithSigma(-4, 2, edges);
    expect(r.band).toBe('tight');
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(0.5);
  });
});

describe('computeFit with sigma', () => {
  it('no sigma or sigma 0 is identical to the deterministic result', () => {
    const det = computeFit(WRAP, REF);
    expect(computeFit(WRAP, REF, { sigma: {} })).toEqual(det);
    expect(computeFit(WRAP, REF, { sigma: { bust: 0, waist: 0, hip: 0, shoulder: 0 } })).toEqual(det);
    expect(computeFit(WRAP, REF, { now: 123 })).toEqual(det);
  });
  it('reports sigma and band probabilities on the points that have one', () => {
    const r = computeFit(WRAP, REF, { sigma: { bust: 1.5 } });
    const m = r.perSize.find((s) => s.size === 'M')!;
    const bust = m.points.find((p) => p.point === 'bust')!;
    const waist = m.points.find((p) => p.point === 'waist')!;
    expect(isPointFit(bust) && bust.sigma).toBe(1.5);
    expect(isPointFit(bust) && bust.bandProbabilities?.good).toBeGreaterThan(0.9);
    expect(isPointFit(waist) && waist.sigma).toBeUndefined();
    expect(isPointFit(waist) && waist.bandProbabilities).toBeUndefined();
    expect(r.recommendedSize).toBe('M');
  });
  it('softens the penalty of a borderline tight point', () => {
    const g = { ...WRAP, stretchZones: [] };
    const body = { measurements: { bust: 88, waist: 77, hip: 96, shoulder: 38 } };
    const det = computeFit(g, body);
    const soft = computeFit(g, body, { sigma: { waist: 3 } });
    const detM = det.perSize.find((s) => s.size === 'M')!;
    const softM = soft.perSize.find((s) => s.size === 'M')!;
    const detWaist = detM.points.find((p) => p.point === 'waist')!;
    expect(isPointFit(detWaist) && detWaist.band).toBe('tight');
    expect(softM.score!).toBeGreaterThan(detM.score!);
    expect(softM.score!).toBeLessThanOrEqual(1);
  });
  it('a point whose most probable band is tight still makes the size not wearable', () => {
    const r = computeFit(WRAP, { measurements: { bust: 88, waist: 85, hip: 96, shoulder: 38 } }, { sigma: { waist: 1 } });
    const m = r.perSize.find((s) => s.size === 'M')!;
    expect(m.wearable).toBe(false);
    expect(r.notes).toContain('Tight at the waist — consider sizing up (stretch zone adjusts)');
  });
});

describe('sigmaFromBodyProfile', () => {
  it('maps per-point sigma and converts footEu sigma to cm', () => {
    const profile: BodyProfile = {
      version: 1,
      measurements: {
        bust: { mean: 88, sigma: 1.66, source: 'fused' },
        waist: { mean: 70, sigma: 0, source: 'manual' },
        hip: { mean: 96, sigma: 3, source: 'scan' },
        footEu: { mean: 38, sigma: 0.6, source: 'manual' },
        height: { mean: 170, sigma: 1, source: 'manual' },
      },
    };
    expect(sigmaFromBodyProfile(profile)).toEqual({ bust: 1.66, hip: 3, foot: 0.4 });
  });
  it('prefers footLengthCm sigma over footEu', () => {
    const profile: BodyProfile = {
      version: 1,
      measurements: {
        footLengthCm: { mean: 24.6, sigma: 0.5, source: 'scan' },
        footEu: { mean: 38, sigma: 0.6, source: 'manual' },
      },
    };
    expect(sigmaFromBodyProfile(profile)).toEqual({ foot: 0.5 });
  });
});
