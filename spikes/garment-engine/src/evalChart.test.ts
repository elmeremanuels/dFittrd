import { describe, expect, it } from 'vitest';
import { mockGarment } from '@curtain/schema';
import { asGradingChart, criticalRings, evalChart, evalChartRow } from './evalChart';
import { shopPayload, shopPayloads } from './evalFixtures';
import { SPIKE_PRODUCT_IDS, garmentChart } from './product';

describe('evalChart', () => {
  it.each(SPIKE_PRODUCT_IDS)('gives the same chart as product.ts for the spike product %s', (id) => {
    const p = mockGarment(id);
    const a = evalChart(p);
    const b = garmentChart(p);
    expect(asGradingChart(a)).toEqual(b);
  });

  it('reads all five shop payloads, with their AU sizes', () => {
    const charts = shopPayloads().map((s) => evalChart(s.payload));
    expect(charts.map((c) => c.category)).toEqual(['dress', 'top', 'bottom', 'bottom', 'outerwear']);
    expect(charts[0]!.rows.map((r) => r.size)).toEqual(['8', '10', '12', '14', '16']);
    expect(charts[4]!.rows.map((r) => r.size)).toEqual(['S-M', 'M-L']);
  });

  it('adds the product ease where printed and the fit engine category default elsewhere', () => {
    const dress = shopPayload('azure-palm-baby-doll-dress');
    const row = evalChartRow(evalChart(dress.payload), '12');
    // AU 12 body 95 / 77.5 / 104; bust ease +7 from the printed garment table; waist +4 and hip +6 are the dress defaults.
    expect(row.rings).toEqual({ chest: 102, waist: 81.5, hip: 110 });
    expect(row.defaultEase).toEqual(['waist', 'hip']);
    const pants = evalChartRow(evalChart(shopPayload('rosewater-palazzo-pants').payload), '12');
    expect(pants.rings).toEqual({ waist: 79.5, hip: 118 }); // bottom default waist +2, printed hip ease +14
    const cardi = evalChartRow(evalChart(shopPayload('woodstock-wanderer-knit-cardi').payload), 'S-M');
    expect(cardi.rings).toEqual({ chest: 102, waist: 84.5, hip: 109 }); // outerwear defaults +12 / +12 / +10
  });

  it('picks the critical rings from the fit engine category points minus what the pattern block skips (no criticalFitPoints in the shop data)', () => {
    const crit = (h: string) => {
      const s = shopPayload(h);
      return criticalRings(s.payload, evalChart(s.payload), s.baseSize);
    };
    expect(crit('azure-palm-baby-doll-dress')).toEqual(['chest']); // empire: hangs from the bust
    expect(evalChart(shopPayload('azure-palm-baby-doll-dress').payload).notFitted).toEqual({ rings: ['waist', 'hip'], block: 'empire', label: 'empire line hangs from the bust' });
    expect(crit('rosewater-palazzo-pants')).toEqual(['waist', 'hip']); // wide-leg skips only the thigh
    expect(crit('crimson-wildflower-maxi-skirt')).toEqual(['waist']); // a-line: the hem flares freely
    expect(crit('woodstock-wanderer-knit-cardi')).toEqual(['chest']); // oversized
    // A point the product names as critical is checked even when its block skips it (as computeFit does).
    const named = { ...shopPayload('azure-palm-baby-doll-dress').payload, criticalFitPoints: ['bust', 'waist'] as const };
    expect(criticalRings(named as never, evalChart(named as never), '12')).toEqual(['chest', 'waist']);
    const fixture = mockGarment('aalter-studio-2');
    expect(criticalRings(fixture, evalChart(fixture), 'M')).toEqual(['chest']); // its own criticalFitPoints
  });

  it('refuses categories it cannot evaluate and duplicate size labels', () => {
    const p = shopPayload('rosewater-blouse').payload;
    expect(() => evalChart({ ...p, category: 'shoes' })).toThrow(/no evaluation/);
    expect(() => evalChart({ ...p, sizeChart: [p.sizeChart[0]!, p.sizeChart[0]!] })).toThrow(/duplicate/);
  });
});
