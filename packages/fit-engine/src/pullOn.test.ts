/**
 * Garment tape readings: the pull-on check and the elastic-band waist reading
 * (docs/research/step3-serverdrape-spike.md §9.2, README §Garment tape).
 *
 * The pilot skirt (Crimson Wildflower Maxi Skirt): AU 8, 10 and 14 measured by the shop, AU 12
 * interpolated, AU 16 extrapolated. Stretched band 94 / 100 / 105 / 110 / 115 against the chart
 * hips 94 / 99 / 104 / 109 / 114.
 */
import { MOCK_GARMENTS, PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY, FIT_POINTS } from '@curtain/schema';
import type { GarmentTape, UserBody } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { computeFit, recommendSize } from './computeFit';
import { TAPE_TUNING, elasticCloseness, pullOnCheck } from './pullOn';
import { fitGapsForRender, fitSummary } from './summary';
import { JEANS, REF, SLIP, WRAP, deepFreeze, rng } from './test/fixtures';
import { isPointFit, type FitGarment, type FitResult, type PointFit, type SizeFit } from './types';

const SKIRT: FitGarment = deepFreeze(structuredClone(PILOT_PULL_ON_SKIRT));
const BEFORE: FitGarment = deepFreeze(structuredClone(PILOT_SKIRT_CHART_ONLY));
const body = (waist: number | undefined, hip: number | undefined): UserBody =>
  deepFreeze({ measurements: { ...(waist === undefined ? {} : { waist }), ...(hip === undefined ? {} : { hip }) } });

const size = (r: FitResult, label: string): SizeFit => {
  const s = r.perSize.find((x) => x.size === label);
  if (!s) throw new Error(`no size ${label}`);
  return s;
};
const waist = (s: SizeFit): PointFit => {
  const p = s.points.find((q) => q.point === 'waist');
  if (!p || !isPointFit(p)) throw new Error(`waist not used in ${s.size}`);
  return p;
};

describe('backward compatibility: a garment without tape data is untouched', () => {
  it('gives byte-identical results for every fixture, whatever closure or tuning says', () => {
    const next = rng(20261115);
    const garments: FitGarment[] = [WRAP, SLIP, JEANS, BEFORE, ...MOCK_GARMENTS];
    for (let i = 0; i < 400; i++) {
      const g = garments[i % garments.length]!;
      const user: UserBody = {
        measurements: {
          bust: 70 + next() * 60,
          waist: 55 + next() * 60,
          hip: 80 + next() * 50,
          shoulder: 34 + next() * 14,
          thigh: 45 + next() * 30,
          inseam: 65 + next() * 25,
          footEu: 35 + Math.floor(next() * 10),
        },
      };
      const plain = JSON.stringify(computeFit(g, user));
      // closure without tape, tape without band values, tuning without tape: none may change a byte
      expect(JSON.stringify(computeFit({ ...g, closure: 'pull-on' }, user))).toBe(plain);
      expect(JSON.stringify(computeFit(g, user, { tapeTuning: { pullOnAllowanceCm: 0, easyStretchShare: 1 } }))).toBe(plain);
      const hemOnly: GarmentTape = g.sizeChart.map((r) => ({ size: r.size, hemSweep: { cm: 200, provenance: 'measured' as const } }));
      if (hemOnly.length > 0) expect(JSON.stringify(computeFit({ ...g, closure: 'pull-on', garmentTape: hemOnly }, user))).toBe(plain);
    }
  });

  it('adds no key to the result when there is no tape', () => {
    const r = computeFit(BEFORE, body(73.5, 100));
    expect('tapeProvenance' in r).toBe(false);
    for (const s of r.perSize) {
      expect('pullOn' in s).toBe(false);
      for (const p of s.points) expect('elasticBand' in p).toBe(false);
    }
    expect(r.recommendedSize).toBe('12');
    expect(r.confidence).toBe(0.245);
  });

  it('a band that does not stretch keeps the chart reading', () => {
    const rigid: GarmentTape = BEFORE.sizeChart.map((r) => ({
      size: r.size,
      waistRelaxed: { cm: 70, provenance: 'measured' as const },
      waistStretched: { cm: 70, provenance: 'measured' as const },
    }));
    const u = body(73.5, 100);
    expect(computeFit({ ...BEFORE, closure: 'zip', garmentTape: rigid }, u)).toEqual(computeFit(BEFORE, u));
  });
});

