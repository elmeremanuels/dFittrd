/**
 * Procedural skin for the realistic body spike (`MountOptions.realisticSkin`, opt-in with `bodyShape:
 * 'realistic-spike'`, off by default). Everything is made in code here: no texture from MakeHuman or anywhere else,
 * no download. The only shopper input is the skin-tone colour value (D20); every per-tone setting below is derived
 * from it. Display only, like the skin colour: nothing here is measured, sent or stored.
 *
 * What it adds to the plain three.js physical material (`realisticSkinMaterial`):
 * 1. **Wrap lighting** per colour channel (`care.wrap`): light reaches a little past the shadow edge, red furthest,
 *    the cheap stand-in for light scattered under the skin. Less red on deep tones (melanin takes the red glow).
 * 2. **Translucency at thin parts** (ears, fingers, a little at the nose): light from behind shows through, from the
 *    direct lights (a view-dependent back lobe) and from the environment behind the surface (`care.trans`).
 * 3. **Pores and fine creases**: a 128 × 128 tiling texture generated in code (`skinDetailPixels`, deterministic),
 *    holding a height gradient (pores and a cross-hatch of fine lines), a roughness variation and a soft mottle. The
 *    body has no UVs, so it is projected from three sides (triplanar) in the body's own space; mipmaps fade the
 *    detail out where a texel is smaller than a pixel, so the full-body view keeps a calm surface.
 * 4. **Redness** (`care.flush`): cheeks, nose, ears, elbows, knees and knuckles, found on the asset's rest mesh by
 *    landmarks (`skinMaskOf`), shift towards red by a step in CIE a* computed from the tone (smaller on deep tones,
 *    where the same step reads stronger), plus a faint mottle.
 * 5. **A slight sheen** tinted by the skin, a tighter and slightly weaker white reflection on deep tones (a broad
 *    white one greyed Monk 8 to 10 in the skin-v2 review).
 * 6. **Eyes**: MakeHuman's two eye spheres are part of the mesh; they are drawn as a plain off-white with a dark iris
 *    (stylised, D27), not in the skin colour.
 */
import * as THREE from 'three';
import type { RealisticBodyAsset } from './realisticBody';

// --- Colour helpers ---------------------------------------------------------------------------

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
type RGB = [number, number, number];

/** `#rrggbb` → linear RGB. */
export function linearRgbOf(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255)) as RGB;
}
/** Linear RGB → `#rrggbb`. */
export function hexOfLinearRgb(c: readonly number[]): string {
  return `#${c.slice(0, 3).map((v) => Math.round(clamp01(linearToSrgb(v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const WHITE = [0.95047, 1, 1.08883] as const;
const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fi = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
/** Linear sRGB → CIE L*a*b* (D65). */
export function labOfLinear(c: readonly number[]): RGB {
  const [r, g, b] = c as RGB;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE[0];
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / WHITE[1];
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE[2];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIE L*a*b* (D65) → linear sRGB (not clamped). */
export function linearOfLab(lab: readonly number[]): RGB {
  const fy = (lab[0]! + 16) / 116;
  const x = fi(fy + lab[1]! / 500) * WHITE[0];
  const y = fi(fy) * WHITE[1];
  const z = fi(fy - lab[2]! / 200) * WHITE[2];
  return [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
}

// --- Per-tone settings ------------------------------------------------------------------------

/** The grey of the mannequin when no tone is chosen (scene.ts `DEFAULT_BODY_HEX`; not imported, so this file stays out of the viewer chunk's graph). */
export const REALISTIC_SKIN_GREY = '#8c8c8c';

/** Everything the material takes from one skin colour. */
export interface RealisticSkinCare {
  /** The colour drawn, `#rrggbb` (the shopper's tone, or the mannequin grey). */
  hex: string;
  /** Whether a tone was given (false: the grey mannequin; no redness, neutral wrap). */
  toned: boolean;
  /** CIE L* of the colour. */
  lightness: number;
  /** 0 (light and medium tones) to 1 (Monk 8 to 10). */
  deep: number;
  /** Albedo multiplier at full redness (linear RGB): the tone shifted in a* and L*, divided by the tone. */
  flush: RGB;
  /** The a* step behind `flush` (CIE units), for the report and the tests. */
  flushDeltaA: number;
  /** Wrap per channel (0: Lambert): how far past the shadow edge each channel still gets light. */
  wrap: RGB;
  /** Colour of the light let through at thin parts (linear RGB, before the light's colour). */
  trans: RGB;
  roughness: number;
  specularIntensity: number;
  sheen: number;
  sheenRoughness: number;
  /** Sheen colour, linear RGB. */
  sheenColour: RGB;
  /** Strength of the pore and crease normal detail. */
  bump: number;
}

