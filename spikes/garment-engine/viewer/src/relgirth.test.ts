import { describe, expect, it } from 'vitest';
import { relGirths, rings } from '../scripts/serverdrape/relgirth';

/** A closed cylinder-ish tube: `rows` rings of `n` vertices from y0 to y1, radius r(y). */
function tube(r: (y: number) => number, y0: number, y1: number, rows = 61, n = 64): { pos: Float32Array; idx: Uint32Array } {
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < rows; j++) {
    const y = y0 + ((y1 - y0) * j) / (rows - 1);
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pos.push(r(y) * Math.cos(a), y, r(y) * Math.sin(a)); }
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, b, c, b, d, c);
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

describe('relgirth (R2 spike garment-relative measures)', () => {
  it('does not change when the whole garment rides higher', () => {
    const r = (y: number): number => 15 + 0.05 * (101.5 - y);
    const rest = tube(r, 1.5, 101.5);
    const R = rings(rest.pos);
    const a = relGirths(rest.pos, rest.idx, R);
    const lifted = rest.pos.map((v, i) => (i % 3 === 1 ? v + 4 : v));
    const b = relGirths(lifted, rest.idx, R);
    expect(b.hipRel).toBeCloseTo(a.hipRel, 1);
    expect(b.hemRel).toBeCloseTo(a.hemRel, 1);
    expect(b.hipRing).toBeCloseTo(a.hipRing, 1);
    expect(b.topY - a.topY).toBeCloseTo(4, 3);
    // hipRel sits 14.14 cm below the top edge: radius 15 + 0.05 * 14.14 there.
    expect(a.hipRel).toBeCloseTo(2 * Math.PI * (15 + 0.05 * 14.14) * Math.cos(Math.PI / 64), 0);
  });
});
