import { ANCHOR_RINGS, ANCHOR_TO_SCAN_LEVEL } from '@curtain/anchors';
import { describe, expect, it } from 'vitest';
import { LEVEL_ANCHORS, byAnchor, levelAnchor } from '../anchors';
import { LEVELS } from '../crossSections';

describe('capture levels → D15 anchors (naming only)', () => {
  it('maps the 12 LEVELS onto the 12 rings in order', () => {
    expect(LEVELS.map(levelAnchor)).toEqual([...ANCHOR_RINGS]);
    expect(Object.keys(LEVEL_ANCHORS)).toEqual([...LEVELS]);
  });

  it('renames only bust and upperArm, and round-trips', () => {
    expect(LEVELS.filter((l) => (levelAnchor(l) as string) !== l)).toEqual(['bust', 'upperArm']);
    expect(levelAnchor('bust')).toBe('chest');
    expect(levelAnchor('upperArm')).toBe('upper_arm');
    for (const l of LEVELS) expect(ANCHOR_TO_SCAN_LEVEL[levelAnchor(l)]).toBe(l);
  });

  it('re-keys per-level values without changing them', () => {
    const girths = { bust: 91.2, waist: 73.9, upperArm: 28.4, wrist: 15.1 };
    expect(byAnchor(girths)).toEqual({ chest: 91.2, waist: 73.9, upper_arm: 28.4, wrist: 15.1 });
    expect(girths).toEqual({ bust: 91.2, waist: 73.9, upperArm: 28.4, wrist: 15.1 });
  });
});