/**
 * The per-tone settings for `#rrggbb` (null or anything else: the grey mannequin, without redness). Pure. The numbers
 * were chosen by looking at the pictures (docs/reports/claude/realistic-body-skin.md), not measured on skin.
 */
export function realisticSkinCare(hex: string | null | undefined): RealisticSkinCare {
  const toned = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex);
  const colour = toned ? hex.toLowerCase() : REALISTIC_SKIN_GREY;
  const lin = linearRgbOf(colour);
  const lab = labOfLinear(lin);
  const L = lab[0];
  const deep = smoothstep(55, 25, L);
  // Redness: a step in a* (and a little darker, a little yellower), smaller on deep tones where it reads stronger.
  const flushDeltaA = toned ? 9 - 4 * deep : 0;
  const flushed = linearOfLab([L - (toned ? 2.5 - 1.2 * deep : 0), lab[1] + flushDeltaA, lab[2] + (toned ? 1.5 : 0)]);
  const flush = toned ? ([0, 1, 2].map((c) => Math.min(1.6, Math.max(0.5, Math.max(1e-4, flushed[c]!) / Math.max(1e-4, lin[c]!)))) as RGB) : ([1, 1, 1] as RGB);
  // Wrap: red reaches furthest under the skin. On deep tones melanin absorbs more of it: less red, a little less wrap.
  const wrap: RGB = toned ? [0.42 - 0.1 * deep, 0.2 - 0.03 * deep, 0.14 - 0.02 * deep] : [0.18, 0.18, 0.18];
  // Thin parts let through a warm red. Taken as the square root of the tone (so a deep tone still glows a little at the
  // ear rim, as it does), tinted towards red, a fifth less on the deepest tones.
  const root = lin.map(Math.sqrt) as RGB;
  const trans: RGB = toned ? [root[0] * 0.55, root[1] * 0.2, root[2] * 0.11].map((v) => v * (1 - 0.2 * deep)) as RGB : [0.12, 0.12, 0.12];
  // The sheen takes the skin's own colour, more of it on deep tones (a white sheen is the ashy veil).
  const sheenColour = lin.map((v) => v + (1 - v) * (0.45 - 0.3 * deep)) as RGB;
  return {
    hex: colour,
    toned,
    lightness: L,
    deep,
    flush,
    flushDeltaA,
    wrap,
    trans,
    roughness: 0.52 - 0.08 * deep,
    specularIntensity: 0.5 - 0.26 * deep,
    sheen: 0.22 - 0.14 * deep,
    sheenRoughness: 0.5,
    sheenColour,
    bump: 0.35,
  };
}

// --- The detail texture -----------------------------------------------------------------------

/** The generated detail tile: pixels per side, and how much skin one tile covers (cm). */
export const SKIN_DETAIL = {
  size: 128,
  /** One tile of pores and creases per this many cm (pores about 0.8 mm across: exaggerated about three times, as the body is seen small). */
  tileCm: 2.5,
  /** The soft mottle (channel B) is read at this tile size, cm. */
  coarseTileCm: 14,
  seed: 0x5eed5c1,
} as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise on a periodic lattice of `cells` per tile, at (u, v) in [0, 1). */
function periodicNoise(cells: number, rand: () => number): (u: number, v: number) => number {
  const lattice = Float32Array.from({ length: cells * cells }, () => rand());
  const at = (i: number, j: number): number => lattice[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)]!;
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/**
 * The detail tile, RGBA8, `size × size`, tiling seamlessly (deterministic for a seed):
 * - R, G: the height field's gradient (x, y), 128 = flat; the height is pores (small round dips at jittered points,
 *   16 × 16 per tile), a cross-hatch of fine broken lines in three directions, and a little fine noise;
 * - B: a soft mottle (two octaves of value noise), read at the coarse tile size for albedo and roughness;
 * - A: roughness variation, 128 = none (pores and lines a little rougher).
 */
