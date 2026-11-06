/**
 * The fabric library wired into product data: coerceFabric and the Shopify / WooCommerce mappings
 * resolve fabric text (English and Dutch) to library ids, and v1 payloads keep their values.
 */
import { describe, expect, it } from 'vitest';
import { FABRIC_PRIMARY_LIBRARY_IDS, FABRIC_BY_ID, fabricLibraryId, fabricPayloadName, lookupFabricId, resolveFabric } from '../fabrics';
import { FABRIC_PRIMARIES, FabricSchema, GarmentPayloadDraftSchema } from '../garment';
import { MOCK_GARMENTS } from '../fixtures';
import { FABRIC_TEXT_FIELD, canonicalFabricName, coerceFabric, fabricFromProductText, type MappingWarning } from './common';
import { resolveFabricText } from './fabricText';
import { fromShopifyProduct } from './shopify';
import { fromWooMeta } from './woo';

describe('v1 FABRIC_PRIMARIES ↔ library ids', () => {
  it('maps every v1 primary, and only to library ids', () => {
    expect(Object.keys(FABRIC_PRIMARY_LIBRARY_IDS).sort()).toEqual([...FABRIC_PRIMARIES].sort());
    for (const id of Object.values(FABRIC_PRIMARY_LIBRARY_IDS)) if (id !== null) expect(FABRIC_BY_ID[id]).toBeDefined();
    expect(FABRIC_PRIMARY_LIBRARY_IDS.tencel).toBe('lyocell');
    expect(FABRIC_PRIMARY_LIBRARY_IDS.technical).toBeNull();
  });

  it('round-trips: a v1 primary is its own payload name, so v1 payloads never change', () => {
    for (const v1 of FABRIC_PRIMARIES) {
      const id = fabricLibraryId(v1);
      if (v1 === 'technical') expect(id).toBeUndefined();
      else expect(fabricPayloadName(id!)).toBe(v1);
      expect(canonicalFabricName(v1)).toBe(v1);
    }
    expect(fabricPayloadName('lyocell')).toBe('tencel');
    expect(fabricPayloadName('acrylic')).toBe('acrylic');
    expect(fabricPayloadName('satin')).toBe('satin');
  });

  it('every mock garment fabric passes coerceFabric unchanged and without warnings', () => {
    for (const g of MOCK_GARMENTS) {
      const warnings: MappingWarning[] = [];
      expect(coerceFabric(JSON.stringify(g.fabric), warnings, 'fabric'), g.id).toEqual(g.fabric);
      expect(warnings, g.id).toEqual([]);
    }
  });

  it('resolveFabric reads payload names, v1 included', () => {
    expect(resolveFabric({ composition: [{ fibre: 'tencel', pct: 100 }] }).fibres).toEqual([{ id: 'lyocell', pct: 100 }]);
    expect(lookupFabricId('tencel')).toBe('lyocell');
  });
});

