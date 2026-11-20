import { afterEach, describe, expect, it, vi } from 'vitest';
import { bakeFaceTexture, blur3, headPose, rematchFaceTexture, type FaceTopology, type NormPoint, type RgbaImage } from '../faceBake';
import topoJson from '../faceMeshUv.json';

const topo = topoJson as unknown as FaceTopology;
const W = 400;
const H = 500;
const S = 128;

/** Landmarks where the face frame is mapped affinely into the synthetic photo: px = (80 + 240 u, 60 + 360 v). */
function affineLandmarks(shiftNose = 0): NormPoint[] {
  const out: NormPoint[] = [];
  for (let i = 0; i < 468; i++) {
    const u = topo.uv[2 * i]!, v = topo.uv[2 * i + 1]!;
    out.push({ x: (80 + 240 * u + (i === topo.landmarks.noseTip ? shiftNose : 0)) / W, y: (60 + 360 * v) / H });
  }
  return out;
}

function image(fill: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(4 * W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y);
      const o = 4 * (y * W + x);
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

const px = (bake: { rgba: Uint8ClampedArray; size: number }, u: number, v: number): [number, number, number, number] => {
  const x = Math.min(bake.size - 1, Math.floor(u * bake.size)), y = Math.min(bake.size - 1, Math.floor(v * bake.size));
  const o = 4 * (y * bake.size + x);
  return [bake.rgba[o]!, bake.rgba[o + 1]!, bake.rgba[o + 2]!, bake.rgba[o + 3]!];
};

const uvOf = (i: number): [number, number] => [topo.uv[2 * i]!, topo.uv[2 * i + 1]!];

describe('face mesh asset', () => {
  it('has the 898 triangles of the canonical mesh over 468 landmarks, all inside the frame', () => {
    expect(topo.triangles).toHaveLength(898 * 3);
    expect(topo.uv).toHaveLength(468 * 2);
    expect(Math.max(...topo.triangles)).toBe(467);
    for (const c of topo.uv) {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(1);
    }
    expect(topo.oval).toHaveLength(36);
  });
});

describe('bakeFaceTexture', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('warps the photo onto the frame: each landmark samples the photo where it was found', () => {
    // Colour encodes the photo position (R = x, G = y).
    const img = image((x, y) => [Math.round((255 * x) / W), Math.round((255 * y) / H), 128]);
    const bake = bakeFaceTexture(img, affineLandmarks(), topo, { size: S, delight: 0 });
    for (const id of [topo.landmarks.noseTip, 13, 159, 386, 151]) {
      const [u, v] = uvOf(id);
      const [r, g, , a] = px(bake, u, v);
      // (151, high on the forehead, is near the edge, where a non-skin colour such as this ramp is faded out.)
      expect(a).toBeGreaterThan(0);
      expect(r).toBeCloseTo((255 * (80 + 240 * u)) / W, -0.6); // within ~2 levels
      expect(g).toBeCloseTo((255 * (60 + 360 * v)) / H, -0.6);
    }
  });

  it('feathers the edge: opaque in the middle, clear outside the face oval and in the corners', () => {
    const bake = bakeFaceTexture(image(() => [180, 140, 110]), affineLandmarks(), topo, { size: S });
    expect(px(bake, ...uvOf(topo.landmarks.noseTip))[3]).toBe(255);
    for (const [u, v] of [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99]] as const) expect(px(bake, u, v)[3]).toBe(0);
    // On the oval itself the face is already faded out (the edge of the mesh never shows).
    for (const id of topo.oval) expect(px(bake, ...uvOf(id))[3]).toBeLessThan(40);
    expect(bake.stats.coverage).toBeGreaterThan(0.25);
    expect(bake.stats.coverage).toBeLessThan(0.7);
  });

  it('divides out a side light (de-light) and matches the median to the body skin colour', () => {
    // Skin lit from the left: twice as bright on the left of the face as on the right.
    const lit = image((x) => {
      const k = 1.3 - (0.65 * x) / W;
      return [Math.min(255, 170 * k), Math.min(255, 128 * k), Math.min(255, 100 * k)];
    });
    const lum = (b: { rgba: Uint8ClampedArray; size: number }, u: number, v: number): number => {
      const [r, g, bl] = px(b, u, v);
      return 0.3 * r + 0.59 * g + 0.11 * bl;
    };
    const left = uvOf(topo.landmarks.rightCheek), right = uvOf(topo.landmarks.leftCheek);
    // Sample inside the face, a little in from the cheeks.
    const l: [number, number] = [left[0] + 0.12, left[1]], r: [number, number] = [right[0] - 0.12, right[1]];
    const raw = bakeFaceTexture(lit, affineLandmarks(), topo, { size: S, delight: 0 });
    const flat = bakeFaceTexture(lit, affineLandmarks(), topo, { size: S, delight: 1 });
    const rawRatio = lum(raw, ...l) / lum(raw, ...r), flatRatio = lum(flat, ...l) / lum(flat, ...r);
    expect(rawRatio).toBeGreaterThan(1.2);
    // At least two thirds of the side light is gone.
    expect(flatRatio - 1).toBeLessThan((rawRatio - 1) / 3);
    const matched = bakeFaceTexture(lit, affineLandmarks(), topo, { size: S, targetSkinHex: '#a07e56' });
    const [mr, mg, mb] = px(matched, ...uvOf(topo.landmarks.noseTip));
    expect(Math.abs(mr - 0xa0)).toBeLessThan(10);
    expect(Math.abs(mg - 0x7e)).toBeLessThan(10);
    expect(Math.abs(mb - 0x56)).toBeLessThan(10);
    // Outside the face the colour is the target too (alpha 0), so texture filtering cannot pull in black.
    expect(px(matched, 0.01, 0.01).slice(0, 3)).toEqual([0xa0, 0x7e, 0x56]);
  });

  it('returns the texture and a few numbers, never the landmarks, and makes no network call', () => {
    const calls: string[] = [];
    const trap = (name: string) => (...args: unknown[]): never => {
      calls.push(name);
      throw new Error(`${name} called with ${args.length} args`);
    };
    vi.stubGlobal('fetch', trap('fetch'));
    vi.stubGlobal('XMLHttpRequest', trap('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', trap('WebSocket'));
    vi.stubGlobal('navigator', { sendBeacon: trap('sendBeacon') });
    const bake = bakeFaceTexture(image(() => [150, 120, 100]), affineLandmarks(), topo, { size: S });
    expect(calls).toEqual([]);
    expect(Object.keys(bake).sort()).toEqual(['rgba', 'size', 'stats']);
    expect(Object.keys(bake.stats).sort()).toEqual(['coverage', 'delightGain', 'facePx', 'medianHex', 'rollDeg', 'yawDeg']);
    for (const v of Object.values(bake.stats)) expect(Array.isArray(v) ? v.length : 1).toBeLessThanOrEqual(2);
  });

  it('re-matches a baked face to another swatch without the photo', () => {
    const bake = bakeFaceTexture(image(() => [170, 128, 100]), affineLandmarks(), topo, { size: S, targetSkinHex: '#a07e56' });
    const again = rematchFaceTexture(bake.rgba, '#a07e56', '#3a312a');
    const [r, g, b, a] = px({ rgba: again, size: S }, ...uvOf(topo.landmarks.noseTip));
    expect(Math.abs(r - 0x3a)).toBeLessThan(6);
    expect(Math.abs(g - 0x31)).toBeLessThan(6);
    expect(Math.abs(b - 0x2a)).toBeLessThan(6);
    expect(a).toBe(255);
    expect(again).not.toBe(bake.rgba);
  });

  it('refuses fewer than 468 landmarks', () => {
    expect(() => bakeFaceTexture(image(() => [0, 0, 0]), affineLandmarks().slice(0, 100), topo)).toThrow(/468/);
  });
});

describe('headPose', () => {
  it('reads a straight face as 0 and a nose to the right as a positive turn', () => {
    expect(Math.abs(headPose(affineLandmarks(), W, H, topo).yawDeg)).toBeLessThan(1);
    expect(Math.abs(headPose(affineLandmarks(), W, H, topo).rollDeg)).toBeLessThan(1);
    expect(headPose(affineLandmarks(40), W, H, topo).yawDeg).toBeGreaterThan(10);
  });
});

describe('blur3', () => {
  it('keeps the sum of a field away from its edges', () => {
    const n = 32;
    const f = new Float32Array(n * n);
    f[16 * n + 16] = 1;
    blur3(f, n, 2);
    expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(f[16 * n + 16]).toBeLessThan(0.1);
  });
});
