/**
 * Men's fit, slices M2a and M2b of docs/research/men-3d-plan.md (§4 "New test vectors" MT1–MT17),
 * plus vectors on the M1 synthetic tee and the M2b synthetic W/L chino. Every expected value here is
 * computed from the men's tables in constants.ts, whose numbers are assumed [A] unless the table says
 * otherwise: these vectors pin the arithmetic, they are not evidence that a size fits a real man.
 */
import { createHash } from 'node:crypto';
import {
  CATEGORY_POINTS as SCHEMA_CATEGORY_POINTS,
  FIT_POINTS,
  MENS_CATEGORY_POINTS as SCHEMA_MENS_CATEGORY_POINTS,
  MENS_FIXTURE_GARMENTS,
  MENS_OXFORD_SHIRT,
  MENS_REFERENCE_BODY,
  MENS_STRAIGHT_JEANS,
  MENS_TEST_BODIES,
  MOCK_GARMENTS,
  PILOT_PULL_ON_SKIRT,
  PILOT_SKIRT_CHART_ONLY,
  SYNTHETIC_MENS_CHINO_WL,
  SYNTHETIC_MENS_TEE,
  type GarmentPayload,
  type UserBody,
} from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { computeFit, usesMensTables, wornWaistCm } from './computeFit';
import { CATEGORY_POINTS, MENS_BLOCKS, MENS_CATEGORY_POINTS, POINTS } from './constants';
import { fitSummary } from './summary';
import { deepFreeze, rng } from './test/fixtures';
import { isPointFit, type FitGarment, type FitResult, type PointFit, type SizeFit } from './types';

const MREF = MENS_REFERENCE_BODY;

const size = (r: FitResult, s: string): SizeFit => {
  const f = r.perSize.find((x) => x.size === s);
  if (!f) throw new Error(`no size ${s}`);
  return f;
};
const point = (f: SizeFit, p: string): PointFit => {
  const x = f.points.find((q) => q.point === p);
  if (!x || !isPointFit(x)) throw new Error(`point ${p} not used in ${f.size}`);
  return x;
};
const omitted = (f: SizeFit, p: string) => {
  const x = f.points.find((q) => q.point === p);
  if (!x || isPointFit(x)) throw new Error(`point ${p} is used in ${f.size}`);
  return x.omitted;
};
const withoutAudience = <T extends { audience?: unknown }>(g: T): Omit<T, 'audience'> => {
  const { audience: _a, ...rest } = g;
  return rest;
};

/** Men's tee on a BODY chart, the male family's S…XXL rows (`@curtain/mannequin` MALE table, plan §3). */
const TEE_BODY_CHART: FitGarment = {
  ...SYNTHETIC_MENS_TEE,
  sizeChartType: 'body',
  sizeChart: [
    { size: 'S', bust: 90, waist: 78, hip: 90.5, shoulder: 40 },
    { size: 'M', bust: 98, waist: 86, hip: 96, shoulder: 40.5 },
    { size: 'L', bust: 106, waist: 94, hip: 102, shoulder: 41.5 },
    { size: 'XL', bust: 114, waist: 102, hip: 108, shoulder: 42.5 },
    { size: 'XXL', bust: 123, waist: 111, hip: 114.5, shoulder: 43.5 },
  ],
};

describe('M2a: which tables', () => {
  it("audience 'men' always, 'unisex' only on the male body, 'women' and absent never", () => {
    expect(usesMensTables({ audience: 'men' })).toBe(true);
    expect(usesMensTables({ audience: 'men' }, { bodyFamily: 'female' })).toBe(true);
    expect(usesMensTables({ audience: 'unisex' })).toBe(false);
    expect(usesMensTables({ audience: 'unisex' }, { bodyFamily: 'male' })).toBe(true);
    expect(usesMensTables({ audience: 'women' }, { bodyFamily: 'male' })).toBe(false);
    expect(usesMensTables({}, { bodyFamily: 'male' })).toBe(false);
  });
});

describe('MT1 men’s tee, body chart S…XXL × MREF', () => {
  const r = computeFit(deepFreeze(structuredClone(TEE_BODY_CHART)), MREF);
  it('recommends M with score 1, chest / waist / shoulder scored, seat not', () => {
    expect(r.recommendedSize).toBe('M');
    expect(r.score).toBe(1);
    expect(r.fits).toBe(true);
    expect(r.mens).toBe(true);
    const m = size(r, 'M');
    expect(m.points.map((p) => p.point)).toEqual(['bust', 'waist', 'shoulder']);
    // Tee ease 8 [A] × stretch factor (1 − 8/40) = 6.4; body chart: chart + 8 against body + 6.4.
    expect(point(m, 'bust')).toMatchObject({ gapCm: 1.6, band: 'good', easeTarget: 6.4, chartCm: 106 });
    expect(point(m, 'waist')).toMatchObject({ gapCm: 1.6, band: 'good' });
    expect(point(m, 'shoulder')).toMatchObject({ gapCm: 0.2, band: 'good', easeTarget: 0.8 });
    expect(r.notes).toEqual(['Size M fits you well.']);
  });
});

