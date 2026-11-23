import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape, buildBody, buildMannequin, topology } from '@curtain/mannequin';
import { ANCHOR_RINGS } from '@curtain/anchors';
import { conformToField, coverZone, decodeRealisticBody, encodeRealisticBody, fitRealisticBody, fitTargetOf, sectionAt, warpThrough, type FitResult, type FitTarget } from './realisticBody';
import { IDENTITY_MORPH, bodyField } from './body';
import { sample } from './collide';
import { bodyShapeOf, planAvatar } from './mount';

const FILE = new URL('../assets/realistic-body/female-v1.crb', import.meta.url);
const asset = decodeRealisticBody(readFileSync(FILE));

/** The spike's five test bodies (female, cm): table XS, M, XXL and two typed statures. */
const BODIES = {
  slim: { heightCm: 164, bust: 80, waist: 62, hip: 88 },
  mid: { heightCm: 168, bust: 92, waist: 74, hip: 100 },
  full: { heightCm: 170, bust: 116, waist: 98, hip: 122 },
  tall: { heightCm: 182, bust: 92, waist: 74, hip: 100 },
  petite: { heightCm: 152, bust: 84, waist: 66, hip: 92 },
} as const;

/** The pass bound of the spike (route doc §7): every ring's loop girth within 0.5 % of the ring table. */
const TOLERANCE_PCT = 0.5;

/** The rings over the bound, with their error; empty when the fit passes. */
function ringsOver(result: FitResult, tolerancePct = TOLERANCE_PCT): string[] {
  return result.rings.filter((r) => r.errorPct === null || Math.abs(r.errorPct) > tolerancePct).map((r) => `${r.id} ${r.errorPct === null ? 'no section' : `${r.errorPct.toFixed(2)} %`}`);
}

const targetOf = (b: (typeof BODIES)[keyof typeof BODIES]): FitTarget => fitTargetOf(buildBody({ family: 'female', ...b }));

describe('realistic body asset', () => {
  it('is a CC0 MakeHuman bake of the female family, small enough to ship (target 1.5 MB, fail 3 MB)', () => {
    expect(asset.meta.family).toBe('female');
    expect(asset.meta.source.licence).toMatch(/^CC0-1\.0/);
    expect(asset.meta.source.repository).toBe('https://github.com/makehumancommunity/mpfb2');
    expect(statSync(FILE).size).toBeLessThan(1.5 * 1024 * 1024);
    expect(asset.indices.length / 3).toBe(asset.meta.triangleCount);
  });

  it('round-trips through its encoder byte for byte', () => {
    expect(Buffer.from(encodeRealisticBody(asset)).equals(readFileSync(FILE))).toBe(true);
  });

  it('refuses a file that is not one', () => {
    expect(() => decodeRealisticBody(new Uint8Array(16))).toThrow(/not a CRB1/);
    expect(() => decodeRealisticBody(readFileSync(FILE).subarray(0, 4000))).toThrow(/truncated/);
  });
});

