/**
 * Offline bake of the realistic body asset (docs/research/realistic-avatar-route.md §7, route B spike; female family).
 *
 *   pnpm --filter @curtain/garment-viewer exec tsx scripts/bake-realistic-body.ts <source dir> [<out file>]
 *
 * <source dir> holds the MPFB2 files listed in SOURCES at their repository paths (fetched with `--fetch`, which runs
 * curl against raw.githubusercontent.com at the pinned commit). Every file is checked against its sha256 before use;
 * a mismatch stops the bake. Our own code: no MakeHuman or MPFB program code is used, linked or ported (that code is
 * AGPL / GPLv3); only the CC0 assets are read (base mesh, targets, skin weights). Provenance and licence quotes:
 * assets/realistic-body/PROVENANCE.md.
 *
 * Steps: the base mesh's `body` group plus the two low-poly eye helpers; the default MakeHuman female (gender 0, the
 * three ethnic female-young targets at 1/3 each, average muscle, weight, height, cup); decimetres to centimetres, floor
 * at y = 0; both arms turned about their shoulder joint to the mannequin's A-pose (32° from vertical, in the frontal
 * plane) with MakeHuman's own arm skin weights; quads split into triangles; four shape targets kept as sparse deltas
 * (weight ±, cup ±); the levels that correspond to the 12 rings and the loop girths there measured for the fit's shape
 * solve; positions and deltas quantised to int16.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { topology } from '@curtain/mannequin';
import {
  BODY_RINGS,
  FACE_SHAPE_TARGETS,
  REALISTIC_BODY_FORMAT,
  REALISTIC_BODY_VERSION,
  SHAPE_TARGETS,
  encodeRealisticBody,
  horizontalSections,
  sectionAt,
  type BodyRing,
  type FaceLandmarkName,
  type FaceShapeTarget,
  type RealisticBodyAsset,
  type RealisticBodyMeta,
  type ShapeTarget,
} from '../src/realisticBody';

type V3 = [number, number, number];

const REPOSITORY = 'https://github.com/makehumancommunity/mpfb2';
const COMMIT = '9de0707fdc88438d7c53a1a2ac7937d9221e2431';
const T = 'src/mpfb/data/targets';
/** Every file the bake reads, with the sha256 it was checked against (read 2026-11-21). */
export const SOURCES: Readonly<Record<string, string>> = {
  'LICENSE.md': '5cefb60680cb9efd4550a2e65d719021cfbec9dad3658481d11d48ae863ce04d',
  'LICENSE.ASSETS.md': 'f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c',
  'src/mpfb/data/3dobjs/base.obj': '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c',
  'src/mpfb/data/rigs/standard/rig.default.json': '8b949de35c2dd70dbb5094e57a8586c3b9a9f650775a293212581a8f67be6797',
  'src/mpfb/data/rigs/standard/weights.default.json': '154b866774a8c2b055a8e86419f22a87b76c60440fdcb70bcb78345f00924e89',
  [`${T}/macrodetails/african-female-young.target.gz`]: '1147ae55ecb0f66bade3f45176b3af187e265878322db172ad1090e9f3108e84',
  [`${T}/macrodetails/asian-female-young.target.gz`]: 'ee17da733288434e5b6fa120497f1fa6e72bf7faad5d694b0431d7275139170d',
  [`${T}/macrodetails/caucasian-female-young.target.gz`]: 'e9d6212373ac5f1e2c596fa145e363385f4d169c3c6c88ede3bab93b681af041',
  [`${T}/macrodetails/universal-female-young-averagemuscle-maxweight.target.gz`]: 'eaec00c7fe67738765170b94648e6cdf1078ff15a2c0f745645750eb6fef45bf',
  [`${T}/macrodetails/universal-female-young-averagemuscle-minweight.target.gz`]: '5c65527e5d6e83b98ffa3da5bd61372eff70f89e95585bdacd0e3f70e48062aa',
  [`${T}/breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness.target.gz`]: '70e67e082034a80cb6a88abac95d6e11d305f769c98f2d70374dea97fa98c604',
  [`${T}/breast/female-young-averagemuscle-averageweight-mincup-averagefirmness.target.gz`]: 'd891d82f4514e72f7d5691d8c83b934a195006ecd7b37954158b7b5fd9fb0804',
  // CC0 MakeHuman face shape targets (WO-020 / CUR-34, same pinned MPFB2 commit).
  [`${T}/head/head-scale-horiz-incr.target.gz`]: '671542640aec14d1740c1263deb0e274f3044edec761e6d4171329f0419be084',
  [`${T}/head/head-scale-horiz-decr.target.gz`]: 'ddec139b27d1f9b7a90f6474450c56897a4e417334af083e87e988fdf94ca343',
  [`${T}/head/head-scale-vert-incr.target.gz`]: 'be8b270ec67817578128396433d6e8ab9d530c9d81ea21db92cd1b9627a8110b',
  [`${T}/head/head-scale-vert-decr.target.gz`]: '64e86d59a469eeeb0201026880bcd6ebb0cbd590a74b179f58efa879b3772f6c',
  [`${T}/head/head-triangular.target.gz`]: '4fed43891a15d76507b8062e69ebf8482438ecbf281e3f6f9876407ea98ee308',
  [`${T}/head/head-invertedtriangular.target.gz`]: '70ba80d2c8da216be56c6edaaa8386d5390aa92094859bf83096fb3acb33f12a',
  [`${T}/chin/chin-width-incr.target.gz`]: '68764b6ec7c923597beaaf643f71c41f00c93639d9bb522c169c279db2ad299e',
  [`${T}/chin/chin-width-decr.target.gz`]: '6c3aaca074630e89951184130a4a158b6f62c9d0cf57cf8eb828c445ff40c21a',
  [`${T}/chin/chin-height-incr.target.gz`]: '4f05b61b39266801b0a333c208d274ff109250fe9e4512c486a455806878e15c',
  [`${T}/chin/chin-height-decr.target.gz`]: '1f4196d330b418d576e9400a754cb99d7e60b069ee8fdef645713f84db984e0c',
  [`${T}/chin/chin-prominent-incr.target.gz`]: 'e0d5ec5e213b88719def0f43ddaa7107796fc02f7447e2b2f140d9fe513a6ac8',
  [`${T}/chin/chin-prominent-decr.target.gz`]: '4ed14cb51e7ea7b3ecd469a537733924353c683f3cfe545be182d18a220dcb4e',
  [`${T}/cheek/l-cheek-bones-incr.target.gz`]: 'ea5aa60abcc2926e61cdabf5d40701c2b23b3f8027f949cea0b80bcbc55df301',
  [`${T}/cheek/r-cheek-bones-incr.target.gz`]: 'c608528b9e5e1c670179cfb502dab3d9478a77bb942f7c8186cd072a7369e9b9',
  [`${T}/cheek/l-cheek-bones-decr.target.gz`]: '109d88ec6394cb3455073ae9f2a6038b8b4d6b57feeaf4633611bc60f27ed212',
  [`${T}/cheek/r-cheek-bones-decr.target.gz`]: 'f128fdcf1d91769a907dc2c74056edac427196c1900f875c34c03b01dee5b7af',
  [`${T}/nose/nose-scale-vert-incr.target.gz`]: '63d297c237e7054a1ea700b83454ef508bf5f42ba8f2eb6bc1eb747ad261f34b',
  [`${T}/nose/nose-scale-vert-decr.target.gz`]: '3eea81bc82ddca8e20c8fc4279092eb2c8540d05e0c2aacf868af5da4ebac108',
  [`${T}/nose/nose-scale-horiz-incr.target.gz`]: 'ba550cc15c894a4412bb368acc92bd6ad94bbb63d0135c561fe30230ef6344bd',
  [`${T}/nose/nose-scale-horiz-decr.target.gz`]: '95d8dc4a3589bbb6105191abc6e3cae47c3c424ce189b5f0a611dc098806060d',
  [`${T}/eyes/l-eye-trans-out.target.gz`]: 'b74b2e4266f3db6122baaad9a4f793b81285cb2ac405f9fa4163bc72e72e56fc',
  [`${T}/eyes/r-eye-trans-out.target.gz`]: '1fc70679c7c086d10adc405b57be80d757417e925f1884625d6bc24b6a9fd05d',
  [`${T}/eyes/l-eye-trans-in.target.gz`]: '2129b8e5ea7b3875f32f7a50733eb4f61ea313f7dcc7e38491573b0cbd2cddc0',
  [`${T}/eyes/r-eye-trans-in.target.gz`]: '5c0fbc8e74ac1450aa517a98f5522855a73d67dad2b759ebc2f9a3001bb7d5af',
  [`${T}/eyebrows/eyebrows-trans-up.target.gz`]: 'fdaf3fb2ee5d1790202ede605d097e7666567237f1ab62a90729f72df0c16c52',
  [`${T}/eyebrows/eyebrows-trans-down.target.gz`]: '9f5bbb848e40d3a320492dd08ef8d1a926b50c7fd1ca279cf8f573e0f0cdd589',
  [`${T}/mouth/mouth-scale-horiz-incr.target.gz`]: '3bd6ff8195f77f0bcb586f3efec0eea1ae615eecba516e4d121025e40ed0ead2',
  [`${T}/mouth/mouth-scale-horiz-decr.target.gz`]: 'aed1a3c27224d12828de1ffc3fe9c2895f4389417d016016dd4f1fefccdbc6c9',
};