describe('coerceFabric resolves fabric text to library ids', () => {
  const coerce = (value: unknown) => {
    const warnings: MappingWarning[] = [];
    return { fabric: coerceFabric(value, warnings, '_curtain_fabric'), warnings };
  };

  it('names, aliases and brands in English and Dutch', () => {
    const cases: Array<[string, string]> = [
      ['Katoen', 'cotton'],
      ['Linnen', 'linen'],
      ['Zijde', 'silk'],
      ['Wol', 'wool'],
      ['Kasjmier', 'cashmere'],
      ['Spijkerstof', 'denim'],
      ['Tricot', 'jersey'],
      ['LYCRA®', 'elastane'],
      ['Elastaan', 'elastane'],
      ['Polyamide', 'nylon'],
      ['Lyocell', 'tencel'],
      ['TENCEL™', 'tencel'],
      ['Acryl', 'acrylic'],
      ['Satijn', 'satin'],
      ['Imitatieleer', 'faux-leather'],
      ['Technical', 'technical'],
    ];
    for (const [text, primary] of cases) {
      const { fabric, warnings } = coerce({ primary: text, stretchPct: 2, drape: 0.5 });
      expect(fabric?.primary, text).toBe(primary);
      expect(warnings, text).toEqual([]);
    }
  });

  it('a composition written in the primary field becomes primary + blend', () => {
    expect(coerce({ primary: '95% katoen, 5% elastaan', stretchPct: 22, drape: 0.6 }).fabric).toEqual({ primary: 'cotton', blend: [['cotton', 95], ['elastane', 5]], stretchPct: 22, drape: 0.6 });
    expect(coerce({ primary: 'Cotton jersey' }).fabric).toEqual({ primary: 'jersey', blend: [['cotton', 100]] });
    expect(coerce({ primary: '100% Linnen' }).fabric).toEqual({ primary: 'linen', blend: [['linen', 100]] });
    // The merchant's blend wins over one read from the primary text.
    expect(coerce({ primary: '95% katoen, 5% elastaan', blend: [['cotton', 97], ['elastane', 3]] }).fabric?.blend).toEqual([['cotton', 97], ['elastane', 3]]);
  });

  it('blend names resolve too; unknown names are kept as given', () => {
    expect(coerce({ primary: 'cotton', blend: [['Katoen', 95], { fibre: 'Elastaan', pct: 5 }] }).fabric?.blend).toEqual([['cotton', 95], ['elastane', 5]]);
    expect(coerce({ primary: 'viscose', blend: [['Viscose', 70], ['Bamboe', 30]] }).fabric?.blend).toEqual([['viscose', 70], ['Bamboe', 30]]);
  });

  it('a plain-text fabric field (no JSON) is not a payload fabric: it has no stretch or drape', () => {
    const { fabric, warnings } = coerce('70% viscose, 30% polyamide');
    expect(fabric).toBeUndefined();
    expect(warnings[0]).toMatchObject({ path: 'fabric', message: 'expected a JSON object' });
  });

  it('an unknown primary stays valid (open vocabulary) and is reported', () => {
    const { fabric, warnings } = coerce({ primary: 'Bamboe', stretchPct: 3, drape: 0.7 });
    expect(fabric?.primary).toBe('bamboe');
    expect(warnings).toEqual([{ source: '_curtain_fabric', path: 'fabric.primary', message: "'Bamboe' is not in the fabric library; drape and texture use defaults" }]);
  });

  it('assumed shares are never written as a blend', () => {
    expect(resolveFabricText('Katoen met elastaan')).toEqual({ primary: 'cotton' });
    expect(resolveFabricText('organic cotton, elastane')).toEqual({ primary: 'cotton' });
  });

  it('the result is always a valid GarmentPayload fabric once the numbers are there', () => {
    for (const text of ['95% katoen, 5% elastaan', 'Cotton jersey', '100% Linnen', 'TENCEL™ Lyocell', '52% polyester 45% viscose 3% elastane']) {
      const f = coerce({ primary: text, stretchPct: 5, drape: 0.6 }).fabric;
      expect(FabricSchema.safeParse(f).success, text).toBe(true);
    }
  });
});

describe('WooCommerce: fromWooMeta resolves the fabric names of the meta box', () => {
  const product = {
    id: 4182,
    name: 'Wikkeljurk Lotte',
    permalink: 'https://www.aalterstudio.nl/product/wikkeljurk-lotte/',
    price: '89.95',
    categories: [{ name: 'Jurken' }],
    attributes: [
      { name: 'Maat', slug: 'pa_maat', options: ['XS', 'S', 'M', 'L'] },
      { name: 'Materiaal', slug: 'pa_materiaal', options: ['95% viscose, 5% elastaan'] },
    ],
  };

  it('Dutch names in the fabric meta become library ids; the draft stays valid', () => {
    const fabric = { primary: 'Viscose', blend: [['Viscose', 95], ['Elastaan', 5]], weightGsm: 160, stretchPct: 18, drape: 0.85 };
    const p = fromWooMeta(product, { _curtain_fabric: JSON.stringify(fabric) }, { defaultBrand: 'Aalter Studio' });
    expect(p.fabric).toEqual({ primary: 'viscose', blend: [['viscose', 95], ['elastane', 5]], weightGsm: 160, stretchPct: 18, drape: 0.85 });
    expect(GarmentPayloadDraftSchema.safeParse(p).success).toBe(true);
  });

  it('a composition typed into the primary field fills the blend', () => {
    const p = fromWooMeta({ ...product, name: 'Slim Chino', categories: [{ name: 'Broeken' }] }, { _curtain_fabric: '{"primary":"98% organic cotton, 2% elastane","stretchPct":8,"drape":0.4}' }, { defaultBrand: 'Monochrome' });
    expect(p.fabric).toEqual({ primary: 'cotton', blend: [['cotton', 98], ['elastane', 2]], stretchPct: 8, drape: 0.4 });
    expect(GarmentPayloadDraftSchema.safeParse(p).success).toBe(true);
  });

  it('the shop attribute alone adds no fabric to the payload (prefill only)', () => {
    expect(fromWooMeta(product, {}, { defaultBrand: 'Aalter Studio' }).fabric).toBeUndefined();
  });
});