describe('MT2 the M1 synthetic tee (garment chart) × MREF', () => {
  const r = computeFit(SYNTHETIC_MENS_TEE, MREF);
  it('recommends M; the shoulder seam is read against biacromial + 3.5 [A]', () => {
    expect(r.recommendedSize).toBe('M');
    expect(r.fits).toBe(true);
    const m = size(r, 'M');
    expect(point(m, 'bust')).toMatchObject({ gapCm: 1.6, band: 'good' });
    expect(point(m, 'waist')).toMatchObject({ gapCm: 1.6, band: 'good' });
    // 44 cm seam against biacromial 40.5 + seam offset 3.5 + ease 0.8: 0.8 under, snug. The chart
    // value is reported as the merchant wrote it (44); the offset sits in the target (4.3). The
    // fixture's shoulder is biacromial + 3.5 exactly and the plan's tee shoulder ease is 1 on top:
    // two assumptions that disagree by 1 cm. Pinned, not fixed (report).
    expect(point(m, 'shoulder')).toMatchObject({ chartCm: 44, easeTarget: 4.3, gapCm: -0.8, band: 'snug' });
    expect(r.notes).toEqual(['Snug at the shoulders']);
  });
  it('the M1 bodies (chest 90 / 98 / 114 with the family’s waist and seat) get S, M and XL', () => {
    const pick = (bust: number, waist: number, hip: number) => computeFit(SYNTHETIC_MENS_TEE, { measurements: { bust, waist, hip } }).recommendedSize;
    expect([pick(90, 78, 90.5), pick(98, 86, 96), pick(114, 102, 108)]).toEqual(['S', 'M', 'XL']);
  });
});

