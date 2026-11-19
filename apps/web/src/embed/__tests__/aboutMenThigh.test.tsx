// @vitest-environment jsdom
/**
 * The optional thigh on About you: men's bottoms only, and only when the chart has a thigh column.
 * Typed in, it is stored as 'manual'; left empty, the thigh is the prior's estimate, as it was
 * before the field existed.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_CHINO_WL, SYNTHETIC_MENS_TEE, type GarmentPayload } from '@curtain/schema';
import '@testing-library/jest-dom/vitest';
import { AboutScreen } from '../EmbedScreens';
import {
  ABOUT_RANGES,
  adviseSize,
  embedNoteList,
  EMPTY_ABOUT,
  fitForProfile,
  MENS_ONLY_FIELDS,
  measurementFieldsFor,
  normalizeAbout,
  priorKeys,
  profileFromAbout,
  rangeFor,
  setImperialEntry,
  switchUnits,
  validateAbout,
  type AboutForm,
  type AboutGarment,
} from '../aboutYou';
import { createEmbedStore, EMBED_DB_NAME, EmbedDb } from '../storage';
import { embedStrings } from '../strings';

afterEach(cleanup);

const CHINO = SYNTHETIC_MENS_CHINO_WL;
const DRESS = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
/** The same chart (it has a thigh column) sold as women's and as unisex. */
const WOMENS_BOTTOM: GarmentPayload = { ...CHINO, audience: 'women' };
const UNISEX_BOTTOM: GarmentPayload = { ...CHINO, audience: 'unisex' };
const LONG_SLEEVE: GarmentPayload = {
  ...SYNTHETIC_MENS_TEE,
  sleeveConvention: 'shoulder_point',
  sizeChart: SYNTHETIC_MENS_TEE.sizeChart.map((r, i) => ({ ...r, sleeve: 63 + i, neck: 38 + i })),
};
/**
 * The male table's M (MALE_REFERENCE.M of @curtain/mannequin, which apps/web does not depend on):
 * stature 174, chest 98, waist 86, seat 96, thigh 58.5, inside leg 84. The weight is a round guess
 * that only feeds the prior (the same one scripts/demo-men-chino.mjs types).
 */
const M = { height: '174', weight: '74', bust: '98', waist: '86', hip: '96', inseam: '84', thigh: '58.5' } as const;

const form = (over: Partial<AboutForm> = {}): AboutForm => ({ ...EMPTY_ABOUT, height: '176', weight: '80', sex: 'male', ...over });
const tableM = (over: Partial<AboutForm> = {}): AboutForm =>
  form({ height: M.height, weight: M.weight, knowsMeasurements: true, tape: true, bust: M.bust, waist: M.waist, hip: M.hip, inseam: M.inseam, ...over });
const show = (category: GarmentPayload['category'], garment: AboutGarment, f: AboutForm = form({ knowsMeasurements: true })): void => {
  render(<AboutScreen form={f} errors={{}} category={category} garment={garment} editing={false} canScan={false} onChange={() => {}} onUnits={() => {}} onSubmit={() => {}} />);
};

