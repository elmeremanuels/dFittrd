import { describe, expect, it } from 'vitest';
import type { FitResult } from '@curtain/fit-engine';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { populationPrior } from '@/features/capture/prior';
import { adviseSize, embedNotes, EMPTY_ABOUT, fitForProfile, fitWithAdvice, measurementFieldsFor, mergeAboutIntoScan, neighbourSizes, priorKeys, profileFromAbout, sizeConfidence, validateAbout, type AboutForm } from '../aboutYou';
import type { GarmentPayload } from '@curtain/schema';

const dress = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
const form = (over: Partial<AboutForm> = {}): AboutForm => ({ ...EMPTY_ABOUT, height: '168', weight: '62', ...over });

describe('About you validation', () => {
  it('requires height and weight', () => {
    expect(validateAbout(EMPTY_ABOUT, 'dress')).toEqual({ height: 'Enter your height in cm', weight: 'Enter your weight in kg' });
    expect(validateAbout(form(), 'dress')).toEqual({});
  });

  it('rejects non-numbers and out-of-range values, accepts a decimal comma', () => {
    expect(validateAbout(form({ height: '1m70' }), 'dress').height).toBe('Enter a number');
    expect(validateAbout(form({ height: '17' }), 'dress').height).toBe('Between 120 and 230 cm');
    expect(validateAbout(form({ weight: '300' }), 'dress').weight).toBe('Between 30 and 250 kg');
    expect(validateAbout(form({ height: '168,5' }), 'dress')).toEqual({});
  });

  it('validates the tape measurements only when the section is open', () => {
    expect(validateAbout(form({ waist: 'abc' }), 'dress')).toEqual({});
    expect(validateAbout(form({ knowsMeasurements: true, waist: 'abc', hip: '400' }), 'dress')).toEqual({ waist: 'Enter a number', hip: 'Between 60 and 190 cm' });
    // inseam only matters for bottoms
    expect(measurementFieldsFor('bottom')).toContain('inseam');
    expect(measurementFieldsFor('dress')).not.toContain('inseam');
    expect(validateAbout(form({ knowsMeasurements: true, inseam: '5' }), 'dress')).toEqual({});
    expect(validateAbout(form({ knowsMeasurements: true, inseam: '5' }), 'bottom').inseam).toBe('Between 50 and 110 cm');
  });
});

describe('prior fill-in', () => {
  it('fills bust / waist / hip from the population prior with a lower confidence', () => {
    const p = profileFromAbout(form({ sex: 'female' }), 'dress', 1000);
    const prior = populationPrior({ heightCm: 168, weightKg: 62, sex: 'female' })!;
    expect(p.measurements.height).toEqual({ mean: 168, sigma: 1, source: 'manual' });
    expect(p.measurements.waist?.source).toBe('prior');
    expect(p.measurements.waist?.mean).toBeCloseTo(prior.waist!.mean, 1);
    expect(priorKeys(p).sort()).toEqual(['bust', 'hip', 'thigh', 'waist']);
  });

  it('typed measurements win over the prior, and the tape toggle tightens sigma', () => {
    const memory = profileFromAbout(form({ knowsMeasurements: true, waist: '70' }), 'dress');
    const tape = profileFromAbout(form({ knowsMeasurements: true, waist: '70', tape: true }), 'dress');
    expect(memory.measurements.waist).toEqual({ mean: 70, sigma: 2.5, source: 'manual' });
    expect(tape.measurements.waist).toEqual({ mean: 70, sigma: 1.5, source: 'manual' });
    expect(priorKeys(tape)).not.toContain('waist');
    // entries in a closed section are ignored
    expect(profileFromAbout(form({ waist: '70' }), 'dress').measurements.waist?.source).toBe('prior');
  });

  it('a prior-only fit is less confident than one with tape measurements', () => {
    const priorOnly = fitForProfile(dress, profileFromAbout(form({ sex: 'female' }), 'dress')).fit;
    const taped = fitForProfile(dress, profileFromAbout(form({ sex: 'female', knowsMeasurements: true, bust: '88', waist: '70', hip: '96', tape: true }), 'dress')).fit;
    expect(priorOnly.confidence).toBeLessThan(taped.confidence);
    expect(priorOnly.perSize.length).toBe(dress.sizeChart.length);
  });
});

