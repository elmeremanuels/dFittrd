/**
 * POM bundle (docs/research/step3-serverdrape-spike.md §10): the chart bodies as the DEVICE draws them, for the server
 * drapes of the device bundle. `pom-body-gap.ts` showed that the Anny bodies of §9 are not the body the embed draws:
 * at the band level the device avatar is 4-7 cm of girth narrower than the Anny body with the same waist and hip, and at
 * the seat it is deeper (400-850 particles of an Anny drape lie inside it, up to 3 cm). A bake draped on Anny would
 * float off the drawn body at the band and cut into it at the seat. So the bundle is draped on the avatar itself:
 * `buildAvatar` of `@curtain/garment-viewer` (the neutral head, as the embed mounts it) with the chart's bust, waist
 * and hip, written in the format `drape_blender.py` reads (mannequin frame, cm; bodies.json; armmask.bin).
 *
 * The avatar has no navel. The wear rule's level (`wear_rule.py`: band top 2 cm under the navel) is taken from the
 * Anny body of the same id (`--anny`, §9.2: 102.5-103.0 cm on all six), i.e. the band is placed at the same height
 * above the floor as on that Anny body. Recorded per body as `navelSource`.
 *
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/serverdrape/avatar-bodies.ts out/pom2-avatar/bodies out/pom2/bodies
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { buildAvatar } from '../../../../../packages/garment-viewer/src/body';

const [out, annyDir] = [process.argv[2]!, process.argv[3]!];
mkdirSync(out, { recursive: true });

/** The pilot skirt's chart (payload.json sizeChart): bust 95 + 10 t, waist 77.5 + 10 t, hip 104 + 10 t. */
const chartAt = (t: number): { bust: number; waist: number; hip: number } => ({ bust: 95 + 10 * t, waist: 77.5 + 10 * t, hip: 104 + 10 * t });

interface AnnyBody { id: string; t: number; label: string; heldOut: boolean; achieved: { navelY: number; hipCm: number; waistCm: number } }
const anny = (JSON.parse(readFileSync(join(annyDir, 'bodies.json'), 'utf8')) as { bodies: AnnyBody[] }).bodies;

const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canon = buildMannequinMesh(m, { head: 'neutral' });
const ringY = (id: string): number => m.rings.find((r) => r.id === id)!.centre[1];
const r2 = (x: number): number => Math.round(x * 100) / 100;

const bodies = [];
let armmask: Uint8Array | null = null;
for (const a of anny) {
  // The held-out body keeps Anny's achieved waist and hip (100 / 73.5); its bust follows the chart line.
  const c = chartAt(a.t);
  const meas = { bust: r2(c.bust), waist: a.heldOut ? a.achieved.waistCm : c.waist, hip: a.heldOut ? a.achieved.hipCm : c.hip };
  const av = buildAvatar(m, canon, meas);
  const mesh = av.mesh;
  const armL = mesh.partNames.indexOf('arm_l'), armR = mesh.partNames.indexOf('arm_r'), torso = mesh.partNames.indexOf('torso');
  const mask = new Uint8Array(mesh.vertexPart.length);
  for (let i = 0; i < mask.length; i++) mask[i] = mesh.vertexPart[i] === armL || mesh.vertexPart[i] === armR ? 1 : 0;
  if (armmask && (armmask.length !== mask.length || armmask.some((v, i) => v !== mask[i]))) throw new Error('avatar topology differs between bodies');
  armmask = mask;
  const lines: string[] = [`# device avatar (buildAvatar, neutral head) bust ${meas.bust} waist ${meas.waist} hip ${meas.hip}`];
  for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${mesh.positions[i]!.toFixed(4)} ${mesh.positions[i + 1]!.toFixed(4)} ${mesh.positions[i + 2]!.toFixed(4)}`);
  for (let t = 0; t < mesh.indices.length; t += 3) lines.push(`f ${mesh.indices[t]! + 1} ${mesh.indices[t + 1]! + 1} ${mesh.indices[t + 2]! + 1}`);
  writeFileSync(join(out, `${a.id}.obj`), lines.join('\n') + '\n');
  // Crotch: the lowest torso vertex near the midline (as anny_bodies.py does on Anny).
  let crotchY = Infinity;
  for (let i = 0; i < mesh.vertexPart.length; i++) if (mesh.vertexPart[i] === torso && Math.abs(mesh.positions[3 * i]!) < 2) crotchY = Math.min(crotchY, mesh.positions[3 * i + 1]!);
  bodies.push({
    id: a.id,
    t: a.t,
    label: a.label,
    heldOut: a.heldOut,
    kind: 'device avatar',
    target: { statureCm: m.statureCm, ...meas },
    achieved: {
      statureCm: m.statureCm,
      bustCm: r2(av.rings.chest),
      hipCm: r2(av.rings.hip),
      hipY: r2(ringY('hip')),
      waistCm: r2(av.rings.waist),
      waistY: r2(ringY('waist')),
      navelY: a.achieved.navelY,
      navelSource: `Anny body ${a.id} (the avatar has no navel; the wear level is placed at the same height)`,
    },
    rings: { crotchY: r2(crotchY), kneeY: r2(ringY('knee')), ankleY: r2(ringY('ankle')) },
  });
  console.log(`${a.id} ${a.label}: bust ${meas.bust} waist ${meas.waist} hip ${meas.hip}; rings waist ${r2(av.rings.waist)} hip ${r2(av.rings.hip)}; crotch ${r2(crotchY)}; navel (Anny) ${a.achieved.navelY}`);
}
writeFileSync(join(out, 'armmask.bin'), armmask!);
writeFileSync(
  join(out, 'bodies.json'),
  JSON.stringify({ axis: 'AU body chart: bust 95 + 10 t, waist 77.5 + 10 t, hip 104 + 10 t (t = -1, 0, 1: AU 8, 12, 16)', kind: 'device avatar (@curtain/garment-viewer buildAvatar, head neutral)', bodies }, null, 1),
);
