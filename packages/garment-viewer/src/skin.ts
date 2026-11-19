/**
 * Skin shading `skin-v2` (D22 point 3: skin tones must look better than flat shading). Opt-in per
 * mount (`look.shading: 'skin-v2'`); without it the figure keeps the material of before, byte for
 * byte. Only the body's own material changes: the garment, floor, backdrop and outline keep theirs,
 * so garment pixels are the same with and without it (measured, docs/reports/claude-skin-v2.md).
 *
 * What it adds to the plain three.js physical material:
 * 1. **Pre-integrated diffuse** (Penner 2011): the light that reaches the skin is spread by a
 *    diffusion profile (d'Eon and Luebke's six Gaussians for skin, mm²), integrated once in code
 *    over a ring of the local radius into a small table (`skinLut`): cosine of the light angle ×
 *    curvature → RGB. Red travels furthest under the skin, so the shadow edge (the terminator) is
 *    softer and turns slightly red; on a curved part (nose, ear, fingers) more than on the torso.
 *    The curvature is read per pixel from the screen derivatives of the normal and the position.
 *    Each row is scaled so that a surface facing the light gets exactly what Lambert gives it: a
 *    patch that faces the light keeps its colour.
 * 2. **A soft sheen**: a smoother white reflection than the flat skin's (`roughness` 0.62 on light
 *    tones to 0.45 on deep ones, against 0.75) and a faint grazing sheen tinted by the skin. On deep
 *    tones the tighter highlight is what shows the form; a broad, strong one read as a grey veil.
 * 3. **Per-tone exposure care** (`skinToneCare`), in the material's own tone stage, which replaces
 *    the global one for the body only:
 *    - under `classic` (ACES), the lightness of ACES is kept for light and medium tones (so the
 *      contrast against the cream stays what it was), but the hue and chroma are the swatch's as
 *      shaded (ACES made Monk 1 to 4 grey), and on deep tones the lightness is moved to the
 *      true value (ACES made Monk 8 to 10 6 to 10 L* too dark, close to black);
 *    - under `neutral` and `neutral-v2`, highlights roll off keeping their hue (the global curve
 *      blends them to white: light skins washed out on the forehead and shoulders), from a lower
 *      knee on light tones;
 *    (An extra fill light on deep tones was tried and dropped: it lifted every pixel alike, 4 L* on
 *    Monk 10, and flattened the form instead of showing it.)
 * Display only, like the skin colour: nothing here is measured, sent or stored.
 */
import * as THREE from 'three';

export type SkinShading = 'flat' | 'skin-v2';

/** The shading a host asked for: `skin-v2` when asked by name, else `flat` (the material of before). */
export function skinShadingOf(value: unknown): SkinShading {
  return value === 'skin-v2' ? 'skin-v2' : 'flat';
}

/** The tone stage the body's skin-v2 material imitates: the rig's own (see `LightingRig.toneMapping`). */
export type SkinToneStage = 'aces' | 'true-tone';

// d'Eon & Luebke, "Advanced techniques for realistic real-time skin rendering" (GPU Gems 3, ch. 14): variances (mm²)
// and RGB weights of the sum of Gaussians fitted to the three-layer skin profile. Published numbers, no asset.
const PROFILE: readonly { v: number; w: readonly [number, number, number] }[] = [
  { v: 0.0064, w: [0.233, 0.455, 0.649] },
  { v: 0.0484, w: [0.1, 0.336, 0.344] },
  { v: 0.187, w: [0.118, 0.198, 0.0] },
  { v: 0.567, w: [0.113, 0.007, 0.007] },
  { v: 1.99, w: [0.358, 0.004, 0.0] },
  { v: 7.41, w: [0.078, 0.0, 0.0] },
];

/** Columns of the table (cosine of the light angle, -1 to 1) and rows (curvature, 0 to `SKIN_LUT_MAX_CURVATURE` per mm). */
export const SKIN_LUT_SIZE = { cos: 64, curvature: 32 } as const;
/** Largest curvature in the table, 1/mm (a radius of 2 mm); above it the last row is used. */
export const SKIN_LUT_MAX_CURVATURE = 0.5;
/**
 * Mesh curvature (1/cm, the mannequin's unit) × this = the curvature the table is read at (1/mm).
 * Real skin would be 0.1 (1 cm = 10 mm); 1.2 exaggerates the scattering twelvefold, because the
 * mannequin is seen at phone size, where a true-scale terminator is thinner than a pixel. A choice
 * made by looking at the pictures, not a measurement.
 */