describe('pull-on check: the three measured sizes of the pilot skirt', () => {
  // Each measured size on the body its own chart row is cut for.
  const CASES = [
    { label: '8', waistCm: 67.5, hipCm: 94, margin: 0 },
    { label: '10', waistCm: 72.5, hipCm: 99, margin: 1 },
    { label: '14', waistCm: 82.5, hipCm: 109, margin: 1 },
  ];

  it.each(CASES)('AU $label on its own chart body: passes by $margin cm, marginal, still recommended', ({ label, waistCm, hipCm, margin }) => {
    const r = computeFit(SKIRT, body(waistCm, hipCm));
    const s = size(r, label);
    expect(s.pullOn).toEqual({
      status: 'marginal',
      marginCm: margin,
      bandStretchedCm: hipCm + margin,
      bodyHipCm: hipCm,
      allowanceCm: 2.5,
      provenance: 'measured',
    });
    expect(s.wearable).toBe(true);
    expect(r.recommendedSize).toBe(label);
    expect(r.fits).toBe(true);
    // measured values: confidence is what it was without the tape
    expect(r.tapeProvenance).toBe('measured');
    expect(r.confidence).toBe(computeFit(BEFORE, body(waistCm, hipCm)).confidence);
    expect(r.notes.some((n) => n.startsWith('To pull it on, the waistband only just stretches over your hips'))).toBe(true);
    expect(r.notes.some((n) => n.includes('not measured'))).toBe(false);
  });

  it('one size down is blocked (4 to 6 cm short), one size up is clear (5 to 6 cm to spare)', () => {
    const on10 = computeFit(SKIRT, body(72.5, 99));
    expect(size(on10, '8').pullOn).toMatchObject({ status: 'blocked', marginCm: -5 });
    expect(size(on10, '12').pullOn).toMatchObject({ status: 'clear', marginCm: 6, provenance: 'interpolated' });
    const on14 = computeFit(SKIRT, body(82.5, 109));
    expect(size(on14, '12').pullOn).toMatchObject({ status: 'blocked', marginCm: -4, provenance: 'interpolated' });
    expect(size(on14, '10').pullOn).toMatchObject({ status: 'blocked', marginCm: -9 });
    expect(size(on14, '16').pullOn).toMatchObject({ status: 'clear', marginCm: 6, provenance: 'extrapolated' });
  });
});