describe('fitRealisticBody', () => {
  // The girths themselves are tested against the typed body with an independent slicer in
  // test/realisticBodyGirth.test.ts (with its negative controls); here the fit's own report and the mesh.
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: its own ring report (strict: no nearest-loop fallback) lists the 12 rings within ${TOLERANCE_PCT} %, the mesh closed`, () => {
      const target = targetOf(body);
      const fit = fitRealisticBody(asset, target);
      expect(fit.rings.map((r) => r.id).sort()).toEqual([...ANCHOR_RINGS].sort());
      expect(ringsOver(fit)).toEqual([]);
      const topo = topology(fit.mesh);
      expect(topo.watertight).toBe(true);
      expect(topo.boundaryEdges).toBe(0);
    });
  }

  it('the cup is solved from chest minus underbust: the full body keeps more of its bust than at the ratio (cup over -0.5)', () => {
    expect(fitRealisticBody(asset, targetOf(BODIES.full), { iterations: 0 }).shape.cup).toBeGreaterThan(-0.5);
  });

  it('follows the drawn body: the morphed avatar of the viewer keeps the base body\'s rings and stature', () => {
    const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
    const plan = planAvatar({ category: 'dress' }, { bust: 104, waist: 90, hip: 112 });
    expect(plan.drawn.rings.map((r) => r.circumferenceCm)).toEqual(m.rings.map((r) => r.circumferenceCm));
    expect(plan.drawn.statureCm).toBe(m.statureCm);
    expect(fitTargetOf(plan.drawn, plan.avatar.rings, plan.drawnScaleAt).rings.find((r) => r.id === 'waist')!.girthCm).toBeCloseTo(90, 6);
  });

  it('the vertical warp is monotone and passes through its knots', () => {
    const w = warpThrough([{ x: 0, y: 0 }, { x: 10, y: 12 }, { x: 30, y: 31 }, { x: 50, y: 60 }]);
    expect(w(10)).toBeCloseTo(12, 12);
    expect(w(30)).toBeCloseTo(31, 12);
    let prev = -Infinity;
    for (let x = -5; x <= 60; x += 0.25) {
      expect(w(x)).toBeGreaterThan(prev);
      prev = w(x);
    }
  });
});

describe('arm length (WO-001: the founder found the arms too long, 21 Nov)', () => {
  // With the arms hanging, the fingertips of an ordinary adult end at about 0.38 × stature (mid-thigh). The ring table
  // puts the wrist 0.332 × stature down the arm from the shoulder joint and gives the hand 0.108 × stature; until
  // 22 Nov the fit stretched the hand with the arm and drew it 0.122 × stature long (fingertips about 2.4 cm lower).
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: the hand ends at the table's hand length past the wrist ring, not lower`, () => {
      const m = buildBody({ family: 'female', ...body });
      const target = fitTargetOf(m);
      const P = fitRealisticBody(asset, target).mesh.positions;
      const { joint: j, axis: ax } = target.arms.left;
      const handCm = 0.108 * m.statureCm;
      const along = (x: number, y: number, z: number): number => (x - j[0]) * ax[0] + (y - j[1]) * ax[1] + (z - j[2]) * ax[2];
      const wrist = target.rings.find((r) => r.id === 'wrist')!.centre;
      const sWrist = along(wrist[0], wrist[1], wrist[2]);
      let sTip = -Infinity;
      for (let i = 0; i < P.length / 3; i++) if (P[3 * i]! > 0 && asset.armWeight[i]! >= 0.99) sTip = Math.max(sTip, along(P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!));
      // The drawn hand: within 0.5 cm of the table's (the old fit: +1.9 to +2.2 cm).
      expect(Math.abs(sTip - sWrist - handCm)).toBeLessThan(0.5);
      // Hanging straight down from the shoulder joint, the fingertips would end at or above 0.35 × stature (old: 0.341).
      expect((j[1] - sTip) / m.statureCm).toBeGreaterThan(0.35);
    });
  }
});