const TARGET_FILES: Record<ShapeTarget, string> = {
  'weight+': `${T}/macrodetails/universal-female-young-averagemuscle-maxweight.target.gz`,
  'weight-': `${T}/macrodetails/universal-female-young-averagemuscle-minweight.target.gz`,
  'cup+': `${T}/breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness.target.gz`,
  'cup-': `${T}/breast/female-young-averagemuscle-averageweight-mincup-averagefirmness.target.gz`,
};
const FACE_TARGET_FILES: Record<FaceShapeTarget, { pos: string[]; neg: string[] }> = {
  faceWidth: { pos: [`${T}/head/head-scale-horiz-incr.target.gz`], neg: [`${T}/head/head-scale-horiz-decr.target.gz`] },
  faceHeight: { pos: [`${T}/head/head-scale-vert-incr.target.gz`], neg: [`${T}/head/head-scale-vert-decr.target.gz`] },
  jawWidth: { pos: [`${T}/head/head-triangular.target.gz`], neg: [`${T}/head/head-invertedtriangular.target.gz`] },
  chinWidth: { pos: [`${T}/chin/chin-width-incr.target.gz`], neg: [`${T}/chin/chin-width-decr.target.gz`] },
  chinHeight: { pos: [`${T}/chin/chin-height-incr.target.gz`], neg: [`${T}/chin/chin-height-decr.target.gz`] },
  chinProminence: { pos: [`${T}/chin/chin-prominent-incr.target.gz`], neg: [`${T}/chin/chin-prominent-decr.target.gz`] },
  cheekbones: {
    pos: [`${T}/cheek/l-cheek-bones-incr.target.gz`, `${T}/cheek/r-cheek-bones-incr.target.gz`],
    neg: [`${T}/cheek/l-cheek-bones-decr.target.gz`, `${T}/cheek/r-cheek-bones-decr.target.gz`],
  },
  noseLength: { pos: [`${T}/nose/nose-scale-vert-incr.target.gz`], neg: [`${T}/nose/nose-scale-vert-decr.target.gz`] },
  noseWidth: { pos: [`${T}/nose/nose-scale-horiz-incr.target.gz`], neg: [`${T}/nose/nose-scale-horiz-decr.target.gz`] },
  eyeSpacing: {
    pos: [`${T}/eyes/l-eye-trans-out.target.gz`, `${T}/eyes/r-eye-trans-out.target.gz`],
    neg: [`${T}/eyes/l-eye-trans-in.target.gz`, `${T}/eyes/r-eye-trans-in.target.gz`],
  },
  browHeight: { pos: [`${T}/eyebrows/eyebrows-trans-up.target.gz`], neg: [`${T}/eyebrows/eyebrows-trans-down.target.gz`] },
  lipWidth: { pos: [`${T}/mouth/mouth-scale-horiz-incr.target.gz`], neg: [`${T}/mouth/mouth-scale-horiz-decr.target.gz`] },
};
const ETHNIC = ['african', 'asian', 'caucasian'].map((e) => `${T}/macrodetails/${e}-female-young.target.gz`);

