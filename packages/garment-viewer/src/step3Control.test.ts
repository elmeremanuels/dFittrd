/**
 * Step-3 control (docs/research/shortcut-to-step3.md §4, days 1-2): the cling switch, girth loops at the anchor rings
 * and the stretch-waistband model. All off by default (`DEFAULT_DRAPE`); these tests pin what each does when asked.
 */
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { bodyField, buildAvatar, mannequinMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { clingAccelOf, clothParams, createCloth, loopGirth, setLoops, stepCloth } from './cloth';
import { anchorLoops, bandFor, DEFAULT_DRAPE, drapeOptionsFrom, elasticBandLine, fitElasticBand, gradedMesh, openSession, prepareFit, viewerMaterial, waistbandFromFile, type BandFileEntry, type DrapeOptions } from './engine';
import { fitForBody } from './fitting';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const meas = mannequinMeasurements(m);
const avatar = buildAvatar(m, buildMannequinMesh(m), meas);
const field = bodyField(m, avatar);
const b = buildBundle('aalter-studio-2', { skipSeparation: true });
const dress: SpikeBundle = {
  productId: 'aalter-studio-2',
  anchors: JSON.parse(b.files['anchors.json']) as SpikeBundle['anchors'],
  grading: JSON.parse(b.files['grading.json']) as SpikeBundle['grading'],
  material: JSON.parse(b.files['material.json']) as SpikeBundle['material'],
  qa: JSON.parse(b.files['qa.json']) as SpikeBundle['qa'],
  baseMesh: meshFromGlb(b.files['base.glb']),
};
const session = openSession(m, dress);
const fit = fitForBody(session.payload, meas);
const silk = { drape: 0.9, bendStiffness: 0.03, stretchPct: 0, simulation: { damping: 0.05 } };

/** An open vertical tube of radius r round the Y axis, rows from y0 up to y1 (top row last). */
function tube(r: number, y0: number, y1: number, C = 24, R = 12): { positions: Float32Array; indices: Uint32Array; C: number; R: number } {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= R; i++) for (let c = 0; c < C; c++) {
    const t = (2 * Math.PI * c) / C;
    pos.push(r * Math.sin(t), y0 + ((y1 - y0) * i) / R, r * Math.cos(t));
  }
  for (let i = 0; i < R; i++) for (let c = 0; c < C; c++) {
    const a = i * C + c, bb = i * C + ((c + 1) % C);
    idx.push(a, a + C, bb + C, a, bb + C, bb);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), C, R };
}

describe('cling switch', () => {
  it('keeps the cling pull by default and drops it when asked', () => {
    expect(clothParams(silk).clingAccel).toBeCloseTo(clingAccelOf(0.9), 6);
    expect(clothParams(silk, 1.5, { cling: false }).clingAccel).toBe(0);
    expect(DEFAULT_DRAPE).toEqual({ cling: true, loopRetain: 0, waistband: null });
  });
});

describe('girth loops', () => {
  it('measures the convex hull girth of a ring', () => {
    const t = tube(10, 0, 10, 64, 1);
    const ids = Array.from({ length: 64 }, (_, k) => k);
    expect(loopGirth(t.positions, ids, 0, 64, [], new Int32Array(65))).toBeCloseTo(2 * Math.PI * 10, 0);
  });

  it('opens a ring folded narrower than its cut back to its minimum girth against the cling pull, stably', () => {
    const run = (withLoop: boolean): { girth: number; finite: boolean } => {
      // Placed at radius 12, cut (rest lengths) at radius 16: nothing in the edges pushes it open.
      const t = tube(12, 60, 100);
      const cut = tube(16, 60, 100);
      const cloth = createCloth(t.positions, cut.positions, t.indices, (i) => i >= t.C * t.R, () => true);
      const ring = Array.from({ length: t.C }, (_, k) => 3 * t.C + k); // a row 30 cm under the pins
      if (withLoop) setLoops(cloth, [{ particles: ring, minGirthCm: 2 * Math.PI * 16 }]);
      stepCloth(cloth, clothParams(silk), null, 90);
      return { girth: loopGirth(cloth.pos, ring, 0, ring.length, [], new Int32Array(ring.length + 1)), finite: Array.from(cloth.pos).every(Number.isFinite) };
    };
    const free = run(false), held = run(true);
    expect(free.finite && held.finite).toBe(true);
    expect(free.girth).toBeLessThan(0.95 * 2 * Math.PI * 16); // the cling pull keeps the free ring in
    expect(held.girth - free.girth).toBeGreaterThan(4);
    expect(held.girth).toBeGreaterThan(0.97 * 2 * Math.PI * 16);
    expect(held.girth).toBeLessThan(1.03 * 2 * Math.PI * 16); // one-sided: it never inflates past the minimum
  });

  it('takes per-size minimum girths from the graded mesh (grading.json), so a larger size keeps a larger hip', () => {
    const hip = (size: string): number => {
      const g = gradedMesh(session, size);
      const loops = anchorLoops(m, g.positions, g.indices, session.chains, new Uint8Array(session.chains.length), 1, ['hip']);
      expect(loops.length).toBeGreaterThan(0);
      return Math.max(...loops.map((l) => l.minGirthCm));
    };
    const step = (s: string): number => dress.grading.sizes.find((x) => x.size === s)!.targets.hip!;
    const graded = step('L') - step('S');
    expect(graded).toBeGreaterThan(0);
    expect(hip('L') - hip('S')).toBeGreaterThan(0.8 * graded);
    expect(hip('L') - hip('S')).toBeLessThan(1.2 * graded);
  });

  it('are installed by prepareFit only when asked, and survive the drape job (typed arrays)', () => {
    const mat = viewerMaterial('product', dress.material);
    const off = prepareFit(session, avatar, { ...field }, fit, 'M', mat);
    expect(off.loops).toEqual([]);
    expect(off.cloth.loopMin.length).toBe(0);
    expect(off.params.clingAccel).toBeGreaterThan(0);
    const opts: DrapeOptions = { cling: false, loopRetain: 1, waistband: null, loopRings: ['hip'] };
    const on = prepareFit(session, avatar, field, fit, 'M', mat, 1.5, opts);
    expect(on.params.clingAccel).toBe(0);
    expect(on.loops.map((l) => l.ring)).toContain('hip');
    expect(on.cloth.loops).toBeInstanceOf(Int32Array);
    expect(structuredClone(on.cloth).loopMin).toEqual(on.cloth.loopMin);
  });
});

