// Before/after of the pilot pull-on skirt across a grid of bodies, and the sensitivity of the
// result to the chosen margins. Reads the built packages: run `pnpm build` in schema and here first.
//   node packages/fit-engine/scripts/pilot-skirt-grid.mjs
import { PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY } from '@curtain/schema';
import { computeFit, fitSummary } from '../dist/index.js';

const body = (waist, hip) => ({ measurements: { waist, hip } });
const rec = (r) => (r.recommendedSize === null ? `none (closest ${r.closestSize})` : r.recommendedSize);
const perSize = (r) =>
  r.perSize
    .map((s) => {
      const w = s.points.find((p) => p.point === 'waist');
      const band = w && !('omitted' in w) ? w.band : '-';
      const po = s.pullOn ? `${s.pullOn.status} ${s.pullOn.marginCm > 0 ? '+' : ''}${s.pullOn.marginCm}` : '';
      return `${s.size}: ${band}${po ? ` / ${po}` : ''}`;
    })
    .join(' | ');

const NAMED = [
  ['chart AU 8', 67.5, 94],
  ['chart AU 10', 72.5, 99],
  ['held-out', 73.5, 100],
  ['chart AU 12', 77.5, 104],
  ['chart AU 14', 82.5, 109],
  ['chart AU 16', 87.5, 114],
];

console.log('## Named bodies\n');
console.log('| Body (waist / hip) | Before | After | Confidence before -> after | After, per size: waist band / pull-on status and margin (cm) |');
console.log('|---|---|---|---|---|');
for (const [name, waist, hip] of NAMED) {
  const b = computeFit(PILOT_SKIRT_CHART_ONLY, body(waist, hip));
  const a = computeFit(PILOT_PULL_ON_SKIRT, body(waist, hip));
  console.log(`| ${name} (${waist} / ${hip}) | ${rec(b)} | ${rec(a)} | ${b.confidence} -> ${a.confidence} | ${perSize(a)} |`);
}

console.log('\n## Grid: hip 88 to 122, three waist-to-hip differences\n');
const DIFFS = [
  ['curvier (hip − 31.5)', 31.5],
  ['chart shape (hip − 26.5)', 26.5],
  ['straighter (hip − 21.5)', 21.5],
];
console.log(`| Hip | ${DIFFS.map(([n]) => `${n}: before -> after`).join(' | ')} |`);
console.log(`|---|${DIFFS.map(() => '---').join('|')}|`);
const grid = [];
for (let hip = 88; hip <= 122; hip += 2) {
  const cells = DIFFS.map(([, d]) => {
    const u = body(hip - d, hip);
    grid.push(u);
    const b = computeFit(PILOT_SKIRT_CHART_ONLY, u);
    const a = computeFit(PILOT_PULL_ON_SKIRT, u);
    const st = a.closestIndex !== undefined ? a.perSize[a.closestIndex].pullOn?.status : undefined;
    const mark = rec(b) === rec(a) ? '' : ' **changed**';
    return `${rec(b)} -> ${rec(a)}${st && st !== 'clear' ? ` (${st})` : ''}${mark}`;
  });
  console.log(`| ${hip} | ${cells.join(' | ')} |`);
}

const count = (tuning) => {
  let changed = 0;
  let none = 0;
  let marginal = 0;
  let differs = 0;
  for (const u of grid) {
    const b = computeFit(PILOT_SKIRT_CHART_ONLY, u);
    const d = computeFit(PILOT_PULL_ON_SKIRT, u);
    const a = computeFit(PILOT_PULL_ON_SKIRT, u, { tapeTuning: tuning });
    if (rec(a) !== rec(b)) changed++;
    if (rec(a) !== rec(d)) differs++;
    if (a.recommendedSize === null) none++;
    else if (a.perSize[a.closestIndex].pullOn?.status === 'marginal') marginal++;
  }
  return { changed, differs, none, marginal };
};

console.log(`\n## Sensitivity over the ${grid.length} grid bodies\n`);
console.log('| Setting | Recommendation differs from before | differs from the default setting | no size recommended | recommended size carries the warning |');
console.log('|---|---|---|---|---|');
const row = (label, tuning) => {
  const c = count(tuning);
  console.log(`| ${label} | ${c.changed} | ${c.differs} | ${c.none} | ${c.marginal} |`);
};
row('default (allowance 2.5, marginal below 2.5, extrapolated allowance 0, prefer passing, easy share 0.5)', {});
row('no preference for a passing band among equal fits', { pullOnPreferPassing: false });
for (const a of [0, 1, 2.5, 4, 5, 7.5]) row(`allowance ${a} cm`, { pullOnAllowanceCm: a });
for (const m of [0, 1, 2.5, 5]) row(`marginal below ${m} cm`, { pullOnMarginalBelowCm: m });
for (const e of [0, 1, 2.5]) row(`extrapolated allowance ${e} cm`, { pullOnExtrapolatedAllowanceCm: e });
for (const k of [0.25, 0.5, 0.75, 1]) row(`easy stretch share ${k}`, { easyStretchShare: k });

console.log('\n## Sentences (after)\n');
for (const [name, waist, hip] of NAMED) {
  const a = computeFit(PILOT_PULL_ON_SKIRT, body(waist, hip));
  console.log(`- ${name}: ${fitSummary(a)}`);
  for (const n of a.notes) console.log(`  - ${n}`);
}
