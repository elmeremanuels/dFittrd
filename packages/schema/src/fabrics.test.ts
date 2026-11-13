import { describe, expect, it } from 'vitest';
import {
  ELASTANE_STRETCH_PER_PCT,
  FABRIC_BY_ID,
  FABRIC_CONSTRUCTION_IDS,
  FABRIC_FIBRE_IDS,
  FABRIC_LIBRARY,
  FABRIC_LIBRARY_VERSION,
  FABRIC_SOURCES,
  FABRIC_TEXTURE_PRESETS,
  deriveFabricSimulation,
  lookupFabricId,
  normaliseFabricText,
  resolveFabric,
  resolvedFabricToPayload,
} from './fabrics';
import { FabricSchema } from './garment';
import { parseFabricText } from './mappings/fabricText';
import * as schema from './index';

describe('fabric library v1', () => {
  it('is versioned semver', () => {
    expect(FABRIC_LIBRARY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has exactly the 12 base fibres and 38 constructions of the handoff, each once', () => {
    expect(FABRIC_FIBRE_IDS).toHaveLength(12);
    expect(FABRIC_CONSTRUCTION_IDS).toHaveLength(38);
    expect(FABRIC_LIBRARY).toHaveLength(50);
    expect(new Set(FABRIC_LIBRARY.map((e) => e.id)).size).toBe(50);
    expect(FABRIC_LIBRARY.filter((e) => e.type === 'fibre').map((e) => e.id)).toEqual([...FABRIC_FIBRE_IDS]);
    expect(FABRIC_LIBRARY.filter((e) => e.type === 'construction').map((e) => e.id)).toEqual([...FABRIC_CONSTRUCTION_IDS]);
  });

  it.each(FABRIC_LIBRARY.map((e) => [e.id, e] as const))('%s has complete, in-range values', (_id, e) => {
    expect(e.names.en.length).toBeGreaterThan(0);
    expect(e.names.nl.length).toBeGreaterThan(0);
    expect(e.weightGsm.min).toBeGreaterThan(0);
    expect(e.weightGsm.max).toBeGreaterThanOrEqual(e.weightGsm.min);
    expect(e.stretchPct.min).toBeGreaterThanOrEqual(0);
    expect(e.stretchPct.max).toBeGreaterThanOrEqual(e.stretchPct.min);
    expect(e.stretchPct.max).toBeLessThanOrEqual(100);
    for (const v of [e.drape, e.sheen, e.opacity]) expect(v >= 0 && v <= 1).toBe(true);
    expect(e.bendStiffness).toBeGreaterThan(0);
    expect(FABRIC_TEXTURE_PRESETS).toContain(e.texture);
    expect(e.sources.length).toBeGreaterThan(0);
    for (const s of e.sources) expect(Object.keys(FABRIC_SOURCES)).toContain(s);
    // A value without a published source must be marked as an estimate.
    if (e.sources.every((s) => s === 'estimate')) expect(e.estimated).toEqual(expect.arrayContaining(['weightGsm', 'stretchPct', 'drape', 'bendStiffness', 'sheen', 'opacity']));
    expect(e.simulation.massKgM2).toBeCloseTo((e.weightGsm.min + e.weightGsm.max) / 2000, 4);
    expect(e.simulation.stretchStiffness).toBeGreaterThan(0);
    expect(e.simulation.bendStiffness).toBeGreaterThan(0);
    expect(e.simulation.damping).toBeGreaterThan(0);
    expect(e.simulation.damping).toBeLessThan(1);
    if (e.baseFibre) expect(FABRIC_FIBRE_IDS).toContain(e.baseFibre);
  });

  it('every source except the estimate is an https page', () => {
    for (const [id, s] of Object.entries(FABRIC_SOURCES)) {
      if (id === 'estimate') continue;
      expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it('no term resolves to two entries: ids, names and aliases are unambiguous', () => {
    const seen = new Map<string, string>();
    for (const e of FABRIC_LIBRARY) {
      for (const t of new Set([e.id, e.names.en, e.names.nl, ...e.aliases].map(normaliseFabricText))) {
        expect(seen.get(t) ?? e.id, `"${t}" is used by ${seen.get(t)} and ${e.id}`).toBe(e.id);
        seen.set(t, e.id);
      }
    }
  });

  it('maps brand names to generic entries', () => {
    expect(lookupFabricId('Lycra')).toBe('elastane');
    expect(lookupFabricId('TENCEL')).toBe('lyocell');
    expect(lookupFabricId('Gore-Tex')).toBe('membrane-laminate');
    expect(lookupFabricId('Alcantara')).toBe('microfibre-suede');
    expect(lookupFabricId('Polartec')).toBe('fleece');
    expect(lookupFabricId('Cordura')).toBe('nylon');
    expect(lookupFabricId('katoen')).toBe('cotton');
    expect(lookupFabricId('Suède')).toBe('suede');
    expect(lookupFabricId('unobtainium')).toBeUndefined();
  });

  it('stiffer, lighter or more elastic fabrics get the matching simulation parameters', () => {
    expect(FABRIC_BY_ID.jersey.simulation.stretchStiffness).toBeLessThan(FABRIC_BY_ID.poplin.simulation.stretchStiffness);
    expect(FABRIC_BY_ID.denim.simulation.bendStiffness).toBeGreaterThan(FABRIC_BY_ID.chiffon.simulation.bendStiffness);
    expect(FABRIC_BY_ID.chiffon.simulation.massKgM2).toBeLessThan(FABRIC_BY_ID.denim.simulation.massKgM2);
    expect(FABRIC_BY_ID.canvas.simulation.damping).toBeGreaterThan(FABRIC_BY_ID.chiffon.simulation.damping);
    const sim = deriveFabricSimulation({ weightGsm: 200, stretchPct: 20, drape: 0.5, bendStiffness: 1 });
    expect(sim).toEqual({ stretchStiffness: 3000, bendStiffness: 0.00009807, massKgM2: 0.2, damping: 0.07 });
  });

  it('is exported from the package entry', () => {
    expect(schema.FABRIC_LIBRARY_VERSION).toBe(FABRIC_LIBRARY_VERSION);
    expect(typeof schema.resolveFabric).toBe('function');
    expect(typeof schema.parseFabricText).toBe('function');
  });
});

describe('resolveFabric', () => {
  it('cotton jersey stretches, cotton poplin does not', () => {
    const jersey = resolveFabric({ composition: [{ fibre: 'cotton', pct: 100 }], construction: 'jersey' });
    const poplin = resolveFabric({ composition: [{ fibre: 'cotton', pct: 100 }], construction: 'poplin' });
    expect(jersey.stretchPct).toBeGreaterThanOrEqual(15);
    expect(poplin.stretchPct).toBeLessThanOrEqual(2);
    expect(jersey.construction).toBe('jersey');
    expect(jersey.provenance.stretchPct).toBe('construction');
    expect(jersey.fibres).toEqual([{ id: 'cotton', pct: 100 }]);
    expect(jersey.simulation.stretchStiffness).toBeLessThan(poplin.simulation.stretchStiffness);
  });

  it('R3: a construction named in the composition is the construction, with its base fibre share', () => {
    const cashmere = resolveFabric({ composition: [{ fibre: 'cashmere', pct: 100 }] });
    expect(cashmere.construction).toBe('cashmere');
    expect(cashmere.fibres).toEqual([{ id: 'wool', pct: 100 }]);
    expect(cashmere.construction).toBe(parseFabricText('100% cashmere')?.construction);
    // A construction without a base fibre keeps working as before.
    const blend = resolveFabric({ composition: [{ fibre: 'merino', pct: 80 }, { fibre: 'polyamide', pct: 20 }] });
    expect(blend.construction).toBe('merino');
    expect(blend.fibres.find((f) => f.id === 'wool')?.pct).toBe(80);
    // An explicit construction still wins over one in the composition.
    expect(resolveFabric({ composition: [{ fibre: 'cashmere', pct: 100 }], construction: 'jersey' }).construction).toBe('jersey');
  });

  it('95/5 cotton/elastane adds stretch by the elastane share', () => {
    const plain = resolveFabric({ composition: [{ fibre: 'cotton', pct: 100 }] });
    const stretch = resolveFabric({ composition: [{ fibre: 'cotton', pct: 95 }, { fibre: 'elastane', pct: 5 }] });
    expect(stretch.elastanePct).toBe(5);
    expect(stretch.stretchPct).toBeCloseTo(plain.stretchPct + 5 * ELASTANE_STRETCH_PER_PCT, 5);
    // Elastane stretches the construction too: 95/5 poplin is a stretch woven, 95/5 jersey stretches more than cotton jersey.
    const poplin = resolveFabric({ composition: [{ fibre: 'katoen', pct: 95 }, { fibre: 'elastaan', pct: 5 }], construction: 'popeline' });
    expect(poplin.stretchPct).toBeGreaterThan(15);
    const jersey95 = resolveFabric({ composition: [{ fibre: 'cotton', pct: 95 }, { fibre: 'Lycra', pct: 5 }], construction: 'jersey' });
    const jersey100 = resolveFabric({ composition: [{ fibre: 'cotton', pct: 100 }], construction: 'jersey' });
    expect(jersey95.stretchPct).toBeGreaterThan(jersey100.stretchPct);
  });

  it('blends fibre properties by share', () => {
    const r = resolveFabric({ composition: [{ fibre: 'linen', pct: 55 }, { fibre: 'cotton', pct: 45 }] });
    expect(r.drape).toBeCloseTo(0.55 * FABRIC_BY_ID.linen.drape + 0.45 * FABRIC_BY_ID.cotton.drape, 3);
    expect(r.texture).toBe('slub');
    expect(r.provenance.drape).toBe('blend');
    const silk = resolveFabric({ composition: [{ fibre: 'silk', pct: 100 }] });
    const wool = resolveFabric({ composition: [{ fibre: 'wool', pct: 100 }] });
    expect(silk.sheen).toBeGreaterThan(wool.sheen);
    expect(silk.drape).toBeGreaterThan(wool.drape);
  });

  it('explicit product values win', () => {
    const r = resolveFabric({ composition: [{ fibre: 'cotton', pct: 98 }, { fibre: 'elastane', pct: 2 }], construction: 'denim', weightGsm: 400, stretchPct: 1, drape: 0.25 });
    expect(r.weightGsm).toBe(400);
    expect(r.stretchPct).toBe(1);
    expect(r.drape).toBe(0.25);
    expect(r.provenance).toMatchObject({ weightGsm: 'product', stretchPct: 'product', drape: 'product', sheen: 'construction' });
    expect(r.simulation.massKgM2).toBe(0.4);
    // A heavier product than the library typical is stiffer.
    const typical = resolveFabric({ construction: 'denim' });
    expect(r.bendStiffness).toBeGreaterThan(typical.bendStiffness);
  });

  it('normalises shares, keeps unknown fibres out and reports them', () => {
    const r = resolveFabric({ composition: [{ fibre: 'polyester', pct: 60 }, { fibre: 'unobtainium', pct: 40 }] });
    expect(r.fibres).toEqual([{ id: 'polyester', pct: 100 }]);
    expect(r.unknown).toEqual(['unobtainium']);
  });

  it('constructions named after a fibre count as that fibre; leather becomes the construction', () => {
    const cashmereBlend = resolveFabric({ composition: [{ fibre: 'wool', pct: 90 }, { fibre: 'cashmere', pct: 10 }] });
    expect(cashmereBlend.fibres).toEqual([{ id: 'wool', pct: 100 }]);
    const leather = resolveFabric({ composition: [{ fibre: 'leather', pct: 100 }] });
    expect(leather.construction).toBe('leather');
    expect(leather.fibres).toEqual([]);
    const merino = resolveFabric({ construction: 'merino' });
    expect(merino.fibres).toEqual([{ id: 'wool', pct: 100 }]);
  });

  it('falls back to a plain cotton woven when nothing is known', () => {
    const r = resolveFabric({});
    expect(r.provenance.drape).toBe('default');
    expect(r.stretchPct).toBeLessThanOrEqual(3);
    expect(r.libraryVersion).toBe(FABRIC_LIBRARY_VERSION);
  });

  it('turns into a valid GarmentPayload fabric block', () => {
    for (const input of [
      { composition: [{ fibre: 'cotton', pct: 95 }, { fibre: 'elastane', pct: 5 }], construction: 'jersey' },
      { composition: [{ fibre: 'elastane', pct: 100 }] },
      { construction: 'leather' },
      {},
    ]) {
      const payload = resolvedFabricToPayload(resolveFabric(input));
      expect(FabricSchema.safeParse(payload).success).toBe(true);
    }
    expect(resolvedFabricToPayload(resolveFabric({ composition: [{ fibre: 'cotton', pct: 98 }, { fibre: 'elastane', pct: 2 }], construction: 'denim' }))).toMatchObject({
      primary: 'denim',
      blend: [['cotton', 98], ['elastane', 2]],
    });
  });
});
