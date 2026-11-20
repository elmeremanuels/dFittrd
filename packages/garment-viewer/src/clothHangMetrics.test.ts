/**
 * Numbers for docs/reports/claude/cloth-hang.md: what the device drape does to the lengths of hanging garments. Skipped
 * unless CLOTH_HANG names a folder:
 *   CLOTH_HANG=/tmp/hang pnpm --filter @curtain/garment-viewer exec vitest run src/clothHangMetrics.test.ts
 * CLOTH_HANG_VARIANT picks the solver settings (`VARIANTS` below: default, before, hold); the file written is
 * `metrics-<variant>.json`. CLOTH_HANG_ONLY=dress,tee,… limits the garments.
 *
 * Garments (all SYNTHETIC or stand-ins, none is a product's picture):
 * - `dress`: the tape-built babydoll dress (spikes `pomDress.ts`), AU 8 to 16 chart bodies in their own size, AU 8, 12
 *   and 16 typed at 156 and 180 cm, and the AU 12 body in AU 8 and 16 (the spread).
 * - `tee`: the men's tee built on the male shape v2 (`pomBundle.ts`), bodies S to XXL in their own size.
 * - `azure*`, `skirt*`, `palazzo*`: STAND-INS. The photo-reconstructed bundles of these products live in the git-ignored
 *   `out/eval/` and are not in a fresh checkout. Each stand-in is the product's own committed payload (chart, fabric,
 *   stretch) through the same evaluation code, on a synthetic mesh: the spike's shirt dress with its simulated
 *   reconstruction error, that dress cut off at the waist, and the trouser proxy opened as a garment.
 * - `lofted`: the spike's synthetic dress `aalter-studio-2` (the parity bundle).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { AU_WOMENS_BODY_CHART, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE, type Mesh } from '@curtain/mannequin';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { evaluateGarment } from '../../../spikes/garment-engine/src/eval';
import { evalBundle } from '../../../spikes/garment-engine/src/evalBundle';
import { fixtureMannequin, reconstructedDress, shopPayload, syntheticSkirt } from '../../../spikes/garment-engine/src/evalFixtures';
import { buildPomBundle, torsoTapeAt } from '../../../spikes/garment-engine/src/pomBundle';
import { measurePomDress } from '../../../spikes/garment-engine/src/pomDress';
import { buildPomDressBundle } from '../../../spikes/garment-engine/src/pomDressBundle';
import { SYNTHETIC_DRESS_ID, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE, SYNTHETIC_TAPE_DRESS } from '../../../spikes/garment-engine/src/pomDressSynthetic';
import { measurePomTee } from '../../../spikes/garment-engine/src/pomTee';
import { SYNTHETIC_TEE_POM } from '../../../spikes/garment-engine/src/pomTeeSynthetic';
import { syntheticGarmentFromProxy } from '../../../spikes/garment-engine/src/proxy';
import { hangMetrics, residualMotionCm, sliceGirth } from '../test/hangMetrics';
import { loadBundleFrom, type FetchLike, type SpikeBundle } from './bundle';
import { addHangLines, hangStretchOf } from './cloth';
import { gradedMesh, openSession, prepareFit, relax, sewnNotDrawn, viewerMaterial, type FitInstance, type GarmentSession } from './engine';
import { fitForBody } from './fitting';
import { planAvatar, type AvatarPlan } from './mount';
import type { GarmentPayload } from '@curtain/schema';

const out = process.env.CLOTH_HANG;
const variant = process.env.CLOTH_HANG_VARIANT ?? 'default';
const only = process.env.CLOTH_HANG_ONLY?.split(',');

/**
 * Solver settings by name: what the report compares. `default`: as the viewer ships (hold length only where the bundle
 * asks for it); `before`: hold length off everywhere (the solver of before this change); `hold`: on for every garment.
 */
