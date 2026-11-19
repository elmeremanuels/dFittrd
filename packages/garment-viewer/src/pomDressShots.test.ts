/**
 * Pictures and numbers of the SYNTHETIC tape-built babydoll dress (spikes/garment-engine `pomDress.ts`) draped with the
 * viewer's own steps (`prepareFit` + `relax`), for docs/reports/claude/dress-from-tape.md. Skipped unless DRESS_SHOTS
 * names a folder: `DRESS_SHOTS=/tmp/dress pnpm --filter @curtain/garment-viewer exec vitest run src/pomDressShots.test.ts`.
 *
 * Bodies: the AU 8 to 16 chart bodies at the bundle body's stature (what the embed draws for a women's product today),
 * each in its own size, and the same bodies with a typed height of 156 and 180 cm (the second stature). Writes front,
 * side and back PNGs from the spike's software renderer (not WebGL; the embed pictures come from scripts/demo-dress.mjs)
 * and `metrics.json`: the dress's own tape after the drape, where the top edge, the seam and the hem lie on the drawn
 * body, strain, and body pixels showing through the cloth.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { AU_WOMENS_BODY_CHART } from '@curtain/schema';
import { buildBody } from '@curtain/mannequin';
import { pokes, render } from '../../../spikes/garment-engine/src/pokeThrough';
import { measurePomDress } from '../../../spikes/garment-engine/src/pomDress';
import { buildPomDressBundle } from '../../../spikes/garment-engine/src/pomDressBundle';
import { SYNTHETIC_DRESS_ID, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE, SYNTHETIC_TAPE_DRESS } from '../../../spikes/garment-engine/src/pomDressSynthetic';
import { loadBundleFrom, type FetchLike } from './bundle';
import { strainQuantile } from './cloth';
import { hullPerimeter, openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';
import { planAvatar } from './mount';

const out = process.env.DRESS_SHOTS;

const serve = (files: Record<string, string | Uint8Array>): FetchLike => async (url) => {
  const data = files[url.split('/').pop()!]!;
  return { ok: true, status: 200, json: async () => JSON.parse(data as string) as unknown, arrayBuffer: async () => { const u = data as Uint8Array; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; } };
};
const r1 = (x: number): number => Math.round(x * 10) / 10;

describe.skipIf(!out)('tape-built dress shots (DRESS_SHOTS)', () => {
  it('drapes, measures and renders', async () => {
    mkdirSync(out!, { recursive: true });
    const pom = buildPomDressBundle(SYNTHETIC_DRESS_ID, SYNTHETIC_TAPE_DRESS, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE.provenance);
    const ids = pom.base;
    const meanY = (pos: ArrayLike<number>, ring: readonly number[]): number => ring.reduce((s, i) => s + pos[3 * i + 1]!, 0) / ring.length;
    const hull = (pos: ArrayLike<number>, ring: readonly number[]): number => hullPerimeter(ring.map((i) => [pos[3 * i]!, pos[3 * i + 2]!] as [number, number]));
    const metrics: Record<string, unknown>[] = [];
    const cases: { body: string; size: string; heightCm?: number }[] = [];
    for (const size of ['8', '10', '12', '14', '16']) cases.push({ body: size, size });
    for (const heightCm of [156, 180]) for (const size of ['8', '12', '16']) cases.push({ body: size, size, heightCm });
    // Off size: the AU 12 body in every size.
    for (const size of ['8', '10', '14', '16']) cases.push({ body: '12', size });
    for (const c of cases) {
      const chart = AU_WOMENS_BODY_CHART.find((r) => r.size === c.body)!;
      const bundle = await loadBundleFrom(serve(pom.files), '/b', SYNTHETIC_DRESS_ID, { withPayload: false });
      const plan = planAvatar(bundle.anchors, { bust: chart.bust!, waist: chart.waist!, hip: chart.hip!, ...(c.heightCm ? { heightCm: c.heightCm } : {}) });
      const session = openSession(plan.m, bundle, SYNTHETIC_TAPE_DRESS);
      const fit = fitForBody(SYNTHETIC_TAPE_DRESS, plan.avatar.measurements);
      const f = prepareFit(session, plan.avatar, plan.field, fit, c.size, viewerMaterial('product', bundle.material));
      const start = Float32Array.from(f.cloth.pos);
      const t0 = Date.now();
      const pos = relax(f);
      const ms = Date.now() - t0;
      const lift = plan.garmentLiftCm;
      const lifted = Float64Array.from(pos);
      for (let i = 1; i < lifted.length; i += 3) lifted[i] = lifted[i]! + lift;
      // The drawn body's own levels: a typed height is a body of its own; without one, the bundle body's levels.
      const drawn = c.heightCm ? buildBody({ family: 'female', bust: chart.bust!, waist: chart.waist!, hip: chart.hip!, heightCm: c.heightCm }) : plan.m;
      const tape = measurePomDress(pos, ids);
      const row = SYNTHETIC_DRESS_POM.find((x) => x.size === c.size)!;
      const region = (y: number): string => (y >= drawn.morphHeights.underbust ? 'bodice' : y >= drawn.morphHeights.hip ? 'waist-hip' : 'skirt');
      const px: Record<string, number> = { bodice: 0, 'waist-hip': 0, skirt: 0 };
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const [k, v] of Object.entries(pokes(plan.avatar.mesh, { positions: lifted, indices: f.indices }, yaw, region))) px[k.split(' ')[1]!] = (px[k.split(' ')[1]!] ?? 0) + v;
      const tag = `body-${c.body}${c.heightCm ? `-${c.heightCm}cm` : ''}-size-${c.size}`;
      metrics.push({
        case: tag, body: c.body, heightCm: c.heightCm ?? null, size: c.size, provenance: SYNTHETIC_DRESS_TAPE.provenance[c.size], recommended: fit.recommendedSize ?? null, sewn: session.sewn,
        pinned: f.pinned.reduce((s, x) => s + x, 0), particles: f.pinned.length, drapeMs: ms, simulatedS: r1(f.cloth.time), garmentLiftCm: r1(lift),
        tapeCm: {
          bust: { tape: 2 * row.bustWidthCm, draped: r1(2 * tape.bustWidthCm) },
          seam: { tape: 2 * row.seamWidthCm, draped: r1(2 * tape.seamWidthCm), drapedHull: r1(hull(pos, ids.seam)) },
          skirtTop: { tape: 2 * (row.skirtTopWidthCm ?? row.seamWidthCm), draped: r1(2 * tape.skirtTopWidthCm!) },
          hemSweep: { tape: 2 * row.hemWidthCm, draped: r1(2 * tape.hemWidthCm), drapedHull: r1(hull(pos, ids.hem)), startHull: r1(hull(start, ids.hem)) },
          length: { tape: row.lengthCm, draped: r1(tape.lengthCm) },
          bodiceLength: { tape: row.bodiceLengthCm, draped: r1(tape.bodiceLengthCm) },
          strap: { tape: row.strapLengthCm, draped: r1(tape.strapLengthCm) },
        },
        onDrawnBodyCm: {
          topEdgeAboveBustLine: r1(meanY(pos, ids.topEdge) + lift - drawn.morphHeights.chest),
          topEdgeDropInDrape: r1(meanY(start, ids.topEdge) - meanY(pos, ids.topEdge)),
          seamAboveUnderbust: r1(meanY(pos, ids.seam) + lift - drawn.morphHeights.underbust),
          hemAboveKnee: r1(meanY(pos, ids.hem) + lift - drawn.morphHeights.knee),
          hemBelowHip: r1(drawn.morphHeights.hip - meanY(pos, ids.hem) - lift),
        },
        strainP99Pct: r1(strainQuantile(f.cloth, 0.99) * 100),
        strainMaxPct: r1(strainQuantile(f.cloth, 1) * 100),
        showThroughPixels: px,
      });
      const cy = 0.55 * (plan.statureCm || plan.m.statureCm);
      for (const [view, yaw] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]] as const)
        render([{ mesh: plan.avatar.mesh, color: [196, 170, 150] }, { mesh: { positions: lifted, indices: f.indices }, color: [47, 127, 134] }], yaw, join(out!, `${tag}-${view}.png`), 400, 600, { cx: 0, cy, half: 62 });
    }
    writeFileSync(join(out!, 'metrics.json'), `${JSON.stringify({ levels: pom.base.levels, metrics }, null, 2)}\n`);
  }, 1_800_000);
});