describe('pull-on check: the held-out body (waist 73.5, hip 100)', () => {
  const r = computeFit(SKIRT, body(73.5, 100));

  it('AU 8 is short by 6: blocked, not wearable, never recommended, with its reason', () => {
    const s = size(r, '8');
    expect(s.pullOn).toMatchObject({ status: 'blocked', marginCm: -6, bandStretchedCm: 94, bodyHipCm: 100, provenance: 'measured' });
    expect(s.wearable).toBe(false);
    // Its waist alone would have recommended it: the band holds at the waist.
    expect(waist(s).band).toBe('good');
    expect(s.score).toBe(1);
    expect(r.recommendedSize).not.toBe('8');
    expect(r.notes).toContain('Size 8 is not recommended: its waistband does not stretch over your hips to pull it on (about 6 cm short)');
  });

  it('AU 10 is on the edge: margin 0, marginal, recommended with a warning', () => {
    const s = size(r, '10');
    expect(s.pullOn).toMatchObject({ status: 'marginal', marginCm: 0, bandStretchedCm: 100, provenance: 'measured' });
    expect(s.wearable).toBe(true);
    expect(r.recommendedSize).toBe('10');
    expect(r.fits).toBe(true);
    expect(r.notes).toContain('To pull it on, the waistband only just stretches over your hips (nothing to spare)');
    expect(fitSummary(r)).toBe('Size 10 should fit — the waistband only just passes your hips (estimate, 25% confidence).');
  });

  it('AU 12 and up are clear', () => {
    expect(size(r, '12').pullOn).toMatchObject({ status: 'clear', marginCm: 5 });
    expect(size(r, '14').pullOn).toMatchObject({ status: 'clear', marginCm: 10 });
    expect(size(r, '16').pullOn).toMatchObject({ status: 'clear', marginCm: 15 });
  });

  it('one millimetre more hip and the band of AU 10 is short: AU 12 is preferred, AU 10 stays wearable', () => {
    const more = computeFit(SKIRT, body(73.5, 100.1));
    expect(size(more, '10').pullOn).toMatchObject({ status: 'marginal', marginCm: -0.1 });
    expect(size(more, '10').wearable).toBe(true);
    expect(more.recommendedSize).toBe('12');
    // Without that preference the closest waist wins and the warning says the band is short.
    const noPref = computeFit(SKIRT, body(73.5, 100.1), { tapeTuning: { pullOnPreferPassing: false } });
    expect(noPref.recommendedSize).toBe('10');
    expect(noPref.notes).toContain('To pull it on, the waistband has to stretch over your hips (about 0.1 cm more than a comfortable stretch)');
  });

  it('before the tape the engine recommended AU 12 and knew nothing about the hips', () => {
    const before = computeFit(BEFORE, body(73.5, 100));
    expect(before.recommendedSize).toBe('12');
    expect(before.skippedPoints.map((s) => s.point)).toEqual(['hip']);
    // and for a hip of 110 on the same waist it still said AU 12, whose band is 5 cm short
    expect(computeFit(BEFORE, body(73.5, 110)).recommendedSize).toBe('12');
    const after = computeFit(SKIRT, body(73.5, 110));
    expect(size(after, '12').pullOn).toMatchObject({ status: 'blocked', marginCm: -5 });
    expect(after.recommendedSize).toBe('14');
  });
});

