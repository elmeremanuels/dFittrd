import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath, type Mesh } from '@curtain/mannequin';
import { openingProfile, sliceAt, stillWidths } from './bottomOpenings';
import type { Mask } from './evalPng';
import { garmentSilhouette } from './evalView';
import { cameraFromFrame } from './views';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));

/**
 * A vertical tube of radius r round the mannequin from y 5 to 100, open at the mannequin's left (+x) over `openDeg` between y
 * `from` and `to`; `hem(deg)` raises the hem above 5 cm (a ragged hem: no cloth below it in that direction).
 */
function skirt(r: number, openDeg = 0, from = 70, to = 92, hem: (deg: number) => number = () => 5): Mesh {
  const C = 144, R = 95;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= R; i++) for (let c = 0; c < C; c++) {
    const t = (2 * Math.PI * c) / C; // 0 = +z (front), 90° = +x
    positions.push(r * Math.sin(t), 5 + i, r * Math.cos(t));
  }
  for (let i = 0; i < R; i++) for (let c = 0; c < C; c++) {
    const a = i * C + c, b = i * C + ((c + 1) % C), d = (i + 1) * C + c, e = (i + 1) * C + ((c + 1) % C);
    const mid = (360 * (c + 0.5)) / C;
    const y = 5 + i + 0.5;
    if (openDeg > 0 && Math.abs(mid - 90) < openDeg / 2 && y > from && y < to) continue;
    if (y < hem(mid)) continue;
    indices.push(a, d, e, a, e, b);
  }
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices), vertexPart: new Uint8Array(positions.length / 3), partNames: ['garment'] } as unknown as Mesh;
}

describe('openingProfile', () => {
  it('a closed skirt: no opening, the hip girth is the circle, the cloth outside the body', () => {
    const p = openingProfile(skirt(22), m);
    expect(p.openings).toEqual([]);
    const hip = sliceAt(p, m.morphHeights.hip)!;
    expect(hip.coverage).toBe(1);
    expect(hip.bridgedCm!).toBeCloseTo(2 * Math.PI * 22, 0);
    // The M mannequin's hip is 100 cm (the analytic section).
    expect(hip.bodyCm!).toBeGreaterThan(98);
    expect(hip.bodyCm!).toBeLessThan(102);
    expect(hip.minClearanceCm!).toBeGreaterThan(2);
  });

  it('a side slit: found on the mannequin\'s left, from its top to its bottom, its chord measured, bridged girth kept', () => {
    const p = openingProfile(skirt(22, 30), m);
    expect(p.openings).toHaveLength(1);
    const o = p.openings[0]!;
    expect(o.side).toBe('left');
    expect(o.topCm).toBeGreaterThanOrEqual(89);
    expect(o.topCm).toBeLessThanOrEqual(92);
    expect(o.bottomCm).toBeGreaterThanOrEqual(70);
    expect(o.bottomCm).toBeLessThanOrEqual(73);
    // 30° of a 22 cm circle: a chord of 11.4 cm (the 5° bins round it up by at most one bin each side).
    expect(o.maxChordCm).toBeGreaterThan(11);
    expect(o.maxChordCm).toBeLessThan(15.5);
    const hip = sliceAt(p, m.morphHeights.hip)!;
    expect(hip.coverage).toBeLessThan(0.95);
    expect(hip.gaps[0]!.midDeg).toBeGreaterThan(80);
    expect(hip.gaps[0]!.midDeg).toBeLessThan(100);
    expect(hip.bridgedCm!).toBeCloseTo(2 * Math.PI * 22, 0);
  });

  it('the top edge is not an opening', () => {
    // Open over the top 3 cm only: the edge of the garment, above the lowest point of the top edge.
    const top = openingProfile(skirt(22, 60, 98, 101), m);
    expect(top.openings).toEqual([]);
  });

  it('a ragged hem is not an opening: points 9 cm long every 90°, and a hem stepped up 6 cm over a quarter of the way round', () => {
    // Handkerchief hem: lowest at 0°, 90°, 180°, 270°, 9 cm higher halfway between (the cloth between two points ends higher).
    const points = openingProfile(skirt(22, 0, 70, 92, (deg) => 5 + 9 * Math.abs(Math.sin((2 * deg * Math.PI) / 180))), m);
    expect(points.openings).toEqual([]);
    // Asymmetric hem: 6 cm higher over 90° at the back.
    const stepped = openingProfile(skirt(22, 0, 70, 92, (deg) => (Math.abs(deg - 180) < 45 ? 11 : 5)), m);
    expect(stepped.openings).toEqual([]);
    // The same skirt with a real side slit still finds it, and only it.
    const slit = openingProfile(skirt(22, 30, 70, 92, (deg) => 5 + 9 * Math.abs(Math.sin((2 * deg * Math.PI) / 180))), m);
    expect(slit.openings.map((o) => o.side)).toEqual(['left']);
  });
});

describe('stillWidths', () => {
  it('a garment mask narrower than the mannequin by a few pixels each side: the mannequin outside it, both sides', () => {
    const path = turntablePath(m, 'turntable_mid', { frames: 160 });
    const W = 480, H = 832;
    const cf = path.frames[0]!;
    const body = garmentSilhouette(null, buildMannequinMesh(m), cf, W, H);
    // The garment: the body's run through the axis column, 4 px in from each end, on every row.
    const g: Mask = { width: W, height: H, data: new Uint8Array(W * H) };
    for (let y = 0; y < H; y++) {
      const row = body.data.subarray(y * W, (y + 1) * W);
      if (!row[W / 2]) continue;
      let l = W / 2, r = W / 2;
      while (l > 0 && row[l - 1]) l--;
      while (r < W - 1 && row[r + 1]) r++;
      for (let x = l + 4; x <= r - 4; x++) g.data[y * W + x] = 1;
    }
    const cam = cameraFromFrame(cf, W, H);
    const [w] = stillWidths(g, body, cam, [m.morphHeights.hip]);
    const cmPerPx = 1 / (cam.fx / 320);
    expect(w!.bodyCm).toBeGreaterThan(30);
    expect(w!.bodyOutsideLeftCm!).toBeCloseTo(4 * cmPerPx, 0);
    expect(w!.bodyOutsideRightCm!).toBeCloseTo(4 * cmPerPx, 0);
    expect(w!.bodyCm - w!.garmentCm!).toBeCloseTo(8 * cmPerPx, 0);
  });
});
