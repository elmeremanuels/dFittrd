/**
 * The avatar look and `MountOptions.body` (plan slices 1 and 2): skin colour per figure, the
 * lighting rigs, the neutral head on the avatar, the family guard and the typed body. Pure logic
 * (no WebGL): what the pictures look like is in `spikes/garment-engine/viewer/avatar-renders.mjs`.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BASE_SHAPE_ID, bodyShape, buildBody, buildMannequin, buildMannequinMesh, familyShape, topology } from '@curtain/mannequin';
import { HEAD_SCALE_SHARE, IDENTITY_MORPH, NECK_TO_HEAD, fitNeckToHead, neckScaleAt, bodyFamilyOf, bodyField, buildAvatar, buildTypedAvatar, bundleFamilyOf, girthInput, isTypedBody, liftField, makeCollider, mannequinMeasurements, sanitiseMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { sample } from './collide';
import { openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { BACKDROP_HEX, CONTRAST_TARGET, DEFAULT_BODY_HEX, FLOOR_SEEN_HEX, Figure, LIGHTING_RIGS, LOOK_EXTRAS, TRUE_TONE_GLSL, TRUE_TONE_START, adaptiveBackdrop, cameraFrame, contrastOf, frontIrradiance, installTrueTone, lightingOf, meshGeometry, HAIR_HEX, hairLinear, tintHair, outlineColour, parseSkinHex, projectToCanvas, trueTone } from './scene';
import { GarmentViewError, headOf, planAvatar } from './mount';
import { tubeWeight } from './body';
import type { Mesh } from '@curtain/mannequin';
import * as spikeBody from '../../../spikes/garment-engine/viewer/src/body';
import * as spikeScene from '../../../spikes/garment-engine/viewer/src/scene';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const tri = (): THREE.BufferGeometry => meshGeometry({ positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) });
const figure = (): Figure => new Figure(tri(), Uint32Array.from([0, 1, 2]), 3, null);
const colourOf = (f: Figure): string => `#${(f.body.material as THREE.MeshStandardMaterial).color.getHexString()}`;

describe('look.skinHex', () => {
  it('reads #rrggbb and nothing else', () => {
    expect(parseSkinHex('#A07E56')).toBe('#a07e56');
    for (const bad of [undefined, null, '', 'a07e56', '#a07e5', '#a07e56ff', 'red', 'rgb(1,2,3)', 0xa07e56, { hex: '#a07e56' }]) expect(parseSkinHex(bad)).toBeNull();
  });

  it('keeps the grey of before when no colour is given', () => {
    const f = figure();
    expect(colourOf(f)).toBe(DEFAULT_BODY_HEX.toLowerCase());
    expect(f.skinHex).toBe('#8c8c8c');
    f.setSkin(null);
    expect(colourOf(f)).toBe('#8c8c8c');
  });

  it('colours only that figure: the other figure and the shared grey material stay as they were', () => {
    const a = figure();
    const b = figure();
    const shared = b.body.material;
    a.setSkin('#a07e56');
    expect(colourOf(a)).toBe('#a07e56');
    expect(a.body.material).not.toBe(shared);
    expect(b.body.material).toBe(shared);
    expect(colourOf(b)).toBe('#8c8c8c');
    // A second colour reuses the figure's own material (no remount, no new material).
    const own = a.body.material;
    a.setSkin('#3a312a');
    expect(a.body.material).toBe(own);
    expect(a.skinHex).toBe('#3a312a');
    // Anything that is not a colour, and null, go back to the shared grey.
    a.setSkin('not a colour');
    expect(a.body.material).toBe(shared);
    a.setSkin('#f3e7db');
    a.setSkin(null);
    expect(a.body.material).toBe(shared);
    expect(colourOf(figure())).toBe('#8c8c8c');
  });

  it('never touches the garment material', () => {
    const f = figure();
    const before = f.garment.material.color.getHexString();
    f.setSkin('#a07e56');
    expect(f.garment.material.color.getHexString()).toBe(before);
  });
});

describe('lighting', () => {
  it('classic is the rig of before', () => {
    expect(LIGHTING_RIGS.classic).toEqual({ toneMapping: 'aces', sky: 0xffffff, ground: 0x8a8076, hemisphere: 1.4, key: 2.2, rim: 1.1, floor: '#E9E1D6' });
  });

  it('neutral has white lights, a grey ground and puts π on a surface facing the camera', () => {
    const rig = LIGHTING_RIGS.neutral;
    expect(rig.toneMapping).toBe('true-tone');
    expect(rig.sky).toBe(0xffffff);
    expect((rig.ground >> 16) & 255).toBe((rig.ground >> 8) & 255);
    expect((rig.ground >> 8) & 255).toBe(rig.ground & 255);
    const [r, g, b] = frontIrradiance(rig);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(Math.abs(r / Math.PI - 1)).toBeLessThan(0.03);
    // The classic rig is warmer below (more red than blue from the ground) and dimmer.
    const c = frontIrradiance(LIGHTING_RIGS.classic);
    expect(c[0]).toBeGreaterThan(c[2]);
    expect(c[0] / Math.PI).toBeLessThan(0.9);
  });
});

/** The ten Monk Skin Tone swatches (`MONK_SWATCHES` in apps/web capture). */
const MONK = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420'];

