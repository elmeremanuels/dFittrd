import { describe, expect, it } from 'vitest';
import type { AnchorGaps } from '@curtain/fit-engine';
import type { GradingJson } from '../../src/grading';
import { pushOutOfEllipse, sanitiseMeasurements } from './body';
import { fitLines, heatColor, heatField, placeGarment, HEAT_NEUTRAL } from './fitting';

const grading = {
  format: 'curtain.garment.grading',
  formatVersion: 1,
  productId: 'x',
  baseSize: 'M',
  unit: 'cm',
  morph: { method: 'anchors.gradingMorph', chains: { body: 'radial about +Y', arm: 'radial about the arm axis' }, heights: { chest: 120, waist: 104, hip: 87 } },
  base: { chest: 100, waist: 84, hip: 104 },
  sizes: [
    { size: 'S', step: -1, targets: { chest: 96, waist: 80, hip: 100 }, sources: {} },
    { size: 'M', step: 0, targets: { chest: 100, waist: 84, hip: 104 }, sources: {} },
  ],
  estimates: {},
} as unknown as GradingJson;

type Pt = 'chest' | 'waist';
const gaps = (slack: Partial<Record<Pt, number>>, gap: Partial<Record<Pt, number>>, bands: AnchorGaps['bands'] = { chest: 'tight', waist: 'good' }): AnchorGaps => ({ size: 'S', gaps: gap, bands, easeTargets: {}, slackCm: slack });

describe('placeGarment', () => {
  it('sits at body + slack with room, on the body when stretched, and open only in the fit engine’s tight band', () => {
    const body = { chest: 92, waist: 82, hip: 100 };
    const p = placeGarment(grading, 's', gaps({ chest: 4, waist: -2 }, { chest: -6, waist: -14 }), body);
    expect(p.size).toBe('S');
    const chest = p.anchors.find((a) => a.anchor === 'chest')!;
    const waist = p.anchors.find((a) => a.anchor === 'waist')!;
    expect(chest).toMatchObject({ state: 'room', placedCm: 96, gradedCm: 96 });
    expect(waist).toMatchObject({ state: 'stretched', placedCm: 82, band: 'good' });
    expect(p.placed.hip).toBe(100); // no fit-engine gap: graded girth kept
    expect(placeGarment(grading, 'S', gaps({ waist: -5 }, { waist: -17 }, { waist: 'tight' }), body).anchors[0]!.state).toBe('open');
    expect(() => placeGarment(grading, 'XL', null, body)).toThrow(/not in grading/);
  });

  it('R2: the fit engine decides "does not close"; slack alone never does', () => {
    const body = { chest: 92, waist: 82, hip: 100 };
    // Repro 1: woven, ease target 0, gap -1 → the engine says snug: stretched, not open.
    const snug = placeGarment(grading, 'S', gaps({ waist: -1 }, { waist: -1 }, { waist: 'snug' }), body).anchors[0]!;
    expect(snug.state).toBe('stretched');
    // Repro 2: a large negative slack the engine still bands good (stretchy jersey) stays closed.
    const jersey = placeGarment(grading, 'S', gaps({ waist: -9 }, { waist: -3 }, { waist: 'good' }), body).anchors[0]!;
    expect(jersey.state).toBe('stretched');
    expect(fitLines(gaps({ waist: -9 }, { waist: -3 }, { waist: 'good' }), placeGarment(grading, 'S', gaps({ waist: -9 }, { waist: -3 }, { waist: 'good' }), body)).some((l) => l.tone === 'strain')).toBe(false);
  });

  it('words the gaps and the strain', () => {
    const body = { chest: 92, waist: 86, hip: 100 };
    const g = gaps({ chest: 4, waist: -6 }, { chest: 2.8, waist: -18 }, { chest: 'roomy', waist: 'tight' });
    const lines = fitLines(g, placeGarment(grading, 'S', g, body));
    expect(lines[0]).toMatchObject({ anchor: 'chest', tone: 'room', text: '2.8 cm more room at the chest (roomy).' });
    expect(lines[1]!.tone).toBe('strain');
    expect(lines[1]!.text).toMatch(/^Does not close at the waist: the body is 6 cm larger/);
    expect(fitLines(null, null)).toEqual([]);
  });
});

describe('heat map', () => {
  it('interpolates the gaps between ring heights and fades beyond them', () => {
    const f = heatField(gaps({}, { chest: -4, waist: 2 }), { chest: 120, waist: 104 }, 10);
    expect(f.at(120)).toEqual({ gapCm: -4, weight: 1 });
    expect(f.at(104).gapCm).toBe(2);
    const mid = f.at(112).gapCm;
    expect(mid).toBeGreaterThan(-4);
    expect(mid).toBeLessThan(2);
    expect(f.at(125).weight).toBeCloseTo(0.5, 6);
    expect(f.at(140).weight).toBe(0);
    expect(heatField(null, {}).at(100).weight).toBe(0);
    // shoulder_width (a breadth) is coloured at the shoulder ring's height; inseam (a length) has none.
    const s = heatField({ size: 'S', gaps: { shoulder_width: -2, inseam: 5 }, bands: {}, easeTargets: {}, slackCm: {} }, { shoulder: 140 }, 10);
    expect(s.knots).toEqual([{ x: 140, y: -2 }]);
  });

  it('is red for tension, blue for room, neutral without data', () => {
    const [r1, , b1] = heatColor(-6);
    const [r2, , b2] = heatColor(6);
    expect(r1).toBeGreaterThan(b1);
    expect(b2).toBeGreaterThan(r2);
    expect(heatColor(3, 0)).toEqual([...HEAT_NEUTRAL]);
  });
});

describe('body helpers', () => {
  it('clamps typed measurements and keeps the fallback for junk', () => {
    const fb = { bust: 92, waist: 74, hip: 100 };
    expect(sanitiseMeasurements({ bust: '101.3', waist: 'abc', hip: 500 }, fb)).toEqual({ bust: 101.5, waist: 74, hip: 170 });
  });

  it('pushes a point out of an ellipse along its ray', () => {
    const p = pushOutOfEllipse(5, 0, 10, 6, 0.5)!;
    expect(p[0]).toBeCloseTo(10.5, 6);
    expect(p[1]).toBe(0);
    expect(pushOutOfEllipse(20, 0, 10, 6, 0.5)).toBeNull();
  });
});
