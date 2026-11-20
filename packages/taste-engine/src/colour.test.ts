import { describe, expect, it } from 'vitest';
import { hexToHsl, hueBin, hueBinFromHsl, parseHex } from './colour';

describe('parseHex', () => {
  it('parses #RGB and #RRGGBB, case-insensitive', () => {
    expect(parseHex('#C97A4F')).toEqual({ r: 201, g: 122, b: 79 });
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('1e2b4d')).toEqual({ r: 30, g: 43, b: 77 });
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('red')).toBeNull();
  });
});

describe('hueBin', () => {
  it('matches the spec examples', () => {
    expect(hueBin('#C97A4F')).toBe('orange');
    expect(hueBin('#EAEAEA')).toBe('white');
    expect(hueBin('#1E2B4D')).toBe('blue');
  });
  it('covers every bin', () => {
    expect(hueBin('#FF0000')).toBe('red');
    expect(hueBin('#FF8800')).toBe('orange');
    expect(hueBin('#FFE000')).toBe('yellow');
    expect(hueBin('#22AA33')).toBe('green');
    expect(hueBin('#20B2AA')).toBe('teal');
    expect(hueBin('#0047AB')).toBe('blue');
    expect(hueBin('#7F00FF')).toBe('purple');
    expect(hueBin('#FF2E88')).toBe('pink');
    expect(hueBin('#AAAAAA')).toBe('neutral-light');
    expect(hueBin('#444444')).toBe('neutral-dark');
    expect(hueBin('#111111')).toBe('black');
    expect(hueBin('#FFFFFF')).toBe('white');
  });
  it('bins boundaries as documented (lightness before saturation, hue ranges half-open)', () => {
    expect(hueBinFromHsl({ h: 345, s: 1, l: 0.5 })).toBe('red');
    expect(hueBinFromHsl({ h: 344.9, s: 1, l: 0.5 })).toBe('pink');
    expect(hueBinFromHsl({ h: 15, s: 1, l: 0.5 })).toBe('orange');
    expect(hueBinFromHsl({ h: 200, s: 1, l: 0.5 })).toBe('blue');
    expect(hueBinFromHsl({ h: 200, s: 0.1, l: 0.5 })).toBe('neutral-light');
    expect(hueBinFromHsl({ h: 200, s: 1, l: 0.9 })).toBe('white');
    expect(hueBinFromHsl({ h: 200, s: 1, l: 0.11 })).toBe('black');
  });
  it('falls back to neutral-light for a malformed hex', () => {
    expect(hueBin('nope')).toBe('neutral-light');
    expect(hexToHsl('nope')).toBeNull();
  });
});
