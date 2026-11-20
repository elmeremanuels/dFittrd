/** The engine mirrors a few schema constants at runtime (zero runtime deps); keep them in sync. */
import { CATEGORY_POINTS as SCHEMA_CATEGORY_POINTS, FIT_POINTS, PATTERN_BLOCKS, STRETCH_ZONES } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { BLOCKS, CATEGORY_EASE, CATEGORY_POINTS, POINTS, ZONE_POINTS, blockRule } from './constants';
import { parseSizingNotes } from './sizingNotes';

describe('schema parity', () => {
  it('POINTS === FIT_POINTS', () => {
    expect([...POINTS]).toEqual([...FIT_POINTS]);
  });
  it('CATEGORY_POINTS === schema CATEGORY_POINTS', () => {
    expect(CATEGORY_POINTS).toEqual(SCHEMA_CATEGORY_POINTS);
  });
  it('every schema pattern block has a rule and every schema stretch zone maps to points', () => {
    for (const b of PATTERN_BLOCKS) expect(BLOCKS[b], b).toBeDefined();
    for (const z of STRETCH_ZONES) expect(ZONE_POINTS[z], z).toBeDefined();
  });
  it('CATEGORY_EASE matches the spec table', () => {
    expect(CATEGORY_EASE).toEqual({
      top: { bust: 8, waist: 8, hip: 6, shoulder: 1 },
      dress: { bust: 6, waist: 4, hip: 6, shoulder: 1 },
      bottom: { waist: 2, hip: 5, thigh: 3, inseam: 0 },
      outerwear: { bust: 12, waist: 12, hip: 10, shoulder: 2 },
      shoes: { foot: 0.7 },
      accessory: {},
    });
  });
  it('blockRule is case/whitespace tolerant and safe for prototype keys', () => {
    expect(blockRule(' Wrap ')).toBe(BLOCKS.wrap);
    expect(blockRule('constructor')).toEqual({ ease: {}, skip: [], snugOk: false, label: '' });
    expect(blockRule(undefined)).toEqual({ ease: {}, skip: [], snugOk: false, label: '' });
  });
});

describe('parseSizingNotes', () => {
  it.each([
    ['runs small', 1],
    ['Runs Small in the bust', 1],
    ['run small', 1],
    ['we recommend you size up', 1],
    ['order a size up', 1],
    ['order up', 1],
    ['snug fit', 1],
    ['tight fit', 1],
    ['small fit', 1],
    ['runs large', -1],
    ['runs big', -1],
    ['size down', -1],
    ['order a size down', -1],
    ['generous cut', -1],
    ['oversized fit', -1],
    ['roomy fit', -1],
    ['true to size', 0],
    ['', 0],
    ['runs small in the bust, generous in the hips', 0],
    [undefined, 0],
    [null, 0],
  ])('%j → %i', (notes, bias) => {
    expect(parseSizingNotes(notes as string)).toBe(bias);
  });
});
