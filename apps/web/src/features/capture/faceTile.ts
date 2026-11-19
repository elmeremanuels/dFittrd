/**
 * The shopper's own face as a stylised 2D tile, and a skin tone suggestion, from ONE face photo
 * (docs/research/photo-avatar-plan.md slices 4 and 5; consent copy variant A: nothing leaves the
 * device). Pure: no DOM, no network, no storage. Runs in the scan worker on the pixels of the photo
 * and the 478 landmarks the Face Landmarker found in it.
 *
 * The tile (slice 5):
 *  1. align: the eye line is turned level and the face oval (landmarks of the mesh boundary) is
 *     scaled, with one scale for both axes (the shopper's own proportions are kept), into a tile
 *     with the aspect of the 2D figure's head; each tile pixel averages a small grid of photo pixels.
 *  2. mask: inside the oval, with a soft edge, so the face fades into the skin of the drawn head.
 *  3. de-light: a plane fitted to the lightness of the skin is taken out (a side light, a window on
 *     one side), so the face reads flat like the rest of the drawing.
 *  4. stylise: an edge-keeping blur (pores, noise and compression blocks go; eyes, brows and lips
 *     stay), a soft step in lightness (a drawn, not a photographic look), and a little local
 *     contrast so the eyes, the brows and the mouth still read when the head is 30 px wide.
 * The colour match to the skin on the body is a separate step (`matchTileToSkin`), on the main
 * thread, so a new swatch recolours the tile without the photo.
 *
 * The suggestion (slice 4): the skin of cheeks, forehead and nose bridge → Lab → Monk class
 * (`faceSkin.ts`), plus light checks that warn and never block. It only proposes a swatch: the
 * shopper confirms it or picks another (plan gate G4), and no accuracy is claimed.
 *
 * What leaves this module: the tile pixels, colours and a few numbers. Never the landmarks.
 */
import { estimateSkin, labToSrgb, sampleSkinLab, SKIN_SAMPLE_INDICES, srgbToLab, type Lab } from './faceSkin';
import { FACE_REGIONS } from './landmarks';
import type { SkinEstimate } from './types';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** A landmark as the Face Landmarker gives it: x, y normalised to the image (0..1). */
export interface NormPoint {
  x: number;
  y: number;
}

/** MediaPipe face mesh: the face oval, in order (the mesh boundary; `faceMeshUv.json` has the same list). */
export const FACE_OVAL: readonly number[] = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYE_R: readonly number[] = [33, 133];
const EYE_L: readonly number[] = [362, 263];
const CHEEK_R = 234;
const CHEEK_L = 454;
const NOSE_TIP = 1;

/** Tile width, px. The tile is drawn on a head of about 30 px and in a 64 px chip: 160 px is enough at 2× screens. */
export const FACE_TILE_WIDTH = 160;
/** Head turn above which the photo gets a warning (one side of the face is then squeezed). */
export const MAX_FRONT_YAW_DEG = 15;
/** Face width in the photo under which the photo gets a warning. */
export const MIN_FACE_PX = 120;

export interface TileOptions {
  /** Tile width, px (default FACE_TILE_WIDTH). */
  width?: number;
  /** Height over width of the tile: the 2D figure's head (ry / rx). Default 1.17. */
  aspect?: number;
  /** Width of the soft edge, as a share of the tile width (default 0.07). */
  feather?: number;
}

export interface FaceTile {
  width: number;
  height: number;
  /** RGBA, sRGB, not premultiplied, row 0 at the top. */
  rgba: Uint8ClampedArray;
  /** Median Lab of the skin in the tile (after de-lighting, before any colour match). */
  skinLab: Lab;
}

export type PhotoNotice = 'turned' | 'small' | 'bright' | 'dark' | 'side' | 'cast';

export interface HeadPose {
  yawDeg: number;
  rollDeg: number;
  /** Cheek to cheek in the photo, px. */
  facePx: number;
}

const mean2 = (pts: [number, number][]): [number, number] => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0] / pts.length;
    y += p[1] / pts.length;
  }
  return [x, y];
};

