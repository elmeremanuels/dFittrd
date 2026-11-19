import { describe, expect, it } from 'vitest';
import {
  CHART_COLUMN_CASES,
  checkChartColumns,
  wlAxesFromLabel,
  withWlAxes,
} from './chartColumns';
import {
  BODY_CHART_TEMPLATES,
  ChartSpecSchema,
  chartFromGarmentTemplate,
  chartPayload,
  chartTemplateById,
  checkChart,
  convertChart,
  resolveChartSpec,
  type GarmentChartTemplate,
} from './chartTemplates';
import { MOCK_GARMENTS, SYNTHETIC_MENS_CHINO_WL } from './fixtures';
import { fromShopifyProduct, toShopifyMetafields } from './mappings/shopify';
import type { MappingWarning } from './mappings/common';
import { fromWooMeta, toWooMeta } from './mappings/woo';

describe('wlAxesFromLabel', () => {
  it.each([
    ['32/34', { waist: '32', leg: '34' }],
    ['W32/L34', { waist: '32', leg: '34' }],
    [' w30 / l32 ', { waist: '30', leg: '32' }],
    ['32x34', { waist: '32', leg: '34' }],
    ['32', null],
    ['M', null],
    ['32/34/36', null],
    ['132/34', null],
  ])('%s', (label, want) => expect(wlAxesFromLabel(label)).toEqual(want));
});

describe('checkChartColumns', () => {
  const byName = Object.fromEntries(CHART_COLUMN_CASES.map((c) => [c.name, checkChartColumns(c.input)]));

  it('answers the shared cases in plain English', () => {
    expect(byName["a women's body chart: nothing to say"]).toEqual({ errors: [], warnings: [] });
    expect(byName["a men's tee with neck and sleeve from the shoulder seam"]).toEqual({ errors: [], warnings: [] });
    expect(byName['a sleeve column and no measuring point']!.errors).toEqual([
      'The chart has a sleeve column: say where the sleeve is measured from, the shoulder seam or the centre back of the neck.',
    ]);
    expect(byName['an unknown measuring point']!.errors).toEqual(["Unknown sleeve measuring point 'armpit': choose the shoulder seam or the centre back of the neck."]);
    expect(byName['a body chart sleeve (arm length) needs no measuring point']).toEqual({ errors: [], warnings: [] });
    expect(byName['a centre-back sleeve of 20 cm is too short']!.warnings).toEqual(['Size M: sleeve 20 cm is outside the usual 35–100 cm.']);
    expect(byName['a flat collar and a rise of 60 cm']!.warnings).toEqual(['Size 32/32: neck 21 cm is outside the usual 30–55 cm.', 'Size 32/32: rise 60 cm is outside the usual 15–45 cm.']);
    expect(byName['a W/L chino chart, every label waist/leg']).toEqual({ errors: [], warnings: [] });
    expect(byName['a W/L chart with a label that is not waist/leg']!.errors).toEqual([
      'Size 33 is not a waist/leg size: write it as waist/leg, for example 32/34.',
      'Size M is not a waist/leg size: write it as waist/leg, for example 32/34.',
    ]);
    expect(byName['some rows with axes, some without']!.errors).toEqual(['Either every size has a waist and a leg (for example 32/34) or none has.']);
    expect(byName['a waist and leg pair twice']!.errors).toEqual(['Waist 32 with leg 32 appears twice (sizes 32/32 and W32/L32).']);
  });

  it("says nothing about a women's chart: every women's template and every fixture garment", () => {
    for (const t of BODY_CHART_TEMPLATES.filter((x) => x.audience !== 'men')) expect(checkChartColumns({ sizeChartType: 'body', sizeChart: t.rows })).toEqual({ errors: [], warnings: [] });
    for (const g of MOCK_GARMENTS) expect(checkChartColumns(g)).toEqual({ errors: [], warnings: [] });
  });
});

