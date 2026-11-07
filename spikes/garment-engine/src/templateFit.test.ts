/**
 * Stage 4t fitting maths on synthetic data: the spike's synthetic shirt dress (`aalter-studio-2`,
 * long sleeves) rendered into garment masks with known cameras, fitted from its control proxy, and
 * compared with the truth. Stage 4's 2DGS + TSDF reached a Chamfer distance of 1.45 cm on the same
 * garment (160 frames at 480 × 832, docs/STATUS.md); this test uses 60 frames at half resolution.
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath, type Mesh } from '@curtain/mannequin';
import { mockGarment } from '@curtain/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBodySdf, MIN_CLEARANCE_CM } from './bodySdf';
import { chamfer } from './chamfer';
import { clothInsideBody } from './eval';
import { maskIou, type Mask } from './evalPng';
import { garmentSilhouette } from './evalView';
import { generateGarment } from './garment';
import { garmentSpec } from './product';
import { buildProxy } from './proxy';
import { boundaryLoops } from './stage4t';
import { fitTemplate, renderPositions, type TemplateFitResult } from './templateFit';
import { cameraFromFrame, idMask, rasterize, splitFrames, type PinholeCamera } from './views';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const body = buildMannequinMesh(m);
const W = 240, H = 416, FRAMES = 60;
const path = turntablePath(m, 'turntable_mid', { frames: FRAMES });
const cams: PinholeCamera[] = path.frames.map((f) => cameraFromFrame(f, W, H));
const payload = mockGarment('aalter-studio-2');
const truth: Mesh = generateGarment(m, garmentSpec(payload, 'M'));
const visibleMask = (cam: PinholeCamera, garment: Pick<Mesh, 'positions' | 'indices'>): Mask =>
  idMask(rasterize(cam, [{ positions: body.positions, indices: body.indices, id: 1 }, { positions: garment.positions, indices: garment.indices, id: 2 }]), 2);
const masks = cams.map((c) => visibleMask(c, truth));
const { train, holdout } = splitFrames(FRAMES);
/** The synthetic stills' proxy: hem at the synthetic garment's (vertical) length, as the exporter passes it. */
const proxy = buildProxy(m, payload, 'M', { shoulderToHemCm: garmentSpec(payload, 'M').shoulderToHemCm }).mesh;

let fit: TemplateFitResult;
beforeAll(() => {
  fit = fitTemplate({ mannequin: m, body, proxy, views: { cameras: cams, masks, train, holdout } });
}, 300_000);

describe('pinhole cameras', () => {
  it('cameraFromFrame gives the same pixels as the evaluation rasteriser (raster.ts, turntablePath)', () => {
    for (const k of [0, 15, 33]) {
      const ours = rasterize(cams[k]!, [{ positions: body.positions, indices: body.indices, id: 1 }]);
      const theirs = garmentSilhouette(null, body, path.frames[k]!, W, H);
      expect(maskIou(idMask(ours, 1), theirs).iou).toBeGreaterThan(0.995);
    }
  });
});

describe('body SDF (mannequin.glb as closed parts)', () => {
  const sdf = buildBodySdf(body);
  it('is the distance to the torso surface within 0.05 cm near it, negative inside', () => {
    const t = m.torsoAt(110)!;
    for (const d of [-1, -0.4, 0.4, 1, 1.5]) {
      expect(sdf.at(t.a + d, 110, 0)).toBeCloseTo(d, 1);
      expect(sdf.at(0, 110, t.b + d)).toBeCloseTo(d, 1);
    }
    expect(sdf.at(0, 110, 0)).toBeLessThan(0);
    expect(sdf.at(0, 110, 40)).toBeGreaterThan(1);
  });
  it('is negative inside an arm that overlaps the torso (union of parts, not the nearest part)', () => {
    const a = m.arms.left;
    expect(sdf.at(a.joint[0] + a.axis[0] * 3, a.joint[1] + a.axis[1] * 3, 0)).toBeLessThan(0);
    expect(sdf.at(a.joint[0] + a.axis[0] * 20, a.joint[1] + a.axis[1] * 20, 0)).toBeLessThan(0);
  });
});

