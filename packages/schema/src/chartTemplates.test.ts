import { describe, expect, it } from 'vitest';
import {
  AU_WOMENS_BODY_TEMPLATE,
  BODY_CHART_TEMPLATES,
  ChartAssignRequestSchema,
  ChartSpecError,
  ChartTemplatesResponseSchema,
  ProductSelectorSchema,
  chartTemplatesDto,
  resolveChartSpec,
  CHART_TEMPLATES,
  EU_FR_WOMENS_BODY_TEMPLATE,
  EU_WOMENS_BODY_TEMPLATE,
  GARMENT_CHART_TEMPLATES,
  UK_WOMENS_BODY_TEMPLATE,
  US_WOMENS_BODY_TEMPLATE,
  chartFromBodyTemplate,
  chartFromGarmentTemplate,
  chartPayload,
  chartTemplateById,
  checkChart,
  convertChart,
  roundHalfCm,
  toCm,
  type BodyChartTemplate,
} from './chartTemplates';
import { AU_WOMENS_BODY_CHART } from './fixtures/charts';
import { GarmentPayloadSchema, SizeChartSchema } from './garment';
import { MOCK_GARMENTS } from './fixtures';

const row = (t: BodyChartTemplate, size: string) => t.rows.find((r) => r.size === size);

describe('chart templates: body charts', () => {
  it('every template is a valid chart with an explicit type, cited sources and unique ids', () => {
    const ids = new Set<string>();
    for (const t of CHART_TEMPLATES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(['body', 'garment']).toContain(t.kind);
      expect(t.defaultSizes.every((s) => t.sizes.includes(s))).toBe(true);
    }
    for (const t of BODY_CHART_TEMPLATES) {
      expect(SizeChartSchema.safeParse(t.rows).success).toBe(true);
      expect(t.rows.map((r) => r.size)).toEqual([...t.sizes]);
      expect(t.sources.filter((s) => s.inMedian).length).toBeGreaterThanOrEqual(2);
      for (const s of t.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(s.accessed).toBe('2026-11-06');
      }
    }
  });

  it('AU reuses AU_WOMENS_BODY_CHART and preselects 8–20', () => {
    expect(AU_WOMENS_BODY_TEMPLATE.rows).toEqual(AU_WOMENS_BODY_CHART);
    expect(AU_WOMENS_BODY_TEMPLATE.defaultSizes).toEqual(['8', '10', '12', '14', '16', '18', '20']);
    expect(AU_WOMENS_BODY_TEMPLATE.weakSizes).toEqual(['18', '20']);
  });

  it('pins the medians of the UK, EU and US sources', () => {
    expect(row(UK_WOMENS_BODY_TEMPLATE, '8')).toEqual({ size: '8', bust: 83, waist: 66, hip: 91 });
    expect(row(UK_WOMENS_BODY_TEMPLATE, '12')).toEqual({ size: '12', bust: 93, waist: 76, hip: 102 });
    expect(row(UK_WOMENS_BODY_TEMPLATE, '16')).toEqual({ size: '16', bust: 104, waist: 87, hip: 114 });
    expect(UK_WOMENS_BODY_TEMPLATE.weakSizes).toEqual(['6']);
    expect(row(EU_WOMENS_BODY_TEMPLATE, '38')).toEqual({ size: '38', bust: 88, waist: 72.5, hip: 97 });
    expect(row(EU_FR_WOMENS_BODY_TEMPLATE, '40')).toEqual({ size: '40', bust: 88, waist: 72.5, hip: 97 });
    expect(row(US_WOMENS_BODY_TEMPLATE, '8')).toEqual({ size: '8', bust: 91, waist: 73.5, hip: 99 });
    expect(row(US_WOMENS_BODY_TEMPLATE, '2')).toEqual({ size: '2', bust: 81.5, waist: 64, hip: 89 });
  });

  it('every point grows by 1.5–7.5 cm per size and has a body shape (hip > bust > waist)', () => {
    for (const t of BODY_CHART_TEMPLATES) {
      for (let i = 0; i < t.rows.length; i++) {
        const r = t.rows[i]!;
        expect(r.hip!).toBeGreaterThan(r.bust!);
        expect(r.bust!).toBeGreaterThan(r.waist!);
        if (i === 0) continue;
        const p = t.rows[i - 1]!;
        for (const k of ['bust', 'waist', 'hip'] as const) {
          const step = r[k]! - p[k]!;
          expect(step, `${t.id} ${k} ${p.size}→${r.size}`).toBeGreaterThanOrEqual(1.5);
          expect(step, `${t.id} ${k} ${p.size}→${r.size}`).toBeLessThanOrEqual(7.5);
        }
      }
    }
  });

  it('the regional charts agree within 6 cm for the sizes the shops print as equivalent (UK 10 = AU 10 = DE 36 = US 6)', () => {
    const cells = [row(UK_WOMENS_BODY_TEMPLATE, '10')!, row(AU_WOMENS_BODY_TEMPLATE, '10')!, row(EU_WOMENS_BODY_TEMPLATE, '36')!, row(US_WOMENS_BODY_TEMPLATE, '6')!];
    for (const k of ['bust', 'waist', 'hip'] as const) {
      const v = cells.map((c) => c[k]!);
      expect(Math.max(...v) - Math.min(...v), k).toBeLessThanOrEqual(6);
    }
  });

  it('chartFromBodyTemplate restricts to the chosen labels, in template order, and copies', () => {
    const c = chartFromBodyTemplate(AU_WOMENS_BODY_TEMPLATE, ['16', '8', 'XL', '12']);
    expect(c.sizeChartType).toBe('body');
    expect(c.sizeChart.map((r) => r.size)).toEqual(['8', '12', '16']);
    c.sizeChart[0]!.bust = 1;
    expect(row(AU_WOMENS_BODY_TEMPLATE, '8')!.bust).toBe(85);
    expect(chartFromBodyTemplate(UK_WOMENS_BODY_TEMPLATE).sizeChart).toHaveLength(6);
  });

  it('a template chart drops into a payload that still validates', () => {
    const base = MOCK_GARMENTS[0]!;
    const g = { ...base, ...chartPayload(chartFromBodyTemplate(AU_WOMENS_BODY_TEMPLATE)) };
    expect(GarmentPayloadSchema.safeParse(g).success).toBe(true);
  });
});