describe('lighting neutral-v2', () => {
  it('has the lights of neutral (skin and garment colours as neutral) and adds an outline, a contact shadow and a floor bounce; classic and neutral add nothing', () => {
    expect(LIGHTING_RIGS['neutral-v2']).toEqual(LIGHTING_RIGS.neutral);
    expect(LOOK_EXTRAS.classic).toEqual({ outline: 0, outlineContrast: 3.2, contactShadow: 0, backdrop: 'cream', rim: 0, bounce: 0 });
    expect(LOOK_EXTRAS['neutral-v2'].bounce).toBeGreaterThan(0);
    expect(LOOK_EXTRAS['neutral-v2'].outlineContrast).toBe(4.5);
    expect(LOOK_EXTRAS.neutral).toEqual(LOOK_EXTRAS.classic);
    expect(LOOK_EXTRAS['neutral-v2'].outline).toBeGreaterThan(0);
    expect(LOOK_EXTRAS['neutral-v2'].outline).toBeLessThanOrEqual(1.5);
    expect(LOOK_EXTRAS['neutral-v2'].contactShadow).toBeGreaterThan(0);
    expect(LOOK_EXTRAS['neutral-v2'].backdrop).toBe('cream');
    expect(LOOK_EXTRAS['neutral-v2'].rim).toBe(0);
  });

  it('reads the host\'s lighting and head: only the names, anything else is today\'s look', () => {
    for (const v of ['classic', 'neutral', 'neutral-v2'] as const) expect(lightingOf(v)).toBe(v);
    for (const v of [undefined, null, '', 'Neutral', 'v2', 1, {}]) expect(lightingOf(v)).toBe('classic');
    for (const v of ['neutral', 'egg', 'neutral-v2', 'neutral-v3'] as const) expect(headOf(v)).toBe(v);
    for (const v of [undefined, null, '', 'v2', 'v3', 'NEUTRAL-V2', 'neutral-v4', 2]) expect(headOf(v)).toBe('neutral');
  });

  it('the outline: none on a skin that stands out 3:1 by itself; else the skin darkened (same hue) until it stands out from the cream and the floor', () => {
    const needs: number[] = [];
    for (const [i, hex] of [...MONK, DEFAULT_BODY_HEX.toLowerCase()].entries()) {
      const line = outlineColour(hex);
      const alone = Math.min(contrastOf(hex, BACKDROP_HEX), contrastOf(hex, FLOOR_SEEN_HEX));
      if (alone >= CONTRAST_TARGET) {
        expect(line).toBeNull();
        continue;
      }
      needs.push(i + 1);
      expect(line).not.toBeNull();
      expect(contrastOf(line!, BACKDROP_HEX)).toBeGreaterThanOrEqual(CONTRAST_TARGET);
      expect(contrastOf(line!, FLOOR_SEEN_HEX)).toBeGreaterThanOrEqual(CONTRAST_TARGET);
      // Darker, same hue: every channel scaled by about the same factor.
      const ch = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
      const [a, b] = [ch(hex), ch(line!)];
      const ks = a.map((v, k) => b[k]! / v);
      expect(Math.max(...ks) - Math.min(...ks)).toBeLessThan(0.03);
      expect(ks[0]).toBeLessThan(1);
    }
    // Monk 1 to 6 and the default grey need one; Monk 7 to 10 stand out from the cream on their own.
    expect(needs).toEqual([1, 2, 3, 4, 5, 6, 11]);
    // At the contrast neutral-v2 asks for (4.5), Monk 7 gets a line as well; Monk 8 to 10 do not.
    const t = LOOK_EXTRAS['neutral-v2'].outlineContrast;
    const lined = [...MONK, DEFAULT_BODY_HEX.toLowerCase()].map((h) => outlineColour(h, undefined, t));
    expect(lined.map((l, i) => (l ? i + 1 : 0)).filter(Boolean)).toEqual([1, 2, 3, 4, 5, 6, 7, 11]);
    for (const l of lined) if (l) expect(Math.min(contrastOf(l, BACKDROP_HEX), contrastOf(l, FLOOR_SEEN_HEX))).toBeGreaterThanOrEqual(t);
  });

  it('the adaptive backdrop (tried, not used): the cream darkened until the skin stands out from it', () => {
    for (const hex of MONK) {
      const b = adaptiveBackdrop(hex);
      expect(contrastOf(b, hex)).toBeGreaterThanOrEqual(CONTRAST_TARGET);
      if (contrastOf(hex, BACKDROP_HEX) >= CONTRAST_TARGET) expect(b.toLowerCase()).toBe(BACKDROP_HEX.toLowerCase());
    }
    // Monk 1 needs a mid grey behind it: that is why it is not the default.
    expect(contrastOf(adaptiveBackdrop(MONK[0]!), BACKDROP_HEX)).toBeGreaterThan(2.5);
  });
});

