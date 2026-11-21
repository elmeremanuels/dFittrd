/**
 * The realistic body's procedural skin and studio light (`realisticSkin.ts`, `studioLight.ts`, `MountOptions.realisticSkin`):
 * the material takes the shopper's tone value and nothing else, the per-tone settings, the generated detail tile (size,
 * tiling, determinism), the per-vertex mask on the asset, the studio's calibration, and that with the option off
 * nothing changes (the figure's materials, and the two modules stay out of the viewer chunk's import graph). Pure logic
 * (no WebGL): the pictures and frame times are `spikes/garment-engine/viewer/realistic-body-skin-renders.mjs`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_BODY_HEX, Figure, meshGeometry } from './scene';
import { decodeRealisticBody } from './realisticBody';
import { REALISTIC_SKIN_GREY, REALISTIC_SKIN_HOOKS, SKIN_DETAIL, SKIN_MASK, labOfLinear, linearOfLab, linearRgbOf, realisticSkinCare, realisticSkinChunksPresent, realisticSkinMaterial, skinDetailPixels, skinMaskOf } from './realisticSkin';
import { STUDIO, studioEnvIrradiance, studioEnvironmentIntensity, studioFrontIrradiance, studioRadiance, studioScene } from './studioLight';
import { realisticSkinOf } from './realisticBodyLoad';

const MONK = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420'];
const asset = decodeRealisticBody(readFileSync(new URL('../assets/realistic-body/female-v1.crb', import.meta.url)));
const tri = (): THREE.BufferGeometry => meshGeometry({ positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) });

describe('colour helpers', () => {
  it('Lab round trip', () => {
    for (const hex of MONK) {
      const lin = linearRgbOf(hex);
      const back = linearOfLab(labOfLinear(lin));
      for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo(lin[c]!, 4);
    }
  });
});

describe('realisticSkinCare: everything comes from the tone value', () => {
  it('draws the tone itself, for every Monk tone', () => {
    for (const hex of MONK) {
      const care = realisticSkinCare(hex);
      expect(care.hex).toBe(hex);
      expect(care.toned).toBe(true);
    }
    expect(realisticSkinCare('#A07E56').hex).toBe('#a07e56');
  });

  it('no tone (or not a #rrggbb colour) is the grey mannequin without redness', () => {
    for (const v of [null, undefined, '', 'a07e56', '#fff', 'red']) {
      const care = realisticSkinCare(v);
      expect(care.hex).toBe(REALISTIC_SKIN_GREY);
      expect(care.toned).toBe(false);
      expect(care.flush).toEqual([1, 1, 1].map((x) => expect.closeTo(x, 6)));
    }
    expect(REALISTIC_SKIN_GREY).toBe(DEFAULT_BODY_HEX.toLowerCase());
  });

  it('redness: the flushed tone is the tone moved by flushDeltaA in a* (and a little darker), smaller on deep tones', () => {
    for (const hex of MONK) {
      const care = realisticSkinCare(hex);
      const lin = linearRgbOf(hex);
      const flushed = lin.map((v, c) => v * care.flush[c]!);
      const a = labOfLinear(lin), b = labOfLinear(flushed);
      expect(b[1] - a[1]).toBeCloseTo(care.flushDeltaA, 0);
      expect(b[0]).toBeLessThan(a[0]);
      // Redder: red gains on green.
      expect(care.flush[0]).toBeGreaterThan(care.flush[1]);
    }
    expect(realisticSkinCare(MONK[9]).flushDeltaA).toBeLessThan(realisticSkinCare(MONK[0]).flushDeltaA);
  });

  it('different tones give different settings; deep tones get a tighter, weaker white reflection and a skin-coloured sheen', () => {
    const light = realisticSkinCare(MONK[1]), deep = realisticSkinCare(MONK[8]);
    expect(deep.deep).toBeGreaterThan(0.9);
    expect(light.deep).toBe(0);
    expect(deep.roughness).toBeLessThan(light.roughness);
    expect(deep.specularIntensity).toBeLessThan(light.specularIntensity);
    expect(deep.sheen).toBeLessThan(light.sheen);
    // The sheen keeps the skin's hue: red over blue as the tone.
    for (const hex of MONK) {
      const care = realisticSkinCare(hex);
      expect(care.sheenColour[0]).toBeGreaterThanOrEqual(care.sheenColour[2]);
      expect(care.sheenColour.every((v) => v <= 1)).toBe(true);
    }
    // The light through thin parts and the wrap are red-first for every tone, and less on deep tones.
    for (const hex of MONK) {
      const care = realisticSkinCare(hex);
      expect(care.trans[0]).toBeGreaterThan(care.trans[1]);
      expect(care.trans[1]).toBeGreaterThan(care.trans[2]);
      expect(care.wrap[0]).toBeGreaterThan(care.wrap[1]);
    }
    expect(deep.wrap[0]).toBeLessThan(light.wrap[0]);
    // A deep tone still lets some light through at the ear (not black): at least a sixth of the light tone's red.
    expect(deep.trans[0]).toBeGreaterThan(0.15 * light.trans[0]);
  });
});

describe('the material', () => {
  it('the three.js chunks it hooks into are there (r186)', () => {
    expect(realisticSkinChunksPresent()).toBe(true);
  });

  it('takes the tone value as its colour and per-tone uniforms, and follows a new tone without a rebuild', () => {
    const skin = realisticSkinMaterial('#a07e56');
    const want = new THREE.Color('#a07e56');
    expect(skin.material.color.getHexString()).toBe(want.getHexString());
    const care = realisticSkinCare('#a07e56');
    expect(skin.uniforms.skinFlush.value.toArray()).toEqual(care.flush.map((v) => expect.closeTo(v, 6)));
    expect(skin.uniforms.skinWrap.value.toArray()).toEqual(care.wrap.map((v) => expect.closeTo(v, 6)));
    expect(skin.material.roughness).toBeCloseTo(care.roughness, 6);
    const key = skin.material.customProgramCacheKey();
    skin.setSkin('#3a312a');
    expect(skin.material.color.getHexString()).toBe('3a312a');
    expect(skin.material.roughness).toBeCloseTo(realisticSkinCare('#3a312a').roughness, 6);
    expect(skin.uniforms.skinTrans.value.x).toBeCloseTo(realisticSkinCare('#3a312a').trans[0], 6);
    expect(skin.material.customProgramCacheKey()).toBe(key);
    skin.setSkin(null);
    expect(skin.material.color.getHexString()).toBe('8c8c8c');
    expect(skin.uniforms.skinFlush.value.toArray()).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 6)));
    skin.dispose();
  });

  it('the patch inserts at every hook and keeps three’s own lines', () => {
    const skin = realisticSkinMaterial('#a07e56');
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    skin.material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
    for (const h of [REALISTIC_SKIN_HOOKS.colour, REALISTIC_SKIN_HOOKS.roughness, REALISTIC_SKIN_HOOKS.normal, REALISTIC_SKIN_HOOKS.lightsEnd]) expect(shader.fragmentShader).toContain(h);
    expect(shader.fragmentShader).toContain('skinFlush');
    expect(shader.fragmentShader).toContain('getIBLIrradiance( - geometryNormal )');
    // The direct diffuse is the wrapped one (three's chunk is inlined in place of its include).
    expect(shader.fragmentShader).toContain('skinWrap ) / ( 1.0 + skinWrap )');
    expect(shader.fragmentShader).not.toContain(REALISTIC_SKIN_HOOKS.diffuse);
    expect(shader.vertexShader).toContain('attribute vec4 skinMask;');
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['skinDetail', 'skinFlush', 'skinWrap', 'skinTrans']));
    skin.dispose();
  });
});

describe('the generated detail tile', () => {
  const px = skinDetailPixels();
  it('is small: 128 × 128 RGBA8, 64 KB (bound 256 KB), made in code, deterministic', () => {
    expect(px.length).toBe(SKIN_DETAIL.size * SKIN_DETAIL.size * 4);
    expect(px.byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(skinDetailPixels()).toEqual(px);
    expect(skinDetailPixels(SKIN_DETAIL.size, 1)).not.toEqual(px);
  });

  it('tiles: the step across the wrap is no larger than the steps inside', () => {
    const n = SKIN_DETAIL.size;
    for (const ch of [0, 1, 2, 3]) {
      let inside = 0, across = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n - 1; x++) inside += Math.abs(px[4 * (y * n + x + 1) + ch]! - px[4 * (y * n + x) + ch]!);
        across += Math.abs(px[4 * (y * n) + ch]! - px[4 * (y * n + n - 1) + ch]!);
      }
      expect(across / n).toBeLessThan(2 * (inside / (n * (n - 1))) + 1);
    }
  });

  it('the gradient averages to flat (a tiling height field has no net slope) and has detail in it', () => {
    const n = SKIN_DETAIL.size * SKIN_DETAIL.size;
    for (const ch of [0, 1]) {
      let s = 0, s2 = 0;
      for (let i = 0; i < n; i++) {
        const v = px[4 * i + ch]! - 127.5;
        s += v;
        s2 += v * v;
      }
      expect(Math.abs(s / n)).toBeLessThan(3);
      expect(Math.sqrt(s2 / n)).toBeGreaterThan(8);
    }
  });
});

describe('the mask on the realistic body', () => {
  const { mask, landmarks } = skinMaskOf(asset);
  const n = asset.meta.vertexCount, nb = asset.meta.bodyVertexCount;
  const ch = (i: number, c: number): number => mask[4 * i + c]!;

  it('one value per channel per vertex, in 0..1; the eyes are the two spheres', () => {
    expect(mask.length).toBe(4 * n);
    for (const v of mask) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < nb; i++) expect(ch(i, SKIN_MASK.eye)).toBe(0);
    for (let i = nb; i < n; i++) expect(ch(i, SKIN_MASK.eye)).toBe(1);
  });

  it('redness and thin parts sit where they should, on both sides, and are a small share of the skin', () => {
    const P = asset.positions;
    const at = (c: readonly number[]): number => {
      let best = 0, d = Infinity;
      for (let i = 0; i < nb; i++) {
        const e = Math.hypot(P[3 * i]! - c[0]!, P[3 * i + 1]! - c[1]!, P[3 * i + 2]! - c[2]!);
        if (e < d) [best, d] = [i, e];
      }
      return best;
    };
    for (const side of [1, -1]) {
      expect(ch(at([side * landmarks.cheek[0], landmarks.cheek[1], landmarks.cheek[2] + 1]), SKIN_MASK.redness)).toBeGreaterThan(0.5);
      expect(ch(at([side * landmarks.knee[0], landmarks.knee[1], landmarks.knee[2] + 2]), SKIN_MASK.redness)).toBeGreaterThan(0.4);
      expect(ch(at([side * (landmarks.ear[0] + 0.8), landmarks.ear[1], landmarks.ear[2]]), SKIN_MASK.thin)).toBeGreaterThan(0.5);
    }
    // Fingertips: the arm vertices furthest along the arm are thin.
    let tips = 0, thinTips = 0;
    const j = asset.meta.arm.joint, w = asset.meta.arm.wrist;
    const len = Math.hypot(w[0] - j[0], w[1] - j[1], w[2] - j[2]);
    for (let i = 0; i < nb; i++) {
      if (asset.armWeight[i]! < 0.5) continue;
      const s = ((Math.abs(P[3 * i]!) - j[0]) * (w[0] - j[0]) + (P[3 * i + 1]! - j[1]) * (w[1] - j[1]) + (P[3 * i + 2]! - j[2]) * (w[2] - j[2])) / len;
      if (s > landmarks.arm.tip - 2) {
        tips++;
        if (ch(i, SKIN_MASK.thin) > 0.8) thinTips++;
      }
    }
    expect(tips).toBeGreaterThan(20);
    expect(thinTips / tips).toBeGreaterThan(0.9);
    // Nothing red or thin on the belly or the back.
    const belly = at([0, asset.meta.levels.waist, 20]);
    expect(ch(belly, SKIN_MASK.redness)).toBe(0);
    expect(ch(belly, SKIN_MASK.thin)).toBe(0);
    // Away from the hands (a quarter of MakeHuman's vertices are in the hands, all of them a little red):
    let red = 0, thin = 0, rest = 0;
    for (let i = 0; i < nb; i++) {
      if (asset.armWeight[i]! > 0.3 && P[3 * i + 1]! < asset.meta.arm.wrist[1]) continue;
      rest++;
      if (ch(i, SKIN_MASK.redness) > 0.3) red++;
      if (ch(i, SKIN_MASK.thin) > 0.3) thin++;
    }
    expect(red / rest).toBeLessThan(0.08);
    expect(thin / rest).toBeLessThan(0.08);
    expect(red).toBeGreaterThan(100);
  });

  it('goes on a geometry of the fitted body (same vertex count) and nowhere else', () => {
    const look = realisticSkinOf(asset);
    const g = meshGeometry({ positions: Float64Array.from(asset.positions), indices: asset.indices });
    look.addMask(g);
    expect(g.getAttribute('skinMask').count).toBe(n);
    const other = tri();
    look.addMask(other);
    expect(other.getAttribute('skinMask')).toBeUndefined();
  });
});

describe('the studio light', () => {
  it('a matt surface facing the camera gets π in every channel (its own colour), within 2 %', () => {
    for (const v of studioFrontIrradiance()) expect(Math.abs(v / Math.PI - 1)).toBeLessThan(0.02);
    expect(studioEnvironmentIntensity()).toBeGreaterThan(0.2);
    expect(studioEnvironmentIntensity()).toBeLessThan(2);
  });

  it('the integration is right: a uniform sky of 1 gives π', () => {
    // studioEnvIrradiance integrates studioRadiance; check the quadrature on its own pieces: the floor-facing normal
    // sees mostly floor, the up-facing one mostly sky, and the key side more than the far side.
    const up = studioEnvIrradiance([0, 1, 0]), down = studioEnvIrradiance([0, -1, 0]);
    expect(up[1]).toBeGreaterThan(down[1]);
    expect(down[1]).toBeGreaterThan(Math.PI * STUDIO.floor[1] * 0.9);
    expect(studioEnvIrradiance([1, 0, 0])[1]).toBeGreaterThan(studioEnvIrradiance([-1, 0, 0])[1]);
    // Behind gets the strip of light: the ears and fingers have light to let through.
    expect(studioEnvIrradiance([0, 0, -1])[1]).toBeGreaterThan(studioEnvIrradiance([0, -1, 0])[1]);
  });

  it('is neutral (no colour cast on the skin) and made in code: a sphere coloured by studioRadiance', () => {
    const e = studioFrontIrradiance();
    expect(Math.max(...e) / Math.min(...e)).toBeLessThan(1.03);
    const scene = studioScene();
    const mesh = scene.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position'), col = mesh.geometry.getAttribute('color');
    const d = new THREE.Vector3(pos.getX(10), pos.getY(10), pos.getZ(10)).normalize();
    const want = studioRadiance(d.toArray());
    expect([col.getX(10), col.getY(10), col.getZ(10)]).toEqual(want.map((v) => expect.closeTo(v, 5)));
  });
});

describe('the option off: nothing changes', () => {
  it('a figure without an override keeps its materials; with one, the override takes the tone; taken off, back to before', () => {
    const fig = new Figure(tri(), new Uint32Array(0), 0, null);
    const grey = fig.body.material;
    expect((grey as THREE.MeshStandardMaterial).color.getHexString()).toBe('8c8c8c');
    fig.setSkin('#a07e56');
    const own = fig.body.material as THREE.MeshPhysicalMaterial;
    expect(own).not.toBe(grey);
    const skin = realisticSkinMaterial(null);
    fig.setSkinOverride(skin);
    expect(fig.body.material).toBe(skin.material);
    expect(skin.material.color.getHexString()).toBe('a07e56');
    fig.setSkin('#3a312a');
    expect(fig.body.material).toBe(skin.material);
    expect(skin.care.hex).toBe('#3a312a');
    fig.setBody(tri());
    expect(fig.body.material).toBe(skin.material);
    fig.setSkinOverride(null);
    expect(fig.body.material).not.toBe(skin.material);
    expect((fig.body.material as THREE.MeshPhysicalMaterial).color.getHexString()).toBe('3a312a');
    fig.setSkin(null);
    expect(fig.body.material).toBe(grey);
    skin.dispose();
    fig.dispose();
  });

  it('the skin and the studio are reached only through the realistic body’s lazy loader, and only with realisticSkin: true', () => {
    const dir = new URL('.', import.meta.url);
    const importers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /from '\.\/(realisticSkin|studioLight)'/.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(importers.sort()).toEqual(['realisticBodyLoad.ts']);
    const mount = readFileSync(new URL('mount.ts', dir), 'utf8');
    expect(mount).toContain("opts.realisticSkin === true ? mod.realisticSkinOf(");
    expect(mount).not.toMatch(/import [^;]*realisticSkin[^;]*from/);
  });
});
