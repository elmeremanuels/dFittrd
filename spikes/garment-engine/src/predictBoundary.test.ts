/**
 * The three sizing-boundary tests of docs/PREDICTION-ENGINE.md §2: sizing never depends on prediction.
 *
 *   1. `computeFit` output is byte-identical with and without a predicted bundle present.
 *   2. For every predicted asset (P0: the control proxy / stage 4t template built from `predict()`), each critical
 *      anchor girth equals the fit-engine target within 0.1 cm (D15 pin).
 *   3. The predictor (`src/predict/`) imports nothing from capture, body or fit modules (also an eslint rule).
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_ANCHORS, FIT_POINT_TO_ANCHOR, isAnchorRing, type AnchorRing } from '@curtain/anchors';
import { computeFit, isPointFit, type FitGarment, type Point } from '@curtain/fit-engine';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, type Mannequin } from '@curtain/mannequin';
import { AU_WOMENS_BODY_CHART, MOCK_GARMENTS, sizeLabelKey, type GarmentPayload, type UserBody } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { measureRing } from './anchoring';
import { criticalRings, evalChart, isEvalCategory } from './evalChart';
import { parseFeatures } from './features';
import { predict, type PredictProduct } from './predict';
import { MIN_CLEARANCE_CM, buildProxy, openingHalfWidth, proxyRecord } from './proxy';

const here = dirname(fileURLToPath(import.meta.url));
const m: Mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
/** A user with every measurement the fit engine reads, so no point is omitted for lack of a user value (the targets do not depend on the user). */
const FULL_USER: UserBody = { measurements: { bust: 92, waist: 74, hip: 100, shoulder: 38, thigh: 56, inseam: 78, foot: 24 } };

const shopFile = JSON.parse(readFileSync(join(here, '..', 'data', 'bohohippychic', 'products.json'), 'utf8')) as {
  products: { handle: string; payload: GarmentPayload; baseSize: string; features?: unknown }[];
};

/** The spike fixtures, every mock garment the proxy can dress (middle size), the five shop drafts with their features, and edge cases. */
function products(): PredictProduct[] {
  const out: PredictProduct[] = [
    ...MOCK_GARMENTS.filter((g) => isEvalCategory(g.category) && g.sizeChart.length).flatMap((g) => {
      const base = wearableBase(g);
      return base ? [{ id: g.id, payload: g, baseSize: base, source: { kind: 'spike' } }] : [];
    }),
    ...shopFile.products.map((e) => ({ id: e.handle, payload: e.payload, baseSize: e.baseSize, features: parseFeatures(e.features) ?? null, source: { kind: 'shop' } })),
  ];
  // A wide-leg trouser whose chart gives the thigh: the wide-leg floor must not move a girth the fit engine fits.
  const palazzo = shopFile.products.find((e) => e.handle === 'rosewater-palazzo-pants')!;
  const withThigh: GarmentPayload = { ...palazzo.payload, id: 'palazzo-with-thigh', patternBlock: 'bootcut', subcategory: 'palazzo', sizeChart: palazzo.payload.sizeChart.map((r) => ({ ...r, thigh: 58 + (Number(r.size) - 12) })) };
  out.push({ id: withThigh.id, payload: withThigh, baseSize: '12', source: { kind: 'spike' } });
  // Title tokens that change shape defaults (puff sleeves, tiers) with a block that sets its own ease (shirt).
  const blouse = shopFile.products.find((e) => e.handle === 'rosewater-blouse')!;
  out.push({ id: 'puff-tiered-shirt', payload: { ...blouse.payload, id: 'puff-tiered-shirt', name: 'Tiered Puff Sleeve Shirt', lengthCm: { sleeve_length: 30 } }, baseSize: '12', source: { kind: 'shop' } });
  return out;
}

/**
 * The base size an asset is built at: the smallest chart size whose every fitted girth clears mannequin M (+1 cm), as the
 * shop parser picks AU 12 for M. A smaller base size cannot be dressed on M without moving a fitted girth, which the proxy
 * does only with a "raised to clear the mannequin" note (tested below): such a size is never an asset's base size.
 */
function wearableBase(g: GarmentPayload): string | null {
  for (const row of g.sizeChart) {
    const rings = fittedRings(g, row.size);
    if (rings.length && rings.every((r) => r.target >= m.shape.rings[r.ring].circumferenceCm + MIN_CLEARANCE_CM)) return row.size;
  }
  return null;
}