const VARIANTS: Record<string, (f: FitInstance, stretchPct: number) => void> = {
  default: () => undefined,
  before: (f) => { delete f.params.hangStretch; },
  hold: (f, stretchPct) => { if (!f.cloth.hang) addHangLines(f.cloth); f.params.hangStretch = hangStretchOf(stretchPct); },
};

const serve = (files: Record<string, string | Uint8Array>): FetchLike => async (url) => {
  const data = files[url.split('/').pop()!];
  if (data === undefined) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, json: async () => JSON.parse(data as string) as unknown, arrayBuffer: async () => { const u = data as Uint8Array; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; } };
};
const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

interface Draped { f: FitInstance; pos: Float32Array; row: Record<string, unknown> }

/** One drape the way the mount runs it, measured. `extra` reads garment-specific tape from the settled cloth. */
function drape(tag: string, session: GarmentSession, plan: AvatarPlan, payload: GarmentPayload, bundle: SpikeBundle, size: string, extra?: (pos: Float32Array, graded: ArrayLike<number>) => Record<string, unknown>): Draped {
  const fit = fitForBody(payload, plan.avatar.measurements);
  const f = prepareFit(session, plan.avatar, plan.field, fit, size, viewerMaterial('product', bundle.material));
  VARIANTS[variant]!(f, bundle.material.stretchPct);
  const t0 = performance.now();
  relax(f);
  const ms = performance.now() - t0;
  const pos = Float32Array.from(f.cloth.pos);
  const simulatedS = f.cloth.time;
  const hang = hangMetrics(f.cloth);
  const more = extra?.(pos, gradedMesh(session, size).positions) ?? {};
  const residualCm = residualMotionCm(f.cloth, f.params, f.collide, 1);
  return { f, pos, row: { case: tag, size, stretchPct: bundle.material.stretchPct, holdLength: f.params.hangStretch ?? null, drapeMs: Math.round(ms), simulatedS: r2(simulatedS), msPerFrame: r2(ms / Math.max(1, Math.round(simulatedS * 60))), ...hang, residualCm, ...more } };
}

/** How much of the graded girth difference between two sizes is left after the drape, at heights `ys` (same body). */
function spread(small: Draped, large: Draped, gradedSmall: ArrayLike<number>, gradedLarge: ArrayLike<number>, ys: readonly number[]): Record<string, unknown>[] {
  return ys.map((y) => {
    const g = sliceGirth(gradedLarge, large.f.indices, y) - sliceGirth(gradedSmall, small.f.indices, y);
    const d = sliceGirth(large.pos, large.f.indices, y) - sliceGirth(small.pos, small.f.indices, y);
    return { y: r1(y), gradedCm: r1(g), drapedCm: r1(d), survivesPct: Math.round((100 * d) / g) };
  });
}