describe('stretch waistband model', () => {
  const skirt = (): { start: Float32Array; chains: Uint8Array } => {
    const t = tube(15, 60, 99); // a band near the canonical low-rise height
    return { start: Float32Array.from(t.positions), chains: new Uint8Array(t.positions.length / 3) };
  };
  it('grades the relaxed band by the chart step and keeps the stretch ratio', () => {
    const g = dress.grading;
    const base = bandFor({ relaxedCm: 70, stretchedCm: 98, assumed: true }, g, g.baseSize);
    expect(base).toEqual({ relaxedCm: 70, stretchedCm: 98, source: 'assumed' });
    const larger = g.sizes.find((s) => s.step === 1)!;
    const up = bandFor({ relaxedCm: 70, stretchedCm: 98, gradeCmPerSize: 5, assumed: true }, g, larger.size);
    expect(up.relaxedCm).toBe(75);
    expect(up.stretchedCm / up.relaxedCm).toBeCloseTo(1.4, 6);
    // One measured size (the old data-file form): that size is measured, every other one is graded from it.
    expect(bandFor({ relaxedCm: 70, stretchedCm: 98, gradeCmPerSize: 5, assumed: false }, g, g.baseSize).source).toBe('measured');
    expect(bandFor({ relaxedCm: 70, stretchedCm: 98, gradeCmPerSize: 5, assumed: false }, g, larger.size)).toEqual({ relaxedCm: 75, stretchedCm: 105, source: 'graded' });
  });

  // A five-size ladder like the pilot skirt's (AU 8-16, base 12); only the labels and steps matter to the band.
  const ladder = { ...dress.grading, baseSize: '12', sizes: ['8', '10', '12', '14', '16'].map((size, k) => ({ ...dress.grading.sizes[0]!, size, step: k - 2 })) } as SpikeBundle['grading'];
  // The shop's tape of the pilot skirt, 13 Nov 2026 (data/bohohippychic/tape/crimson-wildflower-maxi-skirt.json): AU 8, 10 and 14.
  const tape = { '8': { waistRelaxedCm: 67, waistStretchedCm: 94, hipCm: 112 }, '10': { waistRelaxedCm: 71, waistStretchedCm: 100 }, '14': { waistRelaxedCm: 80, waistStretchedCm: 110 } };

  it('uses the tape per measured size, interpolates between two measured sizes and extrapolates past them, and says which', () => {
    const spec = waistbandFromFile({ sizes: tape }, ladder);
    expect(spec.assumed).toBe(false);
    expect(spec.measuredSize).toBe('10'); // the measured size nearest the base size (10 and 14 tie: the smaller comes first)
    expect(bandFor(spec, ladder, '8')).toEqual({ relaxedCm: 67, stretchedCm: 94, source: 'measured' });
    expect(bandFor(spec, ladder, '10')).toEqual({ relaxedCm: 71, stretchedCm: 100, source: 'measured' });
    expect(bandFor(spec, ladder, '14')).toEqual({ relaxedCm: 80, stretchedCm: 110, source: 'measured' });
    // AU 12, not measured: halfway between 10 and 14. AU 16, not measured: the 10-14 line continued one size.
    expect(bandFor(spec, ladder, '12')).toEqual({ relaxedCm: 75.5, stretchedCm: 105, source: 'interpolated' });
    expect(bandFor(spec, ladder, '16')).toEqual({ relaxedCm: 84.5, stretchedCm: 115, source: 'extrapolated' });
    // Below the smallest measured size: the line through the two smallest.
    const upper = waistbandFromFile({ sizes: { '10': tape['10'], '14': tape['14'] } }, ladder);
    expect(bandFor(upper, ladder, '8')).toEqual({ relaxedCm: 66.5, stretchedCm: 95, source: 'extrapolated' });
    // "AU 12" style labels are accepted; a size the grading does not have is refused.
    expect(bandFor(waistbandFromFile({ sizes: { 'AU 8': tape['8'], 'size 14': tape['14'] } }, ladder), ladder, '12').source).toBe('interpolated');
    expect(() => waistbandFromFile({ sizes: { '18': tape['8'] } }, ladder)).toThrow(/not one of the grading sizes/);
  });

  it('keeps the one-size form of the data file working, and refuses an entry without a measurement', () => {
    const one = waistbandFromFile({ relaxedCm: 75, stretchedCm: 105, measuredSize: 'AU 12', gradeCmPerSize: 4 }, ladder);
    expect(one).toEqual({ relaxedCm: 75, stretchedCm: 105, measuredSize: '12', gradeCmPerSize: 4, assumed: false });
    expect(bandFor(one, ladder, '12')).toEqual({ relaxedCm: 75, stretchedCm: 105, source: 'measured' });
    expect(bandFor(one, ladder, '16')).toEqual({ relaxedCm: 83, stretchedCm: 83 * 1.4, source: 'graded' });
    // One size in the per-size form behaves the same: graded from that size.
    const single = waistbandFromFile({ sizes: { '8': tape['8'] }, gradeCmPerSize: 4 }, ladder);
    expect(bandFor(single, ladder, '8').source).toBe('measured');
    expect(bandFor(single, ladder, '10')).toEqual({ relaxedCm: 71, stretchedCm: 71 * (94 / 67), source: 'graded' });
    const empties: (BandFileEntry | undefined)[] = [undefined, {}, { relaxedCm: null, stretchedCm: null, sizes: {} }, { sizes: { '8': { hipCm: 112 } } }];
    for (const empty of empties) expect(() => waistbandFromFile(empty, ladder)).toThrow(/no measured band yet/);
    expect(() => waistbandFromFile({ relaxedCm: 100, stretchedCm: 90 }, ladder)).toThrow(/relaxedCm <= stretchedCm/);
    expect(() => waistbandFromFile({ sizes: { '8': { waistRelaxedCm: 94, waistStretchedCm: 67 } } }, ladder)).toThrow(/relaxed <= stretched/);
  });

  it('never calls an interpolated or extrapolated band measured in the fit line', () => {
    const spec = waistbandFromFile({ sizes: tape }, ladder);
    const line = (size: string): string => { const s = skirt(); return elasticBandLine(fitElasticBand(field, s.start, s.chains, 0.35, bandFor(spec, ladder, size), spec.assumed)).text; };
    expect(line('8')).toContain('(measured band:');
    expect(line('12')).toContain('interpolated band (this size was not measured');
    expect(line('16')).toContain('extrapolated band (this size was not measured');
    for (const size of ['12', '16']) expect(line(size)).not.toContain('(measured band');
  });

  it('stays and stretches to the body when the relaxed band is smaller; slides down when larger; flags an overstretch', () => {
    const tight = skirt();
    const a = fitElasticBand(field, tight.start, tight.chains, 0.35, { relaxedCm: 60, stretchedCm: 100 }, true);
    expect(a.dropCm).toBe(0);
    expect(a.onBodyCm).toBeCloseTo(a.bodyAtBandCm, 0);
    expect(a.overstretched).toBe(false);
    // The band ring itself now has the girth on the body.
    const top: number[] = [];
    for (let i = 0; i < tight.chains.length; i++) if (tight.start[3 * i + 1]! >= 99 - 0.01) top.push(i);
    expect(loopGirth(tight.start, top, 0, top.length, [], new Int32Array(top.length + 1))).toBeCloseTo(a.onBodyCm, 0);

    const loose = skirt();
    const c = fitElasticBand(field, loose.start, loose.chains, 0.35, { relaxedCm: a.bodyAtBandCm + 6, stretchedCm: 130 }, true);
    expect(c.dropCm).toBeGreaterThan(0);
    expect(c.onBodyCm).toBeCloseTo(a.bodyAtBandCm + 6, 0);

    const small = skirt();
    const d = fitElasticBand(field, small.start, small.chains, 0.35, { relaxedCm: 50, stretchedCm: 60 }, true);
    expect(d.overstretched).toBe(true);
    expect(elasticBandLine(d).tone).toBe('strain');
    expect(elasticBandLine(d).text).toContain('assumed');
  });
});

describe('drape options from URL parameters', () => {
  it('parses the spike page switches and ignores junk', () => {
    const q = (s: string): DrapeOptions => drapeOptionsFrom((k) => new URLSearchParams(s).get(k));
    expect(q('')).toEqual(DEFAULT_DRAPE);
    expect(q('cling=0&loops=1&rings=hip,waist,nope&band=72:97')).toEqual({ cling: false, loopRetain: 1, loopRings: ['hip', 'waist'], waistband: { relaxedCm: 72, stretchedCm: 97, assumed: true } });
    expect(q('band=97:72&loops=-1').waistband).toBeNull();
    expect(q('band=72:97&bandMeasured=1').waistband?.assumed).toBe(true); // a URL can never claim a measured band
  });
});