describe('body iteration 2 (WO-014 / CUR-27: hip seam, shoulder-to-upper-arm, knees)', () => {
  const fitted = Object.fromEntries(
    Object.entries(BODIES).map(([name, body]) => {
      const target = targetOf(body);
      return [name, { target, fit: fitRealisticBody(asset, target) }];
    }),
  ) as Record<keyof typeof BODIES, { target: FitTarget; fit: FitResult }>;

  const meanFrontNy = (fit: FitResult, yLo: number, yHi: number): number => {
    const P = fit.mesh.positions, I = fit.mesh.indices;
    const n = P.length / 3;
    const N = new Float64Array(3 * n);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
      const ux = P[3 * b]! - P[3 * a]!, uy = P[3 * b + 1]! - P[3 * a + 1]!, uz = P[3 * b + 2]! - P[3 * a + 2]!;
      const vx = P[3 * c]! - P[3 * a]!, vy = P[3 * c + 1]! - P[3 * a + 1]!, vz = P[3 * c + 2]! - P[3 * a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        N[3 * k] = N[3 * k]! + nx;
        N[3 * k + 1] = N[3 * k + 1]! + ny;
        N[3 * k + 2] = N[3 * k + 2]! + nz;
      }
    }
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const y = P[3 * i + 1]!;
      if (y < yLo || y > yHi || P[3 * i + 2]! < 2 || asset.armWeight[i]! > 0.1) continue;
      const l = Math.hypot(N[3 * i]!, N[3 * i + 1]!, N[3 * i + 2]!);
      if (!l) continue;
      sum += N[3 * i + 1]! / l;
      count++;
    }
    return sum / count;
  };

  it('hip seam: front normal (ny) in 98..102 cm on the full body has no horizontal shelf (old: 0.46, new: ~0.16)', () => {
    expect(meanFrontNy(fitted.full.fit, 98, 102)).toBeLessThan(0.22);
    for (const { target, fit } of Object.values(fitted)) {
      const y = (id: string): number => target.rings.find((r) => r.id === id)!.centre[1];
      // Old sparse Z-centring gave 0.18..0.23 across the five bodies; dense smooth centring keeps it below 0.17.
      expect(meanFrontNy(fit, y('hip'), y('waist'))).toBeLessThan(0.17);
    }
  });

  it('shoulder to upper arm: the outer arm-root profile has no extra-segment kink on any test body (old max slope: 0.29..0.43)', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const P = fit.mesh.positions;
      const { joint: j, axis: ax } = target.arms.left;
      const up = [-ax[1], ax[0], 0];
      const ridge: number[] = [];
      for (let s = 0; s <= 14; s += 2) {
        let best = -Infinity;
        for (let i = 0; i < asset.meta.bodyVertexCount; i++) {
          const px = P[3 * i]!, py = P[3 * i + 1]!, pz = P[3 * i + 2]!;
          if (px < 10 || py < 95) continue;
          const ds = (px - j[0]) * ax[0] + (py - j[1]) * ax[1] + (pz - j[2]) * ax[2];
          if (Math.abs(ds - s) < 1.2) best = Math.max(best, (px - j[0]) * up[0]! + (py - j[1]) * up[1]!);
        }
        ridge.push(best);
      }
      let maxSlope = -Infinity;
      for (let i = 1; i < ridge.length; i++) maxSlope = Math.max(maxSlope, (ridge[i]! - ridge[i - 1]!) / 2);
      // Old fit pinched the deltoid inward and stepped out sharply at s = 4..12 cm (slope 0.29..0.43).
      expect(maxSlope).toBeLessThan(0.26);
    }
  });

  it('knees: side-view thigh-to-shin angle is naturally upright, not hyperextended backward (old local: -3.9°..-9.3°, full: 0°)', () => {
    const bendDeg = (z1: number, y1: number, z2: number, y2: number, z3: number, y3: number): number =>
      ((Math.atan2(z2 - z1, y1 - y2) - Math.atan2(z3 - z2, y2 - y3)) * 180) / Math.PI;
    for (const { target, fit } of Object.values(fitted)) {
      const r = (id: string) => target.rings.find((x) => x.id === id)!;
      const legX = r('knee').centre[0];
      const zAt = (y: number): number => sectionAt(fit.mesh.positions, fit.mesh.indices, [legX, y, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1])!.av;
      const yTh = r('thigh').centre[1], yKn = r('knee').centre[1], yCa = r('calf').centre[1], yAn = r('ankle').centre[1];
      // Positive angle = knee sits gently forward of the thigh-to-ankle / mid-thigh-to-calf line (natural standing).
      expect(bendDeg(zAt(yTh), yTh, zAt(yKn), yKn, zAt(yAn), yAn)).toBeGreaterThan(1.2);
      expect(bendDeg(zAt((yTh + yKn) / 2), (yTh + yKn) / 2, zAt(yKn - 6), yKn - 6, zAt(yCa), yCa)).toBeGreaterThan(0.5);
    }
  });
});

