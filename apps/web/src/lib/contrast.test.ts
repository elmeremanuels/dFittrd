import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, readableTextColor } from './contrast';

describe('contrast (A11Y-2)', () => {
  it('parses short and long hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('1A1612')).toEqual([26, 22, 18]);
    expect(parseHex('red')).toBeNull();
  });

  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FF5A3C', '#F5EFE7')).toBeLessThan(4.5);
  });

  it('keeps a dark brand colour, rejects coral, pastel and invalid colours', () => {
    expect(readableTextColor('#2F4F3A', '#FAF7F3')).toBe('#2F4F3A');
    expect(readableTextColor('#FF5A3C', '#FAF7F3')).toBeNull();
    expect(readableTextColor('#FFE680', '#FAF7F3')).toBeNull();
    expect(readableTextColor('url(x)', '#FAF7F3')).toBeNull();
    expect(readableTextColor(undefined, '#FAF7F3')).toBeNull();
  });
});
