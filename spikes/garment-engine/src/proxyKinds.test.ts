/**
 * The other garment kinds end to end on the CPU side: control-proxy-0.3.0 features (sleeve style, outerwear front
 * opening), the synthetic garment of a skirt, trousers and an open cardigan (`syntheticGarmentFromProxy`), and the
 * per-type lengths (`bottomLengths`): outseam and inseam for trousers, waist to hem for a skirt.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, signedVolume, topology, type Mannequin } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { bottomLengths, garmentLengths } from './garmentLength';
import { shopProduct, type ResolvedProduct } from './product';
import { buildProxy, openingHalfWidth, sleeveForStyle, syntheticGarmentFromProxy } from './proxy';
import { boundaryLoops } from './stage4t';

const m: Mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
const productsJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic', 'products.json'), 'utf8')) as unknown;
const shop = (h: string): ResolvedProduct => shopProduct('bohohippychic', productsJson, h);
const proxyOf = (p: ResolvedProduct) => buildProxy(m, p.payload, p.baseSize, p.features ? { features: p.features } : {});

describe('control proxy 0.3.0: features', () => {
  it('gives the half-sleeved blouse sleeve shells to below the elbow (0.2.0: bare arms)', () => {
    const blouse = shop('rosewater-blouse');
    const { spec, mesh } = proxyOf(blouse);
    expect(spec.sleeveStyle).toBe('half');
    expect(spec.sleeveCm).toBeCloseTo(sleeveForStyle(m, 'half').cm, 6);
    expect(spec.sleeveCm).toBeGreaterThan(m.arms.left.upperArmCm);
    expect(spec.sleeveCm).toBeLessThan(m.morphHeights.wrist - 4);
    expect(mesh.partNames).toEqual(['body', 'sleeve_l', 'sleeve_r']);
    // Without the features the 0.2.0 proxy: no sleeve shells.
    expect(buildProxy(m, blouse.payload, blouse.baseSize).spec.sleeveCm).toBe(0);
  });

  it('opens the cardigan front as a V to the underbust, pushed into the mannequin, and keeps the shell closed', () => {
    const cardi = shop('woodstock-wanderer-knit-cardi');
    const { spec, mesh } = proxyOf(cardi);
    const o = spec.frontOpening!;
    expect(o).toMatchObject({ kind: 'v', neckline: 'deep-v', buttoned: true, bottomHalfWidthCm: 0 });
    expect(o.bottomY).toBeCloseTo(m.morphHeights.underbust, 6);
    const topo = topology(mesh);
    expect(topo.boundaryEdges).toBe(0);
    expect(signedVolume(Array.from(mesh.positions), Array.from(mesh.indices))).toBeGreaterThan(0);
    // Body vertices well inside the V lie inside the torso; those well outside it do not.
    let inside = 0, outsideMoved = 0;
    const P = mesh.positions;
    for (let v = 0; v < P.length / 3; v++) {
      if (mesh.vertexPart[v] !== 0) continue;
      const x = P[3 * v]!, y = P[3 * v + 1]!, z = P[3 * v + 2]!;
      const t = m.torsoAt(y);
      if (!t || z <= t.cz) continue;
      const half = openingHalfWidth(o, y);
      const r = Math.hypot((x - t.cx) / t.a, (z - t.cz) / t.b);
      if (half > 2 && Math.abs(x) < half - 1) {
        expect(r, `vertex ${v} at y ${y.toFixed(1)}`).toBeLessThan(1);
        inside++;
      } else if (half < 0 && r < 1) outsideMoved++;
    }
    expect(inside).toBeGreaterThan(20);
    expect(outsideMoved).toBe(0);
    // The skirt, the trousers and the dress get no opening.
    for (const h of ['crimson-wildflower-maxi-skirt', 'rosewater-palazzo-pants', 'azure-palm-baby-doll-dress']) expect(proxyOf(shop(h)).spec.frontOpening, h).toBeNull();
  });
});

describe('synthetic garments of the other kinds', () => {
  it('opens every tube: the skirt at the waist and the hem, the trousers at the waist and both hems, the cardigan down its V', () => {
    const loops = (h: string): number => boundaryLoops(syntheticGarmentFromProxy(m, shop(h).payload, shop(h).baseSize, shop(h).features ? { features: shop(h).features! } : {})).loops;
    expect(loops('crimson-wildflower-maxi-skirt')).toBe(2);
    // Seat (waist + crotch end) and two legs (top + hem each).
    expect(loops('rosewater-palazzo-pants')).toBe(6);
    // Body (neck/V + hem: the V joins the neckline into one loop) and two sleeves (two ends each).
    expect(loops('woodstock-wanderer-knit-cardi')).toBe(6);
    expect(() => syntheticGarmentFromProxy(m, shop('rosewater-blouse').payload, '12')).toThrow(/lofted/);
  });

  it('measures per type: trousers have an outseam and an inseam, a skirt a waist-to-hem and no inner leg', () => {
    const pants = shop('rosewater-palazzo-pants');
    const proxy = proxyOf(pants);
    const trousers = syntheticGarmentFromProxy(m, pants.payload, pants.baseSize);
    const t = Object.fromEntries(bottomLengths(m, trousers, true).map((d) => [d.definition, d]));
    // The proxy's top is 2 cm above the waist ring and its hem `outseam` (99 cm) below it.
    expect(t.outseam_drop!.lengthCm!).toBeCloseTo(99 + 2, 0);
    expect(t.outseam_side!.lengthCm!).toBeGreaterThanOrEqual(t.outseam_drop!.lengthCm! - 0.01);
    expect(t.outseam_side!.lengthCm!).toBeLessThan(t.outseam_drop!.lengthCm! + 5);
    expect(t.inseam_drop!.lengthCm!).toBeCloseTo(m.landmarks.crotch[1] - proxy.spec.hemY, 0);
    expect(t.inseam_inner!.lengthCm!).toBeGreaterThan(60);
    const sk = shop('crimson-wildflower-maxi-skirt');
    const skirt = syntheticGarmentFromProxy(m, sk.payload, sk.baseSize);
    const s = Object.fromEntries(bottomLengths(m, skirt, false).map((d) => [d.definition, d]));
    expect(s.waist_to_hem_front!.lengthCm!).toBeGreaterThan(90);
    expect(s.inseam_inner).toBeUndefined();
    // Read as trousers, the skirt has no inner leg: one closed volume.
    const asTrousers = Object.fromEntries(bottomLengths(m, skirt, true).map((d) => [d.definition, d]));
    expect(asTrousers.inseam_inner!.lengthCm).toBeNull();
    expect(asTrousers.inseam_inner!.note).toMatch(/not trousers/);
    // Tops keep the HPS definitions.
    const cardi = syntheticGarmentFromProxy(m, shop('woodstock-wanderer-knit-cardi').payload, 'S-M', { features: shop('woodstock-wanderer-knit-cardi').features! });
    expect(garmentLengths(m, cardi).find((d) => d.definition === 'hps_drop')!.lengthCm).toBeCloseTo(m.landmarks.hps[1] - proxyOf(shop('woodstock-wanderer-knit-cardi')).spec.hemY, 0);
  });
});
