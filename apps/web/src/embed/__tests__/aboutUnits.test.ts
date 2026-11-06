import { describe, expect, it } from 'vitest';
import { ABOUT_RANGES, EMPTY_ABOUT, normalizeAbout, profileFromAbout, rangeFor, rangeText, setImperialEntry, switchUnits, validateAbout, type AboutField, type AboutForm, type ImperialKey } from '../aboutYou';
import { cmToIn, kgToLb } from '../units';

const metric = (over: Partial<AboutForm> = {}): AboutForm => ({ ...EMPTY_ABOUT, height: '170', weight: '64', ...over });
const typeImperial = (form: AboutForm, entries: Partial<Record<ImperialKey, string>>): AboutForm =>
  Object.entries(entries).reduce((f, [k, v]) => setImperialEntry(f, k as ImperialKey, v), switchUnits(form, 'imperial'));

describe('About you in imperial units', () => {
  it('converts what is typed to the canonical metric values exactly (0.1 precision)', () => {
    const f = typeImperial(EMPTY_ABOUT, { heightFt: '5', heightIn: '7', weight: '140', bust: '36', waist: '30', hip: '40' });
    expect(f.units).toBe('imperial');
    expect(f.height).toBe('170.2'); // 67 in × 2.54 = 170.18
    expect(f.weight).toBe('63.5'); // 140 × 0.45359237 = 63.50
    expect(f.bust).toBe('91.4'); // 91.44
    expect(f.waist).toBe('76.2');
    expect(f.hip).toBe('101.6');
    // the typed text stays as typed
    expect(f.imperial).toMatchObject({ heightFt: '5', heightIn: '7', weight: '140', bust: '36' });
  });

  it('an entry that is empty or not a number leaves the metric value empty', () => {
    expect(typeImperial(metric(), { weight: '' }).weight).toBe('');
    expect(typeImperial(metric(), { weight: 'abc' }).weight).toBe('');
    expect(typeImperial(metric(), { heightFt: '', heightIn: '' }).height).toBe('');
    expect(typeImperial(EMPTY_ABOUT, { heightFt: '6' }).height).toBe('182.9'); // inches optional
  });

  it('metric → imperial → metric never changes the metric values', () => {
    const start = metric({ knowsMeasurements: true, bust: '88', waist: '71.5', hip: '97', inseam: '' });
    const there = switchUnits(start, 'imperial');
    expect(there.imperial).toMatchObject({ heightFt: '5', heightIn: '7', weight: numberText1(kgToLb(64)), bust: numberText1(cmToIn(88)), inseam: '' });
    const back = switchUnits(there, 'metric');
    expect(back).toEqual({ ...start, imperial: there.imperial });
    for (const k of ['height', 'weight', 'bust', 'waist', 'hip', 'inseam'] as const) expect(back[k]).toBe(start[k]);
  });

  it('imperial → metric → imperial keeps the text the shopper typed', () => {
    const typed = typeImperial(EMPTY_ABOUT, { heightFt: '5', heightIn: '4.25', weight: '131.5', waist: '29.75' });
    const roundTrip = switchUnits(switchUnits(typed, 'metric'), 'imperial');
    expect(roundTrip.imperial).toEqual(typed.imperial);
    expect(roundTrip.height).toBe(typed.height);
  });

  it('a value edited in cm since is rewritten in imperial from the new metric value', () => {
    const typed = typeImperial(EMPTY_ABOUT, { heightFt: '5', heightIn: '7', weight: '140' });
    const edited = { ...switchUnits(typed, 'metric'), height: '180' };
    const again = switchUnits(edited, 'imperial');
    expect(again.imperial).toMatchObject({ heightFt: '5', heightIn: '11', weight: '140' });
  });

  it('the fit sees the same body whichever units were used', () => {
    const inMetric = profileFromAbout(metric({ height: '170.2', weight: '63.5' }), 'dress', 1);
    const inImperial = profileFromAbout(typeImperial(EMPTY_ABOUT, { heightFt: '5', heightIn: '7', weight: '140' }), 'dress', 1);
    expect(inImperial).toEqual(inMetric);
  });

  it('normalizes a remembered form saved before units existed', () => {
    const legacy = { ...metric() } as Partial<AboutForm>;
    delete legacy.units;
    delete legacy.imperial;
    const f = normalizeAbout(legacy);
    expect(f.units).toBe('metric');
    expect(f.imperial).toEqual(EMPTY_ABOUT.imperial);
    expect(f.height).toBe('170');
    expect(normalizeAbout({ ...metric(), units: 'furlongs' as never }).units).toBe('metric');
  });
});