describe.each(['neutral-v2', 'neutral-v3'] as const)('head %s on the avatar', (headKind) => {
  const canonical = buildMannequinMesh(m, { head: headKind });
  const female = { category: 'dress', mannequin: { version: '0.1.0', shape: 'M' } as { family?: unknown } };

  it('planAvatar builds it only when asked; the shade reaches the geometry as a vertex colour', () => {
    expect(planAvatar(female, {}, { head: headKind }).avatar.mesh.shade).toBeDefined();
    expect(planAvatar(female, {}).avatar.mesh.shade).toBeUndefined();
    const g = meshGeometry(canonical);
    expect(g.getAttribute('color').count).toBe(canonical.positions.length / 3);
    expect(meshGeometry(buildMannequinMesh(m, { head: 'neutral' })).getAttribute('color')).toBeUndefined();
    const f = new Figure(g, Uint32Array.from([0, 1, 2]), 3, null);
    expect((f.body.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    f.setSkin('#a07e56');
    const skin = f.body.material as THREE.MeshStandardMaterial;
    expect(skin.vertexColors).toBe(true);
    // A body without the shade under a skin material: the flag flips and the shader is rebuilt (needsUpdate bumps the version).
    const version = skin.version;
    f.setBody(tri());
    expect(skin.vertexColors).toBe(false);
    expect(skin.version).toBeGreaterThan(version);
    // The same kind of body again: no rebuild.
    const again = skin.version;
    f.setBody(tri());
    expect(skin.version).toBe(again);
    f.setSkin(null);
    expect((f.body.material as THREE.MeshStandardMaterial).vertexColors).toBe(false);
    // The shared grey of every figure without the v2 head stays without vertex colours.
    expect((figure().body.material as THREE.MeshStandardMaterial).vertexColors).toBe(false);
  });

  it('the tube on the neck follows the neck on every body the viewer draws; the head above it keeps its calm scale; the mesh stays closed', () => {
    const { chinY, topY } = canonical.headLevels!;
    expect(tubeWeight({ chinY, topY }, chinY - 1)).toBe(1);
    expect(tubeWeight({ chinY, topY }, chinY + 0.2 * (topY - chinY))).toBe(0);
    const head = canonical.partNames.indexOf('head'), torso = canonical.partNames.indexOf('torso');
    for (const g of [[60, 45, 65], [88, 70, 96], [116, 98, 122], [150, 140, 160]] as const) {
      const avatar = buildAvatar(m, canonical, { bust: g[0], waist: g[1], hip: g[2] });
      expect(topology(avatar.mesh).watertight).toBe(true);
      // Between the neck ring and the chin the head's tube is outside the torso's neck, by less than 6 mm.
      let tube = 0, neck = 0;
      for (let i = 0; i < canonical.vertexPart.length; i++) {
        const y = avatar.mesh.positions[3 * i + 1]!;
        if (y < m.morphHeights.neck + 1 || y > chinY - 1) continue;
        const x = Math.abs(avatar.mesh.positions[3 * i]!);
        if (canonical.vertexPart[i] === head) tube = Math.max(tube, x);
        else if (canonical.vertexPart[i] === torso) neck = Math.max(neck, x);
      }
      expect(tube).toBeGreaterThan(neck);
      expect(tube - neck).toBeLessThan(0.6);
      // The jaw band rule of the neck fit holds for this head too.
      const band = jawBandOf(avatar.mesh, chinY, topY);
      expect(band.neck).toBeLessThanOrEqual(NECK_TO_HEAD * band.head + 1e-9);
    }
    for (const heightCm of [130, 182, 220]) expect(topology(buildTypedAvatar(m, { heightCm }, 'dress', { head: headKind }).avatar.mesh).watertight).toBe(true);
  });
});

describe('head v3: the hair colour', () => {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const rgb = (hex: string) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const v3 = buildMannequinMesh(m, { head: 'neutral-v3' });
  const crown = v3.hair!.findIndex((h, i) => h === 1 && v3.positions[3 * i + 1]! > m.statureCm - 0.5);

  it('only head v3 carries a hair mask; the grey mannequin keeps grey hair', () => {
    expect(buildMannequinMesh(m, { head: 'neutral-v2' }).hair).toBeUndefined();
    expect(meshGeometry(buildMannequinMesh(m, { head: 'neutral-v2' })).getAttribute('hair')).toBeUndefined();
    const g = meshGeometry(v3);
    const c = g.getAttribute('color').array as Float32Array;
    const before = Array.from(c.slice(3 * crown, 3 * crown + 3));
    tintHair(g, null);
    expect(Array.from(c.slice(3 * crown, 3 * crown + 3))).toEqual(before);
    expect(before[0]).toBeCloseTo(before[2]!, 9);
  });

  it('on a light skin the hair is the dark brown, on a deep skin the darkened skin; the skin off the hair is untouched', () => {
    const f = new Figure(meshGeometry(v3), Uint32Array.from([0, 1, 2]), 3, null);
    const c = (f.body.geometry.getAttribute('color').array as Float32Array);
    const shade = lin(v3.shade![crown]!);
    f.setSkin(MONK[0]!);
    const skin1 = rgb(MONK[0]!);
    const shown1 = [0, 1, 2].map((ch) => c[3 * crown + ch]! * skin1[ch]!);
    const want1 = hairLinear(MONK[0]!);
    for (let ch = 0; ch < 3; ch++) expect(shown1[ch]! / shade).toBeCloseTo(want1[ch]! / lin(0.66), 6);
    expect(want1).toEqual(rgb(HAIR_HEX));
    // Monk 10 is darker than the brown: the hair is the skin times its shade, as without a tint.
    f.setSkin(MONK[9]!);
    for (let ch = 0; ch < 3; ch++) expect(c[3 * crown + ch]).toBeCloseTo(shade, 6);
    // A vertex of the body (no hair) keeps its shade of 1.
    expect(c[0]).toBe(1);
    // Back to the grey: grey hair again.
    f.setSkin(null);
    expect(c[3 * crown]).toBeCloseTo(shade, 6);
  });
});

/** The jaw band of `jawBand` below on a head whose chin is not its lowest point (head v2): the head above its tube only. */
function jawBandOf(mesh: Mesh, chin: number, top: number): { head: number; neck: number } {
  const head = mesh.partNames.indexOf('head'), torso = mesh.partNames.indexOf('torso');
  const out = { head: 0, neck: 0 };
  for (let i = 0; i < mesh.vertexPart.length; i++) {
    const t = (mesh.positions[3 * i + 1]! - chin) / (top - chin);
    if (t < 0.074 || t > 0.296) continue;
    const x = Math.abs(mesh.positions[3 * i]!);
    if (mesh.vertexPart[i] === head && t >= 0.2) out.head = Math.max(out.head, x);
    else if (mesh.vertexPart[i] === torso) out.neck = Math.max(out.neck, x);
  }
  return out;
}

describe('tone curve of the neutral lighting', () => {
  const lin = (hex: string): [number, number, number] => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
  };
  it('leaves every Monk swatch and the default grey exactly as asked when lit at π', () => {
    for (const hex of ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420', '#8c8c8c']) {
      const c = lin(hex);
      const out = trueTone(c);
      // Monk 1 to 3 have a channel above the start of the roll-off: they move by less than 1.5 % there; the rest not at all.
      if (Math.max(...c) < TRUE_TONE_START) expect(out).toEqual(c);
      else for (let k = 0; k < 3; k++) expect(Math.abs(out[k]! / c[k]! - 1)).toBeLessThan(0.015);
    }
  });
  it('rolls highlights off below 1 without a jump, and keeps the order of the channels', () => {
    expect(trueTone([TRUE_TONE_START, TRUE_TONE_START, TRUE_TONE_START])[0]).toBeCloseTo(TRUE_TONE_START, 12);
    let last = 0;
    for (let v = 0.5; v < 6; v += 0.05) {
      const [r, g, b] = trueTone([v, 0.8 * v, 0.6 * v]);
      expect(r).toBeLessThan(1);
      expect(r).toBeGreaterThanOrEqual(last);
      expect(r).toBeGreaterThanOrEqual(g);
      expect(g).toBeGreaterThanOrEqual(b);
      last = r;
    }
  });
  it('is the shader three.js compiles for the custom slot', () => {
    expect(TRUE_TONE_GLSL.startsWith('vec3 CustomToneMapping( vec3 color ) {')).toBe(true);
    expect(TRUE_TONE_GLSL).toContain('StartCompression = 0.90');
    // The slot this replaces exists in the pinned three.js; if an upgrade renames it, neutral lighting would silently not map.
    expect(THREE.ShaderChunk.tonemapping_pars_fragment.includes('vec3 CustomToneMapping( vec3 color ) { return color; }') || THREE.ShaderChunk.tonemapping_pars_fragment.includes(TRUE_TONE_GLSL)).toBe(true);
    expect(spikeScene.TRUE_TONE_GLSL).toBe(TRUE_TONE_GLSL);
  });
});

describe('neutral head on the avatar', () => {
  const canonical = buildMannequinMesh(m, { head: 'neutral' });
  it('a body at the mannequin\'s own girths is the canonical mesh', () => {
    const avatar = buildAvatar(m, canonical, mannequinMeasurements(m));
    expect(Array.from(avatar.mesh.positions)).toEqual(Array.from(canonical.positions));
  });

  it('the head takes a fifth of the neck\'s scale, the torso all of it; the mesh stays closed', () => {
    const avatar = buildAvatar(m, canonical, { bust: 116, waist: 98, hip: 122 });
    const s = avatar.morph.girthScaleAt(m.morphHeights.neck, 'body');
    expect(s).toBeGreaterThan(1.2);
    const head = canonical.partNames.indexOf('head');
    let widest = 0, widestBase = 0;
    for (let i = 0; i < canonical.vertexPart.length; i++) {
      if (canonical.vertexPart[i] !== head) continue;
      widest = Math.max(widest, avatar.mesh.positions[3 * i]!);
      widestBase = Math.max(widestBase, canonical.positions[3 * i]!);
      expect(avatar.mesh.positions[3 * i + 1]).toBe(canonical.positions[3 * i + 1]);
    }
    expect(widest / widestBase).toBeCloseTo(1 + HEAD_SCALE_SHARE * (s - 1), 9);
    expect(topology(avatar.mesh).watertight).toBe(true);
  });

  it('the egg-head mesh is morphed exactly as before', () => {
    const egg = buildMannequinMesh(m);
    const meas = { bust: 104, waist: 90, hip: 112 };
    const now = buildAvatar(m, egg, meas);
    const s = (y: number) => now.morph.girthScaleAt(y, 'body');
    const torso = egg.partNames.indexOf('torso');
    for (let i = 0; i < egg.vertexPart.length; i += 97) {
      if (egg.vertexPart[i] !== torso) continue;
      const y = egg.positions[3 * i + 1]!;
      expect(now.mesh.positions[3 * i]).toBe(egg.positions[3 * i]! * s(y));
      expect(now.mesh.positions[3 * i + 2]).toBe(egg.positions[3 * i + 2]! * s(y));
    }
  });
});

describe('MountOptions.body', () => {
  it('female is the default family; only "male" is male', () => {
    for (const b of [undefined, null, {}, { family: 'female' }, { family: 'other' }, { family: 1 }]) expect(bodyFamilyOf(b as never)).toBe('female');
    expect(bodyFamilyOf({ family: 'male' })).toBe('male');
  });

  it('a bundle without a family was draped on the female body (every bundle today)', () => {
    expect(bundleFamilyOf({ mannequin: { version: '0.1.0', shape: 'M' } as never })).toBe('female');
    expect(bundleFamilyOf(undefined)).toBe('female');
    expect(bundleFamilyOf({ mannequin: { family: 'male' } })).toBe('male');
    // The guard in mountGarmentView: a male body never gets a garment draped on the female body.
    expect(bodyFamilyOf({ family: 'male' }) === bundleFamilyOf({ mannequin: {} })).toBe(false);
  });

  it('girths alone keep the path of before; chest is bust and wins', () => {
    expect(isTypedBody({ bust: 96, waist: 80, hip: 104 })).toBe(false);
    expect(isTypedBody({})).toBe(false);
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, '170' as never]) expect(isTypedBody({ heightCm: bad, shoulderCm: bad })).toBe(false);
    expect(isTypedBody({ heightCm: 170 })).toBe(true);
    expect(isTypedBody({ shoulderCm: 38 })).toBe(true);
    const fallback = mannequinMeasurements(m);
    expect(sanitiseMeasurements(girthInput({ bust: 96, waist: 80, hip: 104 }), fallback)).toEqual(sanitiseMeasurements({ bust: 96, waist: 80, hip: 104 }, fallback));
    expect(sanitiseMeasurements(girthInput({}), fallback)).toEqual(fallback);
    expect(sanitiseMeasurements(girthInput({ bust: 96, chest: 100 }), fallback).bust).toBe(100);
  });

  it('a typed height draws the taller body; the garment hangs from its own support level and collides with that body', () => {
    const top = buildTypedAvatar(m, { heightCm: 182 }, 'dress', { head: 'neutral' });
    const tall = buildBody({ family: 'female', heightCm: 182 });
    expect(top.statureCm).toBe(182);
    expect(top.garmentLiftCm).toBeCloseTo(tall.morphHeights.shoulder - m.morphHeights.shoulder, 9);
    expect(top.garmentLiftCm).toBeGreaterThan(10);
    const bottom = buildTypedAvatar(m, { heightCm: 182 }, 'bottom');
    expect(bottom.garmentLiftCm).toBeCloseTo(tall.morphHeights.waist - m.morphHeights.waist, 9);
    expect(bottom.garmentLiftCm).toBeLessThan(top.garmentLiftCm);
    let maxY = 0;
    for (let i = 1; i < top.avatar.mesh.positions.length; i += 3) maxY = Math.max(maxY, top.avatar.mesh.positions[i]!);
    expect(maxY).toBeCloseTo(182, 6);
    expect(topology(top.avatar.mesh).watertight).toBe(true);
    expect(top.avatar.rings.chest).toBe(m.shape.rings.chest.circumferenceCm);
    // The field is the drawn body's, moved down by the lift: a height in the garment's space reads the body `lift` higher.
    const own = bodyField(tall, IDENTITY_MORPH);
    const a = new Float32Array(4), b = new Float32Array(4);
    for (const [field, lift] of [[top.field, top.garmentLiftCm], [bottom.field, bottom.garmentLiftCm]] as const) {
      for (const y of [70, 95, 110, 130]) {
        expect(sample(field.torso, y, a)).toBe(sample(own.torso, y + lift, b));
        expect(Array.from(a)).toEqual(Array.from(b));
      }
      expect(sample(field.legs[0], 40, a)).toBe(true);
      expect(sample(own.legs[0], 40 + lift, b)).toBe(true);
      expect(Array.from(a)).toEqual(Array.from(b));
      expect(field.armFrames[0]!.joint[1]).toBeCloseTo(own.armFrames[0]!.joint[1] - lift, 9);
    }
    // The supporting ring of the drawn body sits, in the garment's space, where the bundle body has it.
    expect(tall.morphHeights.shoulder - top.garmentLiftCm).toBeCloseTo(m.morphHeights.shoulder, 9);
    // No typed height: no lift, and the field of the body at the bundle body's stature.
    const same = buildTypedAvatar(m, { shoulderCm: 36.5 }, 'dress');
    expect(same.garmentLiftCm).toBe(0);
    expect(same.statureCm).toBe(m.statureCm);
    expect(liftField(own, 0).torso.lo).toBe(own.torso.lo);
  });

  it('a draped dress stays outside a taller and a shorter drawn body', () => {
    const b = buildBundle('aalter-studio-2', { skipSeparation: true });
    const bundle: SpikeBundle = { productId: 'aalter-studio-2', anchors: JSON.parse(b.files['anchors.json']) as SpikeBundle['anchors'], grading: JSON.parse(b.files['grading.json']) as SpikeBundle['grading'], material: JSON.parse(b.files['material.json']) as SpikeBundle['material'], qa: JSON.parse(b.files['qa.json']) as SpikeBundle['qa'], baseMesh: meshFromGlb(b.files['base.glb']) };
    const session = openSession(m, bundle);
    for (const heightCm of [182, 156]) {
      const typed = buildTypedAvatar(m, { heightCm }, bundle.anchors.category);
      const fit = fitForBody(session.payload, typed.avatar.measurements);
      const f = prepareFit(session, typed.avatar, typed.field, fit, bundle.grading.baseSize, viewerMaterial('product', bundle.material));
      const pos = Float32Array.from(relax(f));
      // In drawn space: the garment lifted, against the drawn body's own field, with a little less than the solver's clearance.
      for (let i = 1; i < pos.length; i += 3) pos[i] = pos[i]! + typed.garmentLiftCm;
      const drawn = makeCollider(bodyField(buildBody({ family: 'female', heightCm }), IDENTITY_MORPH), 0.1, f.chains, f.noCollide);
      let inside = 0;
      for (let i = 0; i < f.chains.length; i++) if (!f.pinned[i] && pos[3 * i + 1]! > 1 && drawn(pos, i)) inside++;
      expect(inside / f.chains.length).toBeLessThan(0.01);
      // The control: drawn at the lift but draped on the bundle body, the cloth is inside the drawn body in many places.
      const plain = prepareFit(session, buildAvatar(m, buildMannequinMesh(m), mannequinMeasurements(m)), bodyField(m, IDENTITY_MORPH), fit, bundle.grading.baseSize, viewerMaterial('product', bundle.material));
      const naive = Float32Array.from(relax(plain));
      for (let i = 1; i < naive.length; i += 3) naive[i] = naive[i]! + typed.garmentLiftCm;
      let naiveInside = 0;
      for (let i = 0; i < plain.chains.length; i++) if (!plain.pinned[i] && naive[3 * i + 1]! > 1 && drawn(naive, i)) naiveInside++;
      expect(naiveInside).toBeGreaterThan(10 * Math.max(1, inside));
    }
  });

  it('a typed shoulder width moves the shoulders of the drawn body and of the collision field; the girths stay', () => {
    const wide = buildTypedAvatar(m, { shoulderCm: 41, bust: 96, waist: 80, hip: 104 }, 'top');
    const narrow = buildTypedAvatar(m, { shoulderCm: 34, bust: 96, waist: 80, hip: 104 }, 'top');
    expect(wide.garmentLiftCm).toBe(0);
    expect(wide.avatar.measurements).toEqual({ bust: 96, waist: 80, hip: 104 });
    expect(wide.avatar.rings.chest).toBe(96);
    expect(wide.avatar.rings.hip).toBe(104);
    expect(wide.field.armFrames[0]!.joint[0]).toBeGreaterThan(narrow.field.armFrames[0]!.joint[0] + 2);
    expect(wide.avatar.rings.shoulder).toBeGreaterThan(narrow.avatar.rings.shoulder);
  });

  it('works on the male base body (for the bundles to come)', () => {
    const male = buildMannequin(familyShape('male')!);
    const t = buildTypedAvatar(male, { family: 'male', heightCm: 186, shoulderCm: 42 }, 'top', { head: 'neutral' });
    expect(t.statureCm).toBe(186);
    expect(t.avatar.mesh.partNames).toContain('head');
    expect(topology(t.avatar.mesh).watertight).toBe(true);
  });
});

