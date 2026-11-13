/**
 * Test vectors T1–T17 of docs/research/fit-engine-spec.md. Expected values are the spec's own
 * numbers; the two places where the spec's arithmetic is off (T9, T17) are documented in
 * README.md §Spec deviations and asserted with the recomputed fixture.
 */
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import type { UserBody } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { computeFit, recommendSize } from './computeFit';
import { JEANS, REF, SLIP, WRAP, deepFreeze } from './test/fixtures';
import { isPointFit, type FitGarment, type FitResult, type PointFit, type SizeFit } from './types';

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
const scores = (r: FitResult) => Object.fromEntries(r.perSize.map((s) => [s.size, s.score]));

describe('T1 reference body × WRAP', () => {
  const r = computeFit(deepFreeze(structuredClone(WRAP)), deepFreeze(structuredClone(REF)));
  it('recommends M with score 1, confidence 0.835', () => {
    expect(r.recommendedSize).toBe('M');
    expect(r.closestSize).toBe('M');
    expect(r.score).toBe(1);
    expect(r.confidence).toBe(0.835);
    expect(r.fits).toBe(true);
    expect(r.tieBreak).toBeNull();
    expect(r.skippedPoints).toEqual([]);
    expect(r.notes).toEqual(['Your shoulders measurement is low-confidence — remeasure to sharpen this']);
  });
  it('per-size scores XS 0.113, S 0.871, M 1, L 0.848', () => {
    expect(scores(r)).toEqual({ XS: 0.113, S: 0.871, M: 1, L: 0.848 });
  });
  it('M points: bust 4.3 good w1.9, waist 2.2 good w0.95 (zone), hip 4.4 good, shoulder 0 good w1.2', () => {
    const m = size(r, 'M');
    expect(m.wearable).toBe(true);
    expect(point(m, 'bust')).toMatchObject({ gapCm: 4.3, band: 'good', weight: 1.9, critical: true, inZone: false });
    expect(point(m, 'waist')).toMatchObject({ gapCm: 2.2, band: 'good', weight: 0.95, inZone: true });
    expect(point(m, 'hip')).toMatchObject({ gapCm: 4.4, band: 'good', weight: 0.95 });
    expect(point(m, 'shoulder')).toMatchObject({ gapCm: 0, band: 'good', weight: 1.2, confidence: 0.6 });
    expect(m.points.map((p) => p.point)).toEqual(['bust', 'waist', 'hip', 'shoulder']);
  });
  it('XS: bust −3.7 tight, hip −3.6 tight, not wearable', () => {
    const xs = size(r, 'XS');
    expect(point(xs, 'bust')).toMatchObject({ gapCm: -3.7, band: 'tight', score: 0 });
    expect(point(xs, 'hip')).toMatchObject({ gapCm: -3.6, band: 'tight' });
    expect(point(xs, 'waist')).toMatchObject({ gapCm: -5.8, band: 'snug', score: 0.7, tightLimit: -6.5 });
    expect(xs.wearable).toBe(false);
  });
  it('is identical for the schema fixture aalter-studio-1', () => {
    const fixture = MOCK_GARMENTS_BY_ID['aalter-studio-1'];
    expect(fixture).toBeDefined();
    expect(computeFit(fixture!, REF)).toEqual(r);
  });
  it('recommendSize is a thin wrapper', () => {
    expect(recommendSize(WRAP, REF)).toEqual({
      recommendedSize: 'M',
      closestSize: 'M',
      score: 1,
      confidence: 0.835,
      fits: true,
      tieBreak: null,
    });
  });
});

describe('T2 same, no confidence map', () => {
  const r = computeFit(WRAP, { measurements: REF.measurements });
  it('M, score 1, confidence 0.774, "Size M fits you well."', () => {
    expect(r.recommendedSize).toBe('M');
    expect(r.score).toBe(1);
    expect(r.confidence).toBe(0.774);
    expect(r.notes).toEqual(['Size M fits you well.']);
    expect(scores(r)).toEqual({ XS: 0.131, S: 0.85, M: 1, L: 0.867 });
  });
});

