/**
 * The merchant console's demo data for the 3D review (apps/web/src/merchant/mockBakeChecks.json): two real reports of
 * the import's bake check, on the POM v2 tape-built fixture (passes) and on a copy whose qa.json says AU 12's hem is
 * 280 cm and AU 16 measured (refused).
 * Run (from spikes/garment-engine): pnpm exec tsx viewer/scripts/serverdrape/bake-check-mock.ts ../../apps/web/src/merchant/mockBakeChecks.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDrapeBake } from '../../../../../packages/garment-viewer/src/bakeGate';

const dir = '../../packages/garment-viewer/fixtures/pom-v2-rest';
const j = (n: string) => JSON.parse(readFileSync(join(dir, n), 'utf8'));
const bytes = ['base.glb', 'anchors.json', 'grading.json', 'material.json', 'qa.json'].reduce((s, f) => s + readFileSync(join(dir, f)).length, 0);
const glb = new Uint8Array(readFileSync(join(dir, 'base.glb')));
const pass = await checkDrapeBake({ glb, anchors: j('anchors.json'), grading: j('grading.json'), qa: j('qa.json'), bytes, now: new Date('2026-11-19T09:12:00Z') });
const qa = j('qa.json');
qa.tape.sizes[2].tape.hemSweepCm.cm = 280;
qa.tape.sizes[4].provenance = 'measured';
const grading = j('grading.json');
grading.sizes[4].provenance = 'measured';
const refused = await checkDrapeBake({ glb, anchors: j('anchors.json'), grading, qa, bytes, now: new Date('2026-11-18T16:40:00Z') });
writeFileSync(process.argv[2]!, JSON.stringify({ bytes, pass, refused }) + '\n');
console.log(`pass ${pass.pass}; refused ${refused.pass}: ${refused.checks.filter((c) => c.pass === false).map((c) => c.id).join(', ')}`);
