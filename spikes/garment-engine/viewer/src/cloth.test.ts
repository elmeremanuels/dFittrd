import { describe, expect, it } from 'vitest';
import { clothParams, createCloth, meshEdges, stepCloth, strainQuantile, tethers } from './cloth';

/** An n×n grid in the XY plane (cm), top row at y = top. */
function grid(n: number, spacing: number, top = 100): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(n * n * 3);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) positions.set([c * spacing, top - r * spacing, 0], 3 * (r * n + c));
  const idx: number[] = [];
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  return { positions, indices: Uint32Array.from(idx) };
}

const COTTON = { drape: 0.5, bendStiffness: 0.12, stretchPct: 0, simulation: { damping: 0.1 } };

describe('meshEdges', () => {
  it('finds unique edges and one bend pair per interior edge', () => {
    const { indices } = grid(3, 1);
    const { edges, bends } = meshEdges(indices);
    // 3×3 grid: 12 grid edges + 4 diagonals; interior edges: 4 diagonals + 4 inner grid edges.
    expect(edges.length / 2).toBe(16);
    expect(bends.length / 2).toBe(8);
  });
});

describe('tethers', () => {
  it('gives every particle its nearest pin and the geodesic distance', () => {
    const { positions, indices } = grid(4, 2);
    const { edges } = meshEdges(indices);
    const rest = new Float32Array(edges.length / 2).map((_, e) => Math.hypot(...[0, 1, 2].map((k) => positions[3 * edges[2 * e]! + k]! - positions[3 * edges[2 * e + 1]! + k]!)));
    const { tether, tetherRest } = tethers(16, edges, rest, (i) => i < 4);
    expect(tether[12]).toBe(0); // bottom-left hangs from top-left
    expect(tetherRest[12]).toBeCloseTo(6, 5);
    expect(tetherRest[2]).toBe(0);
  });
});

describe('cloth', () => {
  it('hangs a sheet from its top row without exploding or stretching much, deterministically', () => {
    const run = () => {
      const { positions, indices } = grid(12, 2);
      const cloth = createCloth(positions, positions, indices, (i) => i < 12, () => false);
      const p = clothParams(COTTON);
      stepCloth(cloth, p, null, 90);
      return cloth;
    };
    const a = run();
    expect(a.time).toBeCloseTo(1.5, 6);
    expect(a.pos.every(Number.isFinite)).toBe(true);
    expect(strainQuantile(a, 1)).toBeLessThan(0.1);
    for (let i = 0; i < 12; i++) expect(a.pos[3 * i + 1]).toBe(100); // pinned row stays
    expect(Array.from(run().pos)).toEqual(Array.from(a.pos));
  });

  it('lets a horizontal sheet fall onto a collider and keeps it outside', () => {
    const { positions, indices } = grid(10, 2, 0);
    // Rotate into the XZ plane at y = 50, pin nothing; floor at y = 40.
    for (let i = 0; i < positions.length / 3; i++) {
      const y = positions[3 * i + 1]!;
      positions[3 * i + 1] = 50;
      positions[3 * i + 2] = y;
    }
    const cloth = createCloth(positions, positions, indices, () => false, () => false);
    const floor = (pos: Float32Array, i: number) => {
      if (pos[3 * i + 1]! >= 40) return false;
      pos[3 * i + 1] = 40;
      return true;
    };
    const p = clothParams(COTTON);
    stepCloth(cloth, p, floor, 90);
    for (let i = 0; i < cloth.pos.length / 3; i++) expect(cloth.pos[3 * i + 1]).toBeGreaterThanOrEqual(40 - 1e-4);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => cloth.pos[3 * i + 1]!))).toBeLessThan(40.5);
  });

  it('maps silk to softer bending, less damping and more cling than linen', () => {
    const linen = clothParams({ drape: 0.55, bendStiffness: 0.2, stretchPct: 1, simulation: { damping: 0.1 } });
    const silk = clothParams({ drape: 0.9, bendStiffness: 0.03, stretchPct: 1.5, simulation: { damping: 0.05 } });
    expect(silk.bendStiffness).toBeLessThan(linen.bendStiffness);
    expect(silk.damping).toBeLessThan(linen.damping);
    expect(silk.clingAccel).toBeGreaterThan(linen.clingAccel);
    expect(clothParams({ ...COTTON, stretchPct: 30 }).stretchStiffness).toBeLessThan(1);
  });
});
