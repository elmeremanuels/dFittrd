import { describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID, type GarmentPayload } from '@curtain/schema';
import { EMPTY_ABOUT, fitForProfile, profileFromAbout } from '@/embed/aboutYou';
import { bodyGeometry, garmentGeometry, halfWidthFromGirth, isSkirt } from '@/render/body';
import { ASSUMED_BAND_SCENARIOS, assumedBand, bandSweep, gradeFromSample, inputsFromTape, pilotSkirtInputs, ringInputsFor } from '@/render/ringInputs';
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

describe('ring inputs (assumed until the founder measures)', () => {
  it('grades a sample measurement with the chart step and labels the source', () => {
    expect(gradeFromSample(SKIRT.sizeChart, '12', 70, 'waist')).toEqual({ '8': 60, '10': 65, '12': 70, '14': 75, '16': 80 });
    const mid = assumedBand(SKIRT.sizeChart);
    expect(mid.source).toBe('assumed');
    expect(mid).toMatchObject({ closure: 'pull-on', closureSource: 'assumed' });
    expect(mid.relaxedCm['12']).toBe(ASSUMED_BAND_SCENARIOS.mid.relaxedCm);
    expect(assumedBand(SKIRT.sizeChart, 'high').stretchedCm['16']).toBe(ASSUMED_BAND_SCENARIOS.high.stretchedCm + 10);
  });
  it('a tape measurement replaces the assumption, and the pilot skirt is found by id', () => {
    const tape = inputsFromTape(SKIRT.sizeChart, { sampleSize: '12', bandRelaxedCm: 71, bandStretchedCm: 99, hemSweepCm: 230 });
    expect(tape.band).toMatchObject({ source: 'measured', relaxedCm: { '12': 71, '8': 61 }, closureSource: 'assumed' });
    expect(inputsFromTape(SKIRT.sizeChart, { sampleSize: '12', bandRelaxedCm: 71, bandStretchedCm: 99, closure: 'zip' }).band).toMatchObject({ closure: 'zip', closureSource: 'measured' });
    expect(tape.hem).toMatchObject({ source: 'measured', sweepCm: { '16': 240 } });
    expect(pilotSkirtInputs(SKIRT.sizeChart, { sampleSize: '12', bandRelaxedCm: 71, bandStretchedCm: 99 }).hem?.source).toBe('assumed');
    expect(ringInputsFor(SKIRT)?.band?.source).toBe('assumed');
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
    expect(waist.stretch).toMatchObject({ source: 'assumed', relaxedCm: 70, stretchedCm: 110 });
    expect(waist.basis).toBe('body-chart+ease');
    expect(waist.chipNote).toBe('band 70-110 cm assumed');
    expect(waist.text).toMatch(/assumed, not measured/);
    expect(waist.text).toMatch(/size chart body girth plus designed ease: 81 cm/);
    expect(waist.text).not.toMatch(/garment \d+ cm from the size chart/);
    expect(waist.text).toMatch(/passes over hips of 102 cm with 8 cm to spare \(band girth and pull-on closure assumed/);
    expect(o12.ghosts.map((g) => [g.size, g.side])).toEqual([['10', 'smaller'], ['14', 'larger']]);
    const o8 = at('8');
    const o16 = at('16');
    const rx = (o: typeof o8, k: string) => o.selected.rings.find((r) => r.key === k)!.rx;
    for (const k of ['waist', 'hip', 'hem']) {
      expect(rx(o8, k)).toBeLessThan(rx(o12, k));
      expect(rx(o12, k)).toBeLessThan(rx(o16, k));
    }
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
