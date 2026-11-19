/**
 * Pictures and numbers of the POM chino (men-3d-plan slices M3/M4) draped on the male S…XXL bodies, for the report
 * (docs/reports/claude/men-chino.md). Skipped unless CHINO_SHOTS names a folder: `CHINO_SHOTS=/tmp/chino pnpm --filter
 * @curtain/garment-viewer exec vitest run src/pomChinoShots.test.ts`. Writes front / side / back PNGs per body from the
 * spike's software renderer (not WebGL, no texture; the embed pictures come from scripts/demo-men-chino.mjs) and
 * `metrics.json` (`chinoDrape` of `test/chinoDrape.ts`: tape after the drape, strain by region, show-through, band slide).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { MALE_BODY_SHAPE_IDS } from '@curtain/mannequin';
import { render } from '../../../spikes/garment-engine/src/pokeThrough';
import { buildPomChinoBundle } from '../../../spikes/garment-engine/src/pomChinoBundle';
import { SYNTHETIC_CHINO_BASE_SIZE, SYNTHETIC_CHINO_BODY, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM } from '../../../spikes/garment-engine/src/pomChinoSynthetic';
import { chinoDrape, loadChino } from '../test/chinoDrape';

const out = process.env.CHINO_SHOTS;

describe.skipIf(!out)('POM chino shots (CHINO_SHOTS)', () => {
  it('drapes, measures and renders', async () => {
    mkdirSync(out!, { recursive: true });
    const built = buildPomChinoBundle(SYNTHETIC_CHINO_PAYLOAD.id, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM, SYNTHETIC_CHINO_BASE_SIZE, { bodyOfWaist: SYNTHETIC_CHINO_BODY });
    const bundle = await loadChino(built);
    const metrics: unknown[] = [];
    const sizes = SYNTHETIC_CHINO_POM.map((r) => r.size);
    const cases: [(typeof MALE_BODY_SHAPE_IDS)[number], string | null, boolean][] = [];
    // Each body in the size the fit engine recommends (null: asked from it), then every W/32 on the M and the XXL body, and the three legs.
    for (const id of MALE_BODY_SHAPE_IDS) cases.push([id, null, true]);
    for (const s of sizes.filter((x) => x.endsWith('/32'))) { cases.push(['M', s, false]); cases.push(['XXL', s, false]); }
    for (const s of ['34/30', '34/34']) cases.push(['M', s, true]);
    for (const [id, size, pictures] of cases) {
      const r = chinoDrape(built, bundle, id, size);
      metrics.push(r.metrics);
      if (pictures && r.drawn) for (const [view, yaw] of [['front', 0], ['side', Math.PI / 2], ['back', Math.PI]] as const)
        render([{ mesh: r.drawn.body, color: [176, 152, 138] }, { mesh: r.drawn.cloth, color: [184, 159, 122] }], yaw, join(out!, `chino-body-${id}-size-${r.metrics.size.replace('/', 'x')}-${view}.png`), 400, 600, { cx: 0, cy: 62, half: 44 });
    }
    writeFileSync(join(out!, 'metrics.json'), `${JSON.stringify({ base: built.base.levels, metrics }, null, 2)}\n`);
  }, 900_000);
});
