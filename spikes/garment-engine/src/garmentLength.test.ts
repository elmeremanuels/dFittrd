/**
 * Length definitions (run 14: 83.3 cm vertical drop against a printed 91 cm). A printed garment
 * length is flat-lay: along the garment from the high point shoulder. On known shapes the
 * definitions must give their closed-form values, and the proxy's hem must follow the flat-lay rule.
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, type Mesh } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { garmentLengths, hemForSurfaceLength, matchPrinted, profileLength, sagittalProfile } from './garmentLength';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const hps = m.landmarks.hps;

/**
 * A garment-like tube round the body axis: front depth z(y) = depth(y), elliptical sections wide
 * enough to contain the HPS plane, from `top` down to `hem`.
 */
function tube(top: number, hem: number, depth: (y: number) => number, halfWidth = 25, rows = 120, cols = 96, backDepth: (y: number) => number = depth): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = top - ((top - hem) * r) / rows;
    for (let c = 0; c < cols; c++) {
      const t = (2 * Math.PI * c) / cols;
      pos.push(halfWidth * Math.sin(t), y, (Math.cos(t) >= 0 ? depth(y) : backDepth(y)) * Math.cos(t));
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * cols + c, b = r * cols + ((c + 1) % cols), cc = (r + 1) * cols + ((c + 1) % cols), d = (r + 1) * cols + c;
    idx.push(a, d, cc, a, cc, b);
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx), vertexPart: new Uint8Array(pos.length / 3), partNames: ['t'] };
}

/** The z the tube has at x = hps.x for a section of half-depth b and half-width a. */
const zAt = (b: number, a = 25): number => b * Math.sqrt(1 - (hps[0] / a) ** 2);

describe('length definitions on known shapes', () => {
  it('a straight tube from the HPS height: flat-lay = vertical drop = its height', () => {
    const t = tube(hps[1], hps[1] - 90, () => 12);
    const L = garmentLengths(m, t);
    const drop = L.find((l) => l.definition === 'hps_drop')!.lengthCm!;
    const flat = L.find((l) => l.definition === 'hps_surface')!.lengthCm!;
    expect(drop).toBeCloseTo(90, 1);
    expect(flat).toBeCloseTo(90, 0);
  });

  it('a cone flaring out by 30 cm of depth over 80 cm: flat-lay is the slant (85.4 cm), the drop stays 80', () => {
    const t = tube(hps[1], hps[1] - 80, (y) => 12 + (30 * (hps[1] - y)) / 80);
    const L = garmentLengths(m, t);
    const slant = Math.hypot(80, zAt(42) - zAt(12));
    expect(L.find((l) => l.definition === 'hps_drop')!.lengthCm!).toBeCloseTo(80, 1);
    expect(Math.abs(L.find((l) => l.definition === 'hps_surface')!.lengthCm! - slant)).toBeLessThan(0.3);
    expect(L.find((l) => l.definition === 'hps_surface')!.lengthCm!).toBeGreaterThan(84);
  });

  it('bridges a neckline opening straight from the HPS and says so', () => {
    const t = tube(hps[1] - 6, hps[1] - 86, () => 12);
    const flat = garmentLengths(m, t).find((l) => l.definition === 'hps_surface')!;
    expect(flat.note).toMatch(/below the HPS/);
    expect(Math.abs(flat.lengthCm! - (80 + Math.hypot(6, zAt(12) - hps[2])))).toBeLessThan(0.3);
  });

  it('profileLength starts exactly at a height inside the profile', () => {
    const p = [{ y: 10, z: 0 }, { y: 0, z: 0 }];
    expect(profileLength(p, 4)).toBeCloseTo(4, 9);
  });

  it('sagittalProfile smooths surface noise a tape would bridge (the 2DGS ripples)', () => {
    const smooth = tube(hps[1], hps[1] - 80, () => 12);
    const rough = tube(hps[1], hps[1] - 80, (y) => 12 + 1.2 * Math.sin(y * 3));
    const ls = profileLength(sagittalProfile(smooth, hps[0], 1));
    const lr = profileLength(sagittalProfile(rough, hps[0], 1));
    const lrRaw = profileLength(sagittalProfile(rough, hps[0], 1, 0.5, 0));
    expect(lrRaw - ls).toBeGreaterThan(20); // the raw polyline follows every ripple
    expect(lr - ls).toBeLessThan(1.5);
  });

  it('matchPrinted names the definition closest to the printed value', () => {
    // Flared at the front only: a front/back symmetric cone gives the back length the same slant, and
    // the centre back (x = 0) is a little longer than the HPS plane, so the printed value must tell them apart.
    const t = tube(hps[1], hps[1] - 80, (y) => 12 + (30 * (hps[1] - y)) / 80, 25, 120, 96, () => 12);
    const slant = Math.hypot(80, zAt(42) - zAt(12));
    const r = matchPrinted(garmentLengths(m, t), slant);
    expect(r.best).toBe('hps_surface');
    expect(Math.abs(r.residualCm.back_neck_surface!)).toBeGreaterThan(4);
    expect(Math.abs(r.residualCm.hps_drop!)).toBeGreaterThan(5);
  });

  it('hemForSurfaceLength walks down a profile until the path has the length', () => {
    // z = 0.75 · drop: every cm down is 1.25 cm of path.
    const y = hemForSurfaceLength([0, 100, 0], 50, (yy) => 0.75 * (100 - yy));
    expect(y).toBeCloseTo(60, 1);
  });
});
