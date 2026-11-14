import { describe, expect, it } from 'vitest';
import { AUDIENCE_ATTRIBUTE_FIELD, AUDIENCE_COMPOUND_TAILS, AUDIENCE_SOURCES, audienceOfTexts, isWeakAudienceSource, audienceWords, coerceAudienceOverride, inferAudience, inferAudienceDecision } from './audience';
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

  it('reads the singular name-like words by source: anywhere, as a whole value, or never', () => {
    expect(audienceOfTexts(['Man'], 'anywhere')).toBe('men');
    expect(audienceOfTexts(['For the man'], 'anywhere')).toBe('men');
    expect(audienceOfTexts(['Man'], 'whole')).toBe('men');
    expect(audienceOfTexts(['Kleding > Heer'], 'whole')).toBe('men');
    expect(audienceOfTexts(['Iron Man'], 'whole')).toBeUndefined();
    expect(audienceOfTexts(['Man'], 'never')).toBeUndefined();
    expect(audienceOfTexts(['Woman'], 'whole')).toBe('women');
    expect(audienceOfTexts(['Wonder Woman'], 'whole')).toBeUndefined();
    expect(audienceOfTexts(['Woman'], 'never')).toBeUndefined();
    expect(audienceOfTexts([null, undefined, ''], 'anywhere')).toBeUndefined();
  });

  it('the false positives a review found in tags, collections and titles are pinned as cases', () => {
    const names = AUDIENCE_CASES.map((c) => c.name);
    for (const n of ['iron man as a tag', 'one-man-show as a tag', 'spider-man as a collection', 'isle of man as a product type', 'not for men', 'lady gaga as a tag', 'notre dame as a collection', 'herentals and herrenberg are towns', 'borrowed from the men', "men's fit on a women's product is a style"]) expect(names).toContain(n);
  });

  it('marks a title or a collection as a weak source', () => {
    expect(AUDIENCE_SOURCES.filter(isWeakAudienceSource)).toEqual(['title', 'collections']);
    expect(isWeakAudienceSource(inferAudienceDecision({ title: 'Men in Black Tee' })!.source)).toBe(true);
    expect(isWeakAudienceSource(inferAudienceDecision({ override: 'men', title: 'Men in Black Tee' })!.source)).toBe(false);
  });

  it('a compound needs a clothing word after the prefix; the tail list is ASCII', () => {
    for (const t of AUDIENCE_COMPOUND_TAILS) expect(t).toMatch(/^[a-z]+$/);
    expect(audienceOfTexts(['Herenschoenen'], 'never')).toBe('men');
    expect(audienceOfTexts(['Vrouwenkleding'], 'never')).toBe('women');
    expect(audienceOfTexts(['Herenhuis'], 'never')).toBeUndefined();
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