export const SKIN_SCATTER_SCALE = 1.2;

/**
 * The pre-integrated diffuse table: `cos × curvature` texels, RGB, row-major from curvature 0.
 * Value = the light a ring of radius 1/curvature (mm) passes on at a point whose normal makes an
 * angle with the light whose cosine is the column's, normalised so the column cos = 1 is 1 in
 * every channel. Row 0 (flat) is Lambert, max(0, cos).
 */
export function skinLut(size: { cos: number; curvature: number } = SKIN_LUT_SIZE, maxCurvature = SKIN_LUT_MAX_CURVATURE): Float32Array {
  const out = new Float32Array(size.cos * size.curvature * 3);
  const steps = 256;
  const ring = (theta: number, radius: number): [number, number, number] => {
    const num = [0, 0, 0], den = [0, 0, 0];
    for (let s = 0; s < steps; s++) {
      const x = -Math.PI + ((s + 0.5) / steps) * 2 * Math.PI;
      const d = 2 * radius * Math.sin(Math.abs(x) / 2);
      const light = Math.max(0, Math.cos(theta + x));
      for (const g of PROFILE) {
        const p = Math.exp((-d * d) / (2 * g.v)) / (2 * Math.PI * g.v);
        for (let c = 0; c < 3; c++) {
          num[c]! += light * p * g.w[c]!;
          den[c]! += p * g.w[c]!;
        }
      }
    }
    return [0, 1, 2].map((c) => (den[c]! > 0 ? num[c]! / den[c]! : 0)) as [number, number, number];
  };
  for (let j = 0; j < size.curvature; j++) {
    const k = (j / (size.curvature - 1)) * maxCurvature;
    const front = k > 0 ? ring(0, 1 / k) : [1, 1, 1];
    for (let i = 0; i < size.cos; i++) {
      const cos = -1 + (2 * i) / (size.cos - 1);
      const v = k > 0 ? ring(Math.acos(cos), 1 / k) : [Math.max(0, cos), Math.max(0, cos), Math.max(0, cos)];
      for (let c = 0; c < 3; c++) out[3 * (j * size.cos + i) + c] = Math.min(1, v[c]! / front[c]!);
    }
  }
  return out;
}