describe('margins', () => {
  const m = { cm: 100, provenance: 'measured' as const };
  it('blocked below −2.5, marginal from −2.5 up to +2.5, clear from +2.5', () => {
    expect(pullOnCheck(m, 102.6).status).toBe('blocked');
    expect(pullOnCheck(m, 102.5).status).toBe('marginal');
    expect(pullOnCheck(m, 100).status).toBe('marginal');
    expect(pullOnCheck(m, 97.6).status).toBe('marginal');
    expect(pullOnCheck(m, 97.5).status).toBe('clear');
    expect(TAPE_TUNING).toMatchObject({ pullOnAllowanceCm: 2.5, pullOnMarginalBelowCm: 2.5, pullOnExtrapolatedAllowanceCm: 0, easyStretchShare: 0.5 });
  });

  it('an extrapolated band gets no allowance: it has to reach the hips on paper, and says so', () => {
    const e = { cm: 115, provenance: 'extrapolated' as const };
    expect(pullOnCheck(e, 115)).toMatchObject({ status: 'marginal', marginCm: 0, allowanceCm: 0, provenance: 'extrapolated' });
    expect(pullOnCheck(e, 115.1)).toMatchObject({ status: 'blocked', marginCm: -0.1, allowanceCm: 0 });
    expect(pullOnCheck(e, 112.5).status).toBe('clear');
    // interpolated and measured keep the 2.5 cm
    expect(pullOnCheck({ cm: 115, provenance: 'interpolated' }, 117)).toMatchObject({ status: 'marginal', allowanceCm: 2.5 });
    expect(pullOnCheck({ cm: 115, provenance: 'interpolated' }, 119)).toMatchObject({ status: 'blocked', allowanceCm: 2.5 });
    // tuning can never make an unmeasured band more tolerant than a measured one
    const wide = { ...TAPE_TUNING, pullOnExtrapolatedAllowanceCm: 10 };
    expect(pullOnCheck(e, 118, wide)).toMatchObject({ status: 'blocked', allowanceCm: 2.5 });
  });

  it('the largest size is not offered on a guessed band that is short of the hips (review finding)', () => {
    // waist 93.5 / hip 120: AU 16's band (115, extrapolated) is 5 cm short. Before this rule: "Size 16 should fit".
    const r = computeFit(SKIRT, body(93.5, 120));
    expect(size(r, '16').pullOn).toMatchObject({ status: 'blocked', marginCm: -5, provenance: 'extrapolated', allowanceCm: 0 });
    expect(size(r, '16').wearable).toBe(false);
    expect(r.recommendedSize).toBeNull();
    expect(r.fits).toBe(false);
    expect(fitSummary(r)).toBe('No size stretches over your hips — the closest is 16 (estimate).');
    // one millimetre over the guessed band is already not offered
    expect(computeFit(SKIRT, body(88, 115.1)).recommendedSize).toBeNull();
    expect(computeFit(SKIRT, body(88, 115)).recommendedSize).toBe('16');
  });

  it('sensitivity: the allowance moves the block line and nothing else', () => {
    const u = body(77.5, 104); // chart AU 12: AU 10 is 4 short
    expect(size(computeFit(SKIRT, u), '10').pullOn?.status).toBe('blocked');
    expect(size(computeFit(SKIRT, u, { tapeTuning: { pullOnAllowanceCm: 5 } }), '10').pullOn?.status).toBe('marginal');
    // a hard zero would block AU 8 on a body 1 mm over its own chart hip
    expect(size(computeFit(SKIRT, body(67.5, 94.1), { tapeTuning: { pullOnAllowanceCm: 0 } }), '8').pullOn?.status).toBe('blocked');
    expect(size(computeFit(SKIRT, body(67.5, 94.1)), '8').pullOn?.status).toBe('marginal');
  });

  it('every size goes on its own chart body under the default margins (the diagonal)', () => {
    for (const row of SKIRT.sizeChart) {
      const r = computeFit(SKIRT, body(row.waist, row.hip));
      expect(size(r, row.size).pullOn?.status).not.toBe('blocked');
      expect(r.recommendedSize).toBe(row.size);
    }
  });
});

describe('unmeasured sizes lower confidence and are never presented as measured', () => {
  it('AU 12 (interpolated): confidence × 0.9, labelled', () => {
    const u = body(77.5, 104);
    const r = computeFit(SKIRT, u);
    expect(r.recommendedSize).toBe('12');
    expect(r.tapeProvenance).toBe('interpolated');
    expect(waist(size(r, '12')).elasticBand).toEqual({ relaxedCm: 75.5, stretchedCm: 105, provenance: 'interpolated' });
    expect(size(r, '12').pullOn?.provenance).toBe('interpolated');
    expect(computeFit(BEFORE, u).confidence).toBe(0.245);
    expect(r.confidence).toBe(0.221);
    expect(r.notes).toContain('Size 12 was not measured by the shop — its waistband numbers are estimated from the sizes next to it');
  });

  it('AU 16 (extrapolated): confidence × 0.7, labelled a rough estimate', () => {
    const u = body(87.5, 114);
    const r = computeFit(SKIRT, u);
    expect(r.recommendedSize).toBe('16');
    expect(r.tapeProvenance).toBe('extrapolated');
    expect(computeFit(BEFORE, u).confidence).toBe(0.245);
    expect(r.confidence).toBe(0.172);
    expect(r.notes).toContain('Size 16 was not measured by the shop — its waistband numbers are a rough estimate');
    expect(recommendSize(SKIRT, u).confidence).toBe(0.172);
  });

  it('confidence never rises with a worse provenance', () => {
    const relabel = (p: 'measured' | 'interpolated' | 'extrapolated'): FitGarment => ({
      ...SKIRT,
      garmentTape: SKIRT.garmentTape!.map((row) => ({
        ...row,
        waistRelaxed: { cm: row.waistRelaxed!.cm, provenance: p },
        waistStretched: { cm: row.waistStretched!.cm, provenance: p },
      })),
    });
    const u = body(72.5, 96);
    const c = (p: 'measured' | 'interpolated' | 'extrapolated') => computeFit(relabel(p), u).confidence;
    expect(c('measured')).toBeGreaterThan(c('interpolated'));
    expect(c('interpolated')).toBeGreaterThan(c('extrapolated'));
  });
});