describe('T3 SLIP × REF', () => {
  const r = computeFit(SLIP, REF);
  it('M, score 1, confidence 0.583, waist skipped, shoulder omitted by chart', () => {
    expect(r.recommendedSize).toBe('M');
    expect(r.score).toBe(1);
    expect(r.confidence).toBe(0.583);
    expect(r.skippedPoints).toEqual([{ point: 'waist', reason: 'pattern-block', label: 'bias cut skims the waist' }]);
    expect(r.notes).toEqual(['Waist not checked: bias cut skims the waist']);
    expect(scores(r)).toEqual({ XS: 0, S: 0, M: 1 });
    expect(point(size(r, 'XS'), 'bust')).toMatchObject({ gapCm: -8, band: 'tight' });
    expect(point(size(r, 'S'), 'bust')).toMatchObject({ gapCm: -4, band: 'tight' });
    expect(omitted(size(r, 'M'), 'shoulder')).toBe('chart');
  });
  it('matches the schema fixture monochrome-02', () => {
    expect(computeFit(MOCK_GARMENTS_BY_ID['monochrome-02']!, REF)).toEqual(r);
  });
});

describe('T4 JEANS × REF', () => {
  const r = computeFit(JEANS, REF);
  it("'28', score 1, confidence 0.595, thigh skipped", () => {
    expect(r.recommendedSize).toBe('28');
    expect(r.score).toBe(1);
    expect(r.confidence).toBe(0.595);
    expect(r.skippedPoints).toEqual([{ point: 'thigh', reason: 'pattern-block', label: 'straight leg does not grip the thigh' }]);
    expect(r.notes).toEqual(['Thighs not checked: straight leg does not grip the thigh']);
  });
  it('27 → 0.35 not wearable (hip −2.4 tight, waist −1.5 snug); 26 → 0', () => {
    const s27 = size(r, '27');
    expect(s27.score).toBe(0.35);
    expect(s27.wearable).toBe(false);
    expect(point(s27, 'hip')).toMatchObject({ gapCm: -2.4, band: 'tight', tightLimit: -2.25 });
    expect(point(s27, 'waist')).toMatchObject({ gapCm: -1.5, band: 'snug' });
    expect(size(r, '26').score).toBe(0);
    expect(omitted(size(r, '28'), 'inseam')).toBe('chart');
  });
  it('matches the schema fixture raw-denim-01', () => {
    expect(computeFit(MOCK_GARMENTS_BY_ID['raw-denim-01']!, REF)).toEqual(r);
  });
});

describe('T5 A-line ignores hip', () => {
  const g: FitGarment = {
    ...WRAP,
    patternBlock: 'a-line',
    ease: undefined,
    criticalFitPoints: ['bust'],
    stretchZones: [],
    sizingNotes: undefined,
    trueToSizeScore: 0.9,
    sizeChart: WRAP.sizeChart.map((row) => ({ ...row, hip: 70 })),
  };
  const r = computeFit(g, REF);
  it('still M, score 1, hip skipped with notes in order', () => {
    expect(r.recommendedSize).toBe('M');
    expect(r.score).toBe(1);
    expect(r.skippedPoints).toEqual([{ point: 'hip', reason: 'pattern-block', label: 'A-line hem flares freely' }]);
    expect(r.notes).toEqual([
      'Hips not checked: A-line hem flares freely',
      'Your shoulders measurement is low-confidence — remeasure to sharpen this',
    ]);
  });
  it('L 0.67 (bust 8.3 roomy, waist 6.2 roomy)', () => {
    const l = size(r, 'L');
    expect(l.score).toBe(0.67);
    expect(point(l, 'bust')).toMatchObject({ gapCm: 8.3, band: 'roomy' });
    expect(point(l, 'waist')).toMatchObject({ gapCm: 6.2, band: 'roomy' });
  });
});

