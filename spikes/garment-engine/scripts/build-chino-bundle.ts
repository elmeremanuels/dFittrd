/**
 * `pnpm --filter @curtain/garment-spike exec tsx scripts/build-chino-bundle.ts [--plain] [--male-shape=v2]`: the SYNTHETIC men's test chino
 * W/L (not a product) as a device bundle in `out/synthetic-men-chino-wl/` (git-ignored), built by the POM chino builder
 * from its flat measurements (`src/pomChinoSynthetic.ts`). Writes payload.json too (the fixture's chart with W40 to W44
 * added), which the demo seed reads. `--male-shape=v2` builds it on the male shape v2 (the bundle then says so and is
 * shown on a v2 body only); without it on v1, the default. Prints the tape check and what the device's grading misses.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHINO_KEYS, POM_CHINO_TAPE_TOLERANCE_CM, buildPomChinoBundle } from '../src/pomChinoBundle';
import { SYNTHETIC_CHINO_BASE_SIZE, SYNTHETIC_CHINO_BODY, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM } from '../src/pomChinoSynthetic';

const plain = process.argv.includes('--plain');
const maleShape = process.argv.includes('--male-shape=v2') ? ('v2' as const) : ('v1' as const);
const outDir = resolve(fileURLToPath(new URL('../out', import.meta.url)), SYNTHETIC_CHINO_PAYLOAD.id);
const t0 = Date.now();
const bundle = buildPomChinoBundle(SYNTHETIC_CHINO_PAYLOAD.id, SYNTHETIC_CHINO_PAYLOAD, SYNTHETIC_CHINO_POM, SYNTHETIC_CHINO_BASE_SIZE, { texture: plain ? 'plain' : 'synthetic-detail', bodyOfWaist: SYNTHETIC_CHINO_BODY, maleShape });
const ms = Date.now() - t0;
mkdirSync(outDir, { recursive: true });
let total = 0;
for (const [name, data] of Object.entries(bundle.files)) {
  writeFileSync(join(outDir, name), data);
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  total += bytes;
  console.log(`${name.padEnd(14)} ${String(bytes).padStart(8)} bytes  (${gzipSync(data).length} gzip)`);
}
writeFileSync(join(outDir, 'payload.json'), `${JSON.stringify(SYNTHETIC_CHINO_PAYLOAD, null, 2)}\n`);
console.log(`five files ${total} bytes, male shape ${maleShape}, built in ${ms} ms → ${outDir}`);
const f = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(2);
console.log(`\ntape, built minus asked, cm (gate ${POM_CHINO_TAPE_TOLERANCE_CM}; the outseam is checked only)\n${['size', 'body', ...CHINO_KEYS.map((k) => k.replace(/WidthCm|Cm/, ''))].join('\t')}\tcrotch ease\tband below worn\ttilt`);
for (const t of bundle.tape) console.log([t.size, t.body, ...CHINO_KEYS.map((k) => f(t.errorCm[k])), t.levels.crotchEaseCm, t.levels.bandBelowWornCm, t.levels.tiltCm].join('\t'));
console.log(`\ndevice grading of the base mesh, graded minus asked, cm`);
for (const g of bundle.gradingCheck) console.log([g.size, '', ...CHINO_KEYS.map((k) => f(g.errorCm[k]))].join('\t'));
const h = JSON.parse(bundle.files['qa.json']) as { meshHealth: unknown; texture?: { edgeRatioFlatToGarment: unknown; islands: unknown } };
console.log('\nmesh', JSON.stringify(h.meshHealth));
if (h.texture) console.log('uv', JSON.stringify(h.texture.edgeRatioFlatToGarment), JSON.stringify(h.texture.islands));
if (!JSON.parse(bundle.files['qa.json']).pomTape.pass) {
  console.error('the tape gate fails');
  process.exit(1);
}