describe('no size goes on', () => {
  it('hips larger than every band: nothing recommended, the closest is the least short, with the reason', () => {
    const r = computeFit(SKIRT, body(95, 122));
    expect(r.perSize.every((s) => s.pullOn?.status === 'blocked' && !s.wearable)).toBe(true);
    expect(r.recommendedSize).toBeNull();
    expect(r.fits).toBe(false);
    expect(r.closestSize).toBe('16');
    expect(r.notes[0]).toBe('No size stretches over your hips to pull it on — the closest is 16, about 7 cm short at a comfortable stretch');
    expect(fitSummary(r)).toBe('No size stretches over your hips — the closest is 16 (estimate).');
  });

  it('a blocked size is never recommended, whatever the body', () => {
    const next = rng(99);
    for (let i = 0; i < 2000; i++) {
      const u = body(55 + next() * 60, 80 + next() * 50);
      const r = computeFit(SKIRT, u);
      if (r.recommendedSize !== null) {
        const s = r.perSize[r.closestIndex!]!;
        expect(s.pullOn?.status).not.toBe('blocked');
      }
      for (const s of r.perSize) if (s.pullOn?.status === 'blocked') expect(s.wearable).toBe(false);
    }
  });
});

describe('missing measurements', () => {
  it('no hip: no check, and the notes say what is missing', () => {
    const r = computeFit(SKIRT, body(73.5, undefined));
    expect(r.perSize.every((s) => s.pullOn === undefined)).toBe(true);
    expect(r.notes).toContain("We don't have your hips measurement yet — we can't check that the waistband goes over your hips when you pull it on");
    expect(r.pullOnUnchecked).toBe(true);
    expect(computeFit(SKIRT, body(73.5, 100)).pullOnUnchecked).toBeUndefined();
    expect(computeFit({ ...SKIRT, closure: 'zip' }, body(73.5, undefined)).pullOnUnchecked).toBeUndefined();
    expect(r.recommendedSize).toBe('10');
  });

  it('no waist: no fit point, but the placeholder size is the first one that goes on', () => {
    const r = computeFit(SKIRT, body(undefined, 100));
    expect(r.score).toBeNull();
    expect(r.fits).toBe(false);
    expect(size(r, '8').pullOn?.status).toBe('blocked');
    expect(r.recommendedSize).toBe('10');
    expect(r.closestIndex).toBe(1);
    const none = computeFit(SKIRT, body(undefined, 130));
    expect(none.recommendedSize).toBeNull();
    expect(none.closestSize).toBe('16');
    expect(none.notes).toEqual(['No fit points for this item', 'No size stretches over your hips to pull it on — the closest is 16, about 15 cm short at a comfortable stretch']);
    // before: the first chart size, whatever the hips
    expect(computeFit(BEFORE, body(undefined, 130)).recommendedSize).toBe('8');
  });
});