export function skinDetailPixels(size: number = SKIN_DETAIL.size, seed: number = SKIN_DETAIL.seed): Uint8Array {
  const rand = mulberry32(seed);
  const cells = 16;
  const points = Float32Array.from({ length: cells * cells * 3 }, () => rand());
  const wobble = periodicNoise(8, rand);
  const breakUp = periodicNoise(6, rand);
  const fine = periodicNoise(32, rand);
  const mottleA = periodicNoise(4, rand);
  const mottleB = periodicNoise(8, rand);
  // Integer wave vectors (lines per tile), so the lines tile.
  const lines: { k: [number, number]; w: number }[] = [
    { k: [7, 3], w: 0.55 },
    { k: [-2, 8], w: 0.45 },
    { k: [5, -6], w: 0.35 },
  ];
  const h = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      // Pores: nearest jittered point (periodic).
      const cu = u * cells, cv = v * cells;
      const ci = Math.floor(cu), cj = Math.floor(cv);
      let pore = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj;
          const k = 3 * ((((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells));
          const px = i + 0.15 + 0.7 * points[k]!, py = j + 0.15 + 0.7 * points[k + 1]!;
          const d2 = (cu - px) ** 2 + (cv - py) ** 2;
          pore = Math.max(pore, (0.55 + 0.45 * points[k + 2]!) * Math.exp(-d2 / (2 * 0.11 * 0.11)));
        }
      }
      let crease = 0;
      for (const { k, w } of lines) {
        const phase = 2 * Math.PI * (k[0] * u + k[1] * v) + 2.2 * wobble(u, v);
        const s = Math.sin(phase / 2);
        crease += w * Math.exp(-(s * s) / 0.012) * smoothstep(0.35, 0.65, breakUp(u + 0.31 * k[0] / 7, v));
      }
      const i = y * size + x;
      h[i] = -0.9 * pore - 0.5 * crease + 0.12 * (fine(u, v) - 0.5);
      rough[i] = 0.5 * pore + 0.3 * crease;
    }
  }
  // Gradient (periodic central differences), scaled to fill the byte range.
  const gx = new Float32Array(size * size), gy = new Float32Array(size * size);
  let gmax = 1e-6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      gx[i] = (h[y * size + ((x + 1) % size)]! - h[y * size + ((x + size - 1) % size)]!) / 2;
      gy[i] = (h[((y + 1) % size) * size + x]! - h[((y + size - 1) % size) * size + x]!) / 2;
      gmax = Math.max(gmax, Math.abs(gx[i]!), Math.abs(gy[i]!));
    }
  }
  const out = new Uint8Array(size * size * 4);
  const byte = (t: number): number => Math.round(clamp01(t) * 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      out[4 * i] = byte(0.5 + 0.5 * (gx[i]! / gmax));
      out[4 * i + 1] = byte(0.5 + 0.5 * (gy[i]! / gmax));
      out[4 * i + 2] = byte(0.65 * mottleA(u, v) + 0.35 * mottleB(u, v));
      out[4 * i + 3] = byte(0.5 + 0.5 * Math.min(1, rough[i]!));
    }
  }
  return out;
}

let detailTexture: THREE.DataTexture | null = null;
/** The detail tile as a texture with mipmaps, built once per page. */
export function skinDetailTexture(): THREE.DataTexture {
  if (detailTexture) return detailTexture;
  const size = SKIN_DETAIL.size;
  const t = new THREE.DataTexture(skinDetailPixels(), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  detailTexture = t;
  return t;
}

// --- Where on the body: the per-vertex mask -------------------------------------------------

type V3 = [number, number, number];

/** Vertex normals of an indexed mesh (area-weighted). */
function vertexNormals(P: ArrayLike<number>, idx: ArrayLike<number>, n: number): Float32Array {
  const N = new Float32Array(3 * n);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!;
    const vx = P[3 * c]! - P[3 * a]!, vy = P[3 * c + 1]! - P[3 * a + 1]!, vz = P[3 * c + 2]! - P[3 * a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      N[3 * i] = N[3 * i]! + nx;
      N[3 * i + 1] = N[3 * i + 1]! + ny;
      N[3 * i + 2] = N[3 * i + 2]! + nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[3 * i]!, N[3 * i + 1]!, N[3 * i + 2]!) || 1;
    for (let c = 0; c < 3; c++) N[3 * i + c] = N[3 * i + c]! / l;
  }
  return N;
}

