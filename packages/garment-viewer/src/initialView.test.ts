import { describe, expect, it } from 'vitest';
import { initialViewFor } from './initialView';

describe('initialViewFor (D30)', () => {
  it('dresses and tops open at three-quarter (45° azimuth)', () => {
    expect(initialViewFor('dress')).toEqual({ azimuthDeg: 45, elevationDeg: 0 });
    expect(initialViewFor('top')).toEqual({ azimuthDeg: 45, elevationDeg: 0 });
  });

  it('bottoms, outerwear, shoes and accessories open at front (0° azimuth)', () => {
    expect(initialViewFor('bottom')).toEqual({ azimuthDeg: 0, elevationDeg: 0 });
    expect(initialViewFor('outerwear')).toEqual({ azimuthDeg: 0, elevationDeg: 0 });
    expect(initialViewFor('shoes')).toEqual({ azimuthDeg: 0, elevationDeg: 0 });
    expect(initialViewFor('accessory')).toEqual({ azimuthDeg: 0, elevationDeg: 0 });
  });

  it('unknown or missing category opens at front', () => {
    expect(initialViewFor(undefined)).toEqual({ azimuthDeg: 0, elevationDeg: 0 });
    expect(initialViewFor(null)).toEqual({ azimuthDeg: 0, elevationDeg: 0 });
  });
});