const PRODUCTS = products();

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** Users across the AU chart (8–16) plus two off-chart bodies. */
const USERS: UserBody[] = [
  ...AU_WOMENS_BODY_CHART.map((r) => ({ measurements: { bust: r.bust!, waist: r.waist!, hip: r.hip!, shoulder: 38, thigh: 56 } })),
  { measurements: { bust: 120, waist: 104, hip: 128 } },
  { measurements: { bust: 78, waist: 60, hip: 86, shoulder: 35 } },
];

const fitAll = (garments: readonly GarmentPayload[]): string => JSON.stringify(garments.map((g) => USERS.map((u) => computeFit(g as unknown as FitGarment, u))));

describe('§2 test 1: computeFit is byte-identical with and without a predicted bundle', () => {
  it('for every product and user, before and after predicting and building the predicted asset', () => {
    const garments = PRODUCTS.map((p) => p.payload);
    const before = fitAll(garments);
    const payloadsBefore = JSON.stringify(garments);
    // Build the predicted bundle (prediction.json + the P0 asset: the proxy that is the stage 4t template) from frozen payloads.
    const bundles = PRODUCTS.map((p) => {
      const frozen = deepFreeze(structuredClone(p));
      const prediction = predict(frozen);
      const proxy = buildProxy(m, frozen.payload, frozen.baseSize, { ...(frozen.features ? { features: frozen.features } : {}), prediction });
      return { 'prediction.json': JSON.stringify(prediction), proxy: proxyRecord(proxy.spec), prediction };
    });
    expect(bundles.length).toBe(PRODUCTS.length);
    expect(JSON.stringify(garments)).toBe(payloadsBefore);
    expect(fitAll(garments)).toBe(before);
    // Even a caller that hands computeFit the payload with the prediction attached gets the same advice: it reads payload fields only.
    const attached = garments.map((g, i) => ({ ...g, prediction: bundles[i]!.prediction, drapePrediction: bundles[i]!.prediction }));
    expect(fitAll(attached as unknown as GarmentPayload[])).toBe(before);
  });

  it('the predicted material stretch is simulation only: a different stretch would change the advice, the prediction never reaches it', () => {
    const cardi = PRODUCTS.find((p) => p.id === 'woodstock-wanderer-knit-cardi')!;
    const pr = predict(cardi);
    expect(pr.material.stretchPct.value).toBe(35); // sweater-knit prior, simulation only
    expect(cardi.payload.fabric!.stretchPct).toBe(2.5); // what the fit engine reads
    const withPredicted = { ...cardi.payload, fabric: { ...cardi.payload.fabric!, stretchPct: pr.material.stretchPct.value } };
    // Proof that the boundary matters: had the prediction been written into the payload, the advice would differ.
    expect(fitAll([withPredicted])).not.toBe(fitAll([cardi.payload]));
  });
});

/**
 * The fit engine's own targets at the critical anchors: `computeFit(garment, user).perSize[size].points[].chartCm` (the chart
 * value after the fit engine's sizeChartType normalisation, rounded to 0.1 cm by computeFit), for the points it fitted at the
 * base size, mapped to the category's anchor rings. Read from computeFit's output, not re-derived, so a change in how
 * computeFit builds chartCm moves the targets here too.
 */
function fittedRings(p: GarmentPayload, baseSize: string): { ring: AnchorRing; point: Point; target: number }[] {
  const fit = computeFit(p as unknown as FitGarment, FULL_USER);
  const size = fit.perSize.find((s) => sizeLabelKey(s.size) === sizeLabelKey(baseSize));
  if (!size) throw new Error(`${p.id}: computeFit has no size ${baseSize}`);
  const subset = new Set<AnchorRing>(CATEGORY_ANCHORS[p.category as 'dress'].rings);
  const out: { ring: AnchorRing; point: Point; target: number }[] = [];
  for (const pt of size.points) {
    if (!isPointFit(pt)) {
      // A point the chart lacks is not a target; a point omitted for want of a user value would hide one.
      expect(pt.omitted, `${p.id} ${pt.point}`).toBe('chart');
      continue;
    }
    const ring = (FIT_POINT_TO_ANCHOR as Partial<Record<string, string>>)[pt.point];
    if (!ring || !isAnchorRing(ring) || !subset.has(ring)) continue;
    out.push({ ring, point: pt.point, target: pt.chartCm });
  }
  return out;
}

