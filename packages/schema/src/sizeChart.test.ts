import { describe, expect, it } from 'vitest';
import { coerceSizeChart, type MappingWarning } from './mappings/common';
import { MOCK_GARMENTS } from './fixtures';
import {
  GarmentPayloadDraftSchema,
  GarmentPayloadSchema,
  SizeChartSchema,
  duplicateSizeLabels,
  sizeLabelKey,
  type GarmentPayload,
} from './garment';

const BASE = MOCK_GARMENTS.find((g) => g.sizeChart.length >= 3)!;
const withChart = (sizeChart: GarmentPayload['sizeChart']): unknown => ({ ...BASE, sizeChart });

describe('size chart: duplicate labels are rejected (finding #2)', () => {
  it('every fixture chart has unique labels and still parses', () => {
    for (const g of MOCK_GARMENTS) {
      expect(duplicateSizeLabels(g.sizeChart)).toEqual([]);
      expect(GarmentPayloadSchema.safeParse(g).success).toBe(true);
    }
  });

  it('rejects an exact duplicate with a clear message on the second row', () => {
    const r = GarmentPayloadSchema.safeParse(withChart([{ size: 'S', bust: 86 }, { size: 'M', bust: 90 }, { size: 'M', bust: 94 }]));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.path).toEqual(['sizeChart', 2, 'size']);
    expect(r.error.issues[0]!.message).toBe('Duplicate size label "M" (rows 2 and 3): every row of the size chart needs its own label');
  });

  it('labels compare trimmed and case-insensitively', () => {
    expect(sizeLabelKey(' m ')).toBe('M');
    expect(SizeChartSchema.safeParse([{ size: 'm' }, { size: 'M ' }]).success).toBe(false);
    expect(SizeChartSchema.safeParse([{ size: 'XL' }, { size: 'xl' }]).success).toBe(false);
    expect(SizeChartSchema.safeParse([{ size: 'M' }, { size: 'ML' }, { size: '38' }, { size: '38.5' }]).success).toBe(true);
  });

  it('reports every repeated row, and each duplicate label once', () => {
    const rows = [{ size: 'S' }, { size: 'S' }, { size: 'M' }, { size: 's' }, { size: 'M' }];
    const r = SizeChartSchema.safeParse(rows);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path)).toEqual([[1, 'size'], [3, 'size'], [4, 'size']]);
    expect(duplicateSizeLabels(rows)).toEqual(['S', 'M']);
  });

  it('the draft schema applies the same rule when a chart is present', () => {
    const draft = { id: 'x', name: 'x', brand: 'x', sizeChart: [{ size: '28' }, { size: '28' }] };
    const r = GarmentPayloadDraftSchema.safeParse(draft);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/^Duplicate size label "28"/);
    expect(GarmentPayloadDraftSchema.safeParse({ id: 'x', name: 'x', brand: 'x' }).success).toBe(true);
  });

  it('coerceSizeChart (Shopify/Woo mappings) warns and drops a chart with duplicate labels', () => {
    const warnings: MappingWarning[] = [];
    expect(coerceSizeChart(JSON.stringify([{ size: 'S', bust: 86 }, { label: 's', bust: 88 }]), warnings, 'size_chart')).toBeUndefined();
    expect(warnings).toEqual([
      { source: 'size_chart', path: 'sizeChart', message: '1.size: Duplicate size label "s" (rows 1 and 2): every row of the size chart needs its own label' },
    ]);
    // An object keyed by label cannot hold duplicates and still maps.
    expect(coerceSizeChart({ S: { bust: 86 }, M: { bust: 90 } }, [], 'size_chart')).toEqual([
      { size: 'S', bust: 86 },
      { size: 'M', bust: 90 },
    ]);
  });
});
