/**
 * The male body in the viewer (men-3d-plan slice M1): a bundle built on the male mannequin (the
 * SYNTHETIC men's test tee of the spike, not a product) passes the device check for a men's garment
 * only, mounts on the male body family only, and drapes on male bodies S to XXL without exploding;
 * how much of the body shows through the cloth is measured and bounded, not passed as good.
 * No WebGL: `planAvatar` is what `mountGarmentView` decides before it draws, and the drape is the
 * one the mount runs (`prepareFit` + `relax`).
 */
import { describe, expect, it } from 'vitest';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE, vertexNormals } from '@curtain/mannequin';
import { MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import type { Mesh } from '@curtain/mannequin';
import { measureRing } from '../../../spikes/garment-engine/src/anchoring';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { makeCollider } from './body';
import { loadBundleFrom, type FetchLike } from './bundle';
import { checkBundle } from './bundleCheck';
import { isSettled, strainQuantile } from './cloth';
import { openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';
import { GarmentViewError, planAvatar } from './mount';

const tee = buildBundle('synthetic-men-tee', { skipSeparation: true });
const dress = buildBundle('aalter-studio-2', { skipSeparation: true });

/** The bundle files as the dev server or the asset route would serve them. */
function serve(files: Record<string, string | Uint8Array>): FetchLike {
  return async (url) => {
    const name = url.split('/').pop()!;
    const data = files[name];
    if (data === undefined) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
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
}

/**
 * How much of the drawn body shows through the draped cloth, by region: of the body's vertices
 * within 3 cm of the cloth (garment space, so the drawn body moved down by `garmentLiftCm`), whose
 * nearest cloth vertex is not on the cloth's rim, the share that lies more than 0.3 cm outside that
 * vertex's tangent plane. Regions by height on the base body: `cap` from 6 cm below the shoulder ring
 * up (sleeve cap and shoulder), `hem` below 6 cm above the hip ring, `mid` in between (mostly the
 * armpit, where torso and sleeve tubes meet). A proxy for the holes the pictures show, not a render:
 * brute force nearest neighbour, the drawn mesh against the cloth particles.
 */
function showThrough(pos: Float32Array, indices: Uint32Array, body: Mesh, liftCm: number, shoulderY: number, hipY: number): Record<'cap' | 'mid' | 'hem', number> {
  const normals = vertexNormals({ positions: Float64Array.from(pos), indices, vertexPart: new Uint8Array(pos.length / 3), partNames: ['cloth'] } as Mesh);
  const uses = new Map<number, number>();
  const ng = pos.length / 3;
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e]!;
      const b = indices[t + ((e + 1) % 3)]!;
      const key = Math.min(a, b) * ng + Math.max(a, b);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  const rim = new Uint8Array(ng);
  for (const [key, n] of uses)
    if (n === 1) {
      rim[Math.floor(key / ng)] = 1;
      rim[key % ng] = 1;
    }
  const seen: Record<'cap' | 'mid' | 'hem', { near: number; through: number }> = { cap: { near: 0, through: 0 }, mid: { near: 0, through: 0 }, hem: { near: 0, through: 0 } };
  for (let i = 0; i < body.positions.length / 3; i++) {
    const x = body.positions[3 * i]!;
    const y = body.positions[3 * i + 1]! - liftCm;
    const z = body.positions[3 * i + 2]!;
    let best = Infinity;
    let j = -1;
    for (let k = 0; k < ng; k++) {
      const d = (pos[3 * k]! - x) ** 2 + (pos[3 * k + 1]! - y) ** 2 + (pos[3 * k + 2]! - z) ** 2;
      if (d < best) {
        best = d;
        j = k;
      }
    }
    if (best > 9 || rim[j]) continue;
    const out = (x - pos[3 * j]!) * normals[3 * j]! + (y - pos[3 * j + 1]!) * normals[3 * j + 1]! + (z - pos[3 * j + 2]!) * normals[3 * j + 2]!;
    const r = seen[y >= shoulderY - 6 ? 'cap' : y < hipY + 6 ? 'hem' : 'mid'];
    r.near++;
    if (out > 0.3) r.through++;
  }
  const share = ({ near, through }: { near: number; through: number }) => (near ? through / near : 0);
  return { cap: share(seen.cap), mid: share(seen.mid), hem: share(seen.hem) };
}

const incompatible = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof GarmentViewError ? e.code : String(e);
  }
  return undefined;
};