describe('Shopify: fromShopifyProduct resolves the fabric names of the metafield', () => {
  const node = {
    id: 'gid://shopify/Product/8812345678901',
    title: 'Oversized Overhemd Noor',
    vendor: 'Monochrome',
    productType: 'Overhemden',
    priceRangeV2: { minVariantPrice: { amount: '79.00', currencyCode: 'EUR' } },
  };

  it('English brand names in the `$app:curtain` fabric metafield', () => {
    const p = fromShopifyProduct(node, [{ namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify({ primary: 'TENCEL™ Lyocell', blend: [['Tencel', 70], ['Linen', 30]], stretchPct: 2, drape: 0.8 }) }]);
    expect(p.fabric).toEqual({ primary: 'tencel', blend: [['tencel', 70], ['linen', 30]], stretchPct: 2, drape: 0.8 });
    expect(GarmentPayloadDraftSchema.safeParse(p).success).toBe(true);
  });

  it('Dutch names, and a shop metafield in another namespace is not read', () => {
    const p = fromShopifyProduct(node, [
      { namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify({ primary: 'Katoen', blend: [['Katoen', 100]], stretchPct: 1, drape: 0.45 }) },
      { namespace: 'custom', key: 'material', value: '100% polyester' },
    ]);
    expect(p.fabric).toEqual({ primary: 'cotton', blend: [['cotton', 100]], stretchPct: 1, drape: 0.45 });
  });
});

describe('fabricFromProductText (prefill from the shop’s own material text)', () => {
  it('English and Dutch shop texts', () => {
    expect(fabricFromProductText(['95% viscose, 5% elastaan'])).toEqual({ primary: 'viscose', blend: [['viscose', 95], ['elastane', 5]] });
    expect(fabricFromProductText(['98% organic cotton', '2% elastane'])).toEqual({ primary: 'cotton', blend: [['cotton', 98], ['elastane', 2]] });
    expect(fabricFromProductText(['Bovenstof: 100% linnen. Voering: 100% katoen'])).toEqual({ primary: 'linen', blend: [['linen', 100]] });
    expect(fabricFromProductText(['52% Polyester, 45% Viscose, 3% Elastaan'])).toEqual({ primary: 'polyester', blend: [['polyester', 52], ['viscose', 45], ['elastane', 3]] });
    expect(fabricFromProductText(['Organic cotton', 'Elastane'])).toEqual({ primary: 'cotton' });
    expect(fabricFromProductText(['', undefined, '100% merinowol'])).toEqual({ primary: 'merino', blend: [['wool', 100]] });
  });

  it('undefined when nothing is known', () => {
    expect(fabricFromProductText(['Handwas', 'Made in Portugal'])).toBeUndefined();
    expect(fabricFromProductText([])).toBeUndefined();
  });

  it('FABRIC_TEXT_FIELD recognises the attribute names shops use', () => {
    for (const name of ['Material', 'Materials', 'pa_materiaal', 'Materiaal', 'Samenstelling', 'Stof', 'Fabric composition', 'Composition']) expect(FABRIC_TEXT_FIELD.test(name), name).toBe(true);
    for (const name of ['Maat', 'Kleur', 'Size', 'Material care']) expect(FABRIC_TEXT_FIELD.test(name), name).toBe(false);
  });
});
