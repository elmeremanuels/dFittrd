/**
 * Step-3 control (docs/research/shortcut-to-step3.md §4, days 1-2): the cling switch, girth loops at the anchor rings
 * and the stretch-waistband model. All off by default (`DEFAULT_DRAPE`); these tests pin what each does when asked.
 */
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildBundle } from '../../src/bundle';
import { bodyField, buildAvatar, mannequinMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { clingAccelOf, clothParams, createCloth, loopGirth, setLoops, stepCloth } from './cloth';
import { anchorLoops, bandFor, DEFAULT_DRAPE, drapeOptionsFrom, elasticBandLine, fitElasticBand, gradedMesh, openSession, prepareFit, viewerMaterial, type DrapeOptions } from './engine';
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
    expect(base).toEqual({ relaxedCm: 70, stretchedCm: 98 });
    const larger = g.sizes.find((s) => s.step === 1)!;
    const up = bandFor({ relaxedCm: 70, stretchedCm: 98, gradeCmPerSize: 5, assumed: true }, g, larger.size);
    expect(up.relaxedCm).toBe(75);
    expect(up.stretchedCm / up.relaxedCm).toBeCloseTo(1.4, 6);
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