let lutTexture: THREE.DataTexture | null = null;
/** The table as a half-float texture, built once per page on the first skin-v2 material. */
export function skinLutTexture(): THREE.DataTexture {
  if (lutTexture) return lutTexture;
  const rgb = skinLut();
  const { cos, curvature } = SKIN_LUT_SIZE;
  const data = new Uint16Array(cos * curvature * 4);
  for (let i = 0; i < cos * curvature; i++) {
    for (let c = 0; c < 3; c++) data[4 * i + c] = THREE.DataUtils.toHalfFloat(rgb[3 * i + c]!);
    data[4 * i + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const t = new THREE.DataTexture(data, cos, curvature, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  lutTexture = t;
  return t;
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
/** CIE L* of `#rrggbb` (D65). */
export function lightnessOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255)) as [number, number, number];
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** What skin-v2 does for one skin colour (see the file comment, point 3). */
export interface SkinToneCare {
  /** CIE L* of the swatch. */
  lightness: number;
  /** 0 (Monk 1 to 6) to 1 (Monk 8 to 10): how far the tone counts as deep. */
  deep: number;
  /** 0 to 1: how far the tone counts as light (Monk 1 to 4 about 1). */
  light: number;
  /** `classic`: share of the true lightness taken instead of ACES's (deep tones only). */
  lift: number;
  /** Where the hue-keeping highlight roll-off starts (linear, largest channel). */
  knee: number;
  roughness: number;
  specularIntensity: number;
  sheen: number;
  sheenRoughness: number;
}

/** The per-tone settings of skin-v2 for `#rrggbb`. Pure; the numbers were chosen from the pictures (report). */
export function skinToneCare(hex: string): SkinToneCare {
  const L = lightnessOf(hex);
  const deep = smoothstep(55, 25, L);
  const light = smoothstep(78, 90, L);
  // The roll-off starts just above the swatch's own largest channel (never below 0.9, never above 0.96): a patch that
  // faces the light keeps its colour, and only what is lit brighter than that is compressed, keeping its hue.
  const peak = Math.max(...linearOf(hex));
  return {
    lightness: L,
    deep,
    light,
    lift: deep,
    knee: Math.min(0.96, Math.max(0.9, peak + 0.02)),
    // A tighter highlight on deep tones: it shows the form where the light catches; a broad one was a grey veil
    // (Monk 10 came out #332f2d against #292420, an ashy look).
    roughness: 0.62 - 0.17 * deep,
    specularIntensity: 0.32,
    sheen: 0.04,
    sheenRoughness: 0.6,
  };
}

/** ACES fit as three's `ACESFilmicToneMapping` (exposure 1), on linear RGB, for the tests. */
export function acesFilmic(c: readonly [number, number, number]): [number, number, number] {
  const k = 1 / 0.6;
  const v = [c[0] * k, c[1] * k, c[2] * k];
  const inM = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
  const outM = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const a = inM.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
  const f = a.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return outM.map((r) => Math.min(1, Math.max(0, r[0]! * f[0]! + r[1]! * f[1]! + r[2]! * f[2]!))) as [number, number, number];
}

/** The hue-keeping roll-off of the skin's tone stage: below `knee` unchanged, above it all channels scaled alike towards 1. */
export function rollOff(c: readonly [number, number, number], knee: number): [number, number, number] {
  const peak = Math.max(c[0], c[1], c[2]);
  if (peak <= knee) return [c[0], c[1], c[2]];
  const d = 1 - knee;
  const newPeak = 1 - (d * d) / (peak + d - knee);
  return [c[0], c[1], c[2]].map((v) => (v * newPeak) / peak) as [number, number, number];
}

const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/**
 * The skin's tone stage on linear RGB `c` (what the lights give before tone mapping), as the shader
 * does it: `aces` → ACES lightness (moved to the true one by `lift`) with the true colour's
 * chromaticity; `true-tone` → the hue-keeping roll-off. `frontNorm` scales `c` so that a matt
 * surface facing the camera is its own colour (π / the rig's `frontIrradiance`, per channel).
 */
export function skinToneStage(c: readonly [number, number, number], stage: SkinToneStage, care: Pick<SkinToneCare, 'lift' | 'knee'>, frontNorm: readonly [number, number, number] = [1, 1, 1]): [number, number, number] {
  const t = rollOff([c[0] * frontNorm[0], c[1] * frontNorm[1], c[2] * frontNorm[2]], care.knee);
  if (stage === 'true-tone') return t;
  const y = lum(acesFilmic(c)) * (1 - care.lift) + lum(t) * care.lift;
  const yt = Math.max(1e-6, lum(t));
  return rollOff(t.map((v) => (v * y) / yt) as [number, number, number], 0.98);
}

/** `#rrggbb` → linear RGB (for the tests and the report). */
export function linearOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255)) as [number, number, number];
}
/** Linear RGB → `#rrggbb`. */
export function hexOfLinear(c: readonly number[]): string {
  return `#${c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// --- The shader patch -------------------------------------------------------------------------

/** Lines of three r186's chunks the patch replaces; `skinV2ChunksPresent` checks they are still there. */
export const SKIN_V2_HOOKS = {
  diffuse: 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
  sheenComp: 'irradiance *= sheenEnergyComp;',
  pars: '#include <lights_physical_pars_fragment>',
  begin: '#include <lights_fragment_begin>',
  tone: '#include <tonemapping_fragment>',
} as const;

/** True when the chunks of the three.js in use still have the lines `patchSkinV2` replaces. */
export function skinV2ChunksPresent(): boolean {
  const pars = THREE.ShaderChunk.lights_physical_pars_fragment;
  const frag = THREE.ShaderLib.physical.fragmentShader;
  return pars.includes(SKIN_V2_HOOKS.diffuse) && pars.includes(SKIN_V2_HOOKS.sheenComp) && [SKIN_V2_HOOKS.pars, SKIN_V2_HOOKS.begin, SKIN_V2_HOOKS.tone].every((h) => frag.includes(h));
}

const SKIN_PARS = `
uniform sampler2D skinLut;
uniform float skinScatterScale;
uniform float skinLift;
uniform float skinKnee;
uniform vec3 skinFrontNorm;
float skinCurvature = 0.0;
float skinSheenComp = 1.0;
vec3 skinDiffuse( float cosNL ) {
	float v = clamp( skinCurvature / ${SKIN_LUT_MAX_CURVATURE.toFixed(3)}, 0.0, 1.0 );
	vec2 uv = vec2( ( cosNL * 0.5 + 0.5 ) * ${((SKIN_LUT_SIZE.cos - 1) / SKIN_LUT_SIZE.cos).toFixed(6)} + ${(0.5 / SKIN_LUT_SIZE.cos).toFixed(6)}, v * ${((SKIN_LUT_SIZE.curvature - 1) / SKIN_LUT_SIZE.curvature).toFixed(6)} + ${(0.5 / SKIN_LUT_SIZE.curvature).toFixed(6)} );
	return texture2D( skinLut, uv ).rgb;
}
vec3 skinRollOff( vec3 c, float knee ) {
	float peak = max( c.r, max( c.g, c.b ) );
	if ( peak <= knee ) return c;
	float d = 1.0 - knee;
	float newPeak = 1.0 - d * d / ( peak + d - knee );
	return c * ( newPeak / peak );
}
float skinLum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
vec3 skinAces( vec3 color ) {
	const mat3 inM = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
	const mat3 outM = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
	vec3 v = inM * ( color / 0.6 );
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return clamp( outM * ( a / b ), 0.0, 1.0 );
}
vec3 skinToneStage( vec3 c ) {
	vec3 t = skinRollOff( c * skinFrontNorm, skinKnee );
#ifdef SKIN_TONE_ACES
	float y = mix( skinLum( skinAces( c ) ), skinLum( t ), skinLift );
	return skinRollOff( t * ( y / max( 1e-6, skinLum( t ) ) ), 0.98 );
#else
	return t;
#endif
}
`;

export interface SkinV2Uniforms {
  skinLut: { value: THREE.Texture };
  skinScatterScale: { value: number };
  skinLift: { value: number };
  skinKnee: { value: number };
  skinFrontNorm: { value: THREE.Vector3 };
}

/**
 * Make a physical material the skin-v2 material for `hex` under a tone stage. The material keeps
 * its colour, vertex colours and everything else; `onBeforeCompile` swaps the diffuse term, the
 * the specular and the tone stage. Returns the uniforms (changed by `updateSkinV2` when the colour changes,
 * without a shader rebuild). Throws when the chunks changed (a three.js upgrade): a test pins them.
 */
export function patchSkinV2(material: THREE.MeshPhysicalMaterial, hex: string, stage: SkinToneStage, frontNorm: readonly [number, number, number]): SkinV2Uniforms {
  if (!skinV2ChunksPresent()) throw new Error('skin-v2: the three.js shader chunks changed');
  const uniforms: SkinV2Uniforms = {
    skinLut: { value: skinLutTexture() },
    skinScatterScale: { value: SKIN_SCATTER_SCALE },
    skinLift: { value: 0 },
    skinKnee: { value: 0.9 },
    skinFrontNorm: { value: new THREE.Vector3(...frontNorm) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const pars = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace(SKIN_V2_HOOKS.sheenComp, `${SKIN_V2_HOOKS.sheenComp}\n\t\tskinSheenComp = sheenEnergyComp;`)
      .replace(SKIN_V2_HOOKS.diffuse, 'reflectedLight.directDiffuse += skinDiffuse( dot( geometryNormal, directLight.direction ) ) * directLight.color * skinSheenComp * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );');
    shader.fragmentShader = shader.fragmentShader
      .replace(SKIN_V2_HOOKS.pars, `${SKIN_PARS}\n${pars}`)
      .replace(SKIN_V2_HOOKS.begin, `skinCurvature = length( fwidth( normal ) ) / max( length( fwidth( vViewPosition ) ), 1e-4 ) * skinScatterScale;\n${SKIN_V2_HOOKS.begin}`)
      .replace(SKIN_V2_HOOKS.tone, `#if defined( TONE_MAPPING )\n\tgl_FragColor.rgb = skinToneStage( gl_FragColor.rgb );\n#endif`);
    if (stage === 'aces') shader.fragmentShader = `#define SKIN_TONE_ACES\n${shader.fragmentShader}`;
  };
  material.customProgramCacheKey = () => `skin-v2-${stage}`;
  updateSkinV2(material, uniforms, hex);
  material.needsUpdate = true;
  return uniforms;
}

/** Set the per-tone values of a skin-v2 material for a new colour (no shader rebuild). */
export function updateSkinV2(material: THREE.MeshPhysicalMaterial, uniforms: SkinV2Uniforms, hex: string): void {
  const care = skinToneCare(hex);
  uniforms.skinLift.value = care.lift;
  uniforms.skinKnee.value = care.knee;
  material.roughness = care.roughness;
  material.specularIntensity = care.specularIntensity;
  material.sheen = care.sheen;
  material.sheenRoughness = care.sheenRoughness;
  // The sheen takes half the skin's own colour: a white one greyed a deep tone.
  material.sheenColor.set(hex).lerp(new THREE.Color(1, 1, 1), 0.5);
}
