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
import { chamfer, regionChamfer } from './chamfer';
import { clothInsideBody } from './eval';
import { maskIou, type Mask } from './evalPng';
import { distancesToMesh } from './meshDistance';
import { garmentSilhouette } from './evalView';
import { generateGarment } from './garment';
import { garmentSpec } from './product';
import { buildProxy } from './proxy';
import { boundaryLoops } from './stage4t';
import { fitTemplate, pushToClearance, renderPositions, SHOULDER_CAP, type FitViews, type TemplateFitResult } from './templateFit';
import { GARMENT_REGIONS, garmentRegion, PERTURBATIONS, perturbTemplate } from './templatePerturb';
import { cameraFromFrame, cleanMask, cleanupPixels, idMask, pixelsPerCm, rasterize, splitFrames, type PinholeCamera } from './views';

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

/** A 10 × 4.7 cm keyhole in the front panel between the underbust and the chest. */
const keyhole = (p: number[]): boolean => p[2]! > 0 && Math.abs(p[0]!) < 5 && p[1]! > m.morphHeights.underbust + 1 && p[1]! < m.morphHeights.chest - 1;
const withHole = (mesh: Mesh): Mesh => {
  const tris: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const c = [0, 1, 2].map((k) => mesh.indices[t + k]!);
    const centre = [0, 1, 2].map((d) => c.reduce((s, v) => s + mesh.positions[3 * v + d]!, 0) / 3);
    if (!keyhole(centre)) tris.push(...c);
  }
  return { ...mesh, indices: Uint32Array.from(tris) };
};

/**
 * Yields to the event loop between long synchronous steps: vitest's worker RPC times out when one
 * synchronous stretch outlasts its 60 s timer, which a fit plus four Chamfer passes did under the
 * root `pnpm check` (every workspace testing at once on 4 cores).
 */
/**
 * The top of an arm's cap (the v0 mannequin's shoulder bump, up and out from the joint): on the left
 * arm `joint + a·u`, where u points up-and-out; the right arm's u points the other way round (the same
 * formula lands at the inner side of its cap, x ≈ −15), so the right cap is the left one mirrored. And
 * the share of the left cap that the garment leaves visible from above and from up-and-out.
 */
const capTop = (side: 1 | -1 = 1): number[] => {
  const f = m.arms.left, a0 = m.armAt(0, 1)!.a;
  const p = [0, 1, 2].map((k) => f.joint[k]! + a0 * f.u[k]!);
  return [side * p[0]!, p[1]!, p[2]!];
};
const bareCapShare = (garment: Pick<Mesh, 'positions' | 'indices'>): number => {
  const T = capTop();
  const f = m.arms.left;
  let bare = 0, all = 0;
  for (const dir of [[0, 1, 0], f.u]) {
    const cam = cameraFromFrame({ index: 0, azimuthDeg: 0, position: [T[0]! + 60 * dir[0]!, T[1]! + 60 * dir[1]!, T[2]! + 60 * dir[2]!], lookAt: T as [number, number, number], up: [0, 0, -1], fovYDeg: 12 } as never, 96, 96);
    const r = rasterize(cam, [{ positions: body.positions, indices: body.indices, id: 1 }, { positions: garment.positions, indices: garment.indices, id: 2 }]);
    // A disc of about 4 cm radius round the cap top (fov 12° at 60 cm: 12.6 cm across 96 px).
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      if (Math.hypot(x - 47.5, y - 47.5) > 30) continue;
      const id = r.ids[y * 96 + x];
      if (!id) continue;
      all++;
      if (id === 1) bare++;
    }
  }
  return bare / Math.max(1, all);
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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

describe('mask clean-up in garment units', () => {
  it('keeps a 10 × 4.7 cm keyhole open at the production resolution (480 × 832) and at half of it', () => {
    const holed = withHole(truth);
    for (const [w, h] of [[480, 832], [240, 416]] as const) {
      const full = turntablePath(m, 'turntable_mid', { frames: 4 });
      const cam = cameraFromFrame(full.frames[0]!, w, h);
      const ppc = pixelsPerCm(cam);
      const px = cleanupPixels(ppc);
      const whole = visibleMask(cam, truth), open = visibleMask(cam, holed);
      let holePx = 0, kept = 0;
      const clean = cleanMask(open, ppc);
      for (let i = 0; i < whole.data.length; i++) if (whole.data[i] && !open.data[i]) {
        holePx++;
        if (!clean.data[i]) kept++;
      }
      // The keyhole is several times the noise threshold at both sizes, and the clean-up leaves it open
      // (the closing may eat a pixel or two of its rim).
      expect(holePx).toBeGreaterThan(3 * px.maxHoleArea);
      expect(kept / holePx).toBeGreaterThan(0.9);
    }
  });
  it('fills a hole of 2.5 × 2.5 cm (mask noise) and converts with the camera distance', () => {
    const cam = cameraFromFrame(path.frames[0]!, 480, 832);
    const ppc = pixelsPerCm(cam);
    const fx = cam.fy, d = Math.hypot(cam.centre[0], cam.centre[2]);
    expect(ppc).toBeCloseTo(fx / d, 6);
    const side = Math.round(2.5 * ppc);
    const data = new Uint8Array(480 * 832).fill(0);
    for (let y = 200; y < 600; y++) for (let x = 140; x < 340; x++) data[y * 480 + x] = 1;
    for (let y = 400; y < 400 + side; y++) for (let x = 240; x < 240 + side; x++) data[y * 480 + x] = 0;
    const clean = cleanMask({ width: 480, height: 832, data }, ppc);
    for (let y = 400; y < 400 + side; y++) for (let x = 240; x < 240 + side; x++) expect(clean.data[y * 480 + x]).toBe(1);
  });
});