/** Turn and tilt of the head from the landmarks (pixel space); 0 = straight at the camera. */
export function headPose(lm: readonly NormPoint[], width: number, height: number): HeadPose {
  const px = (i: number): [number, number] => [lm[i]!.x * width, lm[i]!.y * height];
  const r = px(CHEEK_R);
  const l = px(CHEEK_L);
  const n = px(NOSE_TIP);
  const half = Math.hypot(l[0] - r[0], l[1] - r[1]) / 2 || 1;
  const off = (n[0] - (r[0] + l[0]) / 2) / half;
  // Canonical face: the nose tip is 9.9 cm in front of the cheek points, which are 7.66 cm from the middle.
  const yawDeg = (Math.atan((off * 7.66) / 9.92) * 180) / Math.PI;
  const re = mean2(EYE_R.map(px));
  const le = mean2(EYE_L.map(px));
  const rollDeg = (Math.atan2(le[1] - re[1], le[0] - re[0]) * 180) / Math.PI;
  return { yawDeg, rollDeg, facePx: 2 * half };
}

const smooth01 = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Signed distance (px) from a point to a closed polygon: positive inside. */
function polygonDistance(px: number, py: number, poly: readonly [number, number][]): number {
  let inside = false;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / len2));
    const d = Math.hypot(px - (xi + t * dx), py - (yi + t * dy));
    if (d < best) best = d;
  }
  return inside ? best : -best;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/** Box blur of radius r on a w × h field (two passes ≈ a soft Gaussian). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          s += a[y * w + xx]!;
          n++;
        }
        b[y * w + x] = s / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          s += b[yy * w + x]!;
          n++;
        }
        a[y * w + x] = s / n;
      }
    }
  }
  return a;
}

/**
 * The stylised face tile. Throws when the landmarks are not a full face mesh (fewer than 455 points).
 */
