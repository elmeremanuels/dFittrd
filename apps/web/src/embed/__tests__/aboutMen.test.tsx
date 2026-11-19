// @vitest-environment jsdom
/** About you and the result for men's garments (men-3d-plan slice M2): the extra measurements and points. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_CHINO_WL, SYNTHETIC_MENS_TEE, type GarmentPayload } from '@curtain/schema';
import { AboutScreen } from '../EmbedScreens';
import { SizeChartTable } from '../SizeChartTable';
import {
  adviseSize,
  embedNoteList,
  EMPTY_ABOUT,
  fitForProfile,
  gapText,
  measurementFieldsFor,
  pointLabelFor,
  priorKeys,
  profileFromAbout,
  usablePoints,
  validateAbout,
  type AboutForm,
} from '../aboutYou';

afterEach(cleanup);

const form = (over: Partial<AboutForm> = {}): AboutForm => ({ ...EMPTY_ABOUT, height: '176', weight: '80', sex: 'male', ...over });
const LONG_SLEEVE: GarmentPayload = {
  ...SYNTHETIC_MENS_TEE,
  sleeveConvention: 'shoulder_point',
  sizeChart: SYNTHETIC_MENS_TEE.sizeChart.map((r, i) => ({ ...r, sleeve: 63 + i, neck: 38 + i })),
};

describe('men’s fields on About you', () => {
  it('a men’s tee asks chest, waist and shoulder width; neck and arm length only when the chart has them', () => {
    expect(measurementFieldsFor('top', SYNTHETIC_MENS_TEE)).toEqual(['bust', 'waist', 'shoulder']);
    expect(measurementFieldsFor('top', LONG_SLEEVE)).toEqual(['bust', 'waist', 'shoulder', 'neck', 'sleeve']);
    expect(measurementFieldsFor('bottom', SYNTHETIC_MENS_CHINO_WL)).toEqual(['waist', 'hip', 'inseam']);
  });
  it('women’s, unisex and unknown garments ask what they asked before', () => {
    const dress = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    expect(measurementFieldsFor('dress', dress)).toEqual(['bust', 'waist', 'hip']);
    expect(measurementFieldsFor('top', { ...LONG_SLEEVE, audience: 'unisex' })).toEqual(['bust', 'waist', 'hip']);
    expect(measurementFieldsFor('top')).toEqual(['bust', 'waist', 'hip']);
  });
  it('the men’s measurements are validated, typed in only, and never filled from the prior', () => {
    expect(validateAbout(form({ knowsMeasurements: true, neck: '12', sleeve: 'x' }), 'top', LONG_SLEEVE)).toEqual({ neck: 'Between 28 and 60 cm', sleeve: 'Enter a number' });
    const typed = profileFromAbout(form({ knowsMeasurements: true, tape: true, neck: '40', sleeve: '65', shoulder: '42' }), 'top', 0, LONG_SLEEVE);
    expect(typed.measurements.neck).toEqual({ mean: 40, sigma: 1.5, source: 'manual' });
    expect(typed.measurements.sleeve?.source).toBe('manual');
    const empty = profileFromAbout(form({ knowsMeasurements: true }), 'top', 0, LONG_SLEEVE);
    for (const k of ['neck', 'sleeve', 'shoulder'] as const) expect(empty.measurements[k]).toBeUndefined();
    expect(priorKeys(empty)).not.toEqual(expect.arrayContaining(['neck']));
    // A women's garment never stores them, even when typed.
    const dress = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    expect(profileFromAbout(form({ knowsMeasurements: true, neck: '40' }), 'dress', 0, dress).measurements.neck).toBeUndefined();
  });
  it('the form shows the men’s names, how to measure, and the "never estimated" line', () => {
    render(<AboutScreen form={form({ knowsMeasurements: true })} errors={{}} category="top" garment={LONG_SLEEVE} editing={false} canScan={false} onChange={() => {}} onUnits={() => {}} onSubmit={() => {}} />);
    expect(screen.getByLabelText(/^Chest/)).toBeTruthy();
    expect(screen.getByLabelText(/^Shoulder width/)).toBeTruthy();
    expect(screen.getByLabelText(/^Neck/)).toBeTruthy();
    expect(screen.getByLabelText(/^Arm length/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Hip/)).toBeNull();
    expect(screen.getByText('Shoulder bone to wrist, over a bent elbow')).toBeTruthy();
    expect(screen.getByTestId('mens-typed').textContent).toMatch(/never estimate/);
  });
});

describe('men’s result', () => {
  it('the tee: men’s tables, height passed, chest named "Chest"', () => {
    const profile = profileFromAbout(form({ knowsMeasurements: true, tape: true, bust: '98', waist: '86', shoulder: '40.5' }), 'top', 0, SYNTHETIC_MENS_TEE);
    const { fit, userBody } = fitForProfile(SYNTHETIC_MENS_TEE, profile);
    expect(fit.mens).toBe(true);
    expect(userBody.heightCm).toBe(176);
    expect(fit.recommendedSize).toBe('M');
    expect(pointLabelFor('bust', 'men')).toBe('Chest');
    expect(pointLabelFor('bust', undefined)).toBe('Bust');
    const advice = adviseSize(fit, 'regular');
    expect(embedNoteList(fit, advice, 'top', profile, SYNTHETIC_MENS_TEE).map((n) => n.text).join(' ')).not.toMatch(/bust/i);
  });
  it('a women’s garment is fitted exactly as before (no height, no body family)', () => {
    const dress = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    const profile = profileFromAbout(form({ sex: 'female', height: '168', weight: '62' }), 'dress', 0, dress);
    const { fit, userBody } = fitForProfile(dress, profile);
    expect(userBody.heightCm).toBeUndefined();
    expect(fit.mens).toBeUndefined();
  });
  it('chest 104 / waist 114: sized for the waist, and the note says so', () => {
    const profile = profileFromAbout(form({ knowsMeasurements: true, tape: true, bust: '104', waist: '114' }), 'top', 0, SYNTHETIC_MENS_TEE);
    const { fit } = fitForProfile(SYNTHETIC_MENS_TEE, profile);
    expect(fit.recommendedSize).toBe('XXL');
    const notes = embedNoteList(fit, adviseSize(fit, 'regular'), 'top', profile, SYNTHETIC_MENS_TEE).map((n) => n.text);
    expect(notes).toContain('Sized to fit your waist, so it is roomier at the chest');
  });
  it('W/L chinos: waist and leg picked on their own; the inseam reads as a length', () => {
    const profile = profileFromAbout(form({ knowsMeasurements: true, tape: true, waist: '86', hip: '96', inseam: '84' }), 'bottom', 0, SYNTHETIC_MENS_CHINO_WL);
    const { fit } = fitForProfile(SYNTHETIC_MENS_CHINO_WL, profile);
    expect(fit.sizeAxes).toEqual({ waist: '34', leg: '32' });
    const leg = usablePoints(fit.perSize.find((s) => s.size === '34/30')).find((p) => p.point === 'inseam')!;
    expect(gapText(leg)).toBe('5.0 cm shorter than ideal');
    expect(pointLabelFor('hip', 'men')).toBe('Seat');
  });
  it('the size chart names a men’s chest and seat and shows rise and sleeve columns', () => {
    render(<SizeChartTable garment={SYNTHETIC_MENS_CHINO_WL} recommended="34/32" units="metric" />);
    const table = within(screen.getByTestId('size-chart'));
    expect(table.getByText('Seat')).toBeTruthy();
    expect(table.getByText('Rise')).toBeTruthy();
  });
});
