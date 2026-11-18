import { describe, expect, it } from 'vitest';
import { GarmentPayloadSchema } from './garment';
import { GarmentTapeSchema } from './garmentTape';
import {
  GARMENT_TAPE_MESSAGES,
  GarmentTapeWriteRequestSchema,
  TAPE_ISSUE_CODES,
  checkGarmentTapeInput,
  collapseSharedDepthIssues,
  garmentTapeChartIssues,
  measuredFromGarmentTape,
  refillGarmentTape,
} from './garmentTapeForm';
import { GARMENT_TAPE_FORM_CASES } from './garmentTapeFormCases';
import { PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY, PILOT_SKIRT_TAPE_MEASURED } from './fixtures/pilotSkirt';
import { fromShopifyProduct, toShopifyMetafields, type MappingWarning, type ShopifyProductNode } from './mappings/shopify';
import { fromWooMeta, toWooMeta } from './mappings/woo';
import { GARMENT_TAPE_NO_CHART_WARNING } from './mappings/tape';
import { validateGarmentDraft } from './api';

const chart = PILOT_SKIRT_CHART_ONLY.sizeChart;
const run = (name: string) => {
  const c = GARMENT_TAPE_FORM_CASES.find((x) => x.name === name);
  if (!c) throw new Error(`no case ${name}`);
  return checkGarmentTapeInput(c.input);
};

describe('checkGarmentTapeInput', () => {
  it('fills the pilot skirt exactly as the fixture does, and labels the estimates', () => {
    const r = checkGarmentTapeInput({ category: 'bottom', chart, closure: 'pull-on', measured: PILOT_SKIRT_TAPE_MEASURED });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.closure).toBe('pull-on');
    expect(r.measuredSizes).toEqual(['8', '10', '14']);
    expect(r.garmentTape).toEqual(PILOT_PULL_ON_SKIRT.garmentTape);
    expect(r.garmentTape?.find((x) => x.size === '12')?.waistStretched).toEqual({ cm: 105, provenance: 'interpolated' });
    expect(r.garmentTape?.find((x) => x.size === '16')?.waistStretched).toEqual({ cm: 115, provenance: 'extrapolated' });
    expect(r.warnings.map((w) => w.code)).toEqual(['hip_no_depth', 'edge_unmeasured']);
    expect(r.warnings[1]!.size).toBe('16');
    expect(GarmentTapeSchema.safeParse(r.garmentTape).success).toBe(true);
  });

  it('errors stop the fill; warnings do not', () => {
    const bad = run('mistakes that stop a save');
    expect(bad.ok).toBe(false);
    expect(bad.garmentTape).toBeUndefined();
    expect(bad.errors.map((e) => e.code)).toEqual([
      'unknown_size',
      'duplicate_size',
      'empty_measured',
      'out_of_range',
      'out_of_range',
      'stretched_below_relaxed',
      'depth_out_of_range',
      'unknown_closure',
    ]);
    const warned = run('a larger size smaller than a smaller one');
    expect(warned.ok).toBe(true);
    expect(warned.garmentTape).toBeDefined();
    expect(warned.warnings.some((w) => w.code === 'not_increasing' && w.field === 'hip' && w.size === '10')).toBe(true);
  });

  it('every issue code is reached by a shared case, with an English sentence', () => {
    const seen = new Set<string>();
    for (const c of GARMENT_TAPE_FORM_CASES) {
      const r = checkGarmentTapeInput(c.input);
      for (const i of [...r.errors, ...r.warnings]) {
        seen.add(i.code);
        expect(i.message).toMatch(/^[A-Z][^\n]+[.)]$/);
        expect(i.message).not.toMatch(/NaN|undefined|null/);
      }
    }
    expect([...seen].sort()).toEqual([...TAPE_ISSUE_CODES].sort());
  });

  it('size labels match the chart trimmed and case-insensitive, and keep the chart spelling', () => {
    const r = run('a dress (not a bottom), letter sizes by row');
    expect(r.measuredSizes).toEqual(['S', 'L']);
    expect(r.garmentTape?.map((x) => x.size)).toEqual(['S', 'M', 'L']);
    expect(r.garmentTape?.[1]?.hip).toEqual({ cm: 102, provenance: 'interpolated', depthBelowBandCm: 20 });
  });

  it('with one measured size only the band is stepped; hip, hem and length stay empty', () => {
    const r = run('one size measured: only the band is stepped');
    const au8 = r.garmentTape?.find((x) => x.size === '8');
    expect(au8).toEqual({ size: '8', waistRelaxed: { cm: 66, provenance: 'extrapolated' }, waistStretched: { cm: 95, provenance: 'extrapolated' } });
  });

  it('a hip depth stated on every size goes to the estimated sizes; mixed depths do not', () => {
    expect(run('the pilot skirt with the hip at 20 cm').garmentTape?.find((x) => x.size === '12')?.hip?.depthBelowBandCm).toBe(20);
    const mixed = run('flat widths that were not doubled, and a hip at mixed depths');
    expect(mixed.garmentTape?.find((x) => x.size === '12')?.hip?.depthBelowBandCm).toBeUndefined();
  });

  it('a closure alone is accepted and nothing is filled', () => {
    const r = run('a closure only');
    expect(r).toMatchObject({ ok: true, closure: 'wrap', errors: [], warnings: [], measuredSizes: [] });
    expect(r.garmentTape).toBeUndefined();
  });

  it('the wire body accepts empty inputs as null and refuses more than 30 rows', () => {
    expect(GarmentTapeWriteRequestSchema.safeParse({ closure: null, measured: [{ size: '8', waistRelaxedCm: null, hipCm: 112 }] }).success).toBe(true);
    expect(GarmentTapeWriteRequestSchema.safeParse({ closure: null, measured: Array.from({ length: 31 }, (_, i) => ({ size: String(i) })) }).success).toBe(false);
  });

  it('messages carry the number as typed', () => {
    expect(GARMENT_TAPE_MESSAGES.looksFlat('8', 'waistRelaxed', 33.5)).toContain('33.5 cm');
  });
});

