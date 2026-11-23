/**
 * Polar outlines of the fitted realistic body (WO-016 iteration 1, CUR-9, OI-143): the collider
 * meets the drawn body, not the ellipse round it. The fitted mesh is sliced by horizontal planes
 * (torso, legs) and by planes perpendicular to the arm axis (arms), and each closed section is
 * turned into a polar outline about its centroid.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBody, polarRadius } from '@curtain/mannequin';
import { buildPomDressBundle } from '../../../spikes/garment-engine/src/pomDressBundle';
import { SYNTHETIC_DRESS_ID, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE, SYNTHETIC_TAPE_DRESS } from '../../../spikes/garment-engine/src/pomDressSynthetic';
import { fitRealisticBody, fitTargetOf, realisticOutlinesOf, decodeRealisticBody, type RealisticArmFrame } from './realisticBody';
import { bodyField, IDENTITY_MORPH, makeCollider } from './body';
import { loadBundleFrom, type FetchLike } from './bundle';
import { samplePolar } from './collide';
import { openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';
import { planAvatar } from './mount';

const FILE = new URL('../assets/realistic-body/female-v1.crb', import.meta.url);
const asset = decodeRealisticBody(readFileSync(FILE));

/** The spike's five test bodies (female, cm). Same set as realisticBody.test.ts. */
const BODIES = {
  slim: { heightCm: 164, bust: 80, waist: 62, hip: 88 },
  mid: { heightCm: 168, bust: 92, waist: 74, hip: 100 },
  full: { heightCm: 170, bust: 116, waist: 98, hip: 122 },
  tall: { heightCm: 182, bust: 92, waist: 74, hip: 100 },
  petite: { heightCm: 152, bust: 84, waist: 66, hip: 92 },
} as const;

/** Girth of a polar outline at a station (the integral of the radius around the circle). */
const polarGirth = (o: { cx: number; cz: number; r: Float64Array } | null): number => {
  if (!o) return Number.NaN;
  const n = o.r.length;
  let l = 0;
  for (let j = 0; j < n; j++) {
    const a = (2 * Math.PI * j) / n, b = (2 * Math.PI * ((j + 1) % n)) / n;
    l += Math.hypot(o.r[j]! * Math.cos(a) - o.r[(j + 1) % n]! * Math.cos(b), o.r[j]! * Math.sin(a) - o.r[(j + 1) % n]! * Math.sin(b));
  }
  return l;
};

