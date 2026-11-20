/**
 * Face texture bake (slice 6 spike of docs/research/photo-avatar-plan.md). Pure: no DOM, no
 * network, no storage. Runs in the scan worker on the pixels of ONE front face photo and the 478
 * landmarks the Face Landmarker found in it, and returns a square RGBA texture in the head v2 face
 * frame (`@curtain/mannequin` FACE_UV_FRAME) that the 3D viewer lays over the mannequin's face.
 *
 * Steps (each timed by the worker):
 *  1. warp: every triangle of MediaPipe's canonical face mesh (`faceMeshUv.json`, Apache-2.0) is
 *     drawn from where it is in the photo to where that landmark sits on head v2. So the shopper's
 *     eyes, nose and mouth land on the mannequin's sculpted ones (the face is normalised to the
 *     mannequin's proportions; identity cues carried by proportions are lost, see the report).
 *  2. feather: the edge of the mesh is eroded and softened, so the texture fades into the skin.
 *  3. de-light (crude): the smooth light of the photo across the face (a side light, a coloured
 *     lamp: a quadratic per colour channel, fitted to the skin) is divided out; the viewer's own
 *     lights shade the head again. Shading at the scale of the nose stays in. At the edge of the
 *     face only skin-like pixels are kept (hair over the forehead fades out).
 *  4. skin match: the colour is scaled so that its median is the skin colour on the body (the
 *     shopper's confirmed swatch), so the edge of the face has no seam.
 *
 * What leaves this module is the texture and a few numbers; the landmarks are not in the result.
 */
/** sRGB 0..1 → linear 0..1 (faceSkin.ts has the same curve on 0..255 bytes). */
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Linear 0..1 → sRGB 0..1, clamped. */
const linearToSrgb = (v: number): number => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, c));
};

export interface FaceTopology {
  /** Three landmark ids per triangle. */
  triangles: readonly number[];
  /** Per landmark (0..467): u, v of the head v2 face frame (v down from the top). */
  uv: readonly number[];
  /** Landmark ids of the face oval (the mesh boundary), in order. */
  oval: readonly number[];
  landmarks: { rightEye: readonly number[]; leftEye: readonly number[]; noseTip: number; rightCheek: number; leftCheek: number };
}

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

export interface BakeOptions {
  /** Side of the square texture, px (default 512). */
  size?: number;
  /** `#rrggbb` the median of the face is matched to (the skin on the body); null: not matched. */
  targetSkinHex?: string | null;
  /** 0 = keep the photo's light, 1 = divide all of its low-frequency light out (default 0.75). */
  delight?: number;
  /** Width of the soft edge, as a share of the texture side (default 0.035). */
  feather?: number;
}

export interface FaceBakeStats {
  /** Share of the texture with any face on it (alpha > 0). */
  coverage: number;
  /** Head turn and tilt estimated from the landmarks, degrees (0 = straight at the camera). */
  yawDeg: number;
  rollDeg: number;
  /** Median colour of the face before the skin match, after de-lighting. */
  medianHex: string;
  /** Spread of the de-light gain over the face (5th and 95th percentile). */
  delightGain: [number, number];
  /** Face width in the photo, px (small faces give a blurred texture). */
  facePx: number;
}

export interface FaceBake {
  size: number;
  /** RGBA, sRGB, row 0 = top of the frame (v = 0), not premultiplied. */
  rgba: Uint8ClampedArray;
  stats: FaceBakeStats;
}

export const FACE_TEXTURE_SIZE = 512;

/** Head turn above which the bake warns: one side of the face is then stretched (the viewer still shows it). */
export const MAX_FRONT_YAW_DEG = 15;

/** Yaw and roll of the head from the landmarks (pixel space). Positive yaw: the nose is to the right in the image. */
export function headPose(lm: readonly NormPoint[], width: number, height: number, topo: Pick<FaceTopology, 'landmarks'>): { yawDeg: number; rollDeg: number; facePx: number } {
  const px = (i: number): [number, number] => [lm[i]!.x * width, lm[i]!.y * height];
  const mean = (ids: readonly number[]): [number, number] => {
    let x = 0, y = 0;
    for (const i of ids) {
      const p = px(i);
      x += p[0] / ids.length;
      y += p[1] / ids.length;
    }
    return [x, y];
  };
  const r = px(topo.landmarks.rightCheek), l = px(topo.landmarks.leftCheek), n = px(topo.landmarks.noseTip);
  const half = Math.hypot(l[0] - r[0], l[1] - r[1]) / 2 || 1;
  const off = (n[0] - (r[0] + l[0]) / 2) / half;
  // Canonical face: the nose tip is 9.9 cm in front of the cheek points, which are 7.66 cm from the middle.
  const yawDeg = (Math.atan((off * 7.66) / 9.92) * 180) / Math.PI;
  const re = mean(topo.landmarks.rightEye), le = mean(topo.landmarks.leftEye);
  const rollDeg = (Math.atan2(le[1] - re[1], le[0] - re[0]) * 180) / Math.PI;
  return { yawDeg, rollDeg, facePx: 2 * half };
}

