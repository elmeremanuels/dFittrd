import { describe, expect, it } from 'vitest';
import { AUDIENCE_ATTRIBUTE_FIELD, audienceOfTexts, audienceWords, coerceAudienceOverride, inferAudience, inferAudienceDecision } from './audience';
import { AUDIENCE_CASES } from './audienceCases';

describe('inferAudience', () => {
  it.each(AUDIENCE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const d = inferAudienceDecision(c.hints);
    expect(d?.audience ?? null).toBe(c.audience);
    expect(d?.source ?? null).toBe(c.source);
    expect(inferAudience(c.hints) ?? null).toBe(c.audience);
  });

  it('has cases for every direction of the "women contains men" trap', () => {
    const names = AUDIENCE_CASES.map((c) => c.name).join('|');
    for (const needle of ['women contains men', 'womens contains mens', "women's contains men's", 'female contains male']) expect(names).toContain(needle);
  });

  it('splits into whole words and joins a possessive s', () => {
    expect(audienceWords("Men's & Women’s T-Shirts (2-pack)")).toEqual(['mens', 'womens', 't', 'shirts', '2', 'pack']);
    expect(audienceWords("L'homme")).toEqual(['l', 'homme']);
    expect(audienceWords('  ')).toEqual([]);
  });

  it('reads ambiguous words only from structured fields', () => {
    expect(audienceOfTexts(['Man'], true)).toBe('men');
    expect(audienceOfTexts(['Man'], false)).toBeUndefined();
    expect(audienceOfTexts(['Woman'], true)).toBe('women');
    expect(audienceOfTexts(['Woman'], false)).toBeUndefined();
    expect(audienceOfTexts([null, undefined, ''], true)).toBeUndefined();
  });

  it('coerces the override', () => {
    expect(coerceAudienceOverride('men')).toBe('men');
    expect(coerceAudienceOverride('Mens')).toBe('men');
    expect(coerceAudienceOverride("Women's")).toBe('women');
    expect(coerceAudienceOverride('unisex')).toBe('unisex');
    expect(coerceAudienceOverride('None')).toBe('none');
    expect(coerceAudienceOverride('')).toBeUndefined();
    expect(coerceAudienceOverride('kids')).toBeUndefined();
    expect(coerceAudienceOverride(3)).toBeUndefined();
  });

  it('knows the attribute names shops use for the audience', () => {
    for (const ok of ['Gender', 'pa_gender', 'Geslacht', 'pa_geslacht', 'Doelgroep', 'Target group', 'department']) expect(AUDIENCE_ATTRIBUTE_FIELD.test(ok), ok).toBe(true);
    for (const no of ['Maat', 'Kleur', 'Material', 'gendered']) expect(AUDIENCE_ATTRIBUTE_FIELD.test(no), no).toBe(false);
  });
});
