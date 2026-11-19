/**
 * The male body in the viewer (men-3d-plan slices M1 and M3): a bundle built on the male mannequin
 * (the SYNTHETIC men's test tee of the spike, not a product; since M3 built by the POM tee builder
 * from its flat measurements) passes the device check for a men's garment only, mounts on the male
 * body family only, and drapes on male bodies S to XXL; how much of the body shows through the cloth
 * is measured by region and in pixels, against the M1 lofted test garment.
 * No WebGL: `planAvatar` is what `mountGarmentView` decides before it draws, and the drape is the
 * one the mount runs (`prepareFit` + `relax`).
 */
import { describe, expect, it } from 'vitest';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE, vertexNormals } from '@curtain/mannequin';
import { MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import type { Mesh } from '@curtain/mannequin';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { pokes } from '../../../spikes/garment-engine/src/pokeThrough';
import { buildPomBundle } from '../../../spikes/garment-engine/src/pomBundle';
import { SYNTHETIC_TEE_POM } from '../../../spikes/garment-engine/src/pomTeeSynthetic';
import { tapeGirth } from '../../../spikes/garment-engine/src/tape';
import { makeCollider } from './body';
import { loadBundleFrom, type FetchLike } from './bundle';
import { checkBundle } from './bundleCheck';
import { isSettled, strainQuantile } from './cloth';
import { gradedMesh, hullPerimeter, necklineStrain, openSession, prepareFit, relax, SEAT_MAX_LIFT_CM, sewnNotDrawn, viewerMaterial, type FitInstance, type GarmentSession } from './engine';
import { fitForBody } from './fitting';
import { GarmentViewError, planAvatar } from './mount';

const pom = buildPomBundle('synthetic-men-tee', SYNTHETIC_MENS_TEE, SYNTHETIC_TEE_POM, 'M', { texture: 'synthetic-print' });
const tee = pom;
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

/**
 * The chest line's own row of cloth (the graded mesh's torso row nearest the POM chest line), after the drape: its hull
 * in x–z (a tape laid round the outside, over the folds) and the M3 tape (median radius per angular bin, which drops into
 * folds). Taken on the row, not at a fixed height, because a sewn tee may be lifted to rest on the body (`seatSewnTop`).
 */
function chestRow(session: GarmentSession, f: FitInstance, pos: Float32Array, size: string, chestLineY: number): { hull: number; tape: number } {
  const g = gradedMesh(session, size).positions;
  let best = Infinity;
  for (let i = 0; i < g.length / 3; i++) if (f.chains[i] === 0) best = Math.min(best, Math.abs(g[3 * i + 1]! - chestLineY));
  const ids: number[] = [];
  for (let i = 0; i < g.length / 3; i++) if (f.chains[i] === 0 && Math.abs(Math.abs(g[3 * i + 1]! - chestLineY) - best) < 1e-3) ids.push(i);
  let cy = 0;
  for (const i of ids) cy += pos[3 * i + 1]!;
  cy /= ids.length;
  const hull = hullPerimeter(ids.map((i) => [pos[3 * i]!, pos[3 * i + 2]!] as [number, number]));
  const tape = tapeGirth(ids.map((i) => [pos[3 * i]!, cy, pos[3 * i + 2]!] as [number, number, number]), [0, cy, 0], [1, 0, 0], [0, 0, 1])?.girthCm ?? NaN;
  return { hull, tape };
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

  /** Drape `files` on the male table body `id` in `size`: the mount's own steps. */
  async function drapeOn(files: Record<string, string | Uint8Array>, id: (typeof MALE_BODY_SHAPE_IDS)[number], size: string) {
    const bundle = await loadBundleFrom(serve(files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    const r = MALE_REFERENCE[id];
    const plan = planAvatar(bundle.anchors, { family: 'male', heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth });
    const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
    const fit = fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements);
    const f = prepareFit(session, plan.avatar, plan.field, fit, size, viewerMaterial('product', bundle.material));
    const pos = relax(f);
    const lifted = Float64Array.from(pos);
    for (let i = 1; i < lifted.length; i += 3) lifted[i] = lifted[i]! + plan.garmentLiftCm;
    const sh = plan.m.morphHeights.shoulder + plan.garmentLiftCm, hp = plan.m.morphHeights.hip + plan.garmentLiftCm;
    const region = (y: number): string => (y >= sh - 6 ? 'cap' : y < hp + 6 ? 'hem' : 'mid');
    let pixels = 0;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const v of Object.values(pokes(plan.avatar.mesh, { positions: lifted, indices: f.indices }, yaw, region))) pixels += v;
    return { session, plan, f, pos, pixels, through: showThrough(pos, f.indices, plan.avatar.mesh, plan.garmentLiftCm, plan.m.morphHeights.shoulder, plan.m.morphHeights.hip) };
  }

  it('the POM tee drapes on the male bodies S to XXL in their own size: settled, sewn, seated, no body through the cloth, chest ease kept, shoulder line unstrained', async () => {
    const chestLine = pom.base.levels.chestLineY;
    const chest: { hull: number; tape: number }[] = [];
    const through: Record<string, Record<'cap' | 'mid' | 'hem', number>> = {};
    const pixels: Record<string, number> = {};
    const shoulderLine: Record<string, number> = {};
    for (const id of MALE_BODY_SHAPE_IDS) {
      const { session, plan, f, pos, pixels: px, through: st } = await drapeOn(tee.files, id, id);
      expect(session.sewn).toBe(true);
      expect(isSettled(f.cloth, f.params)).toBe(true);
      expect(pos.every(Number.isFinite)).toBe(true);
      // p99 edge strain, measured 11.9 / 12.1 / 11.7 / 16.8 / 14.8 %: the seat lift (below) brings the armhole up against
      // the arm at XL and XXL, and the underarm takes the strain the shoulder line no longer does (M3: 11.5 … 14.9 %).
      expect(strainQuantile(f.cloth, 0.99)).toBeLessThan(0.18);
      expect(f.seat).not.toBeNull();
      expect(f.seat!.liftCm).toBeLessThanOrEqual(SEAT_MAX_LIFT_CM);
      expect(f.loops.length).toBeGreaterThan(5);
      const collide = makeCollider(plan.field, 0, session.chains, f.noCollide);
      const probe = Float32Array.from(pos);
      let inside = 0;
      for (let i = 0; i < probe.length / 3; i++) if (collide(probe, i)) inside++;
      expect(inside).toBe(0);
      through[id] = st;
      pixels[id] = px;
      shoulderLine[id] = necklineStrain(f, plan.m);
      chest.push(chestRow(session, f, pos, id, chestLine));
    }
    // S and M fit where grading put them; L, XL and XXL ride up 1.25, 2 and 2.75 cm on their fuller necks (seatSewnTop).
    // Shoulder line (`necklineStrain`, the pinned yoke), measured 0 / 1.3 / 0.1 / 1.7 / 4.9 %; M3: 0 / 0 / 6.8 / 26.2 / 37.1 %.
    for (const id of MALE_BODY_SHAPE_IDS) expect(shoulderLine[id], `${id} shoulder line`).toBeLessThan(0.06);
    for (const id of MALE_BODY_SHAPE_IDS) {
      expect(through[id]!.cap, `${id} cap`).toBeLessThan(0.005);
      // `mid` is under the arm (no view sees it: 0 pixels). Measured 0 / 0.1 / 0 / 4.1 / 2.6 %: the seat lift brings the
      // armhole up into the armpit at XL and XXL (M3: 0 / 0 / 3.0 / 0.2 / 1.0 %).
      expect(through[id]!.mid, `${id} mid`).toBeLessThan(0.05);
      expect(through[id]!.hem, `${id} hem`).toBeLessThan(0.005);
      expect(pixels[id], `${id} pixels`).toBeLessThan(10);
    }
    // The chest line's own row of cloth after the drape, against the tape (98 … 131 cm). Hull (a tape laid round the
    // outside): measured 97.8 / 105.9 / 114.0 / 122.1 / 131.3, within 0.3 (M3: 97.4 … 128.8, up to 2.5 under). The bin-median
    // tape of M3 drops into the folds under the arms: 96.7 … 128.9, 1.1 to 2.3 under (M3: 1.6 to 4.7).
    SYNTHETIC_TEE_POM.forEach((row, i) => {
      expect(Math.abs(chest[i]!.hull - 2 * row.chestWidthCm), `${row.size} hull`).toBeLessThan(0.5);
      expect(chest[i]!.tape).toBeGreaterThan(2 * row.chestWidthCm - 2.8);
    });
    for (let i = 1; i < chest.length; i++) expect(chest[i]!.hull).toBeGreaterThan(chest[i - 1]!.hull);
  }, 240_000);

  it('a size too small for the body is not draped: the XXL body in S to XL (the fit engine: does not close at the chest), its own size and the M body in every size are', async () => {
    const bundle = await loadBundleFrom(serve(tee.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    const on = (id: (typeof MALE_BODY_SHAPE_IDS)[number]) => {
      const r = MALE_REFERENCE[id];
      const plan = planAvatar(bundle.anchors, { family: 'male', heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth });
      const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
      return { plan, session, fit: fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements) };
    };
    const xxl = on('XXL');
    // Measured: the body is 25, 17, 9 and 1 cm larger than S, M, L and XL at the chest (and waist), past what jersey gives.
    expect(sewnNotDrawn(xxl.session, xxl.plan.avatar, xxl.fit, 'S')).toEqual({ anchor: 'chest', bodyLargerCm: 25 });
    for (const size of ['M', 'L', 'XL']) expect(sewnNotDrawn(xxl.session, xxl.plan.avatar, xxl.fit, size)?.anchor).toBe('chest');
    expect(sewnNotDrawn(xxl.session, xxl.plan.avatar, xxl.fit, 'XXL')).toBeNull();
    const m = on('M');
    for (const size of MALE_BODY_SHAPE_IDS) expect(sewnNotDrawn(m.session, m.plan.avatar, m.fit, size), `M body in ${size}`).toBeNull();
    // A garment that is not sewn (every bundle before M3) is drawn as before, whatever the fit.
    const dressBundle = await loadBundleFrom(serve(dress.files), '/b', 'aalter-studio-2', { withPayload: false });
    const dressPlan = planAvatar(dressBundle.anchors, { bust: 120, waist: 110, hip: 125 });
    const dressSession = openSession(dressPlan.m, dressBundle, MOCK_GARMENTS_BY_ID['aalter-studio-2']!);
    expect(dressSession.sewn).toBe(false);
    for (const size of dressSession.bundle.grading.sizes.map((x) => x.size)) expect(sewnNotDrawn(dressSession, dressPlan.avatar, fitForBody(MOCK_GARMENTS_BY_ID['aalter-studio-2']!, dressPlan.avatar.measurements), size)).toBeNull();
  }, 120_000);

  it('the printed tee: base.glb carries UVs and the synthetic print, and welds back to the mesh the bundle grades and drapes', async () => {
    const bundle = await loadBundleFrom(serve(tee.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    expect(bundle.render).toBeDefined();
    expect(bundle.render!.image.mimeType).toBe('image/png');
    expect(bundle.baseMesh.positions.length).toBe(pom.baseMesh.positions.length);
    for (let i = 0; i < pom.baseMesh.positions.length; i++) expect(Math.abs(bundle.baseMesh.positions[i]! - pom.baseMesh.positions[i]!)).toBeLessThan(1e-3);
    expect(Array.from(bundle.baseMesh.indices)).toEqual(Array.from(pom.baseMesh.indices));
    expect(bundle.render!.remap.length).toBeGreaterThan(bundle.baseMesh.positions.length / 3);
    const qa = JSON.parse(tee.files['qa.json']) as { texture: { kind: string; licence: string } };
    expect(qa.texture).toMatchObject({ kind: 'synthetic-print', licence: 'CC0-1.0' });
  });

  it('against the M1 lofted test garment on the XXL body: the POM tee shows hundreds of times fewer body pixels', async () => {
    const m1 = buildBundle('synthetic-men-tee', { skipSeparation: true, generator: 'm1' });
    const before = await drapeOn(m1.files, 'XXL', 'XXL');
    const after = await drapeOn(tee.files, 'XXL', 'XXL');
    // Measured 19 Nov 2026: M1 2,924 cap and 483 hem pixels, cap share 20.9 %; POM 1 pixel, 0 %.
    expect(before.session.sewn).toBe(false);
    expect(before.pixels).toBeGreaterThan(1000);
    expect(before.through.cap).toBeGreaterThan(0.1);
    expect(after.pixels * 100).toBeLessThan(before.pixels);
  }, 240_000);
});