describe('template fit on the synthetic dress', () => {
  it('beats the 2DGS reconstruction of the same garment (Chamfer 1.45 cm) by a wide margin', () => {
    const c = chamfer(fit.mesh, truth, 30000);
    expect(c.chamferCmMean).toBeLessThan(1.45);
    expect(c.chamferCmMean).toBeLessThan(0.8);
    expect(c.fscore2cm).toBeGreaterThan(0.9);
  });

  it('keeps every vertex at least the clearance outside the mannequin (signed distance) and none inside by the evaluation test', () => {
    const sdf = buildBodySdf(body);
    let below = 0;
    for (let i = 0; i < fit.mesh.positions.length; i += 3) if (sdf.at(fit.mesh.positions[i]!, fit.mesh.positions[i + 1]!, fit.mesh.positions[i + 2]!) < MIN_CLEARANCE_CM - 0.05) below++;
    expect(below).toBe(0);
    expect(fit.report.belowClearance).toBe(0);
    expect(clothInsideBody(m, fit.mesh).share).toBe(0);
  });

  it('matches the held-out silhouettes and converges', () => {
    const ious = holdout.map((v) => maskIou(visibleMask(cams[v]!, fit.mesh), masks[v]!).iou);
    expect(Math.min(...ious)).toBeGreaterThan(0.93);
    expect(ious.reduce((a, b) => a + b, 0) / ious.length).toBeGreaterThan(0.96);
    expect(fit.report.converged).toBe(true);
    expect(fit.report.silhouetteRounds.length).toBeGreaterThan(0);
  });

  it('is a clean open mesh in the triangle budget: manifold, consistently oriented, body + two sleeves', () => {
    const t = fit.mesh.indices.length / 3;
    expect(t).toBeGreaterThanOrEqual(8000);
    expect(t).toBeLessThanOrEqual(15000);
    expect(fit.report.sleeves.left && fit.report.sleeves.right).toBe(true);
    expect(fit.mesh.partNames).toEqual(['body', 'sleeve_l', 'sleeve_r']);
    const loops = boundaryLoops(fit.mesh);
    expect(loops.loops).toBeGreaterThanOrEqual(3);
    // Every edge is used once (an opening) or twice (inside the surface), never more.
    const count = new Map<string, number>();
    const I = fit.mesh.indices;
    for (let k = 0; k < I.length; k += 3) for (let e = 0; e < 3; e++) {
      const a = I[k + e]!, b = I[k + ((e + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    expect(Math.max(...count.values())).toBeLessThanOrEqual(2);
  });

  it('finds the hem and the cuffs of the truth (lowest point and sleeve end within 2 cm)', () => {
    const lowest = (mesh: Pick<Mesh, 'positions'>): number => {
      let y = Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) if (Math.abs(mesh.positions[i]!) < 15) y = Math.min(y, mesh.positions[i + 1]!);
      return y;
    };
    expect(Math.abs(lowest(fit.mesh) - lowest(truth))).toBeLessThan(2);
    const cuff = fit.report.parts.find((p) => p.name === 'sleeve_l')!.hemOrCuff!;
    expect(Math.abs(cuff.mean - garmentSpec(payload, 'M').sleeveCm)).toBeLessThan(2.5);
  });

  it('carries cylindrical UVs per part on a render copy that maps back onto the welded mesh', () => {
    const r = fit.render;
    expect(r.uvs.length / 2).toBe(r.remap.length);
    expect(r.positions.length / 3).toBe(r.remap.length);
    for (const u of r.uvs) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
    const back = renderPositions(r, fit.mesh.positions);
    for (let i = 0; i < back.length; i++) expect(back[i]).toBe(r.positions[i]);
    expect(r.indices.length).toBe(fit.mesh.indices.length);
  });

  it('carves an opening the masks show: a mask with a hole at the chest front gives a hole in the bodice', () => {
    // Same dress, but the front panel cut out between the underbust and the chest (a keyhole): masks
    // rendered from that truth, the fit must not cover the hole where the mannequin is visible.
    const hole = (p: number[]): boolean => p[2]! > 0 && Math.abs(p[0]!) < 5 && p[1]! > m.morphHeights.underbust + 1 && p[1]! < m.morphHeights.chest - 1;
    const tris: number[] = [];
    for (let t = 0; t < truth.indices.length; t += 3) {
      const c = [0, 1, 2].map((k) => truth.indices[t + k]!);
      const centre = [0, 1, 2].map((d) => c.reduce((s, v) => s + truth.positions[3 * v + d]!, 0) / 3);
      if (!hole(centre)) tris.push(...c);
    }
    const holed = { ...truth, indices: Uint32Array.from(tris) };
    const hm = cams.map((c) => visibleMask(c, holed));
    const f = fitTemplate({ mannequin: m, body, proxy, views: { cameras: cams, masks: hm, train, holdout } });
    let inHole = 0;
    for (let i = 0; i < f.mesh.positions.length; i += 3) {
      const p = [f.mesh.positions[i]!, f.mesh.positions[i + 1]!, f.mesh.positions[i + 2]!];
      if (p[2]! > 0 && Math.abs(p[0]!) < 3 && p[1]! > m.morphHeights.underbust + 2.5 && p[1]! < m.morphHeights.chest - 2.5) inHole++;
    }
    expect(inHole).toBe(0);
  }, 300_000);
});
