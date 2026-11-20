/**
 * Derives the male reference table of `src/families.ts` from the ANSUR II male working database.
 *
 * Source: "2012 Anthropometric Survey of U.S. Army Personnel" (ANSUR II), U.S. Army Natick Soldier
 * RD&E Center, report NATICK/TR-15/007, distribution statement "Approved for public release;
 * distribution is unlimited" (a work of the U.S. Government: public domain in the United States,
 * 17 U.S.C. §105). Data file `ANSUR_II_MALE_Public.csv` (4082 men, millimetres) as published at
 * https://www.openlab.psu.edu/ansur2/ ; sha256 of the file read on 13 Nov 2026:
 * 0547aea0170e5293de519389981135e75803f02e6d40c77ace740decc0caac64. The file is not committed.
 *
 * Method: an ordinary least-squares line of every measure on chest circumference over all 4082
 * men, evaluated at the chest girth of each size (the midpoint of the EN 13402-3 letter interval's
 * two 4 cm steps). Girths are rounded to 0.5 cm, levels to 0.001 of stature, aspects to 0.01.
 *
 * With a second path, `ANSUR_II_FEMALE_Public.csv` (1986 women, same page, sha256 read on 14 Nov 2026:
 * ed7e800aa97a4d42f8286b988be2fe1883a2e789588169db959864b707d1757a), it also prints
 * `FEMALE_SHOULDER_REFERENCE`: biacromial breadth on chest circumference at the female v0 chest girths.
 *
 * "EN 13402-3" below means the 2004 edition as reproduced in the Wikipedia article "Joint European
 * standard for size labelling of clothes"; the standard itself was not read.
 *
 * It also prints `MALE_SECTION_REFERENCE` of `src/maleV2.ts` (male shape v2): ANSUR's chest, waist and
 * hip breadth and depth, its own waist (omphalion) and buttock girths, and the axilla and acromion
 * levels, on the same lines at the same chest girths (0.1 cm, levels 0.001 of the line's stature).
 *
 * Run: pnpm --filter @curtain/mannequin exec tsx scripts/derive-male-table.ts <path to ANSUR_II_MALE_Public.csv> [<path to ANSUR_II_FEMALE_Public.csv>]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EXPECTED_SHA256 = '0547aea0170e5293de519389981135e75803f02e6d40c77ace740decc0caac64';
const path = process.argv[2];
if (!path) throw new Error('usage: derive-male-table.ts <ANSUR_II_MALE_Public.csv>');
const bytes = readFileSync(path);
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== EXPECTED_SHA256) console.warn(`[derive] warning: file sha256 ${sha} differs from the one the table was derived from`);

const lines = bytes.toString('latin1').split(/\r?\n/).filter((l) => l.length > 0);
const header = lines[0]!.split(',');
const column = (name: string): number[] => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`no column ${name}`);
  // Millimetres → centimetres. The measures used here are all in the first 94 numeric columns (no quoted commas before them).
  return lines.slice(1).map((l) => Number(l.split(',')[i]) / 10);
};

const chest = column('chestcircumference');
const n = chest.length;
const mean = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
const mx = mean(chest);
const sxx = chest.reduce((s, x) => s + (x - mx) ** 2, 0);
/** Least-squares line of a measure on chest girth. */
function line(name: string): { at: (chestCm: number) => number; r: number; mean: number } {
  const y = column(name);
  const my = mean(y);
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (chest[i]! - mx) * (y[i]! - my);
    syy += (y[i]! - my) ** 2;
  }
  const k = sxy / sxx;
  return { at: (c) => my + k * (c - mx), r: sxy / Math.sqrt(sxx * syy), mean: my };
}

/** EN 13402-3 men, letter code → the two 4 cm chest steps it combines (6 cm steps from 120 up). */
const SIZES = { S: [88, 92], M: [96, 100], L: [104, 108], XL: [112, 116], XXL: [120, 126] } as const;
const half = (x: number): number => Math.round(x * 2) / 2;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

const measures = [
  'stature', 'waistcircumference', 'buttockcircumference', 'neckcircumference', 'biacromialbreadth', 'bideltoidbreadth', 'crotchheight',
  'thighcircumference', 'lowerthighcircumference', 'calfcircumference', 'anklecircumference', 'bicepscircumferenceflexed', 'wristcircumference',
  'chestbreadth', 'chestdepth', 'waistbreadth', 'waistdepth', 'hipbreadth', 'buttockdepth', 'sleeveoutseam',
] as const;
const L = Object.fromEntries(measures.map((m) => [m, line(m)])) as Record<(typeof measures)[number], ReturnType<typeof line>>;

