import { describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID, type GarmentPayload } from '@curtain/schema';
import { EMPTY_ABOUT, fitForProfile, profileFromAbout } from '@/embed/aboutYou';
import { bodyGeometry, garmentGeometry, halfWidthFromGirth, isSkirt } from '@/render/body';
import { ASSUMED_BAND_SCENARIOS, assumedBand, bandSweep, fillSizes, gradeFromSample, inputsFromTape, pilotSkirtInputs, ringInputsFor, type TapeMeasurements } from '@/render/ringInputs';
import { ringArcs, ringOverlay, ringOverlayFor, roomText } from '@/render/rings';

/** An AU 8-16 elastic-waist A-line maxi skirt shaped like the pilot product (chart in cm, body chart). */
const SKIRT: GarmentPayload = {
  ...MOCK_GARMENTS_BY_ID['noord-bottom-01']!,
  id: 'crimson-wildflower-maxi-skirt',
  category: 'bottom',
  subcategory: 'maxi-skirt',
  patternBlock: 'a-line',
  lengthCm: {},
  ease: undefined,
  sizeChartType: 'body',
  criticalFitPoints: [],
  stretchZones: ['waistband'],
  sizingNotes: '',
  sizeChart: [
    { size: '8', bust: 85, waist: 67.5, hip: 94 },
    { size: '10', bust: 90, waist: 72.5, hip: 99 },
    { size: '12', bust: 95, waist: 77.5, hip: 104 },
    { size: '14', bust: 100, waist: 82.5, hip: 109 },
    { size: '16', bust: 105, waist: 87.5, hip: 114 },
  ],
} as GarmentPayload;

const BODIES = {
  slim: { height: '165', weight: '54', bust: '82', waist: '64', hip: '90' },
  average: { height: '167', weight: '66', bust: '93', waist: '76', hip: '102' },
  curvy: { height: '166', weight: '82', bust: '106', waist: '86', hip: '116' },
};

function fitFor(g: GarmentPayload, body: keyof typeof BODIES) {
  const profile = profileFromAbout({ ...EMPTY_ABOUT, ...BODIES[body], knowsMeasurements: true, tape: true }, g.category);
  return { profile, ...fitForProfile(g, profile) };
}

/** The shop's tape of the pilot skirt (AU 8, 10 and 14; 12 and 16 not measured). */
const TAPE: TapeMeasurements = {
  sizes: {
    '8': { bandRelaxedCm: 67, bandStretchedCm: 94, hipCm: 112, hemSweepCm: 230 },
    '10': { bandRelaxedCm: 71, bandStretchedCm: 100, hipCm: 122, hemSweepCm: 248 },
    '14': { bandRelaxedCm: 80, bandStretchedCm: 110, hipCm: 126, hemSweepCm: 260 },
  },
};