describe('which garments ask the thigh', () => {
  it('a men’s bottom whose chart has a thigh column: waist, seat, thigh, inside leg', () => {
    expect(measurementFieldsFor('bottom', CHINO)).toEqual(['waist', 'hip', 'thigh', 'inseam']);
  });
  it('a men’s bottom whose chart has no thigh column does not ask it', () => {
    const noThigh: GarmentPayload = { ...CHINO, sizeChart: CHINO.sizeChart.map(({ thigh: _thigh, ...r }) => r) };
    expect(measurementFieldsFor('bottom', noThigh)).toEqual(['waist', 'hip', 'inseam']);
    expect(measurementFieldsFor('bottom', { category: 'bottom', audience: 'men' })).toEqual(['waist', 'hip', 'inseam']);
  });
  it('women’s, unisex and unknown bottoms, dresses and men’s tops ask what they asked before', () => {
    expect(measurementFieldsFor('bottom', WOMENS_BOTTOM)).toEqual(['waist', 'hip', 'inseam']);
    expect(measurementFieldsFor('bottom', UNISEX_BOTTOM)).toEqual(['waist', 'hip', 'inseam']);
    expect(measurementFieldsFor('bottom')).toEqual(['waist', 'hip', 'inseam']);
    expect(measurementFieldsFor('dress', DRESS)).toEqual(['bust', 'waist', 'hip']);
    expect(measurementFieldsFor('top', { ...LONG_SLEEVE, audience: 'unisex' })).toEqual(['bust', 'waist', 'hip']);
    expect(measurementFieldsFor('top')).toEqual(['bust', 'waist', 'hip']);
    expect(measurementFieldsFor('top', SYNTHETIC_MENS_TEE)).toEqual(['bust', 'waist', 'shoulder']);
    expect(measurementFieldsFor('top', LONG_SLEEVE)).toEqual(['bust', 'waist', 'shoulder', 'neck', 'sleeve']);
    // A men's top never asks the thigh, even with a thigh column on its chart.
    const teeWithThigh: GarmentPayload = { ...SYNTHETIC_MENS_TEE, sizeChart: SYNTHETIC_MENS_TEE.sizeChart.map((r) => ({ ...r, thigh: 60 })) };
    expect(measurementFieldsFor('top', teeWithThigh)).toEqual(['bust', 'waist', 'shoulder']);
    expect(measurementFieldsFor('shoes', CHINO)).toEqual([]);
  });
  it('the thigh is not one of the "never estimated" fields: it has a prior', () => {
    expect(MENS_ONLY_FIELDS).toEqual(['neck', 'sleeve', 'shoulder']);
  });
});

describe('validation and units', () => {
  it('optional; a number inside a plausible range', () => {
    expect(ABOUT_RANGES.thigh).toEqual([35, 110]);
    expect(validateAbout(form({ knowsMeasurements: true }), 'bottom', CHINO)).toEqual({});
    expect(validateAbout(form({ knowsMeasurements: true, thigh: '58.5' }), 'bottom', CHINO)).toEqual({});
    expect(validateAbout(form({ knowsMeasurements: true, thigh: '58,5' }), 'bottom', CHINO)).toEqual({});
    expect(validateAbout(form({ knowsMeasurements: true, thigh: '20' }), 'bottom', CHINO)).toEqual({ thigh: 'Between 35 and 110 cm' });
    expect(validateAbout(form({ knowsMeasurements: true, thigh: '111' }), 'bottom', CHINO)).toEqual({ thigh: 'Between 35 and 110 cm' });
    expect(validateAbout(form({ knowsMeasurements: true, thigh: 'x' }), 'bottom', CHINO)).toEqual({ thigh: 'Enter a number' });
  });
  it('is not checked where it is not asked', () => {
    for (const [category, garment] of [['bottom', WOMENS_BOTTOM], ['bottom', UNISEX_BOTTOM], ['top', SYNTHETIC_MENS_TEE], ['dress', DRESS]] as const) {
      expect(validateAbout(form({ knowsMeasurements: true, thigh: 'x' }), category, garment), `${category} ${garment.audience}`).toEqual({});
    }
    expect(validateAbout(form({ knowsMeasurements: false, thigh: 'x' }), 'bottom', CHINO)).toEqual({});
  });
  it('inches work as for the other girths', () => {
    expect(rangeFor('thigh', 'imperial')).toEqual([14, 43]);
    const typed = setImperialEntry(form({ units: 'imperial', knowsMeasurements: true }), 'thigh', '23');
    expect(typed.imperial.thigh).toBe('23');
    expect(typed.thigh).toBe('58.4');
    expect(validateAbout(setImperialEntry(typed, 'heightFt', '5'), 'bottom', CHINO).thigh).toBeUndefined();
    expect(validateAbout(setImperialEntry(typed, 'thigh', '50'), 'bottom', CHINO).thigh).toBe('Between 14 and 43 in');
    expect(profileFromAbout({ ...typed, tape: true }, 'bottom', 0, CHINO).measurements.thigh).toEqual({ mean: 58.4, sigma: 1.5, source: 'manual' });
    // Typed in cm, shown in inches after the switch, and the metric value does not move.
    const switched = switchUnits(form({ knowsMeasurements: true, thigh: '58.5' }), 'imperial');
    expect(switched.imperial.thigh).toBe('23');
    expect(switched.thigh).toBe('58.5');
    expect(setImperialEntry(typed, 'thigh', '').thigh).toBe('');
  });
});

