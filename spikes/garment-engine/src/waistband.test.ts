import { describe, expect, it } from 'vitest';
import type { Mesh } from '@curtain/mannequin';
import { waistbandGirth } from './waistband';

/** A vertical open tube (radius r) from y 60 up to a top edge y = 100 + slope·z, optionally open at +x above y 85 over `openDeg`. */
function tube(r: number, slope: number, openDeg = 0): Mesh {
  const C = 144, R = 60;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= R; i++) for (let c = 0; c < C; c++) {
    const t = (2 * Math.PI * c) / C;
    const x = r * Math.sin(t), z = r * Math.cos(t);
    const top = 100 + slope * z;
    positions.push(x, 60 + (i / R) * (top - 60), z);
  }
  const angleOf = (c: number): number => (((360 * c) / C + 360) % 360);
  for (let i = 0; i < R; i++) for (let c = 0; c < C; c++) {
    const a = i * C + c, b = i * C + ((c + 1) % C), d = (i + 1) * C + c, e = (i + 1) * C + ((c + 1) % C);
    const mid = angleOf(c + 0.5);
    const y = positions[3 * a + 1]!;
    if (openDeg > 0 && Math.abs(mid - 90) < openDeg / 2 && y > 85) continue;
    indices.push(a, d, e, a, e, b);
  }
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), vertexPart: new Uint8Array(positions.length / 3), partNames: ['garment'] } as unknown as Mesh;
}

/** Ramanujan's perimeter of an ellipse. */
const ellipse = (a: number, b: number): number => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

describe('waistbandGirth', () => {
  it('a level band: the circle under its top edge', () => {
    const w = waistbandGirth(tube(13, 0))!;
    expect(w.tiltDeg).toBeLessThan(0.5);
    expect(w.centreY).toBeCloseTo(100, 0);
    expect(w.girthCm!).toBeCloseTo(2 * Math.PI * 13, 0);
  });

  it('a band lower at the front: found on its tilted plane, girth of that section', () => {
    // Top edge 100 − 0.3 z: +z is the front, so the front edge is 3.9 cm lower than the back.
    const w = waistbandGirth(tube(13, -0.3))!;
    expect(w.frontY).toBeLessThan(w.backY);
    expect(w.tiltDeg).toBeCloseTo((Math.atan(0.3) * 180) / Math.PI, 0);
    expect(w.girthCm!).toBeCloseTo(ellipse(13, 13 * Math.hypot(1, 0.3)), 0);
  });

  it('an opening at the side wider than the tape bridges: refused, with the bridged girth and the gap reported', () => {
    const w = waistbandGirth(tube(13, -0.3, 30))!;
    expect(w.girthCm).toBeNull();
    expect(w.maxGapCm!).toBeGreaterThan(5);
    expect(w.maxGapCm!).toBeLessThan(9);
    expect(w.bridgedCm!).toBeGreaterThan(80);
    // The opening's sectors sink to 85 cm and are dropped as outliers before the plane is refitted.
    expect(w.sectorsDropped).toBeGreaterThan(0);
    expect(w.tiltDeg).toBeCloseTo((Math.atan(0.3) * 180) / Math.PI, 0);
  });
});