export function buildFaceTile(image: RgbaImage, lm: readonly NormPoint[], options: TileOptions = {}): FaceTile {
  if (lm.length < 455) throw new Error('not a face mesh');
  const W = Math.max(32, Math.round(options.width ?? FACE_TILE_WIDTH));
  const H = Math.round(W * (options.aspect ?? 1.17));
  const feather = (options.feather ?? 0.07) * W;
  const { width: iw, height: ih, data } = image;
  const pose = headPose(lm, iw, ih);
  const roll = (pose.rollDeg * Math.PI) / 180;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const eyes = mean2([...EYE_R, ...EYE_L].map((i) => [lm[i]!.x * iw, lm[i]!.y * ih] as [number, number]));
  // Photo → level frame (eye line horizontal), around the eye centre.
  const toLevel = (x: number, y: number): [number, number] => {
    const dx = x - eyes[0];
    const dy = y - eyes[1];
    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  };
  const fromLevel = (u: number, v: number): [number, number] => [eyes[0] + u * cos - v * sin, eyes[1] + u * sin + v * cos];
  const oval = FACE_OVAL.map((i) => toLevel(lm[i]!.x * iw, lm[i]!.y * ih));
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [u, v] of oval) {
    x0 = Math.min(x0, u);
    x1 = Math.max(x1, u);
    y0 = Math.min(y0, v);
    y1 = Math.max(y1, v);
  }
  // A little room around the oval for the soft edge.
  const padX = (x1 - x0) * 0.05;
  const padY = (y1 - y0) * 0.04;
  x0 -= padX;
  x1 += padX;
  y0 -= padY;
  y1 += padY;
  const s = Math.min(W / (x1 - x0), H / (y1 - y0));
  const offU = (W - (x1 - x0) * s) / 2;
  const offV = (H - (y1 - y0) * s) / 2;
  const toTile = (u: number, v: number): [number, number] => [offU + (u - x0) * s, offV + (v - y0) * s];
  const ovalTile = oval.map(([u, v]) => toTile(u, v));

  // 1. Sample: each tile pixel averages a grid of photo pixels (the tile is usually smaller than the face).
  const grid = Math.max(1, Math.min(4, Math.ceil(1 / s)));
  const n = W * H;
  const Lf = new Float32Array(n);
  const Af = new Float32Array(n);
  const Bf = new Float32Array(n);
  const alpha = new Float32Array(n);
  const sample = (x: number, y: number): [number, number, number] => {
    const xi = Math.min(iw - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(ih - 1, Math.max(0, Math.round(y)));
    const o = (yi * iw + xi) * 4;
    return [data[o]!, data[o + 1]!, data[o + 2]!];
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      const d = polygonDistance(tx + 0.5, ty + 0.5, ovalTile);
      alpha[i] = smooth01(-feather * 0.25, feather, d);
      if (alpha[i]! <= 0) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          const u = x0 + (tx - offU + (gx + 0.5) / grid) / s;
          const v = y0 + (ty - offV + (gy + 0.5) / grid) / s;
          const [px, py] = fromLevel(u, v);
          const c = sample(px, py);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const k = grid * grid;
      const lab = srgbToLab(r / k, g / k, b / k);
      Lf[i] = lab.L;
      Af[i] = lab.a;
      Bf[i] = lab.b;
    }
  }

  // 2. Skin pixels of the tile: well inside the oval and near the median lightness (no eyes, brows, lips, hair).
  const inner: number[] = [];
  for (let i = 0; i < n; i++) if (alpha[i]! >= 0.98) inner.push(i);
  const medL0 = median(inner.map((i) => Lf[i]!));
  const skin = inner.filter((i) => Math.abs(Lf[i]! - medL0) < 14);

  // 3. De-light: fit L = c0 + c1 x + c2 y to the skin and take out the slope (the centre keeps its level).
  if (skin.length >= 30) {
    let sx = 0, sy = 0, sl = 0, sxx = 0, syy = 0, sxy = 0, sxl = 0, syl = 0;
    for (const i of skin) {
      const x = (i % W) / W - 0.5;
      const y = Math.floor(i / W) / H - 0.5;
      const l = Lf[i]!;
      sx += x; sy += y; sl += l; sxx += x * x; syy += y * y; sxy += x * y; sxl += x * l; syl += y * l;
    }
    const m = skin.length;
    // Centred normal equations for the two slopes.
    const cxx = sxx - (sx * sx) / m;
    const cyy = syy - (sy * sy) / m;
    const cxy = sxy - (sx * sy) / m;
    const cxl = sxl - (sx * sl) / m;
    const cyl = syl - (sy * sl) / m;
    const det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) > 1e-9) {
      const gx = (cxl * cyy - cyl * cxy) / det;
      const gy = (cyl * cxx - cxl * cxy) / det;
      for (let i = 0; i < n; i++) {
        if (alpha[i]! <= 0) continue;
        const x = (i % W) / W - 0.5;
        const y = Math.floor(i / W) / H - 0.5;
        // The vertical slope is kept a little: a face is lit from above in any drawing.
        Lf[i] = Lf[i]! - 0.85 * gx * x - 0.6 * gy * y;
      }
    }
  }

  // 4a. Edge-keeping blur (a small bilateral filter on Lab, two rounds).
  const R = 2;
  const sigL = 7;
  for (let round = 0; round < 2; round++) {
    const L2 = Float32Array.from(Lf);
    const A2 = Float32Array.from(Af);
    const B2 = Float32Array.from(Bf);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (alpha[i]! <= 0) continue;
        let wsum = 0, l = 0, a = 0, b = 0;
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const j = yy * W + xx;
            if (alpha[j]! <= 0) continue;
            const dl = Lf[j]! - Lf[i]!;
            const w = Math.exp(-(dx * dx + dy * dy) / 4.5 - (dl * dl) / (2 * sigL * sigL));
            wsum += w;
            l += w * Lf[j]!;
            a += w * Af[j]!;
            b += w * Bf[j]!;
          }
        }
        L2[i] = l / wsum;
        A2[i] = a / wsum;
        B2[i] = b / wsum;
      }
    }
    Lf.set(L2);
    Af.set(A2);
    Bf.set(B2);
  }

  // 4b. Local contrast (eyes, brows, lips read at a small size), then a soft step in lightness.
  const blurL = boxBlur(Lf, W, H, Math.max(2, Math.round(W / 40)));
  for (let i = 0; i < n; i++) {
    if (alpha[i]! <= 0) continue;
    const detail = Math.max(-16, Math.min(16, Lf[i]! - blurL[i]!));
    let l = Lf[i]! + 0.9 * detail;
    const step = 8;
    l = 0.6 * l + 0.4 * (Math.round(l / step) * step);
    Lf[i] = Math.max(0, Math.min(100, l));
    // A drawing is a little less saturated than a photo.
    Af[i] = Af[i]! * 0.92;
    Bf[i] = Bf[i]! * 0.92;
  }

  const skinAfter = skin.length >= 30 ? skin : inner;
  const skinLab: Lab = {
    L: median(skinAfter.map((i) => Lf[i]!)),
    a: median(skinAfter.map((i) => Af[i]!)),
    b: median(skinAfter.map((i) => Bf[i]!)),
  };

  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (alpha[i]! <= 0) continue;
    const c = labToSrgb({ L: Lf[i]!, a: Af[i]!, b: Bf[i]! });
    rgba[o] = c.r;
    rgba[o + 1] = c.g;
    rgba[o + 2] = c.b;
    rgba[o + 3] = Math.round(alpha[i]! * 255);
  }
  return { width: W, height: H, rgba, skinLab: { L: round1(skinLab.L), a: round1(skinLab.a), b: round1(skinLab.b) } };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function hexToLab(hex: string): Lab | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return srgbToLab(parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16));
}

