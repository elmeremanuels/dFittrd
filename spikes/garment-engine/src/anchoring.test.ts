import { bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { applyCalibration, calibrate, chartAgreement, measureGarment, measureRing, ringGirths } from './anchoring';
import { DEFAULT_DISTORTION } from './bundle';
import { assignChains, distortGarment, generateGarment } from './garment';
import { SPIKE_PRODUCT_IDS, chartRow, garmentChart, garmentSpec, spikeProduct } from './product';

const m = buildMannequin(bodyShape('M'));

function reconstruction(id: (typeof SPIKE_PRODUCT_IDS)[number]) {
  const payload = spikeProduct(id);
  const spec = garmentSpec(payload);
  const truth = generateGarment(m, spec);
  const recon = distortGarment(m, truth, ringGirths(measureGarment(m, truth, spec.category)), DEFAULT_DISTORTION);
  const chains = assignChains(m, recon);
  const raw = measureGarment(m, recon, spec.category, chains);
  return { spec, recon, chains, raw, chart: chartRow(garmentChart(payload), 'M').rings };
}

describe('stage 5 — anchoring', () => {
  it('measures the mannequin itself with zero offset', () => {
    const body = buildMannequinMesh(m);
    for (const ring of m.rings) {
      const r = measureRing(body, ring)!;
      expect(Math.abs(r.circumferenceCm / ring.circumferenceCm - 1)).toBeLessThan(0.01);
      expect(Math.abs(r.offsetCm!.mean)).toBeLessThan(0.1);
      expect(r.loop).toHaveLength(32);
    }
  });

  it('keeps the lengths consistent: shoulder_to_waist + waist_to_hem = shoulder_to_hem', () => {
    const { raw } = reconstruction('aalter-studio-2');
    const L = raw.lengths;
    expect(L.shoulder_to_waist!.fromMannequin).toBe(true);
    expect(L.shoulder_to_waist!.lengthCm + L.waist_to_hem!.lengthCm).toBeCloseTo(L.shoulder_to_hem!.lengthCm, 6);
  });

  it('marks skirt loops that enclose both legs instead of computing a body offset', () => {
    const { raw } = reconstruction('aalter-studio-2');
    expect(raw.rings.thigh!.spansBothLegs).toBe(true);
    expect(raw.rings.thigh!.offsetCm).toBeNull();
    expect(raw.rings.chest!.spansBothLegs).toBe(false);
  });
});

describe.each(SPIKE_PRODUCT_IDS)('stage 5 — calibration of %s', (id) => {
  const { spec, recon, chains, raw, chart } = reconstruction(id);
  const measured = ringGirths(raw);
  const cal = calibrate({ measured, chart });
  const calibrated = ringGirths(measureGarment(m, applyCalibration(m, recon, measured, cal, chains), spec.category, chains));

  it('starts outside the ±2 cm tolerance (the simulated reconstruction error is real)', () => {
    expect(chartAgreement(measured, chart, Object.keys(chart) as never[]).pass).toBe(false);
    expect(cal.residualBefore.maxAbsCm).toBeGreaterThan(2);
  });

  it('agrees with the chart within ±2 cm at every critical ring after calibration', () => {
    const agreement = chartAgreement(calibrated, chart, Object.keys(chart) as never[]);
    expect(agreement.pass).toBe(true);
    expect(agreement.maxAbsCm).toBeLessThan(0.05);
  });

  it('gives rings without a chart value the global scale', () => {
    for (const [ring, source] of Object.entries(cal.sources)) {
      if (source !== 'global') continue;
      expect(Math.abs(calibrated[ring as keyof typeof calibrated]! - measured[ring as keyof typeof measured]! * cal.globalScale), ring).toBeLessThan(0.5);
    }
  });

  it('reports the residual after the global scale as the QA metric', () => {
    expect(cal.residualAfterGlobal.maxAbsCm).toBeLessThanOrEqual(cal.residualBefore.maxAbsCm);
    expect(Number.isFinite(cal.residualAfterGlobal.rmsCm)).toBe(true);
  });

  it('lets the merchant sample measurements win over the chart', () => {
    const sample = { chest: chart.chest! + 1 };
    const withSample = calibrate({ measured, chart, sample });
    expect(withSample.sources.chest).toBe('sample');
    const c = ringGirths(measureGarment(m, applyCalibration(m, recon, measured, withSample, chains), spec.category, chains));
    expect(c.chest!).toBeCloseTo(chart.chest! + 1, 1);
    expect(chartAgreement(c, chart, ['chest']).pass).toBe(true);
  });
});

describe('calibrate()', () => {
  it('recovers a pure global scale exactly and needs no per-ring correction', () => {
    const cal = calibrate({ measured: { chest: 110, waist: 88, hip: 115.5 }, chart: { chest: 100, waist: 80, hip: 105 } });
    expect(cal.globalScale).toBeCloseTo(1 / 1.1, 12);
    expect(cal.residualAfterGlobal.maxAbsCm).toBeLessThan(1e-9);
    for (const k of Object.values(cal.ringCorrections)) expect(k).toBeCloseTo(1, 12);
  });

  it('is the least-squares scale when rings disagree', () => {
    const cal = calibrate({ measured: { chest: 100, waist: 80 }, chart: { chest: 102, waist: 80 } });
    expect(cal.globalScale).toBeCloseTo((100 * 102 + 80 * 80) / (100 * 100 + 80 * 80), 12);
  });
});