describe('T6 jersey negative ease', () => {
  const g: FitGarment = {
    id: 'bodycon-1',
    brand: 'Knit Co',
    category: 'dress',
    patternBlock: 'bodycon',
    fabric: { primary: 'modal', stretchPct: 30, drape: 0.8 },
    sizeChartType: 'garment',
    sizeChart: [
      { size: 'S', bust: 80, waist: 62, hip: 88 },
      { size: 'M', bust: 86, waist: 68, hip: 94 },
    ],
    criticalFitPoints: ['bust', 'hip'],
    sizingNotes: 'true to size',
    trueToSizeScore: 0.9,
  };
  const r = computeFit(g, REF);
  it('both sizes score 1 (all snug, snugOk via stretch), closest-ease picks M', () => {
    expect(scores(r)).toEqual({ S: 1, M: 1 });
    expect(point(size(r, 'S'), 'bust')).toMatchObject({ gapCm: -8.5, band: 'snug', score: 1, easeTarget: 0.5, tightLimit: -9.5 });
    expect(point(size(r, 'M'), 'bust')).toMatchObject({ gapCm: -2.5, band: 'snug', score: 1 });
    expect(r.recommendedSize).toBe('M');
    expect(r.tieBreak).toBe('closest-ease');
    expect(r.notes).toEqual(['Snug at the bust', 'Snug at the waist', 'Snug at the hips']);
  });
});

describe('T7 nothing fits', () => {
  const r = computeFit(WRAP, { measurements: { bust: 112, waist: 96, hip: 120, shoulder: 44 } });
  it('recommendedSize null, closest L, score 0, notes', () => {
    expect(r.recommendedSize).toBeNull();
    expect(r.closestSize).toBe('L');
    expect(r.score).toBe(0);
    expect(r.fits).toBe(false);
    expect(r.tieBreak).toBeNull();
    expect(r.notes).toEqual([
      'No size fits well — closest is L, tight at the bust',
      'Tight at the bust',
      'Tight at the shoulders',
      'Tight at the waist (stretch zone adjusts)',
      'Tight at the hips',
    ]);
  });
});

describe('T8 sizingNotes tie-break', () => {
  const base: FitGarment = {
    id: 'tie-1',
    brand: 'Tie Brand',
    category: 'dress',
    patternBlock: 'wrap',
    fabric: { primary: 'cotton', stretchPct: 0, drape: 0.5 },
    ease: { bust: 6, waist: 4, hip: 6 },
    sizeChartType: 'body',
    sizeChart: [
      { size: 'S', bust: 88, waist: 68, hip: 96, shoulder: 37 },
      { size: 'M', bust: 91, waist: 71, hip: 99, shoulder: 38 },
    ],
    criticalFitPoints: ['bust'],
    trueToSizeScore: 0.5,
  };
  const user: UserBody = { measurements: { bust: 86, waist: 68, hip: 94, shoulder: 37 } };
  it("'runs small' ⇒ M via sizingNotes", () => {
    const r = computeFit({ ...base, sizingNotes: 'runs small' }, user);
    expect(scores(r)).toEqual({ S: 1, M: 1 });
    expect(r.recommendedSize).toBe('M');
    expect(r.tieBreak).toBe('sizingNotes');
  });
  it("'true to size' ⇒ S via closest-ease", () => {
    const r = computeFit({ ...base, sizingNotes: 'true to size' }, user);
    expect(r.recommendedSize).toBe('S');
    expect(r.tieBreak).toBe('closest-ease');
  });
  it('kept M from the same brand ⇒ M via history', () => {
    const r = computeFit(
      { ...base, sizingNotes: 'true to size' },
      { ...user, history: [{ brand: 'Tie Brand', size: 'M', kept: true }] },
    );
    expect(r.recommendedSize).toBe('M');
    expect(r.tieBreak).toBe('history');
  });
  it('history from another brand or a returned item does not count', () => {
    const r = computeFit(
      { ...base, sizingNotes: 'true to size' },
      { ...user, history: [{ brand: 'Other', size: 'M', kept: true }, { brand: 'Tie Brand', size: 'M', kept: false }] },
    );
    expect(r.recommendedSize).toBe('S');
    expect(r.tieBreak).toBe('closest-ease');
  });
  it("'runs large' ⇒ first candidate", () => {
    const r = computeFit({ ...base, sizingNotes: 'runs large' }, user);
    expect(r.recommendedSize).toBe('S');
    expect(r.tieBreak).toBe('sizingNotes');
  });

  describe('T9 trueToSizeScore widens the tie band (README §Spec deviations: M waist 75, score 0.92)', () => {
    const g: FitGarment = {
      ...base,
      sizingNotes: 'runs small',
      sizeChart: [base.sizeChart[0]!, { size: 'M', bust: 91, waist: 75, hip: 99, shoulder: 38 }],
    };
    it('tts 0.92 (δ 0.062) picks S, M outside the band', () => {
      const r = computeFit({ ...g, trueToSizeScore: 0.92 }, user);
      expect(scores(r)).toEqual({ S: 1, M: 0.92 });
      expect(r.recommendedSize).toBe('S');
      expect(r.tieBreak).toBeNull();
    });
    it("tts 0.5 (δ 0.125) keeps M via 'runs small'", () => {
      const r = computeFit({ ...g, trueToSizeScore: 0.5 }, user);
      expect(r.recommendedSize).toBe('M');
      expect(r.tieBreak).toBe('sizingNotes');
    });
    it('the spec chart (M bust 93) stays in the good band and does not exercise the tie band', () => {
      const spec: FitGarment = { ...g, sizeChart: [base.sizeChart[0]!, { size: 'M', bust: 93, waist: 71, hip: 99, shoulder: 38 }] };
      const r = computeFit({ ...spec, trueToSizeScore: 0.92 }, user);
      expect(point(size(r, 'M'), 'bust')).toMatchObject({ gapCm: 7, band: 'good' });
      expect(scores(r)).toEqual({ S: 1, M: 1 });
    });
  });
});