describe('ring inputs: tape measurements per size, the rest labelled', () => {
  it('grades an ASSUMED sample with the chart step and labels every size assumed', () => {
    expect(gradeFromSample(SKIRT.sizeChart, '12', 70, 'waist')).toEqual({ '8': 60, '10': 65, '12': 70, '14': 75, '16': 80 });
    const mid = assumedBand(SKIRT.sizeChart);
    expect(mid.source).toEqual({ '8': 'assumed', '10': 'assumed', '12': 'assumed', '14': 'assumed', '16': 'assumed' });
    expect(mid).toMatchObject({ closure: 'pull-on', closureSource: 'assumed' });
    expect(mid.relaxedCm['12']).toBe(ASSUMED_BAND_SCENARIOS.mid.relaxedCm);
    expect(assumedBand(SKIRT.sizeChart, 'high').stretchedCm['16']).toBe(ASSUMED_BAND_SCENARIOS.high.stretchedCm + 10);
    // without a tape the pilot skirt falls back to the assumed band and hem, and has no hip input
    const none = pilotSkirtInputs(SKIRT.sizeChart, null);
    expect(none.band?.source['12']).toBe('assumed');
    expect(none.hem?.source['8']).toBe('assumed');
    expect(none.hip).toBeUndefined();
    expect(none.measuredSizes).toEqual([]);
  });

  it('keeps measured sizes, interpolates between them and extrapolates beyond them, labelled per size', () => {
    const t = inputsFromTape(SKIRT.sizeChart, TAPE);
    expect(t.measuredSizes).toEqual(['8', '10', '14']);
    const src = { '8': 'measured', '10': 'measured', '12': 'interpolated', '14': 'measured', '16': 'extrapolated' };
    expect(t.band!.source).toEqual(src);
    expect(t.hip!.source).toEqual(src);
    expect(t.hem!.source).toEqual(src);
    // AU 12 = halfway between AU 10 and AU 14; AU 16 = AU 14 + (AU 14 − AU 10) / 2
    expect(t.band!.relaxedCm).toEqual({ '8': 67, '10': 71, '12': 75.5, '14': 80, '16': 84.5 });
    expect(t.band!.stretchedCm).toEqual({ '8': 94, '10': 100, '12': 105, '14': 110, '16': 115 });
    // the shop's uneven hip steps (112, 122, 126) are kept as measured, not smoothed
    expect(t.hip!.girthCm).toEqual({ '8': 112, '10': 122, '12': 124, '14': 126, '16': 128 });
    expect(t.hip!.belowBandCm).toBeNull();
    expect(t.hem!.sweepCm).toEqual({ '8': 230, '10': 248, '12': 254, '14': 260, '16': 266 });
    expect(t.band).toMatchObject({ closure: 'pull-on', closureSource: 'assumed' });
    expect(inputsFromTape(SKIRT.sizeChart, { ...TAPE, closure: 'zip', hipBelowBandCm: 20 })).toMatchObject({ band: { closure: 'zip', closureSource: 'measured' }, hip: { belowBandCm: 20 } });
  });

  it('extrapolates below the smallest measured size, and steps with the chart from a single sample', () => {
    const above = fillSizes(SKIRT.sizeChart, { '10': 71, '14': 80 }, 'waist');
    expect(above.cm).toEqual({ '8': 66.5, '10': 71, '12': 75.5, '14': 80, '16': 84.5 });
    expect(above.source['8']).toBe('extrapolated');
    const one = fillSizes(SKIRT.sizeChart, { '12': 71 }, 'waist');
    expect(one.cm).toEqual({ '8': 61, '10': 66, '12': 71, '14': 76, '16': 81 });
    expect(one.source).toMatchObject({ '8': 'extrapolated', '12': 'measured', '16': 'extrapolated' });
    expect(fillSizes(SKIRT.sizeChart, {}, 'hip')).toEqual({ cm: {}, source: {} });
    // sizes that are not in the chart are ignored
    expect(fillSizes(SKIRT.sizeChart, { XL: 99, '8': 67 }, 'waist').cm['8']).toBe(67);
  });

  it('a tape without a hem keeps the assumed hem; the pilot skirt is found by id and uses its tape', () => {
    const noHem: TapeMeasurements = { sizes: { '12': { bandRelaxedCm: 71, bandStretchedCm: 99 } } };
    expect(pilotSkirtInputs(SKIRT.sizeChart, noHem).hem?.source['12']).toBe('assumed');
    const pilot = ringInputsFor(SKIRT)!;
    expect(pilot).toEqual(pilotSkirtInputs(SKIRT.sizeChart));
    expect(pilot.band?.source['8']).toBe('measured');
    expect(pilot.hip?.girthCm['8']).toBe(112);
    expect(ringInputsFor({ ...SKIRT, id: '10894387020081' })).toEqual(pilot);
    expect(ringInputsFor({ ...SKIRT, id: 'other' })).toBeNull();
  });
});

describe('band sweep (pull-on: the stretched band must pass over the hips)', () => {
  it('every assumed scenario stretches to at least the chart hip of the same size', () => {
    for (const sc of ['low', 'mid', 'high'] as const) {
      const band = assumedBand(SKIRT.sizeChart, sc);
      for (const row of SKIRT.sizeChart) expect(band.stretchedCm[row.size]!).toBeGreaterThanOrEqual(row.hip!);
    }
  });
  it('reports waist stretch and hip clearance per body and size', () => {
    const mid = assumedBand(SKIRT.sizeChart, 'mid');
    // average body (waist 76, hip 102) in AU 12: band 70-110
    expect(bandSweep(mid, '12', { waist: 76, hip: 102 })).toEqual({ size: '12', relaxedCm: 70, stretchedCm: 110, waistStretch: 0.15, hipClearanceCm: 8 });
    // curvy body (hip 116) in AU 12: band stretches to 110, 6 cm short of the hips
    expect(bandSweep(mid, '12', { waist: 86, hip: 116 })!.hipClearanceCm).toBe(-6);
    expect(bandSweep(mid, 'XXL', { waist: 76, hip: 102 })).toBeNull();
  });
  it('the measured band: stretched, each measured size reaches the chart hip of its own size, hardly more', () => {
    const band = inputsFromTape(SKIRT.sizeChart, TAPE).band!;
    // measured sizes: stretched band minus the chart hip of the same size = 0, +1, +1 cm
    expect(['8', '10', '14'].map((s) => band.stretchedCm[s]! - SKIRT.sizeChart.find((r) => r.size === s)!.hip!)).toEqual([0, 1, 1]);
    // slim (64 / 90) in AU 8: the band is at rest (67 > 64) and passes the hips with 4 cm
    expect(bandSweep(band, '8', { waist: 64, hip: 90 })).toEqual({ size: '8', relaxedCm: 67, stretchedCm: 94, waistStretch: -0.11, hipClearanceCm: 4 });
    // curvy (86 / 116) in AU 16 (extrapolated 84.5-115): 1 cm short of her hips
    expect(bandSweep(band, '16', { waist: 86, hip: 116 })).toMatchObject({ waistStretch: 0.05, hipClearanceCm: -1 });
  });
});

