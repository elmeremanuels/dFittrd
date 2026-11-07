/**
 * Stage 4t on the other garment kinds (template fit 0.3.0), on synthetic masks of their synthetic garments: trousers
 * keep two legs and an inner leg only with one tube per leg (`legs`), a skirt's top edge is its waistband, and an open
 * cardigan keeps its V. 40 frames at half resolution; the full-size runs are in the README ("Other categories").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, turntablePath, type Mesh } from '@curtain/mannequin';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBodySdf } from './bodySdf';
import { chamfer } from './chamfer';
import { bottomLengths } from './garmentLength';
import { shopProduct, type ResolvedProduct } from './product';
import { buildProxy, openingHalfWidth, syntheticGarmentFromProxy } from './proxy';
import { fitTemplate, type TemplateFitResult } from './templateFit';
import { cameraFromFrame, idMask, rasterize, splitFrames, type PinholeCamera } from './views';

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const body = buildMannequinMesh(m);
const sdf = buildBodySdf(body);
const W = 240, H = 416, FRAMES = 40;
const cams: PinholeCamera[] = turntablePath(m, 'turntable_mid', { frames: FRAMES }).frames.map((f) => cameraFromFrame(f, W, H));
const { train, holdout } = splitFrames(FRAMES);
const productsJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic', 'products.json'), 'utf8')) as unknown;
const shop = (h: string): ResolvedProduct => shopProduct('bohohippychic', productsJson, h);
const opts = (p: ResolvedProduct) => (p.features ? { features: p.features } : {});
const masksOf = (g: Mesh) => cams.map((c) => idMask(rasterize(c, [{ positions: body.positions, indices: body.indices, id: 1 }, { positions: g.positions, indices: g.indices, id: 2 }]), 2));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('stage 4t: trousers', () => {
  const pants = shop('rosewater-palazzo-pants');
  const truth = syntheticGarmentFromProxy(m, pants.payload, pants.baseSize);
  // The template is the proxy at another size: the fit must not depend on starting at the truth.
  const template = buildProxy(m, pants.payload, '8').mesh;
  let legs: TemplateFitResult, oneTube: TemplateFitResult;
  beforeAll(async () => {
    const masks = masksOf(truth);
    legs = fitTemplate({ mannequin: m, body, sdf, proxy: template, views: { cameras: cams, masks, train, holdout }, options: { category: 'bottom', legs: true } });
    await tick();
    oneTube = fitTemplate({ mannequin: m, body, sdf, proxy: template, views: { cameras: cams, masks, train, holdout }, options: { category: 'bottom' } });
  }, 300_000);

  it('fits one tube per leg below the seat and recovers the shape', () => {
    expect(legs.report.legs).toEqual({ left: true, right: true, fitted: true });
    expect(legs.mesh.partNames).toEqual(['body', 'leg_l', 'leg_r']);
    expect(legs.report.insideBody).toBe(0);
    const c = chamfer(legs.mesh, truth);
    expect(c.chamferCmMean).toBeLessThan(1.5);
    const L = Object.fromEntries(bottomLengths(m, legs.mesh, true).map((d) => [d.definition, d.lengthCm]));
    const T = Object.fromEntries(bottomLengths(m, truth, true).map((d) => [d.definition, d.lengthCm]));
    expect(Math.abs(L.outseam_drop! - T.outseam_drop!)).toBeLessThan(3);
    expect(Math.abs(L.inseam_drop! - T.inseam_drop!)).toBeLessThan(3);
    expect(L.inseam_inner).not.toBeNull();
    // Texture charts for the legs.
    expect(Object.keys(legs.render.charts).sort()).toEqual(['body', 'leg_l', 'leg_r']);
  });

  it('as one tube round both legs (what a skirt is) it has no inner leg: the trousers became a skirt', () => {
    expect(oneTube.report.legs.fitted).toBe(false);
    const inner = bottomLengths(m, oneTube.mesh, true).find((d) => d.definition === 'inseam_inner')!;
    expect(inner.lengthCm).toBeNull();
    expect(chamfer(oneTube.mesh, truth).chamferCmMean).toBeGreaterThan(chamfer(legs.mesh, truth).chamferCmMean);
  });
});

describe('stage 4t: skirt and open cardigan', () => {
  it('fits the skirt from its waistband down and keeps the cardigan V open', async () => {
    const sk = shop('crimson-wildflower-maxi-skirt');
    const skirtTruth = syntheticGarmentFromProxy(m, sk.payload, sk.baseSize);
    const skirt = fitTemplate({ mannequin: m, body, sdf, proxy: buildProxy(m, sk.payload, '16').mesh, views: { cameras: cams, masks: masksOf(skirtTruth), train, holdout }, options: { category: 'bottom' } });
    expect(chamfer(skirt.mesh, skirtTruth).chamferCmMean).toBeLessThan(1);
    let top = -Infinity;
    for (let i = 1; i < skirt.mesh.positions.length; i += 3) top = Math.max(top, skirt.mesh.positions[i]!);
    // The waistband: the skirt's top edge within 3 cm of the truth's (2 cm above the waist ring), never up the torso.
    expect(Math.abs(top - (m.morphHeights.waist + 2))).toBeLessThan(3);
    await tick();

    const cd = shop('woodstock-wanderer-knit-cardi');
    const cardiProxy = buildProxy(m, cd.payload, cd.baseSize, opts(cd));
    const cardiTruth = syntheticGarmentFromProxy(m, cd.payload, cd.baseSize, opts(cd));
    const cardi = fitTemplate({ mannequin: m, body, sdf, proxy: buildProxy(m, cd.payload, 'M-L', opts(cd)).mesh, views: { cameras: cams, masks: masksOf(cardiTruth), train, holdout }, options: { category: 'outerwear' } });
    expect(cardi.report.sleeves.left && cardi.report.sleeves.right).toBe(true);
    const o = cardiProxy.spec.frontOpening!;
    // No fitted cloth in the middle of the V (more than 2 cm inside its edges) on the front: the opening stayed open.
    let inV = 0;
    const P = cardi.mesh.positions;
    for (let v = 0; v < P.length / 3; v++) {
      const x = P[3 * v]!, y = P[3 * v + 1]!, z = P[3 * v + 2]!;
      const half = openingHalfWidth(o, y);
      const t = m.torsoAt(y);
      if (half > 4 && t && z > t.cz && Math.abs(x) < half - 2) inV++;
    }
    expect(inV).toBe(0);
    expect(chamfer(cardi.mesh, cardiTruth).chamferCmMean).toBeLessThan(1);
  }, 300_000);
});