describe('arms and shoulders iteration 3 (WO-019 / CUR-33: anatomical profile across all 5 bodies)', () => {
  const fitted = Object.fromEntries(
    Object.entries(BODIES).map(([name, body]) => {
      const target = targetOf(body);
      return [name, { target, fit: fitRealisticBody(asset, target) }];
    }),
  ) as Record<keyof typeof BODIES, { target: FitTarget; fit: FitResult }>;

  const armSection = (target: FitTarget, fit: FitResult, frac: number) => {
    const { joint: j, axis: ax } = target.arms.left;
    const wr = target.rings.find((r) => r.id === 'wrist')!.centre;
    const sWrist = (wr[0] - j[0]) * ax[0] + (wr[1] - j[1]) * ax[1] + (wr[2] - j[2]) * ax[2];
    const s = frac * sWrist;
    const o: [number, number, number] = [j[0] + ax[0] * s, j[1] + ax[1] * s, j[2] + ax[2] * s];
    const uLen = Math.hypot(-ax[1], ax[0]);
    const uOut: [number, number, number] = [-ax[1] / uLen, ax[0] / uLen, 0];
    const vFront: [number, number, number] = [0, 0, 1];
    const sec = sectionAt(fit.mesh.positions, fit.mesh.indices, o, ax, uOut, vFront)!;
    let uMin = Infinity, uMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const [pu, pz] of sec.q) {
      if (pu < uMin) uMin = pu;
      if (pu > uMax) uMax = pu;
      if (pz < zMin) zMin = pz;
      if (pz > zMax) zMax = pz;
    }
    return {
      s,
      sWrist,
      girth: sec.loopCm,
      au: sec.au,
      av: sec.av,
      backFromAxis: -zMin,
      frontFromAxis: zMax,
      backR: sec.av - zMin,
      frontR: zMax - sec.av,
      widthU: uMax - uMin,
      depthZ: zMax - zMin,
      centre: [o[0] + uOut[0] * sec.au, o[1] + uOut[1] * sec.au, o[2] + sec.av] as [number, number, number],
    };
  };

  it('1. shoulder: trapezius slopes smoothly downward from neck base to acromion on all 5 bodies (no flat horizontal shelf)', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const P = fit.mesh.positions;
      const shY = target.rings.find((r) => r.id === 'shoulder')!.centre[1];
      const neckY = target.rings.find((r) => r.id === 'neck')!.centre[1];
      const topAt = (x0: number): number => {
        let best = -Infinity;
        for (let i = 0; i < asset.meta.bodyVertexCount; i++) {
          const px = P[3 * i]!, py = P[3 * i + 1]!, pz = P[3 * i + 2]!;
          if (Math.abs(px - x0) < 1.2 && py > shY - 10 && py < neckY + 5 && Math.abs(pz) < 8) best = Math.max(best, py);
        }
        return best;
      };
      // Slope from neck base (x = 8 cm) to outer shoulder (x = 18 cm): old fit had flat 1.8..2.6 cm drop; new drops > 2.0 cm with smooth fall.
      const drop = topAt(8) - topAt(18);
      expect(drop).toBeGreaterThan(2.0);
      expect(topAt(10)).toBeGreaterThan(topAt(18));
    }
  });

  it('2. armpit: anterior and posterior axillary folds protrude clearly on both sides of the arm root', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const P = fit.mesh.positions;
      const chY = target.rings.find((r) => r.id === 'chest')!.centre[1];
      const shY = target.rings.find((r) => r.id === 'shoulder')!.centre[1];
      const xAx = 0.85 * Math.abs(target.arms.left.joint[0]);
      let maxFront = -Infinity, minBack = Infinity;
      for (let i = 0; i < asset.meta.bodyVertexCount; i++) {
        const px = P[3 * i]!, py = P[3 * i + 1]!, pz = P[3 * i + 2]!;
        if (Math.abs(px - xAx) < 2.0 && py > chY + 1 && py < shY) {
          if (pz > maxFront) maxFront = pz;
          if (pz < minBack) minBack = pz;
        }
      }
      expect(maxFront).toBeGreaterThan(3.5);
      expect(minBack).toBeLessThan(-3.0);
      expect(maxFront - minBack).toBeGreaterThan(7.5);
    }
  });

  it('3. upper arm: posterior triceps is fuller than anterior biceps and upper arm tapers cleanly toward the elbow (old: back/front < 1.0)', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const midUpper = armSection(target, fit, 0.36);
      const elbow = armSection(target, fit, 0.52);
      // Old fit had backFromAxis / frontFromAxis ~0.92..0.96; triceps fullness pushes it > 1.25.
      expect(midUpper.backFromAxis / midUpper.frontFromAxis).toBeGreaterThan(1.25);
      // Tapers meaningfully toward the narrow elbow.
      expect(midUpper.girth - elbow.girth).toBeGreaterThan(2.8);
    }
  });

  it('4. elbow: narrow (narrower than upper arm and upper forearm), subtle bony olecranon point at back, at waist height when hanging', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const upper = armSection(target, fit, 0.28);
      const elbow = armSection(target, fit, 0.52);
      const forearm = armSection(target, fit, 0.6);
      const waistY = target.rings.find((r) => r.id === 'waist')!.centre[1];
      const hangElbowY = target.arms.left.joint[1] - elbow.s;
      // Old slim & tall had elbow girth LARGER than forearm girth (24.2 > 22.8 and 25.7 > 24.6).
      expect(elbow.girth).toBeLessThan(upper.girth - 3.0);
      expect(elbow.girth).toBeLessThan(forearm.girth - 0.7);
      // Posterior bony olecranon accent at back of elbow.
      expect(elbow.backR / elbow.frontR).toBeGreaterThan(1.03);
      // Hanging straight down from shoulder joint, elbow lands right at waist height (within 1.5 cm).
      expect(Math.abs(hangElbowY - waistY)).toBeLessThan(1.5);
    }
  });

  it('5. forearm and wrist: fuller right below the elbow, tapering smoothly to a slim flat wrist (wider thumb-to-pinky than thick)', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const elbow = armSection(target, fit, 0.52);
      const upperFore = armSection(target, fit, 0.6);
      const distalFore = armSection(target, fit, 0.92);
      const wrist = armSection(target, fit, 1.0);
      expect(upperFore.girth).toBeGreaterThan(elbow.girth + 0.7);
      expect(upperFore.girth - wrist.girth).toBeGreaterThan(7.5);
      // Flat wrist: thumb-to-pinky width (depthZ in neutral A-pose) vs palm-to-back thickness (widthU). Old: ~1.63..1.67; new: > 1.85.
      expect(wrist.depthZ / wrist.widthU).toBeGreaterThan(1.85);
      expect(distalFore.depthZ / distalFore.widthU).toBeGreaterThan(1.35);
    }
  });

  it('6. carrying angle: forearm angles 10° to 15° outward relative to the upper arm on all 5 bodies (old: -0.6°..0.0°)', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const pUA = armSection(target, fit, 0.28).centre;
      const pEl = armSection(target, fit, 0.52).centre;
      const pWr = armSection(target, fit, 1.0).centre;
      const upperDeg = (Math.atan2(pEl[0] - pUA[0], pUA[1] - pEl[1]) * 180) / Math.PI;
      const foreDeg = (Math.atan2(pWr[0] - pEl[0], pEl[1] - pWr[1]) * 180) / Math.PI;
      const carryDeg = foreDeg - upperDeg;
      expect(carryDeg).toBeGreaterThanOrEqual(10);
      expect(carryDeg).toBeLessThanOrEqual(15);
    }
  });

  it('8. back control: softly visible shoulder blades, central spine groove, and clear waist taper from behind', () => {
    for (const { target, fit } of Object.values(fitted)) {
      const P = fit.mesh.positions;
      const shY = target.rings.find((r) => r.id === 'shoulder')!.centre[1];
      const chY = target.rings.find((r) => r.id === 'chest')!.centre[1];
      const waY = target.rings.find((r) => r.id === 'waist')!.centre[1];
      const hiY = target.rings.find((r) => r.id === 'hip')!.centre[1];
      const yScap = chY + 0.55 * (shY - chY);
      const backZ = (x0: number): number => {
        let minZ = Infinity;
        for (let i = 0; i < asset.meta.bodyVertexCount; i++) {
          if (asset.armWeight[i]! > 0.3) continue;
          const px = P[3 * i]!, py = P[3 * i + 1]!, pz = P[3 * i + 2]!;
          if (Math.abs(px - x0) < 1.2 && Math.abs(py - yScap) < 2.0 && pz < 0) minZ = Math.min(minZ, pz);
        }
        return minZ;
      };
      // Shoulder blade at x = 6..8 cm sits noticeably further back (-Z) than the central spine groove at x = 0.
      const scapRelief = backZ(0) - Math.min(backZ(6), backZ(8));
      expect(scapRelief).toBeGreaterThan(0.8);
      // Clear waist taper relative to chest and hip from behind.
      const widthAt = (y: number): number => {
        const s = sectionAt(P, fit.mesh.indices, [0, y, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1])!;
        let lo = Infinity, hi = -Infinity;
        for (const [u] of s.q) {
          if (u < lo) lo = u;
          if (u > hi) hi = u;
        }
        return hi - lo;
      };
      expect(widthAt(waY)).toBeLessThan(widthAt(chY));
      expect(widthAt(waY)).toBeLessThan(widthAt(hiY));
    }
  });
});

