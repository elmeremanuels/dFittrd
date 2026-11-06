import { describe, expect, it } from 'vitest';
import { buildMannequinMesh, turntablePath, type Mesh } from '@curtain/mannequin';
import { decodeAnyPng } from './evalPng';
import { garmentSilhouette, overlayPng, scoreView, shopPhotoScore } from './evalView';
import { fixtureMannequin as m, syntheticDress } from './evalFixtures';

const body = buildMannequinMesh(m);
const path = turntablePath(m, 'turntable_mid', { frames: 8 });
const W = 96, H = 160;
const dress = syntheticDress();
const shifted = (mesh: Mesh, dx: number): Mesh => {
  const positions = Float64Array.from(mesh.positions);
  for (let i = 0; i < positions.length; i += 3) positions[i]! += dx;
  return { ...mesh, positions };
};

describe('view agreement', () => {
  const front = garmentSilhouette(body, dress, path.frames[0]!, W, H);

  it('renders only the visible garment: something at the front, the mannequin occludes the rest', () => {
    const area = front.data.reduce((n, v) => n + v, 0);
    expect(area).toBeGreaterThan(0.1 * W * H);
    expect(area).toBeLessThan(0.6 * W * H);
  });

  it('scores the same garment at 1 and a shifted one lower', () => {
    const ref = { view: 'front' as const, frame: 0, kind: 'stage1b' as const, path: 'stage1b/garment_mask_front.png', mask: front, invented: false };
    const same = scoreView(front, ref);
    expect(same.iou).toBe(1);
    expect(same.pass).toBe(true);
    const off = scoreView(garmentSilhouette(body, shifted(dress, 12), path.frames[0]!, W, H), ref);
    expect(off.iou).toBeLessThan(0.85);
    expect(off.pass).toBe(false);
  });

  it('compares with a shop photo silhouette regardless of position, scale and mirroring (indicative only)', () => {
    // The same silhouette, twice as large, moved, and mirrored: a "photo" of the same outline.
    const W2 = 2 * W + 40, H2 = 2 * H + 20;
    const photo = { width: W2, height: H2, data: new Uint8Array(W2 * H2) };
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const sx = Math.floor((W2 - 1 - x - 30) / 2), sy = Math.floor((y - 10) / 2);
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) photo.data[y * W2 + x] = front.data[sy * W + sx]!;
    }
    const s = shopPhotoScore('front', front, photo, 'stage1b/source/front_mask.png')!;
    expect(s.normalisedIou).toBeGreaterThan(0.9);
    expect(s.label).toMatch(/indicative/);
    expect(shopPhotoScore('front', front, { width: 4, height: 4, data: new Uint8Array(16) }, 'x')).toBeNull();
  });

  it('writes an RGB overlay PNG', () => {
    const img = decodeAnyPng(overlayPng(front, front));
    expect([img.width, img.height, img.channels]).toEqual([W, H, 3]);
  });
});
