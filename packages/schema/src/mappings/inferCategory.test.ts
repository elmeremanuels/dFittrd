import { describe, expect, it } from 'vitest';
import type { GarmentCategory } from '../garment';
import { inferCategory } from './common';

/** Realistic product titles (English and Dutch), each read as the only hint (finding #3). */
const TITLES: ReadonlyArray<[string, GarmentCategory | undefined]> = [
  // The bug: bottoms phrases that contain "boot" are bottoms.
  ['Boot cut jeans', 'bottom'],
  ['Bootcut Jeans Mid Rise', 'bottom'],
  ['Boot-cut stretch jeans in washed blue', 'bottom'],
  ['Boot-leg trousers', 'bottom'],
  ['Bootleg Pants – Black', 'bottom'],
  ['High waist bootcut', 'bottom'],
  ['Wool boot cut trousers', 'bottom'],
  ['Bootcut spijkerbroek', 'bottom'],
  ['Bootcut jeans met hoge taille', 'bottom'],
  ['Boot cut broek van corduroy', 'bottom'],
  ['Boot socks', 'accessory'],
  ['Wollen laarzensokken', 'accessory'],
  // Boots are still shoes.
  ['Chelsea boot', 'shoes'],
  ['Leather Chelsea Boots', 'shoes'],
  ['Knee-high boots with block heel', 'shoes'],
  ['Rain boots', 'shoes'],
  ['Leren enkellaarsjes', 'shoes'],
  ['Hoge laarzen van suède', 'shoes'],
  ['Suede ankle boot', 'shoes'],
  ['Dress shoes in patent leather', 'shoes'],
  ['Witte sneakers', 'shoes'],
  ['Leren sandalen', 'shoes'],
  ['Zwarte pumps', 'shoes'],
  ['Wandelschoenen', 'shoes'],
  // Other categories, English.
  ['Straight leg jeans', 'bottom'],
  ['Wide-leg linen trousers', 'bottom'],
  ['Pleated midi skirt', 'bottom'],
  ['Linen Wrap Dress', 'dress'],
  ['Shirt dress in poplin', 'dress'],
  ['Denim jacket', 'outerwear'],
  ['Wool trench coat', 'outerwear'],
  ['Ribbed tank top', 'top'],
  ['Merino crew-neck sweater', 'top'],
  ['Leather belt', 'accessory'],
  // Other categories, Dutch.
  ['Spijkerbroek met rechte pijp', 'bottom'],
  ['Korte broek van linnen', 'bottom'],
  ['Plissé rok', 'bottom'],
  ['Midi rokje met print', 'bottom'],
  ['Zomerjurk met bloemenprint', 'dress'],
  ['Maxi jurk', 'dress'],
  ['Winterjas met capuchon', 'outerwear'],
  ['Spijkerjack', 'outerwear'],
  ['Wollen mantel', 'outerwear'],
  ['Gebreide coltrui', 'top'],
  ['Wit overhemd', 'top'],
  ['Zijden bloes', 'top'],
  ['Leren riem', 'accessory'],
  ['Cadeaubon', undefined],
];

describe('inferCategory: product titles (finding #3)', () => {
  it.each(TITLES)('%s → %s', (title, expected) => {
    expect(inferCategory(undefined, null, title)).toBe(expected);
  });

  it('covers at least 20 titles, English and Dutch', () => {
    expect(TITLES.length).toBeGreaterThanOrEqual(20);
  });

  it('taxonomy and explicit hints still win over the title', () => {
    expect(inferCategory(undefined, 'Apparel > Women > Jeans', 'Boot')).toBe('bottom');
    expect(inferCategory('shoes', undefined, 'Boot cut jeans')).toBe('shoes');
    expect(inferCategory(undefined, 'Apparel > Shoes > Boots', 'Bootcut')).toBe('shoes');
    expect(inferCategory(undefined, 'Kleding > Broeken', 'Boot cut')).toBe('bottom');
  });

  it('a brand name is not a garment noun', () => {
    expect(inferCategory('Jack & Jones slim fit jeans')).toBe('bottom');
    expect(inferCategory('Jack & Jones')).toBeUndefined();
  });
});