describe('one depth input for every size (collapseSharedDepthIssues)', () => {
  const rows = (depth: number | string) => [
    { size: '8', waistRelaxedCm: 67, hipCm: 112, hipDepthBelowBandCm: depth },
    { size: '10', waistRelaxedCm: 'x', hipCm: 122, hipDepthBelowBandCm: depth },
    { size: '14', waistRelaxedCm: 80, hipCm: 126, hipDepthBelowBandCm: depth },
  ];
  it('a depth out of range is said once, without a size, at the place of the first', () => {
    const check = checkGarmentTapeInput({ chart, closure: 'pull-on', measured: rows(90) });
    expect(check.errors.filter((e) => e.field === 'hipDepth')).toHaveLength(3);
    const out = collapseSharedDepthIssues(check.errors, 90);
    expect(out).toEqual([
      { code: 'depth_out_of_range', field: 'hipDepth', message: GARMENT_TAPE_MESSAGES.sharedDepthOutOfRange(90) },
      { code: 'not_a_number', size: '10', field: 'waistRelaxed', message: GARMENT_TAPE_MESSAGES.notANumber('10', 'waistRelaxed') },
    ]);
  });
  it('a depth typed as text is said once', () => {
    const out = collapseSharedDepthIssues(checkGarmentTapeInput({ chart, closure: null, measured: rows('twenty') }).errors, 'twenty');
    expect(out.filter((e) => e.field === 'hipDepth')).toEqual([{ code: 'not_a_number', field: 'hipDepth', message: GARMENT_TAPE_MESSAGES.sharedDepthNotANumber() }]);
  });
  it('leaves issues without a depth problem as they are', () => {
    const errors = checkGarmentTapeInput({ chart, closure: null, measured: rows(20) }).errors;
    expect(collapseSharedDepthIssues(errors, 20)).toEqual(errors);
  });
});

describe('stored tape against the current chart', () => {
  it('reads back exactly what the shop typed', () => {
    expect(measuredFromGarmentTape(PILOT_PULL_ON_SKIRT.garmentTape)).toEqual(PILOT_SKIRT_TAPE_MEASURED);
  });

  it('drops sizes the chart no longer has and fills the estimates again', () => {
    const shorter = chart.filter((r) => r.size !== '16');
    const r = refillGarmentTape(shorter, PILOT_PULL_ON_SKIRT.garmentTape!);
    expect(r.droppedSizes).toEqual(['16']);
    expect(r.garmentTape?.map((x) => x.size)).toEqual(['8', '10', '12', '14']);
    const moved = chart.map((row) => (row.size === '12' ? { ...row, waist: 80 } : row));
    const again = refillGarmentTape(moved, PILOT_PULL_ON_SKIRT.garmentTape!);
    expect(again.garmentTape?.find((x) => x.size === '12')?.waistStretched?.cm).toBeGreaterThan(105);
    expect(again.garmentTape?.find((x) => x.size === '14')?.waistStretched).toEqual({ cm: 110, provenance: 'measured' });
  });
});