/** The landmarks `skinMaskOf` places on the asset's rest mesh (cm, the asset's space; left side, the right is the mirror). */
export interface SkinLandmarks {
  eye: V3;
  cheek: V3;
  noseTip: V3;
  ear: V3;
  /** Distance along the arm axis (from the shoulder joint) of the elbow, the wrist, the knuckles and the fingertips. */
  arm: { elbow: number; wrist: number; knuckle: number; tip: number };
  knee: V3;
}

/** Channels of the mask (`skinMask` attribute, 4 per vertex). */
export const SKIN_MASK = { redness: 0, thin: 1, eye: 2, iris: 3 } as const;

/**
 * Per vertex of the realistic body (rest mesh of the asset; the fit keeps the vertex order, so the mask holds for
 * every fitted and conformed mesh of it): redness (0..1: cheeks, nose, ears, elbows, knees, knuckles and fingertips),
 * thinness (0..1: ears, fingers, a little at the nose), eye (1 on the two eye spheres) and iris (0..1, the front of
 * each eye sphere). Landmarks from the bake's own levels and arm line, the eye spheres and the head's extent.
 */
export function skinMaskOf(asset: Pick<RealisticBodyAsset, 'meta' | 'positions' | 'indices' | 'armWeight' | 'headWeight'>): { mask: Float32Array; landmarks: SkinLandmarks } {
  const { meta, positions: P, indices, armWeight, headWeight } = asset;
  const n = meta.vertexCount;
  const nb = meta.bodyVertexCount;
  const N = vertexNormals(P, indices, n);
  const mask = new Float32Array(4 * n);
  // Eyes: the two spheres after the body's vertices (72 each); the left one has x > 0.
  const eyeCount = (n - nb) / 2;
  const eyeCentre = (from: number): V3 => {
    const c: V3 = [0, 0, 0];
    for (let i = from; i < from + eyeCount; i++) for (let k = 0; k < 3; k++) c[k] = c[k]! + P[3 * i + k]! / eyeCount;
    return c;
  };
  const eyes = [eyeCentre(nb), eyeCentre(nb + eyeCount)];
  const eye = eyes[0]![0] > 0 ? eyes[0]! : eyes[1]!;
  // Head extent and the nose tip.
  let headHalf = 0, nose: V3 = [0, 0, -Infinity];
  for (let i = 0; i < nb; i++) {
    if (headWeight[i]! < 0.5) continue;
    headHalf = Math.max(headHalf, Math.abs(P[3 * i]!));
    if (P[3 * i + 2]! > nose[2]) nose = [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!];
  }
  const cheek: V3 = [eye[0] + 0.9, eye[1] - 2.8, eye[2] + 0.2];
  const ear: V3 = [headHalf - 0.9, eye[1] - 2.1, eye[2] - 7.4];
  // The arm line of the bake (left arm).
  const j = meta.arm.joint, w = meta.arm.wrist;
  const ax: V3 = [w[0] - j[0], w[1] - j[1], w[2] - j[2]];
  const wrist = Math.hypot(...ax);
  const axis = ax.map((v) => v / wrist) as V3;
  const along = (i: number): number => {
    const sx = Math.abs(P[3 * i]!);
    return (sx - j[0]) * axis[0] + (P[3 * i + 1]! - j[1]) * axis[1] + (P[3 * i + 2]! - j[2]) * axis[2];
  };
  let tip = wrist;
  for (let i = 0; i < nb; i++) if (armWeight[i]! > 0.5) tip = Math.max(tip, along(i));
  const hand = tip - wrist;
  const knuckle = wrist + 0.55 * hand;
  const elbow = 0.56 * wrist;
  // Knee: the front of the left leg at the knee level.
  let knee: V3 = [0, meta.levels.knee, -Infinity];
  for (let i = 0; i < nb; i++) if (P[3 * i]! > 0 && Math.abs(P[3 * i + 1]! - meta.levels.knee) < 1.5 && armWeight[i]! < 0.1 && P[3 * i + 2]! > knee[2]) knee = [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!];
  const knees: V3 = [knee[0], knee[1] + 1, knee[2] - 1.5];
  const near = (i: number, c: V3, r: number): number => {
    const d = Math.hypot(Math.abs(P[3 * i]!) - c[0], P[3 * i + 1]! - c[1], P[3 * i + 2]! - c[2]);
    return 1 - smoothstep(0.3 * r, r, d);
  };
  for (let i = 0; i < nb; i++) {
    const nx = N[3 * i]!, nz = N[3 * i + 2]!;
    const lat = Math.sign(P[3 * i]!) * nx; // the normal's share pointing away from the midline
    let red = 0, thin = 0;
    if (headWeight[i]! > 0.5) {
      red = Math.max(red, 0.6 * near(i, cheek, 3.4) * smoothstep(0.0, 0.4, nz));
      red = Math.max(red, 0.45 * near(i, nose, 1.8));
      const e = near(i, ear, 3.4) * smoothstep(headHalf - 2.2, headHalf - 1.0, Math.abs(P[3 * i]!));
      red = Math.max(red, 0.3 * e);
      thin = Math.max(thin, e, 0.35 * near(i, nose, 1.2));
    }
    const arm = armWeight[i]!;
    if (arm > 0.3) {
      const s = along(i);
      // Elbow: the back of the arm round the elbow.
      red = Math.max(red, 0.5 * arm * (1 - smoothstep(1.5, 5, Math.abs(s - elbow))) * smoothstep(0.1, 0.6, -nz));
      if (s > wrist) {
        // The hand a little redder all over; knuckles and fingertips more; fingers thin.
        const knuck = 1 - smoothstep(0.03, 0.1, Math.abs(s - knuckle) / hand);
        red = Math.max(red, arm * Math.max(0.15 * smoothstep(wrist, wrist + 0.2 * hand, s), 0.55 * knuck * smoothstep(-0.2, 0.4, lat), 0.35 * smoothstep(tip - 0.12 * hand, tip, s)));
        thin = Math.max(thin, arm * Math.max(0.25 * smoothstep(wrist + 0.2 * hand, knuckle, s), smoothstep(knuckle - 0.05 * hand, knuckle + 0.15 * hand, s)));
      }
    }
    if (arm < 0.3 && headWeight[i]! < 0.5) red = Math.max(red, 0.45 * near(i, knees, 6.5) * smoothstep(0.1, 0.6, nz));
    mask[4 * i + SKIN_MASK.redness] = clamp01(red);
    mask[4 * i + SKIN_MASK.thin] = clamp01(thin);
  }
  for (let i = nb; i < n; i++) {
    const c = P[3 * i]! > 0 === eyes[0]![0] > 0 ? eyes[0]! : eyes[1]!;
    const d: V3 = [P[3 * i]! - c[0], P[3 * i + 1]! - c[1], P[3 * i + 2]! - c[2]];
    const l = Math.hypot(...d) || 1;
    mask[4 * i + SKIN_MASK.eye] = 1;
    mask[4 * i + SKIN_MASK.iris] = smoothstep(0.75, 0.95, d[2] / l);
  }
  return { mask, landmarks: { eye, cheek, noseTip: nose, ear, arm: { elbow, wrist, knuckle, tip }, knee: knees } };
}