/**
 * The tile recoloured so its skin has the colour of the drawn body (`#rrggbb`, the shopper's
 * confirmed swatch as drawn): every pixel moves by the same step in Lab, so the eyes, brows and
 * lips keep their contrast to the skin. A new array; the input is not changed. An invalid colour
 * returns a copy.
 */
export function matchTileToSkin(tile: Pick<FaceTile, 'rgba' | 'skinLab'>, toHex: string): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tile.rgba);
  const to = hexToLab(toHex);
  if (!to) return out;
  const dL = to.L - tile.skinLab.L;
  const da = to.a - tile.skinLab.a;
  const db = to.b - tile.skinLab.b;
  for (let o = 0; o < out.length; o += 4) {
    if (out[o + 3] === 0) continue;
    const lab = srgbToLab(out[o]!, out[o + 1]!, out[o + 2]!);
    const c = labToSrgb({ L: Math.max(0, Math.min(100, lab.L + dL)), a: lab.a + da, b: lab.b + db });
    out[o] = c.r;
    out[o + 1] = c.g;
    out[o + 2] = c.b;
  }
  return out;
}

export interface SkinSuggestion {
  /** The Monk class the photo points to, 1..10. Only a proposal: the shopper picks the swatch. */
  monk: number;
  undertone: SkinEstimate['undertone'];
  /** The measured colour (not shown as the shopper's colour; the confirmed swatch is). */
  lab: Lab;
  sampleCount: number;
}

/** Skin tone suggestion from the cheeks, forehead and nose bridge (no segmenter: k-means drops shadows and highlights). */
export function suggestSkin(image: RgbaImage, lm: readonly NormPoint[]): SkinSuggestion | null {
  const radius = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.008));
  const samples = sampleSkinLab(image, lm.map((p) => ({ x: p.x, y: p.y })), SKIN_SAMPLE_INDICES, null, radius);
  if (samples.length < 40) return null;
  const est = estimateSkin(samples);
  if (!est) return null;
  return { monk: est.monk, undertone: est.undertone, lab: est.lab, sampleCount: est.sampleCount };
}

/**
 * Light checks of the photo (slice 4). They warn and offer another photo or a hand pick; they
 * never block. Thresholds are first guesses, not tuned on a test set (slice 9).
 */
export function photoNotices(image: RgbaImage, lm: readonly NormPoint[]): PhotoNotice[] {
  const out: PhotoNotice[] = [];
  const pose = headPose(lm, image.width, image.height);
  if (Math.abs(pose.yawDeg) > MAX_FRONT_YAW_DEG) out.push('turned');
  if (pose.facePx < MIN_FACE_PX) out.push('small');
  const radius = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.008));
  const pts = lm.map((p) => ({ x: p.x, y: p.y }));
  const skin = sampleSkinLab(image, pts, SKIN_SAMPLE_INDICES, null, radius);
  if (skin.length > 0 && skin.filter((p) => p.L > 93).length / skin.length > 0.08) out.push('bright');
  // The whole picture: under-exposed when even its bright end is dark; a cast when its average is far from grey.
  const Ls: number[] = [];
  let sa = 0;
  let sb = 0;
  const stride = Math.max(1, Math.round(Math.sqrt((image.width * image.height) / 6000)));
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const o = (y * image.width + x) * 4;
      const lab = srgbToLab(image.data[o]!, image.data[o + 1]!, image.data[o + 2]!);
      Ls.push(lab.L);
      sa += lab.a;
      sb += lab.b;
    }
  }
  Ls.sort((a, b) => a - b);
  const p98 = Ls[Math.floor(Ls.length * 0.98)] ?? 0;
  if (p98 < 45) out.push('dark');
  const left = sampleSkinLab(image, pts, FACE_REGIONS.leftCheek, null, radius).map((p) => p.L);
  const right = sampleSkinLab(image, pts, FACE_REGIONS.rightCheek, null, radius).map((p) => p.L);
  if (left.length > 5 && right.length > 5 && Math.abs(median(left) - median(right)) > 10) out.push('side');
  if (Ls.length > 0 && Math.hypot(sa / Ls.length, sb / Ls.length) > 12) out.push('cast');
  return out;
}
