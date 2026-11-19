/**
 * Front-view half-widths of the male body v2 (`maleShape: 'v2'`) at the 2D figure's levels, per
 * size: what `apps/web/src/render/maleBody.ts` (`MALE_V2_FIGURE`) copies for the male 2D figure
 * v2 (branch `claude/male-2d-v2`). A half-width is the largest |x| of the torso's (or the left
 * leg's) loop in the horizontal plane at that height on the mesh. Prints JSON.
 *
 * Run: pnpm --filter @curtain/mannequin exec tsx scripts/measure-male-v2-front.ts [--v1]
 */
import { buildMannequin, buildMannequinMesh, deltoidBreadthCm, familyShape, MALE_BODY_SHAPE_IDS, MALE_REFERENCE, MALE_SECTION_REFERENCE, slice } from '../src/index';

const version = process.argv.includes('--v1') ? 'v1' : 'v2';
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const out: Record<string, unknown> = {};
const figure: Record<string, unknown> = {};
for (const id of MALE_BODY_SHAPE_IDS) {
  const shape = familyShape('male', id)!;
  const m = buildMannequin(shape, { maleShape: version });
  const mesh = buildMannequinMesh(m);
  const part = (name: string) => mesh.partNames.indexOf(name);
  const xs = (name: string, y: number): number[] => {
    const k = part(name);
    return slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] }, (t) => mesh.vertexPart[mesh.indices[3 * t]!] === k).flatMap((l) => l.points.map((p) => p[0]));
  };
  const torso = (y: number): number => Math.max(...xs('torso', y).map(Math.abs));
  const legOut = (y: number): number => Math.max(...xs('leg_l', y));
  const legIn = (y: number): number => Math.min(...xs('leg_l', y));
  const Y = m.morphHeights;
  const G = (k: keyof typeof shape.rings): number => shape.rings[k].circumferenceCm;
  // the torso's widest point between the chest and shoulder rings (the lats at the armpit)
  let lats = 0;
  let latsY = Y.chest;
  for (let y = Y.chest; y <= Y.shoulder; y += 0.25) {
    const h = torso(y);
    if (h > lats) [lats, latsY] = [h, y];
  }
  // the armpit as maleV2.ts places it: ANSUR's axilla height, held between the chest and shoulder rings
  const axilla = MALE_SECTION_REFERENCE[id].axilla;
  const yax = Math.min(Y.shoulder - 0.3 * (Y.shoulder - Y.chest), Math.max(Y.chest + 0.25 * (Y.shoulder - Y.chest), axilla * m.statureCm));
  const trap = [0.25, 0.5, 0.75].map((t) => r3(torso(Y.shoulder + t * (Y.neck - Y.shoulder))));
  // where the thighs stop touching (inner edge of the left leg leaves the middle), going down from the crotch
  let touchY = m.landmarks.crotch[1];
  for (let y = m.landmarks.crotch[1]; y > Y.knee; y -= 0.25) {
    if (legIn(y) > 0.05) break;
    touchY = y;
  }
  out[id] = {
    stature: m.statureCm,
    girth: { chest: G('chest'), underbust: G('underbust'), waist: G('waist'), hip: G('hip'), thigh: G('thigh') },
    heights: { neck: r3(Y.neck), axilla: r3(yax), shoulder: r3(Y.shoulder), lats: r3(latsY), chest: r3(Y.chest), underbust: r3(Y.underbust), waist: r3(Y.waist), hip: r3(Y.hip), crotch: r3(m.landmarks.crotch[1]), thigh: r3(Y.thigh), knee: r3(Y.knee), touch: r3(touchY) },
    half: {
      neck: r3(torso(Y.neck)),
      trapezius: trap,
      shoulder: r3(torso(Y.shoulder)),
      lats: r3(lats),
      axilla: r3(torso(yax)),
      chest: r3(torso(Y.chest)),
      underbust: r3(torso(Y.underbust)),
      waist: r3(torso(Y.waist)),
      hip: r3(torso(Y.hip)),
      crotch: r3(Math.max(legOut(m.landmarks.crotch[1] - 0.5), torso(m.landmarks.crotch[1] + 0.5))),
      thighOuter: r3(legOut(Y.thigh)),
      kneeOuter: r3(legOut(Y.knee)),
    },
    legX: r3(m.landmarks.legX),
    deltoidBreadth: r3(deltoidBreadthCm(m)),
  };
  if (version === 'v2') {
    // The row of `MALE_V2_FIGURE_TABLE` (apps/web/src/render/maleBody.ts): ratios, so a typed body scales them.
    const row = MALE_REFERENCE[id];
    const h = (y: number): number => torso(y);
    const r4 = (v: number): number => Math.round(v * 10000) / 10000;
    const neck = h(Y.neck);
    const sh = h(Y.shoulder);
    figure[id] = {
      chestAspect: r4(G('chest') / (Math.PI * h(Y.chest)) - 1),
      waistAspect: r4(G('waist') / (Math.PI * h(Y.waist)) - 1),
      hipAspect: r4(G('hip') / (Math.PI * h(Y.hip)) - 1),
      underbustShare: r4((h(Y.underbust) - h(Y.waist)) / (h(Y.chest) - h(Y.waist))),
      lats: r4(h(yax) / h(Y.chest)),
      axillaLevel: r4(yax / m.statureCm),
      neckAboveShoulder: r4((Y.neck - Y.shoulder) / m.statureCm),
      shoulderRing: r4(sh / (row.shoulderWidth / 2)),
      trapezius: [0.5, 0.75].map((t) => r4((h(Y.shoulder + t * (Y.neck - Y.shoulder)) - neck) / (sh - neck))),
      legX: r4(m.landmarks.legX / h(Y.hip)),
      thighLevel: r4(Y.thigh / m.statureCm),
      deltoid: r4(deltoidBreadthCm(m) / row.bideltoid),
    };
  }
}
console.log(JSON.stringify(version === 'v2' ? { measured: out, figure } : { measured: out }, null, 1));