// --- The shader patch -------------------------------------------------------------------------

/** Lines of three r186's chunks the patch hooks into; `realisticSkinChunksPresent` checks they are still there. */
export const REALISTIC_SKIN_HOOKS = {
  diffuse: 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
  sheenComp: 'irradiance *= sheenEnergyComp;',
  pars: '#include <lights_physical_pars_fragment>',
  colour: '#include <color_fragment>',
  roughness: '#include <roughnessmap_fragment>',
  normal: '#include <normal_fragment_maps>',
  lightsEnd: '#include <lights_fragment_end>',
  vertexCommon: '#include <common>',
  vertexNormal: '#include <defaultnormal_vertex>',
  vertexBegin: '#include <begin_vertex>',
} as const;

/** True when the chunks of the three.js in use still have the lines `realisticSkinMaterial` hooks into. */
export function realisticSkinChunksPresent(): boolean {
  const pars = THREE.ShaderChunk.lights_physical_pars_fragment;
  const frag = THREE.ShaderLib.physical.fragmentShader;
  const vert = THREE.ShaderLib.physical.vertexShader;
  const H = REALISTIC_SKIN_HOOKS;
  return pars.includes(H.diffuse) && pars.includes(H.sheenComp) && [H.pars, H.colour, H.roughness, H.normal, H.lightsEnd].every((h) => frag.includes(h)) && [H.vertexCommon, H.vertexNormal, H.vertexBegin].every((h) => vert.includes(h)) && THREE.ShaderChunk.envmap_physical_pars_fragment.includes('vec3 getIBLIrradiance( const in vec3 normal )');
}