describe('MT3 regression pin: no audience is today’s engine, byte for byte', () => {
  it('MT1 without audience equals MT1 as a women’s garment, and has no men’s fields', () => {
    const plain = computeFit(withoutAudience(TEE_BODY_CHART) as FitGarment, MREF);
    const women = computeFit({ ...TEE_BODY_CHART, audience: 'women' }, MREF);
    expect(plain).toEqual(women);
    expect(plain.mens).toBeUndefined();
    expect(plain.skippedPoints.map((s) => s.point)).toEqual(['waist', 'hip']);
    expect(plain.notes.join(' ')).not.toMatch(/chest/);
  });

  /**
   * sha256 of computeFit over every existing garment × a fixed body set, with and without sigma,
   * computed with the engine BEFORE slice M2 (claude/garment-engine at 8658d21). The men's fixtures
   * appear with the audience removed and with `audience: 'women'`: those must read as before too.
   */
  const PRE_M2: Record<string, string> = {
    'aalter-studio-1|-': '03c02a8f133f2d1b',
    'aalter-studio-2|-': '78da2d59563db06a',
    'rue-marais-dress-01|-': '8f29d6f062b6f79b',
    'noord-dress-01|-': 'b0c99e9ba62b8d15',
    'linde-dress-01|-': '11820b10ad2ae8f0',
    'kaap-dress-01|-': 'b2478efc1011f2ea',
    'velden-dress-01|-': 'a02c6c753cf64e36',
    'rue-marais-dress-02|-': 'b2d98274fa862ee4',
    'monochrome-02|-': '61ae35b6052a2398',
    'monochrome-03|-': '5528c1d4277441b2',
    'brouwer-knit-01|-': 'a4e413dbdf0c7dcd',
    'noord-top-01|-': '895869a310afc193',
    'linde-top-01|-': '80d935983415646d',
    'velden-top-01|-': 'bed52bba85c54459',
    'kaap-top-01|-': '3855cb1e563437be',
    'rue-marais-top-01|-': '5b75c5cca116902d',
    'aalter-top-01|-': '579a9d1df0155b14',
    'raw-denim-01|-': '6311a55194b2e5fc',
    'indigo-02|-': '2070039e323094e6',
    'indigo-03|-': '8cb2fea286888a79',
    'noord-bottom-01|-': 'c4146b4b7b88c50b',
    'kaap-bottom-01|-': '2ecc3d7adfc2e92f',
    'velden-bottom-01|-': '4aeb75c9f9d5da5e',
    'rue-marais-bottom-01|-': '8ccef4e4c58249c8',
    'linde-bottom-01|-': 'aa2197737280da0b',
    'ostend-01|-': 'd2f530ee043965e3',
    'ostend-02|-': '27e93588d7508e00',
    'ostend-03|-': 'b66b75f064a0762b',
    'indigo-04|-': 'df64b0cba84c0233',
    'velden-outer-01|-': 'fbe5252e7000c93f',
    'aalter-outer-01|-': '6f52a211dde1a0cf',
    'sole-01|-': '8fbf2fea5575bf53',
    'sole-02|-': '0d2aaa52de750495',
    'velden-shoe-01|-': '8da06e1d7858a917',
    'sole-03|-': '479d2c77e1498811',
    'sole-04|-': '6151d965f6aac17c',
    'haven-01|-': '6d2ebb59dc818c28',
    'haven-02|-': '1fafe9faeb1cb622',
    'haven-03|-': '1fafe9faeb1cb622',
    'haven-04|-': '1fafe9faeb1cb622',
    'haven-05|-': '3887da4f2faf291e',
    '10894387020081|-': '4faf55a0d06d4c59',
    '10894387020081|-+': '18c701c6c8c31f59',
    'noordman-shirt-01|-': '945e52807a430141',
    'noordman-jeans-01|-': '00bec36a72105c01',
    'synthetic-men-tee|-': 'c6cbb6ad6ac645fa',
    'noordman-shirt-01|women': '945e52807a430141',
    'noordman-jeans-01|women': '00bec36a72105c01',
    'synthetic-men-tee|women': 'c6cbb6ad6ac645fa',
  };
  const BODIES: UserBody[] = [
    { measurements: { bust: 88, waist: 70, hip: 96, shoulder: 38 }, confidence: { bust: 0.95, waist: 0.95, hip: 0.95, shoulder: 0.6 } },
    { measurements: { bust: 82, waist: 64, hip: 90, thigh: 52, inseam: 78, footEu: 38 } },
    { measurements: { bust: 104, waist: 92, hip: 112, shoulder: 41, thigh: 64, inseam: 80, footLengthCm: 25.5 } },
    ...MENS_TEST_BODIES.map((b) => b.body),
    { measurements: { bust: 98, waist: 86, hip: 96, shoulder: 40.5, thigh: 58.5, inseam: 84 } },
    { measurements: { bust: 104, waist: 114, hip: 108 } },
    { measurements: { bust: 100, waist: 104, hip: 100 } },
  ];
  const SIGMA = { bust: 2, waist: 2.5, hip: 2, thigh: 3, inseam: 1.5 };
  const garments: FitGarment[] = [
    ...MOCK_GARMENTS,
    PILOT_SKIRT_CHART_ONLY,
    PILOT_PULL_ON_SKIRT,
    ...MENS_FIXTURE_GARMENTS.map((g) => withoutAudience(g) as FitGarment),
    withoutAudience(SYNTHETIC_MENS_TEE) as FitGarment,
    ...MENS_FIXTURE_GARMENTS.map((g): FitGarment => ({ ...g, audience: 'women' })),
    { ...SYNTHETIC_MENS_TEE, audience: 'women' },
  ];
  const hash = (g: FitGarment): string => {
    const runs: FitResult[] = [];
    for (const b of BODIES) {
      runs.push(computeFit(g, b));
      runs.push(computeFit(g, b, { sigma: SIGMA }));
    }
    return createHash('sha256').update(JSON.stringify(runs)).digest('hex').slice(0, 16);
  };
  const keyed: (readonly [string, FitGarment])[] = [];
  for (const g of garments) {
    // The two pilot skirts share an id: the second one's key gets a '+'.
    let key = `${g.id}|${g.audience ?? '-'}`;
    while (keyed.some(([k]) => k === key)) key += '+';
    keyed.push([key, g]);
  }
  it('covers every pre-M2 entry', () => expect(keyed.map(([k]) => k).sort()).toEqual(Object.keys(PRE_M2).sort()));
  it.each(keyed)('%s', (key, g) => {
    expect(PRE_M2[key], `no pre-M2 hash for ${key}`).toBeDefined();
    expect(hash(g)).toBe(PRE_M2[key]);
  });
});

describe('MT4 tee one size up × MREF', () => {
  it('reads "Roomy at the chest", never "bust"', () => {
    const up = computeFit({ ...TEE_BODY_CHART, sizeChart: TEE_BODY_CHART.sizeChart.slice(2) }, MREF);
    expect(up.closestSize).toBe('L');
    expect(up.notes).toContain('Roomy at the chest');
    expect(up.notes.join(' ')).not.toMatch(/bust/i);
    expect(fitSummary(up)).toMatch(/roomy at the chest/);
  });
});