/** The mannequin's A-pose: arms 32° from vertical (`A_POSE_ARM_DEG` of @curtain/mannequin). */
const A_POSE_DEG = 32;
/** The mannequin's shoulder ring sits 0.84 cm above its shoulder joint at stature 168 (female M): the same share of stature. */
const SHOULDER_RING_ABOVE_JOINT = 0.84 / 168;
/** The neck ring under the chin, share of stature (3 cm on the 159 cm base): mid-neck, where a tape goes round it. */
const NECK_BELOW_CHIN = 3 / 159;
/** The mannequin's underbust ring between its waist and chest rings (female M: 104.2, 114.2, 121.0 cm). */
const UNDERBUST_SHARE = (114.2 - 104.2) / (121.0 - 104.2);

function main(): void {
  const args = process.argv.slice(2);
  const fetchMissing = args.includes('--fetch');
  const [srcDir, outFile = join(dirname(new URL(import.meta.url).pathname), '..', 'assets', 'realistic-body', 'female-v1.crb')] = args.filter((a) => !a.startsWith('--'));
  if (!srcDir) throw new Error('usage: bake-realistic-body.ts <source dir> [<out file>] [--fetch]');
  const read = (path: string): Buffer => {
    const file = join(srcDir, path);
    if (!existsSync(file)) {
      if (!fetchMissing) throw new Error(`missing ${file} (pass --fetch to download it at commit ${COMMIT})`);
      mkdirSync(dirname(file), { recursive: true });
      execFileSync('curl', ['-fsSL', '-o', file, `https://raw.githubusercontent.com/makehumancommunity/mpfb2/${COMMIT}/${path}`]);
    }
    const bytes = readFileSync(file);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const want = SOURCES[path];
    if (want === undefined) throw new Error(`not a listed source: ${path}`);
    if (want && sha !== want) throw new Error(`sha256 mismatch for ${path}: ${sha}`);
    return bytes;
  };
  for (const p of ['LICENSE.md', 'LICENSE.ASSETS.md']) read(p);
  const licence = read('LICENSE.md').toString('utf8');
  if (!licence.includes('These assets have been released under CC0 1.0 Universal')) throw new Error('LICENSE.md no longer states CC0 for the assets');

  // --- Base mesh -------------------------------------------------------------------------------
  const obj = read('src/mpfb/data/3dobjs/base.obj').toString('utf8');
  if (!obj.includes('This asset was explicitly released as CC0')) throw new Error('base.obj header no longer states CC0');
  const all: number[] = [];
  const groups = new Map<string, number[][]>();
  let group = '';
  for (const line of obj.split('\n')) {
    if (line.startsWith('v ')) {
      const [x, y, z] = line.split(/\s+/).slice(1, 4).map(Number) as V3;
      all.push(x, y, z);
    } else if (line.startsWith('g ')) {
      group = line.slice(2).trim();
      if (!groups.has(group)) groups.set(group, []);
    } else if (line.startsWith('f ')) {
      groups.get(group)!.push(line.split(/\s+/).slice(1).filter(Boolean).map((t) => Number(t.split('/')[0]) - 1));
    }
  }
  const nAll = all.length / 3;
  const P = Float64Array.from(all);

  // --- The default MakeHuman female ----------------------------------------------------------
  const target = (path: string): Map<number, V3> => {
    const out = new Map<number, V3>();
    for (const line of gunzipSync(read(path)).toString('utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const [i, dx, dy, dz] = t.split(/\s+/).map(Number) as [number, number, number, number];
      out.set(i, [dx, dy, dz]);
    }
    return out;
  };
  for (const path of ETHNIC) for (const [i, d] of target(path)) for (let k = 0; k < 3; k++) P[3 * i + k] = P[3 * i + k]! + d[k]! / 3;

  // Joint cubes (MakeHuman's own landmarks): the mean of the cube's vertices.
  const cube = (name: string): V3 => {
    const faces = groups.get(name);
    if (!faces) throw new Error(`no joint cube ${name}`);
    const ids = [...new Set(faces.flat())];
    const c: V3 = [0, 0, 0];
    for (const i of ids) for (let k = 0; k < 3; k++) c[k] = c[k]! + P[3 * i + k]! / ids.length;
    return c;
  };

  // --- Keep the body and the two eyes ----------------------------------------------------------
  const keepGroups = ['body', 'helper-l-eye', 'helper-r-eye'];
  const quads = keepGroups.flatMap((g) => groups.get(g)!);
  const used = [...new Set(quads.flat())].sort((a, b) => a - b);
  const remap = new Int32Array(nAll).fill(-1);
  used.forEach((v, k) => (remap[v] = k));
  const n = used.length;
  // The body group's vertices come first in base.obj (0 … 13379), so they stay first here; the eyes follow.
  if (Math.max(...new Set(groups.get('body')!.flat())) + 1 !== new Set(groups.get('body')!.flat()).size) throw new Error('body vertices are not first in base.obj');

  // Decimetres to centimetres, floor at y = 0 (the lowest body vertex).
  let floor = Infinity;
  for (const v of used) floor = Math.min(floor, P[3 * v + 1]!);
  const cm = (p: V3): V3 => [p[0] * 10, (p[1] - floor) * 10, p[2] * 10];
  const pos = new Float64Array(3 * n);
  used.forEach((v, k) => pos.set(cm([P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!]), 3 * k));

  // --- Skin weights of the arms and the head (MakeHuman's own, CC0) -----------------------------
  const rig = JSON.parse(read('src/mpfb/data/rigs/standard/rig.default.json').toString('utf8')) as Record<string, { parent: string | null }>;
  const weightsFile = JSON.parse(read('src/mpfb/data/rigs/standard/weights.default.json').toString('utf8')) as { license: string; weights: Record<string, [number, number][]> };
  if (weightsFile.license !== 'CC0') throw new Error('weights.default.json no longer says CC0');
  const children = new Map<string, string[]>();
  for (const [bone, b] of Object.entries(rig)) if (b.parent) children.set(b.parent, [...(children.get(b.parent) ?? []), bone]);
  const descendants = (bone: string): string[] => [bone, ...(children.get(bone) ?? []).flatMap(descendants)];
  const sumOf = (bones: string[]): Float64Array => {
    const w = new Float64Array(nAll);
    const total = new Float64Array(nAll);
    for (const list of Object.values(weightsFile.weights)) for (const [i, x] of list) total[i] = total[i]! + x;
    for (const bone of bones) for (const [i, x] of weightsFile.weights[bone] ?? []) w[i] = w[i]! + x;
    // Normalised by the vertex's total weight (MakeHuman's weights sum to about 1).
    for (let i = 0; i < nAll; i++) w[i] = total[i]! > 0 ? Math.min(1, w[i]! / total[i]!) : 0;
    return w;
  };
  const armL = sumOf(descendants('upperarm01.L'));
  const armR = sumOf(descendants('upperarm01.R'));
  const headW = sumOf(descendants('head'));
  const armWeight = new Float32Array(n);
  const headWeight = new Float32Array(n);
  used.forEach((v, k) => {
    armWeight[k] = Math.max(armL[v]!, armR[v]!);
    // The eyes belong to the head (the eye helpers carry the eye bones' weight).
    headWeight[k] = headW[v]!;
  });

  // --- Arms to the A-pose -----------------------------------------------------------------------
  const jointL = cm(cube('joint-l-shoulder'));
  const wristL = cm(cube('joint-l-hand'));
  if (jointL[0] <= 0) throw new Error('joint-l-shoulder is not on +X: the axes are not as expected');
  const turn = (side: 1 | -1): number[] => {
    const j: V3 = [side * jointL[0], jointL[1], jointL[2]];
    const w: V3 = [side * wristL[0], wristL[1], wristL[2]];
    const a = unit([w[0] - j[0], w[1] - j[1], w[2] - j[2]]);
    const rad = (A_POSE_DEG * Math.PI) / 180;
    const b: V3 = [side * Math.sin(rad), -Math.cos(rad), 0];
    return rotationBetween(a, b);
  };
  const before = (Math.acos(-unit([wristL[0] - jointL[0], wristL[1] - jointL[1], wristL[2] - jointL[2]])[1]) * 180) / Math.PI;
  const turnL = turn(1), turnR = turn(-1);
  const deltaFrame = (k: number, d: V3): V3 => {
    // A delta follows the arm's turn by the vertex's arm weight (linear blend, as the positions).
    const w = armWeight[k]!;
    if (w === 0) return d;
    const r = mul(pos[3 * k]! >= 0 ? turnL : turnR, d);
    return [d[0] + w * (r[0] - d[0]), d[1] + w * (r[1] - d[1]), d[2] + w * (r[2] - d[2])];
  };
  const posed = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    const p: V3 = [pos[3 * k]!, pos[3 * k + 1]!, pos[3 * k + 2]!];
    const side = p[0] >= 0 ? 1 : -1;
    const j: V3 = [side * jointL[0], jointL[1], jointL[2]];
    const r = mul(side === 1 ? turnL : turnR, [p[0] - j[0], p[1] - j[1], p[2] - j[2]]);
    const w = armWeight[k]!;
    for (let c = 0; c < 3; c++) posed[3 * k + c] = p[c]! + w * (j[c]! + r[c]! - p[c]!);
  }
  const wristPosed = (() => {
    const r = mul(turnL, [wristL[0] - jointL[0], wristL[1] - jointL[1], wristL[2] - jointL[2]]);
    return [jointL[0] + r[0], jointL[1] + r[1], jointL[2] + r[2]] as V3;
  })();

  // --- Triangles --------------------------------------------------------------------------------
  const tris: number[] = [];
  for (const q of quads) {
    const v = q.map((i) => remap[i]!);
    if (v.length === 4) tris.push(v[0]!, v[1]!, v[2]!, v[0]!, v[2]!, v[3]!);
    else for (let k = 1; k + 1 < v.length; k++) tris.push(v[0]!, v[k]!, v[k + 1]!);
  }
  let indices = Uint32Array.from(tris);
  // Counter-clockwise from outside (positive volume), as every mesh of the mannequin.
  if (signedVolume(posed, indices) < 0) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!];
  indices = Uint32Array.from(indices);

  // The arm's own centre line: the joint cube sits in the humeral head and the hand cube at the wrist, but the line
  // through them is not the line through the arm's sections. The fit puts the arm on the mannequin's arm axis, so it
  // takes the least-squares line through the centres of the sections perpendicular to the cube axis (every 2 cm from
  // 8 cm under the joint to 4 cm above the wrist), and the joint and wrist as their projections onto it.
  const armLine = armCentreLine(posed, indices, jointL, wristPosed);

  // --- Shape targets (sparse, in the posed frame) ------------------------------------------------
  const targets = {} as RealisticBodyAsset['targets'];
  for (const t of SHAPE_TARGETS) {
    const ids: number[] = [];
    const deltas: number[] = [];
    for (const [i, d] of target(TARGET_FILES[t])) {
      const k = remap[i]!;
      if (k < 0) continue;
      const dd = deltaFrame(k, [d[0] * 10, d[1] * 10, d[2] * 10]);
      if (Math.hypot(...dd) < 0.002) continue;
      ids.push(k);
      deltas.push(...dd);
    }
    const order = ids.map((_, j) => j).sort((a, b) => ids[a]! - ids[b]!);
    targets[t] = { ids: Uint32Array.from(order.map((j) => ids[j]!)), deltas: Float32Array.from(order.flatMap((j) => [deltas[3 * j]!, deltas[3 * j + 1]!, deltas[3 * j + 2]!])) };
  }

  // --- Levels and girths ------------------------------------------------------------------------
  let top = -Infinity;
  for (let k = 0; k < n; k++) top = Math.max(top, posed[3 * k + 1]!);
  const levels = findLevels(posed, indices, top, cm(cube('joint-l-knee'))[1], jointL[1]);
  const girthsOf = (p: Float64Array): Record<BodyRing, number> => {
    const out = {} as Record<BodyRing, number>;
    for (const r of BODY_RINGS) out[r] = levelGirth(p, indices, levels[r], r);
    return out;
  };
  const withTarget = (t: ShapeTarget): Float64Array => {
    const p = Float64Array.from(posed);
    const { ids, deltas } = targets[t];
    for (let j = 0; j < ids.length; j++) for (let c = 0; c < 3; c++) p[3 * ids[j]! + c] = p[3 * ids[j]! + c]! + deltas[3 * j + c]!;
    return p;
  };
  const girths = { base: girthsOf(posed) } as RealisticBodyMeta['girths'];
  for (const t of SHAPE_TARGETS) girths[t] = girthsOf(withTarget(t));

  // --- Signed CC0 face shape targets (WO-020), masked strictly above the neck ring -------------
  const smooth01 = (v: number): number => {
    const c = Math.max(0, Math.min(1, v));
    return c * c * (3 - 2 * c);
  };
  const bodyVertexCount = new Set(groups.get('body')!.flat()).size;
  const faceTargets: Partial<Record<FaceShapeTarget, { ids: Uint32Array; deltas: Float32Array }>> = {};
  for (const t of FACE_SHAPE_TARGETS) {
    const pair = FACE_TARGET_FILES[t];
    const acc = new Map<number, V3>();
    const addMap = (rel: string, scale: number): void => {
      for (const [i, d] of target(rel)) {
        const k = remap[i]!;
        if (k < 0) continue;
        const dd = deltaFrame(k, [d[0] * 10, d[1] * 10, d[2] * 10]);
        const cur = acc.get(k) ?? [0, 0, 0];
        cur[0] += scale * dd[0];
        cur[1] += scale * dd[1];
        cur[2] += scale * dd[2];
        acc.set(k, cur);
      }
    };
    for (const rel of pair.pos) addMap(rel, 0.5);
    for (const rel of pair.neg) addMap(rel, -0.5);
    const ids: number[] = [];
    const deltas: number[] = [];
    for (const [k, d] of acc) {
      const y = posed[3 * k + 1]!;
      const hw = headWeight[k]!;
      // Strictly above the neck ring so neck girth, body rings and fit never change.
      if (hw < 0.05 || y <= levels.neck + 1.0) continue;
      const mask = smooth01((y - (levels.neck + 1.0)) / 2.5) * smooth01((hw - 0.05) / 0.25);
      // Keep crown height steady on faceHeight so overall stature stays on target.
      const crownKeep = t === 'faceHeight' ? 1 - 0.75 * smooth01((y - (top - 3.0)) / 3.0) : 1;
      const dx = d[0] * mask;
      const dy = d[1] * mask * crownKeep;
      const dz = d[2] * mask;
      if (Math.hypot(dx, dy, dz) < 0.01) continue;
      ids.push(k);
      deltas.push(dx, dy, dz);
    }
    const order = ids.map((_, j) => j).sort((a, b) => ids[a]! - ids[b]!);
    faceTargets[t] = {
      ids: Uint32Array.from(order.map((j) => ids[j]!)),
      deltas: Float32Array.from(order.flatMap((j) => [deltas[3 * j]!, deltas[3 * j + 1]!, deltas[3 * j + 2]!])),
    };
  }
  const faceLandmarks = findFaceLandmarks(posed, bodyVertexCount, levels.neck);

  // --- Quantise and write -------------------------------------------------------------------------
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) {
    lo[c] = Math.min(lo[c]!, posed[3 * k + c]!);
    hi[c] = Math.max(hi[c]!, posed[3 * k + c]!);
  }
  const offset: V3 = [round((lo[0] + hi[0]) / 2), round((lo[1] + hi[1]) / 2), round((lo[2] + hi[2]) / 2)];
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const step = Math.ceil((span / 65000) * 1e4) / 1e4;
  let maxDelta = 0;
  for (const t of SHAPE_TARGETS) for (const d of targets[t].deltas) maxDelta = Math.max(maxDelta, Math.abs(d));
  for (const t of FACE_SHAPE_TARGETS) for (const d of faceTargets[t]!.deltas) maxDelta = Math.max(maxDelta, Math.abs(d));
  const deltaStep = Math.max(0.001, Math.ceil((maxDelta / 32000) * 1e4) / 1e4);
  const meta: RealisticBodyMeta = {
    format: REALISTIC_BODY_FORMAT,
    version: REALISTIC_BODY_VERSION,
    family: 'female',
    vertexCount: n,
    bodyVertexCount,
    triangleCount: indices.length / 3,
    statureCm: round(top),
    levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, round(v)])) as RealisticBodyMeta['levels'],
    arm: armLine,
    girths: Object.fromEntries(Object.entries(girths).map(([k, g]) => [k, Object.fromEntries(Object.entries(g).map(([r, v]) => [r, round(v)]))])) as RealisticBodyMeta['girths'],
    quant: { offset, step, deltaStep },
    targetCounts: SHAPE_TARGETS.map((t) => targets[t].ids.length),
    faceTargetNames: FACE_SHAPE_TARGETS,
    faceTargetCounts: FACE_SHAPE_TARGETS.map((t) => faceTargets[t]!.ids.length),
    faceLandmarks,
    source: { name: 'MakeHuman base mesh hm08, female macro & face targets, default rig weights (via MPFB2)', repository: REPOSITORY, commit: COMMIT, licence: 'CC0-1.0 (LICENSE.md section C, LICENSE.ASSETS.md)' },
  };
  const asset: RealisticBodyAsset = { meta, positions: Float32Array.from(posed), indices, armWeight, headWeight, targets, faceTargets };
  const bytes = encodeRealisticBody(asset);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, bytes);
  const topo = topology({ positions: posed, indices, vertexPart: new Uint8Array(n), partNames: ['body'] });
  console.log(JSON.stringify({
    out: outFile,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    vertices: n,
    triangles: indices.length / 3,
    armDegBefore: round(before),
    stature: meta.statureCm,
    levels: meta.levels,
    arm: meta.arm,
    girths: meta.girths,
    targetCounts: meta.targetCounts,
    faceTargetCounts: meta.faceTargetCounts,
    faceLandmarks: meta.faceLandmarks,
    quant: meta.quant,
    topology: topo,
  }, null, 1));
}

