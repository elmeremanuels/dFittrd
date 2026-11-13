import { describe, expect, it } from 'vitest';
import { isAnchorBreadth } from '@curtain/anchors';
import { measureGarment, ringGirths } from './anchoring';
import { buildBundle } from './bundle';
import { assignChains, shoulderSeams } from './garment';
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
      expect(['increment', 'hip-delta', 'breadth']).toContain(source);
      const L = grading.sizes.find((s) => s.step === 1)!;
      const key = anchor as keyof typeof L.targets;
      if (source === 'increment') expect(L.targets[key]! - grading.base[key]!).toBeCloseTo(STANDARD_INCREMENTS_CM[key], 6);
    }
  });

  it('carries the chart shoulder width as the breadth shoulder_width, never as the shoulder ring (R1)', () => {
    const W = baseRow.breadths.shoulder_width!;
    expect(W).toBe(id === 'aalter-studio-2' ? 36 + 2 + 1.5 : 50); // body chart M + product ease; garment chart as is
    expect(grading.base.shoulder_width).toBe(W);
    expect(grading.base.shoulder).not.toBe(W); // the ring stays the measured girth (~105 cm)
    expect(grading.morph.breadths).toEqual({ shoulder_width: { ring: 'shoulder', height: grading.morph.heights.shoulder } });
    for (const size of grading.sizes) {
      const row = chart.rows.find((r) => r.size === size.size)!;
      expect(size.sources.shoulder_width).toBe('chart');
      expect(size.targets.shoulder_width! - W).toBeCloseTo(row.breadths.shoulder_width! - W, 6);
      // No shoulder girth column: the ring grades with the width (an estimate, logged).
      expect(size.sources.shoulder).toBe('breadth');
      expect(size.targets.shoulder! / grading.base.shoulder!).toBeCloseTo(size.targets.shoulder_width! / W, 3);
    }
    expect(grading.estimates.shoulder).toBe('breadth');
  });

  it('scales the shoulder line of every size by the shoulder_width ratio (the base width is the mesh width, not the chart width)', () => {
    const shoulderRing = m.rings.find((r) => r.id === 'shoulder')!;
    const halfWidth = (positions: ArrayLike<number>): number => {
      let w = 0;
      for (let i = 0; i < chains.length; i++) if (chains[i] === 0 && Math.abs(positions[3 * i + 1]! - shoulderRing.centre[1]) < 0.01) w = Math.max(w, Math.abs(positions[3 * i]!));
      return w;
    };
    const base = halfWidth(baseMesh.positions);
    expect(base).toBeGreaterThan(0);
    // Known gap (D15): the synthetic yoke is lofted from the mannequin torso, so its base half-width on the
    // ring is the torso's plus clearance (about 21.6 cm for both products), not the chart's width/2
    // (19.75 cm dress, 25 cm tee). The shoulderSeams points are notional chart points, not on the mesh.
    expect(base).toBeGreaterThan(21);
    expect(base).toBeLessThan(22.5);
    expect(Math.abs(base - grading.base.shoulder_width! / 2)).toBeGreaterThan(1.5);
    for (const s of grading.sizes) {
      const graded = halfWidth(applyGrading(m, baseMesh, chains, grading, s.size).positions);
      expect(graded / base, s.size).toBeCloseTo(s.targets.shoulder_width! / grading.base.shoulder_width!, 3);
    }
    expect(shoulderSeams(m, 40)).toEqual([[20, shoulderRing.centre[1], 0], [-20, shoulderRing.centre[1], 0]]);
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
        if (isAnchorBreadth(anchor)) continue; // no seams on a mesh: checked through the shoulder line above
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