describe('where the check does not apply', () => {
  it('only closure pull-on, only bottoms, only sizes with a stretched band', () => {
    const u = body(73.5, 100);
    for (const closure of ['zip', 'button', 'drawstring', 'wrap', 'other'] as const) {
      expect(computeFit({ ...SKIRT, closure }, u).perSize.every((s) => s.pullOn === undefined)).toBe(true);
    }
    const { closure: _c, ...unspecified } = SKIRT;
    expect(computeFit(unspecified, u).perSize.every((s) => s.pullOn === undefined)).toBe(true);
    expect(computeFit({ ...SKIRT, category: 'dress' }, u).perSize.every((s) => s.pullOn === undefined)).toBe(true);
    const partial: FitGarment = { ...SKIRT, garmentTape: SKIRT.garmentTape!.filter((t) => t.size !== '8') };
    const r = computeFit(partial, u);
    expect(size(r, '8').pullOn).toBeUndefined();
    expect(waist(size(r, '8')).elasticBand).toBeUndefined(); // chart reading for that size
    expect(size(r, '10').pullOn?.status).toBe('marginal');
  });

  it('matches tape rows to chart rows by label, trimmed and case-insensitive; a duplicated label is not read', () => {
    const u = body(73.5, 100);
    const spaced: FitGarment = { ...SKIRT, garmentTape: SKIRT.garmentTape!.map((t) => ({ ...t, size: ` ${t.size} ` })) };
    expect(computeFit(spaced, u)).toEqual(computeFit(SKIRT, u));
    const dup: FitGarment = { ...SKIRT, garmentTape: [...SKIRT.garmentTape!, { size: '8', waistStretched: { cm: 200, provenance: 'measured' } }] };
    expect(size(computeFit(dup, u), '8').pullOn).toBeUndefined();
    expect(size(computeFit(dup, u), '10').pullOn?.status).toBe('marginal');
  });
});

