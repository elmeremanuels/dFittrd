#!/usr/bin/env node
/**
 * The pilot skirt's waistband on the three test bodies (docs/research/step3-rings-usertest.md): how
 * far each size's band stretches at the waist and whether, stretched, it passes over the hips (the
 * skirt is assumed pull-on; the tape page does not state the closure). Band girths: the shop's tape
 * (AU 8, 10, 14 measured; AU 12 interpolated, AU 16 extrapolated, labelled per row). Prints Markdown
 * tables. Garment physics of the band input only: the size advice comes from @curtain/fit-engine alone.
 *
 *   node scripts/band-sweep.mjs            # the measured band (PILOT_SKIRT_TAPE)
 *   node scripts/band-sweep.mjs --assumed  # the old ASSUMED scenarios (used while nothing was measured)
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const web = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = await createServer({ root: web, configFile: join(web, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn', optimizeDeps: { noDiscovery: true } });
try {
  const { ASSUMED_BAND_SCENARIOS, assumedBand, bandSweep, pilotSkirtInputs, PILOT_SKIRT_TAPE, sourceAt } = await server.ssrLoadModule('/src/render/ringInputs.ts');
  // The pilot skirt's chart (Crimson Wildflower Maxi Skirt, AU 8-16, body chart, cm).
  const chart = [
    { size: '8', bust: 85, waist: 67.5, hip: 94 },
    { size: '10', bust: 90, waist: 72.5, hip: 99 },
    { size: '12', bust: 95, waist: 77.5, hip: 104 },
    { size: '14', bust: 100, waist: 82.5, hip: 109 },
    { size: '16', bust: 105, waist: 87.5, hip: 114 },
  ];
  const bodies = { slim: { waist: 64, hip: 90 }, average: { waist: 76, hip: 102 }, curvy: { waist: 86, hip: 116 } };
  const recommended = { slim: '8', average: '12', curvy: '16' }; // the fit engine's picks (rings.test.ts)
  const grip = (pct) => (pct < 0 ? ' (at rest: does not grip)' : pct > 100 ? ' (cannot close)' : '');
  if (process.argv.includes('--assumed') || !PILOT_SKIRT_TAPE) {
    const cases = [
      ['slim', '8', 'recommended'],
      ['average', '12', 'recommended'],
      ['curvy', '16', 'recommended'],
      ['average', '8', 'two sizes down'],
      ['curvy', '12', 'two sizes down'],
    ];
    const cell = (r) => {
      const pct = Math.round(r.waistStretch * 100);
      const hips = r.hipClearanceCm >= 0 ? `+${r.hipClearanceCm} over hips` : `**${r.hipClearanceCm} at hips: will not pull on**`;
      return `${r.relaxedCm}-${r.stretchedCm}: waist ${pct}%${grip(pct)}, ${hips}`;
    };
    console.log(`| Scenario (size 12 relaxed / stretched) | ${cases.map(([b, s, why]) => `${b[0].toUpperCase()}${b.slice(1)} in AU ${s} (${why}; waist ${bodies[b].waist}, hip ${bodies[b].hip})`).join(' | ')} |`);
    console.log(`|---|${cases.map(() => '---').join('|')}|`);
    for (const sc of Object.keys(ASSUMED_BAND_SCENARIOS)) {
      const band = assumedBand(chart, sc);
      const s = ASSUMED_BAND_SCENARIOS[sc];
      const name = `${sc} ${s.relaxedCm} / ${s.stretchedCm}`;
      console.log(`| ${sc === 'mid' ? `**${name} (drawn)**` : name} | ${cases.map(([b, size]) => cell(bandSweep(band, size, bodies[b]))).join(' | ')} |`);
    }
  } else {
    const inputs = pilotSkirtInputs(chart);
    const band = inputs.band;
    const names = Object.keys(bodies);
    const cell = (r, isRec) => {
      const pct = Math.round(r.waistStretch * 100);
      const hips = r.hipClearanceCm >= 0 ? `+${r.hipClearanceCm} cm over hips` : `**${r.hipClearanceCm} cm at hips: will not pull on**`;
      const text = `waist ${pct}%${grip(pct)}, ${hips}`;
      return isRec ? `${text} *(engine's pick)*` : text;
    };
    console.log(`| Size | Band relaxed-stretched, cm | Source | Stretched minus chart hip of that size | ${names.map((b) => `${b[0].toUpperCase()}${b.slice(1)} (waist ${bodies[b].waist}, hip ${bodies[b].hip})`).join(' | ')} |`);
    console.log(`|---|---|---|---|${names.map(() => '---').join('|')}|`);
    for (const row of chart) {
      const src = sourceAt(band, row.size);
      const d = Math.round((band.stretchedCm[row.size] - row.hip) * 10) / 10;
      console.log(
        `| AU ${row.size} | ${band.relaxedCm[row.size]}-${band.stretchedCm[row.size]} | ${src === 'measured' ? '**measured**' : `${src}, not measured`} | ${d >= 0 ? '+' : ''}${d} cm (chart hip ${row.hip}) | ${names.map((b) => cell(bandSweep(band, row.size, bodies[b]), recommended[b] === row.size)).join(' | ')} |`,
      );
    }
    console.log('');
    console.log('| Size | Garment hip, cm | Hem sweep, cm | Source | Garment hip minus chart hip | ' + names.map((b) => `${b[0].toUpperCase()}${b.slice(1)}: garment hip minus body hip ${bodies[b].hip}`).join(' | ') + ' |');
    console.log(`|---|---|---|---|---|${names.map(() => '---').join('|')}|`);
    for (const row of chart) {
      const src = sourceAt(inputs.hip, row.size);
      const g = inputs.hip.girthCm[row.size];
      const sign = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10} cm`;
      console.log(`| AU ${row.size} | ${g} | ${inputs.hem.sweepCm[row.size]} | ${src === 'measured' ? '**measured**' : `${src}, not measured`} | ${sign(g - row.hip)} | ${names.map((b) => sign(g - bodies[b].hip)).join(' | ')} |`);
    }
  }
} finally {
  await server.close();
}