describe('ringOverlay', () => {
  it('takes waist girth, band and room from the fit engine for each size, and grows with the size', () => {
    const { fit, userBody, profile } = fitFor(SKIRT, 'average');
    expect(fit.recommendedSize).toBe('12');
    const at = (size: string) => ringOverlayFor({ garment: SKIRT, fit, size, measurements: userBody.measurements, heightCm: profile.measurements.height?.mean, inputs: ringInputsFor(SKIRT) })!;
    const o12 = at('12');
    const waist = o12.selected.rings.find((r) => r.key === 'waist')!;
    const pf = fit.perSize.find((s) => s.size === '12')!.points.find((p) => p.point === 'waist' && !('omitted' in p)) as { chartCm: number; bodyCm: number; band: string };
    expect(waist.garmentCm).toBe(pf.chartCm);
    expect(waist.band).toBe(pf.band);
    expect(waist.roomCm).toBeCloseTo(pf.chartCm - pf.bodyCm, 1);
    expect(waist.chip).toEqual(['Good fit', `${Math.round(pf.chartCm - pf.bodyCm)} cm room`]);
    // AU 12 was not measured: the band is the straight line between AU 10 and AU 14, and says so
    expect(waist.stretch).toMatchObject({ source: 'interpolated', relaxedCm: 75.5, stretchedCm: 105 });
    expect(waist.basis).toBe('body-chart+ease');
    expect(waist.chipNote).toBe('band 76-105 cm estimated');
    expect(waist.text).toMatch(/estimated, not measured: this size lies between the measured sizes \(8, 10 and 14\) \(interpolated\)/);
    expect(waist.text).toMatch(/size chart body girth plus designed ease: 81 cm/);
    expect(waist.text).not.toMatch(/garment \d+ cm from the size chart/);
    expect(waist.text).toMatch(/passes over hips of 102 cm with 3 cm to spare \(band girth estimated from the measured sizes, pull-on closure assumed\)/);
    expect(o12.notes.join(' ')).toMatch(/Elastic waistband: measured on sizes 8, 10 and 14; size 12 was not measured and is estimated from the sizes on either side \(interpolated\)/);
    expect(o12.ghosts.map((g) => [g.size, g.side])).toEqual([['10', 'smaller'], ['14', 'larger']]);
    const o8 = at('8');
    const o16 = at('16');
    const rx = (o: typeof o8, k: string) => o.selected.rings.find((r) => r.key === k)!.rx;
    for (const k of ['waist', 'hip']) {
      expect(rx(o8, k)).toBeLessThan(rx(o12, k));
      expect(rx(o12, k)).toBeLessThan(rx(o16, k));
    }
    // the measured band and hem of AU 8 say "measured"; AU 16 is beyond the measured sizes
    const w8 = o8.selected.rings.find((r) => r.key === 'waist')!;
    expect(w8.chipNote).toBe('band 67-94 cm measured');
    expect(w8.text).toMatch(/stretched, it is 8 cm smaller than hips of 102 cm, so it may not pull on over them \(band measured, pull-on closure assumed\)/);
    expect(o16.selected.rings.find((r) => r.key === 'waist')!.chipNote).toBe('band 85-115 cm estimated');
    expect(o16.selected.rings.find((r) => r.key === 'waist')!.text).toMatch(/lies outside the measured sizes \(8, 10 and 14\) \(extrapolated\)/);
    // a 2.3-2.7 m hem spread into a ring is wider than the picture: drawn at the edge, and it says so
    const hems = [o8, o12, o16].map((o) => o.selected.rings.find((r) => r.key === 'hem')!);
    expect(hems.map((h) => h.garmentCm)).toEqual([230, 254, 266]);
    expect(hems.map((h) => h.chip[1])).toEqual(['230 cm measured', '254 cm estimated', '266 cm estimated']);
    expect(hems.every((h) => h.clamped && h.chipNote === 'wider than drawn' && /drawn narrower than the real hem/.test(h.text))).toBe(true);
    expect(o8.notes.join(' ')).toMatch(/Hem: measured on the garment on sizes 8, 10 and 14; it is wider than this picture can show/);
    expect(o8.selected.rings.find((r) => r.key === 'waist')!.chip[0]).toBe('Tight');
    expect(o16.selected.rings.find((r) => r.key === 'waist')!.chip[0]).toBe('Loose');
    // first and last size have one ghost
    expect(o8.ghosts.map((g) => g.size)).toEqual(['10']);
    expect(o16.ghosts.map((g) => g.size)).toEqual(['14']);
  });

  it('draws a point the engine skipped (A-line hip) without a tight / loose word', () => {
    const { fit, userBody } = fitFor(SKIRT, 'curvy');
    const hip = ringOverlayFor({ garment: SKIRT, fit, size: '16', measurements: userBody.measurements })!.selected.rings.find((r) => r.key === 'hip')!;
    expect(hip.band).toBeNull();
    expect(hip.chip[0]).toBe('Not checked');
    expect(hip.text).toMatch(/A-line hem flares freely/);
    expect(hip.garmentCm).toBe(114 + 5); // chart row + the engine's designed bottom hip ease
  });

  it('with a tape, the skipped hip is drawn at the measured garment hip: numbers and source, still no tight / loose word', () => {
    const { fit, userBody } = fitFor(SKIRT, 'curvy');
    const at = (size: string) => ringOverlayFor({ garment: SKIRT, fit, size, measurements: userBody.measurements, inputs: ringInputsFor(SKIRT) })!;
    const hip14 = at('14').selected.rings.find((r) => r.key === 'hip')!;
    expect(hip14).toMatchObject({ band: null, garmentCm: 126, bodyCm: 116, roomCm: 10, source: 'measured', basis: 'garment' });
    expect(hip14.chip).toEqual(['Hips', '10 cm room']);
    expect(hip14.chipNote).toBe('skirt 126 cm measured');
    expect(hip14.text).toBe('Hips: the garment is 126 cm around at its hip line (measured on the garment in this size), you 116 cm: 10 cm room; no tight or loose word, A-line hem flares freely');
    const o16 = at('16');
    const hip16 = o16.selected.rings.find((r) => r.key === 'hip')!;
    expect(hip16).toMatchObject({ band: null, garmentCm: 128, source: 'extrapolated' });
    expect(hip16.chipNote).toBe('skirt 128 cm estimated');
    expect(hip16.text).toMatch(/estimated, not measured: this size lies outside the measured sizes \(8, 10 and 14\) \(extrapolated\)/);
    expect(o16.notes.join(' ')).toMatch(/Hips: the ring is the garment’s own girth at its hip line, .*size 16 was not measured.*\(the shop did not say how far below the band\)\. The size advice does not use it\./);
    // the fit engine's result is the same object either way: the tape moves rings, never the advice
    expect(fit.skippedPoints.map((p) => p.point)).toContain('hip');
    // a garment the engine scores at the hip keeps the engine's chart ring and band; the tape is a remark
    const straight = { ...SKIRT, patternBlock: 'straight' } as GarmentPayload;
    const s = fitFor(straight, 'average');
    const scored = ringOverlayFor({ garment: straight, fit: s.fit, size: '12', measurements: s.userBody.measurements, inputs: ringInputsFor(SKIRT) })!.selected.rings.find((r) => r.key === 'hip')!;
    expect(scored.band).not.toBeNull();
    expect(scored.source).toBe('chart');
    expect(scored.text).toMatch(/the garment itself is 124 cm around at its hip line \(estimated, not measured/);
  });

  it('a tight ring sits inside the body outline, a roomy one outside', () => {
    const { fit, userBody, profile } = fitFor(SKIRT, 'curvy');
    const o = ringOverlayFor({ garment: SKIRT, fit, size: '8', measurements: userBody.measurements, heightCm: profile.measurements.height?.mean })!;
    const w = o.selected.rings.find((r) => r.key === 'waist')!;
    expect(w.band).toBe('tight');
    expect(w.rx).toBeLessThan(w.bodyRx!);
    const slim = fitFor(SKIRT, 'slim');
    const loose = ringOverlayFor({ garment: SKIRT, fit: slim.fit, size: '16', measurements: slim.userBody.measurements })!.selected.rings.find((r) => r.key === 'waist')!;
    expect(loose.rx).toBeGreaterThan(loose.bodyRx!);
  });

  it('hem only with an input; tops get a bust ring; shoes get none; unknown size → null', () => {
    const { fit, userBody } = fitFor(SKIRT, 'average');
    expect(ringOverlayFor({ garment: SKIRT, fit, size: '12', measurements: userBody.measurements })!.selected.rings.map((r) => r.key)).toEqual(['waist', 'hip']);
    expect(ringOverlayFor({ garment: SKIRT, fit, size: 'XXL', measurements: userBody.measurements })).toBeNull();
    const dress = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    const d = fitFor(dress, 'average');
    const keys = ringOverlayFor({ garment: dress, fit: d.fit, size: d.fit.closestSize!, measurements: d.userBody.measurements })!.selected.rings.map((r) => r.key);
    expect(keys).toContain('bust');
    const shoe = Object.values(MOCK_GARMENTS_BY_ID).find((g) => g.category === 'shoes')!;
    const s = fitFor(shoe, 'average');
    expect(ringOverlay({ garment: shoe, fit: s.fit, size: shoe.sizeChart[0]!.size, body: bodyGeometry(null), measurements: null })).toBeNull();
  });

  it('a body girth estimated from height and weight is said to be an estimate, rounded', () => {
    const { fit, userBody, profile } = fitFor(SKIRT, 'average');
    const o = ringOverlayFor({ garment: SKIRT, fit, size: '12', measurements: userBody.measurements, heightCm: profile.measurements.height?.mean, estimated: ['waist', 'hip'] })!;
    const w = o.selected.rings.find((r) => r.key === 'waist')!;
    expect(w.bodyEstimated).toBe(true);
    expect(w.chip[1]).toMatch(/^about \d*[02468] cm room$/);
    expect(w.text).toMatch(/you about 76 cm \(estimated from your height and weight\)/);
    expect(o.notes.join(' ')).toMatch(/estimated from your height and weight/);
  });

  it('the drawn skirt hem matches the hem ring', () => {
    const { fit, userBody, profile } = fitFor(SKIRT, 'average');
    const inputs = ringInputsFor(SKIRT)!;
    const o = ringOverlayFor({ garment: SKIRT, fit, size: '12', measurements: userBody.measurements, heightCm: profile.measurements.height?.mean, inputs })!;
    const hem = o.selected.rings.find((r) => r.key === 'hem')!;
    const body = bodyGeometry(userBody.measurements, profile.measurements.height?.mean);
    const g = garmentGeometry({ garment: SKIRT, gaps: null, body, hemSweepCm: inputs.hem!.sweepCm['12'] });
    const xs = [...g.path.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    // the hem corner of the outline is at the ring's half-width; the curve may overshoot it by ~1 cm
    expect(Math.abs(Math.max(...xs) - 100 - hem.rx)).toBeLessThan(3);
  });

  it('formats room and arcs', () => {
    expect(roomText(4.4)).toBe('4 cm room');
    expect(roomText(-6)).toBe('6 cm short');
    expect(roomText(0.2)).toBe('no room');
    expect(roomText(2.54, 'imperial')).toBe('1.0 in room');
    expect(roomText(4.4, 'metric', true)).toBe('about 4 cm room');
    expect(roomText(-6.9, 'metric', true)).toBe('about 6 cm short');
    expect(roomText(0.6, 'metric', true)).toBe('about no room');
    expect(ringArcs(10, 2, 100)).toEqual({ front: 'M 90.0,100.0 A 10.0,2.0 0 0,0 110.0,100.0', back: 'M 90.0,100.0 A 10.0,2.0 0 0,1 110.0,100.0' });
    expect(halfWidthFromGirth(0, 3)).toBe(0);
  });
});

describe('skirts are drawn as one tube, not trousers', () => {
  it('a maxi skirt has no leg paths and hangs to the ankle', () => {
    expect(isSkirt(SKIRT)).toBe(true);
    expect(isSkirt(MOCK_GARMENTS_BY_ID['noord-bottom-01']!)).toBe(false);
    const g = garmentGeometry({ garment: SKIRT, gaps: null, body: bodyGeometry(null) });
    expect(g.extra).toEqual([]);
    expect(g.hemY).toBeGreaterThan(420);
  });
});