describe('waist read from the measured band', () => {
  it('reports relaxed − body with ease target 0 and the band it was read from', () => {
    const r = computeFit(SKIRT, body(73.5, 100));
    const p = waist(size(r, '10'));
    expect(p).toMatchObject({
      gapCm: -2.5, // 71 − 73.5: stretched by 2.5 cm
      chartCm: 71,
      bodyCm: 73.5,
      easeTarget: 0,
      tightLimit: -29, // −(100 − 71)
      band: 'good',
      score: 1,
      elasticBand: { relaxedCm: 71, stretchedCm: 100, provenance: 'measured' },
    });
    // the chart reading it replaces: (72.5 + 3) − (73.5 + 2.9) = −0.9, snug
    expect(waist(size(computeFit(BEFORE, body(73.5, 100)), '10'))).toMatchObject({ gapCm: -0.9, chartCm: 75.5, easeTarget: 2.9, band: 'snug' });
    expect(fitGapsForRender(r, '10')?.slackCm.waist).toBe(-2.5);
  });

  // Band 70 relaxed, 90 stretched (range 20, easy half 10), no stretch zone: slack 2 / 4.
  const band: GarmentTape = [{ size: 'M', waistRelaxed: { cm: 70, provenance: 'measured' }, waistStretched: { cm: 90, provenance: 'measured' } }];
  const g: FitGarment = deepFreeze({
    id: 'band',
    brand: 'Tape',
    category: 'bottom',
    patternBlock: 'a-line',
    fabric: { stretchPct: 0 },
    sizeChartType: 'body',
    sizeChart: [{ size: 'M', waist: 72, hip: 98 }],
    closure: 'zip',
    garmentTape: band,
  });
  const read = (waistCm: number, hipCm?: number) => waist(size(computeFit(g, body(waistCm, hipCm)), 'M'));

  it.each([
    [90.1, 'tight', 0],
    [90, 'snug', 0.7],
    [80.1, 'snug', 0.7],
    [80, 'good', 1],
    [70, 'good', 1],
    [68, 'good', 1],
    [67.9, 'roomy', 0.6],
    [66, 'roomy', 0.6],
    [65.9, 'loose', 0.2],
    [61.9, 'loose', 0],
  ])('body waist %s → %s (score %s)', (waistCm, bandName, score) => {
    const p = read(waistCm);
    expect(p.band).toBe(bandName);
    expect(p.score).toBe(score);
    expect(p.gapCm).toBeCloseTo(70 - waistCm, 5);
  });

  it('a band much longer than the waist is loose, whatever the hip (review finding)', () => {
    expect(read(60).band).toBe('loose'); // 10 cm longer than the waist is beyond the slack
    expect(read(60, 95).band).toBe('loose'); // a known hip does not turn slack into "roomy"
    expect(read(60, 95)).toEqual(read(60));
    // waist 60 / hip 100 on the pilot skirt: only the smallest band is near the waist; none is offered as an oversize "roomy"
    const r = computeFit(SKIRT, body(60, 100));
    expect(r.perSize.map((s) => waist(s).band)).toEqual(['roomy', 'loose', 'loose', 'loose', 'loose']);
    expect(r.perSize.filter((s) => s.wearable).map((s) => s.size)).toEqual([]);
    // the chart AU 8 body: AU 14 and 16 are loose again, as the chart reading said
    const small = computeFit(SKIRT, body(67.5, 94));
    expect(waist(size(small, '14')).band).toBe('loose');
    expect(size(small, '14').wearable).toBe(false);
    expect(size(small, '16').wearable).toBe(false);
  });

  it('the easy share moves the snug line only', () => {
    const at = (k: number, w: number) => waist(size(computeFit(g, body(w, undefined), { tapeTuning: { easyStretchShare: k } }), 'M')).band;
    expect(at(0.25, 76)).toBe('snug');
    expect(at(0.5, 76)).toBe('good');
    expect(at(1, 90)).toBe('good');
    expect(at(1, 90.1)).toBe('tight');
    expect(at(0, 70.1)).toBe('snug');
  });

  it('closest-ease: stretch counts less than slack, scaled to the two ends of good', () => {
    expect(elasticCloseness(3, 10, 2)).toBe(3);
    expect(elasticCloseness(-10, 10, 2)).toBe(2); // the end of the easy range = the end of good
    expect(elasticCloseness(-5, 10, 2)).toBe(1);
    expect(elasticCloseness(-5, 0, 2)).toBe(5);
  });

  it('sigma: probabilities on the band reading sum to 1 and sigma 0 is the deterministic result', () => {
    const u = body(73.5, 100);
    const det = computeFit(SKIRT, u);
    expect(computeFit(SKIRT, u, { sigma: { waist: 0 } })).toEqual(det);
    const soft = computeFit(SKIRT, u, { sigma: { waist: 3 } });
    for (const s of soft.perSize) {
      const p = waist(s);
      expect(p.sigma).toBe(3);
      const sum = Object.values(p.bandProbabilities!).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
      expect(p.gapCm).toBe(waist(size(det, s.size)).gapCm);
    }
    // AU 14 (80 relaxed) on waist 73.5: gap +6.5, between the roomy edge (6) and the loose edge (8): mass on all three
    const p14 = waist(size(soft, '14')).bandProbabilities!;
    expect(p14.good).toBeGreaterThan(0.3);
    expect(p14.roomy).toBeGreaterThan(0.2);
    expect(p14.loose).toBeGreaterThan(0.2);
  });
});

