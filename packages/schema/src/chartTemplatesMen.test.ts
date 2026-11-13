import { describe, expect, it } from 'vitest';
import {
  BODY_CHART_TEMPLATES,
  CHART_TEMPLATES,
  ChartTemplatesResponseSchema,
  bodyTemplateMatching,
  chartFromBodyTemplate,
  chartPayload,
  chartTemplateById,
  chartTemplatesDto,
  checkChart,
  resolveChartSpec,
  type BodyChartTemplate,
} from './chartTemplates';
import {
  MENS_BODY_CHART_TEMPLATES,
  MENS_CHART_SOURCE_SPREAD,
  MENS_CHART_SOURCES_ACCESSED,
  MENS_EU_BODY_TEMPLATE,
  MENS_EU_CHART_SOURCES,
  MENS_JEANS_WL_BODY_TEMPLATE,
  MENS_LETTER_BODY_TEMPLATE,
  MENS_LETTER_CHART_SOURCES,
  jeansSizeLabel,
  mensChartFromSources,
  parseJeansSize,
} from './chartTemplatesMen';
import { GarmentPayloadSchema, SizeChartSchema } from './garment';
import { MOCK_GARMENTS } from './fixtures';

const row = (t: BodyChartTemplate, size: string) => t.rows.find((r) => r.size === size);

