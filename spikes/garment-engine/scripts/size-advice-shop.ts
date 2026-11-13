/**
 * Size advice for a validated shop's products on test bodies (refinement P4), CPU only:
 *
 *   pnpm --filter @curtain/garment-spike size-advice:shop -- --shop nobodyschild [--out out/eval/<shop>-size-advice.json]
 *
 * Per product: the plugin's path (`sizeAdviceGarment` → `computeFit`) with the shop's own chart, and
 * the same bodies against two other charts the importer could have used: our UK template
 * (UK_WOMENS_BODY_TEMPLATE, a median of three UK retailers) and the AU chart (what an AU-only importer
 * would produce when it reads UK labels "8, 10, 12" as AU sizes). Where they disagree, the chart
 * choice changes the advice a shopper sees.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AU_WOMENS_BODY_CHART, UK_WOMENS_BODY_TEMPLATE, type GarmentPayloadDraft, type SizeRow } from '@curtain/schema';
import { adviseProduct, chartBodies, type AdviceRow, type TestBody } from '../src/shopSizeAdvice';
import type { ShopBodyChart } from '../src/shopImport';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const shop = opt('shop') ?? 'nobodyschild';
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(pkg, 'data', shop, 'products.json'), 'utf8')) as {
  sizeChart: ShopBodyChart;
  products: { handle: string; payload: GarmentPayloadDraft; baseSize?: string }[];
};
const chart = data.sizeChart;
const leg = chart.insideLeg.regular ?? 79;
const bodies: TestBody[] = [
  ...chartBodies(chart.numeric, ['8', '12', '16'], leg),
  { id: 'pear-10-14', note: "bust and waist of the shop's UK 10, hip of its UK 14", measurements: { bust: 90, waist: 72, hip: 107, inseam: leg } },
  { id: 'apple-12-16', note: "bust and hip of the shop's UK 12, waist of its UK 16", measurements: { bust: 95, waist: 90, hip: 102, inseam: leg } },
  { id: 'tall-12', note: `the shop's UK 12 with the long inside leg (${chart.insideLeg.long ?? 84} cm)`, measurements: { bust: 95, waist: 78, hip: 102, inseam: chart.insideLeg.long ?? 84 } },
];

/** For a letter-sized product a numeric body's expected sizes are the letters that cover them. */
function forLetters(b: TestBody): TestBody {
  if (!b.expect) return b;
  const letters = new Set<string>();
  for (const s of b.expect) for (const l of chart.letter) if (l.covers.includes(s)) letters.add(l.size);
  return { ...b, expect: [...letters] };
}

const rows: AdviceRow[] = [];
for (const p of data.products) {
  const sizes = (p.payload.sizeChart ?? []).map((r) => r.size);
  const letter = sizes.some((s) => /[A-Z]/i.test(s));
  const bs = letter ? bodies.map(forLetters) : bodies;
  rows.push(...adviseProduct(p.handle, p.payload, bs, 'shop'));
  if (!letter) {
    const pick = (src: readonly SizeRow[]): SizeRow[] => src.filter((r) => sizes.includes(r.size)).map((r) => ({ ...r, ...(p.payload.sizeChart?.[0]?.inseam !== undefined ? { inseam: p.payload.sizeChart[0].inseam } : {}) }));
    rows.push(...adviseProduct(p.handle, p.payload, bs, 'uk-template', pick(UK_WOMENS_BODY_TEMPLATE.rows)));
    rows.push(...adviseProduct(p.handle, p.payload, bs, 'au-misread', pick(AU_WOMENS_BODY_CHART)));
  }
}

const out = resolve(opt('out') ?? join(pkg, 'out', 'eval', `${shop}-size-advice.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ shop, bodies, rows }, null, 2)}\n`);
for (const p of data.products) {
  console.log(`\n${p.handle}`);
  for (const b of bodies) {
    const cells = ['shop', 'uk-template', 'au-misread'].map((c) => rows.find((r) => r.handle === p.handle && r.body === b.id && r.chart === c)).filter((r): r is AdviceRow => !!r);
    const s = cells[0]!;
    console.log(
      `  ${b.id.padEnd(16)} ${cells.map((r) => `${r.chart} ${r.recommended ?? `none (closest ${r.closest})`}`).join(' | ').padEnd(56)} ${s.ok === undefined ? '' : s.ok ? 'ok' : `NOT in ${s.expect!.join('/')}`}  [${s.points.join('; ')}]`,
    );
  }
}
const shopRows = rows.filter((r) => r.chart === 'shop');
const checked = shopRows.filter((r) => r.ok !== undefined);
const bad = checked.filter((r) => r.ok === false);
const exact = checked.filter((r) => r.body.startsWith('chart-'));
console.log(
  `\n[size-advice] ${shopRows.length} shop-chart cases: ${checked.length} checked (${exact.length} exact rows must give exactly the row's size, ${checked.length - exact.length} between-row bodies either neighbour), ${bad.length} outside the expected sizes; ${shopRows.length - checked.length} without expectation (shape bodies, judged by eye); written to ${out}`,
);
if (bad.length > 0) process.exitCode = 1;
