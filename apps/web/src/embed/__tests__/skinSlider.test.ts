import { describe, expect, it } from 'vitest';
import { MONK_SWATCHES } from '@/features/capture/faceSkin';
import { lookForMonk, lookForSlider, parseLook } from '../look';
import { monkAt, skinHexAt, sliderForHex, sliderForMonk } from '../skinSlider';

describe('skin tone slider (CUR-28, WO-015)', () => {
  it('the endpoints match Monk 1 (Light) and Monk 10 (Deep) exactly', () => {
    expect(skinHexAt(0).toUpperCase()).toBe(MONK_SWATCHES[0]!.toUpperCase());
    expect(skinHexAt(1).toUpperCase()).toBe(MONK_SWATCHES[9]!.toUpperCase());
    // Values outside [0, 1] are clamped
    expect(skinHexAt(-0.5)).toBe(skinHexAt(0));
    expect(skinHexAt(1.5)).toBe(skinHexAt(1));
  });

  it('the midpoint (Medium) is a blend between Monk 5 and 6, not either swatch', () => {
    const mid = skinHexAt(0.5).toUpperCase();
    expect(mid).not.toBe(MONK_SWATCHES[4]!.toUpperCase());
    expect(mid).not.toBe(MONK_SWATCHES[5]!.toUpperCase());
    // It is a valid #RRGGBB
    expect(mid).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('every integer monk class reproduces its swatch', () => {
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      expect(skinHexAt(t).toUpperCase()).toBe(MONK_SWATCHES[i]!.toUpperCase());
    }
  });

  it('the slider is monotone in lightness: Light is lighter than Medium is lighter than Deep', () => {
    // Parse a #RRGGBB and return the sRGB-relative luminance (ITU-R BT.709).
    const luminance = (hex: string): number => {
      const n = parseInt(hex.replace('#', ''), 16);
      const toLinear = (c: number): number => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const r = toLinear((n >> 16) & 255);
      const g = toLinear((n >> 8) & 255);
      const b = toLinear(n & 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const light = luminance(skinHexAt(0));
    const mid = luminance(skinHexAt(0.5));
    const deep = luminance(skinHexAt(1));
    expect(light).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(deep);
  });

  it('sliderForMonk and monkAt round-trip through the ten integer classes', () => {
    for (let n = 1; n <= 10; n++) {
      expect(sliderForMonk(n)).toBeCloseTo((n - 1) / 9, 9);
      expect(monkAt(sliderForMonk(n))).toBe(n);
    }
  });

  it('sliderForHex returns the exact position for every Monk swatch (fast path)', () => {
    for (let i = 0; i < 10; i++) {
      const t = sliderForHex(MONK_SWATCHES[i]!);
      expect(t).not.toBeNull();
      expect(t).toBeCloseTo(i / 9, 9);
    }
    // Case is ignored
    expect(sliderForHex('#f6ede4')).toBeCloseTo(0, 9);
    expect(sliderForHex('#a07E56')).toBeCloseTo(5 / 9, 9);
  });

  it('lookForSlider produces a SkinLook that parseLook reads back', () => {
    const look = lookForSlider(0.37);
    expect(look.source).toBe('picked');
    expect(look.slider).toBeCloseTo(0.37, 9);
    expect(look.hex).toMatch(/^#[0-9A-F]{6}$/);
    // Round-trip through the store format
    expect(parseLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
  });

  it('lookForSlider keeps `monk` on an integer class position, drops it elsewhere', () => {
    // Monk 4 (slider = 3/9)
    const look = lookForSlider(3 / 9);
    expect(look.monk).toBe(4);
    expect(look.hex).toBe(MONK_SWATCHES[3]!.toUpperCase());
    // Between classes: no `monk`
    const between = lookForSlider(0.37);
    expect(between.monk).toBeUndefined();
  });

  it('lookForMonk and lookForSlider agree at every integer position', () => {
    for (let n = 1; n <= 10; n++) {
      const a = lookForMonk(n)!;
      const b = lookForSlider((n - 1) / 9);
      expect(b.hex).toBe(a.hex);
      expect(b.slider).toBeCloseTo(a.slider, 9);
      expect(b.source).toBe(a.source);
      expect(b.monk).toBe(a.monk);
    }
  });
});