describe('the profile', () => {
  it('typed: stored as manual (tape σ 1.5, memory σ 2.5), and no longer listed as estimated', () => {
    const tape = profileFromAbout(form({ knowsMeasurements: true, tape: true, thigh: '58.5' }), 'bottom', 0, CHINO);
    expect(tape.measurements.thigh).toEqual({ mean: 58.5, sigma: 1.5, source: 'manual' });
    expect(priorKeys(tape)).not.toContain('thigh');
    const memory = profileFromAbout(form({ knowsMeasurements: true, thigh: '58.5' }), 'bottom', 0, CHINO);
    expect(memory.measurements.thigh).toEqual({ mean: 58.5, sigma: 2.5, source: 'manual' });
  });
  it('empty: exactly the profile of before the field existed (the thigh is the prior’s estimate, marked as one)', () => {
    const empty = profileFromAbout(tableM(), 'bottom', 0, CHINO);
    expect(empty.measurements.thigh?.source).toBe('prior');
    expect(priorKeys(empty)).toContain('thigh');
    // The same garment without the field (no thigh column asked): the same profile.
    const asBefore = profileFromAbout(tableM(), 'bottom', 0, { category: 'bottom', audience: 'men' });
    expect(empty.measurements).toEqual(asBefore.measurements);
    // A thigh typed while "I know my measurements" is closed is not used either.
    const closed = profileFromAbout(form({ knowsMeasurements: false, thigh: '58.5' }), 'bottom', 0, CHINO);
    expect(closed.measurements.thigh?.source).toBe('prior');
  });
  it('a women’s or unisex bottom, a dress and a men’s top never store a typed thigh: it stays the prior’s', () => {
    const typed = form({ knowsMeasurements: true, tape: true, thigh: '70' });
    const without = form({ knowsMeasurements: true, tape: true });
    for (const [category, garment] of [['bottom', WOMENS_BOTTOM], ['bottom', UNISEX_BOTTOM], ['dress', DRESS], ['top', SYNTHETIC_MENS_TEE], ['top', LONG_SLEEVE]] as const) {
      const p = profileFromAbout(typed, category, 0, garment);
      expect(p.measurements.thigh?.source, `${category} ${garment.audience}`).toBe('prior');
      expect(p.measurements).toEqual(profileFromAbout(without, category, 0, garment).measurements);
    }
  });
  it('a women’s bottom is fitted exactly as before, whatever sits in the thigh field', () => {
    const base = form({ sex: 'female', height: '168', weight: '62', knowsMeasurements: true, tape: true, waist: '86', hip: '104', inseam: '81' });
    const before = fitForProfile(WOMENS_BOTTOM, profileFromAbout(base, 'bottom', 0, WOMENS_BOTTOM)).fit;
    const after = fitForProfile(WOMENS_BOTTOM, profileFromAbout({ ...base, thigh: '70' }, 'bottom', 0, WOMENS_BOTTOM)).fit;
    expect(after).toEqual(before);
  });
});

describe('the form', () => {
  it('a men’s bottom shows the thigh with how to measure it, between seat and inside leg', () => {
    show('bottom', CHINO);
    const thigh = screen.getByLabelText(/^Thigh/);
    expect(thigh).toHaveAttribute('placeholder', '35–110');
    expect(screen.getByText('Round the fullest part of one thigh, just under the crotch')).toBeTruthy();
    expect(embedStrings().about.labels.thigh).toBe('Thigh');
    expect(embedStrings().about.hintsMen.thigh).toBe('Round the fullest part of one thigh, just under the crotch');
    expect(document.querySelector(`label[for="${thigh.id}"]`)).toHaveTextContent('Thigh (optional)');
    const order = Array.from(document.querySelectorAll('#known-measurements label.eyebrow')).map((l) => l.textContent?.replace(/\s*\(optional\)\s*/, '').trim());
    expect(order).toEqual(['Waist', 'Seat', 'Thigh', 'Inside leg']);
    // The "we never estimate them" line is about neck, arm length and shoulder width only.
    expect(screen.queryByTestId('mens-typed')).toBeNull();
    expect(screen.getByText(embedStrings().about.emptyEstimated)).toBeTruthy();
  });
  it('in inches', () => {
    show('bottom', CHINO, form({ knowsMeasurements: true, units: 'imperial' }));
    expect(screen.getByLabelText(/^Thigh/)).toHaveAttribute('placeholder', '14–43');
  });
  it('no thigh on a men’s top, a women’s or unisex bottom, or a dress', () => {
    for (const [category, garment] of [['top', SYNTHETIC_MENS_TEE], ['top', LONG_SLEEVE], ['bottom', WOMENS_BOTTOM], ['bottom', UNISEX_BOTTOM], ['dress', DRESS]] as const) {
      show(category, garment);
      expect(screen.queryByLabelText(/^Thigh/), `${category} ${garment.audience}`).toBeNull();
      expect(screen.queryByText(embedStrings().about.hintsMen.thigh!)).toBeNull();
      cleanup();
    }
  });
});