describe('MT5 belly-aware reading', () => {
  it('chest 100 / waist 104 × tee: M is tight at the waist, a larger size is recommended and says why', () => {
    const r = computeFit(TEE_BODY_CHART, { measurements: { bust: 100, waist: 104, hip: 100 } });
    expect(point(size(r, 'M'), 'waist').band).toBe('tight');
    expect(r.recommendedSize).toBe('XL');
    expect(r.fits).toBe(true);
    expect(r.waistLed).toBe(true);
    expect(point(size(r, 'XL'), 'bust')).toMatchObject({ band: 'good', waistLedCm: 16 });
    expect(r.notes).toContain('Sized to fit your waist — roomier at the chest');
  });
  it('chest 104 / waist 114 is no longer given a chest-only size without a word (before M2: Oxford L, tee M)', () => {
    const body: UserBody = { measurements: { bust: 104, waist: 114, hip: 108 } };
    const tee = computeFit(SYNTHETIC_MENS_TEE, body);
    expect(tee.recommendedSize).toBe('XXL');
    expect(tee.waistLed).toBe(true);
    expect(tee.notes).toEqual(expect.arrayContaining(['Snug at the waist', 'Sized to fit your waist — roomier at the chest']));
    const shirt = computeFit(MENS_OXFORD_SHIRT, body);
    expect(shirt.recommendedSize).toBe('3XL');
    expect(shirt.waistLed).toBe(true);
    // As a women's garment (today's tables) the same body still gets the chest-only answer.
    expect(computeFit(withoutAudience(MENS_OXFORD_SHIRT) as FitGarment, body).recommendedSize).toBe('L');
  });
  it('a body with the garment’s own chest-to-waist drop gets no widening', () => {
    const r = computeFit(TEE_BODY_CHART, MREF);
    for (const s of r.perSize) {
      const b = s.points.find((p) => p.point === 'bust');
      if (b && isPointFit(b) && s.size !== 'S') expect(b.waistLedCm, s.size).toBeUndefined();
    }
    expect(r.waistLed).toBeUndefined();
  });
  it('a waist past the largest size: nothing is recommended, the tight waist is said (review of men-m2)', () => {
    const r = computeFit(SYNTHETIC_MENS_TEE, { measurements: { bust: 120, waist: 130 } });
    expect(point(size(r, 'XXL'), 'waist').band).toBe('tight');
    expect(r.recommendedSize).toBeNull();
    expect(r.closestSize).toBe('XXL');
    expect(r.fits).toBe(false);
    expect(r.notes[0]).toBe('No size fits well — closest is XXL, tight at the waist');
  });
  it('a chart column the men’s block has no ease for is skipped as such, not called missing', () => {
    const r = computeFit({ ...SYNTHETIC_MENS_TEE, criticalFitPoints: ['bust', 'hip'] }, MREF);
    expect(r.skippedPoints).toContainEqual({ point: 'hip', reason: 'no-ease', label: 'we have no designed room for it on this kind of garment' });
    expect(r.notes).toContain('Seat not checked: we have no designed room for it on this kind of garment');
    expect(r.notes.join(' ')).not.toMatch(/has no seat measurement/);
  });
  it('a chest-only body is told the waist is missing', () => {
    const r = computeFit(SYNTHETIC_MENS_TEE, { measurements: { bust: 104 } });
    expect(r.notes).toContain("We don't have your waist measurement yet");
  });
});

describe('MT5b unisex', () => {
  const unisex: FitGarment = { ...TEE_BODY_CHART, audience: 'unisex' };
  it('on the male body: the men’s tables and "chest"', () => {
    const r = computeFit(unisex, { measurements: { bust: 98, waist: 92, hip: 96 } }, { bodyFamily: 'male' });
    expect(r.mens).toBe(true);
    expect(size(r, 'M').points.map((p) => p.point)).toEqual(['bust', 'waist', 'shoulder']);
  });
  it('on the female body, or with no body family: today’s output', () => {
    const body: UserBody = { measurements: { bust: 98, waist: 92, hip: 96 } };
    const today = computeFit(withoutAudience(unisex) as FitGarment, body);
    expect(computeFit(unisex, body, { bodyFamily: 'female' })).toEqual(today);
    expect(computeFit(unisex, body)).toEqual(today);
  });
});

