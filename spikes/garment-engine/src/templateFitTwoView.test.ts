/**
 * The predicted route's two-view fit (docs/PREDICTION-ENGINE.md §4.5, V0): stage 4t from the front and
 * back views only (frames 0 and N/2), with the template's depth (`depthPrior: 'template'`). The synthetic
 * shirt dress (`aalter-studio-2`) at 60 frames and half resolution, fitted from a template that is NOT
 * the garment (8 % wider, hem 8 cm higher: `PERTURBATIONS[0]`).
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath, type Mesh } from '@curtain/mannequin';
import { mockGarment } from '@curtain/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { chamfer } from './chamfer';
import { clothInsideBody } from './eval';
import { maskIou, type Mask } from './evalPng';
import { generateGarment } from './garment';
import { garmentSpec } from './product';
import { buildProxy } from './proxy';
import { stage4tSplit } from './stage4t';
import { fitTemplate, type TemplateFitResult } from './templateFit';
import { PERTURBATIONS, perturbTemplate } from './templatePerturb';
import { cameraFromFrame, idMask, rasterize, type PinholeCamera } from './views';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const body = buildMannequinMesh(m);
const W = 240, H = 416, FRAMES = 60;
const cams: PinholeCamera[] = turntablePath(m, 'turntable_mid', { frames: FRAMES }).frames.map((f) => cameraFromFrame(f, W, H));
const payload = mockGarment('aalter-studio-2');
const truth: Mesh = generateGarment(m, garmentSpec(payload, 'M'));
const visibleMask = (cam: PinholeCamera, g: Pick<Mesh, 'positions' | 'indices'>): Mask =>
  idMask(rasterize(cam, [{ positions: body.positions, indices: body.indices, id: 1 }, { positions: g.positions, indices: g.indices, id: 2 }]), 2);
const masks = cams.map((c) => visibleMask(c, truth));
const proxy = buildProxy(m, payload, 'M', { shoulderToHemCm: garmentSpec(payload, 'M').shoulderToHemCm }).mesh;
const bad = perturbTemplate(m, proxy, PERTURBATIONS[0]!);
const { train, holdout } = stage4tSplit(FRAMES, [0, FRAMES / 2]);

let withTemplate: TemplateFitResult;
let withHull: TemplateFitResult;
beforeAll(() => {
  const views = { cameras: cams, masks, train, holdout };
  withTemplate = fitTemplate({ mannequin: m, body, proxy: bad, views, options: { depthPrior: 'template' } });
  withHull = fitTemplate({ mannequin: m, body, proxy: bad, views, options: { depthPrior: 'hull' } });
}, 300_000);

describe('stage4tSplit', () => {
  it('fits from the given frames and keeps the turntable holdout (index mod 5 = 2) minus them', () => {
    const s = stage4tSplit(160, [80, 0]);
    expect(s.train).toEqual([0, 80]);
    expect(s.holdout).toHaveLength(32);
    expect(s.holdout.every((v) => v % 5 === 2)).toBe(true);
    expect(stage4tSplit(10, [2]).holdout).toEqual([7]);
    expect(() => stage4tSplit(160, [160])).toThrow();
  });
});

describe('two-view fit with the template depth', () => {
  it('lands within 2 cm Chamfer of the truth (G1 V0) from a wrong template, closer than the template itself', () => {
    const before = chamfer(bad, truth, 30000).chamferCmMean;
    const after = chamfer(withTemplate.mesh, truth, 30000).chamferCmMean;
    expect(after).toBeLessThan(2);
    expect(after).toBeLessThan(before);
  });

  it('beats the turntable fit run unchanged on two views, whose depth runs out towards the cameras', () => {
    expect(chamfer(withTemplate.mesh, truth, 30000, 0, 4).chamferCmMean).toBeLessThan(chamfer(withHull.mesh, truth, 30000, 0, 4).chamferCmMean);
  });

  it('narrows the 8 % wider template to the width the masks show and keeps the cloth outside the mannequin', () => {
    const r = withTemplate.report.twoView!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.depthAxis[2])).toBeGreaterThan(0.95);
    const bodyPart = r.parts.find((p) => p.name === 'body')!;
    expect(bodyPart.measuredPlus).toBeGreaterThan(0);
    expect(bodyPart.scale.median).toBeLessThan(1);
    expect(withTemplate.report.options.tau).toBe(0);
    expect(withHull.report.twoView).toBeNull();
    expect(clothInsideBody(m, withTemplate.mesh).share).toBe(0);
  });

  it('matches the side views it never saw better than the template does', () => {
    const iou = (g: Pick<Mesh, 'positions' | 'indices'>): number => holdout.reduce((s, v) => s + maskIou(visibleMask(cams[v]!, g), masks[v]!).iou, 0) / holdout.length;
    expect(iou(withTemplate.mesh)).toBeGreaterThan(iou(bad));
  });
});