describe('§2 test 2: every critical anchor girth of a predicted asset equals the fit-engine target within 0.1 cm', () => {
  let checked = 0;
  let maxDiff = 0;
  it.each(PRODUCTS.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    const prediction = predict(p);
    const { spec, mesh } = buildProxy(m, p.payload, p.baseSize, { ...(p.features ? { features: p.features } : {}), prediction });
    const rings = fittedRings(p.payload, p.baseSize);
    // The evaluation's critical rings are a subset of what the fit engine fits.
    for (const c of criticalRings(p.payload, evalChart(p.payload), p.baseSize)) expect(rings.map((r) => r.ring), c).toContain(c);
    for (const { ring, target } of rings) {
      if (!spec.anchors.includes(ring)) continue; // the ring is not on the garment (a top's hem above the hip)
      expect(Math.abs(spec.girths[ring]! - target), `${p.id} ${ring}: spec ${spec.girths[ring]} vs fit engine ${target}`).toBeLessThanOrEqual(0.1);
      const frame = m.rings.find((r) => r.id === ring)!;
      // On the mesh too, except inside an outerwear front opening, which is pushed into the mannequin (the fronts laid closed are the spec's girth).
      if (spec.frontOpening && openingHalfWidth(spec.frontOpening, frame.centre[1]) >= 0) continue;
      const measured = measureRing(mesh, frame);
      expect(measured, `${p.id} ${ring}`).not.toBeNull();
      expect(Math.abs(measured!.circumferenceCm - target), `${p.id} ${ring}: mesh ${measured!.circumferenceCm} vs fit engine ${target}`).toBeLessThanOrEqual(0.1);
      maxDiff = Math.max(maxDiff, Math.abs(measured!.circumferenceCm - target));
      checked++;
    }
  });
  it('checked a meaningful number of anchors', () => {
    if (process.env.BOUNDARY_REPORT) console.log(`[boundary] ${PRODUCTS.length} products, ${USERS.length} users, ${checked} anchors on the mesh, max |mesh − target| ${maxDiff.toExponential(2)} cm`);
    expect(PRODUCTS.length).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(40);
  });

  it('a base size smaller than mannequin M is never silently dressed: the proxy says it raised the girth', () => {
    const g = MOCK_GARMENTS.find((x) => x.id === 'velden-bottom-01')!;
    const small = g.sizeChart[0]!.size;
    const { spec } = buildProxy(m, g, small);
    expect(spec.girthSource.waist).toBe('raised to clear the mannequin');
    expect(spec.notes.join(' ')).toMatch(/waist: .* is below the mannequin's .*raised to clear the body/);
    expect(wearableBase(g)).not.toBe(small);
  });
});

/**
 * Import specifiers of a TypeScript source (import … from, export … from, import()). `names` are the named imports;
 * a namespace import or `export *` adds `*`, a default import adds `default` (both hide what is taken, so `reach` rejects
 * them from a package).
 */
export function importSpecifiers(src: string): { spec: string; typeOnly: boolean; names: string[] }[] {
  const out: { spec: string; typeOnly: boolean; names: string[] }[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (let mm = re.exec(src); mm; mm = re.exec(src)) {
    const clause = mm[3]!;
    const names = (clause.match(/\{([^}]*)\}/)?.[1] ?? '').split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!).filter(Boolean);
    const outside = clause.replace(/\{[^}]*\}/, '').trim();
    if (/\*/.test(outside)) names.push('*');
    if (mm[1] === 'import' && /^[A-Za-z_$][\w$]*\s*(,|$)/.test(outside)) names.push('default');
    out.push({ spec: mm[4]!, typeOnly: !!mm[2], names });
  }
  for (const mm of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: mm[1]!, typeOnly: false, names: [] });
  for (const mm of src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) out.push({ spec: mm[1]!, typeOnly: false, names: [] });
  return out;
}

/** Packages and modules the predictor may never reach: fit and size, the shopper's body and capture. */
const FORBIDDEN_SPEC = /fit-engine|capture|\bbody|Body|\/fit|fitSignature|sizeAdvice|@curtain\/mannequin|@curtain\/taste-engine|^node:/;
/** Names from @curtain/schema the predictor may never import (body, fit, size advice). */
const FORBIDDEN_NAMES = /Body|body|Fit|fit|SizeAdvice|sizeAdvice|Measurement|measurement|Signature|Wardrobe|Swipe/;