describe('body SDF (mannequin.glb as closed parts)', () => {
  const sdf = buildBodySdf(body);
  it('pushToClearance moves a point inside the mannequin out to the clearance, not only one just outside it', () => {
    const t = m.torsoAt(110)!;
    const o = [t.cx, 110, t.cz], d = [0, 0, 1];
    const rays = [{ o, d }, { o, d }, { o, d }];
    // 3 cm inside the front surface, 0.1 cm outside it, and 2 cm outside it.
    const s = Float64Array.from([t.b - 3, t.b + 0.1, t.b + 2]);
    expect(sdf.at(o[0]!, o[1]!, o[2]! + s[0]!)).toBeLessThan(0);
    const r = pushToClearance(rays, s, [0, 1, 2], body, sdf, MIN_CLEARANCE_CM);
    expect([...r.pushed]).toEqual([1, 1, 0]);
    expect(r.inside).toBe(1);
    expect(r.unresolved).toBe(0);
    const pts = Float64Array.from([0, 1, 2].flatMap((i) => [o[0]!, o[1]!, o[2]! + s[i]!]));
    const dist = distancesToMesh(pts, body, 3);
    for (let i = 0; i < 3; i++) {
      expect(sdf.at(pts[3 * i]!, pts[3 * i + 1]!, pts[3 * i + 2]!)).toBeGreaterThan(0);
      expect(dist[i]!).toBeGreaterThanOrEqual(MIN_CLEARANCE_CM);
    }
    // Moved to the clearance, not far beyond it.
    expect(dist[0]!).toBeLessThan(MIN_CLEARANCE_CM + 0.2);
    expect(s[2]).toBe(t.b + 2);
  });
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

  it('finds the garment when the template is NOT the garment (perturbed proxy: girth, hem height, sleeves)', async () => {
    // The exported proxy is built from the same garment spec as the truth, so it starts about 0.3 to 0.6 cm
    // (Chamfer) from it and the test above shows little more than "the fit stays near a good start". Here the
    // template is 8 % wider, its hem 8 cm higher and its sleeves 10 % wider and 15 % shorter: the fit must
    // land as close to the truth as from the exported proxy, in every region.
    const bad = perturbTemplate(m, proxy, PERTURBATIONS[0]!);
    const region = garmentRegion(m);
    const before = chamfer(bad, truth, 30000);
    await tick();
    expect(before.chamferCmMean).toBeGreaterThan(1.2);
    const f = fitTemplate({ mannequin: m, body, proxy: bad, views: { cameras: cams, masks, train, holdout } });
    await tick();
    const after = chamfer(f.mesh, truth, 30000);
    const fromExported = chamfer(fit.mesh, truth, 30000);
    await tick();
    expect(after.chamferCmMean).toBeLessThan(0.8);
    expect(Math.abs(after.chamferCmMean - fromExported.chamferCmMean)).toBeLessThan(0.1);
    for (const r of regionChamfer(f.mesh, truth, GARMENT_REGIONS, region, 30000)) expect(r.chamferCmMean ?? Infinity).toBeLessThan(1.2);
    expect(clothInsideBody(m, f.mesh).share).toBe(0);
  }, 300_000);

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

  describe('the shoulder over the arm cap (CONTROL_CAP)', () => {
    // Run 14: the shop product gives no sleeve length, so its control proxy is sleeveless and ends at the
    // shoulder line; the v0 arm cap stands out above it and the generated video leaves a grey cap at the
    // outer shoulder top although the dress has puff sleeves. Same here: the truth with its cloth over the
    // left cap cut away (within 7 cm of the cap top), masks rendered from that. The very same masks are
    // what a cold-shoulder dress with sleeves gives: only the control tells the two apart.
    const T = capTop();
    const tris: number[] = [];
    for (let t = 0; t < truth.indices.length; t += 3) {
      const c = [0, 1, 2].map((k) => truth.indices[t + k]!);
      const centre = [0, 1, 2].map((d) => c.reduce((acc, v) => acc + truth.positions[3 * v + d]!, 0) / 3);
      if (Math.hypot(centre[0]! - T[0]!, centre[1]! - T[1]!, centre[2]! - T[2]!) > 7) tris.push(...c);
    }
    const bareTruth = { ...truth, indices: Uint32Array.from(tris) };
    const bareMasks = (): Mask[] => cams.map((c) => visibleMask(c, bareTruth));
    /** The control each frame would be generated from: control/mask (mannequin or proxy) and control/proxy_mask. */
    const controlOf = (ctlProxy: Pick<Mesh, 'positions' | 'indices'>): NonNullable<FitViews['control']> =>
      cams.map((c) => {
        const r = rasterize(c, [{ positions: body.positions, indices: body.indices, id: 1 }, { positions: ctlProxy.positions, indices: ctlProxy.indices, id: 2 }]);
        const proxyMask = idMask(r, 2);
        return { mannequin: { ...proxyMask, data: Uint8Array.from(r.ids, (id) => (id ? 1 : 0)) }, proxy: proxyMask };
      });
    /** The shop case: the product has no sleeve length, so the proxy has no sleeve shell. */
    const sleeveless = buildProxy(m, { ...payload, lengthCm: Object.fromEntries(Object.entries(payload.lengthCm ?? {}).filter(([k]) => k !== 'sleeve_length')) } as typeof payload, 'M', { shoulderToHemCm: garmentSpec(payload, 'M').shoulderToHemCm });

    it('the cut leaves the cap bare in the masks; without a control the fit follows the masks on the intact dress too', () => {
      expect(sleeveless.spec.sleeveCm).toBe(0);
      expect(buildProxy(m, payload, 'M', { shoulderToHemCm: garmentSpec(payload, 'M').shoulderToHemCm }).spec.sleeveCm).toBeGreaterThan(50);
      expect(bareCapShare(bareTruth)).toBeGreaterThan(0.9);
      // The synthetic dress itself lies inside the v0 arm's cap at its top (its sleeve starts at the joint
      // and the cap bulges through the shoulder): about 45 % of the disc shows the mannequin.
      const truthShare = bareCapShare(truth);
      expect(truthShare).toBeGreaterThan(0.3);
      // No control on the synthetic renders: the cap rows are carved like the rest and follow the masks
      // (a little more covered than the truth: the fit keeps the clearance).
      expect(fit.report.controlCap.views).toBe(0);
      expect(bareCapShare(fit.mesh)).toBeLessThan(truthShare);
      expect(bareCapShare(fit.mesh)).toBeGreaterThan(truthShare - 0.15);
    });

    it('covers the cap where the frames follow a sleeveless control that leaves it bare (run 14)', () => {
      const f = fitTemplate({ mannequin: m, body, proxy, views: { cameras: cams, masks: bareMasks(), train, holdout, control: controlOf(sleeveless.mesh) } });
      expect(f.report.controlCap.views).toBe(train.length);
      expect(f.report.controlCap.decidedCapRows).toBeGreaterThan(0);
      expect(bareCapShare(f.mesh)).toBeLessThan(0.02);
      expect(f.report.rays.shoulderCap).toBe(2 * SHOULDER_CAP.rows * f.report.parts[1]!.cols);
      expect(f.report.belowClearance).toBe(0);
      expect(f.report.rays.exactClearanceUnresolved).toBe(0);
    }, 300_000);

    it('leaves the cap open (cold shoulder) where nothing says the frames were told to show it bare', () => {
      // No control (frames that are renders or photos), and a control whose proxy has sleeves over the cap:
      // the frames' mannequin and background over the cap are evidence, as everywhere else.
      for (const control of [undefined, controlOf(proxy)]) {
        const f = fitTemplate({ mannequin: m, body, proxy, views: { cameras: cams, masks: bareMasks(), train, holdout, ...(control ? { control } : {}) } });
        // The sleeved proxy still leaves a sliver of the cap bare in the control (7 head rays decided there).
        if (!control) expect(f.report.controlCap.decided).toBe(0);
        expect(bareCapShare(f.mesh)).toBeGreaterThan(0.9);
      }
    }, 600_000);
  });

  it('carves an opening the masks show: a mask with a hole at the chest front gives a hole in the bodice', () => {
    // Same dress, but the front panel cut out between the underbust and the chest (a keyhole of 10 × 4.7 cm,
    // about 150 px at this half resolution, 600 px at 480 × 832): masks rendered from that truth, the fit
    // must not cover the hole where the mannequin is visible.
    const holed = withHole(truth);
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