describe('fit preference', () => {
  const perSize = (scores: [string, number | null, boolean][]): FitResult['perSize'] => scores.map(([size, score, wearable]) => ({ size, score, wearable, points: [] }));
  const fit = (rec: string | null, sizes: [string, number | null, boolean][]): FitResult => ({
    recommendedSize: rec,
    closestSize: rec ?? sizes[0]![0],
    score: 0.8,
    confidence: 0.7,
    fits: rec !== null,
    perSize: perSize(sizes),
    notes: [],
    tieBreak: null,
    skippedPoints: [],
  });

  it('regular keeps the engine size', () => {
    expect(adviseSize(fit('M', [['S', 0.7, true], ['M', 0.8, true], ['L', 0.75, true]]), 'regular')).toEqual({ size: 'M', closest: 'M', engineSize: 'M', adjusted: null, noPoints: false });
  });

  it('snug / relaxed move one size when that size is wearable and close in score', () => {
    const f = fit('M', [['S', 0.72, true], ['M', 0.8, true], ['L', 0.75, true]]);
    expect(adviseSize(f, 'snug')).toMatchObject({ size: 'S', adjusted: 'down', engineSize: 'M' });
    expect(adviseSize(f, 'relaxed')).toMatchObject({ size: 'L', adjusted: 'up' });
  });

  it('never moves to an unwearable or much worse size', () => {
    expect(adviseSize(fit('M', [['S', 0.79, false], ['M', 0.8, true]]), 'snug').size).toBe('M');
    expect(adviseSize(fit('M', [['M', 0.8, true], ['L', 0.5, true]]), 'relaxed').size).toBe('M');
    expect(adviseSize(fit('M', [['M', 0.8, true]]), 'relaxed').size).toBe('M');
  });

  it('nothing fits → no size, the closest is kept for display', () => {
    expect(adviseSize(fit(null, [['XS', 0.1, false], ['S', 0.2, false]]), 'snug')).toEqual({ size: null, closest: 'XS', engineSize: null, adjusted: null, noPoints: false });
  });

  it('neighbourSizes gives the size and its direct neighbours', () => {
    const f = fit('M', [['XS', 0.5, true], ['S', 0.7, true], ['M', 0.8, true], ['L', 0.75, true], ['XL', 0.6, true]]);
    expect(neighbourSizes(f, 'M').map((s) => s.size)).toEqual(['S', 'M', 'L']);
    expect(neighbourSizes(f, 'XS').map((s) => s.size)).toEqual(['XS', 'S']);
  });
});

describe('garments with no usable fit point (F1)', () => {
  const shoe = { ...dress, id: 'test-shoe', category: 'shoes', sizeChartType: 'body', sizeChart: [{ size: '38', footEu: 38 }, { size: '39', footEu: 39 }, { size: '40', footEu: 40 }] } as unknown as GarmentPayload;

  it('shoes always ask for the shoe size, on the main form', () => {
    expect(measurementFieldsFor('shoes')).toEqual([]);
    expect(validateAbout(form(), 'shoes')).toEqual({ footEu: 'Enter your EU shoe size' });
    expect(validateAbout(form({ footEu: '39' }), 'shoes')).toEqual({});
    expect(profileFromAbout(form({ footEu: '39' }), 'shoes').measurements.footEu?.mean).toBe(39);
  });

  it('a shoe with only height and weight is "cannot recommend yet", never the first size', () => {
    const { fit } = fitForProfile(shoe, profileFromAbout(form(), 'shoes'));
    expect(fit.recommendedSize).toBe('38'); // the engine's placeholder…
    expect(adviseSize(fit, 'regular')).toEqual({ size: null, closest: null, engineSize: null, adjusted: null, noPoints: true }); // …is never shown
  });

  it('a remembered top profile opened on a shoe is "cannot recommend yet"', () => {
    const topProfile = profileFromAbout(form({ knowsMeasurements: true, bust: '90' }), 'top');
    expect(adviseSize(fitForProfile(shoe, topProfile).fit, 'snug').noPoints).toBe(true);
  });

  it('with a shoe size the shoe gets a real recommendation', () => {
    const { fit } = fitForProfile(shoe, profileFromAbout(form({ footEu: '39' }), 'shoes'));
    const advice = adviseSize(fit, 'regular');
    expect(advice.noPoints).toBe(false);
    expect(advice.size).toBe('39');
  });
});

