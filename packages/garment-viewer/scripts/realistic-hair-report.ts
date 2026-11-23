/**
 * Numbers of the realistic hair (D28) for docs/reports/claude/realistic-hair.md: per type and length on the five test
 * bodies of the realistic body spike, the triangles, clumps, whether it was drawn simpler, and the build time in Node;
 * the generated texture bytes. Pure (no WebGL).
 *
 *   pnpm --filter @curtain/garment-viewer exec tsx scripts/realistic-hair-report.ts [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBody } from '@curtain/mannequin';
import { decodeRealisticBody, fitRealisticBody, fitTargetOf } from '../src/realisticBody';
import { buildHair, coilTexture, sculptedCoilTextures, sculptedLockTextures, strandTexture, textureBytes, HAIR_TRIANGLE_BUDGET } from '../src/realisticHair';
import { HAIR_LENGTHS, HAIR_TYPES } from '../src/hairOptions';

const asset = decodeRealisticBody(readFileSync(new URL('../assets/realistic-body/female-v1.crb', import.meta.url)));
const BODIES = {
  slim: { heightCm: 164, bust: 80, waist: 62, hip: 88 },
  mid: { heightCm: 168, bust: 92, waist: 74, hip: 100 },
  full: { heightCm: 170, bust: 116, waist: 98, hip: 122 },
  tall: { heightCm: 182, bust: 92, waist: 74, hip: 100 },
  petite: { heightCm: 152, bust: 84, waist: 66, hip: 92 },
};
const rows: Record<string, unknown>[] = [];
for (const [body, b] of Object.entries(BODIES)) {
  const m = buildBody({ family: 'female', ...b });
  const fit = fitRealisticBody(asset, fitTargetOf(m));
  const y = (id: string): number => m.rings.find((r) => r.id === id)!.centre[1];
  const input = { positions: fit.mesh.positions, indices: fit.mesh.indices, headWeight: asset.headWeight, armWeight: asset.armWeight, bodyVertexCount: asset.meta.bodyVertexCount, ringY: { shoulder: y('shoulder'), chest: y('chest'), underbust: y('underbust') } };
  for (const type of HAIR_TYPES) {
    for (const length of HAIR_LENGTHS) {
      const t0 = performance.now();
      const h = buildHair(input, { type, length, hex: '#000000' });
      rows.push({ body, type, length, triangles: h.triangles, clumps: h.clumps, simpler: h.simpler, buildMs: Math.round(performance.now() - t0), headScale: Number(h.head.scale.toFixed(3)) });
    }
  }
}
const lockTex = sculptedLockTextures();
const tex = {
  sculptedLock: textureBytes(lockTex.albedo) + textureBytes(lockTex.normal),
  sculptedCoil: Object.fromEntries((['3C', '4A', '4B', '4C'] as const).map((t) => {
    const c = sculptedCoilTextures(t);
    return [t, textureBytes(c.albedo) + textureBytes(c.normal)];
  })),
  v1Strand: textureBytes(strandTexture()),
  v1Coil: Object.fromEntries((['3C', '4A', '4B', '4C'] as const).map((t) => [t, textureBytes(coilTexture(t))])),
};
const out = { when: new Date().toISOString(), budgetTriangles: HAIR_TRIANGLE_BUDGET, bodyTriangles: asset.meta.triangleCount, textures: tex, rows };
const file = process.argv[2];
if (file) writeFileSync(file, JSON.stringify(out, null, 1));
for (const r of rows.filter((x) => x.body === 'mid')) console.log(`${String(r.type).padEnd(3)} ${String(r.length).padEnd(9)} ${String(r.triangles).padStart(6)} tri ${String(r.clumps).padStart(4)} clumps ${String(r.buildMs).padStart(4)} ms${r.simpler ? `  SIMPLER: ${String(r.simpler)}` : ''}`);
console.log('simpler on any body:', [...new Set(rows.filter((r) => r.simpler).map((r) => `${String(r.type)} ${String(r.length)}`))].join(', ') || 'none');
console.log('textures', JSON.stringify(tex));