describe('MT6 / MT8 / MT9 synthetic W/L chinos (garment chart) × MREF', () => {
  const r = computeFit(deepFreeze(structuredClone(SYNTHETIC_MENS_CHINO_WL)), MREF);
  it('MT8: waist and leg picked on their own, one combined label', () => {
    expect(r.recommendedSize).toBe('34/32');
    expect(r.sizeAxes).toEqual({ waist: '34', leg: '32' });
    expect(r.perSize).toHaveLength(15);
    expect(size(r, '32/34').axes).toEqual({ waist: '32', leg: '34' });
  });
  it('MT6: the band is read at the worn waist (rise 27 → 88.5 cm) plus ease; seat and thigh are scored', () => {
    const w = point(size(r, '34/32'), 'waist');
    // (30 − 27) / (30 − 18) = 0.25 of the way from the natural waist 86 to the seat 96 [A].
    expect(w).toMatchObject({ bodyCm: 88.5, chartCm: 88.5, wornWaist: { riseCm: 27, naturalWaistCm: 86, seatCm: 96 } });
    expect(w.gapCm).toBe(-1.9);
    expect(point(size(r, '34/32'), 'hip').band).toBe('good');
    expect(point(size(r, '34/32'), 'thigh')).toMatchObject({ band: 'good', gapCm: 0.3 });
  });
  it('MT9: inseams 76 / 81 / 86 against inside leg 84 − 3: L32 fits, L30 short, L34 long', () => {
    expect(point(size(r, '34/32'), 'inseam')).toMatchObject({ band: 'good', gapCm: 0, measure: 'length', easeTarget: -3 });
    expect(point(size(r, '34/30'), 'inseam')).toMatchObject({ band: 'short', gapCm: -5, score: 0 });
    expect(point(size(r, '34/34'), 'inseam')).toMatchObject({ band: 'long', gapCm: 5, score: 0 });
    expect(size(r, '34/30').wearable).toBe(false);
    const short = computeFit({ ...SYNTHETIC_MENS_CHINO_WL, sizeChart: SYNTHETIC_MENS_CHINO_WL.sizeChart.filter((row) => row.axes?.leg === '30') }, MREF);
    expect(short.notes).toContain('Short at the leg');
  });
  it('a longer leg moves only the leg axis; a larger waist only the waist axis', () => {
    const tall = computeFit(SYNTHETIC_MENS_CHINO_WL, { ...MREF, measurements: { ...MREF.measurements, inseam: 89 } });
    expect(tall.sizeAxes).toEqual({ waist: '34', leg: '34' });
    const belly = computeFit(SYNTHETIC_MENS_CHINO_WL, { ...MREF, measurements: { ...MREF.measurements, waist: 96, hip: 104 } });
    expect(belly.sizeAxes?.leg).toBe('32');
    expect(Number(belly.sizeAxes?.waist)).toBeGreaterThan(34);
  });
  it('a missing W/L combination: the leg is picked among the picked waist’s rows, and a failing leg is not recommended', () => {
    const chart = SYNTHETIC_MENS_CHINO_WL.sizeChart.filter((row) => row.size !== '34/32');
    const r2 = computeFit({ ...SYNTHETIC_MENS_CHINO_WL, sizeChart: chart }, MREF);
    expect(r2.sizeAxes?.waist).toBe('34');
    expect(r2.closestSize).not.toBe('34/32');
    // 34/30 and 34/34 are 5 cm off, past the ±4 cm fail band [A]: nothing is recommended.
    expect(r2.recommendedSize).toBeNull();
    expect(r2.fits).toBe(false);
    expect(r2.notes[0]).toMatch(/^No size fits well — closest is 34\/(30|34), (short|long) at the leg$/);
  });
  it('inseams that differ per waist: the leg is read from the picked waist’s own rows (review of men-m2)', () => {
    // W34's rows run 5 cm longer than the other waists'; L30 of W34 (81) is the one that fits.
    const chart = SYNTHETIC_MENS_CHINO_WL.sizeChart.map((row) => (row.axes?.waist === '34' ? { ...row, inseam: (row.inseam as number) + 5 } : row));
    const r2 = computeFit({ ...SYNTHETIC_MENS_CHINO_WL, sizeChart: chart }, MREF);
    expect(r2.sizeAxes).toEqual({ waist: '34', leg: '30' });
    expect(r2.recommendedSize).toBe('34/30');
    expect(point(size(r2, '34/30'), 'inseam')).toMatchObject({ band: 'good', gapCm: 0 });
  });
  it('no inseam column, or no inside leg: the waist is picked, no leg is invented, no full size is recommended', () => {
    const noInseam = computeFit({ ...SYNTHETIC_MENS_CHINO_WL, sizeChart: SYNTHETIC_MENS_CHINO_WL.sizeChart.map(({ inseam: _i, ...row }) => row) }, MREF);
    const { inseam: _l, ...noLeg } = MREF.measurements;
    const noBodyLeg = computeFit(SYNTHETIC_MENS_CHINO_WL, { measurements: noLeg });
    for (const r of [noInseam, noBodyLeg]) {
      expect(r.sizeAxes).toEqual({ waist: '34' });
      expect(r.recommendedSize).toBeNull();
      expect(r.fits).toBe(false);
      expect(r.closestSize?.startsWith('34/')).toBe(true);
      expect(r.notes[0]).toBe('Waist 34 is the best match; the leg length could not be checked, so no full size is picked');
    }
  });
  it('no girth columns, or no waist from the shopper: no waist is picked, nothing is recommended', () => {
    const legsOnly = computeFit({ ...SYNTHETIC_MENS_CHINO_WL, sizeChart: SYNTHETIC_MENS_CHINO_WL.sizeChart.map(({ size: s, inseam, axes }) => ({ size: s, inseam, axes })) }, MREF);
    const noGirths = computeFit(SYNTHETIC_MENS_CHINO_WL, { measurements: { inseam: 84 } });
    for (const r of [legsOnly, noGirths]) {
      expect(r.sizeAxes).toBeUndefined();
      expect(r.recommendedSize).toBeNull();
      expect(r.notes[0]).toBe('No W/L size picked: the waist could not be checked');
    }
  });
});

