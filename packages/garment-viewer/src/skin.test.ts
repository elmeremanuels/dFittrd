/**
 * Skin shading `skin-v2` (D22 point 3): the pre-integrated table, the per-tone care, the tone
 * stage on the CPU (the shader's twin), the shader patch against three's chunks, and that the
 * figure's default material is the one of before. Pure logic (no WebGL): the pictures and the
 * measured colours are in `spikes/garment-engine/viewer/skin-v2-renders.mjs`.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_BODY_HEX, Figure, LIGHTING_RIGS, frontIrradiance, meshGeometry } from './scene';
import { HAIR_ROUGHNESS, HAIR_SPECULAR, SKIN_LUT_SIZE, SKIN_V2_HOOKS, acesFilmic, updateSkinV2, linearOf, patchSkinV2, rollOff, skinLut, skinShadingOf, skinToneCare, skinToneStage, skinV2ChunksPresent } from './skin';

const MONK = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420'];
const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const chroma = (c: readonly number[]): [number, number] => {
  const s = c[0]! + c[1]! + c[2]!;
  return [c[0]! / s, c[1]! / s];
};
const tri = (): THREE.BufferGeometry => meshGeometry({ positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) });

describe('skinShadingOf', () => {
  it('is skin-v2 only by name', () => {
    expect(skinShadingOf('skin-v2')).toBe('skin-v2');
    for (const v of [undefined, null, '', 'v2', 'Skin-v2', 'flat', 2]) expect(skinShadingOf(v)).toBe('flat');
  });
});

describe('the pre-integrated table', () => {
  const lut = skinLut();
  const { cos, curvature } = SKIN_LUT_SIZE;
  const at = (row: number, col: number): [number, number, number] => [0, 1, 2].map((c) => lut[3 * (row * cos + col) + c]!) as [number, number, number];

  it('row 0 is Lambert, and every row gives a surface facing the light its full light', () => {
    for (let i = 0; i < cos; i++) {
      const c = -1 + (2 * i) / (cos - 1);
      for (const v of at(0, i)) expect(v).toBeCloseTo(Math.max(0, c), 6);
    }
    for (let j = 0; j < curvature; j++) for (const v of at(j, cos - 1)) expect(v).toBeCloseTo(1, 6);
  });

  it('on a curved surface the shadow edge is soft and red (red > green > blue at the terminator)', () => {
    const mid = (cos - 1) / 2;
    for (const j of [8, 16, curvature - 1]) {
      const [r, g, b] = at(j, Math.round(mid));
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThanOrEqual(b);
      expect(r).toBeGreaterThan(0.02);
    }
    // More curvature, more light past the terminator.
    expect(at(curvature - 1, Math.round(mid))[0]).toBeGreaterThan(at(4, Math.round(mid))[0]);
  });

  it('is monotone in the light angle and within 0..1', () => {
    for (let j = 0; j < curvature; j++) {
      for (let i = 1; i < cos; i++) for (let c = 0; c < 3; c++) expect(at(j, i)[c]).toBeGreaterThanOrEqual(at(j, i - 1)[c]! - 1e-6);
    }
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('per-tone care and the tone stage', () => {
  it('a matt patch facing the camera keeps the swatch under neutral (true-tone), on all ten tones', () => {
    for (const hex of MONK) {
      const c = linearOf(hex);
      const out = skinToneStage(c, 'true-tone', skinToneCare(hex));
      for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(c[k]!, 6);
    }
  });

  it('light tones do not clip: twice the light rolls off below 1 and keeps the hue', () => {
    for (const hex of MONK.slice(0, 3)) {
      const c = linearOf(hex).map((v) => 2 * v) as [number, number, number];
      const out = skinToneStage(c, 'true-tone', skinToneCare(hex));
      expect(Math.max(...out)).toBeLessThan(1);
      const [r0, g0] = chroma(c), [r1, g1] = chroma(out);
      expect(Math.abs(r1 - r0) + Math.abs(g1 - g0)).toBeLessThan(1e-9);
    }
    // three's own curve would have pulled them towards white; this roll-off is hue-keeping by construction.
    expect(rollOff([2, 1, 0.5], 0.9)[0] / rollOff([2, 1, 0.5], 0.9)[2]).toBeCloseTo(4, 9);
  });

  it('under classic: light tones keep the lightness of ACES (their contrast with the cream) and get the swatch hue back; deep tones get their own lightness', () => {
    const rig = LIGHTING_RIGS.classic;
    const e = frontIrradiance(rig);
    const norm: [number, number, number] = [Math.PI / e[0], Math.PI / e[1], Math.PI / e[2]];
    for (const hex of MONK) {
      const albedo = linearOf(hex);
      const front = albedo.map((v, k) => (v * e[k]!) / Math.PI) as [number, number, number];
      const care = skinToneCare(hex);
      const out = skinToneStage(front, 'aces', care, norm);
      const aces = acesFilmic(front);
      const [r0, g0] = chroma(albedo), [r1, g1] = chroma(out);
      expect(Math.abs(r1 - r0) + Math.abs(g1 - g0), hex).toBeLessThan(0.003);
      if (care.deep === 0) expect(lum(out) / lum(aces), hex).toBeCloseTo(1, 2);
      if (care.deep === 1) expect(lum(out) / lum(albedo), hex).toBeCloseTo(1, 2);
    }
    // ACES alone takes Monk 10 to a third of its light: the near-black of the flat skin.
    expect(lum(acesFilmic(linearOf(MONK[9]!).map((v, k) => (v * e[k]!) / Math.PI) as [number, number, number])) / lum(linearOf(MONK[9]!))).toBeLessThan(0.6);
  });

  it('deep tones get a tighter highlight than light ones; nothing is white-veiled', () => {
    const light = skinToneCare(MONK[0]!), deep = skinToneCare(MONK[9]!);
    expect(light.deep).toBe(0);
    expect(deep.deep).toBe(1);
    expect(deep.roughness).toBeLessThan(light.roughness);
    for (const hex of MONK) {
      const c = skinToneCare(hex);
      expect(c.specularIntensity).toBeLessThanOrEqual(0.35);
      expect(c.sheen).toBeLessThanOrEqual(0.05);
      expect(c.knee).toBeGreaterThanOrEqual(0.9);
      expect(c.knee).toBeGreaterThan(Math.max(...linearOf(hex)));
    }
  });
});

describe('the shader patch', () => {
  it('finds its lines in the pinned three.js (r186) and replaces each of them', () => {
    expect(skinV2ChunksPresent()).toBe(true);
    const m = new THREE.MeshPhysicalMaterial({ color: '#3a312a' });
    patchSkinV2(m, '#3a312a', 'aces', [1, 1, 1]);
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: THREE.ShaderLib.physical.fragmentShader, vertexShader: THREE.ShaderLib.physical.vertexShader };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader.startsWith('#define SKIN_TONE_ACES')).toBe(true);
    for (const h of [SKIN_V2_HOOKS.pars, SKIN_V2_HOOKS.tone]) expect(shader.fragmentShader).not.toContain(h);
    expect(shader.fragmentShader).toContain('skinToneStage( gl_FragColor.rgb )');
    expect(shader.fragmentShader).toContain('skinDiffuse( dot( geometryNormal, directLight.direction ) )');
    expect(shader.fragmentShader).not.toContain(SKIN_V2_HOOKS.diffuse);
    expect(shader.fragmentShader).toContain('skinCurvature = length( fwidth( normal ) )');
    expect(Object.keys(shader.uniforms).sort()).toEqual(['skinFrontNorm', 'skinHairRoughness', 'skinHairSpecular', 'skinKnee', 'skinLift', 'skinLut', 'skinScatterScale']);
    expect(m.customProgramCacheKey()).toBe('skin-v2-aces');
    // Without head v3's hair the vertex shader never reads a `hair` attribute (the cover is 0: all skin).
    expect(shader.vertexShader).not.toMatch(/#define SKIN_HAIR/);
    expect(shader.vertexShader).toContain('vSkinHair = 0.0;');
  });

  it("head v3's hair gets its own, non-skin terms: plain Lambert, the flat roughness and specular, no sheen, the rig's tone curve", () => {
    const m = new THREE.MeshPhysicalMaterial({ color: '#604134' });
    const u = patchSkinV2(m, '#604134', 'true-tone', [1, 1, 1], true);
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: THREE.ShaderLib.physical.fragmentShader, vertexShader: THREE.ShaderLib.physical.vertexShader };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader.startsWith('#define SKIN_HAIR')).toBe(true);
    expect(shader.vertexShader).toContain('attribute float hair;');
    expect(shader.vertexShader).toContain('vSkinHair = clamp( hair, 0.0, 1.0 );');
    expect(shader.fragmentShader).toContain('mix( texture2D( skinLut, uv ).rgb, vec3( clamp( cosNL, 0.0, 1.0 ) ), vSkinHair )');
    expect(shader.fragmentShader).toContain('material.sheenColor *= 1.0 - vSkinHair;');
    expect(shader.fragmentShader).toContain('mix( skinToneStage( gl_FragColor.rgb ), toneMapping( gl_FragColor.rgb ), vSkinHair )');
    // The hair block runs after three has set the material up, so it overrides the skin's roughness and specular.
    expect(shader.fragmentShader.indexOf('skinHairRoughness + geometryRoughness')).toBeGreaterThan(shader.fragmentShader.indexOf('material.specularF90 = '));
    expect(m.customProgramCacheKey()).toBe('skin-v2-true-tone-hair');
    expect(u.skinHairRoughness.value).toBe(HAIR_ROUGHNESS);
    expect(HAIR_ROUGHNESS).toBe(0.75);
    // The hair's white reflection is the flat material's 0.3, whatever the tone.
    for (const hex of MONK) {
      updateSkinV2(m, u, hex);
      expect(u.skinHairSpecular.value * m.specularIntensity).toBeCloseTo(HAIR_SPECULAR, 9);
    }
  });

  it('a figure with head v3 hair gets the hair variant, and a body swap to a head without hair rebuilds it', () => {
    const g = tri();
    g.setAttribute('hair', new THREE.BufferAttribute(new Float32Array([0, 0.5, 1]), 1));
    const f = new Figure(g, Uint32Array.from([0, 1, 2]), 3, null);
    f.setSkinShading('skin-v2', 'classic');
    f.setSkin('#3a312a');
    expect((f.body.material as THREE.MeshPhysicalMaterial).customProgramCacheKey()).toBe('skin-v2-aces-hair');
    f.setBody(tri());
    expect((f.body.material as THREE.MeshPhysicalMaterial).customProgramCacheKey()).toBe('skin-v2-aces');
    expect(f.skinHex).toBe('#3a312a');
  });
});

describe('Figure.setSkinShading', () => {
  it('default flat: the material of before (no patch); skin-v2 patches only a figure with a skin colour; back to flat restores it', () => {
    const f = new Figure(tri(), Uint32Array.from([0, 1, 2]), 3, null);
    f.setSkin('#604134');
    const flat = f.body.material as THREE.MeshPhysicalMaterial;
    expect(flat.roughness).toBe(0.75);
    expect(flat.customProgramCacheKey()).not.toMatch(/skin-v2/);
    f.setSkinShading('skin-v2', 'neutral-v2');
    const v2 = f.body.material as THREE.MeshPhysicalMaterial;
    expect(v2).not.toBe(flat);
    expect(v2.customProgramCacheKey()).toBe('skin-v2-true-tone');
    expect(v2.roughness).toBeLessThan(0.75);
    expect(f.skinHex).toBe('#604134');
    f.setSkin('#f6ede4');
    expect(f.body.material).toBe(v2);
    expect(v2.roughness).toBeCloseTo(skinToneCare('#f6ede4').roughness, 9);
    f.setSkinShading('flat', 'neutral-v2');
    expect((f.body.material as THREE.MeshPhysicalMaterial).customProgramCacheKey()).not.toMatch(/skin-v2/);
    expect((f.body.material as THREE.MeshPhysicalMaterial).roughness).toBe(0.75);
    // The grey mannequin is the shared grey material either way.
    f.setSkinShading('skin-v2', 'classic');
    f.setSkin(null);
    expect(`#${(f.body.material as THREE.MeshStandardMaterial).color.getHexString()}`).toBe(DEFAULT_BODY_HEX.toLowerCase());
    expect((f.body.material as THREE.MeshStandardMaterial).customProgramCacheKey()).not.toMatch(/skin-v2/);
  });
});
