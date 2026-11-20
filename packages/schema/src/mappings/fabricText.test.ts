import { describe, expect, it } from 'vitest';
import type { FabricConstructionId, FabricFibreId } from '../fabrics';
import { fabricFromText, parseFabricText } from './fabricText';

type Expect = { composition: Array<[FabricFibreId, number]>; construction?: FabricConstructionId };

/** Product titles, descriptions and care labels, English and Dutch. */
const CASES: ReadonlyArray<[string, Expect | undefined]> = [
  ['100% linnen', { composition: [['linen', 100]] }],
  ['100% linen', { composition: [['linen', 100]] }],
  ['95% katoen 5% elastaan', { composition: [['cotton', 95], ['elastane', 5]] }],
  ['95% cotton, 5% elastane', { composition: [['cotton', 95], ['elastane', 5]] }],
  ['Katoen 95%, elastaan 5%', { composition: [['cotton', 95], ['elastane', 5]] }],
  ['katoen 95% elastaan 5%', { composition: [['cotton', 95], ['elastane', 5]] }],
  ['cotton jersey', { composition: [['cotton', 100]], construction: 'jersey' }],
  ['Tencel', { composition: [['lyocell', 100]] }],
  ['TENCEL™ Lyocell blouse', { composition: [['lyocell', 100]] }],
  ['Jersey 95% cotton 5% elastane', { composition: [['cotton', 95], ['elastane', 5]], construction: 'jersey' }],
  ['98% Baumwolle 2% Elasthan', { composition: [['cotton', 98], ['elastane', 2]] }],
  ['Stretch denim, 98% cotton / 2% Lycra®', { composition: [['cotton', 98], ['elastane', 2]], construction: 'denim' }],
  ['Spijkerstof: 99% katoen, 1% elastaan', { composition: [['cotton', 99], ['elastane', 1]], construction: 'denim' }],
  ['Buitenstof: 100% polyester. Voering: 100% viscose', { composition: [['polyester', 100]] }],
  ['Shell 100% nylon, lining 100% polyester', { composition: [['nylon', 100]] }],
  ['70% wol 30% polyamide', { composition: [['wool', 70], ['nylon', 30]] }],
  ['55% linnen 45% katoen', { composition: [['linen', 55], ['cotton', 45]] }],
  ['100% zijde', { composition: [['silk', 100]] }],
  ['Zijden blouse', { composition: [['silk', 100]] }],
  ['Wollen jas met kasjmier', { composition: [['wool', 100]], construction: 'cashmere' }],
  ['100% cashmere sweater', { composition: [['wool', 100]], construction: 'cashmere' }],
  ['Merino wool base layer', { composition: [['wool', 100]], construction: 'merino' }],
  ['92% modal 8% elastane', { composition: [['modal', 92], ['elastane', 8]] }],
  ['60% viscose, 35% polyamide, 5% elastane', { composition: [['viscose', 60], ['nylon', 35], ['elastane', 5]] }],
  ['Hennep en biologisch katoen', { composition: [['hemp', 50], ['cotton', 50]] }],
  ['Acryl gebreide muts', { composition: [['acrylic', 100]] }],
  ['Leren jack', { composition: [], construction: 'leather' }],
  ['100% leer', { composition: [], construction: 'leather' }],
  ['Kunstleren broek', { composition: [['polyester', 100]], construction: 'faux-leather' }],
  ['Vegan leather jacket', { composition: [['polyester', 100]], construction: 'faux-leather' }],
  ['Suède enkellaarsjes', { composition: [], construction: 'suede' }],
  ['Alcantara trim', { composition: [['polyester', 100]], construction: 'microfibre-suede' }],
  ['Gore-Tex shell jacket', { composition: [], construction: 'membrane-laminate' }],
  ['Polartec fleece', { composition: [['polyester', 100]], construction: 'fleece' }],
  ['Ribfluweel broek', { composition: [], construction: 'corduroy' }],
  ['Fluwelen jurk', { composition: [], construction: 'velvet' }],
  ['Badstof badjas, 100% katoen', { composition: [['cotton', 100]], construction: 'terry' }],
  ['French terry hoodie', { composition: [], construction: 'french-terry' }],
  ['Popeline overhemd van katoen', { composition: [['cotton', 100]], construction: 'poplin' }],
  ['Piqué polo', { composition: [], construction: 'pique' }],
  ['Kanten top', { composition: [], construction: 'lace' }],
  ['Satijnen rok', { composition: [], construction: 'satin' }],
  ['Silk chiffon scarf', { composition: [['silk', 100]], construction: 'chiffon' }],
  ['Cotton/elastane chinos', { composition: [['elastane', 3], ['cotton', 97]] }],
  ['Teddy jas (sherpa)', { composition: [], construction: 'teddy' }],
  ['Neopreen scuba rok', { composition: [], construction: 'neoprene' }],
  ['95,5% polyester 4,5% elastaan', { composition: [['polyester', 95.5], ['elastane', 4.5]] }],
  ['Linen-blend wide-leg trousers', { composition: [['linen', 100]] }],
  // Nothing to find.
  ['Jack & Jones slim fit', undefined],
  ['Oversized blazer', undefined],
  ['', undefined],
];

describe('parseFabricText', () => {
  it('covers at least 25 strings', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(CASES)('%j', (text, want) => {
    const got = parseFabricText(text);
    if (want === undefined) {
      expect(got).toBeUndefined();
      return;
    }
    expect(got).toBeDefined();
    const composition = Object.fromEntries(got!.composition.map((c) => [c.fibre, c.pct]));
    expect(composition).toEqual(Object.fromEntries(want.composition));
    expect(got!.construction).toBe(want.construction);
  });

  it('flags assumed shares', () => {
    expect(parseFabricText('Cotton/elastane chinos')!.sharesAssumed).toBe(true);
    expect(parseFabricText('95% katoen 5% elastaan')!.sharesAssumed).toBe(false);
  });

  it('lists every id found in order', () => {
    expect(parseFabricText('Silk chiffon scarf with lace trim')!.ids).toEqual(['silk', 'chiffon', 'lace']);
  });
});

describe('fabricFromText', () => {
  it('resolves text to library parameters', () => {
    const jersey = fabricFromText('cotton jersey')!;
    const poplin = fabricFromText('katoenen popeline')!;
    expect(jersey.stretchPct).toBeGreaterThan(poplin.stretchPct);
    const stretch = fabricFromText('95% katoen 5% elastaan')!;
    expect(stretch.elastanePct).toBe(5);
    expect(fabricFromText('Oversized blazer')).toBeUndefined();
  });

  it('lets product values win', () => {
    expect(fabricFromText('100% linnen', { weightGsm: 240 })!.weightGsm).toBe(240);
  });
});