describe('validation ranges in both systems', () => {
  it('imperial ranges are the metric ones rounded inwards', () => {
    expect(rangeFor('height', 'imperial')).toEqual([48, 90]);
    expect(rangeFor('weight', 'imperial')).toEqual([67, 551]);
    expect(rangeFor('bust', 'imperial')).toEqual([24, 70]);
    expect(rangeFor('footEu', 'imperial')).toEqual(ABOUT_RANGES.footEu);
    for (const f of Object.keys(ABOUT_RANGES) as AboutField[]) {
      const [lo, hi] = rangeFor(f, 'imperial');
      const toMetric = f === 'footEu' ? (x: number) => x : f === 'weight' ? (x: number) => x * 0.45359237 : (x: number) => x * 2.54;
      expect(toMetric(lo)).toBeGreaterThanOrEqual(ABOUT_RANGES[f][0]);
      expect(toMetric(hi)).toBeLessThanOrEqual(ABOUT_RANGES[f][1]);
    }
  });

  it('messages name the shopper’s units', () => {
    expect(rangeText('height', 'metric')).toBe('Between 120 and 230 cm');
    expect(rangeText('height', 'imperial')).toBe('Between 4 ft 0 in and 7 ft 6 in');
    expect(rangeText('weight', 'imperial')).toBe('Between 67 and 551 lb');
    expect(rangeText('hip', 'imperial')).toBe('Between 24 and 74 in');
    expect(validateAbout(switchUnits(EMPTY_ABOUT, 'imperial'), 'dress')).toEqual({ height: 'Enter your height in feet and inches', weight: 'Enter your weight in lb' });
  });

  it('checks imperial entries on their exact conversion', () => {
    const v = (e: Partial<Record<ImperialKey, string>>) => validateAbout(typeImperial(EMPTY_ABOUT, { heightFt: '5', heightIn: '7', weight: '140', ...e }), 'dress');
    expect(v({})).toEqual({});
    expect(v({ heightFt: '3', heightIn: '6' }).height).toBe('Between 4 ft 0 in and 7 ft 6 in');
    expect(v({ heightFt: '8', heightIn: '0' }).height).toBe('Between 4 ft 0 in and 7 ft 6 in');
    expect(v({ heightIn: '12' }).height).toBe('Inches go from 0 to 11.9');
    expect(v({ heightFt: '5.5', heightIn: '' }).height).toBe('Enter whole feet, e.g. 5 ft 7 in');
    expect(v({ heightFt: 'x' }).height).toBe('Enter a number');
    expect(v({ weight: '60' }).weight).toBe('Between 67 and 551 lb');
    expect(v({ weight: '600' }).weight).toBe('Between 67 and 551 lb');
    expect(v({ weight: '66.2' })).toEqual({}); // 30.03 kg is inside the metric range
    const withTape = (waist: string) => validateAbout(setImperialEntry({ ...typeImperial(EMPTY_ABOUT, { heightFt: '5', heightIn: '7', weight: '140' }), knowsMeasurements: true }, 'waist', waist), 'dress');
    expect(withTape('17').waist).toBe('Between 18 and 70 in');
    expect(withTape('30')).toEqual({});
    expect(withTape('3o').waist).toBe('Enter a number');
  });

  it('the EU shoe size is never converted', () => {
    const shoes = typeImperial({ ...EMPTY_ABOUT, footEu: '39' }, { heightFt: '5', heightIn: '7', weight: '140' });
    expect(validateAbout(shoes, 'shoes')).toEqual({});
    expect(validateAbout({ ...shoes, footEu: '60' }, 'shoes').footEu).toBe('Between 30 and 52 EU');
  });
});

function numberText1(x: number): string {
  return String(Number(x.toFixed(1)));
}