/**
 * Largest half-width (cm) of the head and of the neck column in the jaw band: 7.4 % to 29.6 % of the head's height above
 * the chin, which is 87.5 % to 90.5 % of stature on the female body (the male body's levels are warped, so the band
 * is taken on the head itself).
 */
function jawBand(mesh: Mesh): { head: number; neck: number } {
  const head = mesh.partNames.indexOf('head'), torso = mesh.partNames.indexOf('torso');
  let top = 0, chin = Infinity;
  for (let i = 0; i < mesh.vertexPart.length; i++) {
    if (mesh.vertexPart[i] !== head) continue;
    top = Math.max(top, mesh.positions[3 * i + 1]!);
    chin = Math.min(chin, mesh.positions[3 * i + 1]!);
  }
  const out = { head: 0, neck: 0 };
  for (let i = 0; i < mesh.vertexPart.length; i++) {
    const t = (mesh.positions[3 * i + 1]! - chin) / (top - chin);
    if (t < 0.074 || t > 0.296) continue;
    const x = Math.abs(mesh.positions[3 * i]!);
    if (mesh.vertexPart[i] === head) out.head = Math.max(out.head, x);
    else if (mesh.vertexPart[i] === torso) out.neck = Math.max(out.neck, x);
  }
  return out;
}

