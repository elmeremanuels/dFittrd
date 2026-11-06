import { describe, expect, it } from 'vitest';
import { chartLength, cmToFtIn, cmToIn, CM_PER_IN, defaultUnits, ftInToCm, heightText, inToCm, kgToLb, KG_PER_LB, lbToKg, lengthText, localeRegion, metricText, numberText } from '../units';

describe('units: conversions', () => {
  it('uses the exact international factors', () => {
    expect(CM_PER_IN).toBe(2.54);
    expect(KG_PER_LB).toBe(0.45359237);
    expect(inToCm(1)).toBe(2.54);
    expect(lbToKg(1)).toBe(0.45359237);
    expect(inToCm(36)).toBeCloseTo(91.44, 10);
    expect(lbToKg(140)).toBeCloseTo(63.5029318, 7);
  });

  it('round-trips both ways without drift', () => {
    for (let cm = 40; cm <= 230; cm += 0.1) expect(inToCm(cmToIn(cm))).toBeCloseTo(cm, 9);
    for (let kg = 30; kg <= 250; kg += 0.1) expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 9);
    // to the metric form's 0.1 precision, the round trip is exact
    for (let cm = 120; cm <= 230; cm += 0.1) expect(metricText(inToCm(cmToIn(cm)))).toBe(metricText(cm));
  });

  it('feet and inches never show 12 inches and round to the nearest half inch', () => {
    expect(cmToFtIn(170)).toEqual({ ft: 5, in: 7 });
    expect(cmToFtIn(182.88)).toEqual({ ft: 6, in: 0 });
    expect(cmToFtIn(182.5)).toEqual({ ft: 6, in: 0 }); // 71.85 in → 72 → 6 ft 0 in, not 5 ft 12 in
    expect(cmToFtIn(165)).toEqual({ ft: 5, in: 5 });
    expect(cmToFtIn(160)).toEqual({ ft: 5, in: 3 });
    expect(cmToFtIn(161)).toEqual({ ft: 5, in: 3.5 });
    for (let cm = 120; cm <= 230; cm += 0.37) {
      const { ft, in: inches } = cmToFtIn(cm);
      expect(inches).toBeGreaterThanOrEqual(0);
      expect(inches).toBeLessThan(12);
      expect(Math.abs(ftInToCm(ft, inches) - cm)).toBeLessThanOrEqual(0.25 * 2.54 + 1e-9);
    }
  });

  it('formats numbers without float noise', () => {
    expect(numberText(86.99499)).toBe('87');
    expect(numberText(34.25, 2)).toBe('34.25');
    expect(metricText(63.5029318)).toBe('63.5');
    expect(metricText(76.2)).toBe('76.2');
    expect(chartLength(88, 'metric')).toBe('88');
    expect(chartLength(88, 'imperial')).toBe('34.6');
    expect(lengthText(2, 'metric')).toBe('2.0 cm');
    expect(lengthText(2, 'imperial')).toBe('0.8 in');
    expect(heightText(170, 'metric')).toBe('170 cm');
    expect(heightText(170, 'imperial')).toBe('5 ft 7 in');
  });
});

describe('units: default from the locale', () => {
  it('reads the region of a locale tag', () => {
    expect(localeRegion('en-US')).toBe('US');
    expect(localeRegion('en_au')).toBe('AU');
    expect(localeRegion('zh-Hant-TW')).toBe('TW');
    expect(localeRegion('es-419')).toBe('419');
    expect(localeRegion('en')).toBeNull();
    expect(localeRegion(null)).toBeNull();
  });

  it('en-US is imperial, everything else metric', () => {
    expect(defaultUnits('en-US')).toBe('imperial');
    expect(defaultUnits('es-US')).toBe('imperial');
    expect(defaultUnits('en-AU')).toBe('metric');
    expect(defaultUnits('en-GB')).toBe('metric');
    expect(defaultUnits('nl-NL')).toBe('metric');
    expect(defaultUnits(null)).toBe('metric');
  });

  it('the first locale with a region decides (browser before shop page)', () => {
    expect(defaultUnits('en', 'en-US')).toBe('imperial');
    expect(defaultUnits('en-AU', 'en-US')).toBe('metric');
    expect(defaultUnits(undefined, 'en')).toBe('metric');
  });
});
