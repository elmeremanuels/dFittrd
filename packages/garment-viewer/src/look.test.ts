/**
 * The avatar look and `MountOptions.body` (plan slices 1 and 2): skin colour per figure, the
 * lighting rigs, the neutral head on the avatar, the family guard and the typed body. Pure logic
 * (no WebGL): what the pictures look like is in `spikes/garment-engine/viewer/avatar-renders.mjs`.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BASE_SHAPE_ID, bodyShape, buildBody, buildMannequin, buildMannequinMesh, familyShape, topology } from '@curtain/mannequin';
import { HEAD_SCALE_SHARE, IDENTITY_MORPH, bodyFamilyOf, bodyField, buildAvatar, buildTypedAvatar, bundleFamilyOf, girthInput, isTypedBody, liftField, makeCollider, mannequinMeasurements, sanitiseMeasurements } from './body';
import { meshFromGlb, type SpikeBundle } from './bundle';
import { sample } from './collide';
import { openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { DEFAULT_BODY_HEX, Figure, LIGHTING_RIGS, TRUE_TONE_GLSL, TRUE_TONE_START, frontIrradiance, meshGeometry, parseSkinHex, trueTone } from './scene';
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
    const a = buildTypedAvatar(m, { heightCm: 176, shoulderCm: 38, bust: 100 }, 'dress', { head: 'neutral' });
    const b = spikeBody.buildTypedAvatar(m, { heightCm: 176, shoulderCm: 38, bust: 100 }, 'dress', { head: 'neutral' });
    expect(b.garmentLiftCm).toBe(a.garmentLiftCm);
    expect(Array.from(b.avatar.mesh.positions)).toEqual(Array.from(a.avatar.mesh.positions));
    expect(Array.from(b.field.torso.data)).toEqual(Array.from(a.field.torso.data));
  });
});
