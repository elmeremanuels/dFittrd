/**
 * The drawn sections of the male shape v2 as polar outlines (`Mannequin.outlines`): they follow the mesh that is
 * drawn, where `torsoAt`/`legAt`/`armAt` return an ellipse round it. Cloth collision and the POM tee builder read them.
 */
import { describe, expect, it } from 'vitest';
import { BASE_SHAPE_ID, MALE_BODY_SHAPE_IDS, MALE_REFERENCE, POLAR_N, bodyShape, buildBody, buildMannequin, buildMannequinMesh, familyShape, polarRadius, slice, type PolarSection } from './index';

const v2 = (id: (typeof MALE_BODY_SHAPE_IDS)[number]) => {
  const r = MALE_REFERENCE[id];
  return buildBody({ family: 'male', bust: r.chest, waist: r.waist, hip: r.hip, heightCm: r.stature, shoulderCm: r.shoulderWidth }, { maleShape: 'v2' });
};
const girth = (o: PolarSection): number => {
  let len = 0;
  for (let j = 0; j < POLAR_N; j++) {
    const a = (2 * Math.PI * j) / POLAR_N, b = (2 * Math.PI * (j + 1)) / POLAR_N;
    len += Math.hypot(o.r[j]! * Math.cos(a) - o.r[(j + 1) % POLAR_N]! * Math.cos(b), o.r[j]! * Math.sin(a) - o.r[(j + 1) % POLAR_N]! * Math.sin(b));
  }
  return len;
};
const ellipseGirth = (a: number, b: number): number => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

describe('polar outlines of the male shape v2', () => {
  it('only a v2 body has them: v1 and female bodies are unchanged', () => {
    expect(buildMannequin(familyShape('male')!).outlines).toBeUndefined();
    expect(buildMannequin(bodyShape(BASE_SHAPE_ID)).outlines).toBeUndefined();
    expect(buildMannequin(bodyShape(BASE_SHAPE_ID), { maleShape: 'v2' }).outlines).toBeUndefined();
    expect(buildMannequin(familyShape('male')!, { maleShape: 'v2' }).outlines).toBeDefined();
  });

  it('polarRadius interpolates round the circle', () => {
    const r = Float64Array.from({ length: POLAR_N }, (_, j) => j);
    expect(polarRadius(r, 0)).toBe(0);
    expect(polarRadius(r, (2 * Math.PI * 2.5) / POLAR_N)).toBeCloseTo(2.5, 9);
    expect(polarRadius(r, -(2 * Math.PI * 0.5) / POLAR_N)).toBeCloseTo((POLAR_N - 1) / 2, 9);
  });

  it('follow the drawn mesh within 0.5 cm on the torso from the seat up and on the arms, S to XXL; the ring girths are the table’s; the ellipse round them is 2.5 cm and more too long', () => {
    for (const id of MALE_BODY_SHAPE_IDS) {
      const m = v2(id);
      const o = m.outlines!;
      const mesh = buildMannequinMesh(m);
      const part = (name: string) => (tri: number) => mesh.partNames[mesh.vertexPart[mesh.indices[3 * tri]!]!] === name;
      let worst = 0;
      for (let y = m.morphHeights.hip; y < m.morphHeights.neck; y += 0.73) {
        const t = o.torso(y)!;
        for (const loop of slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] }, part('torso'))) for (const p of loop.points) {
          worst = Math.max(worst, Math.abs(Math.hypot(p[0] - t.cx, p[2] - t.cz) - polarRadius(t.r, Math.atan2(p[2] - t.cz, p[0] - t.cx))));
        }
      }
      expect(worst, `${id} torso`).toBeLessThan(0.5);
      // Arms: every vertex of the left arm down to the elbow, in the arm's frame.
      const f = m.arms.left;
      let arm = 0;
      for (let i = 0; i < mesh.positions.length / 3; i++) {
        if (mesh.partNames[mesh.vertexPart[i]!] !== 'arm_l') continue;
        const d = [mesh.positions[3 * i]! - f.joint[0], mesh.positions[3 * i + 1]! - f.joint[1], mesh.positions[3 * i + 2]! - f.joint[2]];
        const s = d[0]! * f.axis[0] + d[1]! * f.axis[1] + d[2]! * f.axis[2];
        const a = o.arm(s, 1);
        if (s < 0 || s > f.upperArmCm || !a) continue;
        const u = d[0]! * f.u[0] + d[1]! * f.u[1] + d[2]! * f.u[2] - a.cx, v = d[0]! * f.v[0] + d[1]! * f.v[1] + d[2]! * f.v[2] - a.cz;
        arm = Math.max(arm, Math.abs(Math.hypot(u, v) - polarRadius(a.r, Math.atan2(v, u))));
      }
      expect(arm, `${id} arm`).toBeLessThan(0.5);
      for (const ring of ['chest', 'waist', 'hip'] as const) {
        const y = m.morphHeights[ring];
        const table = m.rings.find((r) => r.id === ring)!.circumferenceCm;
        expect(Math.abs(girth(o.torso(y)!) / table - 1), `${id} ${ring}`).toBeLessThan(0.01);
        const e = m.torsoAt(y)!;
        expect(ellipseGirth(e.a, e.b) - table, `${id} ${ring} envelope`).toBeGreaterThan(2.5);
      }
      // The right side mirrors the left; outside the parts there is nothing.
      const l = o.leg(m.morphHeights.thigh, 1)!, r = o.leg(m.morphHeights.thigh, -1)!;
      expect(r.cx).toBeCloseTo(-l.cx, 6);
      expect(girth(r)).toBeCloseTo(girth(l), 3);
      expect(o.torso(m.statureCm + 5)).toBeNull();
      expect(o.leg(m.morphHeights.chest, 1)).toBeNull();
      expect(o.arm(200, 1)).toBeNull();
      expect(o.arm(-20, 1)).toBeNull();
    }
  });
});
