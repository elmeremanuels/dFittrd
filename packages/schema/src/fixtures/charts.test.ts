import { describe, expect, it } from 'vitest';
import { SizeChartSchema } from '../garment';
import {
  AU_CHART_POINTS,
  AU_WOMENS_BODY_CHART,
  AU_WOMENS_BODY_CHART_SPREAD,
  AU_WOMENS_CHART_SOURCES,
  AU_WOMENS_SIZES,
  auChartSourceValues,
  auWomensBodyChart,
} from './charts';
import * as schema from '../index';

describe('AU_WOMENS_BODY_CHART', () => {
  it('is exported from @curtain/schema and is a valid size chart for sizes 6-20', () => {
    expect(schema.AU_WOMENS_BODY_CHART).toBe(AU_WOMENS_BODY_CHART);
    expect(SizeChartSchema.safeParse(AU_WOMENS_BODY_CHART).success).toBe(true);
    expect(AU_WOMENS_BODY_CHART.map((r) => r.size)).toEqual([...AU_WOMENS_SIZES]);
  });

  it('pins the values for sizes 8-16', () => {
    expect(AU_WOMENS_BODY_CHART.slice(1, 6)).toEqual([
      { size: '8', bust: 85, waist: 67.5, hip: 94 },
      { size: '10', bust: 90, waist: 72.5, hip: 99 },
      { size: '12', bust: 95, waist: 77.5, hip: 104 },
      { size: '14', bust: 100, waist: 82.5, hip: 109 },
      { size: '16', bust: 105, waist: 87.5, hip: 114 },
    ]);
  });

  it('is strictly increasing per point with plausible steps (2.5-7.5 cm per size)', () => {
    for (const point of AU_CHART_POINTS) {
      for (let i = 1; i < AU_WOMENS_BODY_CHART.length; i++) {
        const step = AU_WOMENS_BODY_CHART[i]![point]! - AU_WOMENS_BODY_CHART[i - 1]![point]!;
        expect(step, `${point} ${AU_WOMENS_BODY_CHART[i - 1]!.size}->${AU_WOMENS_BODY_CHART[i]!.size}`).toBeGreaterThanOrEqual(2.5);
        expect(step).toBeLessThanOrEqual(7.5);
      }
    }
  });

  it('has a plausible body shape in every row: hip > bust > waist, bust-waist and hip-waist drops 15-30 cm', () => {
    for (const r of AU_WOMENS_BODY_CHART) {
      expect(r.hip!).toBeGreaterThan(r.bust!);
      expect(r.bust!).toBeGreaterThan(r.waist!);
      expect(r.bust! - r.waist!).toBeGreaterThanOrEqual(15);
      expect(r.bust! - r.waist!).toBeLessThanOrEqual(30);
      expect(r.hip! - r.waist!).toBeGreaterThanOrEqual(20);
      expect(r.hip! - r.waist!).toBeLessThanOrEqual(30);
    }
  });

  it('every value is the rounded median of the median sources and lies within their spread', () => {
    for (const cell of AU_WOMENS_BODY_CHART_SPREAD) {
      const v = AU_WOMENS_BODY_CHART.find((r) => r.size === cell.size)![cell.point]!;
      expect(cell.n).toBe(auChartSourceValues(cell.size, cell.point, { inMedianOnly: true }).length);
      expect(v).toBeGreaterThanOrEqual(cell.min - 0.25);
      expect(v).toBeLessThanOrEqual(cell.max + 0.25);
    }
  });

  it('sizes 8-16 rest on at least three retailers that agree within 8 cm', () => {
    for (const cell of AU_WOMENS_BODY_CHART_SPREAD.filter((c) => ['8', '10', '12', '14', '16'].includes(c.size))) {
      expect(cell.n, `${cell.size}.${cell.point}`).toBeGreaterThanOrEqual(3);
      expect(cell.max - cell.min, `${cell.size}.${cell.point}`).toBeLessThanOrEqual(8);
    }
  });

  it('source charts are themselves ascending and documented', () => {
    for (const src of AU_WOMENS_CHART_SOURCES) {
      expect(src.url).toMatch(/^https:\/\//);
      for (const point of AU_CHART_POINTS) {
        const vals = src.rows.map((r) => r[point]);
        for (let i = 1; i < vals.length; i++) expect(vals[i]!, `${src.id}.${point}`).toBeGreaterThan(vals[i - 1]!);
      }
    }
  });

  it('auWomensBodyChart restricts to the offered sizes in chart order', () => {
    expect(auWomensBodyChart(['16', '8', ' 12', 'XL']).map((r) => r.size)).toEqual(['8', '12', '16']);
    const rows = auWomensBodyChart(['8']);
    rows[0]!.bust = 1;
    expect(AU_WOMENS_BODY_CHART[1]!.bust).toBe(85);
  });
});