/** Every module the predictor reaches through relative imports, and every package specifier it uses. */
function reach(entryDir: string): { files: string[]; packages: { from: string; spec: string; names: string[] }[]; problems: string[] } {
  const files: string[] = [];
  const packages: { from: string; spec: string; names: string[] }[] = [];
  const problems: string[] = [];
  const queue = readdirSync(entryDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => join(entryDir, f));
  const allowedOutside = new Set([resolve(here, 'features.ts')]);
  while (queue.length) {
    const file = queue.shift()!;
    if (files.includes(file)) continue;
    files.push(file);
    for (const imp of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (imp.spec.startsWith('.')) {
        const target = resolve(dirname(file), imp.spec.endsWith('.ts') ? imp.spec : `${imp.spec}.ts`);
        const resolved = readdirSync(dirname(target)).includes(target.split('/').pop()!) ? target : resolve(dirname(file), imp.spec, 'index.ts');
        if (!resolved.startsWith(entryDir) && !allowedOutside.has(resolved)) problems.push(`${file}: imports ${imp.spec} (outside src/predict, not an allowed module)`);
        if (FORBIDDEN_SPEC.test(imp.spec)) problems.push(`${file}: imports ${imp.spec}`);
        queue.push(resolved);
      } else {
        packages.push({ from: file, spec: imp.spec, names: imp.names });
        if (FORBIDDEN_SPEC.test(imp.spec)) problems.push(`${file}: imports ${imp.spec}`);
        const bad = imp.names.filter((n) => FORBIDDEN_NAMES.test(n));
        if (bad.length) problems.push(`${file}: imports ${bad.join(', ')} from ${imp.spec}`);
        if (imp.names.includes('*') || imp.names.includes('default')) problems.push(`${file}: namespace, default or \`export *\` import from ${imp.spec} (name each import, so the name check sees it)`);
        if (!['@curtain/schema', '@curtain/anchors'].includes(imp.spec)) problems.push(`${file}: imports package ${imp.spec} (only @curtain/schema and @curtain/anchors are allowed)`);
      }
    }
  }
  return { files, packages, problems };
}

describe('§2 test 3: the predictor imports nothing from capture, body or fit modules', () => {
  it('src/predict reaches only itself, features.ts, @curtain/schema (fabric library) and @curtain/anchors (types)', () => {
    const r = reach(join(here, 'predict'));
    expect(r.files.length).toBeGreaterThanOrEqual(5);
    expect(r.problems).toEqual([]);
    expect(new Set(r.packages.map((p) => p.spec))).toEqual(new Set(['@curtain/schema', '@curtain/anchors']));
    for (const p of r.packages.filter((x) => x.spec === '@curtain/anchors')) expect(readFileSync(p.from, 'utf8')).toMatch(/import type \{[^}]*\} from '@curtain\/anchors'/);
  });

  it('the checker catches a forbidden import (it is not vacuous)', () => {
    expect(importSpecifiers("import { computeFit } from '@curtain/fit-engine';").map((i) => i.spec)).toEqual(['@curtain/fit-engine']);
    expect(FORBIDDEN_SPEC.test('@curtain/fit-engine')).toBe(true);
    expect(FORBIDDEN_SPEC.test('../../apps/web/src/features/capture/measure')).toBe(true);
    expect(FORBIDDEN_SPEC.test('../bodySdf')).toBe(true);
    expect(FORBIDDEN_SPEC.test('../evalChart')).toBe(false); // caught instead as "outside src/predict" (evalChart imports the fit engine)
    expect(FORBIDDEN_NAMES.test('UserBody')).toBe(true);
    expect(FORBIDDEN_NAMES.test('resolveFabric')).toBe(false);
    expect(importSpecifiers("import type { A } from './x';\nexport { b } from '../y';")).toEqual([{ spec: './x', typeOnly: true, names: ['A'] }, { spec: '../y', typeOnly: false, names: ['b'] }]);
  });

  it('rejects a namespace, default or `export *` import from a package (the name check cannot see through it)', () => {
    expect(importSpecifiers("import * as S from '@curtain/schema';")[0]!.names).toEqual(['*']);
    expect(importSpecifiers("import S, { resolveFabric } from '@curtain/schema';")[0]!.names).toEqual(['resolveFabric', 'default']);
    expect(importSpecifiers("export * from '@curtain/schema';")[0]!.names).toEqual(['*']);
    expect(importSpecifiers("import { resolveFabric as r } from '@curtain/schema';")[0]!.names).toEqual(['resolveFabric']);
    const tmp = mkdtempSync(join(tmpdir(), 'predict-boundary-'));
    try {
      writeFileSync(join(tmp, 'leak.ts'), "import * as S from '@curtain/schema';\nexport const leak = (S as Record<string, unknown>)['AU_WOMENS_BODY_CHART'];\n");
      expect(reach(tmp).problems.join('\n')).toMatch(/namespace, default or `export \*` import from @curtain\/schema/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