describe.skipIf(!out)('cloth hang metrics (CLOTH_HANG)', () => {
  it('drapes and measures', async () => {
    mkdirSync(out!, { recursive: true });
    const rows: Record<string, unknown>[] = [];
    const spreads: Record<string, unknown> = {};
    const want = (k: string): boolean => !only || only.includes(k);

    if (want('dress')) {
      const pom = buildPomDressBundle(SYNTHETIC_DRESS_ID, SYNTHETIC_TAPE_DRESS, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE.provenance);
      const one = async (body: string, size: string, heightCm?: number): Promise<Draped & { session: GarmentSession }> => {
        const chart = AU_WOMENS_BODY_CHART.find((r) => r.size === body)!;
        const bundle = await loadBundleFrom(serve(pom.files), '/b', SYNTHETIC_DRESS_ID, { withPayload: false });
        const plan = planAvatar(bundle.anchors, { bust: chart.bust!, waist: chart.waist!, hip: chart.hip!, ...(heightCm ? { heightCm } : {}) });
        const session = openSession(plan.m, bundle, SYNTHETIC_TAPE_DRESS);
        const tape = SYNTHETIC_DRESS_POM.find((x) => x.size === size)!;
        const d = drape(`dress body-${body}${heightCm ? `-${heightCm}cm` : ''} size-${size}`, session, plan, SYNTHETIC_TAPE_DRESS, bundle, size, (pos, graded) => {
          const t = measurePomDress(pos, pom.base), g = measurePomDress(graded, pom.base);
          return {
            lengthCm: { tape: tape.lengthCm, rest: r2(g.lengthCm), draped: r2(t.lengthCm), overTapePct: r2((t.lengthCm / tape.lengthCm - 1) * 100) },
            bodiceLengthCm: { tape: tape.bodiceLengthCm, rest: r2(g.bodiceLengthCm), draped: r2(t.bodiceLengthCm) },
            skirtLengthCm: { rest: r2(g.lengthCm - g.bodiceLengthCm), draped: r2(t.lengthCm - t.bodiceLengthCm), overRestPct: r2(((t.lengthCm - t.bodiceLengthCm) / (g.lengthCm - g.bodiceLengthCm) - 1) * 100) },
            seamCm: { tape: 2 * tape.seamWidthCm, draped: r2(2 * t.seamWidthCm) },
            bustCm: { tape: 2 * tape.bustWidthCm, draped: r2(2 * t.bustWidthCm) },
            skirtTopCm: { tape: 2 * (tape.skirtTopWidthCm ?? tape.seamWidthCm), draped: r2(2 * t.skirtTopWidthCm!) },
            hemCm: { tape: 2 * tape.hemWidthCm, draped: r2(2 * t.hemWidthCm) },
            strapCm: { tape: tape.strapLengthCm, draped: r2(t.strapLengthCm) },
          };
        });
        rows.push(d.row);
        await new Promise((r) => setTimeout(r, 0));
        return { ...d, session };
      };
      for (const s of ['8', '10', '12', '14', '16']) await one(s, s);
      for (const h of [156, 180]) for (const s of ['8', '12', '16']) await one(s, s, h);
      const a = await one('12', '8'), b = await one('12', '16');
      const m = a.session.m;
      spreads['dress AU 8 to 16 on the AU 12 body'] = spread(a, b, gradedMesh(a.session, '8').positions, gradedMesh(b.session, '16').positions, [m.morphHeights.underbust - 4, m.morphHeights.waist, m.morphHeights.hip, m.morphHeights.hip - 10]);
    }

    if (want('tee')) {
      const pom = buildPomBundle('synthetic-men-tee', SYNTHETIC_MENS_TEE, SYNTHETIC_TEE_POM, 'M', { texture: 'plain', maleShape: 'v2' });
      for (const id of MALE_BODY_SHAPE_IDS) {
        const bundle = await loadBundleFrom(serve(pom.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
        const r = MALE_REFERENCE[id];
        const plan = planAvatar(bundle.anchors, { family: 'male', heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth }, undefined, 'v2');
        const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
        if (sewnNotDrawn(session, plan.avatar, fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements), id)) { rows.push({ case: `tee body-${id} size-${id}`, notDrawn: true }); continue; }
        const tape = SYNTHETIC_TEE_POM.find((x) => x.size === id)!;
        const measure = (p: ArrayLike<number>) => measurePomTee(plan.m, { ...pom.base, mesh: { ...pom.base.mesh, positions: Float64Array.from(p) } as Mesh }, torsoTapeAt);
        rows.push(drape(`tee body-${id} size-${id}`, session, plan, SYNTHETIC_MENS_TEE, bundle, id, (pos, graded) => {
          const t = measure(pos), g = measure(graded);
          return {
            lengthCm: { tape: tape.lengthCm, rest: r2(g.lengthCm), draped: r2(t.lengthCm), overRestPct: r2((t.lengthCm / g.lengthCm - 1) * 100) },
            chestCm: { tape: 2 * tape.chestWidthCm, rest: r2(2 * g.chestWidthCm), draped: r2(2 * t.chestWidthCm) },
            hemCm: { tape: 2 * tape.hemWidthCm, rest: r2(2 * g.hemWidthCm), draped: r2(2 * t.hemWidthCm) },
            sleeveLengthCm: { tape: tape.sleeveLengthCm, rest: r2(g.sleeveLengthCm), draped: r2(t.sleeveLengthCm) },
          };
        }).row);
      }
    }

    // Stand-ins and the lofted dress: the canonical female body (M), sizes 8, 12 and 16 (or XS, M, XL).
    const onBase = async (key: string, files: Record<string, string | Uint8Array>, id: string, sizes: readonly string[], payload?: GarmentPayload): Promise<void> => {
      const done: (Draped & { session: GarmentSession })[] = [];
      for (const size of sizes) {
        const bundle = await loadBundleFrom(serve(files), '/b', id, payload ? { withPayload: false } : {});
        const plan = planAvatar(bundle.anchors, null);
        const session = openSession(plan.m, bundle, payload ?? bundle.payload);
        const d = drape(`${key} base-body size-${size}`, session, plan, session.payload, bundle, size, (pos, graded) => {
          let top = -Infinity, low = Infinity, top0 = -Infinity, low0 = Infinity;
          for (let i = 1; i < pos.length; i += 3) { top = Math.max(top, pos[i]!); low = Math.min(low, pos[i]!); top0 = Math.max(top0, graded[i]!); low0 = Math.min(low0, graded[i]!); }
          return { plumbCm: { rest: r2(top0 - low0), draped: r2(top - low) } };
        });
        rows.push(d.row);
        done.push({ ...d, session });
      }
      const a = done[0]!, b = done[done.length - 1]!, m = a.session.m;
      spreads[`${key} ${sizes[0]} to ${sizes[sizes.length - 1]} on the base body`] = spread(a, b, gradedMesh(a.session, sizes[0]!).positions, gradedMesh(b.session, sizes[sizes.length - 1]!).positions, [m.morphHeights.hip, m.morphHeights.thigh, m.morphHeights.knee, m.morphHeights.knee - 20].filter((y) => Number.isFinite(sliceGirth(a.pos, a.f.indices, y))));
    };
    const standIn = (handle: string, mesh: Mesh): Record<string, string | Uint8Array> => {
      const shop = shopPayload(handle);
      const r = evaluateGarment({ productId: handle, payload: shop.payload, baseSize: shop.baseSize, mesh, mannequin: fixtureMannequin, source: { kind: 'stage4', path: 'stand-in', simulatedError: null } });
      return evalBundle(r, shop.payload).files as unknown as Record<string, string | Uint8Array>;
    };
    if (want('azure')) await onBase('azure-stand-in', standIn('azure-palm-baby-doll-dress', reconstructedDress()), 'azure-palm-baby-doll-dress', ['8', '12', '16']);
    if (want('skirt')) await onBase('skirt-stand-in', standIn('crimson-wildflower-maxi-skirt', syntheticSkirt()), 'crimson-wildflower-maxi-skirt', ['8', '12', '16']);
    if (want('palazzo')) {
      const shop = shopPayload('rosewater-palazzo-pants');
      await onBase('palazzo-stand-in', standIn('rosewater-palazzo-pants', syntheticGarmentFromProxy(fixtureMannequin, shop.payload, shop.baseSize)), 'rosewater-palazzo-pants', ['8', '12', '16']);
    }
    if (want('lofted')) await onBase('lofted-dress', buildBundle('aalter-studio-2', { skipSeparation: true }).files as unknown as Record<string, string | Uint8Array>, 'aalter-studio-2', ['XS', 'M', 'XL']);

    writeFileSync(join(out!, `metrics-${variant}.json`), `${JSON.stringify({ variant, rows, spreads }, null, 2)}\n`);
  }, 3_600_000);
});
