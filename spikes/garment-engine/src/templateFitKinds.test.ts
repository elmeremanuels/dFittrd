/**
 * Stage 4t on the other garment kinds (template fit 0.3.0), on synthetic masks of their synthetic garments: trousers
 * keep two legs and an inner leg only with one tube per leg (`legs`), a skirt's top edge is its waistband, and an open
 * cardigan keeps its V. 40 frames at half resolution; the full-size runs are in the README ("Other categories").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, topology, turntablePath, type Mesh } from '@curtain/mannequin';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBodySdf } from './bodySdf';
import { chamfer } from './chamfer';
import { bottomLengths } from './garmentLength';
import { shopProduct, type ResolvedProduct } from './product';
import { buildProxy, openingHalfWidth, syntheticGarmentFromProxy } from './proxy';
import { boundaryLoops } from './stage4t';
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

/** Surfaces a ray from the centre plane between the legs (x 0, z 0, height y) towards the front crosses: odd = inside the cloth. */
function crossings(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }, y: number): number {
  const P = mesh.positions, I = mesh.indices;
  const o = [0, y, 0], d = [0, 0, 1];
  let n = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t]!, b = 3 * I[t + 1]!, c = 3 * I[t + 2]!;
    const e1 = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const e2 = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const p = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
    if (Math.abs(det) < 1e-12) continue;
    const s = [o[0]! - P[a]!, o[1]! - P[a + 1]!, o[2]! - P[a + 2]!];
    const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det;
    if (v < 0 || u + v > 1) continue;
    if ((e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det > 0) n++;
  }
  return n;
}

