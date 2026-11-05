import { describe, expect, it } from 'vitest';
import { measureGarment, ringGirths } from './anchoring';
import { buildBundle } from './bundle';
import { assignChains } from './garment';
import { STANDARD_INCREMENTS_CM, applyGrading, gradeGarment } from './grading';
import { SPIKE_PRODUCT_IDS, garmentChart, spikeProduct } from './product';

describe.each(SPIKE_PRODUCT_IDS)('stage 6 — grading of %s', (id) => {
  const bundle = buildBundle(id, { skipSeparation: true });
  const { grading, mannequin: m, baseMesh, measurements } = bundle;
  const chart = garmentChart(spikeProduct(id));
  const baseRow = chart.rows.find((r) => r.size === 'M')!;
  const chains = assignChains(m, baseMesh);
  const category = id === 'aalter-studio-2' ? 'dress' : 'top';

  it('has one entry per chart size, the base size equal to the calibrated base', () => {
    expect(grading.sizes.map((s) => s.size)).toEqual(chart.rows.map((r) => r.size));
    const base = grading.sizes.find((s) => s.size === 'M')!;
    expect(base.step).toBe(0);
    expect(base.targets).toEqual(grading.base);
  });

  it('targets follow the chart deltas exactly at every chart ring', () => {
    for (const size of grading.sizes) {
      const row = chart.rows.find((r) => r.size === size.size)!;
      for (const [ring, cm] of Object.entries(row.rings)) {
        const key = ring as keyof typeof size.targets;
        expect(size.sources[key]).toBe('chart');
        expect(size.targets[key]! - grading.base[key]!).toBeCloseTo(cm - baseRow.rings[ring as keyof typeof baseRow.rings]!, 6);
      }
    }
  });

  it('uses standard increments (logged as estimates) where the chart has no column', () => {
    for (const [anchor, source] of Object.entries(grading.estimates)) {
      expect(['increment', 'hip-delta']).toContain(source);
      const L = grading.sizes.find((s) => s.step === 1)!;
      const key = anchor as keyof typeof L.targets;
      if (source === 'increment') expect(L.targets[key]! - grading.base[key]!).toBeCloseTo(STANDARD_INCREMENTS_CM[key], 6);
    }
  });

  it('stores only per-anchor targets per size (a few dozen numbers)', () => {
    for (const s of grading.sizes) expect(Object.keys(s.targets).length).toBeLessThanOrEqual(18);
    expect(JSON.stringify(grading).length).toBeLessThan(20000);
  });

  it('morphs the base mesh to every size within 0.3 cm of the targets at the chart rings and 1 cm elsewhere', () => {
    for (const s of grading.sizes) {
      const meas = measureGarment(m, applyGrading(m, baseMesh, chains, grading, s.size), category, chains);
      const girths = ringGirths(meas);
      for (const [anchor, target] of Object.entries(s.targets)) {
        const key = anchor as keyof typeof girths;
        const got = girths[key] ?? meas.lengths[anchor as keyof typeof meas.lengths]?.lengthCm;
        expect(got, `${s.size} ${anchor}`).toBeDefined();
        const tol = s.sources[anchor as keyof typeof s.sources] === 'chart' ? 0.3 : 1;
        expect(Math.abs(got! - target!), `${s.size} ${anchor}`).toBeLessThan(tol);
      }
    }
  });

  it('makes a smaller size smaller and a larger size larger at the chest', () => {
    const chest = (size: string) => ringGirths(measureGarment(m, applyGrading(m, baseMesh, chains, grading, size), category, chains)).chest!;
    expect(chest('S')).toBeLessThan(measurements.rings.chest!.circumferenceCm);
    expect(chest('L')).toBeGreaterThan(measurements.rings.chest!.circumferenceCm);
  });

  it('refuses an unknown size', () => {
    expect(() => applyGrading(m, baseMesh, chains, grading, 'XXXL')).toThrow(/not graded/);
  });
});

describe('grading guards', () => {
  it('throws when the base size is not in the chart', () => {
    const b = buildBundle('monochrome-03', { skipSeparation: true });
    expect(() => gradeGarment(b.mannequin, garmentChart(spikeProduct('monochrome-03')), '3XL', b.measurements)).toThrow(/base size/);
  });

  it('throws on duplicate size labels (finding #2)', () => {
    const b = buildBundle('monochrome-03', { skipSeparation: true });
    const chart = garmentChart(spikeProduct('monochrome-03'));
    const dup = { ...chart, rows: [...chart.rows, { ...chart.rows[0]!, size: 'xs ' }] };
    expect(() => gradeGarment(b.mannequin, dup, 'M', b.measurements)).toThrow(/Duplicate size label/);
  });
});