/** Locate the 26 symmetric anatomical head landmark vertices on the posed MakeHuman female mesh (WO-020). */
function findFaceLandmarks(p: Float64Array, bodyN: number, neckY: number): Record<FaceLandmarkName, number> {
  const best = (filter: (x: number, y: number, z: number) => boolean, score: (x: number, y: number, z: number) => number): number => {
    let idx = -1, hi = -Infinity;
    for (let i = 0; i < bodyN; i++) {
      const x = p[3 * i]!, y = p[3 * i + 1]!, z = p[3 * i + 2]!;
      if (y <= neckY || !filter(x, y, z)) continue;
      const s = score(x, y, z);
      if (s > hi) { hi = s; idx = i; }
    }
    if (idx < 0) throw new Error('bake: face landmark not found');
    return idx;
  };
  const mirror = (leftId: number): number => {
    const tx = -p[3 * leftId]!, ty = p[3 * leftId + 1]!, tz = p[3 * leftId + 2]!;
    let idx = -1, lo = Infinity;
    for (let i = 0; i < bodyN; i++) {
      const d = Math.hypot(p[3 * i]! - tx, p[3 * i + 1]! - ty, p[3 * i + 2]! - tz);
      if (d < lo) { lo = d; idx = i; }
    }
    if (idx < 0 || lo > 0.25) throw new Error(`bake: asymmetric face landmark ${leftId} (err ${lo})`);
    return idx;
  };
  const lCheek = best((x, y, z) => x > 4.5 && y > 144.5 && y < 147.2 && z > 9.5 && z < 11.5, (x, _y, z) => x + 0.5 * z);
  const lJaw = best((x, y, z) => x > 4.5 && y > 140.8 && y < 142.8 && z > 6.5 && z < 8.8, (x, _y, z) => x + 0.2 * z);
  const lChinSide = best((x, y, z) => x > 1.6 && x < 2.5 && y > 139.0 && y < 140.2 && z > 11.8, (x, _y, z) => z + 0.4 * x);
  const lEyeInner = best((x, y, z) => x > 1.2 && x < 2.0 && Math.abs(y - 148.55) < 0.4 && z > 12.2, (x, y, z) => -x + 0.4 * z - Math.abs(y - 148.55));
  const lEyeOuter = best((x, y, z) => x > 3.8 && x < 4.7 && Math.abs(y - 148.6) < 0.4 && z > 11.2, (x, y, z) => x + 0.3 * z - Math.abs(y - 148.6));
  const lBrow = best((x, y, z) => x > 2.7 && x < 3.4 && y > 150.6 && y < 151.6 && z > 12.4, (x, _y, z) => z - Math.abs(x - 3.05));
  const lNoseAlar = best((x, y, z) => x > 1.3 && x < 2.0 && y > 144.4 && y < 145.2 && z > 12.8, (x, _y, z) => x + 0.4 * z);
  const lMouthCorner = best((x, y, z) => x > 2.0 && x < 2.7 && y > 142.3 && y < 142.9 && z > 12.8, (x, _y, z) => x + 0.3 * z);
  return {
    foreheadTop: best((x, y, z) => Math.abs(x) < 0.15 && y > 155.2 && y < 156.2 && z > 11, (_x, _y, z) => z),
    glabella: best((x, y, z) => Math.abs(x) < 0.15 && y > 150.1 && y < 150.9 && z > 13, (_x, _y, z) => z),
    nasion: best((x, y, z) => Math.abs(x) < 0.15 && y > 148.6 && y < 149.1 && z > 13, (_x, _y, z) => -z),
    noseTip: best((x, y, z) => Math.abs(x) < 0.15 && y > 144.8 && y < 146.0 && z > 14, (_x, _y, z) => z),
    subnasale: best((x, y, z) => Math.abs(x) < 0.15 && y > 144.0 && y < 144.5 && z > 13.8, (_x, _y, z) => -z),
    upperLip: best((x, y, z) => Math.abs(x) < 0.15 && y > 143.1 && y < 143.6 && z > 14, (_x, _y, z) => z),
    mouthCenter: best((x, y, z) => Math.abs(x) < 0.15 && y > 142.45 && y < 142.85 && z > 13.9, (_x, _y, z) => z),
    lowerLip: best((x, y, z) => Math.abs(x) < 0.15 && y > 141.6 && y < 142.1 && z > 13.9, (_x, _y, z) => z),
    chinFront: best((x, y, z) => Math.abs(x) < 0.15 && y > 139.9 && y < 140.6 && z > 13, (_x, _y, z) => z),
    chinMenton: best((x, y, z) => Math.abs(x) < 0.15 && y > 138.4 && y < 138.9 && z > 11.8 && z < 12.6, (_x, y, z) => -y + 0.2 * z),
    lCheek, rCheek: mirror(lCheek),
    lJaw, rJaw: mirror(lJaw),
    lChinSide, rChinSide: mirror(lChinSide),
    lEyeInner, rEyeInner: mirror(lEyeInner),
    lEyeOuter, rEyeOuter: mirror(lEyeOuter),
    lBrow, rBrow: mirror(lBrow),
    lNoseAlar, rNoseAlar: mirror(lNoseAlar),
    lMouthCorner, rMouthCorner: mirror(lMouthCorner),
  };
}

