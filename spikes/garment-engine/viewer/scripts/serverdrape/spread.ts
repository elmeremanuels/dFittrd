/**
 * R2 spike: the girth spread AU 16 - AU 8 of the direct drapes of ONE body for each drape set (band variant, push-out
 * or rest-mode run), against the graded spread measured the same way on the rest geometry. Two measure families:
 * the first run's fixed heights (hip = body hip y, hem = y 22) and the garment-relative ones (relgirth.ts).
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/serverdrape/spread.ts out/serverdrape t-0.40 W-0,W-6,W-6+graded
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { girthAt } from './girth';
import { relGirths, rings } from './relgirth';

const [root, body, sets] = [process.argv[2]!, process.argv[3]!, process.argv[4]!.split(',')];
const meta = (JSON.parse(readFileSync(join(root, 'bodies', 'bodies.json'), 'utf8')) as { bodies: { id: string; achieved: { hipY: number } }[] }).bodies.find((b) => b.id === body)!;
const f32 = (p: string): Float32Array => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const ib = readFileSync(join(root, 'rest', 'indices.bin'));
const idx = new Uint32Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.byteLength));
const rest = Object.fromEntries(['8', '16'].map((s) => [s, f32(join(root, 'rest', `rest-${s}.bin`))]));
const R = rings(rest['8']!);
const r1 = (x: number): number => Math.round(x * 10) / 10;
const ref = Object.fromEntries(['8', '16'].map((s) => [s, relGirths(rest[s]!, idx, R)]));
const graded = {
  hip: r1(girthAt(rest['16']!, idx, 87) - girthAt(rest['8']!, idx, 87)),
  hem: r1(girthAt(rest['16']!, idx, 20) - girthAt(rest['8']!, idx, 20)),
  hipRel: r1(ref['16']!.hipRel - ref['8']!.hipRel),
  hemRel: r1(ref['16']!.hemRel - ref['8']!.hemRel),
  hipRing: r1(ref['16']!.hipRing - ref['8']!.hipRing),
};
console.log(JSON.stringify({ graded }));
for (const set of sets) {
  const row: Record<string, unknown> = { set };
  const g: Record<string, Record<string, number>> = {};
  for (const s of ['8', '12', '16']) {
    const p = join(root, 'drapes', set, `${body}__${s}`);
    const pos = f32(p + '.bin');
    const j = JSON.parse(readFileSync(p + '.json', 'utf8')) as { band: { relaxedCm: number; settledMeanY: number; settledGirthCm: number }; cpuSecondsSim: number; insideBody: number; config?: unknown };
    g[s] = { hip: girthAt(pos, idx, meta.achieved.hipY), hem: girthAt(pos, idx, 22), ...relGirths(pos, idx, R) };
    row[s] = { ...g[s], bandRelaxed: j.band.relaxedCm, bandGirth: j.band.settledGirthCm, inside: j.insideBody, cpuS: j.cpuSecondsSim };
  }
  const sp: Record<string, number> = {}, sv: Record<string, number> = {};
  for (const k of ['hip', 'hem', 'hipRel', 'hemRel', 'hipRing'] as const) {
    sp[k] = r1(g['16']![k]! - g['8']![k]!);
    sv[k] = Math.round((sp[k] / graded[k]) * 100) / 100;
  }
  console.log(JSON.stringify({ ...row, spread: sp, survival: sv }));
}