describe('T10 missing measurement', () => {
  const r = computeFit(WRAP, { measurements: { bust: 88, waist: 70, shoulder: 38 } });
  it("M, score 1, confidence 0.581, hip omitted 'user'", () => {
    expect(r.recommendedSize).toBe('M');
    expect(r.score).toBe(1);
    expect(r.confidence).toBe(0.581);
    expect(omitted(size(r, 'M'), 'hip')).toBe('user');
    expect(r.notes).toEqual(["We don't have your hips measurement yet"]);
  });
});

describe('T11 confidence weighting', () => {
  const r = computeFit(
    { ...WRAP, sizingNotes: undefined, stretchZones: [] },
    { measurements: { bust: 88, waist: 76, hip: 96, shoulder: 38 }, confidence: { waist: 0.3 } },
  );
  it("'L', score 0.851, notes; M 0.698 not wearable", () => {
    expect(r.recommendedSize).toBe('L');
    expect(r.score).toBe(0.851);
    expect(r.notes).toEqual(['Roomy at the bust', 'Your waist measurement is low-confidence — remeasure to sharpen this']);
    const m = size(r, 'M');
    expect(m.score).toBe(0.698);
    expect(m.wearable).toBe(false);
    expect(point(m, 'waist')).toMatchObject({ gapCm: -3.8, band: 'tight', weight: 0.3 });
  });
});

describe('T12 shoes', () => {
  const g: FitGarment = {
    id: 'shoe-1',
    brand: 'Sole',
    category: 'shoes',
    patternBlock: 'sneaker',
    fabric: { primary: 'leather', stretchPct: 0, drape: 0 },
    sizeChartType: 'garment',
    sizeChart: [{ size: '37', footEu: 37 }, { size: '38', footEu: 38 }, { size: '39', footEu: 39 }],
    trueToSizeScore: 0.9,
  };
  it("footEu 38 → '38', score 1, confidence 0.768; 37 snug 0.7, 39 roomy 0.6", () => {
    const r = computeFit(g, { measurements: { footEu: 38 } });
    expect(r.recommendedSize).toBe('38');
    expect(r.score).toBe(1);
    expect(r.confidence).toBe(0.768);
    expect(r.notes).toEqual(['Size 38 fits you well.']);
    expect(point(size(r, '37'), 'foot')).toMatchObject({ gapCm: -0.7, band: 'snug', score: 0.7, easeTarget: 0 });
    expect(point(size(r, '39'), 'foot')).toMatchObject({ gapCm: 0.7, band: 'roomy', score: 0.6 });
  });
  it("scan footLengthCm 24.6 at confidence 0.6 → '39', score 0.7", () => {
    const r = computeFit(g, { measurements: { footLengthCm: 24.6 }, confidence: { foot: 0.6 } });
    expect(r.recommendedSize).toBe('39');
    expect(r.score).toBe(0.7);
    expect(r.tieBreak).toBe('closest-ease');
    expect(point(size(r, '39'), 'foot')).toMatchObject({ easeTarget: 0.7, band: 'snug' });
    expect(r.notes).toEqual(['Snug at the foot', 'Your foot measurement is low-confidence — remeasure to sharpen this']);
  });
});

