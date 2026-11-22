import { describe, expect, it } from 'vitest';
import { HAIR_COLOURS, HAIR_LENGTHS, HAIR_TYPES, parseHairPick, hairPickToOptions, type HairPick } from '../hair';

describe('hair (D28, OI-170)', () => {
  it('has 10 types, 4 lengths and 10 colours', () => {
    expect(HAIR_TYPES).toHaveLength(10);
    expect(HAIR_LENGTHS).toHaveLength(4);
    expect(HAIR_COLOURS).toHaveLength(10);
  });

  it('parseHairPick accepts a valid pick', () => {
    const pick: HairPick = { type: '2A', length: 'shoulder', colour: 'brown' };
    expect(parseHairPick(pick)).toEqual(pick);
  });

  it('parseHairPick rejects an invalid pick', () => {
    expect(parseHairPick(null)).toBeNull();
    expect(parseHairPick({})).toBeNull();
    expect(parseHairPick({ type: 'X', length: 'shoulder', colour: 'brown' })).toBeNull();
    expect(parseHairPick({ type: '2A', length: 'long-long', colour: 'brown' })).toBeNull();
    expect(parseHairPick({ type: '2A', length: 'shoulder', colour: 'neon-pink' })).toBeNull();
  });

  it('hairPickToOptions produces the viewer format', () => {
    const pick: HairPick = { type: '4C', length: 'long', colour: 'black' };
    expect(hairPickToOptions(pick)).toEqual({ type: '4C', length: 'long', colour: 'black' });
  });
});
