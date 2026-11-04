import { describe, expect, it } from 'vitest';
import { confidenceFromSigma, fuseMeasurements, toUserBody } from '@paskamer/schema';
import { fuseProfile, inflateByDisagreement } from '../fuse';
import type { ScanMeasurements } from '../types';

const scan = (bust = 90, waist = 72, hip = 97): ScanMeasurements => ({
  girths: {
    bust: { mean: bust, sigma: 3, aspect: 0.72 },
    waist: { mean: waist, sigma: 3, aspect: 0.78 },
    hip: { mean: hip, sigma: 2.5, aspect: 0.72 },
    thigh: { mean: 56, sigma: 3.5 },
  },
  lengths: { stature: 168, inseam: 78 },
  posture: { shoulderSlopeDeg: 20, waistToHip: 0.74 },
  quality: 0.8,
  warnings: [],
});

describe('fuseProfile — handoff §2.1C targets', () => {
  it('scan-only → ≈ 60 % confidence (σ_scan = 3 cm)', () => {
    const r = fuseProfile({ scan: scan(), manual: { height: 168 }, now: 1 });
    const bust = r.points.find((p) => p.key === 'bust')!;
    expect(bust.measurement.source).toBe('scan');
    expect(bust.measurement.sigma).toBe(3);
    expect(bust.confidence).toBeCloseTo(0.6, 1);
    expect(Math.round(bust.confidence * 100)).toBe(60);
    expect(r.conflicts).toEqual([]);
    expect(r.profile.captureQuality).toBe(0.8);
    expect(r.profile.posture?.waistToHip).toBe(0.74);
  });

  it('scan + agreeing tape (σ = 2 cm) → 95 %', () => {
    // the research mapping is calibrated on σ_tape = 2: check it directly
    const f = fuseMeasurements([{ mean: 90, sigma: 3 }, { mean: 91, sigma: 2 }])!;
    expect(f.sigma).toBeCloseTo(1.664, 2);
    expect(confidenceFromSigma(f.sigma)).toBeCloseTo(0.95, 2);
  });

  it('scan + agreeing manual entry (tape 1.5 / memory 2.5 / guess 4) fuses by inverse variance', () => {
    const tape = fuseProfile({ scan: scan(), manual: { height: 168, bust: 92 }, manualMethod: 'tape' });
    const bust = tape.points.find((p) => p.key === 'bust')!;
    expect(bust.measurement.source).toBe('fused');
    expect(bust.measurement.sigma).toBeCloseTo(1.34, 1);
    expect(bust.confidence).toBeGreaterThanOrEqual(0.95);
    // the fused mean sits between scan and manual, nearer the more precise tape
    expect(bust.measurement.mean).toBeGreaterThan(90);
    expect(bust.measurement.mean).toBeLessThan(92);
    expect(bust.measurement.mean - 90).toBeGreaterThan(92 - bust.measurement.mean);

    const memory = fuseProfile({ scan: scan(), manual: { height: 168, bust: 92 }, manualMethod: 'memory' });
    const guess = fuseProfile({ scan: scan(), manual: { height: 168, bust: 92 }, manualMethod: 'guess' });
    const cM = memory.points.find((p) => p.key === 'bust')!.confidence;
    const cG = guess.points.find((p) => p.key === 'bust')!.confidence;
    expect(cM).toBeGreaterThan(cG);
    expect(cM).toBeGreaterThan(0.85);
    expect(cG).toBeGreaterThan(0.6);
    expect(tape.conflicts).toEqual([]);
  });

  it('conflict (|s − u| > 2σ) flags the key, keeps the scan with inflated σ and low confidence', () => {
    const r = fuseProfile({ scan: scan(90), manual: { height: 168, bust: 100 }, manualMethod: 'tape' });
    const bust = r.points.find((p) => p.key === 'bust')!;
    expect(r.conflicts).toEqual(['bust']);
    expect(r.profile.conflicts).toEqual(['bust']);
    expect(bust.conflict).toBe(true);
    expect(bust.disagreementCm).toBe(10);
    expect(bust.measurement.source).toBe('scan');
    expect(bust.measurement.sigma).toBeCloseTo(Math.sqrt(9 + 25), 2);
    expect(bust.confidence).toBeLessThanOrEqual(0.5);
    // the engine input caps conflicting points at 0.5
    const ub = toUserBody(r.profile);
    expect(ub.confidence?.bust).toBeLessThanOrEqual(0.5);
    expect(ub.measurements.bust).toBe(90);
  });

  it('a remeasure that agrees resolves the conflict; one that still disagrees keeps the inflated scan without the flag', () => {
    const agree = fuseProfile({ scan: scan(90), manual: { height: 168, bust: { value: 91, method: 'tape' } }, manualMethod: 'memory', remeasured: ['bust'] });
    expect(agree.conflicts).toEqual([]);
    expect(agree.points.find((p) => p.key === 'bust')!.measurement.source).toBe('fused');

    const still = fuseProfile({ scan: scan(90), manual: { height: 168, bust: { value: 100, method: 'tape' } }, remeasured: ['bust'] });
    expect(still.conflicts).toEqual([]);
    expect(still.profile.conflicts).toBeUndefined();
    const b = still.points.find((p) => p.key === 'bust')!;
    expect(b.measurement.source).toBe('scan');
    expect(b.measurement.sigma).toBeGreaterThan(5);
  });

  it('manual-only uses the method sigma; height/weight/foot have fixed sigmas', () => {
    const r = fuseProfile({ scan: null, manual: { height: 170, weight: 65, waist: 74, footEu: 39 }, manualMethod: 'guess', sex: 'female' });
    const by = Object.fromEntries(r.points.map((p) => [p.key, p]));
    expect(by.waist!.measurement).toEqual({ mean: 74, sigma: 4, source: 'manual' });
    expect(by.height!.measurement.sigma).toBe(1);
    expect(by.weight!.measurement.sigma).toBe(1);
    expect(by.footEu!.measurement.sigma).toBe(0.5);
    // bust/hip/thigh were not entered → population prior from height/weight/sex
    expect(by.bust!.measurement.source).toBe('prior');
    expect(by.hip!.measurement.source).toBe('prior');
    expect(by.bust!.measurement.sigma).toBeGreaterThan(2);
    expect(by.bust!.confidence).toBeLessThan(0.7);
    expect(r.profile.manualMethod).toBe('guess');
  });

  it('no height/weight → no prior; empty input → empty profile', () => {
    const r = fuseProfile({ scan: null, manual: { waist: 74 } });
    expect(r.points.map((p) => p.key)).toEqual(['waist']);
    const empty = fuseProfile({});
    expect(empty.points).toEqual([]);
    expect(empty.profile.measurements).toEqual({});
    expect(empty.profile.version).toBe(1);
  });

  it('carries createdAt and history from the previous profile', () => {
    const prev = { version: 1 as const, measurements: {}, createdAt: 5, history: [{ brand: 'X', size: 'M', kept: true }] };
    const r = fuseProfile({ manual: { height: 170 }, previous: prev, now: 9 });
    expect(r.profile.createdAt).toBe(5);
    expect(r.profile.updatedAt).toBe(9);
    expect(r.profile.history).toEqual(prev.history);
  });

  it('inflateByDisagreement', () => {
    const m = inflateByDisagreement({ mean: 90, sigma: 3, source: 'scan' }, { mean: 98, sigma: 1.5, source: 'manual' });
    expect(m.sigma).toBe(5);
    expect(m.mean).toBe(90);
  });
});