describe('the neck under the neutral head', () => {
  const canonical = buildMannequinMesh(m, { head: 'neutral' });
  const morphed = (bust: number, waist: number, hip: number) => buildAvatar(m, canonical, { bust, waist, hip });

  it('was wider than the head on a large body before the fit (the defect), and is not after it', () => {
    // The widest body the viewer draws: without the fit the neck column is 9.6 cm against a 7.55 cm jaw.
    const big = morphed(150, 140, 160);
    expect(big.neck!.scale).toBeLessThan(0.75);
    const band = jawBand(big.mesh);
    expect(band.neck).toBeLessThanOrEqual(NECK_TO_HEAD * band.head + 1e-9);
    expect(band.neck).toBeGreaterThan(0.85 * band.head);
    expect(band.head).toBeCloseTo(7.55, 1);
  });

  it('holds for every body the viewer can draw: girth limits, typed heights from 130 to 220 cm, both families', () => {
    const male = buildMannequin(familyShape('male')!);
    const meshes: Mesh[] = [];
    for (const g of [[60, 45, 65], [88, 70, 96], [116, 98, 122], [150, 140, 160], [160, 150, 170], [160, 45, 65]] as const) {
      meshes.push(morphed(g[0], g[1], g[2]).mesh);
      for (const heightCm of [130, 150, 168, 182, 220]) meshes.push(buildTypedAvatar(m, { heightCm, bust: g[0], waist: g[1], hip: g[2] }, 'dress', { head: 'neutral' }).avatar.mesh);
    }
    for (const heightCm of [130, 174, 220]) for (const chest of [70, 98, 150]) meshes.push(buildTypedAvatar(male, { family: 'male', heightCm, chest }, 'top', { head: 'neutral' }).avatar.mesh);
    for (const mesh of meshes) {
      const band = jawBand(mesh);
      expect(band.head).toBeGreaterThan(4);
      expect(band.neck).toBeLessThanOrEqual(NECK_TO_HEAD * band.head + 1e-9);
      expect(topology(mesh).watertight).toBe(true);
    }
  });

  it('leaves the base body, a slim body and the egg head alone', () => {
    expect(morphed(88, 70, 96).neck ?? null).toBeNull();
    expect(buildAvatar(m, canonical, mannequinMeasurements(m)).neck).toBeNull();
    const egg = buildAvatar(m, buildMannequinMesh(m), { bust: 150, waist: 140, hip: 160 });
    expect(egg.neck).toBeNull();
    expect(fitNeckToHead(egg.mesh, m).mesh).toBe(egg.mesh);
  });

  it('narrows only above the shoulder ring, smoothly, and the collision field is the drawn neck', () => {
    const big = morphed(150, 140, 160);
    const fit = big.neck!;
    expect(fit.from).toBe(m.morphHeights.shoulder);
    expect(fit.to).toBe(m.morphHeights.neck);
    expect(neckScaleAt(fit, fit.from - 5)).toBe(1);
    expect(neckScaleAt(fit, fit.from)).toBe(1);
    expect(neckScaleAt(fit, fit.to)).toBeCloseTo(fit.scale, 12);
    expect(neckScaleAt(fit, fit.to + 20)).toBeCloseTo(fit.scale, 12);
    expect(neckScaleAt(null, 150)).toBe(1);
    // Everything but the torso above the shoulder ring is where the plain morph puts it.
    const plain = spikeBody.buildAvatar(m, buildMannequinMesh(m), { bust: 150, waist: 140, hip: 160 });
    const torso = canonical.partNames.indexOf('torso'), head = canonical.partNames.indexOf('head');
    const eggMesh = buildMannequinMesh(m);
    let moved = 0;
    for (let i = 0; i < canonical.vertexPart.length; i++) {
      const y = canonical.positions[3 * i + 1]!;
      if (canonical.vertexPart[i] === head) continue;
      if (canonical.vertexPart[i] === torso && y > fit.from) {
        moved++;
        continue;
      }
      const s = big.morph.girthScaleAt(y, 'body');
      const arm = canonical.partNames[canonical.vertexPart[i]!]!.startsWith('arm');
      if (!arm) expect(big.mesh.positions[3 * i]).toBe(canonical.positions[3 * i]! * s);
    }
    expect(moved).toBeGreaterThan(100);
    expect(plain.neck ?? null).toBeNull();
    expect(eggMesh.partNames).not.toContain('head');
    // The field: as the plain morph's below the shoulder ring, narrowed by the fit above it.
    const field = bodyField(m, big), wide = bodyField(m, { morph: big.morph });
    const a = new Float32Array(4), b = new Float32Array(4);
    sample(field.torso, 120, a);
    sample(wide.torso, 120, b);
    expect(Array.from(a)).toEqual(Array.from(b));
    sample(field.torso, fit.to + 1, a);
    sample(wide.torso, fit.to + 1, b);
    expect(a[2]! / b[2]!).toBeCloseTo(fit.scale, 5);
    expect(a[3]! / b[3]!).toBeCloseTo(fit.scale, 5);
    expect(big.rings.neck).toBeCloseTo(m.shape.rings.neck.circumferenceCm * big.morph.girthScaleAt(m.morphHeights.neck, 'body') * fit.scale, 9);
  });
});