describe('conformToField (the display step under a garment)', () => {
  const m = buildBody({ family: 'female', ...BODIES.mid });
  const fit = fitRealisticBody(asset, fitTargetOf(m));
  const field = bodyField(m, IDENTITY_MORPH);
  const zone = { yLo: m.morphHeights.waist - 10, yHi: m.morphHeights.chest + 2, armS: [0, 0] as [number, number] };
  const conformed = conformToField(fit.mesh, asset, field, m.landmarks.crotch[1], zone, { clearanceCm: 0.1, blendCm: 3 });
  const e = new Float32Array(4);
  /** How far a torso vertex is outside the field's ellipse at its height, cm (negative inside). */
  const outside = (p: ArrayLike<number>, i: number): number => {
    if (!sample(field.torso, p[3 * i + 1]!, e)) return -Infinity;
    const dx = p[3 * i]! - e[0]!, dz = p[3 * i + 2]! - e[1]!;
    const r = Math.hypot(dx, dz);
    return r - (e[2]! * e[3]!) / Math.hypot(e[3]! * (dx / r), e[2]! * (dz / r));
  };

  it('holds every torso vertex of the covered band inside the field (plus 0.1 cm), where the fitted skin was outside', () => {
    let before = 0, after = 0;
    for (let i = 0; i < asset.meta.bodyVertexCount; i++) {
      const y = fit.mesh.positions[3 * i + 1]!;
      if (asset.armWeight[i]! > 0.15 || y < zone.yLo + 3 || y > zone.yHi - 3) continue;
      before = Math.max(before, outside(fit.mesh.positions, i));
      after = Math.max(after, outside(conformed.positions, i));
    }
    expect(before).toBeGreaterThan(1);
    expect(after).toBeLessThanOrEqual(0.1 + 1e-6);
  });

  it('leaves the body outside the zone, and the fitted mesh, as they were', () => {
    for (let i = 0; i < asset.meta.vertexCount; i++) {
      const y = fit.mesh.positions[3 * i + 1]!;
      if (y > zone.yLo && y < zone.yHi) continue;
      for (let c = 0; c < 3; c++) expect(conformed.positions[3 * i + c]).toBe(fit.mesh.positions[3 * i + c]);
    }
    expect(ringsOver(fit)).toEqual([]);
  });

  it('finds a sleeve: a garment point round the arm reaches along it, a bodice point beside the torso does not', () => {
    const f = field.armFrames[0]!;
    const s = 20;
    const onArm = [f.joint[0] + f.axis[0] * s + f.u[0] * 5, f.joint[1] + f.axis[1] * s + f.u[1] * 5, f.joint[2] + f.axis[2] * s];
    const bodice = [0, m.morphHeights.waist, 12];
    expect(coverZone(onArm, field).armS[0]).toBeCloseTo(s + 2, 6);
    expect(coverZone(bodice, field).armS).toEqual([0, 0]);
  });
});

describe('bodyShape option', () => {
  it('is off by default: only the exact name switches it on', () => {
    expect(bodyShapeOf(undefined)).toBe('procedural');
    expect(bodyShapeOf('realistic')).toBe('procedural');
    expect(bodyShapeOf('realistic-spike')).toBe('realistic-spike');
  });

  it('a typed body plans its own drawn mannequin, at scale 1', () => {
    const plan = planAvatar({ category: 'dress' }, { heightCm: 182, bust: 92, waist: 74, hip: 100 });
    expect(plan.drawn.statureCm).toBe(182);
    expect(plan.drawnScaleAt(100)).toBe(1);
  });
});