describe('T13 accessory', () => {
  const g: FitGarment = {
    id: 'belt-1',
    brand: 'Strap',
    category: 'accessory',
    patternBlock: 'belt',
    fabric: { primary: 'leather', stretchPct: 0, drape: 0 },
    sizeChart: [{ size: 'ONE' }],
  };
  it("recommendedSize 'ONE', score null, confidence 0, 'No fit points for this item'", () => {
    const r = computeFit(g, REF);
    expect(r).toMatchObject({
      recommendedSize: 'ONE',
      closestSize: 'ONE',
      score: null,
      confidence: 0,
      fits: false,
      tieBreak: null,
      notes: ['No fit points for this item'],
      skippedPoints: [],
    });
    expect(r.perSize).toEqual([{ size: 'ONE', score: null, wearable: false, points: [] }]);
  });
  it('a merchant critical point on an accessory adds that point', () => {
    const belt: FitGarment = { ...g, criticalFitPoints: ['waist'], sizeChart: [{ size: 'ONE', waist: 72 }], ease: { waist: 2 } };
    const r = computeFit(belt, REF);
    expect(r.score).toBe(1);
    expect(point(size(r, 'ONE'), 'waist')).toMatchObject({ gapCm: 0, critical: true });
  });
});

describe('T14 chart-type normalisation', () => {
  it("'garment' chart × REF → 'L' (S 0.113, M 0.425, L 1)", () => {
    const r = computeFit({ ...WRAP, sizeChartType: 'garment' }, REF);
    expect(r.recommendedSize).toBe('L');
    expect(scores(r)).toMatchObject({ S: 0.113, M: 0.425, L: 1 });
  });
  it("a missing sizeChartType defaults to 'garment'", () => {
    const { sizeChartType: _drop, ...rest } = WRAP;
    expect(computeFit(rest, REF)).toEqual(computeFit({ ...WRAP, sizeChartType: 'garment' }, REF));
  });
});

describe('T15 unknown pattern block', () => {
  it("'mystery' with no ease → category defaults, M, score 1, L 0.772", () => {
    const r = computeFit({ ...WRAP, patternBlock: 'mystery', ease: undefined }, REF);
    expect(r.recommendedSize).toBe('M');
    expect(r.score).toBe(1);
    expect(size(r, 'L').score).toBe(0.772);
    expect(r.skippedPoints).toEqual([]);
  });
});

describe('T17 stretch zone', () => {
  it('WRAP S for REF has waist −1.8 snug, unchanged without the zone', () => {
    const withZone = computeFit(WRAP, REF);
    const noZone = computeFit({ ...WRAP, stretchZones: [] }, REF);
    expect(point(size(withZone, 'S'), 'waist')).toMatchObject({ gapCm: -1.8, band: 'snug', inZone: true });
    expect(point(size(noZone, 'S'), 'waist')).toMatchObject({ gapCm: -1.8, band: 'snug', inZone: false });
  });
  it('waist 78 (gap −9.8) is tight with or without the zone (T −6.5)', () => {
    const u: UserBody = { measurements: { ...REF.measurements, waist: 78 }, confidence: REF.confidence };
    expect(point(size(computeFit(WRAP, u), 'S'), 'waist')).toMatchObject({ gapCm: -9.8, band: 'tight', tightLimit: -6.5 });
    expect(point(size(computeFit({ ...WRAP, stretchZones: [] }, u), 'S'), 'waist')).toMatchObject({ gapCm: -9.8, band: 'tight', tightLimit: -2.5 });
  });
  it('waist 74 (gap −5.8): tight without the zone, snug with it (README §Spec deviations)', () => {
    const u: UserBody = { measurements: { ...REF.measurements, waist: 74 }, confidence: REF.confidence };
    expect(point(size(computeFit({ ...WRAP, stretchZones: [] }, u), 'S'), 'waist')).toMatchObject({ gapCm: -5.8, band: 'tight' });
    expect(point(size(computeFit(WRAP, u), 'S'), 'waist')).toMatchObject({ gapCm: -5.8, band: 'snug' });
  });
  it("the spec's waist 76 (gap −7.8) is below T −6.5 and stays tight", () => {
    const u: UserBody = { measurements: { ...REF.measurements, waist: 76 }, confidence: REF.confidence };
    expect(point(size(computeFit(WRAP, u), 'S'), 'waist')).toMatchObject({ gapCm: -7.8, band: 'tight' });
  });
  it("'stretch-knit' puts every point in a zone; unknown zones are ignored", () => {
    const r = computeFit({ ...WRAP, stretchZones: ['stretch-knit', 'mystery-zone'] }, REF);
    for (const p of size(r, 'M').points) expect(isPointFit(p) && p.inZone).toBe(true);
  });
});