describe('platform mappings carry the closure and the tape', () => {
  const node: ShopifyProductNode = { id: 'gid://shopify/Product/10894387020081', title: PILOT_PULL_ON_SKIRT.name, vendor: PILOT_PULL_ON_SKIRT.brand };

  it('Shopify: written as metafields, read back unchanged', () => {
    const mf = toShopifyMetafields(PILOT_PULL_ON_SKIRT, node.id);
    expect(mf.find((m) => m.key === 'closure')).toMatchObject({ type: 'single_line_text_field', value: 'pull-on' });
    expect(mf.find((m) => m.key === 'garment_tape')?.type).toBe('json');
    const warnings: MappingWarning[] = [];
    const out = fromShopifyProduct(node, mf.map(({ key, type, value, namespace }) => ({ key, type, value, namespace })), { warnings });
    expect(out.closure).toBe('pull-on');
    expect(out.garmentTape).toEqual(PILOT_PULL_ON_SKIRT.garmentTape);
    expect(warnings.filter((w) => w.path === 'closure' || w.path === 'garmentTape')).toEqual([]);
  });

  it('Shopify: a bad closure or tape is dropped with a warning, never thrown', () => {
    const warnings: MappingWarning[] = [];
    const out = fromShopifyProduct(
      node,
      [
        { key: 'size_chart', value: JSON.stringify(chart) },
        { key: 'closure', value: 'velcro' },
        { key: 'garment_tape', value: JSON.stringify([{ size: '8', waistRelaxed: { cm: 67 } }]) },
      ],
      { warnings },
    );
    expect(out.closure).toBeUndefined();
    expect(out.garmentTape).toBeUndefined();
    expect(warnings.map((w) => w.source)).toEqual(expect.arrayContaining(['closure', 'garment_tape']));
  });

  it('WooCommerce: stored as meta, read back unchanged; sizes outside the chart are dropped with a warning', () => {
    const meta = toWooMeta(PILOT_PULL_ON_SKIRT);
    expect(meta.find((m) => m.key === '_curtain_closure')?.value).toBe('pull-on');
    const product = { id: 1, name: PILOT_PULL_ON_SKIRT.name, price: '89' };
    const out = fromWooMeta(product, meta);
    expect(out.closure).toBe('pull-on');
    expect(out.garmentTape).toEqual(PILOT_PULL_ON_SKIRT.garmentTape);
    const warnings: MappingWarning[] = [];
    const shorter = meta.map((m) => (m.key === '_curtain_size_chart' ? { ...m, value: JSON.stringify(chart.slice(0, 4)) } : m));
    const cut = fromWooMeta(product, shorter, { warnings });
    expect(cut.garmentTape?.map((x) => x.size)).toEqual(['8', '10', '12', '14']);
    expect(warnings.find((w) => w.source === '_curtain_garment_tape')?.message).toMatch(/size 16 is not in the size chart/);
  });

  it('a stored tape on a product with no size chart is left out with a warning (Shopify and WooCommerce)', () => {
    const product = { id: 1, name: PILOT_PULL_ON_SKIRT.name, price: '89' };
    const noChart = toWooMeta(PILOT_PULL_ON_SKIRT).filter((m) => m.key !== '_curtain_size_chart');
    const warnings: MappingWarning[] = [];
    const woo = fromWooMeta(product, noChart, { warnings });
    expect(woo.sizeChart).toBeUndefined();
    expect(woo.garmentTape).toBeUndefined();
    expect(woo.closure).toBe('pull-on');
    expect(warnings.find((w) => w.source === '_curtain_garment_tape')?.message).toBe(GARMENT_TAPE_NO_CHART_WARNING);
    // What the read gives, the merchant PUT accepts: the sync no longer fails on it.
    expect(garmentTapeChartIssues(woo)).toEqual([]);
    const emptyChart = toWooMeta(PILOT_PULL_ON_SKIRT).map((m) => (m.key === '_curtain_size_chart' ? { ...m, value: '[]' } : m));
    expect(fromWooMeta(product, emptyChart).garmentTape).toBeUndefined();

    const metafields = toShopifyMetafields(PILOT_PULL_ON_SKIRT, node.id)
      .filter((m) => m.key !== 'size_chart')
      .map(({ key, type, value, namespace }) => ({ key, type, value, namespace }));
    const shopWarnings: MappingWarning[] = [];
    const shop = fromShopifyProduct(node, metafields, { warnings: shopWarnings });
    expect(shop.garmentTape).toBeUndefined();
    expect(shopWarnings.find((w) => w.source === 'garment_tape')?.message).toBe(GARMENT_TAPE_NO_CHART_WARNING);
  });

  it('the validate dry run reports what the merchant PUT refuses', () => {
    const { sizeChart: _chart, ...noChart } = PILOT_PULL_ON_SKIRT;
    const bad = validateGarmentDraft(noChart);
    expect(bad.valid).toBe(false);
    expect(bad.issues).toContainEqual({ path: 'garmentTape', message: GARMENT_TAPE_MESSAGES.tapeWithoutChart() });
    const renamed = validateGarmentDraft({ ...PILOT_PULL_ON_SKIRT, sizeChart: PILOT_PULL_ON_SKIRT.sizeChart!.map((r) => (r.size === '8' ? { ...r, size: 'XS' } : r)) });
    expect(renamed.issues).toContainEqual({ path: 'garmentTape', message: GARMENT_TAPE_MESSAGES.tapeSizeNotInChart(['8']) });
    expect(validateGarmentDraft(PILOT_PULL_ON_SKIRT)).toMatchObject({ valid: true, issues: [] });
  });

  it('the payload with tape and closure is a valid GarmentPayload', () => {
    expect(GarmentPayloadSchema.safeParse(PILOT_PULL_ON_SKIRT).success).toBe(true);
  });
});
