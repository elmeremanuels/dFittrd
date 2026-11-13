import { describe, expect, it } from 'vitest';
import { ACTIVE_THRESHOLD, COMPLETENESS_WEIGHTS, completenessScore, missingFields } from './completeness';
import { MOCK_GARMENTS, mockGarment } from './fixtures';

describe('completenessScore', () => {
  it('scores every fixture active with no heavy or medium field missing', () => {
    for (const g of MOCK_GARMENTS) {
      const r = completenessScore(g);
      expect(r.status, g.id).toBe('active');
      expect(r.missing.filter((m) => m.severity === 'heavy'), g.id).toEqual([]);
      expect(r.score, g.id).toBeGreaterThanOrEqual(ACTIVE_THRESHOLD);
    }
  });

  it('a complete dress scores 1', () => {
    const r = completenessScore(mockGarment('aalter-studio-1'));
    expect(r.score).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.status).toBe('active');
  });

  it('returns score 0 and every category-independent field for garbage input', () => {
    for (const input of [undefined, null, 42, 'x', []]) {
      const r = completenessScore(input);
      expect(r.score).toBe(0);
      expect(r.status).toBe('incomplete');
      expect(r.missing.map((m) => m.field)).toEqual(
        expect.arrayContaining(['category', 'sizeChartType', 'sizeChart', 'fabric.primary', 'flatLayPhoto']),
      );
    }
  });

  it('weights heavy > medium > light and sorts missing by severity', () => {
    expect(COMPLETENESS_WEIGHTS.heavy).toBeGreaterThan(COMPLETENESS_WEIGHTS.medium);
    expect(COMPLETENESS_WEIGHTS.medium).toBeGreaterThan(COMPLETENESS_WEIGHTS.light);
    const g = mockGarment('aalter-studio-1');
    const { flatLayPhoto: _f, ease: _e, colorways: _c, ...stripped } = g;
    const r = completenessScore(stripped);
    expect(r.missing.map((m) => m.field)).toEqual(['flatLayPhoto', 'ease', 'colorways']);
    expect(r.missing.map((m) => m.weight)).toEqual([3, 2, 1]);
    expect(r.status).toBe('incomplete'); // heavy missing
    for (const m of r.missing) expect(m.reason.length).toBeGreaterThan(20);
  });

  it('marks incomplete when any heavy field is missing even if the score is high', () => {
    const g = mockGarment('linde-dress-01');
    const { sizeChartType: _s, ...noType } = g;
    const r = completenessScore(noType);
    expect(r.score).toBeGreaterThan(0.8);
    expect(r.status).toBe('incomplete');
    expect(r.missing[0]?.field).toBe('sizeChartType');
    expect(r.missing[0]?.reason).toMatch(/garment|body/);
  });

  it('a heavies-only payload is active (fit engine falls back to category defaults)', () => {
    const g = mockGarment('noord-top-01');
    const minimal = {
      id: g.id,
      name: g.name,
      brand: g.brand,
      category: g.category,
      sizeChartType: g.sizeChartType,
      sizeChart: g.sizeChart,
      fabric: { primary: g.fabric.primary, stretchPct: 0, drape: 0.4 },
      flatLayPhoto: g.flatLayPhoto,
    };
    const r = completenessScore(minimal);
    expect(r.missing.filter((m) => m.severity === 'heavy')).toEqual([]);
    expect(r.status).toBe('active');
    expect(r.missing.map((m) => m.field)).toEqual(expect.arrayContaining(['ease', 'lengthCm', 'criticalFitPoints', 'fabric.sheen', 'fabric.opacity', 'colorways']));
  });

  it('explains an empty or point-less size chart', () => {
    const g = mockGarment('aalter-studio-1');
    expect(completenessScore({ ...g, sizeChart: [] }).missing[0]).toMatchObject({ field: 'sizeChart', severity: 'heavy' });
    const r = completenessScore({ ...g, sizeChart: [{ size: 'M' }, { size: 'L' }] });
    expect(r.missing[0]?.field).toBe('sizeChart');
    expect(r.missing[0]?.reason).toMatch(/bust, waist, hip, shoulder/);
    const bad = completenessScore({ ...g, sizeChart: [{ size: 'M', bust: 'wide' }] });
    expect(bad.missing[0]?.reason).toMatch(/invalid/);
  });

  it('is category-aware: shoes and accessories do not need ease, lengths or critical points', () => {
    const shoes = completenessScore(mockGarment('sole-01'));
    expect(shoes.checked).not.toContain('ease');
    expect(shoes.checked).not.toContain('criticalFitPoints');
    expect(shoes.checked).toContain('sizeChart.foot');
    expect(shoes.status).toBe('active');

    const scarf = completenessScore(mockGarment('haven-02'));
    expect(scarf.checked).not.toContain('fabric.drape');
    expect(scarf.checked).not.toContain('trueToSizeScore');
    expect(scarf.status).toBe('active');
  });

  it('flags a missing shoulder column for tops as a light reason', () => {
    const g = mockGarment('noord-top-01');
    const r = completenessScore({ ...g, sizeChart: g.sizeChart.map(({ shoulder: _s, ...row }) => row) });
    const m = r.missing.find((x) => x.field === 'sizeChart.shoulder');
    expect(m).toMatchObject({ severity: 'light', weight: 1 });
    expect(r.status).toBe('active');
  });

  it('rejects an http flat-lay URL and a bad hex colour', () => {
    const g = mockGarment('aalter-studio-1');
    expect(missingFields({ ...g, flatLayPhoto: 'not a url' })).toContain('flatLayPhoto');
    expect(missingFields({ ...g, primaryColorHex: 'coral' })).toContain('primaryColorHex');
  });

  it('is deterministic and does not mutate its input', () => {
    const g = Object.freeze(structuredClone(mockGarment('raw-denim-01')));
    const a = completenessScore(g);
    const b = completenessScore(g);
    expect(a).toEqual(b);
  });
});