const PARS = `
uniform sampler2D skinDetail;
uniform float skinTile;
uniform float skinCoarseTile;
uniform float skinBump;
uniform vec3 skinFlush;
uniform vec3 skinWrap;
uniform vec3 skinTrans;
uniform float skinTransEnv;
uniform vec3 skinSclera;
uniform vec3 skinIris;
uniform mat3 normalMatrix;
varying vec4 vSkinMask;
varying vec3 vSkinPos;
varying vec3 vSkinObjNormal;
float skinSheenComp = 1.0;
float skinRoughK = 1.0;
vec3 skinDetailN = vec3( 0.0 );
vec3 skinTriplanarWeights( vec3 n ) {
	vec3 w = pow( abs( n ), vec3( 4.0 ) );
	return w / max( w.x + w.y + w.z, 1e-4 );
}
`;

const COLOUR = `
{
	vec3 sn = normalize( vSkinObjNormal );
	vec3 sw = skinTriplanarWeights( sn );
	vec3 p = vSkinPos * skinTile;
	vec4 tx = texture2D( skinDetail, p.yz );
	vec4 ty = texture2D( skinDetail, p.zx );
	vec4 tz = texture2D( skinDetail, p.xy );
	vec3 pc = vSkinPos * skinCoarseTile;
	float mottle = sw.x * texture2D( skinDetail, pc.yz ).b + sw.y * texture2D( skinDetail, pc.zx ).b + sw.z * texture2D( skinDetail, pc.xy ).b;
	vec2 gx = tx.rg * 2.0 - 1.0;
	vec2 gy = ty.rg * 2.0 - 1.0;
	vec2 gz = tz.rg * 2.0 - 1.0;
	// The height's gradient on each projection plane, back onto the body's axes: the normal leans against it.
	skinDetailN = - skinBump * ( sw.x * vec3( 0.0, gx.x, gx.y ) + sw.y * vec3( gy.y, 0.0, gy.x ) + sw.z * vec3( gz.x, gz.y, 0.0 ) );
	float rough = sw.x * tx.a + sw.y * ty.a + sw.z * tz.a;
	skinRoughK = ( 0.9 + 0.35 * ( rough - 0.5 ) ) * ( 1.0 + 0.12 * ( mottle - 0.5 ) );
	float red = clamp( vSkinMask.x + 0.35 * ( mottle - 0.5 ), 0.0, 1.0 );
	diffuseColor.rgb *= mix( vec3( 1.0 ), skinFlush, red ) * ( 1.0 + 0.08 * ( mottle - 0.5 ) );
	if ( vSkinMask.z > 0.5 ) {
		diffuseColor.rgb = mix( skinSclera, skinIris, vSkinMask.w );
		skinDetailN = vec3( 0.0 );
		skinRoughK = 0.0;
	}
}
`;

const ROUGHNESS = `
	roughnessFactor = vSkinMask.z > 0.5 ? 0.2 : clamp( roughnessFactor * skinRoughK, 0.08, 1.0 );
`;

const NORMAL = `
	normal = normalize( normal + normalMatrix * skinDetailN );
`;

const DIRECT = `
	vec3 skinNL = vec3( dot( geometryNormal, directLight.direction ) );
	vec3 skinIrr = clamp( ( skinNL + skinWrap ) / ( 1.0 + skinWrap ), 0.0, 1.0 ) * directLight.color * skinSheenComp;
	reflectedLight.directDiffuse += skinIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
	// Thin parts: light from behind shows through (a back lobe round the light's direction, bent by the normal).
	vec3 skinLt = directLight.direction + geometryNormal * 0.4;
	float skinBack = pow( saturate( dot( geometryViewDir, - skinLt ) ), 3.0 ) + 0.1 * saturate( - skinNL.x );
	reflectedLight.directDiffuse += vSkinMask.y * skinBack * skinTrans * directLight.color * RECIPROCAL_PI;
`;

const INDIRECT = `
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
	if ( vSkinMask.y > 0.01 ) reflectedLight.indirectDiffuse += vSkinMask.y * skinTransEnv * skinTrans * getIBLIrradiance( - geometryNormal ) * RECIPROCAL_PI;
#endif
`;