function armCentreLine(p: Float64Array, idx: Uint32Array, joint: V3, wrist: V3): { joint: V3; wrist: V3 } {
  const axis = unit([wrist[0] - joint[0], wrist[1] - joint[1], wrist[2] - joint[2]]);
  const len = Math.hypot(wrist[0] - joint[0], wrist[1] - joint[1], wrist[2] - joint[2]);
  const u = unit([-axis[1], axis[0], 0]);
  const v: V3 = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  const pts: V3[] = [];
  for (let s = 8; s <= len - 4; s += 2) {
    const o: V3 = [joint[0] + axis[0] * s, joint[1] + axis[1] * s, joint[2] + axis[2] * s];
    const sec = sectionAt(p, idx, o, axis, u, v);
    if (!sec) continue;
    pts.push([o[0] + u[0] * sec.cu + v[0] * sec.cv, o[1] + u[1] * sec.cu + v[1] * sec.cv, o[2] + u[2] * sec.cu + v[2] * sec.cv]);
  }
  if (pts.length < 5) throw new Error('arm centre line: too few sections');
  // Least-squares line: the mean and the principal direction (power iteration on the scatter matrix).
  const c: V3 = [0, 0, 0];
  for (const q of pts) for (let k = 0; k < 3; k++) c[k] = c[k]! + q[k]! / pts.length;
  let d: V3 = axis;
  for (let it = 0; it < 50; it++) {
    const nd: V3 = [0, 0, 0];
    for (const q of pts) {
      const r: V3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
      const t = dot(r, d);
      for (let k = 0; k < 3; k++) nd[k] = nd[k]! + r[k]! * t;
    }
    d = unit(nd);
  }
  if (dot(d, axis) < 0) d = [-d[0], -d[1], -d[2]];
  const onLine = (x: V3): V3 => {
    const t = dot([x[0] - c[0], x[1] - c[1], x[2] - c[2]], d);
    return [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
  };
  return { joint: onLine(joint).map(round) as V3, wrist: onLine(wrist).map(round) as V3 };
}

/** Loop girth of the body section at a level: the torso's (|centroid x| < 4 cm) or the left leg's / arm's. */
function levelGirth(p: Float64Array, idx: Uint32Array, y: number, ring: BodyRing): number {
  const secs = horizontalSections(p, idx, y);
  const leg = ring === 'thigh' || ring === 'knee' || ring === 'calf' || ring === 'ankle';
  const pick = leg ? secs.filter((s) => s.cu > 3 && s.cu < 20) : secs.filter((s) => Math.abs(s.cu) < 4);
  pick.sort((a, b) => b.loopCm - a.loopCm);
  if (!pick[0]) throw new Error(`no ${ring} section at y ${y}`);
  return pick[0].loopCm;
}

/**
 * The anatomical levels of the baked mesh that the mannequin's rings stand for. Found on the mesh by scanning
 * horizontal sections every 0.25 cm: the crotch (lowest level with one torso section), the ankle (narrowest leg
 * between 4 and 14 cm), the calf (widest leg between ankle and knee), the knee (MakeHuman's knee joint), the thigh
 * (as far under the crotch as on the mannequin, by share of stature), the hip (widest torso up to 22 cm over the
 * crotch), the waist (narrowest torso over the hip), the chest (widest torso between the waist and the armpit), the
 * underbust (at the mannequin's share of the way from waist to chest), the shoulder
 * (MakeHuman's shoulder joint plus the mannequin's ring offset) and the neck (3 cm under the chin at the base
 * stature, the chin being where the section's front jumps forward).
 */
function findLevels(p: Float64Array, idx: Uint32Array, top: number, kneeJointY: number, shoulderJointY: number): RealisticBodyMeta['levels'] {
  const S = top;
  const torso = (y: number) => {
    const s = horizontalSections(p, idx, y).filter((x) => Math.abs(x.cu) < 4).sort((a, b) => b.loopCm - a.loopCm);
    return s[0] ?? null;
  };
  const leg = (y: number) => {
    const s = horizontalSections(p, idx, y).filter((x) => x.cu > 3 && x.cu < 20).sort((a, b) => b.loopCm - a.loopCm);
    return s[0] ?? null;
  };
  const scan = <T>(lo: number, hi: number, f: (y: number) => T | null): { y: number; v: T }[] => {
    const out: { y: number; v: T }[] = [];
    for (let y = lo; y <= hi; y += 0.25) {
      const v = f(y);
      if (v !== null) out.push({ y, v });
    }
    return out;
  };
  const arg = <T>(rows: { y: number; v: T }[], key: (v: T) => number, max: boolean): number => {
    let best = rows[0]!;
    for (const r of rows) if (max ? key(r.v) > key(best.v) : key(r.v) < key(best.v)) best = r;
    return best.y;
  };
  // Crotch: going up from mid-thigh, the first level whose torso section (centred) exists.
  let crotch = 0;
  for (let y = 0.35 * S; y < 0.6 * S; y += 0.1) {
    if (torso(y)) {
      crotch = y;
      break;
    }
  }
  if (!crotch) throw new Error('crotch not found');
  const ankle = arg(scan(4, 14, leg), (s) => s.loopCm, false);
  const knee = kneeJointY;
  const calf = arg(scan(ankle + 5, knee - 5, leg), (s) => s.loopCm, true);
  const thigh = crotch - (76.44 - 72.2) / 168 * S;
  const waist = arg(scan(crotch + 15, crotch + 0.25 * S, torso), (s) => s.loopCm, false);
  const back = (s: { q: [number, number][] }): number => Math.min(...s.q.map((q) => q[1]));
  // The seat: the most backward point of the buttocks between the crotch and the waist (the girth just over the crotch
  // is inflated by the thighs' tops, so the widest section is not the hip).
  const hip = arg(scan(crotch + 2, waist - 5, torso), back, false);
  // The armpit: the torso section's girth jumps where the arms join it.
  let armpit = 0;
  let prev = torso(waist)!.loopCm;
  for (let y = waist + 0.25; y < shoulderJointY; y += 0.25) {
    const s = torso(y);
    if (!s) continue;
    if (s.loopCm > prev * 1.12) {
      armpit = y - 0.25;
      break;
    }
    prev = s.loopCm;
  }
  if (!armpit) throw new Error('armpit not found');
  const chest = arg(scan(waist + 5, armpit - 0.5, torso), (s) => s.loopCm, true);
  const front = (s: { q: [number, number][] }): number => Math.max(...s.q.map((q) => q[1]));
  // The mannequin's underbust is a proportion ring (40 % of the way from chest to waist girth), not the fold under the
  // breast: it sits at the same share of the way from waist to chest here, so the bust is not stretched vertically.
  const underbust = waist + UNDERBUST_SHARE * (chest - waist);
  const shoulder = shoulderJointY + SHOULDER_RING_ABOVE_JOINT * S;
  // The chin: going up from the shoulder, the first level where the front of the section jumps forward (the jaw).
  let chin = 0;
  let lastFront = front(torso(shoulder)!);
  for (let y = shoulder + 0.25; y < shoulder + 0.15 * S; y += 0.25) {
    const s = torso(y);
    if (!s) continue;
    const f = front(s);
    if (f > lastFront + 2) {
      chin = y;
      break;
    }
    lastFront = f;
  }
  if (!chin) throw new Error('chin not found');
  // The neck ring: 3 cm (at stature 159) under the chin, mid-neck.
  const neck = chin - NECK_BELOW_CHIN * S;
  console.error(`levels: armpit ${round(armpit)}, chin ${round(chin)}`);
  return { neck, shoulder, chest, underbust, waist, hip, thigh, knee, calf, ankle, crotch, top };
}

function signedVolume(p: ArrayLike<number>, idx: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const i = 3 * idx[t]!, j = 3 * idx[t + 1]!, k = 3 * idx[t + 2]!;
    v += (p[i]! * (p[j + 1]! * p[k + 2]! - p[j + 2]! * p[k + 1]!) - p[i + 1]! * (p[j]! * p[k + 2]! - p[j + 2]! * p[k]!) + p[i + 2]! * (p[j]! * p[k + 1]! - p[j + 1]! * p[k]!)) / 6;
  }
  return v;
}

const round = (v: number): number => Math.round(v * 1000) / 1000;
const unit = (x: V3): V3 => {
  const l = Math.hypot(x[0], x[1], x[2]) || 1;
  return [x[0] / l, x[1] / l, x[2] / l];
};
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mul = (r: number[], x: V3): V3 => [r[0]! * x[0] + r[1]! * x[1] + r[2]! * x[2], r[3]! * x[0] + r[4]! * x[1] + r[5]! * x[2], r[6]! * x[0] + r[7]! * x[1] + r[8]! * x[2]];
function rotationBetween(a: V3, b: V3): number[] {
  const c = dot(a, b);
  const v: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const k = 1 / (1 + c);
  return [
    v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
  ];
}

main();
