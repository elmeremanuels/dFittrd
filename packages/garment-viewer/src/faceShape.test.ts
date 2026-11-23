import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBody } from '@curtain/mannequin';
import {
  FACE_SHAPE_TARGETS,
  FACE_WEIGHT_LIMIT,
  clampFaceShape,
  decodeRealisticBody,
  fitRealisticBody,
  fitTargetOf,
  type FaceShapeWeights,
} from './realisticBody';
import { fitFaceShape, syntheticFaceLandmarks } from './faceShape';

const asset = decodeRealisticBody(readFileSync(new URL('../assets/realistic-body/female-v1.crb', import.meta.url)));

describe('faceShape (WO-020 / CUR-34)', () => {
  it('baked asset carries all 12 CC0 face targets and 26 symmetric face landmarks', () => {
    expect(asset.meta.faceTargetNames).toEqual(FACE_SHAPE_TARGETS);
    expect(asset.meta.faceTargetCounts?.length).toBe(12);
    for (const t of FACE_SHAPE_TARGETS) {
      expect(asset.faceTargets?.[t]?.ids.length).toBeGreaterThan(100);
    }
    expect(asset.meta.faceLandmarks).toBeDefined();
  });

  it('recovers neutral (zero) weights from the neutral synthetic face', () => {
    const lms = syntheticFaceLandmarks(asset, {});
    const res = fitFaceShape(lms, asset);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.similarity).toBeGreaterThan(0.99);
    for (const t of FACE_SHAPE_TARGETS) expect(Math.abs(res.weights[t])).toBeLessThan(0.02);
  });

  it('round-trips known multi-axis weights from synthetic landmarks (including roll and scale)', () => {
    const cases: { name: string; weights: FaceShapeWeights; rollDeg?: number; scale?: number }[] = [
      { name: 'wide jaw & prominent chin', weights: { jawWidth: 0.55, chinWidth: 0.5, chinProminence: 0.65, faceWidth: 0.35 }, rollDeg: 6, scale: 0.018 },
      { name: 'narrow oval & long nose', weights: { faceWidth: -0.35, faceHeight: 0.4, jawWidth: -0.5, noseLength: 0.6, noseWidth: -0.45 }, rollDeg: -8, scale: 0.028 },
      { name: 'high cheekbones, wide eyes & brows', weights: { cheekbones: 0.7, eyeSpacing: 0.6, browHeight: 0.65, lipWidth: 0.6 }, rollDeg: 4, scale: 0.021 },
      { name: 'short chin & compact lower face', weights: { chinHeight: -0.4, chinProminence: -0.5, noseLength: -0.5, noseWidth: 0.55, lipWidth: -0.5 } },
    ];
    for (const c of cases) {
      const lms = syntheticFaceLandmarks(asset, c.weights, { rollDeg: c.rollDeg, scale: c.scale });
      const res = fitFaceShape(lms, asset);
      expect(res.ok, c.name).toBe(true);
      if (!res.ok) continue;
      expect(res.similarity, `${c.name} similarity`).toBeGreaterThan(0.92);
      for (const [k, want] of Object.entries(c.weights)) {
        const got = res.weights[k as keyof typeof res.weights];
        expect(Math.abs(got - (want ?? 0)), `${c.name} · ${k}: want ${want}, got ${got}`).toBeLessThan(0.08);
      }
    }
  });

  it('clamps extreme/out-of-range landmarks and direct weights strictly to [-1, 1]', () => {
    const extreme: FaceShapeWeights = {
      faceWidth: 3.5,
      jawWidth: -4.0,
      noseLength: 5.0,
      lipWidth: -3.2,
      browHeight: 2.8,
      chinHeight: -3.0,
    };
    const direct = clampFaceShape({ ...extreme, chinWidth: Number.NaN, eyeSpacing: Infinity });
    for (const t of FACE_SHAPE_TARGETS) {
      expect(Math.abs(direct[t])).toBeLessThanOrEqual(FACE_WEIGHT_LIMIT);
    }
    expect(direct.chinWidth).toBe(0);
    expect(direct.eyeSpacing).toBe(0);

    const lms = syntheticFaceLandmarks(asset, extreme);
    const res = fitFaceShape(lms, asset);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const t of FACE_SHAPE_TARGETS) {
      expect(Math.abs(res.weights[t])).toBeLessThanOrEqual(FACE_WEIGHT_LIMIT);
    }
  });

  it('detects and refuses a smile and an open mouth', () => {
    const smiling = syntheticFaceLandmarks(asset, { cheekbones: 0.4 }, { smile: 0.14 });
    const rSmile = fitFaceShape(smiling, asset);
    expect(rSmile.ok).toBe(false);
    if (!rSmile.ok) expect(rSmile.reason).toBe('smile');

    const openMouth = syntheticFaceLandmarks(asset, {}, { mouthOpen: 0.09 });
    const rOpen = fitFaceShape(openMouth, asset);
    expect(rOpen.ok).toBe(false);
    if (!rOpen.ok) expect(rOpen.reason).toBe('smile');
  });

  it('refuses strongly turned or tilted heads and invalid landmark arrays', () => {
    const turned = syntheticFaceLandmarks(asset, {}, { yawDeg: 32 });
    const rTurn = fitFaceShape(turned, asset);
    expect(rTurn.ok).toBe(false);
    if (!rTurn.ok) expect(rTurn.reason).toBe('turned');

    const tilted = syntheticFaceLandmarks(asset, {}, { pitchDeg: 30 });
    const rTilt = fitFaceShape(tilted, asset);
    expect(rTilt.ok).toBe(false);
    if (!rTilt.ok) expect(rTilt.reason).toBe('tilted');

    const short = fitFaceShape([{ x: 0.5, y: 0.5 }], asset);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.reason).toBe('invalid_landmarks');
  });

  it('applying full-strength faceShape leaves all 12 body/arm rings within 0.5 % and body unchanged', () => {
    const m = buildBody({ family: 'female', heightCm: 168, bust: 92, waist: 74, hip: 100 });
    const target = fitTargetOf(m);
    const base = fitRealisticBody(asset, target);
    const shaped = fitRealisticBody(asset, target, {
      faceShape: {
        faceWidth: 1,
        faceHeight: 1,
        jawWidth: 1,
        chinWidth: 1,
        chinHeight: 1,
        chinProminence: 1,
        cheekbones: 1,
        noseLength: 1,
        noseWidth: 1,
        eyeSpacing: 1,
        browHeight: 1,
        lipWidth: 1,
      },
    });
    // Every body & arm ring stays within 0.5 % (and neck girth stays practically identical).
    for (const r of shaped.rings) {
      expect(r.errorPct, r.id).not.toBeNull();
      expect(Math.abs(r.errorPct!), r.id).toBeLessThan(0.5);
    }
    const baseNeck = base.rings.find((r) => r.id === 'neck')!.loopCm!;
    const shapedNeck = shaped.rings.find((r) => r.id === 'neck')!.loopCm!;
    expect(Math.abs(shapedNeck - baseNeck)).toBeLessThan(0.05);

    // Head vertices actually moved visibly (> 1 cm), while vertices below neck stayed identical.
    let headMaxDiff = 0, bodyMaxDiff = 0;
    const neckY = target.rings.find((r) => r.id === 'neck')!.centre[1];
    for (let i = 0; i < asset.meta.vertexCount; i++) {
      const d = Math.hypot(
        shaped.mesh.positions[3 * i]! - base.mesh.positions[3 * i]!,
        shaped.mesh.positions[3 * i + 1]! - base.mesh.positions[3 * i + 1]!,
        shaped.mesh.positions[3 * i + 2]! - base.mesh.positions[3 * i + 2]!,
      );
      if (base.mesh.positions[3 * i + 1]! > neckY + 4) headMaxDiff = Math.max(headMaxDiff, d);
      else if (base.mesh.positions[3 * i + 1]! < neckY - 2) bodyMaxDiff = Math.max(bodyMaxDiff, d);
    }
    expect(headMaxDiff).toBeGreaterThan(1.5);
    expect(bodyMaxDiff).toBeLessThan(0.05);
  });
});
