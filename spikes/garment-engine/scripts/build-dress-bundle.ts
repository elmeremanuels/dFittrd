/**
 * Writes the SYNTHETIC tape-built babydoll dress (`src/pomDress.ts`, not a product) as a device bundle to
 * spikes/garment-engine/out/synthetic-tape-babydoll-dress/ (gitignored): base.glb, anchors.json, grading.json,
 * material.json, qa.json, and payload.json for the demo seed (the api import never copies that file). Deterministic.
 * Prints the tape check (every input on every size, built on that size's AU chart body) and what the device's grading
 * of the base size misses. Exits 1 when the tape check fails.
 *
 * Run: pnpm --filter @curtain/garment-spike exec tsx scripts/build-dress-bundle.ts [--out <dir>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { POM_DRESS_TAPE_TOLERANCE_CM, buildPomDressBundle } from '../src/pomDressBundle';
import { SYNTHETIC_DRESS_ID, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE, SYNTHETIC_TAPE_DRESS } from '../src/pomDressSynthetic';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = values.out ? resolve(values.out) : join(dirname(fileURLToPath(import.meta.url)), '..', 'out', SYNTHETIC_DRESS_ID);
const t0 = Date.now();
const b = buildPomDressBundle(SYNTHETIC_DRESS_ID, SYNTHETIC_TAPE_DRESS, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE.provenance);
mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries(b.files)) writeFileSync(join(out, name), data);
writeFileSync(join(out, 'payload.json'), `${JSON.stringify(SYNTHETIC_TAPE_DRESS, null, 2)}\n`);
const bytes = Object.values(b.files).reduce((n, d) => n + (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength), 0);
const fmt = (e: Record<string, number | undefined>): string => Object.entries(e).map(([k, v]) => `${k.replace('Cm', '')} ${v! >= 0 ? '+' : ''}${v!.toFixed(2)}`).join(', ');
console.log(`[dress] ${SYNTHETIC_DRESS_ID}: ${b.baseMesh.indices.length / 3} triangles, ${(bytes / 1024).toFixed(0)} KB, ${Date.now() - t0} ms → ${out}`);
console.log(`[dress] tape check (built on each size's AU chart body, tolerance ${POM_DRESS_TAPE_TOLERANCE_CM} cm):`);
for (const t of b.tape) console.log(`  AU ${t.size} (${t.provenance}): max ${t.maxAbsCm.toFixed(2)} cm; top edge ${t.onBodyCm.topEdgeAboveBustLine} cm above the bust line, seam ${t.onBodyCm.seamAboveUnderbust} cm above the underbust, hem ${t.onBodyCm.hemAboveKnee} cm above the knee${t.tight.length ? `; TIGHTER THAN THE BODY at ${t.tight.map((x) => `y ${x.y}: asked ${x.askedCm}, built ${x.builtCm}`).join('; ')}` : ''}`);
console.log('[dress] device grading of the base size against the tape (built minus tape, cm):');
for (const g of b.gradingCheck) console.log(`  AU ${g.size}: ${fmt(g.errorCm)}`);
if (!b.tape.every((t) => t.maxAbsCm <= POM_DRESS_TAPE_TOLERANCE_CM)) process.exit(1);