describe('planAvatar: what mountGarmentView decides before any WebGL', () => {
  // A bundle of today: its anchors name the mannequin's version and shape, and no family.
  const female = { category: 'dress', mannequin: { version: '0.1.0', shape: 'M' } as { family?: unknown } };

  it('a male body on a bundle draped on the female body is incompatible, and the reverse', () => {
    for (const [anchors, body] of [[female, { family: 'male' }], [{ category: 'top', mannequin: { family: 'male' } }, {}], [{ category: 'top', mannequin: { family: 'male' } }, { family: 'female' }]] as const) {
      let code = '';
      try {
        planAvatar(anchors, body as never);
      } catch (e) {
        code = e instanceof GarmentViewError ? e.code : 'other';
      }
      expect(code).toBe('incompatible');
    }
    expect(planAvatar({ category: 'top', mannequin: { family: 'male' } }, { family: 'male' }).m.shape.family).toBe('male');
  });

  it('girths only: the morphed base body, no lift, the camera frame of before; the neutral head unless the host asks for the egg', () => {
    for (const body of [undefined, null, {}, { bust: 96, waist: 78, hip: 104 }]) {
      const plan = planAvatar(female, body);
      expect(plan.garmentLiftCm).toBe(0);
      expect(plan.statureCm).toBe(0);
      expect(plan.head).toBe('neutral');
      expect(plan.avatar.mesh.partNames).toContain('head');
      expect(plan.headPoint[1]).toBeCloseTo(0.935 * plan.m.statureCm, 9);
    }
    const egg = planAvatar(female, { bust: 96, waist: 78, hip: 104 }, { head: 'egg' });
    expect(egg.avatar.mesh.partNames).not.toContain('head');
    // The egg-head avatar is the one every 3D view had before the look options existed.
    const before = buildAvatar(egg.m, buildMannequinMesh(egg.m), { bust: 96, waist: 78, hip: 104 });
    expect(Array.from(egg.avatar.mesh.positions)).toEqual(Array.from(before.mesh.positions));
    expect(Array.from(egg.field.torso.data)).toEqual(Array.from(bodyField(egg.m, before).torso.data));
    for (const look of [null, {}, { head: 'other' }, { skinHex: '#a07e56' }]) expect(planAvatar(female, {}, look as never).head).toBe('neutral');
  });

  it('a typed height lifts the garment from the shoulder ring (a bottom: from the waist ring) and moves the head point', () => {
    const tall = planAvatar(female, { heightCm: 182 });
    expect(tall.statureCm).toBe(182);
    expect(tall.garmentLiftCm).toBeCloseTo(buildBody({ family: 'female', heightCm: 182 }).morphHeights.shoulder - tall.m.morphHeights.shoulder, 9);
    expect(tall.garmentLiftCm).toBeGreaterThan(8);
    expect(tall.headPoint[1]).toBeCloseTo(0.935 * 182, 9);
    const skirt = planAvatar({ category: 'bottom' }, { heightCm: 156 });
    expect(skirt.garmentLiftCm).toBeCloseTo(buildBody({ family: 'female', heightCm: 156 }).morphHeights.waist - skirt.m.morphHeights.waist, 9);
    expect(skirt.garmentLiftCm).toBeLessThan(-4);
  });

  it('out-of-range input is held at the limits: no NaN, no throw', () => {
    for (const [heightCm, drawn] of [[1, 130], [120, 130], [260, 220], [1e6, 220]] as const) expect(planAvatar(female, { heightCm }).statureCm).toBe(drawn);
    for (const heightCm of [NaN, -5, 0, Infinity, '170' as never]) expect(planAvatar(female, { heightCm }).statureCm).toBe(0);
    const plan = planAvatar(female, { bust: 1e9, waist: -3, hip: NaN, heightCm: 1e6 });
    expect(plan.avatar.measurements.bust).toBe(160);
    expect(plan.avatar.mesh.positions.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('camera frame and toScreen', () => {
  const view = (statureCm: number, w: number, h: number): THREE.PerspectiveCamera => {
    const camera = new THREE.PerspectiveCamera(28, w / h, 5, 5000);
    const f = cameraFrame(60, statureCm, w / h, 28);
    camera.position.set(...f.position);
    camera.lookAt(...f.target);
    camera.updateMatrixWorld();
    return camera;
  };

  it('is the frame of before up to 175 cm', () => {
    const f = cameraFrame(60, 0, 390 / 760, 28);
    expect(f.target).toEqual([0, 98, 0]);
    expect(f.position[1]).toBe(112);
    expect(f.position[2]).toBeCloseTo(205 / 2 / Math.tan((14 * Math.PI) / 180), 9);
    expect(cameraFrame(60, 168, 390 / 760, 28)).toEqual(f);
    expect(cameraFrame(60, 175, 390 / 760, 28)).toEqual(f);
  });

  it('keeps the whole of a tall typed body on a phone canvas, feet to crown', () => {
    for (const heightCm of [130, 168, 182, 220]) {
      const plan = planAvatar({ category: 'dress' }, { heightCm });
      const camera = view(plan.statureCm, 390, 760);
      for (const p of [[0, 0, 0], [0, heightCm, 0], [...plan.headPoint]] as const) {
        const at = projectToCanvas(camera, new THREE.Vector3(...p), 390, 760);
        expect(at.y).toBeGreaterThan(0);
        expect(at.y).toBeLessThan(760);
        expect(at.x).toBeCloseTo(195, 6);
      }
    }
  });

  it('toScreen("head") on the default body at phone size is in the upper part of the canvas, in the middle', () => {
    const plan = planAvatar({ category: 'dress' }, {});
    const at = projectToCanvas(view(0, 390, 760), new THREE.Vector3(...plan.headPoint), 390, 760);
    // Measured in headless Chromium through the mount: (195, 156).
    expect(at.x).toBeCloseTo(195, 6);
    expect(Math.abs(at.y - 156)).toBeLessThan(2);
  });

  it('the neutral tone curve installs once and reports it', () => {
    expect(installTrueTone()).toBe(true);
    expect(installTrueTone()).toBe(true);
    expect(THREE.ShaderChunk.tonemapping_pars_fragment.split('vec3 CustomToneMapping(').length).toBe(2);
    expect(spikeScene.installTrueTone()).toBe(true);
  });
});

describe('parity with the spike viewer', () => {
  it('has the same rigs, grey, colour parsing and body helpers', () => {
    expect(spikeScene.LIGHTING_RIGS).toEqual(LIGHTING_RIGS);
    expect(spikeScene.DEFAULT_BODY_HEX).toBe(DEFAULT_BODY_HEX);
    expect(spikeScene.frontIrradiance(spikeScene.LIGHTING_RIGS.neutral)).toEqual(frontIrradiance(LIGHTING_RIGS.neutral));
    for (const v of ['#A07E56', 'x', null]) expect(spikeScene.parseSkinHex(v)).toBe(parseSkinHex(v));
    const f = new spikeScene.Figure(tri(), Uint32Array.from([0, 1, 2]), 3, null);
    f.setSkin('#a07e56');
    expect(f.skinHex).toBe('#a07e56');
    expect(spikeBody.HEAD_SCALE_SHARE).toBe(HEAD_SCALE_SHARE);
    expect(spikeBody.NECK_TO_HEAD).toBe(NECK_TO_HEAD);
    expect(spikeScene.cameraFrame(60, 190, 0.5, 28)).toEqual(cameraFrame(60, 190, 0.5, 28));
    const a = buildTypedAvatar(m, { heightCm: 176, shoulderCm: 38, bust: 100 }, 'dress', { head: 'neutral' });
    const b = spikeBody.buildTypedAvatar(m, { heightCm: 176, shoulderCm: 38, bust: 100 }, 'dress', { head: 'neutral' });
    expect(b.garmentLiftCm).toBe(a.garmentLiftCm);
    expect(Array.from(b.avatar.mesh.positions)).toEqual(Array.from(a.avatar.mesh.positions));
    expect(Array.from(b.field.torso.data)).toEqual(Array.from(a.field.torso.data));
  });
});
