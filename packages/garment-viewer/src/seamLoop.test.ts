import { describe, expect, it } from 'vitest';
import { createCloth, loopGirth, setLoops, stepCloth, clothParams } from './cloth';

/** A short open tube hanging from its pinned top ring, its bottom ring pulled outwards by the test. */
function tube(): { pos: Float32Array; indices: number[]; bottom: number[]; n: number } {
  const N = 24, rows = 4;
  const pos: number[] = [], indices: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < N; c++) pos.push(10 * Math.cos((2 * Math.PI * c) / N), 100 - 2 * r, 10 * Math.sin((2 * Math.PI * c) / N));
  for (let r = 0; r + 1 < rows; r++) for (let c = 0; c < N; c++) {
    const a = r * N + c, b = r * N + ((c + 1) % N), d = (r + 1) * N + c, e = (r + 1) * N + ((c + 1) % N);
    indices.push(a, b, e, a, e, d);
  }
  return { pos: Float32Array.from(pos), indices, bottom: Array.from({ length: N }, (_, c) => (rows - 1) * N + c), n: N };
}

describe('a girth loop with a maximum (a seam that does not stretch)', () => {
  const params = clothParams({ drape: 0.5, bendStiffness: 0.1, stretchPct: 1.5, simulation: {} }, 0.5, { cling: false });
  const widen = (p: Float32Array, i: number): boolean => {
    // Stands in for the load that opened the dress's seam: everything is pushed out to radius 13.
    const r = Math.hypot(p[3 * i]!, p[3 * i + 2]!);
    if (r >= 13 || r < 1e-6) return false;
    p[3 * i] = (p[3 * i]! * 13) / r;
    p[3 * i + 2] = (p[3 * i + 2]! * 13) / r;
    return true;
  };
  const girth = (pos: Float32Array, ids: number[]): number => loopGirth(pos, ids, 0, ids.length, [], new Int32Array(2 * ids.length + 2));

  it('is pulled back to its maximum after the load, and a loop without one is left alone', () => {
    const t = tube();
    const rest = girth(t.pos, t.bottom);
    const free = createCloth(t.pos, t.pos, t.indices, (i) => i < t.n, () => false);
    setLoops(free, [{ particles: t.bottom, minGirthCm: rest }]);
    expect(free.loopMax).toBeUndefined();
    const held = createCloth(t.pos, t.pos, t.indices, (i) => i < t.n, () => false);
    setLoops(held, [{ particles: t.bottom, minGirthCm: rest, maxGirthCm: rest * 1.015 }]);
    // The load acts halfway through the iterations only (as a collider would be called), the loops after it.
    let calls = 0;
    const once = (p: Float32Array, i: number): boolean => (Math.floor(calls++ / (4 * t.n - t.n)) % 2 === 0 ? widen(p, i) : false);
    for (const c of [free, held]) { calls = 0; stepCloth(c, params, once, 10); }
    expect(girth(free.pos, t.bottom)).toBeGreaterThan(rest * 1.1);
    expect(girth(held.pos, t.bottom)).toBeLessThan(girth(free.pos, t.bottom));
  });
});