describe('women’s, unisex and audience-less charts that carry the men’s columns (review of men-m2)', () => {
  // Before slice M2 the schema dropped neck, sleeve, length, rise and axes, and `neck` was no fit
  // point: such a chart must read exactly as the same chart without them.
  const MENS_COLUMNS = ['neck', 'sleeve', 'length', 'rise', 'axes'];
  const stripped = (g: FitGarment): FitGarment => ({
    ...g,
    sizeChart: g.sizeChart.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !MENS_COLUMNS.includes(k))) as GarmentPayload['sizeChart'][number]),
    criticalFitPoints: g.criticalFitPoints?.filter((p) => p !== 'neck' && p !== 'sleeve'),
  });
  const withColumns = (g: FitGarment): FitGarment => ({
    ...g,
    sleeveConvention: 'shoulder_point',
    criticalFitPoints: [...(g.criticalFitPoints ?? []), 'neck'],
    sizeChart: g.sizeChart.map((row, i) => ({ ...row, neck: 34 + i, sleeve: 58 + i, length: 60 + 2 * i, rise: 24 })),
  });
  const bodies: UserBody[] = [MREF, { measurements: { bust: 88, waist: 70, hip: 96, shoulder: 38, neck: 33, sleeve: 59 }, heightCm: 168 }];
  const tops = MOCK_GARMENTS.filter((g) => g.id === 'monochrome-02' || g.id === 'monochrome-03');
  it('has the two monochrome tops', () => expect(tops).toHaveLength(2));
  for (const audience of ['women', 'unisex', undefined] as const) {
    it(`audience ${audience ?? 'absent'}: the monochrome tops and the W/L chino read as without the columns`, () => {
      const garments: FitGarment[] = [...tops.map(withColumns), withColumns(SYNTHETIC_MENS_CHINO_WL)].map((g) => {
        const { audience: _a, ...rest } = g;
        return audience === undefined ? (rest as FitGarment) : { ...rest, audience };
      });
      for (const g of garments) {
        for (const b of bodies) {
          const r = computeFit(g, b, audience === 'unisex' ? { bodyFamily: 'female' } : {});
          expect(r).toEqual(computeFit(stripped(g), b));
          expect(r.sizeAxes).toBeUndefined();
          expect(r.notes.join(' ')).not.toMatch(/neck|sleeve|body length/i);
        }
      }
    });
  }
  it('a women’s garment on a men’s block name reads as an unknown block, as before M2', () => {
    for (const block of ['shirt-slim', 'shirt-classic', 'knit', 'sweatshirt']) {
      const g: FitGarment = { ...tops[0]!, patternBlock: block };
      expect(computeFit(g, bodies[1]!)).toEqual(computeFit({ ...tops[0]!, patternBlock: 'no-such-block' }, bodies[1]!));
    }
  });
});

describe('MT7 slim chinos: waist fits, thigh 4 cm under', () => {
  it('thigh is tight, not skipped (today’s `straight` block skips it)', () => {
    const g: FitGarment = {
      ...SYNTHETIC_MENS_CHINO_WL,
      patternBlock: 'slim',
      sizeChart: [{ size: '34', waist: 90.4, hip: 101.8, thigh: 58.3, inseam: 81 }],
    };
    const r = computeFit(g, { measurements: { waist: 86, hip: 96, thigh: 58.5, inseam: 84 } });
    // Slim chino thigh ease 4 [A] × (1 − 2/40) = 3.8: 58.3 − 62.3 = −4.0, past the tight limit −2.5.
    expect(point(size(r, '34'), 'thigh')).toMatchObject({ band: 'tight', gapCm: -4 });
    expect(r.skippedPoints).toEqual([]);
    expect(r.notes).toContain('Tight at the thighs');
  });
});

describe('MT10 W/L labels with no cm column', () => {
  it('no waist score and a "not checked" note', () => {
    const labelsOnly: FitGarment = { ...MENS_STRAIGHT_JEANS, sizeChart: MENS_STRAIGHT_JEANS.sizeChart.map(({ size: s, inseam }) => ({ size: s, inseam })) };
    const r = computeFit(labelsOnly, MREF);
    expect(omitted(r.perSize[0]!, 'waist')).toBe('chart');
    expect(r.notes).toContain('Waist not checked: the size chart has no waist measurement');
    // Nothing is read from the "34/32" label.
    expect(r.perSize.every((s) => !s.points.some((p) => p.point === 'waist' && isPointFit(p)))).toBe(true);
  });
});

const LONG_SLEEVE_TEE: FitGarment = {
  ...SYNTHETIC_MENS_TEE,
  fabric: { ...SYNTHETIC_MENS_TEE.fabric, stretchPct: 20 },
  sleeveConvention: 'shoulder_point',
  sizeChart: SYNTHETIC_MENS_TEE.sizeChart.map((row) => ({ ...row, sleeve: 61.5 })),
};