describe('a bundle built on the male mannequin', () => {
  it('carries the family in anchors.json and qa.json; a female bundle carries none (unchanged)', () => {
    expect(JSON.parse(tee.files['anchors.json']).mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(JSON.parse(tee.files['qa.json']).mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(JSON.parse(dress.files['anchors.json']).mannequin).toEqual({ version: '0.1.0', shape: 'M' });
    expect(JSON.parse(dress.files['qa.json'])).not.toHaveProperty('mannequin');
  });

  it('passes the device check for the men’s garment only, and a female bundle never for a men’s garment', async () => {
    const bundle = await loadBundleFrom(serve(tee.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    const meta = { anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa };
    expect(checkBundle(meta, SYNTHETIC_MENS_TEE)).toMatchObject({ family: 'male', baseSize: 'M', sizes: ['S', 'M', 'L', 'XL', 'XXL'] });
    expect(checkBundle(meta, { ...SYNTHETIC_MENS_TEE, audience: 'women' })).toBeNull();
    expect(checkBundle(meta, { ...SYNTHETIC_MENS_TEE, audience: undefined })).toBeNull();
    const female = { anchors: JSON.parse(dress.files['anchors.json']), grading: JSON.parse(dress.files['grading.json']), material: JSON.parse(dress.files['material.json']), qa: JSON.parse(dress.files['qa.json']) };
    const womens = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
    expect(checkBundle(female, womens)?.family).toBe('female');
    expect(checkBundle(female, { ...womens, audience: 'men' })).toBeNull();
    // anchors.json says male, qa.json does not: malformed, refused.
    expect(checkBundle({ ...meta, qa: { ...meta.qa, mannequin: undefined } } as never, SYNTHETIC_MENS_TEE)).toBeNull();
  });

  it('mounts on the male body family only (strict both ways)', () => {
    const anchors = JSON.parse(tee.files['anchors.json']) as { category: string; mannequin: { family?: unknown } };
    expect(planAvatar(anchors, { family: 'male' }).m.shape.family).toBe('male');
    expect(planAvatar(anchors, { family: 'male', heightCm: 180 }).statureCm).toBeCloseTo(180, 6);
    expect(incompatible(() => planAvatar(anchors, {}))).toBe('incompatible');
    expect(incompatible(() => planAvatar(anchors, { family: 'female', heightCm: 168 }))).toBe('incompatible');
    const femaleAnchors = JSON.parse(dress.files['anchors.json']) as { category: string; mannequin: { family?: unknown } };
    expect(incompatible(() => planAvatar(femaleAnchors, { family: 'male', heightCm: 174 }))).toBe('incompatible');
  });

  it('drapes on the male bodies S to XXL in their own size: settled, finite, the graded chest girth kept, and how much body shows through (measured, a known defect)', async () => {
    const bundle = await loadBundleFrom(serve(tee.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    const anchors = bundle.anchors;
    const widths: number[] = [];
    const through: Record<string, Record<'cap' | 'mid' | 'hem', number>> = {};
    for (const id of MALE_BODY_SHAPE_IDS) {
      const r = MALE_REFERENCE[id];
      const body = { family: 'male' as const, heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth };
      const plan = planAvatar(anchors, body);
      const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
      const fit = fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements);
      const f = prepareFit(session, plan.avatar, plan.field, fit, id, viewerMaterial('product', bundle.material));
      const pos = relax(f);
      expect(isSettled(f.cloth, f.params)).toBe(true);
      expect(pos.every(Number.isFinite)).toBe(true);
      expect(strainQuantile(f.cloth, 0.99)).toBeLessThan(0.2);
      // Particles inside the collision field (analytic ellipses, not the drawn mesh): this passes
      // while the drawn body visibly shows through the cloth, so it says nothing about the look.
      const collide = makeCollider(plan.field, 0, session.chains, f.noCollide);
      const probe = Float32Array.from(pos);
      let inside = 0;
      for (let i = 0; i < probe.length / 3; i++) if (collide(probe, i)) inside++;
      expect(inside / (probe.length / 3)).toBeLessThan(0.02);
      through[id] = showThrough(pos, f.indices, plan.avatar.mesh, plan.garmentLiftCm, plan.m.morphHeights.shoulder, plan.m.morphHeights.hip);
      // Girth of the draped tee at the chest ring of the BASE male M (garment space; the spike's
      // tape), for every size: this is the graded garment girth surviving the drape, not evidence
      // that the tee fits the S…XXL body it hangs on.
      const chest = plan.m.rings.find((x) => x.id === 'chest')!;
      widths.push(measureRing({ positions: Float64Array.from(pos), indices: f.indices, vertexPart: new Uint8Array(0), partNames: [] } as Mesh, chest)!.circumferenceCm);
    }
    // Measured 98.7, 105.7, 113.5, 121.3, 130.5 cm on 18 Nov 2026 against the chart's 98 … 131.
    SYNTHETIC_MENS_TEE.sizeChart.forEach((row, i) => expect(Math.abs(widths[i]! - row.bust!)).toBeLessThan(1.5));
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    // KNOWN DEFECT, measured 18 Nov 2026 (share of the covered body vertices showing through):
    //        cap    mid    hem
    //   S    4.5 %  1.7 %  0
    //   M    1.7 %  3.5 %  0
    //   L    2.7 %  3.6 %  0
    //   XL   8.3 %  3.7 %  0
    //   XXL 20.9 %  4.6 %  1.5 %
    // The XL and XXL cap values are the arm showing through the sleeve cap in the pictures, the XXL
    // hem value the row of holes near the hem (the smaller specks just above the hem at L and XL
    // fall in `mid`: the bands are coarse). These bounds only stop it getting worse; tighten
    // them when the drape is fixed (men-3d-plan, M1 status).
    const bound = { S: [0.07, 0.04, 0.01], M: [0.04, 0.06, 0.01], L: [0.05, 0.06, 0.01], XL: [0.11, 0.06, 0.01], XXL: [0.24, 0.07, 0.03] } as const;
    for (const id of MALE_BODY_SHAPE_IDS) {
      const [cap, mid, hem] = bound[id];
      expect(through[id]!.cap, `${id} cap`).toBeLessThan(cap);
      expect(through[id]!.mid, `${id} mid`).toBeLessThan(mid);
      expect(through[id]!.hem, `${id} hem`).toBeLessThan(hem);
    }
    // The metric sees the defect the pictures show: far more of the shoulder at XXL than at M.
    expect(through.XXL!.cap).toBeGreaterThan(5 * through.M!.cap);
  }, 180_000);

  it('drapes on the male shape v2 bodies S to XXL too (maleShape v2, a preview): settled, the graded chest girth kept, show-through measured against v1', async () => {
    const bundle = await loadBundleFrom(serve(tee.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    const rows: Record<string, { v1: Record<'cap' | 'mid' | 'hem', number>; v2: Record<'cap' | 'mid' | 'hem', number>; chest: number; inside: number }> = {};
    for (const id of MALE_BODY_SHAPE_IDS) {
      const r = MALE_REFERENCE[id];
      const body = { family: 'male' as const, heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth };
      const out = {} as Record<'v1' | 'v2', Record<'cap' | 'mid' | 'hem', number>>;
      let chest = 0;
      let inside = 0;
      for (const shape of ['v1', 'v2'] as const) {
        const plan = planAvatar(bundle.anchors, body, null, shape);
        expect(plan.m.maleShape).toBe(shape === 'v2' ? 'v2' : undefined);
        const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
        const fit = fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements);
        const f = prepareFit(session, plan.avatar, plan.field, fit, id, viewerMaterial('product', bundle.material));
        const pos = relax(f);
        expect(isSettled(f.cloth, f.params)).toBe(true);
        expect(pos.every(Number.isFinite)).toBe(true);
        out[shape] = showThrough(pos, f.indices, plan.avatar.mesh, plan.garmentLiftCm, plan.m.morphHeights.shoulder, plan.m.morphHeights.hip);
        if (shape === 'v2') {
          const c = plan.m.rings.find((x) => x.id === 'chest')!;
          chest = measureRing({ positions: Float64Array.from(pos), indices: f.indices, vertexPart: new Uint8Array(0), partNames: [] } as Mesh, c)!.circumferenceCm;
          const collide = makeCollider(plan.field, 0, session.chains, f.noCollide);
          const probe = Float32Array.from(pos);
          for (let i = 0; i < probe.length / 3; i++) if (collide(probe, i)) inside++;
          inside /= probe.length / 3;
        }
      }
      rows[id] = { ...out, chest, inside };
    }
    // Measured 19 Nov 2026 (share of the covered body vertices showing through, v1 → v2):
    //        cap           mid           hem
    //   S    4.5 → 3.8 %   1.7 → 1.6 %   0 → 0
    //   M    1.7 → 3.6 %   3.5 → 1.1 %   0 → 0
    //   L    2.7 → 4.2 %   3.6 → 3.0 %   0 → 0
    //   XL   8.3 → 8.2 %   3.7 → 4.1 %   0 → 0
    //   XXL 20.9 → 9.8 %   4.6 → 4.3 %   1.5 → 0
    // Bounds only stop it getting worse (the tee is draped on the v1 body; v2 is a preview).
    const bound = { S: [0.05, 0.03, 0.01], M: [0.05, 0.025, 0.01], L: [0.06, 0.045, 0.01], XL: [0.1, 0.055, 0.01], XXL: [0.12, 0.06, 0.01] } as const;
    for (const id of MALE_BODY_SHAPE_IDS) {
      const [cap, mid, hem] = bound[id];
      expect(rows[id]!.v2.cap, `${id} cap`).toBeLessThan(cap);
      expect(rows[id]!.v2.mid, `${id} mid`).toBeLessThan(mid);
      expect(rows[id]!.v2.hem, `${id} hem`).toBeLessThan(hem);
    }
    SYNTHETIC_MENS_TEE.sizeChart.forEach((row, i) => expect(Math.abs(rows[MALE_BODY_SHAPE_IDS[i]!]!.chest - row.bust!), MALE_BODY_SHAPE_IDS[i]).toBeLessThan(1.5));
    for (const id of MALE_BODY_SHAPE_IDS) expect(rows[id]!.inside, id).toBeLessThan(0.02);
  }, 240_000);
});