describe('realisticOutlinesOf (WO-016 iter 1)', () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: the torso outline at the chest and hip rings carries a closed polar section whose girth matches the fitted mesh's tape within 3 cm`, () => {
      const target = fitTargetOf(buildBody({ family: 'female', ...body }));
      const fit = fitRealisticBody(asset, target);
      // Arms: use the target's arm frames. The realistic mesh's arms lie along the fitted frames.
      const wristRing = target.rings.find((r) => r.id === 'wrist')!;
      const arms: RealisticArmFrame[] = [
        { side: 1, joint: target.arms.left.joint, axis: target.arms.left.axis, lengthCm: Math.hypot(wristRing.centre[0] - target.arms.left.joint[0], wristRing.centre[1] - target.arms.left.joint[1], wristRing.centre[2] - target.arms.left.joint[2]) },
        { side: -1, joint: target.arms.right.joint, axis: target.arms.right.axis, lengthCm: Math.hypot(wristRing.centre[0] - target.arms.right.joint[0], wristRing.centre[1] - target.arms.right.joint[1], wristRing.centre[2] - target.arms.right.joint[2]) },
      ];
      const outlines = realisticOutlinesOf(fit.mesh, target.statureCm, target.crotchY, arms);
      const chestY = target.rings.find((r) => r.id === 'chest')!.centre[1];
      const hipY = target.rings.find((r) => r.id === 'hip')!.centre[1];
      const chestOutline = outlines.torso(chestY);
      const hipOutline = outlines.torso(hipY);
      expect(chestOutline).not.toBeNull();
      expect(hipOutline).not.toBeNull();
      // Every radius is positive: the centroid lies inside the closed section.
      for (const r of chestOutline!.r) expect(r, 'chest radius > 0').toBeGreaterThan(0);
      for (const r of hipOutline!.r) expect(r, 'hip radius > 0').toBeGreaterThan(0);
      // Polar girth vs the mesh's tape girth at the ring: within 3 cm (the convex hull of a
      // section is slightly longer than the polar perimeter; 3 cm is the loose bound for every
      // body).
      const chestTape = fit.rings.find((r) => r.id === 'chest')!.tapeCm!;
      const hipTape = fit.rings.find((r) => r.id === 'hip')!.tapeCm!;
      expect(Math.abs(polarGirth(chestOutline) - chestTape)).toBeLessThan(3);
      expect(Math.abs(polarGirth(hipOutline) - hipTape)).toBeLessThan(3);
      // The front radius is smaller than the depth (the chest is wider than deep): phi = 0 is +X (left), phi = π/2 is +Z (front).
      const phiFront = Math.PI / 2;
      const phiSide = 0;
      expect(polarRadius(chestOutline!.r, phiFront)).toBeLessThan(polarRadius(chestOutline!.r, phiSide) * 1.6);
      // Outside the torso: null.
      expect(outlines.torso(-1)).toBeNull();
      expect(outlines.torso(target.statureCm + 1)).toBeNull();
    });
  }

  it('legs: null above the crotch, a closed section below', () => {
    const target = fitTargetOf(buildBody({ family: 'female', ...BODIES.mid }));
    const fit = fitRealisticBody(asset, target);
    const wristRing = target.rings.find((r) => r.id === 'wrist')!;
    const arms: RealisticArmFrame[] = [
      { side: 1, joint: target.arms.left.joint, axis: target.arms.left.axis, lengthCm: Math.hypot(wristRing.centre[0] - target.arms.left.joint[0], wristRing.centre[1] - target.arms.left.joint[1], wristRing.centre[2] - target.arms.left.joint[2]) },
      { side: -1, joint: target.arms.right.joint, axis: target.arms.right.axis, lengthCm: Math.hypot(wristRing.centre[0] - target.arms.right.joint[0], wristRing.centre[1] - target.arms.right.joint[1], wristRing.centre[2] - target.arms.right.joint[2]) },
    ];
    const outlines = realisticOutlinesOf(fit.mesh, target.statureCm, target.crotchY, arms);
    expect(outlines.leg(target.crotchY + 5, 1)).toBeNull();
    const thighY = target.rings.find((r) => r.id === 'thigh')!.centre[1];
    const thighLeft = outlines.leg(thighY, 1);
    const thighRight = outlines.leg(thighY, -1);
    expect(thighLeft).not.toBeNull();
    expect(thighRight).not.toBeNull();
    for (const r of thighLeft!.r) expect(r).toBeGreaterThan(0);
    for (const r of thighRight!.r) expect(r).toBeGreaterThan(0);
  });

  it('the collider uses the realistic outlines when passed: a point in front of the hip, between the drawn body and the ellipse round it, stays where it is', () => {
    // The mid body's hip ring: the ellipse (symmetric in front and back) reaches farther in front
    // than the drawn body (the seat lies behind, not in front). The polar outline follows the
    // drawn surface. A point at (x=0, y=hip, z=hipCentre.z + frontRadius + 1 cm) lies:
    //   - inside the ellipse (the collider pushes it out);
    //   - outside the realistic outline (the collider leaves it alone).
    const target = fitTargetOf(buildBody({ family: 'female', ...BODIES.mid }));
    const fit = fitRealisticBody(asset, target);
    const wristRing = target.rings.find((r) => r.id === 'wrist')!;
    const arms: RealisticArmFrame[] = [
      { side: 1, joint: target.arms.left.joint, axis: target.arms.left.axis, lengthCm: Math.hypot(wristRing.centre[0] - target.arms.left.joint[0], wristRing.centre[1] - target.arms.left.joint[1], wristRing.centre[2] - target.arms.left.joint[2]) },
      { side: -1, joint: target.arms.right.joint, axis: target.arms.right.axis, lengthCm: Math.hypot(wristRing.centre[0] - target.arms.right.joint[0], wristRing.centre[1] - target.arms.right.joint[1], wristRing.centre[2] - target.arms.right.joint[2]) },
    ];
    const outlines = realisticOutlinesOf(fit.mesh, target.statureCm, target.crotchY, arms);
    const m = buildBody({ family: 'female', ...BODIES.mid });
    const hipRing = target.rings.find((r) => r.id === 'hip')!;
    const ellipse = m.torsoAt(hipRing.centre[1])!;
    const polar = outlines.torso(hipRing.centre[1])!;
    const frontRadius = polarRadius(polar.r, Math.PI / 2);
    // Sanity check: the ellipse reaches farther in front than the drawn body.
    expect(ellipse.b - frontRadius).toBeGreaterThan(1);
    // A point just outside the drawn body, well inside the ellipse.
    const p = Float32Array.from([0, hipRing.centre[1], hipRing.centre[2] + frontRadius + 0.5]);
    const ellipseCheck = (p[2]! - ellipse.cz) / ellipse.b;
    expect(ellipseCheck).toBeLessThan(1);
    // The procedural collider (no outlines) pushes the point out to the ellipse.
    const procedural = makeCollider(bodyField(m, IDENTITY_MORPH), 0.35, new Uint8Array(1));
    const pProcedural = Float32Array.from(p);
    expect(procedural(pProcedural, 0)).toBe(true);
    // The realistic collider leaves the point where it is: it lies outside the drawn body.
    const realistic = makeCollider(bodyField(m, IDENTITY_MORPH, 0.5, outlines), 0.35, new Uint8Array(1));
    const pRealistic = Float32Array.from(p);
    expect(realistic(pRealistic, 0)).toBe(false);
    expect(pRealistic[2]).toBeCloseTo(p[2]!, 3);
  });

  it('legs preserve opposite-sign real centroids, torso is null below the crotch, and arms reach the wrist', () => {
    const m = buildBody({ family: 'female', ...BODIES.mid });
    const target = fitTargetOf(m);
    const fit = fitRealisticBody(asset, target);
    const lArm = m.arms.left, rArm = m.arms.right;
    const armLen = lArm.upperArmCm + lArm.forearmCm + 0.85 * lArm.handCm;
    const arms: RealisticArmFrame[] = [
      { side: 1, joint: [...lArm.joint], axis: [...lArm.axis], u: [...lArm.u], v: [...lArm.v], lengthCm: armLen },
      { side: -1, joint: [...rArm.joint], axis: [...rArm.axis], u: [...rArm.u], v: [...rArm.v], lengthCm: armLen },
    ];
    const outlines = realisticOutlinesOf(fit.mesh, target.statureCm, target.crotchY, arms, undefined, asset.armWeight);
    // Legs sit on opposite sides of x = 0 (regression for iter-1 zeroed centroids and `side * 0`).
    const thighY = target.rings.find((r) => r.id === 'thigh')!.centre[1];
    const leftThigh = outlines.leg(thighY, 1)!;
    const rightThigh = outlines.leg(thighY, -1)!;
    expect(leftThigh.cx).toBeGreaterThan(4);
    expect(rightThigh.cx).toBeLessThan(-4);
    expect(leftThigh.cx + rightThigh.cx).toBeCloseTo(0, 1);
    // Torso does not grab a leg below the crotch.
    expect(outlines.torso(target.crotchY - 4)).toBeNull();
    // Every torso skin vertex is enclosed by the polar outline (vertex-envelope pass).
    let maxOver = 0;
    for (let i = 0; i < fit.mesh.positions.length / 3; i++) {
      const y = fit.mesh.positions[3 * i + 1]!;
      if (y < target.crotchY || asset.armWeight[i]! > 0.35) continue;
      const s = outlines.torso(y);
      if (!s) continue;
      const dx = fit.mesh.positions[3 * i]! - s.cx;
      const dz = fit.mesh.positions[3 * i + 2]! - s.cz;
      const rTab = polarRadius(s.r, Math.atan2(dz, dx));
      maxOver = Math.max(maxOver, Math.hypot(dx, dz) - rTab);
    }
    expect(maxOver).toBeLessThan(0.05);
    // Both arms have closed outlines at upper arm, forearm and wrist.
    const wristS = lArm.upperArmCm + lArm.forearmCm;
    for (const side of [1, -1] as const) {
      for (const s of [15, 35, wristS]) {
        const a = outlines.arm(s, side);
        expect(a, `arm side=${side} s=${s}`).not.toBeNull();
        expect(Math.min(...a!.r)).toBeGreaterThan(1);
      }
    }
  });

  it('outlinesPreScaled prevents double-scaling polar outlines on a morphed non-typed body', () => {
    const plan0 = planAvatar({ category: 'dress' }, { bust: 116, waist: 98, hip: 122 });
    const target = fitTargetOf(plan0.drawn, plan0.avatar.rings, plan0.drawnScaleAt);
    const fit = fitRealisticBody(asset, target);
    const lArm = plan0.drawn.arms.left, rArm = plan0.drawn.arms.right;
    const armLen = lArm.upperArmCm + lArm.forearmCm + 0.85 * lArm.handCm;
    const outlines = realisticOutlinesOf(
      fit.mesh,
      target.statureCm,
      target.crotchY,
      [
        { side: 1, joint: [...lArm.joint], axis: [...lArm.axis], u: [...lArm.u], v: [...lArm.v], lengthCm: armLen },
        { side: -1, joint: [...rArm.joint], axis: [...rArm.axis], u: [...rArm.u], v: [...rArm.v], lengthCm: armLen },
      ],
      undefined,
      asset.armWeight,
    );
    const chestY = target.rings.find((r) => r.id === 'chest')!.centre[1];
    const planScaled = planAvatar({ category: 'dress' }, { bust: 116, waist: 98, hip: 122 }, undefined, undefined, outlines, true);
    const raw = outlines.torso(chestY)!;
    const e = new Float32Array(4);
    expect(samplePolar(planScaled.field.torso.polar!, chestY, raw.cx + 10, raw.cz, e)).toBe(true);
    // Must match raw outline radius (not multiplied a second time by ~1.26x morph scale).
    expect(e[2]).toBeCloseTo(polarRadius(raw.r, 0), 1);
  });

  it('device drape of the synthetic babydoll dress on the realistic polar collider has no skin poke-through without conformToField (and keeps fit size unchanged)', async () => {
    const pom = buildPomDressBundle(SYNTHETIC_DRESS_ID, SYNTHETIC_TAPE_DRESS, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE.provenance);
    const files = pom.files as Record<string, string | Uint8Array>;
    const serve: FetchLike = async (url) => {
      const data = files[url.split('/').pop()!]!;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(data as string) as unknown,
        arrayBuffer: async () => {
          const u = data as Uint8Array;
          return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
        },
      };
    };
    const bundle = await loadBundleFrom(serve, '/b', SYNTHETIC_DRESS_ID, { withPayload: false });
    const plan0 = planAvatar(bundle.anchors, BODIES.mid);
    const target = fitTargetOf(plan0.drawn, plan0.avatar.rings, plan0.drawnScaleAt);
    const fitBody = fitRealisticBody(asset, target);
    const lArm = plan0.drawn.arms.left, rArm = plan0.drawn.arms.right;
    const armLen = lArm.upperArmCm + lArm.forearmCm + 0.85 * lArm.handCm;
    const s0 = plan0.field.armFrames[0]!.s0;
    const outlines = realisticOutlinesOf(
      fitBody.mesh,
      target.statureCm,
      target.crotchY,
      [
        { side: 1, joint: [...lArm.joint], axis: [...lArm.axis], u: [...lArm.u], v: [...lArm.v], lengthCm: armLen, s0 },
        { side: -1, joint: [...rArm.joint], axis: [...rArm.axis], u: [...rArm.u], v: [...rArm.v], lengthCm: armLen, s0 },
      ],
      undefined,
      asset.armWeight,
    );
    const planPolar = planAvatar(bundle.anchors, BODIES.mid, undefined, undefined, outlines, true);
    const fitEllipse = fitForBody(SYNTHETIC_TAPE_DRESS, plan0.avatar.measurements);
    const fitPolar = fitForBody(SYNTHETIC_TAPE_DRESS, planPolar.avatar.measurements);
    expect(fitPolar.recommendedSize).toBe(fitEllipse.recommendedSize);
    expect(fitPolar.recommendedSize).toBe('12');

    // Every draped cloth particle on the polar collider clears the realistic torso outline cleanly.
    const sessP = openSession(planPolar.m, bundle, SYNTHETIC_TAPE_DRESS);
    const instP = prepareFit(sessP, planPolar.avatar, planPolar.field, fitPolar, '12', viewerMaterial('product', bundle.material));
    const posP = relax(instP);
    let maxInPolar = 0;
    for (let i = 0; i < posP.length / 3; i++) {
      const yWorld = posP[3 * i + 1]! + planPolar.garmentLiftCm;
      const sec = outlines.torso(yWorld);
      if (!sec) continue;
      const dx = posP[3 * i]! - sec.cx;
      const dz = posP[3 * i + 2]! - sec.cz;
      const rSkin = polarRadius(sec.r, Math.atan2(dz, dx));
      maxInPolar = Math.max(maxInPolar, rSkin - Math.hypot(dx, dz));
    }
    expect(maxInPolar).toBeLessThanOrEqual(0.2);

    // Negative control: ellipse collider without conformToField lets the cloth sit > 0.5 cm inside the realistic body.
    const sessE = openSession(plan0.m, bundle, SYNTHETIC_TAPE_DRESS);
    const instE = prepareFit(sessE, plan0.avatar, plan0.field, fitEllipse, '12', viewerMaterial('product', bundle.material));
    const posE = relax(instE);
    let maxInEllipse = 0;
    for (let i = 0; i < posE.length / 3; i++) {
      const yWorld = posE[3 * i + 1]! + plan0.garmentLiftCm;
      const sec = outlines.torso(yWorld);
      if (!sec) continue;
      const dx = posE[3 * i]! - sec.cx;
      const dz = posE[3 * i + 2]! - sec.cz;
      const rSkin = polarRadius(sec.r, Math.atan2(dz, dx));
      maxInEllipse = Math.max(maxInEllipse, rSkin - Math.hypot(dx, dz));
    }
    expect(maxInEllipse).toBeGreaterThan(0.5);
  }, 120_000);
});
