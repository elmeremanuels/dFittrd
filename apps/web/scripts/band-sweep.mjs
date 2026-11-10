#!/usr/bin/env node
/**
 * The pilot skirt's ASSUMED waistband scenarios on the three test bodies (docs/research/step3-rings-usertest.md):
 * how far the band stretches at the waist and whether, stretched, it passes over the hips (the
 * skirt is assumed pull-on). Prints a Markdown table. Garment physics of the assumed inputs only:
 * the size advice comes from @curtain/fit-engine alone.
 *
 *   node scripts/band-sweep.mjs
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const web = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = await createServer({ root: web, configFile: join(web, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn' });
try {
  const { ASSUMED_BAND_SCENARIOS, assumedBand, bandSweep } = await server.ssrLoadModule('/src/render/ringInputs.ts');
  // The pilot skirt's chart (Crimson Wildflower Maxi Skirt, AU 8-16, body chart, cm).
  const chart = [
    { size: '8', bust: 85, waist: 67.5, hip: 94 },
    { size: '10', bust: 90, waist: 72.5, hip: 99 },
    { size: '12', bust: 95, waist: 77.5, hip: 104 },
    { size: '14', bust: 100, waist: 82.5, hip: 109 },
    { size: '16', bust: 105, waist: 87.5, hip: 114 },
  ];
  const bodies = { slim: { waist: 64, hip: 90 }, average: { waist: 76, hip: 102 }, curvy: { waist: 86, hip: 116 } };
  const cases = [
    ['slim', '8', 'recommended'],
    ['average', '12', 'recommended'],
    ['curvy', '16', 'recommended'],
    ['average', '8', 'two sizes down'],
    ['curvy', '12', 'two sizes down'],
  ];
  const cell = (r) => {
    const pct = Math.round(r.waistStretch * 100);
    const grip = pct < 0 ? ' (does not grip)' : pct > 100 ? ' (cannot close)' : '';
    const hips = r.hipClearanceCm >= 0 ? `+${r.hipClearanceCm} over hips` : `**${r.hipClearanceCm} at hips: will not pull on**`;
    return `${r.relaxedCm}-${r.stretchedCm}: waist ${pct}%${grip}, ${hips}`;
  };
  console.log(`| Scenario (size 12 relaxed / stretched) | ${cases.map(([b, s, why]) => `${b[0].toUpperCase()}${b.slice(1)} in AU ${s} (${why}; waist ${bodies[b].waist}, hip ${bodies[b].hip})`).join(' | ')} |`);
  console.log(`|---|${cases.map(() => '---').join('|')}|`);
  for (const sc of Object.keys(ASSUMED_BAND_SCENARIOS)) {
    const band = assumedBand(chart, sc);
    const s = ASSUMED_BAND_SCENARIOS[sc];
    const name = `${sc} ${s.relaxedCm} / ${s.stretchedCm}`;
    console.log(`| ${sc === 'mid' ? `**${name} (drawn)**` : name} | ${cases.map(([b, size]) => cell(bandSweep(band, size, bodies[b]))).join(' | ')} |`);
  }
} finally {
  await server.close();
}
