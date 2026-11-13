import { CATEGORY_POINTS, FIT_POINTS, FS_GIRTH_LEVELS, GARMENT_CATEGORIES, LENGTH_KEYS } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_BREADTHS,
  ANCHOR_IDS,
  ANCHOR_LENGTHS,
  ANCHOR_RINGS,
  ANCHOR_TO_FIT_POINT,
  ANCHOR_TO_SCAN_LEVEL,
  BREADTH_RING,
  CATEGORY_ANCHORS,
  FIT_POINT_TO_ANCHOR,
  LENGTH_KEY_TO_ANCHOR,
  SCAN_LEVELS,
  SCAN_LEVEL_TO_ANCHOR,
  anchorToFitPoint,
  anchorToScanLevel,
  anchorsForCategory,
  fitPointToAnchor,
  isAnchorBreadth,
  isAnchorId,
  isAnchorLength,
  isAnchorRing,
  lengthKeyToAnchor,
  scanLevelToAnchor,
  scanValuesToAnchors,
  type AnchorCategory,
} from './index';

describe('vocabulary (D15)', () => {
  it('has exactly the 12 rings and 6 lengths of D15, in order', () => {
    expect(ANCHOR_RINGS).toEqual(['neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'upper_arm', 'wrist']);
    expect(ANCHOR_LENGTHS).toEqual(['shoulder_to_waist', 'shoulder_to_hem', 'waist_to_hem', 'sleeve', 'inseam', 'rise']);
    expect(ANCHOR_BREADTHS).toEqual(['shoulder_width']);
    expect(ANCHOR_IDS).toEqual([...ANCHOR_RINGS, ...ANCHOR_LENGTHS, ...ANCHOR_BREADTHS]);
    expect(new Set(ANCHOR_IDS).size).toBe(19);
    expect(BREADTH_RING.shoulder_width).toBe('shoulder');
    expect(isAnchorBreadth('shoulder_width')).toBe(true);
    expect(isAnchorRing('shoulder_width')).toBe(false);
    expect(isAnchorBreadth('shoulder')).toBe(false);
  });

  it('ids are snake_case', () => {
    for (const id of ANCHOR_IDS) expect(id).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('type guards', () => {
    expect(isAnchorRing('chest')).toBe(true);
    expect(isAnchorRing('bust')).toBe(false);
    expect(isAnchorRing('inseam')).toBe(false);
    expect(isAnchorLength('inseam')).toBe(true);
    expect(isAnchorLength('sleeve_length')).toBe(false);
    expect(isAnchorId('upper_arm')).toBe(true);
    expect(isAnchorId('upperArm')).toBe(false);
    expect(isAnchorId(undefined)).toBe(false);
    expect(isAnchorId(42)).toBe(false);
    expect(isAnchorId('toString')).toBe(false);
  });
});

describe('category subsets', () => {
  it('covers every schema category and nothing else', () => {
    expect(Object.keys(CATEGORY_ANCHORS).sort()).toEqual([...GARMENT_CATEGORIES].sort());
  });

  it('shoes and accessories are empty', () => {
    expect(anchorsForCategory('shoes')).toEqual([]);
    expect(anchorsForCategory('accessory')).toEqual([]);
  });

  it('every subset holds the anchors of the fit engine default points of that category', () => {
    for (const cat of GARMENT_CATEGORIES) {
      const ids = anchorsForCategory(cat);
      for (const p of CATEGORY_POINTS[cat]) {
        const a = fitPointToAnchor(p);
        if (p === 'foot') expect(a).toBeUndefined();
        else expect(ids).toContain(a);
      }
    }
  });

  it('subsets only hold valid ids, rings and lengths in their own lists, no duplicates, D15 order', () => {
    for (const cat of Object.keys(CATEGORY_ANCHORS) as AnchorCategory[]) {
      const { rings, lengths, breadths } = CATEGORY_ANCHORS[cat];
      expect(rings.every(isAnchorRing)).toBe(true);
      expect(lengths.every(isAnchorLength)).toBe(true);
      expect(breadths.every(isAnchorBreadth)).toBe(true);
      expect(new Set(rings).size).toBe(rings.length);
      expect(new Set(lengths).size).toBe(lengths.length);
      expect([...rings]).toEqual(ANCHOR_RINGS.filter((r) => rings.includes(r)));
      expect([...lengths]).toEqual(ANCHOR_LENGTHS.filter((l) => lengths.includes(l)));
    }
  });

  it('bottoms have legs and no arms; tops have arms and no legs; dresses reach the knee', () => {
    expect(CATEGORY_ANCHORS.bottom.rings).toEqual(['waist', 'hip', 'thigh', 'knee', 'calf', 'ankle']);
    expect(CATEGORY_ANCHORS.bottom.lengths).toEqual(['waist_to_hem', 'inseam', 'rise']);
    expect(CATEGORY_ANCHORS.top.rings).not.toContain('thigh');
    expect(CATEGORY_ANCHORS.top.rings).toContain('upper_arm');
    expect(CATEGORY_ANCHORS.outerwear).toEqual(CATEGORY_ANCHORS.top);
    expect(CATEGORY_ANCHORS.dress.rings).toContain('knee');
    expect(CATEGORY_ANCHORS.dress.lengths).toContain('waist_to_hem');
  });

  it('unknown category → empty list', () => {
    expect(anchorsForCategory('gadget')).toEqual([]);
    expect(anchorsForCategory('constructor')).toEqual([]);
  });

  it('returns a fresh array', () => {
    const a = anchorsForCategory('top');
    a.push('knee');
    expect(anchorsForCategory('top')).not.toContain('knee');
  });
});

describe('fit point mapping', () => {
  it('maps every fit point except foot; bust → chest and shoulder → shoulder_width', () => {
    const renamed: Record<string, string> = { bust: 'chest', shoulder: 'shoulder_width' };
    for (const p of FIT_POINTS) {
      if (p === 'foot') expect(fitPointToAnchor(p)).toBeUndefined();
      else expect(fitPointToAnchor(p)).toBe(renamed[p] ?? p);
    }
    expect(Object.keys(FIT_POINT_TO_ANCHOR).sort()).toEqual(FIT_POINTS.filter((p) => p !== 'foot').sort());
  });

  it('round-trips', () => {
    for (const [p, a] of Object.entries(FIT_POINT_TO_ANCHOR)) {
      expect(anchorToFitPoint(a)).toBe(p);
      expect(ANCHOR_TO_FIT_POINT[a]).toBe(p);
    }
    expect(anchorToFitPoint('neck')).toBeUndefined();
    expect(anchorToFitPoint('bust')).toBeUndefined();
    expect(fitPointToAnchor('chest')).toBeUndefined();
    expect(fitPointToAnchor('__proto__')).toBeUndefined();
  });

  it('every mapped anchor is a valid id of the right kind', () => {
    for (const a of Object.values(FIT_POINT_TO_ANCHOR)) expect(isAnchorId(a)).toBe(true);
    expect(isAnchorLength(FIT_POINT_TO_ANCHOR.inseam)).toBe(true);
    expect(isAnchorRing(FIT_POINT_TO_ANCHOR.bust)).toBe(true);
  });

  it('R1: the shoulder fit point (a width) is never keyed under the shoulder ring (a girth)', () => {
    expect(FIT_POINT_TO_ANCHOR.shoulder).toBe('shoulder_width');
    expect(isAnchorRing(FIT_POINT_TO_ANCHOR.shoulder)).toBe(false);
    expect(Object.values(FIT_POINT_TO_ANCHOR)).not.toContain('shoulder');
    expect(anchorToFitPoint('shoulder')).toBeUndefined();
    // The scan's shoulder level is a cross-section girth and keeps the ring.
    expect(scanLevelToAnchor('shoulder')).toBe('shoulder');
  });
});

describe('scan level mapping', () => {
  it('SCAN_LEVELS equals the schema FS_GIRTH_LEVELS (= capture LEVELS)', () => {
    expect([...SCAN_LEVELS]).toEqual([...FS_GIRTH_LEVELS]);
  });

  it('is a bijection onto the 12 rings, in the same order', () => {
    expect(SCAN_LEVELS.map((l) => SCAN_LEVEL_TO_ANCHOR[l])).toEqual([...ANCHOR_RINGS]);
    for (const r of ANCHOR_RINGS) expect(SCAN_LEVEL_TO_ANCHOR[ANCHOR_TO_SCAN_LEVEL[r]]).toBe(r);
  });

  it('renames only bust and upperArm', () => {
    const renamed = SCAN_LEVELS.filter((l) => (SCAN_LEVEL_TO_ANCHOR[l] as string) !== l);
    expect(renamed).toEqual(['bust', 'upperArm']);
    expect(scanLevelToAnchor('bust')).toBe('chest');
    expect(scanLevelToAnchor('upperArm')).toBe('upper_arm');
    expect(anchorToScanLevel('upper_arm')).toBe('upperArm');
    expect(scanLevelToAnchor('upper_arm')).toBeUndefined();
    expect(anchorToScanLevel('inseam')).toBeUndefined();
    expect(scanLevelToAnchor('hasOwnProperty')).toBeUndefined();
  });

  it('re-keys per-level values', () => {
    expect(scanValuesToAnchors({ bust: 92, upperArm: 28, waist: 74, stature: 170, hip: undefined })).toEqual({ chest: 92, upper_arm: 28, waist: 74 });
  });
});

describe('length key mapping', () => {
  it('maps the schema lengthCm keys that have an anchor', () => {
    for (const k of LENGTH_KEYS) {
      const a = lengthKeyToAnchor(k);
      if (a !== undefined) expect(isAnchorLength(a)).toBe(true);
    }
    expect(lengthKeyToAnchor('sleeve_length')).toBe('sleeve');
    expect(lengthKeyToAnchor('outseam')).toBeUndefined();
    // Every length anchor is reachable from a schema key.
    expect(new Set(Object.values(LENGTH_KEY_TO_ANCHOR))).toEqual(new Set(ANCHOR_LENGTHS));
    for (const k of Object.keys(LENGTH_KEY_TO_ANCHOR)) expect(LENGTH_KEYS as readonly string[]).toContain(k);
  });
});
