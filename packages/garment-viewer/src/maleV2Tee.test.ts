/**
 * The POM tee BUILT on the male shape v2 (`buildPomBundle(…, { maleShape: 'v2' })`, the SYNTHETIC men's test tee, not a
 * product) in the viewer: the bundle names its shape and mounts on the v2 body only (and the v1-built bundle on the v1
 * body only); on the v2 table bodies S to XXL in their own size it drapes without the lift, the armhole strain and the
 * shoulder strain the v1-built tee had there. No WebGL: `planAvatar` and the drape the mount runs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE } from '@curtain/mannequin';
import { SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { pokes } from '../../../spikes/garment-engine/src/pokeThrough';
import { buildPomBundle, type PomBundle } from '../../../spikes/garment-engine/src/pomBundle';
import { SYNTHETIC_TEE_POM } from '../../../spikes/garment-engine/src/pomTeeSynthetic';
import { bundleMaleShapeOf, makeCollider } from './body';
import { loadBundleFrom, type FetchLike, type SpikeBundle } from './bundle';
import { checkBundle } from './bundleCheck';
import { isSettled, strainQuantile } from './cloth';
import { builtOffsets } from './core/grading';
import { gradedMesh, hullPerimeter, necklineStrain, openSession, prepareFit, relax, sewnNotDrawn, viewerMaterial, type FitInstance, type GarmentSession } from './engine';
import { fitForBody } from './fitting';
import { GarmentViewError, planAvatar } from './mount';

function serve(files: Record<string, string | Uint8Array>): FetchLike {
  return async (url) => {
    const data = files[url.split('/').pop()!];
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

type Id = (typeof MALE_BODY_SHAPE_IDS)[number];
const bodyOf = (id: Id) => {
  const r = MALE_REFERENCE[id];
  return { family: 'male' as const, heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth };
};
const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof GarmentViewError ? e.code : String(e);
  }
  return undefined;
};

let v2: PomBundle;
let v1: PomBundle;
let bundle: SpikeBundle;
let bundleV1: SpikeBundle;

beforeAll(async () => {
  v2 = buildPomBundle('synthetic-men-tee', SYNTHETIC_MENS_TEE, SYNTHETIC_TEE_POM, 'M', { texture: 'synthetic-print', maleShape: 'v2' });
  v1 = buildPomBundle('synthetic-men-tee', SYNTHETIC_MENS_TEE, SYNTHETIC_TEE_POM, 'M', { texture: 'plain' });
  bundle = await loadBundleFrom(serve(v2.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
  bundleV1 = await loadBundleFrom(serve(v1.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
}, 240_000);

interface Row {
  f: FitInstance;
  session: GarmentSession;
  lift: number;
  shoulderLine: number;
  worst: number;
  p99: number;
  pixels: number;
  inside: number;
  hull: number;
}

/** The drape the mount runs, for a table body in a size, on the v2 body with the v2-built bundle. */
function drape(body: Id, size: string): Row {
  const plan = planAvatar(bundle.anchors, bodyOf(body), null, 'v2');
  expect(plan.m.maleShape).toBe('v2');
  const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
  const f = prepareFit(session, plan.avatar, plan.field, fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements), size, viewerMaterial('product', bundle.material));
  const pos = relax(f);
  expect(isSettled(f.cloth, f.params), `${body} in ${size} settled`).toBe(true);
  expect(pos.every(Number.isFinite)).toBe(true);
  const lifted = Float64Array.from(pos);
  for (let i = 1; i < lifted.length; i += 3) lifted[i] = lifted[i]! + plan.garmentLiftCm;
  let pixels = 0;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const v of Object.values(pokes(plan.avatar.mesh, { positions: lifted, indices: f.indices }, yaw, () => 'all'))) pixels += v;
  const collide = makeCollider(plan.field, 0, session.chains, f.noCollide);
  const probe = Float32Array.from(pos);
  let inside = 0;
  for (let i = 0; i < probe.length / 3; i++) if (collide(probe, i)) inside++;
  let worst = 0;
  for (let e = 0; e < f.cloth.edgeRest.length; e++) {
    const a = f.cloth.edges[2 * e]!, b = f.cloth.edges[2 * e + 1]!, rest = f.cloth.edgeRest[e]!;
    if (rest > 0) worst = Math.max(worst, Math.hypot(pos[3 * a]! - pos[3 * b]!, pos[3 * a + 1]! - pos[3 * b + 1]!, pos[3 * a + 2]! - pos[3 * b + 2]!) / rest - 1);
  }
  // The chest line's own row of cloth (the row of the size as graded nearest its chest line: the tube's third row from the armhole).
  const g = gradedMesh(session, size).positions;
  const base = v2.base.mesh.positions;
  let best = Infinity;
  for (let i = 0; i < base.length / 3; i++) if (f.chains[i] === 0) best = Math.min(best, Math.abs(base[3 * i + 1]! - v2.base.levels.chestLineY));
  const ids: number[] = [];
  for (let i = 0; i < base.length / 3; i++) if (f.chains[i] === 0 && Math.abs(Math.abs(base[3 * i + 1]! - v2.base.levels.chestLineY) - best) < 1e-3) ids.push(i);
  expect(new Set(ids.map((i) => Math.round(g[3 * i + 1]! * 20))).size, 'the chest row is a row of the built size too').toBe(1);
  return { f, session, lift: f.seat!.liftCm, shoulderLine: necklineStrain(f, plan.m), worst, p99: strainQuantile(f.cloth, 0.99), pixels, inside: inside / (probe.length / 3), hull: hullPerimeter(ids.map((i) => [pos[3 * i]!, pos[3 * i + 2]!] as [number, number])) };
}