function hexToLinear(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return [srgbToLinear(parseInt(m[1]!, 16) / 255), srgbToLinear(parseInt(m[2]!, 16) / 255), srgbToLinear(parseInt(m[3]!, 16) / 255)];
}

const hex2 = (v: number): string => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

const smooth01 = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Solve a 6 × 6 linear system (Gaussian elimination with partial pivoting); zeros when it is singular. */
function solve6(A: Float64Array[], b: Float64Array): number[] {
  const n = 6;
  const M = A.map((row, r) => [...row, b[r]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return new Array<number>(n).fill(0);
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, r) => row[n]! / row[r]!);
}

/** Three passes of a box blur of radius r (≈ a Gaussian of sigma ≈ r), in place, on an n × n field. */
export function blur3(field: Float32Array, n: number, r: number): void {
  if (r < 1) return;
  const tmp = new Float32Array(field.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean): void => {
    const w = 2 * r + 1;
    for (let a = 0; a < n; a++) {
      let acc = 0;
      const at = (b: number): number => {
        const c = Math.min(n - 1, Math.max(0, b));
        return horizontal ? src[a * n + c]! : src[c * n + a]!;
      };
      for (let b = -r; b <= r; b++) acc += at(b);
      for (let b = 0; b < n; b++) {
        if (horizontal) dst[a * n + b] = acc / w;
        else dst[b * n + a] = acc / w;
        acc += at(b + r + 1) - at(b - r);
      }
    }
  };
  for (let i = 0; i < 3; i++) {
    pass(field, tmp, true);
    pass(tmp, field, false);
  }
}

function percentile(values: Float32Array | number[], p: number): number {
  if (values.length === 0) return 0;
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!;
}

/**
 * Bake one face photo into the head v2 face frame. `landmarks` are the Face Landmarker's (478, or
 * the 468 of the mesh), normalised to `image`. Throws when fewer than 468 are given.
 */
