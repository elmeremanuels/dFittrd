import { describe, expect, it } from 'vitest';
import { axisFromHip, blend, morphWeights } from './morphBlend';

describe('morphBlend (R2 spike)', () => {
  it('piecewise weights hit the grid drapes exactly and never extrapolate', () => {
    expect(morphWeights(-1)).toEqual([1, 0]);
    expect(morphWeights(0)).toEqual([0, 0]);
    expect(morphWeights(1)).toEqual([0, 1]);
    expect(morphWeights(-0.4)).toEqual([0.4, 0]);
    expect(morphWeights(2)).toEqual([0, 1]);
    expect(morphWeights(0.5, 'linear')).toEqual([0.5]);
    expect(morphWeights(-3, 'linear')).toEqual([-1]);
  });

  it('maps the chart hip to the axis (AU 8 = -1, AU 12 = 0, AU 16 = 1)', () => {
    expect(axisFromHip(94)).toBeCloseTo(-1);
    expect(axisFromHip(104)).toBeCloseTo(0);
    expect(axisFromHip(100)).toBeCloseTo(-0.4);
  });

  it('blends base plus weighted targets', () => {
    const out = blend([1, 2, 3], [[1, 0, 0], [0, 0, 10]], [0.5, 0.1]);
    expect(Array.from(out)).toEqual([1.5, 2, 4]);
  });
});