describe('MT11 / MT12 / MT15 sleeves', () => {
  it('MT11: stretch 20 % does not rescue a sleeve 3 cm short', () => {
    const r = computeFit(LONG_SLEEVE_TEE, MREF);
    expect(point(size(r, 'M'), 'sleeve')).toMatchObject({ band: 'short', gapCm: -3, score: 0.6, measure: 'length' });
    expect(r.notes).toContain('Short at the sleeve');
  });
  it('MT12: a sleeve column without a declared convention is not scored, with a note', () => {
    const { sleeveConvention: _c, ...noConvention } = LONG_SLEEVE_TEE;
    const r = computeFit(noConvention, MREF);
    expect(r.skippedPoints).toEqual([{ point: 'sleeve', reason: 'sleeve-convention', label: 'the size chart does not say where the sleeve is measured from' }]);
    expect(r.notes).toContain('Sleeve not checked: the size chart does not say where the sleeve is measured from');
    expect(size(r, 'M').points.some((p) => p.point === 'sleeve')).toBe(false);
  });
  it('centre_back: the sleeve also spans half the shoulders', () => {
    const cb = computeFit({ ...LONG_SLEEVE_TEE, sleeveConvention: 'centre_back', sizeChart: LONG_SLEEVE_TEE.sizeChart.map((row) => ({ ...row, sleeve: 84.75 })) }, MREF);
    expect(point(size(cb, 'M'), 'sleeve')).toMatchObject({ bodyCm: 84.8, gapCm: 0, band: 'good' });
  });
  it('MT15: MREF without arm length: sleeve omitted, a note, lower confidence (as T10)', () => {
    const full = computeFit(LONG_SLEEVE_TEE, MREF);
    const { sleeve: _s, ...rest } = MREF.measurements;
    const r = computeFit(LONG_SLEEVE_TEE, { measurements: rest });
    expect(omitted(size(r, 'M'), 'sleeve')).toBe('user');
    expect(r.notes).toContain("We don't have your sleeve measurement yet");
    expect(r.confidence).toBeLessThan(full.confidence);
  });
  it('a short-sleeve tee without a sleeve column never asks for the arm', () => {
    const r = computeFit(SYNTHETIC_MENS_TEE, MREF);
    expect(size(r, 'M').points.some((p) => p.point === 'sleeve')).toBe(false);
  });
});

describe('MT13 low-rise jeans × MREF', () => {
  it('the waistband is compared with the girth at the worn height', () => {
    const g: FitGarment = {
      ...SYNTHETIC_MENS_CHINO_WL,
      fabric: { primary: 'denim', stretchPct: 2, drape: 0.2 },
      sizeChart: [{ size: '34/32', waist: 95, hip: 104, thigh: 62, rise: 22, inseam: 81, axes: { waist: '34', leg: '32' } }],
    };
    const w = point(computeFit(g, MREF).perSize[0]!, 'waist');
    expect(wornWaistCm(86, 96, 22)).toBeCloseTo(92.667, 3);
    expect(w).toMatchObject({ bodyCm: 92.7, wornWaist: { riseCm: 22 } });
    // A body chart is the brand's body: no worn-waist shift.
    const body = computeFit({ ...MENS_STRAIGHT_JEANS }, MREF);
    expect(point(size(body, '34/32'), 'waist').wornWaist).toBeUndefined();
  });
  it('without the seat, the natural waist is used', () => {
    const { hip: _h, ...noSeat } = MREF.measurements;
    const w = point(size(computeFit(SYNTHETIC_MENS_CHINO_WL, { measurements: noSeat }), '34/32'), 'waist');
    expect(w.bodyCm).toBe(86);
    expect(w.wornWaist).toBeUndefined();
  });
});

describe('MT14 collars (spec only; live with shirts in M7)', () => {
  const collar = (type: 'garment' | 'body'): FitGarment => ({
    ...MENS_OXFORD_SHIRT,
    sizeChartType: type,
    criticalFitPoints: ['neck'],
    sizeChart: [
      { size: '39', neck: 39 },
      { size: '40', neck: 40 },
      { size: '41', neck: 41 },
    ],
  });
  const body: UserBody = { measurements: { neck: 39.5 } };
  it('MT14a garment chart 39/40/41 × neck 39.5: 41 with ease 1.5; 39 is tight', () => {
    const r = computeFit(collar('garment'), body);
    expect(r.recommendedSize).toBe('41');
    expect(point(size(r, '41'), 'neck')).toMatchObject({ gapCm: 0, band: 'good', easeTarget: 1.5 });
    expect(point(size(r, '39'), 'neck').band).toBe('tight');
  });
  it('MT14b body chart (the label is the body neck) 39/40/41 × neck 39.5: 40', () => {
    expect(computeFit(collar('body'), body).recommendedSize).toBe('40');
  });
});

describe('garment body length of a men’s top (slice M2b)', () => {
  it('is read against 0.41 × stature [A] only when the chart has the column and the shopper gave a height', () => {
    const g: FitGarment = { ...SYNTHETIC_MENS_TEE, sizeChart: SYNTHETIC_MENS_TEE.sizeChart.map((row, i) => ({ ...row, length: 68 + 1.5 * i })) };
    const r = computeFit(g, MREF);
    // 0.41 × 174 = 71.34; M length 69.5 → −1.8, good.
    expect(point(size(r, 'M'), 'length')).toMatchObject({ band: 'good', gapCm: -1.8, measure: 'length' });
    const { heightCm: _h, ...noHeight } = MREF;
    expect(omitted(size(computeFit(g, noHeight), 'M'), 'length')).toBe('user');
  });
});