describe('edge cases', () => {
  it('empty chart → nulls and no fit points', () => {
    const r = computeFit({ ...WRAP, sizeChart: [] }, REF);
    expect(r).toMatchObject({ recommendedSize: null, closestSize: null, score: null, confidence: 0, fits: false, perSize: [] });
    expect(r.notes).toEqual(['No fit points for this item']);
  });
  it('chart values of 0 mean not provided', () => {
    const r = computeFit({ ...WRAP, sizeChart: WRAP.sizeChart.map((row) => ({ ...row, hip: 0 })) }, REF);
    expect(omitted(size(r, 'M'), 'hip')).toBe('chart');
    expect(r.recommendedSize).toBe('M');
  });
  it('user values that are 0, negative or NaN are treated as missing', () => {
    const r = computeFit(WRAP, { measurements: { bust: 88, waist: 0, hip: -5, shoulder: Number.NaN } });
    const m = size(r, 'M');
    expect(omitted(m, 'waist')).toBe('user');
    expect(omitted(m, 'hip')).toBe('user');
    expect(omitted(m, 'shoulder')).toBe('user');
    expect(m.score).toBe(1);
  });
  it('negative designed ease is honoured', () => {
    const r = computeFit({ ...WRAP, ease: { bust: -2, waist: 4, hip: 8 }, fabric: { ...WRAP.fabric, stretchPct: 0 } }, REF);
    expect(point(size(r, 'M'), 'bust')).toMatchObject({ easeTarget: -2, gapCm: 4 });
  });
  it('tight-limit floor is −12 cm and ease target reaches 0 at 40 % stretch', () => {
    const r = computeFit({ ...WRAP, fabric: { ...WRAP.fabric, stretchPct: 60 }, stretchZones: [] }, REF);
    expect(point(size(r, 'M'), 'bust')).toMatchObject({ tightLimit: -12, easeTarget: 0 });
  });
  it("'consider sizing up / down' only when a neighbouring size exists", () => {
    const up = computeFit({ ...WRAP, sizeChart: WRAP.sizeChart.slice(0, 2), stretchZones: [] }, {
      measurements: { bust: 100, waist: 70, hip: 96, shoulder: 38 },
    });
    expect(up.notes[0]).toBe('No size fits well — closest is S, tight at the bust');
    expect(up.notes).toContain('Tight at the bust');
    const down = computeFit(WRAP, { measurements: { bust: 70, waist: 70, hip: 96, shoulder: 38 } });
    expect(down.notes.some((n) => n.startsWith('Loose at the bust — consider sizing down'))).toBe(true);
    const upMid = computeFit(WRAP, { measurements: { bust: 97, waist: 70, hip: 96, shoulder: 38 }, confidence: { bust: 0.95 } });
    const m = size(upMid, 'M');
    expect(point(m, 'bust').band).toBe('tight');
  });
  it('loose beyond E + loose + 4 scores 0', () => {
    const r = computeFit({ ...WRAP, stretchZones: [] }, { measurements: { bust: 60, waist: 70, hip: 96, shoulder: 38 } });
    expect(point(size(r, 'L'), 'bust')).toMatchObject({ band: 'loose', score: 0 });
  });
});