describe("the builder path of a men's chart", () => {
  it('the chino template: W/L labels give axes, a W/L chart passes checkChart, and the fixture chart reads back the same', () => {
    const t = chartTemplateById('garment-mens-chino-wl') as GarmentChartTemplate;
    expect(t.axes).toBe('wl');
    const values = Object.fromEntries(SYNTHETIC_MENS_CHINO_WL.sizeChart.map((r) => [r.size, r]));
    const input = chartFromGarmentTemplate(t, values, 'cm', SYNTHETIC_MENS_CHINO_WL.sizeChart.map((r) => r.size));
    expect(input.wl).toBe(true);
    expect(input.sizeChart.map((r) => r.axes)).toEqual(SYNTHETIC_MENS_CHINO_WL.sizeChart.map((r) => r.axes));
    expect(input.sizeChart.map((r) => r.rise)).toEqual(SYNTHETIC_MENS_CHINO_WL.sizeChart.map((r) => r.rise));
    expect(checkChart(input)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('resolveChartSpec reads axes from the labels and keeps the sleeve measuring point; inches convert the men’s columns', () => {
    const spec = ChartSpecSchema.parse({ sizeChartType: 'garment', sizeAxes: 'wl', unit: 'in', sizeChart: [{ size: '32/32', waist: 33, rise: 10.5, inseam: 32 }, { size: '33', waist: 34 }] });
    const chart = resolveChartSpec(spec);
    expect(chart.sizeChart[0]).toEqual({ size: '32/32', waist: 84, rise: 26.5, inseam: 81.5, axes: { waist: '32', leg: '32' } });
    expect(chart.sizeChart[1]!.axes).toBeUndefined();
    expect(checkChart(chart).errors).toEqual(['Size 33 is not a waist/leg size: write it as waist/leg, for example 32/34.']);

    const tee = resolveChartSpec(ChartSpecSchema.parse({ sizeChartType: 'garment', sleeveConvention: 'shoulder_point', sizeChart: [{ size: 'M', bust: 106, sleeve: 21, neck: 43, length: 72 }] }));
    expect(checkChart(tee)).toEqual({ ok: true, errors: [], warnings: [] });
    expect(chartPayload(tee)).toEqual({ sizeChartType: 'garment', sizeChart: [{ size: 'M', bust: 106, sleeve: 21, neck: 43, length: 72 }], sleeveConvention: 'shoulder_point' });
    expect(checkChart({ ...tee, sleeveConvention: undefined }).ok).toBe(false);
    // A measuring point without a sleeve column is not written.
    expect(chartPayload({ sizeChartType: 'garment', sizeChart: [{ size: 'M', bust: 106 }], sleeveConvention: 'centre_back' })).toEqual({ sizeChartType: 'garment', sizeChart: [{ size: 'M', bust: 106 }] });
    expect(ChartSpecSchema.safeParse({ sizeChartType: 'garment', sleeveConvention: 'armpit', sizeChart: [{ size: 'M', bust: 1 }] }).success).toBe(false);
  });

  it('a 60-row W/L chart fits the builder; 61 rows do not', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ size: `${String(20 + Math.floor(i / 3))}/${String(30 + 2 * (i % 3))}`, waist: 60 + i }));
    expect(ChartSpecSchema.safeParse({ sizeChartType: 'garment', sizeAxes: 'wl', sizeChart: rows(60) }).success).toBe(true);
    expect(ChartSpecSchema.safeParse({ sizeChartType: 'garment', sizeAxes: 'wl', sizeChart: rows(61) }).success).toBe(false);
    expect(withWlAxes(rows(60)).every((r) => r.axes)).toBe(true);
  });

  it("convertChart leaves a women's chart as it was", () => {
    for (const t of BODY_CHART_TEMPLATES.filter((x) => x.audience !== 'men')) {
      const inches = convertChart(t.rows, 'cm', 'in');
      for (const r of inches) expect(Object.keys(r).sort()).toEqual(Object.keys(t.rows.find((x) => x.size === r.size)!).sort());
    }
  });
});

describe('sleeveConvention in the mappings', () => {
  const tee = { sizeChartType: 'garment' as const, sizeChart: [{ size: 'M', bust: 106, sleeve: 21, neck: 43 }], sleeveConvention: 'centre_back' as const };

  it('WooCommerce: written and read back, aliases understood, nonsense reported', () => {
    const meta = toWooMeta(tee);
    expect(meta.find((m) => m.key === '_curtain_sleeve_convention')?.value).toBe('centre_back');
    expect(fromWooMeta({ id: 1, name: 'Tee' }, meta).sleeveConvention).toBe('centre_back');
    for (const [raw, want] of [['Centre back', 'centre_back'], ['center-back', 'centre_back'], ['SHOULDER_POINT', 'shoulder_point'], ['shoulder seam', 'shoulder_point']] as const) {
      expect(fromWooMeta({ id: 1, name: 'Tee' }, { _curtain_sleeve_convention: raw }).sleeveConvention).toBe(want);
    }
    const warnings: MappingWarning[] = [];
    expect(fromWooMeta({ id: 1, name: 'Tee' }, { _curtain_sleeve_convention: 'armpit' }, { warnings }).sleeveConvention).toBeUndefined();
    expect(warnings).toEqual([{ source: '_curtain_sleeve_convention', path: 'sleeveConvention', message: "expected shoulder_point or centre_back, got 'armpit'" }]);
  });

  it('Shopify: the sleeve_convention metafield', () => {
    const mf = toShopifyMetafields(tee, 'gid://shopify/Product/1');
    expect(mf.find((m) => m.key === 'sleeve_convention')).toMatchObject({ type: 'single_line_text_field', value: 'centre_back' });
    const node = { id: 'gid://shopify/Product/1', title: 'Tee', metafields: { nodes: mf.map((m) => ({ key: m.key, value: m.value, type: m.type, namespace: m.namespace })) } };
    expect(fromShopifyProduct(node as never).sleeveConvention).toBe('centre_back');
  });
});