describe('the POM tee built on the male shape v2, in the viewer', () => {
  it('names its shape; the device check and the mount take it on the v2 body only, and the v1-built bundle on the v1 body only (strict both ways, like the family)', () => {
    expect(bundleMaleShapeOf(bundle.anchors)).toBe('v2');
    expect(bundleMaleShapeOf(bundleV1.anchors)).toBe('v1');
    expect(bundleMaleShapeOf({})).toBe('v1');
    const meta = (b: SpikeBundle) => ({ anchors: b.anchors, grading: b.grading, material: b.material, qa: b.qa });
    expect(checkBundle(meta(bundle), SYNTHETIC_MENS_TEE, 'v2')).toMatchObject({ family: 'male', maleShape: 'v2' });
    expect(checkBundle(meta(bundle), SYNTHETIC_MENS_TEE, 'v1')).toBeNull();
    expect(checkBundle(meta(bundleV1), SYNTHETIC_MENS_TEE, 'v1')).toMatchObject({ family: 'male' });
    expect(checkBundle(meta(bundleV1), SYNTHETIC_MENS_TEE, 'v2')).toBeNull();
    const body = bodyOf('M');
    expect(planAvatar(bundle.anchors, body, null, 'v2').m.maleShape).toBe('v2');
    expect(code(() => planAvatar(bundle.anchors, body, null, 'v1'))).toBe('incompatible');
    expect(code(() => planAvatar(bundle.anchors, body, null))).toBe('incompatible');
    expect(code(() => planAvatar(bundleV1.anchors, body, null, 'v2'))).toBe('incompatible');
    expect(planAvatar(bundleV1.anchors, body, null, 'v1').m.maleShape).toBeUndefined();
    expect(planAvatar(bundleV1.anchors, { family: 'male' }, null).m.maleShape).toBeUndefined();
    // Still the other family first.
    expect(code(() => planAvatar(bundle.anchors, { family: 'female' }, null, 'v2'))).toBe('incompatible');
    // The sizes other than the base are built sizes; nothing of the base garment is exempt from the v2 body.
    const session = openSession(planAvatar(bundle.anchors, body, null, 'v2').m, bundle, SYNTHETIC_MENS_TEE);
    const n = bundle.baseMesh.positions.length / 3;
    for (const size of ['S', 'L', 'XL', 'XXL']) expect(builtOffsets(bundle.grading.built, size, n), size).not.toBeNull();
    expect(session.sewn).toBe(true);
    expect(session.noCollide.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('S to XXL on the v2 table bodies in their own size: at most 0.5 cm of lift, the shoulder line under 3 %, no edge over 40 %, p99 under 16 %, no body through the cloth, the chest row within 1 cm of the tape', () => {
    // Measured 19 Nov 2026, S … XXL (the v1-built tee on the same v2 bodies, male.test.ts, in brackets):
    //   seat lift       0 / 0.25 / 0.5 / 0.25 / 0.25 cm     (built on v2 but morphed: 0 / 0.25 / 0.75 / 1.25 / 2; v1 on v1: 0 / 0 / 1.25 / 2 / 2.75)
    //   shoulder line   0.8 / 0.9 / 0.4 / 0.5 / 0.7 %        (0 / 1.9 / 10.6 / 17.1 / 20.4)
    //   largest edge    30 / 30 / 26 / 26 / 28 %             (v1 on v1: 23 / 34 / 27 / 93 / 119, at the armpit)
    //   p99             14.0 / 14.5 / 14.5 / 14.2 / 14.5 %   (13.1 … 14.2)
    //   body pixels     0 in four views, every size          (0 / 6 / 0 / 0 / 0)
    //   chest row hull  97.8 / 105.8 / 114.0 / 122.0 / 130.8 cm against 98 / 106 / 114 / 122 / 131
    const rows = {} as Record<Id, Row>;
    for (const id of MALE_BODY_SHAPE_IDS) rows[id] = drape(id, id);
    SYNTHETIC_TEE_POM.forEach((row) => {
      const x = rows[row.size as Id];
      expect(x.lift, `${row.size} lift`).toBeLessThanOrEqual(0.5);
      expect(x.shoulderLine, `${row.size} shoulder line`).toBeLessThan(0.03);
      expect(x.worst, `${row.size} largest edge`).toBeLessThan(0.4);
      expect(x.p99, `${row.size} p99`).toBeLessThan(0.16);
      expect(x.pixels, `${row.size} pixels`).toBeLessThanOrEqual(2);
      expect(x.inside, `${row.size} inside`).toBeLessThan(0.005);
      expect(Math.abs(x.hull - 2 * row.chestWidthCm), `${row.size} chest hull`).toBeLessThan(1);
    });
  }, 240_000);

  it('off size: the M body in every size and the S body in XXL drape with no body through the cloth; the XXL body in S to L is not drawn (the fit engine: it does not close at the chest)', () => {
    // Measured 19 Nov 2026: M body in S … XXL: lift 0.75 / 0.25 / 0 / 0 / 0, shoulder line 6.2 / 0.9 / 0 / 0 / 0 %, pixels 0.
    for (const size of ['S', 'L', 'XL', 'XXL']) {
      const x = drape('M', size);
      expect(x.pixels, `M in ${size}`).toBeLessThanOrEqual(2);
      expect(x.shoulderLine, `M in ${size}`).toBeLessThan(size === 'S' ? 0.1 : 0.03);
      expect(x.worst, `M in ${size}`).toBeLessThan(0.45);
    }
    expect(drape('S', 'XXL').pixels).toBeLessThanOrEqual(2);
    const plan = planAvatar(bundle.anchors, bodyOf('XXL'), null, 'v2');
    const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
    const fit = fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements);
    for (const size of ['S', 'M', 'L']) expect(sewnNotDrawn(session, plan.avatar, fit, size), size).toMatchObject({ anchor: 'chest' });
    expect(sewnNotDrawn(session, plan.avatar, fit, 'XXL')).toBeNull();
  }, 240_000);
});