export function bakeFaceTexture(image: RgbaImage, landmarks: readonly NormPoint[], topo: FaceTopology, options: BakeOptions = {}): FaceBake {
  if (landmarks.length < 468) throw new Error(`need 468 face landmarks, got ${landmarks.length}`);
  const S = options.size ?? FACE_TEXTURE_SIZE;
  const delight = Math.min(1, Math.max(0, options.delight ?? 0.75));
  const { width: W, height: H, data: src } = image;
  const N = S * S;
  const lin = new Float32Array(3 * N);
  const cov = new Float32Array(N);
  // sRGB → linear lookup for the source bytes.
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) toLin[i] = srgbToLinear(i / 255);

  // 1. Warp: rasterise each triangle in texture space, sample the photo (bilinear, linear light).
  const tri = topo.triangles;
  for (let t = 0; t < tri.length; t += 3) {
    const ids = [tri[t]!, tri[t + 1]!, tri[t + 2]!];
    const d = ids.map((i) => [topo.uv[2 * i]! * S - 0.5, topo.uv[2 * i + 1]! * S - 0.5] as const);
    const s = ids.map((i) => [landmarks[i]!.x * W - 0.5, landmarks[i]!.y * H - 0.5] as const);
    const [d0, d1, d2] = d as [readonly [number, number], readonly [number, number], readonly [number, number]];
    const den = (d1[1] - d2[1]) * (d0[0] - d2[0]) + (d2[0] - d1[0]) * (d0[1] - d2[1]);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(d0[0], d1[0], d2[0]))), x1 = Math.min(S - 1, Math.ceil(Math.max(d0[0], d1[0], d2[0])));
    const y0 = Math.max(0, Math.floor(Math.min(d0[1], d1[1], d2[1]))), y1 = Math.min(S - 1, Math.ceil(Math.max(d0[1], d1[1], d2[1])));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const a = ((d1[1] - d2[1]) * (x - d2[0]) + (d2[0] - d1[0]) * (y - d2[1])) / den;
        const b = ((d2[1] - d0[1]) * (x - d2[0]) + (d0[0] - d2[0]) * (y - d2[1])) / den;
        const c = 1 - a - b;
        const e = -1e-4;
        if (a < e || b < e || c < e) continue;
        const sx = Math.min(W - 1, Math.max(0, a * s[0]![0] + b * s[1]![0] + c * s[2]![0]));
        const sy = Math.min(H - 1, Math.max(0, a * s[0]![1] + b * s[1]![1] + c * s[2]![1]));
        const ix = Math.min(W - 2, Math.floor(sx)), iy = Math.min(H - 2, Math.floor(sy));
        const fx = Math.min(1, sx - ix), fy = Math.min(1, sy - iy);
        const o = y * S + x;
        for (let ch = 0; ch < 3; ch++) {
          const p00 = toLin[src[4 * (iy * W + ix) + ch]!]!, p10 = toLin[src[4 * (iy * W + ix + 1) + ch]!]!;
          const p01 = toLin[src[4 * ((iy + 1) * W + ix) + ch]!]!, p11 = toLin[src[4 * ((iy + 1) * W + ix + 1) + ch]!]!;
          lin[3 * o + ch] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
        }
        cov[o] = 1;
      }
    }
  }

  // 2. Feather: erode by the feather width and soften (blurred coverage, then a smooth ramp from 0.5 to 1).
  const r = Math.max(1, Math.round((options.feather ?? 0.035) * S));
  const soft = Float32Array.from(cov);
  blur3(soft, S, Math.max(1, Math.round(r / 1.7)));
  const alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (cov[i] === 0) continue;
    const t = Math.min(1, Math.max(0, (soft[i]! - 0.5) / 0.5));
    alpha[i] = t * t * (3 - 2 * t);
  }

  // 3. De-light, per channel (so a coloured light, a warm lamp or a cool window, goes too): each channel
  // low-passed over the skin of the face only (normalised convolution; brows, eyes, lips and hair are left out
  // of the average, or they would leave a bright halo), and divided out towards the face's median.
  const lumOf = (i: number): number => 0.2126 * lin[3 * i]! + 0.7152 * lin[3 * i + 1]! + 0.0722 * lin[3 * i + 2]!;
  const R = Math.max(2, Math.round(S / 12));
  // Features are told from skin by how far they are from the LOCAL light (a first low-pass), not from the
  // face's median: a shadowed cheek is skin, a brow is not.
  const l0 = new Float32Array(N);
  for (let i = 0; i < N; i++) l0[i] = cov[i]! * lumOf(i);
  const c0 = Float32Array.from(cov);
  blur3(l0, S, R);
  blur3(c0, S, R);
  const skinW = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (cov[i] === 0 || c0[i]! < 1e-3) continue;
    const d = Math.abs(Math.log(Math.max(1e-5, lumOf(i)) / Math.max(1e-5, l0[i]! / c0[i]!)));
    skinW[i] = 1 - smooth01(0.25, 0.6, d);
  }
  // The light is a smooth field over the face: per channel, a quadratic in (u, v) fitted to the log of the skin's
  // colour (weighted least squares over the skin only). Unlike a local blur it does not take a beard, a blush or a
  // cluster of freckles for light, so it does not bleach them; it does flatten a side light and a coloured cast.
  const basis = (x: number, y: number): number[] => [1, x, y, x * x, x * y, y * y];
  const fits = [0, 1, 2].map((ch) => {
    const A = Array.from({ length: 6 }, () => new Float64Array(6));
    const b = new Float64Array(6);
    for (let y = 0; y < S; y += 2) {
      for (let x = 0; x < S; x += 2) {
        const i = y * S + x;
        const w = skinW[i]! * alpha[i]!;
        if (w <= 0.05) continue;
        const v = Math.log(Math.max(1e-4, lin[3 * i + ch]!));
        const f = basis(x / S - 0.5, y / S - 0.5);
        for (let r = 0; r < 6; r++) {
          b[r] = b[r]! + w * f[r]! * v;
          for (let c = 0; c < 6; c++) A[r]![c] = A[r]![c]! + w * f[r]! * f[c]!;
        }
      }
    }
    return solve6(A, b);
  });
  const field = (ch: number, x: number, y: number): number => {
    const f = basis(x / S - 0.5, y / S - 0.5);
    const k = fits[ch]!;
    let v = 0;
    for (let r = 0; r < 6; r++) v += k[r]! * f[r]!;
    return v;
  };
  // The reference is the field's value in the middle of the face (between the eyes and the mouth).
  const ref = [0, 1, 2].map((ch) => field(ch, S / 2, S * 0.5));
  const gains: number[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (cov[i] === 0) continue;
      let gl = 0;
      for (let ch = 0; ch < 3; ch++) {
        const g = Math.min(1.8, Math.max(0.55, Math.exp((ref[ch]! - field(ch, x, y)) * delight)));
        lin[3 * i + ch] = lin[3 * i + ch]! * g;
        gl += g / 3;
      }
      if (alpha[i]! > 0.9) gains.push(gl);
    }
  }

  // 3b. The edge of the face keeps only what looks like skin: hair over the forehead, a hat, a background
  // between the cheek and the ear fade out there instead of being painted on the head. The inner face
  // (eyes, brows, lips) is not touched.
  const deep = Float32Array.from(cov);
  blur3(deep, S, Math.max(2, Math.round(S / 22)));
  const lums2: number[] = [];
  for (let i = 0; i < N; i++) if (alpha[i]! > 0.95) lums2.push(lumOf(i));
  const medLum = Math.max(1e-4, percentile(lums2, 0.5));
  const gate = new Float32Array(N).fill(1);
  for (let i = 0; i < N; i++) {
    if (cov[i] === 0) continue;
    const outer = 1 - smooth01(0.82, 0.985, deep[i]!);
    if (outer <= 0) continue;
    const d = Math.abs(Math.log(Math.max(1e-5, lumOf(i)) / medLum));
    gate[i] = 1 - outer * smooth01(0.22, 0.55, d);
  }
  // Softened well beyond a pixel: a hairline in a photo is a sharp edge, and a sharp step in the alpha reads as a cut.
  blur3(gate, S, Math.max(2, Math.round(S / 70)));
  for (let i = 0; i < N; i++) alpha[i] = alpha[i]! * Math.min(1, gate[i]!) ** 2;

  // 4. Skin match: per channel, the median of the inner face onto the target colour.
  const inner: [number[], number[], number[]] = [[], [], []];
  for (let i = 0; i < N; i++) {
    if (alpha[i]! < 0.95) continue;
    for (let ch = 0; ch < 3; ch++) inner[ch]!.push(lin[3 * i + ch]!);
  }
  const med = inner.map((v) => percentile(v, 0.5)) as [number, number, number];
  const medianHex = `#${med.map((v) => hex2(linearToSrgb(v))).join('')}`;
  const target = options.targetSkinHex ? hexToLinear(options.targetSkinHex) : null;
  const gain = target ? (med.map((m, ch) => Math.min(3, Math.max(0.33, target[ch]! / Math.max(1e-4, m)))) as [number, number, number]) : [1, 1, 1];
  const fill = target ?? med;

  const out = new Uint8ClampedArray(4 * N);
  let covered = 0;
  for (let i = 0; i < N; i++) {
    const a = alpha[i]!;
    if (a > 0) covered++;
    for (let ch = 0; ch < 3; ch++) {
      // Outside the face the colour is the skin, so filtering at the edge never pulls in black.
      const v = a > 0 ? lin[3 * i + ch]! * gain[ch]! : fill[ch]!;
      out[4 * i + ch] = Math.round(linearToSrgb(v) * 255);
    }
    out[4 * i + 3] = Math.round(a * 255);
  }
  const pose = headPose(landmarks, W, H, topo);
  return {
    size: S,
    rgba: out,
    stats: {
      coverage: covered / N,
      yawDeg: pose.yawDeg,
      rollDeg: pose.rollDeg,
      medianHex,
      delightGain: [percentile(gains, 0.05), percentile(gains, 0.95)],
      facePx: pose.facePx,
    },
  };
}

/**
 * The face texture matched to another skin colour (the shopper picked another swatch after the
 * bake): each channel scaled in linear light by `to / from`, where `from` is the colour it was
 * matched to. The photo is not needed again (it is not kept). Returns a new array.
 */
export function rematchFaceTexture(rgba: Uint8ClampedArray, fromHex: string, toHex: string): Uint8ClampedArray {
  const from = hexToLinear(fromHex), to = hexToLinear(toHex);
  const out = new Uint8ClampedArray(rgba);
  if (!from || !to) return out;
  const lut = [0, 1, 2].map((ch) => {
    const g = to[ch]! / Math.max(1e-4, from[ch]!);
    const t = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) t[i] = Math.round(linearToSrgb(srgbToLinear(i / 255) * g) * 255);
    return t;
  });
  for (let i = 0; i < out.length; i += 4) {
    out[i] = lut[0]![out[i]!]!;
    out[i + 1] = lut[1]![out[i + 1]!]!;
    out[i + 2] = lut[2]![out[i + 2]!]!;
  }
  return out;
}
