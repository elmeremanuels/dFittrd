import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, bodyShape, buildBody, buildMannequin, topology } from '@curtain/mannequin';
import { ANCHOR_RINGS } from '@curtain/anchors';
import { conformToField, coverZone, decodeRealisticBody, encodeRealisticBody, fitRealisticBody, fitTargetOf, warpThrough, type FitResult, type FitTarget } from './realisticBody';
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
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: every one of the 12 rings is within ${TOLERANCE_PCT} % of the ring table (loop girth), the mesh closed`, () => {
      const target = targetOf(body);
      const fit = fitRealisticBody(asset, target);
      expect(fit.rings.map((r) => r.id).sort()).toEqual([...ANCHOR_RINGS].sort());
      expect(ringsOver(fit)).toEqual([]);
      // The tape girth is reported next to the loop and never exceeds it (a hull is never longer than the loop round it).
      for (const r of fit.rings) expect(r.tapeCm!).toBeLessThanOrEqual(r.loopCm! + 1e-6);
      const topo = topology(fit.mesh);
      expect(topo.watertight).toBe(true);
      expect(topo.boundaryEdges).toBe(0);
    });
  }

  it('negative control: the same check fails on every body when the fit is broken', () => {
    for (const body of Object.values(BODIES)) {
      const target = targetOf(body);
      // Broken 1: no girth correction (only the uniform start of the per-ring scale).
      expect(ringsOver(fitRealisticBody(asset, target, { iterations: 0 })).length).toBeGreaterThan(0);
      // Broken 2: the fit is right, but for a table 2 % off at the waist; checked against the real table it fails there.
      const wrong: FitTarget = { ...target, rings: target.rings.map((r) => (r.id === 'waist' ? { ...r, girthCm: r.girthCm * 1.02 } : r)) };
      const fit = fitRealisticBody(asset, wrong);
      const checked: FitResult = { ...fit, rings: fit.rings.map((r) => { const t = target.rings.find((x) => x.id === r.id)!; return { ...r, targetCm: t.girthCm, errorPct: (100 * (r.loopCm! - t.girthCm)) / t.girthCm }; }) };
      expect(ringsOver(checked)).toEqual([expect.stringMatching(/^waist 2\.\d\d %$/)]);
    }
  });

  it('follows the drawn body: the morphed avatar of the viewer (girths only) is fitted to its own rings', () => {
    const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
    const plan = planAvatar({ category: 'dress' }, { bust: 104, waist: 90, hip: 112 });
    const fit = fitRealisticBody(asset, fitTargetOf(plan.drawn, plan.avatar.rings, plan.drawnScaleAt));
    expect(plan.drawn.rings.map((r) => r.circumferenceCm)).toEqual(m.rings.map((r) => r.circumferenceCm));
    expect(plan.drawn.statureCm).toBe(m.statureCm);
    expect(ringsOver(fit)).toEqual([]);
    expect(fit.rings.find((r) => r.id === 'waist')!.targetCm).toBeCloseTo(90, 6);
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

describe('conformToField (the display step under a garment)', () => {
  const m = buildBody({ family: 'female', ...BODIES.mid });
  const fit = fitRealisticBody(asset, fitTargetOf(m));
  const field = bodyField(m, IDENTITY_MORPH);
  const zone = { yLo: m.morphHeights.waist - 10, yHi: m.morphHeights.chest + 2, armS: [0, 0] as [number, number] };
  const conformed = conformToField(fit.mesh, asset, field, m.landmarks.crotch[1], zone, 0.1, 3);
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
