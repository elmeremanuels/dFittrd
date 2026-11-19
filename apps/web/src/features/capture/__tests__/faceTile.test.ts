import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACE_OVAL, buildFaceTile, headPose, matchTileToSkin, photoNotices, suggestSkin, type NormPoint, type RgbaImage } from '../faceTile';
import { FACE_REGIONS } from '../landmarks';
import { MONK_SWATCHES, srgbToLab } from '../faceSkin';

/**
 * A synthetic face: an ellipse of skin on a grey background, two dark eyes and a dark mouth, and a
 * matching set of 478 landmarks (the oval on the ellipse's edge, the eye, cheek and nose points
 * where the drawing has them). Not a photo of anybody.
 */
interface Synth {
  img: RgbaImage;
  lm: NormPoint[];
}

const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

function synthFace(opts: { skin?: string; size?: number; rollDeg?: number; sideLight?: number; noseOffset?: number; bg?: [number, number, number]; scale?: number } = {}): Synth {
  const S = opts.size ?? 400;
  const skin = hexRgb(opts.skin ?? '#C8A07A');
  const bg = opts.bg ?? [128, 128, 128];
  const roll = ((opts.rollDeg ?? 0) * Math.PI) / 180;
  const k = opts.scale ?? 1;
  const cx = S / 2;
  const cy = S / 2;
  const rx = 0.25 * S * k;
  const ry = 0.32 * S * k;
  const rot = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * Math.cos(roll) - dy * Math.sin(roll), cy + dx * Math.sin(roll) + dy * Math.cos(roll)];
  };
  const unrot = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * Math.cos(-roll) - dy * Math.sin(-roll), cy + dx * Math.sin(-roll) + dy * Math.cos(-roll)];
  };
  const eyeY = cy - 0.12 * ry;
  const eyeDx = 0.42 * rx;
  const mouthY = cy + 0.55 * ry;
  const data = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const [u, v] = unrot(x, y);
      const o = (y * S + x) * 4;
      let c: [number, number, number] = bg;
      if (((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1) {
        const light = 1 + (opts.sideLight ?? 0) * ((u - cx) / rx);
        c = [skin[0] * light, skin[1] * light, skin[2] * light];
        const eye = (ex: number): boolean => ((u - ex) / (0.12 * rx)) ** 2 + ((v - eyeY) / (0.06 * ry)) ** 2 <= 1;
        if (eye(cx - eyeDx) || eye(cx + eyeDx)) c = [30, 24, 20];
        if (Math.abs(v - mouthY) < 0.03 * ry && Math.abs(u - cx) < 0.3 * rx) c = [110, 40, 40];
      }
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  const lm: NormPoint[] = Array.from({ length: 478 }, () => ({ x: cx / S, y: cy / S }));
  const set = (i: number, x: number, y: number): void => {
    const [px, py] = rot(x, y);
    lm[i] = { x: px / S, y: py / S };
  };
  // Oval clockwise from the top (landmark 10), as MediaPipe orders it.
  FACE_OVAL.forEach((id, n) => {
    const t = (n / FACE_OVAL.length) * Math.PI * 2;
    set(id, cx + Math.sin(t) * rx * 0.98, cy - Math.cos(t) * ry * 0.98);
  });
  set(234, cx - rx * 0.98, cy);
  set(454, cx + rx * 0.98, cy);
  set(1, cx + (opts.noseOffset ?? 0) * rx, cy + 0.2 * ry);
  set(33, cx - eyeDx - 0.1 * rx, eyeY);
  set(133, cx - eyeDx + 0.1 * rx, eyeY);
  set(362, cx + eyeDx - 0.1 * rx, eyeY);
  set(263, cx + eyeDx + 0.1 * rx, eyeY);
  // Skin sample points: the cheeks, forehead and nose bridge inside the skin.
  FACE_REGIONS.leftCheek.forEach((id, n) => set(id, cx + rx * (0.45 + 0.02 * n), cy + 0.2 * ry));
  FACE_REGIONS.rightCheek.forEach((id, n) => set(id, cx - rx * (0.45 + 0.02 * n), cy + 0.2 * ry));
  FACE_REGIONS.forehead.forEach((id, n) => set(id, cx + rx * (-0.3 + 0.06 * n), cy - 0.5 * ry));
  FACE_REGIONS.noseBridge.forEach((id, n) => set(id, cx, cy + ry * (0.02 * n)));
  return { img: { width: S, height: S, data }, lm };
}

const labOf = (rgba: Uint8ClampedArray, i: number): { L: number; a: number; b: number } => srgbToLab(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildFaceTile', () => {
  it('makes a tile with the aspect of the head, opaque in the middle and clear at the corners', () => {
    const { img, lm } = synthFace();
    const t = buildFaceTile(img, lm, { width: 120, aspect: 1.2 });
    expect(t.width).toBe(120);
    expect(t.height).toBe(144);
    expect(t.rgba.length).toBe(120 * 144 * 4);
    const at = (x: number, y: number): number => t.rgba[(y * t.width + x) * 4 + 3]!;
    expect(at(60, 72)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(at(119, 143)).toBe(0);
  });

  it('keeps the skin colour of the photo (before any match)', () => {
    const { img, lm } = synthFace({ skin: '#A07E56' });
    const t = buildFaceTile(img, lm);
    const want = srgbToLab(0xa0, 0x7e, 0x56);
    expect(Math.abs(t.skinLab.L - want.L)).toBeLessThan(5);
    expect(Math.abs(t.skinLab.a - want.a)).toBeLessThan(4);
    expect(Math.abs(t.skinLab.b - want.b)).toBeLessThan(4);
  });

  it('turns a tilted head level: both eyes land on the same row', () => {
    const { img, lm } = synthFace({ rollDeg: 18 });
    expect(Math.abs(headPose(lm, img.width, img.height).rollDeg - 18)).toBeLessThan(1);
    const t = buildFaceTile(img, lm, { width: 120 });
    const darkRows = (x0: number, x1: number): number => {
      let best = -1;
      let bestL = 999;
      for (let y = 0; y < t.height; y++) {
        let sum = 0;
        for (let x = x0; x < x1; x++) sum += labOf(t.rgba, y * t.width + x).L;
        if (sum < bestL) {
          bestL = sum;
          best = y;
        }
      }
      return best;
    };
    const left = darkRows(25, 50);
    const right = darkRows(70, 95);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
  });

  it('takes most of a side light out', () => {
    const { img, lm } = synthFace({ sideLight: 0.3 });
    const t = buildFaceTile(img, lm, { width: 120 });
    const row = Math.round(t.height * 0.62);
    const L = (x: number): number => labOf(t.rgba, row * t.width + x).L;
    const photoL = (fx: number): number => {
      const x = Math.round(img.width / 2 + fx * img.width * 0.25);
      const y = Math.round(img.height / 2 + 0.2 * img.height * 0.32);
      const o = (y * img.width + x) * 4;
      return srgbToLab(img.data[o]!, img.data[o + 1]!, img.data[o + 2]!).L;
    };
    const before = Math.abs(photoL(0.6) - photoL(-0.6));
    const after = Math.abs(L(Math.round(t.width * 0.8)) - L(Math.round(t.width * 0.2)));
    expect(before).toBeGreaterThan(15);
    expect(after).toBeLessThan(before * 0.5);
  });

  it('keeps the eyes and the mouth darker than the skin (they must read at a small size)', () => {
    const { img, lm } = synthFace();
    const t = buildFaceTile(img, lm, { width: 120 });
    let minL = 100;
    for (let i = 0; i < t.width * t.height; i++) if (t.rgba[i * 4 + 3] === 255) minL = Math.min(minL, labOf(t.rgba, i).L);
    expect(t.skinLab.L - minL).toBeGreaterThan(30);
  });

  it('refuses something that is not a face mesh', () => {
    const { img } = synthFace();
    expect(() => buildFaceTile(img, [{ x: 0.5, y: 0.5 }])).toThrow();
  });

  it('makes no request of any kind', () => {
    const trap = vi.fn(() => {
      throw new Error('network');
    });
    vi.stubGlobal('fetch', trap);
    vi.stubGlobal('XMLHttpRequest', trap);
    vi.stubGlobal('WebSocket', trap);
    vi.stubGlobal('navigator', { sendBeacon: trap });
    const { img, lm } = synthFace();
    const t = buildFaceTile(img, lm);
    matchTileToSkin(t, '#825C43');
    suggestSkin(img, lm);
    photoNotices(img, lm);
    expect(trap).not.toHaveBeenCalled();
    // The result holds pixels and a colour, never the landmarks.
    expect(Object.keys(t).sort()).toEqual(['height', 'rgba', 'skinLab', 'width']);
  });
});

describe('matchTileToSkin', () => {
  it('moves the skin of the tile to the colour of the body and keeps the contrast of the features', () => {
    const { img, lm } = synthFace({ skin: '#D7BD96' });
    const t = buildFaceTile(img, lm, { width: 100 });
    const out = matchTileToSkin(t, '#604134');
    const target = srgbToLab(0x60, 0x41, 0x34);
    const centre = Math.round(t.height * 0.62) * t.width + Math.round(t.width * 0.3);
    const got = labOf(out, centre);
    expect(Math.abs(got.L - target.L)).toBeLessThan(6);
    // Alpha untouched, input untouched.
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(t.rgba[i]);
    expect(labOf(t.rgba, centre).L).toBeGreaterThan(got.L + 20);
  });

  it('returns an unchanged copy for a colour that is not #rrggbb', () => {
    const { img, lm } = synthFace();
    const t = buildFaceTile(img, lm, { width: 64 });
    const out = matchTileToSkin(t, 'red');
    expect(out).not.toBe(t.rgba);
    expect(Array.from(out)).toEqual(Array.from(t.rgba));
  });
});

describe('suggestSkin', () => {
  it.each(MONK_SWATCHES.map((hex, i) => [i + 1, hex] as const))('proposes Monk %i (or a neighbour) for a face of that swatch under even light', (monk, hex) => {
    const { img, lm } = synthFace({ skin: hex });
    const s = suggestSkin(img, lm);
    expect(s).not.toBeNull();
    expect(Math.abs(s!.monk - monk)).toBeLessThanOrEqual(1);
  });
});

describe('photoNotices', () => {
  it('says nothing about a frontal, evenly lit, large face on a grey ground', () => {
    const { img, lm } = synthFace();
    expect(photoNotices(img, lm)).toEqual([]);
  });

  it('warns about a side light, a turned head, a small face, a dark photo and a colour cast', () => {
    expect(photoNotices(...Object.values(synthFace({ sideLight: 0.35 })) as [RgbaImage, NormPoint[]])).toContain('side');
    expect(photoNotices(...Object.values(synthFace({ noseOffset: 0.4 })) as [RgbaImage, NormPoint[]])).toContain('turned');
    expect(photoNotices(...Object.values(synthFace({ scale: 0.25 })) as [RgbaImage, NormPoint[]])).toContain('small');
    expect(photoNotices(...Object.values(synthFace({ skin: '#2A2420', bg: [20, 20, 22] })) as [RgbaImage, NormPoint[]])).toContain('dark');
    expect(photoNotices(...Object.values(synthFace({ bg: [200, 150, 60] })) as [RgbaImage, NormPoint[]])).toContain('cast');
  });
});