/** Boundary loops of a mesh with their height range. */
function boundaryLoopYs(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }): { minY: number; maxY: number }[] {
  const count = new Map<string, number>();
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = I[t + k]!, b = I[t + ((k + 1) % 3)]!;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const adj = new Map<number, number[]>();
  for (const [key, c] of count) if (c === 1) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const seen = new Set<number>();
  const out: { minY: number; maxY: number }[] = [];
  for (const s of adj.keys()) {
    if (seen.has(s)) continue;
    seen.add(s);
    const st = [s];
    let minY = Infinity, maxY = -Infinity;
    while (st.length) {
      const v = st.pop()!;
      minY = Math.min(minY, mesh.positions[3 * v + 1]!);
      maxY = Math.max(maxY, mesh.positions[3 * v + 1]!);
      for (const w of adj.get(v)!) if (!seen.has(w)) {
        seen.add(w);
        st.push(w);
      }
    }
    out.push({ minY, maxY });
  }
  return out;
}

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
    // Texture charts for the legs and the join band.
    expect(Object.keys(legs.render.charts).sort()).toEqual(['body', 'join', 'leg_l', 'leg_r']);
  });

  it('is one garment: the seat sewn to both legs at the join (template fit 0.4.0), no hole at the top of the inseam', () => {
    const j = legs.report.join!;
    expect(j.stitched).toBe(true);
    expect(j.thighsClear).toBe(true);
    expect(j.yCm).toBeLessThan(m.landmarks.crotch[1]);
    expect(j.seatTriangles).toBeGreaterThan(0);
    expect(j.crotchTriangles).toBeGreaterThan(0);
    expect(j.unoriented).toBe(0);
    expect(j.trianglesInsideBody).toBe(0);
    // Reported, not hidden: how far the garment's crotch lies below the body's, the band's slivers, and whether the legs cross.
    expect(j.belowBodyCrotchCm).toBeCloseTo(j.crotchCm - j.yCm, 1);
    expect(j.band!.seat.triangles).toBe(j.seatTriangles);
    expect(j.band!.crotch.triangles).toBe(j.crotchTriangles);
    expect(j.legOverlap!.slices).toBeGreaterThan(0);
    // The inseam bridges from where the inner leg starts (at the join, below the crotch) up to the crotch point: the note says
    // how much of it is the bridge and what the cloth alone measures.
    const inner = bottomLengths(m, legs.mesh, true).find((d) => d.definition === 'inseam_inner')!;
    expect(inner.note).toMatch(/of this inseam is the straight bridge, not cloth; the cloth inner leg from [\d.]+ cm to the hem is [\d.]+ cm/);
    const [bridge, cloth] = [/; bridged straight: ([\d.]+) cm/, /to the hem is ([\d.]+) cm/].map((re) => Number(re.exec(inner.note!)![1]));
    expect(bridge! + cloth!).toBeCloseTo(inner.lengthCm!, 1);
    const topo = topology(legs.mesh);
    expect(topo.components).toBe(1);
    expect(topo.nonManifoldEdges).toBe(0);
    expect(topo.inconsistentEdges).toBe(0);
    // A pair of pants: the waist and the two leg hems, plus here the crotch window the masks carve: the synthetic truth's
    // legs part at the crotch, so the front and back of the seat between the crotch and the join (where the mannequin's thighs
    // touch and the frames show them) are carved away. Run 17d's palazzo frames show cloth across there: 3 loops on it.
    const loops = boundaryLoopYs(legs.mesh);
    expect(loops.length).toBeGreaterThanOrEqual(3);
    expect(loops.filter((l) => l.minY > 100).length).toBe(1); // the waist
    expect(loops.filter((l) => l.maxY < 10).length).toBe(2); // the hems
    for (const l of loops.filter((x) => x.minY <= 100 && x.maxY >= 10)) {
      expect(l.minY).toBeGreaterThanOrEqual(j.yCm - 0.5);
      expect(l.maxY).toBeLessThanOrEqual(j.crotchCm + 0.5);
    }
    expect(boundaryLoops(legs.mesh).loops).toBe(loops.length);
    // No leg vertex was dropped as blocked by the other thigh (run 17d lost a wedge at the top of each inseam).
    expect(legs.report.rays.blocked).toBe(0);
    // The join band's render vertices map onto welded ones and carry UVs inside its own chart.
    const [u0, v0, u1, v1] = legs.render.charts.join!;
    let inJoin = 0;
    for (let k = 0; k < legs.render.uvs.length / 2; k++) {
      const u = legs.render.uvs[2 * k]!, v = legs.render.uvs[2 * k + 1]!;
      if (v >= v0 - 1e-6 && v <= v1 + 1e-6) {
        expect(u).toBeGreaterThanOrEqual(u0 - 1e-6);
        expect(u).toBeLessThanOrEqual(u1 + 1e-6);
        inJoin++;
      }
    }
    expect(inJoin).toBe(3 * (j.seatTriangles + j.crotchTriangles));
  });

  it('as one tube round both legs (what a skirt is) it has no inner leg: the trousers became a skirt', () => {
    expect(oneTube.report.legs.fitted).toBe(false);
    const inner = bottomLengths(m, oneTube.mesh, true).find((d) => d.definition === 'inseam_inner')!;
    expect(inner.lengthCm).toBeNull();
    // A skirt has cloth in front of the gap between the legs; trousers do not. This used to be checked by the Chamfer (one
    // tube further from the truth than the leg tubes), which held only because the one tube's hem scan stopped at the crotch
    // over the gap and left a slit up the front and back: no skirt either. With the hem scan passing openings (`OPENING`) the
    // one tube is a closed skirt, and a closed skirt round these wide palazzo legs is closer to them by Chamfer (0.93 against
    // 0.996 cm), so the check is now the gap itself, 20 to 45 cm below the crotch. Nothing chooses the kind by Chamfer: the
    // legs fit comes from the proxy kind (`stage4t` `fit.legs = kind === 'trousers'`) and does not run the body hem scan, so
    // `OPENING` cannot change it; the legs fit's own bound is the Chamfer < 1.5 cm above.
    const cy = m.landmarks.crotch[1];
    for (const d of [20, 30, 45]) {
      expect(crossings(truth, cy - d)).toBe(0);
      expect(crossings(legs.mesh, cy - d)).toBe(0);
      expect(crossings(oneTube.mesh, cy - d)).toBeGreaterThan(0);
    }
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