describe('chart templates: garment charts and units', () => {
  const t = GARMENT_CHART_TEMPLATES.find((x) => x.id === 'garment-au-dress-top')!;

  it('garment templates carry points, no numbers', () => {
    for (const g of GARMENT_CHART_TEMPLATES) {
      expect(g.points.length).toBeGreaterThan(0);
      expect('rows' in g).toBe(false);
    }
    expect(chartTemplateById('garment-one-size')?.kind).toBe('garment');
    expect(chartTemplateById('nope')).toBeUndefined();
  });

  it('builds a garment chart from merchant values, converting inches and dropping empty sizes', () => {
    const c = chartFromGarmentTemplate(t, { '8': { bust: 36, waist: 29 }, '10': { bust: 38, waist: null }, '12': {} }, 'in');
    expect(c).toEqual({ sizeChartType: 'garment', sizeChart: [{ size: '8', bust: 91.5, waist: 73.5 }, { size: '10', bust: 96.5 }] });
  });

  it('converts charts between cm and inches', () => {
    expect(toCm(10, 'in')).toBeCloseTo(25.4);
    expect(roundHalfCm(91.44)).toBe(91.5);
    const inches = convertChart([{ size: 'S', bust: 88, waist: 70 }], 'cm', 'in');
    expect(inches).toEqual([{ size: 'S', bust: 34.75, waist: 27.5 }]);
    expect(convertChart(inches, 'in', 'cm')).toEqual([{ size: 'S', bust: 88.5, waist: 70 }]);
  });
});

describe('checkChart', () => {
  it('requires an explicit type, rows and a measurement per row', () => {
    expect(checkChart({ sizeChart: [{ size: 'S', bust: 88 }] }).errors[0]).toMatch(/body measurements or garment/);
    expect(checkChart({ sizeChartType: 'body', sizeChart: [] }).errors).toContain('The chart has no sizes.');
    expect(checkChart({ sizeChartType: 'garment', sizeChart: [{ size: 'S' }] }).errors).toContain('Size S has no measurements.');
    expect(checkChart({ sizeChartType: 'garment', sizeChart: [{ size: 'S', bust: 1 }, { size: 's', bust: 2 }] }).errors.join(' ')).toMatch(/appear twice: s/);
  });

  it('accepts every body template and warns about flat widths and shrinking sizes', () => {
    for (const b of BODY_CHART_TEMPLATES) expect(checkChart(chartFromBodyTemplate(b, b.sizes))).toEqual({ ok: true, errors: [], warnings: [] });
    const flat = checkChart({ sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 52 }] });
    expect(flat.ok).toBe(true);
    expect(flat.warnings[0]).toMatch(/flat width.*104 cm/);
    const shrink = checkChart({ sizeChartType: 'garment', sizeChart: [{ size: 'S', bust: 90 }, { size: 'M', bust: 88 }] });
    expect(shrink.warnings[0]).toMatch(/gets smaller from size S/);
  });
});

describe('wire types', () => {
  it('resolves a template spec, a typed spec in inches, and refuses garment templates without numbers', () => {
    expect(resolveChartSpec({ templateId: 'au-womens-body', sizes: ['8', '10'] }).sizeChart.map((r) => r.size)).toEqual(['8', '10']);
    expect(resolveChartSpec({ sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 50 }], unit: 'in' })).toEqual({ sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 127 }] });
    expect(() => resolveChartSpec({ templateId: 'garment-one-size' })).toThrow(ChartSpecError);
    expect(() => resolveChartSpec({ templateId: 'nope' })).toThrow(/unknown chart template/);
    expect(ProductSelectorSchema.safeParse({ kind: 'collection', collectionId: 'gid://shopify/Collection/42' }).success).toBe(true);
    expect(ProductSelectorSchema.safeParse({ kind: 'collection', collectionId: 'gid://shopify/Product/42' }).success).toBe(false);
    expect(ProductSelectorSchema.safeParse({ kind: 'products', productIds: [] }).success).toBe(false);
    const req = ChartAssignRequestSchema.parse({ selector: { kind: 'tag', tag: ' boho ' }, chart: { templateId: 'au-womens-body' } });
    expect(req).toMatchObject({ overwrite: false, selector: { tag: 'boho' } });
    expect(ChartTemplatesResponseSchema.safeParse(chartTemplatesDto()).success).toBe(true);
  });
});
