/**
 * R2 spike: the hip and hem girth per size of the direct drapes of ONE body for each band variant (band sensitivity on
 * the held-out body; no blend). Same measure as bake.ts.
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/serverdrape/spread.ts out/serverdrape t-0.40 W-0,W-6,W-12,ONE-70
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { girthAt } from './girth';

const [root, body, bands] = [process.argv[2]!, process.argv[3]!, process.argv[4]!.split(',')];
const meta = (JSON.parse(readFileSync(join(root, 'bodies', 'bodies.json'), 'utf8')) as { bodies: { id: string; achieved: { hipY: number } }[] }).bodies.find((b) => b.id === body)!;
const ib = readFileSync(join(root, 'rest', 'indices.bin'));
const idx = new Uint32Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.byteLength));
const GRADED_HIP = 20.1;
const GRADED_HEM = 21.9;
for (const band of bands) {
  const row: Record<string, unknown> = { band };
  const g: Record<string, { hip: number; hem: number }> = {};
  for (const s of ['8', '12', '16']) {
    const p = join(root, 'drapes', band, `${body}__${s}`);
    const b = readFileSync(p + '.bin');
    const pos = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const j = JSON.parse(readFileSync(p + '.json', 'utf8')) as { band: { relaxedCm: number; settledMeanY: number; settledGirthCm: number }; cpuSecondsSim: number; insideBody: number };
    g[s] = { hip: girthAt(pos, idx, meta.achieved.hipY), hem: girthAt(pos, idx, 22) };
    row[s] = { ...g[s], bandRelaxed: j.band.relaxedCm, bandY: j.band.settledMeanY, bandGirth: j.band.settledGirthCm, inside: j.insideBody, cpuS: j.cpuSecondsSim };
  }
  const hip = Math.round((g['16']!.hip - g['8']!.hip) * 10) / 10, hem = Math.round((g['16']!.hem - g['8']!.hem) * 10) / 10;
  console.log(JSON.stringify({ ...row, spreadHip: hip, spreadHem: hem, survivalHip: Math.round((hip / GRADED_HIP) * 100) / 100, survivalHem: Math.round((hem / GRADED_HEM) * 100) / 100 }));
}