describe('T16-style purity with tape data', () => {
  it('deep-frozen inputs, two calls → equal results, inputs unchanged', () => {
    const garment = deepFreeze(structuredClone(PILOT_PULL_ON_SKIRT));
    for (const u of [body(73.5, 100), body(95, 122), body(undefined, 100), body(60, undefined), deepFreeze(structuredClone(REF))]) {
      const before = JSON.stringify({ garment, u });
      const a = computeFit(garment, u);
      const b = computeFit(garment, u);
      expect(a).toEqual(b);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify({ garment, u })).toBe(before);
    }
  });

  it('2000 random bodies never throw and give sane results, with and without sigma and tuning', () => {
    const next = rng(20261115);
    const garment = deepFreeze(structuredClone(PILOT_PULL_ON_SKIRT));
    for (let i = 0; i < 2000; i++) {
      const m: Record<string, number> = {};
      if (next() < 0.85) m.waist = Math.round((50 + next() * 80) * 10) / 10;
      if (next() < 0.85) m.hip = Math.round((70 + next() * 80) * 10) / 10;
      if (next() < 0.3) m.thigh = 40 + next() * 40;
      const user: UserBody = deepFreeze({ measurements: m, ...(next() < 0.5 ? { confidence: { waist: next(), hip: next() } } : {}) });
      const sigma: Record<string, number> = {};
      for (const p of FIT_POINTS) if (next() < 0.5) sigma[p] = next() * 6;
      const opts = deepFreeze({
        ...(next() < 0.5 ? { sigma } : {}),
        ...(next() < 0.5
          ? { tapeTuning: { pullOnAllowanceCm: next() * 8, pullOnMarginalBelowCm: next() * 6, easyStretchShare: next(), pullOnPreferPassing: next() < 0.5 } }
          : {}),
      });
      const r = computeFit(garment, user, opts);
      expect(computeFit(garment, user, opts)).toEqual(r);
      expect(r.perSize).toHaveLength(5);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.closestSize).not.toBeNull();
      if (r.recommendedSize !== null) expect(r.closestSize).toBe(r.recommendedSize);
      if (r.fits) expect(r.recommendedSize).not.toBeNull();
      for (const s of r.perSize) {
        if (s.score !== null) {
          expect(s.score).toBeGreaterThanOrEqual(0);
          expect(s.score).toBeLessThanOrEqual(1);
        }
        if (s.pullOn) expect(Number.isFinite(s.pullOn.marginCm)).toBe(true);
        for (const p of s.points) if (isPointFit(p)) expect(Number.isFinite(p.gapCm)).toBe(true);
      }
      expect(typeof fitSummary(r)).toBe('string');
    }
  });

  it('garbage tape data does not throw and is not read', () => {
    const u = body(73.5, 100);
    const plain = computeFit(BEFORE, u);
    const junk: unknown[] = [
      null,
      'tape',
      42,
      {},
      [],
      [null, undefined, 7, 'x'],
      [{ size: '10' }],
      [{ size: '10', waistStretched: 100 }],
      [{ size: '10', waistStretched: { cm: Number.NaN, provenance: 'measured' } }],
      [{ size: '10', waistStretched: { cm: -5, provenance: 'measured' } }],
      [{ size: '10', waistStretched: { cm: 100 } }],
      [{ size: '10', waistStretched: { cm: 100, provenance: 'guessed' } }],
      [{ waistStretched: { cm: 100, provenance: 'measured' } }],
    ];
    for (const garmentTape of junk) {
      const g = { ...BEFORE, closure: 'pull-on', garmentTape } as unknown as FitGarment;
      expect(() => computeFit(g, u)).not.toThrow();
      expect(computeFit(g, u)).toEqual(plain);
      expect(() => computeFit(g, undefined as unknown as UserBody)).not.toThrow();
    }
    // stretched smaller than relaxed: no band reading, but the stretched value still stands for the check
    const odd = {
      ...BEFORE,
      closure: 'pull-on',
      garmentTape: [{ size: '10', waistRelaxed: { cm: 100, provenance: 'measured' }, waistStretched: { cm: 90, provenance: 'measured' } }],
    } as FitGarment;
    const r = computeFit(odd, u);
    expect(waist(size(r, '10')).elasticBand).toBeUndefined();
    expect(size(r, '10').pullOn?.status).toBe('blocked');
    expect(() => computeFit(SKIRT, u, { tapeTuning: { pullOnAllowanceCm: Number.NaN, easyStretchShare: 7 } as never })).not.toThrow();
    expect(computeFit(SKIRT, u, { tapeTuning: { pullOnAllowanceCm: Number.NaN, easyStretchShare: 7 } as never })).toEqual(computeFit(SKIRT, u));
  });
});