describe('MT16 purity: 1000 random men’s bodies and two-axis charts', () => {
  const next = rng(20261119);
  const between = (lo: number, hi: number): number => Math.round((lo + next() * (hi - lo)) * 10) / 10;
  const randomBody = (): UserBody => {
    const m: UserBody['measurements'] = {};
    const ranges: Record<string, [number, number]> = { bust: [80, 140], waist: [65, 140], hip: [80, 135], shoulder: [36, 50], thigh: [45, 80], inseam: [70, 92], neck: [34, 50], sleeve: [55, 72] };
    for (const [k, [lo, hi]] of Object.entries(ranges)) if (next() < 0.8) (m as Record<string, number>)[k] = between(lo, hi);
    const body: UserBody = { measurements: m };
    if (next() < 0.5) body.heightCm = between(155, 205);
    return body;
  };
  const randomChart = (): FitGarment => {
    const waists = 1 + Math.floor(next() * 6);
    const legs = 1 + Math.floor(next() * 3);
    const rows = [];
    for (let w = 0; w < waists; w++) {
      for (let l = 0; l < legs; l++) {
        const row: Record<string, unknown> = { size: `${30 + 2 * w}/${30 + 2 * l}`, axes: { waist: String(30 + 2 * w), leg: String(30 + 2 * l) } };
        if (next() < 0.9) row.waist = 76 + 5 * w + between(-1, 1);
        if (next() < 0.7) row.hip = 98 + 5 * w;
        if (next() < 0.7) row.thigh = 58 + 2.5 * w;
        if (next() < 0.5) row.rise = between(20, 31);
        if (next() < 0.9) row.inseam = 76 + 5 * l;
        rows.push(row);
      }
    }
    return { ...SYNTHETIC_MENS_CHINO_WL, sizeChartType: next() < 0.5 ? 'garment' : 'body', sizeChart: rows as GarmentPayload['sizeChart'] };
  };
  it('never throws, every score in [0,1] or null, inputs untouched, deterministic', () => {
    for (let i = 0; i < 1000; i++) {
      const g = deepFreeze(i % 3 === 0 ? { ...LONG_SLEEVE_TEE, sizeChart: LONG_SLEEVE_TEE.sizeChart.map((row) => ({ ...row, neck: 40, length: 70 })) } : randomChart());
      const b = deepFreeze(randomBody());
      const sigma = next() < 0.4 ? { waist: 2.5, inseam: 1.5, sleeve: 2, bust: 2 } : undefined;
      const r = computeFit(g, b, { sigma, bodyFamily: 'male' });
      expect(r).toEqual(computeFit(g, b, { sigma, bodyFamily: 'male' }));
      for (const s of r.perSize) {
        if (s.score !== null) expect(s.score >= 0 && s.score <= 1).toBe(true);
        for (const p of s.points) if (isPointFit(p)) expect(Number.isFinite(p.gapCm) && p.score >= 0 && p.score <= 1).toBe(true);
      }
      if (r.score !== null) expect(r.score >= 0 && r.score <= 1).toBe(true);
      expect(r.confidence >= 0 && r.confidence <= 1).toBe(true);
      if (r.sizeAxes) expect(r.closestSize).toBe(g.sizeChart[r.closestIndex!]!.size);
      expect(r.notes.length).toBeGreaterThan(0);
    }
  });
});

describe('MT17 constants parity', () => {
  it('POINTS === FIT_POINTS, the category tables equal the schema’s', () => {
    expect([...POINTS]).toEqual([...FIT_POINTS]);
    expect(CATEGORY_POINTS).toEqual(SCHEMA_CATEGORY_POINTS);
    expect(MENS_CATEGORY_POINTS).toEqual(SCHEMA_MENS_CATEGORY_POINTS);
  });
  it('the men’s eases are the plan §4 table', () => {
    const ease = Object.fromEntries(Object.entries(MENS_BLOCKS).map(([k, v]) => [k, v.ease]));
    expect(ease).toEqual({
      tee: { bust: 8, waist: 8, shoulder: 1 },
      knit: { bust: 10, waist: 10, shoulder: 1.5 },
      'shirt-slim': { bust: 14, waist: 10, shoulder: 1, neck: 1.5 },
      'shirt-tailored': { bust: 21.5, waist: 16, shoulder: 1, neck: 1.5 },
      'shirt-classic': { bust: 26, waist: 22, shoulder: 1, neck: 1.5 },
      'chino-slim': { waist: 2, hip: 4, thigh: 4 },
      'chino-regular': { waist: 2, hip: 6, thigh: 6 },
      'jeans-slim': { waist: 2, hip: 3, thigh: 3 },
      'jeans-regular': { waist: 2, hip: 5, thigh: 5 },
    });
    for (const b of Object.values(MENS_BLOCKS)) expect(b.skip).toEqual([]);
  });
});