describe("men's chart templates", () => {
  it('are three generic body templates for men, each with cited sources read on one date', () => {
    expect(MENS_BODY_CHART_TEMPLATES.map((t) => t.id)).toEqual(['mens-letter-body', 'eu-mens-body', 'mens-jeans-wl-body']);
    for (const t of MENS_BODY_CHART_TEMPLATES) {
      expect(t.kind).toBe('body');
      expect(t.audience).toBe('men');
      expect(t.generic).toBe(true);
      expect(t.label).toMatch(/generic body chart/);
      expect(t.description).toMatch(/^Generic template, not a brand’s chart/);
      expect(SizeChartSchema.safeParse(t.rows).success).toBe(true);
      expect(t.rows.length).toBeLessThanOrEqual(30);
      expect(t.rows.map((r) => r.size)).toEqual([...t.sizes]);
      expect(t.defaultSizes.every((s) => t.sizes.includes(s))).toBe(true);
      expect(t.sources.filter((s) => s.inMedian).length).toBeGreaterThanOrEqual(2);
      for (const s of t.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(s.accessed).toBe(MENS_CHART_SOURCES_ACCESSED);
        expect(s.note).toBeTruthy();
      }
      for (const r of t.rows) expect(Object.keys(r).sort()).toEqual(['size', ...t.points!].sort());
      expect(CHART_TEMPLATES).toContain(t);
      expect(BODY_CHART_TEMPLATES).toContain(t);
      expect(chartTemplateById(t.id)).toBe(t);
    }
  });

  it('pins the letter chart: chest in `bust`, seat in `hip`', () => {
    expect(MENS_LETTER_BODY_TEMPLATE.rows).toEqual([
      { size: 'XS', bust: 90, waist: 76, hip: 90 },
      { size: 'S', bust: 95, waist: 80.5, hip: 94.5 },
      { size: 'M', bust: 100.5, waist: 86, hip: 100 },
      { size: 'L', bust: 107, waist: 92.5, hip: 107 },
      { size: 'XL', bust: 115, waist: 100, hip: 114 },
      { size: 'XXL', bust: 123, waist: 108, hip: 121 },
      { size: '3XL', bust: 131, waist: 118.5, hip: 128 },
    ]);
    expect(MENS_LETTER_BODY_TEMPLATE.weakSizes).toEqual([]);
    expect(MENS_LETTER_BODY_TEMPLATE.defaultSizes).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
  });

  it('pins the 44–58 chart; every size rests on two sources, size 52 seat on one', () => {
    expect(MENS_EU_BODY_TEMPLATE.rows).toEqual([
      { size: '44', bust: 88, waist: 74.5, hip: 92.5 },
      { size: '46', bust: 92, waist: 78.5, hip: 96 },
      { size: '48', bust: 96, waist: 83, hip: 99.5 },
      { size: '50', bust: 100, waist: 87.5, hip: 103 },
      { size: '52', bust: 104, waist: 92.5, hip: 105.5 },
      { size: '54', bust: 108, waist: 97.5, hip: 110 },
      { size: '56', bust: 112, waist: 102.5, hip: 113.5 },
      { size: '58', bust: 116, waist: 107.5, hip: 117 },
    ]);
    expect(MENS_EU_BODY_TEMPLATE.weakSizes).toEqual([...MENS_EU_BODY_TEMPLATE.sizes]);
    const { counts } = mensChartFromSources(['50', '52'], ['bust', 'waist', 'hip'], MENS_EU_CHART_SOURCES);
    expect(counts).toEqual({ '50': 2, '52': 1 });
    // BAUR repeats the OTTO chest and waist: it must not count for them.
    const baur = MENS_EU_CHART_SOURCES.find((s) => s.id === 'baur')!;
    const otto = MENS_EU_CHART_SOURCES.find((s) => s.id === 'otto')!;
    expect(baur.points).toEqual(['hip']);
    for (const r of otto.rows) expect(baur.rows.find((b) => b.size === r.size)).toMatchObject({ bust: r.bust, waist: r.waist });
  });

  it('pins the jeans chart: waist × length, ascending by waist then length, waist and inseam only', () => {
    const t = MENS_JEANS_WL_BODY_TEMPLATE;
    expect(t.points).toEqual(['waist', 'inseam']);
    expect(t.rows).toHaveLength(27);
    expect(row(t, '28/32')).toEqual({ size: '28/32', waist: 71, inseam: 81 });
    expect(row(t, '32/30')).toEqual({ size: '32/30', waist: 81, inseam: 76 });
    expect(row(t, '32/32')).toEqual({ size: '32/32', waist: 81, inseam: 81 });
    expect(row(t, '32/34')).toEqual({ size: '32/34', waist: 81, inseam: 86 });
    expect(row(t, '38/32')).toEqual({ size: '38/32', waist: 97, inseam: 81 });
    expect(row(t, '44/32')).toEqual({ size: '44/32', waist: 112, inseam: 81 });
    expect(row(t, '44/34')).toBeUndefined();
    expect(row(t, '31/32')).toBeUndefined();
    const keys = t.rows.map((r) => parseJeansSize(r.size)!).map((s) => s.waist * 100 + s.length);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(t.defaultSizes).toHaveLength(19);
    expect(t.weakSizes).toEqual([...t.sizes]);
    // The body waist of a W size is its inch number within 1 cm, the inside leg of an L size too.
    for (const r of t.rows) {
      const s = parseJeansSize(r.size)!;
      expect(Math.abs(r.waist! - s.waist * 2.54), r.size).toBeLessThanOrEqual(1);
      expect(Math.abs(r.inseam! - s.length * 2.54), r.size).toBeLessThanOrEqual(1);
    }
  });

  it('parses and prints jeans labels', () => {
    expect(jeansSizeLabel(32, 34)).toBe('32/34');
    for (const label of ['32/34', 'W32/L34', 'W32 L34', 'w32-l34', '32x34', ' 32 / 34 ']) expect(parseJeansSize(label), label).toEqual({ waist: 32, length: 34 });
    for (const label of ['M', '32', '50', '3234', '32/3', '99/99', '10/32']) expect(parseJeansSize(label), label).toBeUndefined();
  });

  it('girths grow by 3–11 cm per size and a man’s chart has chest > waist (the seat is not always above the chest)', () => {
    for (const t of [MENS_LETTER_BODY_TEMPLATE, MENS_EU_BODY_TEMPLATE]) {
      for (let i = 0; i < t.rows.length; i++) {
        const r = t.rows[i]!;
        expect(r.bust!, `${t.id} ${r.size}`).toBeGreaterThan(r.waist!);
        expect(r.hip!, `${t.id} ${r.size}`).toBeGreaterThan(r.waist!);
        if (i === 0) continue;
        const p = t.rows[i - 1]!;
        for (const k of ['bust', 'waist', 'hip'] as const) {
          const step = r[k]! - p[k]!;
          expect(step, `${t.id} ${k} ${p.size}→${r.size}`).toBeGreaterThanOrEqual(2.5);
          expect(step, `${t.id} ${k} ${p.size}→${r.size}`).toBeLessThanOrEqual(11);
        }
      }
    }
  });

  it('the letter and the numeric chart agree within 4 cm where shops print them as equal (M = 50, L = 52/54)', () => {
    const m = row(MENS_LETTER_BODY_TEMPLATE, 'M')!;
    const e50 = row(MENS_EU_BODY_TEMPLATE, '50')!;
    for (const k of ['bust', 'waist', 'hip'] as const) expect(Math.abs(m[k]! - e50[k]!), k).toBeLessThanOrEqual(4);
    const l = row(MENS_LETTER_BODY_TEMPLATE, 'L')!;
    expect(l.bust!).toBeGreaterThanOrEqual(row(MENS_EU_BODY_TEMPLATE, '52')!.bust!);
    expect(l.bust!).toBeLessThanOrEqual(row(MENS_EU_BODY_TEMPLATE, '54')!.bust!);
  });

  it('records how far the letter sources disagree: under 8 cm up to L, over 15 cm at 3XL', () => {
    const spread = MENS_CHART_SOURCE_SPREAD['mens-letter-body']!;
    for (const size of ['S', 'M', 'L']) for (const k of ['bust', 'waist', 'hip'] as const) expect(spread[size]![k]!, `${size} ${k}`).toBeLessThanOrEqual(8);
    expect(spread['3XL']!.bust).toBe(21);
    expect(spread['3XL']!.waist).toBe(22);
    expect(MENS_LETTER_CHART_SOURCES.filter((s) => s.inMedian).map((s) => s.id)).toEqual(['nike', 'arcteryx', 'swix', 'macpac']);
  });

  it('pass the chart check with no warnings, drop into a payload, resolve by id and travel on the wire', () => {
    for (const t of MENS_BODY_CHART_TEMPLATES) {
      expect(checkChart(chartFromBodyTemplate(t, t.sizes)), t.id).toEqual({ ok: true, errors: [], warnings: [] });
      const g = { ...MOCK_GARMENTS[0]!, audience: 'men' as const, ...chartPayload(chartFromBodyTemplate(t)) };
      expect(GarmentPayloadSchema.safeParse(g).success, t.id).toBe(true);
      expect(resolveChartSpec({ templateId: t.id }).sizeChart.map((r) => r.size)).toEqual([...t.defaultSizes]);
    }
    expect(resolveChartSpec({ templateId: 'mens-jeans-wl-body', sizes: ['32/32', '34/32'] }).sizeChart).toEqual([
      { size: '32/32', waist: 81, inseam: 81 },
      { size: '34/32', waist: 86, inseam: 81 },
    ]);
    const dto = chartTemplatesDto();
    expect(ChartTemplatesResponseSchema.safeParse(dto).success).toBe(true);
    expect(dto.templates.find((t) => t.id === 'eu-mens-body')).toMatchObject({ audience: 'men', generic: true, region: 'EU', points: ['bust', 'waist', 'hip'] });
  });

  it('the chart check still warns when a girth shrinks, and when an inseam shrinks without a new waist', () => {
    expect(checkChart({ sizeChartType: 'body', sizeChart: [{ size: '32/34', waist: 81, inseam: 86 }, { size: '34/30', waist: 86, inseam: 76 }] }).warnings).toEqual([]);
    expect(checkChart({ sizeChartType: 'body', sizeChart: [{ size: '32/34', waist: 81, inseam: 86 }, { size: '32/30', waist: 81, inseam: 76 }] }).warnings[0]).toMatch(/inseam gets smaller/);
    expect(checkChart({ sizeChartType: 'body', sizeChart: [{ size: '34/32', waist: 86, inseam: 81 }, { size: '32/32', waist: 81, inseam: 81 }] }).warnings[0]).toMatch(/waist gets smaller/);
  });

  it('a men’s template typed in as garment measurements is caught like the women’s ones', () => {
    const rows = chartFromBodyTemplate(MENS_LETTER_BODY_TEMPLATE).sizeChart;
    expect(bodyTemplateMatching(rows)?.id).toBe('mens-letter-body');
    expect(checkChart({ sizeChartType: 'garment', sizeChart: rows }).warnings.join(' ')).toMatch(/body chart, but the chart is marked as garment/);
  });
});