describe('what the result shows after a preference change (F3, COPY-2)', () => {
  const pf = (point: string, band: 'good' | 'loose' | 'snug' | 'tight' | 'roomy', confidence: number) => ({ point, band, confidence, gapCm: 0, score: 1, inZone: false }) as never;
  const fit: FitResult = {
    recommendedSize: 'M',
    closestSize: 'M',
    score: 0.8,
    confidence: 0.5,
    fits: true,
    perSize: [
      { size: 'S', score: 0.75, wearable: true, points: [pf('bust', 'good', 0.8), pf('waist', 'good', 0.8)] },
      { size: 'M', score: 0.8, wearable: true, points: [pf('bust', 'good', 0.5), pf('waist', 'loose', 0.5)] },
      { size: 'L', score: 0.6, wearable: true, points: [pf('bust', 'roomy', 0.5), pf('waist', 'loose', 0.5)] },
    ],
    notes: ['Loose at the waist — consider sizing down'],
    tieBreak: 'sizingNotes',
    skippedPoints: [],
  };
  const profile = profileFromAbout(form({ knowsMeasurements: true, bust: '88', waist: '70', hip: '96', tape: true }), 'dress');

  it('shows the advised size\'s own confidence, notes and fit, never the engine pick\'s', () => {
    const advice = adviseSize(fit, 'snug');
    expect(advice.size).toBe('S');
    const shown = fitWithAdvice(fit, advice, 'dress', profile);
    expect(shown.recommendedSize).toBe('S');
    expect(shown.score).toBe(0.75);
    // M: mean point confidence 0.5 → 0.5 overall; S: 0.8 → 0.8 (same factor).
    expect(shown.confidence).toBeCloseTo(0.8, 3);
    expect(sizeConfidence(fit, 'S')).toBeCloseTo(0.8, 3);
    expect(shown.notes.join(' ')).not.toMatch(/sizing down|size down/);
    expect(shown.notes).toEqual(['Size S fits you well']);
    expect(shown.tieBreak).toBeNull();
  });

  it('notes are plain words with hints only for what the form can collect', () => {
    const regular = adviseSize(fit, 'regular');
    const priorProfile = profileFromAbout(form(), 'dress');
    const withShoulder: FitResult = { ...fit, perSize: fit.perSize.map((s) => ({ ...s, points: [...s.points, { point: 'shoulder', omitted: 'user' } as never] })) };
    const notes = embedNotes(withShoulder, regular, 'dress', priorProfile);
    expect(notes).toContain('Loose at the waist — consider a size down');
    expect(notes.join(' ')).not.toMatch(/shoulder|remeasure|tie broken|sizingNotes/i);
    expect(notes).toContain('Add your bust and waist measurements under Edit my measurements for a more confident result');
  });
});

describe('camera scan keeps the typed inseam (F5)', () => {
  it('adds About-you entries the scan does not cover; scan values win', () => {
    const about = form({ knowsMeasurements: true, waist: '72', inseam: '81' });
    const scan = { version: 1, measurements: { height: { mean: 169, sigma: 0.5, source: 'scan' }, weight: { mean: 62, sigma: 1, source: 'manual' }, waist: { mean: 74, sigma: 1, source: 'scan' } } } as never;
    const merged = mergeAboutIntoScan(scan, about, 'bottom');
    expect(merged.measurements.inseam?.mean).toBe(81);
    expect(merged.measurements.waist?.mean).toBe(74);
    expect(merged.measurements.height?.mean).toBe(169);
    expect(mergeAboutIntoScan(scan, form(), 'dress')).toBe(scan);
  });
});