console.log(`n = ${n}, mean chest ${mx.toFixed(2)} cm`);
for (const m of measures) console.log(`  ${m.padEnd(28)} mean ${L[m].mean.toFixed(2).padStart(7)}  r(chest) ${L[m].r.toFixed(2)}`);
for (const [id, [lo, hi]] of Object.entries(SIZES)) {
  const c = (lo + hi) / 2;
  const count = chest.filter((x) => x >= lo - 2 && x < hi + (hi >= 120 ? 3 : 2)).length;
  console.log(
    `${id}: chest ${c} (ANSUR men in the interval: ${count})`,
    JSON.stringify({
      stature: half(L.stature.at(c)),
      ansurWaistOmphalion: half(L.waistcircumference.at(c)),
      ansurNeck: half(L.neckcircumference.at(c)),
      hip: half(L.buttockcircumference.at(c)),
      shoulderWidth: half(L.biacromialbreadth.at(c)),
      bideltoid: half(L.bideltoidbreadth.at(c)),
      inseam: half(L.crotchheight.at(c)),
      thigh: half(L.thighcircumference.at(c)),
      lowerThigh: half(L.lowerthighcircumference.at(c)),
      calf: half(L.calfcircumference.at(c)),
      ankle: half(L.anklecircumference.at(c)),
      bicepsFlexed: half(L.bicepscircumferenceflexed.at(c)),
      wrist: half(L.wristcircumference.at(c)),
      sleeveOutseam: half(L.sleeveoutseam.at(c)),
      chestAspect: r2(L.chestdepth.at(c) / L.chestbreadth.at(c)),
      waistAspect: r2(L.waistdepth.at(c) / L.waistbreadth.at(c)),
      hipAspect: r2(L.buttockdepth.at(c) / L.hipbreadth.at(c)),
    }),
  );
}
// Male shape v2: breadth / depth / girth of the chest, waist and seat, and two levels, per size.
const r1 = (x: number): number => Math.round(x * 10) / 10;
const sectionLines = Object.fromEntries(['waistcircumference', 'buttockcircumference', 'chestbreadth', 'chestdepth', 'waistbreadth', 'waistdepth', 'hipbreadth', 'buttockdepth', 'axillaheight', 'acromialheight', 'stature'].map((m) => [m, line(m)]));
const sec = (m: string, c: number): number => sectionLines[m]!.at(c);
console.log('MALE_SECTION_REFERENCE', JSON.stringify(Object.fromEntries(Object.entries(SIZES).map(([id, [lo, hi]]) => {
  const c = (lo + hi) / 2;
  return [id, { chest: c, chestBreadth: r1(sec('chestbreadth', c)), chestDepth: r1(sec('chestdepth', c)), waistBreadth: r1(sec('waistbreadth', c)), waistDepth: r1(sec('waistdepth', c)), waistGirth: r1(sec('waistcircumference', c)), hipBreadth: r1(sec('hipbreadth', c)), buttockDepth: r1(sec('buttockdepth', c)), hipGirth: r1(sec('buttockcircumference', c)), axilla: r3(sec('axillaheight', c) / sec('stature', c)), acromion: r3(sec('acromialheight', c) / sec('stature', c)) }];
}))));
// Levels as fractions of stature, at the sample means (they move by less than 0.004 across the sizes).
const S = line('stature').mean;
const frac = (name: string): number => r3(line(name).mean / S);
console.log('levels', JSON.stringify({
  crotch: frac('crotchheight'),
  hip: frac('buttockheight'),
  waistBetweenIliocristaleAndTenthRib: r3((line('iliocristaleheight').mean + line('tenthribheight').mean) / 2 / S),
  waistOmphalion: frac('waistheightomphalion'),
  chest: frac('chestheight'),
  acromion: frac('acromialheight'),
  cervicale: frac('cervicaleheight'),
  knee: frac('kneeheightmidpatella'),
}));
console.log('arm fractions of stature', JSON.stringify({ acromionRadiale: frac('acromionradialelength'), radialeStylion: frac('radialestylionlength'), hand: frac('handlength'), sleeveOutseam: frac('sleeveoutseam') }));

// Female shoulder reference (biacromial breadth at the chest girths of the female v0 shapes).
const femalePath = process.argv[3];
if (femalePath) {
  const FEMALE_SHA256 = 'ed7e800aa97a4d42f8286b988be2fe1883a2e789588169db959864b707d1757a';
  const fBytes = readFileSync(femalePath);
  const fSha = createHash('sha256').update(fBytes).digest('hex');
  if (fSha !== FEMALE_SHA256) console.warn(`[derive] warning: female file sha256 ${fSha} differs from the one the reference was derived from`);
  const fLines = fBytes.toString('latin1').split(/\r?\n/).filter((l) => l.length > 0);
  const fHeader = fLines[0]!.split(',');
  const fColumn = (name: string): number[] => {
    const i = fHeader.indexOf(name);
    if (i < 0) throw new Error(`no column ${name}`);
    return fLines.slice(1).map((l) => Number(l.split(',')[i]) / 10);
  };
  const x = fColumn('chestcircumference');
  const yb = fColumn('biacromialbreadth');
  const fx = mean(x);
  const fy = mean(yb);
  let sxy = 0;
  let fsxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - fx) * (yb[i]! - fy);
    fsxx += (x[i]! - fx) ** 2;
  }
  const at = (c: number): number => half(fy + (sxy / fsxx) * (c - fx));
  console.log(`female n = ${x.length}, mean chest ${fx.toFixed(2)} cm, mean biacromial breadth ${fy.toFixed(2)} cm`);
  console.log('FEMALE_SHOULDER_REFERENCE', JSON.stringify({ XS: at(80), M: at(92), XXL: at(116) }));
}
