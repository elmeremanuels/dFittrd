/**
 * Slice 1 of the merchant-settings inventory (D24, D25 point 1): a product may arrive without a
 * fabric stretch value. The engine reads a missing stretch as 0 %, and nothing about that changes the advice for a product that states its stretch.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MOCK_GARMENTS, type UserBody } from '@curtain/schema';
import { computeFit, recommendSize } from './index';
import type { FitGarment } from './types';
import { JEANS, REF, SLIP, WRAP } from './test/fixtures';

const BODIES: readonly UserBody[] = [
  REF,
  { measurements: { bust: 96, waist: 78, hip: 104, shoulder: 40, thigh: 60, inseam: 78, foot: 24.5 }, confidence: { bust: 0.9, waist: 0.9, hip: 0.9 } },
  { measurements: { bust: 82, waist: 62, hip: 88, shoulder: 36, thigh: 50, inseam: 74, foot: 23 } },
  { measurements: { bust: 108, waist: 94, hip: 112, shoulder: 46, neck: 40, sleeve: 64, thigh: 62, inseam: 82, foot: 27.5 } },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('missing fabric stretch', () => {
  it.each([
    ['wrap dress', WRAP],
    ['slip top', SLIP],
    ['jeans', JEANS],
  ])('%s: a fabric without stretchPct gives the same result as stretchPct 0', (_name, garment) => {
    const { stretchPct: _dropped, ...fabricWithout } = garment.fabric;
    void _dropped;
    const without = { ...garment, fabric: fabricWithout } as unknown as FitGarment;
    const zero: FitGarment = { ...garment, fabric: { ...garment.fabric, stretchPct: 0 } };
    for (const body of BODIES) {
      expect(JSON.stringify(computeFit(without, body))).toBe(JSON.stringify(computeFit(zero, body)));
      expect(JSON.stringify(recommendSize(without, body))).toBe(JSON.stringify(recommendSize(zero, body)));
    }
  });

  it('a garment without any fabric object is read as 0 % stretch too', () => {
    const { fabric: _fabric, ...rest } = WRAP;
    void _fabric;
    const zero: FitGarment = { ...WRAP, fabric: { ...WRAP.fabric, stretchPct: 0 } };
    expect(JSON.stringify(computeFit(rest as unknown as FitGarment, REF))).toBe(JSON.stringify(computeFit(zero, REF)));
  });
});

describe('complete products: advice is byte-identical', () => {
  // Pinned on the commit before stretch and drape became optional in the draft fabric
  // (claude/garment-engine, 20 Nov 2026). A change here means the advice of a product that states
  // every fabric value has changed, which slice 1 must not do.
  const PINNED = '7fb48e23df7d65173ff5ae4cc916c00ceb67001440ac6ce237924ea0a92db18f';

  it('computeFit + recommendSize over every mock garment and four bodies hash to the pinned value', () => {
    const lines: string[] = [];
    for (const g of MOCK_GARMENTS) {
      for (const body of BODIES) {
        lines.push(`${g.id}\t${JSON.stringify(computeFit(g, body))}\t${JSON.stringify(recommendSize(g, body))}`);
      }
    }
    expect(lines.length).toBe(MOCK_GARMENTS.length * BODIES.length);
    expect(sha(lines.join('\n'))).toBe(PINNED);
  });
});