export interface RealisticSkinUniforms {
  skinDetail: { value: THREE.Texture };
  skinTile: { value: number };
  skinCoarseTile: { value: number };
  skinBump: { value: number };
  skinFlush: { value: THREE.Vector3 };
  skinWrap: { value: THREE.Vector3 };
  skinTrans: { value: THREE.Vector3 };
  skinTransEnv: { value: number };
  skinSclera: { value: THREE.Color };
  skinIris: { value: THREE.Color };
}

/** Sclera and iris, `#rrggbb` (stylised eyes, D27). */
export const EYE_HEX = { sclera: '#d8d1c7', iris: '#3a2a20' } as const;

/** The skin material of the realistic body and the call that changes its tone (no shader rebuild). */
export interface RealisticSkin {
  material: THREE.MeshPhysicalMaterial;
  uniforms: RealisticSkinUniforms;
  /** The settings in use now. */
  care: RealisticSkinCare;
  setSkin(hex: string | null): void;
  dispose(): void;
}

/**
 * A physical material patched into the realistic skin for `hex` (null: the grey mannequin, without redness). The
 * geometry should carry `skinMask` (`skinMaskOf`; without it the body is all plain skin, no redness, no thin parts).
 * Throws when the three.js chunks changed (a test pins them).
 */
export function realisticSkinMaterial(hex: string | null): RealisticSkin {
  if (!realisticSkinChunksPresent()) throw new Error('realistic skin: the three.js shader chunks changed');
  const material = new THREE.MeshPhysicalMaterial({ metalness: 0 });
  const uniforms: RealisticSkinUniforms = {
    skinDetail: { value: skinDetailTexture() },
    skinTile: { value: 1 / SKIN_DETAIL.tileCm },
    skinCoarseTile: { value: 1 / SKIN_DETAIL.coarseTileCm },
    skinBump: { value: 0.35 },
    skinFlush: { value: new THREE.Vector3(1, 1, 1) },
    skinWrap: { value: new THREE.Vector3() },
    skinTrans: { value: new THREE.Vector3() },
    skinTransEnv: { value: 0.4 },
    skinSclera: { value: new THREE.Color(EYE_HEX.sclera) },
    skinIris: { value: new THREE.Color(EYE_HEX.iris) },
  };
  const H = REALISTIC_SKIN_HOOKS;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const pars = THREE.ShaderChunk.lights_physical_pars_fragment.replace(H.sheenComp, `${H.sheenComp}\n\t\tskinSheenComp = sheenEnergyComp;`).replace(H.diffuse, DIRECT);
    shader.fragmentShader = shader.fragmentShader
      .replace(H.pars, `${PARS}\n${pars}`)
      .replace(H.colour, `${H.colour}\n${COLOUR}`)
      .replace(H.roughness, `${H.roughness}\n${ROUGHNESS}`)
      .replace(H.normal, `${H.normal}\n${NORMAL}`)
      .replace(H.lightsEnd, `${H.lightsEnd}\n${INDIRECT}`);
    shader.vertexShader = shader.vertexShader
      .replace(H.vertexCommon, `${H.vertexCommon}\nattribute vec4 skinMask;\nvarying vec4 vSkinMask;\nvarying vec3 vSkinPos;\nvarying vec3 vSkinObjNormal;`)
      .replace(H.vertexNormal, `${H.vertexNormal}\n\tvSkinObjNormal = objectNormal;`)
      .replace(H.vertexBegin, `${H.vertexBegin}\n\tvSkinPos = transformed;\n\tvSkinMask = skinMask;`);
  };
  material.customProgramCacheKey = () => 'realistic-skin-v1';
  const skin: RealisticSkin = {
    material,
    uniforms,
    care: realisticSkinCare(hex),
    setSkin(next) {
      const care = realisticSkinCare(next);
      skin.care = care;
      material.color.set(care.hex);
      material.roughness = care.roughness;
      material.specularIntensity = care.specularIntensity;
      material.sheen = care.sheen;
      material.sheenRoughness = care.sheenRoughness;
      material.sheenColor.setRGB(...care.sheenColour, THREE.LinearSRGBColorSpace);
      uniforms.skinFlush.value.set(...care.flush);
      uniforms.skinWrap.value.set(...care.wrap);
      uniforms.skinTrans.value.set(...care.trans);
      uniforms.skinBump.value = care.bump;
    },
    dispose() {
      material.dispose();
    },
  };
  skin.setSkin(hex);
  material.needsUpdate = true;
  return skin;
}
