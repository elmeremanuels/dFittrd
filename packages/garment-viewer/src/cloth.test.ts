import { describe, expect, it } from 'vitest';
import { addHangLines, clothParams, createCloth, hangLines, hangStretchOf, isSettled, meshEdges, settlePins, stepCloth, strainQuantile, tethers } from './cloth';
import { pushOutOfEllipse } from './collide';

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

describe('early exit and pins', () => {
  it('stops a sheet that has come to rest before the duration cap, and never before the minimum', () => {
    const { positions, indices } = grid(6, 2);
    const cloth = createCloth(positions, positions, indices, (i) => i < 6, () => false);
    const p = clothParams(COTTON, 3);
    let frames = 0;
    while (!isSettled(cloth, p)) {
      stepCloth(cloth, p, null, 1);
      frames++;
    }
    expect(cloth.time).toBeGreaterThanOrEqual(p.minDurationS - 1e-9);
    expect(cloth.time).toBeLessThan(3);
    expect(cloth.calmFrames).toBeGreaterThanOrEqual(p.calmFrames);
    expect(frames).toBe(Math.round(cloth.time / p.dt));
  });

  it('settles a stretched pair of pins back to its rest length before they are fixed', () => {
    const { positions, indices } = grid(4, 2);
    const start = Float32Array.from(positions);
    start[3] = 4; // pin 1 pulled 2 cm away from pin 0 (rest 2 cm)
    const cloth = createCloth(start, positions, indices, (i) => i < 2, () => false);
    expect(settlePins(cloth, null, 60)).toBeLessThan(0.02);
    expect(Array.from(cloth.prev)).toEqual(Array.from(cloth.pos));
  });
});

describe('collision', () => {
  it('pushes out exactly like the polar-radius formula, without trigonometry', () => {
    const polar = (a: number, b: number, t: number) => (a * b) / Math.hypot(b * Math.cos(t), a * Math.sin(t));
    for (let k = 0; k < 200; k++) {
      const t = (k / 200) * 2 * Math.PI;
      const r = 3 + (k % 7);
      const [dx, dz] = [r * Math.cos(t), r * Math.sin(t)];
      const got = pushOutOfEllipse(dx, dz, 10, 6, 0.5);
      const re = polar(10.5, 6.5, t);
      if (r >= re) expect(got).toBeNull();
      else {
        expect(Math.hypot(got![0], got![1])).toBeCloseTo(re, 9);
        expect(Math.atan2(got![1], got![0])).toBeCloseTo(Math.atan2(dz, dx), 9);
      }
    }
  });
});

describe('hold length (hang lines)', () => {
  const VISCOSE = { drape: 0.85, bendStiffness: 0.04, stretchPct: 1.5, simulation: { damping: 0.035 } };
  /** A sheet held by its top row that has to bend over a bar on its way down: where the straight tethers have slack. */
  const overBar = (hold: boolean, frames = 180) => {
    const n = 40;
    const { positions, indices } = grid(n, 1.5);
    for (let i = 0; i < n * n; i++) positions[3 * i + 2] = 0.3 * Math.sin(i % n);
    const cloth = createCloth(positions, positions, indices, (i) => i < n, () => false);
    if (hold) addHangLines(cloth);
    const bar = (pos: Float32Array, i: number): boolean => {
      const dy = pos[3 * i + 1]! - 88, dz = pos[3 * i + 2]! - 3;
      const d = Math.hypot(dy, dz);
      if (d >= 9 || d < 1e-9) return false;
      pos[3 * i + 1] = 88 + (dy / d) * 9;
      pos[3 * i + 2] = 3 + (dz / d) * 9;
      return true;
    };
    const p = clothParams(VISCOSE, 3, { cling: false, holdLength: hold });
    const move = stepCloth(cloth, p, bar, frames);
    // The middle column, top to hem, along the cloth.
    let column = 0;
    const c = n >> 1;
    for (let r = 0; r + 1 < n; r++) column += Math.hypot(...[0, 1, 2].map((k) => cloth.pos[3 * ((r + 1) * n + c) + k]! - cloth.pos[3 * (r * n + c) + k]!));
    return { cloth, p, column, rest: (n - 1) * 1.5, move };
  };

  it('is off unless asked for: the parameters and the cloth are the ones of before', () => {
    expect('hangStretch' in clothParams(VISCOSE)).toBe(false);
    expect(clothParams(VISCOSE, 1.5, { holdLength: true }).hangStretch).toBeCloseTo(0.003, 9);
    const { positions, indices } = grid(6, 2);
    const cloth = createCloth(positions, positions, indices, (i) => i < 6, () => false);
    expect(cloth.hang).toBeUndefined();
    // Lines without the parameter, or the parameter without lines, change nothing.
    const a = overBar(false, 30);
    const b = (() => { const x = overBar(false, 0); addHangLines(x.cloth); return x; })();
    expect(b.cloth.hang!.length).toBeGreaterThan(0);
    expect(a.cloth.hang).toBeUndefined();
  });

  it('follows the fabric: a fifth of its stretch, held between 0.2 and 1 %', () => {
    expect(hangStretchOf(0)).toBe(0.002);
    expect(hangStretchOf(1.5)).toBeCloseTo(0.003, 9);
    expect(hangStretchOf(8)).toBe(0.01);
  });

  it('builds about two lines per free particle, each as long as the cloth between its ends', () => {
    const n = 9;
    const { positions, indices } = grid(n, 2);
    const { edges } = meshEdges(indices);
    const rest = new Float32Array(edges.length / 2).map((_, e) => Math.hypot(...[0, 1, 2].map((k) => positions[3 * edges[2 * e]! + k]! - positions[3 * edges[2 * e + 1]! + k]!)));
    const t = tethers(n * n, edges, rest, (i) => i < n);
    const { hang, hangRest } = hangLines(n * n, t.tetherRest, t.before, t.order);
    const free = n * n - n;
    // Strides 1, 2, 4 and 8 over 8 rows: 8 + 4 + 2 + 1 lines per column.
    expect(hangRest.length).toBe(15 * n);
    expect(hangRest.length / free).toBeLessThan(2.1);
    for (let e = 0; e < hangRest.length; e++) {
      const a = hang[2 * e]!, b = hang[2 * e + 1]!;
      expect(b % n).toBe(a % n); // straight down its own column
      expect(hangRest[e]).toBeCloseTo(2 * (Math.floor(b / n) - Math.floor(a / n)), 4);
    }
    // Coarse first: the first line reaches from the held row to the hem.
    expect(hangRest[0]).toBeCloseTo(16, 4);
  });

  it('keeps a sheet that bends over a bar at its cut length, where the tethers alone leave it about 4 % long', () => {
    const soft = overBar(false);
    const held = overBar(true);
    expect(soft.column / soft.rest - 1).toBeGreaterThan(0.03);
    expect(held.column / held.rest - 1).toBeLessThan(0.015);
    expect(held.column / held.rest - 1).toBeGreaterThan(-0.005);
    expect(held.cloth.pos.every(Number.isFinite)).toBe(true);
    // Calm, and not stiff: it still wraps the bar (the cloth is pushed out to the bar's surface) and its hem hangs below it.
    expect(held.move).toBeLessThan(0.1);
    let low = 0;
    for (let c = 0; c < 40; c++) low += held.cloth.pos[3 * (39 * 40 + c) + 1]!;
    expect(100 - low / 40).toBeGreaterThan(55);
    expect(strainQuantile(held.cloth, 0.99)).toBeLessThan(strainQuantile(soft.cloth, 0.99));
  });
});