describe('the point of it: the male table’s M in the synthetic chino', () => {
  const sizeFor = (f: AboutForm): { size: string | null; profile: ReturnType<typeof profileFromAbout>; fit: ReturnType<typeof fitForProfile>['fit'] } => {
    const profile = profileFromAbout(f, 'bottom', 0, CHINO);
    const fit = fitForProfile(CHINO, profile).fit;
    expect(adviseSize(fit, 'regular').size).toBe(fit.recommendedSize);
    return { size: fit.recommendedSize, profile, fit };
  };
  const addNote = (r: ReturnType<typeof sizeFor>): string => embedNoteList(r.fit, adviseSize(r.fit, 'regular'), 'bottom', r.profile, CHINO).find((n) => n.kind === 'add')?.text ?? '';

  it('measured with a tape: 34/32 without a thigh (the estimate) and 34/32 with the table’s thigh, at a higher confidence', () => {
    const without = sizeFor(tableM());
    expect(without.profile.measurements.thigh).toEqual({ mean: 54.9, sigma: 3, source: 'prior' });
    expect(without.size).toBe('34/32');
    // The estimate is offered for replacement by name, never shown as measured.
    expect(addNote(without)).toMatch(/thigh/i);

    const typed = sizeFor(tableM({ thigh: M.thigh }));
    expect(typed.profile.measurements.thigh).toEqual({ mean: 58.5, sigma: 1.5, source: 'manual' });
    expect(typed.size).toBe('34/32');
    expect(typed.fit.sizeAxes).toEqual({ waist: '34', leg: '32' });
    expect(typed.fit.confidence).toBeGreaterThan(without.fit.confidence);
    expect(addNote(typed)).not.toMatch(/thigh/i);
  });
  it('typed from memory ("Measured with a tape" off, σ 2.5): 36/32 without a thigh, and still 36/32 with it', () => {
    // What the embed recommends today for the table body when the tape switch is left off: the
    // wider σ of the typed waist and seat picks the next waist. Typing the thigh does not change that.
    const without = sizeFor(tableM({ tape: false }));
    expect(without.profile.measurements.thigh?.source).toBe('prior');
    expect(without.size).toBe('36/32');
    const typed = sizeFor(tableM({ tape: false, thigh: M.thigh }));
    expect(typed.profile.measurements.thigh).toEqual({ mean: 58.5, sigma: 2.5, source: 'manual' });
    expect(typed.size).toBe('36/32');
  });
});

describe('remembered', () => {
  it('the typed thigh round-trips with the other typed fields; a form saved before the field existed opens with it empty', async () => {
    const name = `${EMBED_DB_NAME}-thigh-test`;
    const shopId = '00000000-0000-4000-8000-00000000000a';
    const about = setImperialEntry(tableM({ thigh: M.thigh, units: 'imperial' }), 'thigh', '23');
    const profile = profileFromAbout(about, 'bottom', 0, CHINO);
    const s1 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s1.init();
    await s1.saveProfile({ shopId, profile, about, savedAt: 1 });

    const s2 = createEmbedStore({ openDb: () => new EmbedDb(name) });
    await s2.init();
    const back = await s2.loadProfile(shopId);
    expect(back?.about.thigh).toBe('58.4');
    expect(back?.about.imperial.thigh).toBe('23');
    expect(back?.about.waist).toBe('86');
    expect(back?.profile.measurements.thigh).toEqual({ mean: 58.4, sigma: 1.5, source: 'manual' });
    expect(normalizeAbout(back?.about)).toEqual(about);

    const { thigh: _thigh, imperial: { thigh: _in, ...oldImperial }, ...old } = about;
    const opened = normalizeAbout({ ...old, imperial: oldImperial } as Partial<AboutForm>);
    expect(opened.thigh).toBe('');
    expect(opened.imperial.thigh).toBe('');
  });
});
