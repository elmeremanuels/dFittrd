import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_GARMENTS, mockGarment, type GarmentPayload } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { parseFeatures } from '../features';
import { DRAPE_TABLE_V0, FRICTION_SIGMA, PREDICTOR_VERSION, PROXY_DEFAULT_EASE, SIGMA, cutTokens, fabricKey, predict, predictMaterial, shrink, titleRules, type DrapeTable, type Exemplar, type Prediction, type PredictProduct } from './index';

const shopFile = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'bohohippychic', 'products.json'), 'utf8')) as {
  products: { handle: string; payload: GarmentPayload; baseSize: string; features?: unknown }[];
};
const shop = (h: string): PredictProduct => {
  const e = shopFile.products.find((p) => p.handle === h)!;
  return { id: h, payload: e.payload, baseSize: e.baseSize, features: parseFeatures(e.features) ?? null, source: { kind: 'shop' } };
};
const spike = (id: string): PredictProduct => ({ id, payload: mockGarment(id), baseSize: 'M', source: { kind: 'spike' } });
const HANDLES = ['azure-palm-baby-doll-dress', 'rosewater-blouse', 'rosewater-palazzo-pants', 'crimson-wildflower-maxi-skirt', 'woodstock-wanderer-knit-cardi'];

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

describe('predict (P0)', () => {
  it('is deterministic, pure (frozen input) and JSON-serialisable', () => {
    for (const h of HANDLES) {
      const p = shop(h);
      const frozen = deepFreeze(structuredClone(p));
      const a = predict(frozen);
      const b = predict(structuredClone(p));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      expect(a.predictorVersion).toBe(PREDICTOR_VERSION);
      expect(a.format).toBe('curtain.drape.prediction');
    }
  });

  it('always routes to the GPU in P0, with reasons, and never uses exemplars', () => {
    const ex = { productId: 'x', cell: 'dress|-|knee|fluid' } as unknown as Exemplar;
    for (const p of [...HANDLES.map(shop), spike('aalter-studio-2'), spike('monochrome-03')]) {
      const r = predict(p, DRAPE_TABLE_V0, [ex]);
      expect(r.route.decision).toBe('gpu');
      expect(r.route.designRoute).toBe('full');
      expect(r.route.reasons[0]).toMatch(/never skips a GPU run/);
      expect(r.exemplars).toMatchObject({ count: 1, used: 0 });
      expect(r.exemplars.setHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    }
    expect(predict(shop('rosewater-blouse')).exemplars.setHash).not.toBe(predict(shop('rosewater-blouse'), DRAPE_TABLE_V0, [{ productId: 'y' } as unknown as Exemplar]).exemplars.setHash);
  });

  it('carries the 0.3.0 proxy rules for the five run 15 products and the spike fixtures', () => {
    const r: Record<string, Prediction> = Object.fromEntries([...HANDLES.map((h) => [h, predict(shop(h))]), ...['aalter-studio-2', 'monochrome-03'].map((id) => [id, predict(spike(id))])]);
    expect(r['azure-palm-baby-doll-dress']!.pattern.hemFlare.value).toBe(1.35); // empire babydoll
    expect(r['crimson-wildflower-maxi-skirt']!.pattern.hemFlare.value).toBe(1.25); // a-line
    expect(r['aalter-studio-2']!.pattern.hemFlare.value).toBe(1.25);
    expect(r['rosewater-blouse']!.pattern.hemFlare.value).toBe(1.05);
    expect(r['rosewater-palazzo-pants']!.pattern.legs).toMatchObject({ thighOfHip: { value: 0.6 }, hemOfThigh: { value: 1.1 } });
    expect(r['azure-palm-baby-doll-dress']!.pattern.length.rule).toEqual({ from: 'printed', key: 'shoulder_to_hem', cm: 91, origin: 'hps', definition: 'hps_surface' });
    expect(r['rosewater-palazzo-pants']!.pattern.length.rule).toEqual({ from: 'printed', key: 'outseam', cm: 99, origin: 'waist', definition: 'drop' });
    expect(r['crimson-wildflower-maxi-skirt']!.pattern.length).toMatchObject({ rule: { from: 'landmark', at: ['ankle'], plusCm: 3 }, source: 'subcategory/pattern "maxi": just above the ankle' });
    expect(r['rosewater-blouse']!.pattern.sleeve.rule).toMatchObject({ from: 'style', style: 'half' });
    expect(r['woodstock-wanderer-knit-cardi']!.pattern.sleeve.rule).toMatchObject({ from: 'kind-default' });
    expect(r['woodstock-wanderer-knit-cardi']!.pattern.front).toEqual({ front: 'buttoned', neckline: 'deep-v' });
    expect(r['aalter-studio-2']!.pattern.sleeve.rule).toEqual({ from: 'printed', cm: 58 });
    for (const [, x] of Object.entries(r)) {
      for (const [ring, v] of Object.entries(x.pattern.defaultEase)) expect(v!.value, `${x.productId} ${ring}`).toBe((PROXY_DEFAULT_EASE[x.pattern.kind] as Record<string, number>)[ring]);
    }
  });

  it('extends the rules with title tokens only where the 0.3.0 words say nothing', () => {
    const base = mockGarment('aalter-studio-2');
    const { patternBlock: _b, subcategory: _s, ...rest } = base;
    const bare = { ...rest, lengthCm: {} } as GarmentPayload;
    const at = (name: string) => predict({ id: 'x', payload: { ...bare, name }, baseSize: 'M' });
    expect(at('Plain Dress').pattern.hemFlare).toMatchObject({ value: 1.1, provenance: 'default' });
    expect(at('Tiered Midi Dress').pattern.hemFlare).toMatchObject({ value: 1.35, provenance: 'rule' });
    expect(at('Tiered Midi Dress').pattern.length.source).toBe('title "midi": between knee and calf');
    expect(at('Smocked Sundress').pattern.hemFlare.value).toBe(1.35);
    expect(at('Silk Slip Dress').pattern.hemFlare.value).toBe(1);
    expect(at('Boho Maxi Dress').pattern.length.rule).toEqual({ from: 'landmark', at: ['ankle'], plusCm: 3 });
    // The pattern block wins over the title, as 0.3.0.
    expect(predict({ id: 'x', payload: { ...base, name: 'Tiered Slip Dress' }, baseSize: 'M' }).pattern.hemFlare.value).toBe(1.25);
    // Sleeve volume from the title: puff and batwing widen the upper arm, bell widens the cuff to the upper arm's ease.
    expect(at('Puff Sleeve Dress').pattern.defaultEase.upper_arm!.value).toBe(12);
    expect(at('Batwing Dress').pattern.defaultEase).toMatchObject({ upper_arm: { value: 20 }, wrist: { value: 20 } });
    expect(at('Bell Sleeve Dress').pattern.defaultEase).toMatchObject({ upper_arm: { value: 6 }, wrist: { value: 6 } });
    // Cropped top without a printed length: hem just above the waist.
    const top = mockGarment('monochrome-03');
    expect(predict({ id: 't', payload: { ...top, name: 'Cropped Tee', lengthCm: {} }, baseSize: 'M' }).pattern.length.rule).toEqual({ from: 'landmark', at: ['waist'], plusCm: 2 });
  });

  it('has no hand-set fabric multipliers on shape: the pattern parameters do not depend on the fabric at all', () => {
    for (const p of [...HANDLES.map(shop), spike('aalter-studio-2')]) {
      const base = predict(p).pattern;
      for (const fabric of [{ primary: 'silk', stretchPct: 0, drape: 0.95 }, { primary: 'denim', stretchPct: 2, drape: 0.1, weightGsm: 400 }, { primary: 'jersey', blend: [['cotton', 95], ['elastane', 5]] as [string, number][], stretchPct: 30, drape: 0.7 }]) {
        const other = predict({ ...p, payload: { ...p.payload, fabric } });
        expect(other.pattern, `${p.id} in ${fabric.primary}`).toEqual(base);
        expect(other.material.key.fibres).not.toEqual(predict(p).material.key.fibres); // the material did change
      }
    }
  });

  it('flags hard features (always GPU) and halves the confidence', () => {
    const p = { ...mockGarment('aalter-studio-2'), name: 'Ruffle Wrap Dress, lined' };
    const r = predict({ id: 'w', payload: p, baseSize: 'M' });
    expect(r.cut.hardFeatures).toEqual(['wrap', 'lined', 'ruffle']);
    expect(r.route.decision).toBe('gpu');
    expect(r.route.reasons.join(' ')).toMatch(/hard features.*wrap, lined, ruffle/);
    expect(r.confidence.value).toBeLessThan(predict({ id: 'w', payload: mockGarment('aalter-studio-2'), baseSize: 'M' }).confidence.value);
  });

  it('reads the cut tokens from the title, never the brand', () => {
    expect(cutTokens('Rosewater Palazzo Pants wide leg').tokens).toEqual(['wide-leg', 'palazzo']);
    const { patternBlock: _b, subcategory: _s, ...rest } = mockGarment('aalter-studio-2');
    const p = { ...rest, brand: 'Maxi Tiered Co', name: 'Dress' } as GarmentPayload;
    expect(predict({ id: 'b', payload: p, baseSize: 'M' }).cut.tokens).toEqual([]);
  });

  it('builds the exemplar cell key from kind, block, length band and fabric class', () => {
    expect(predict(shop('crimson-wildflower-maxi-skirt')).cell).toBe('skirt|a-line|maxi|fluid');
    expect(predict(shop('woodstock-wanderer-knit-cardi')).cell).toBe('outerwear|oversized|hip|medium-knit');
    expect(predict(shop('azure-palm-baby-doll-dress')).cell).toBe('dress|empire|above-knee|fluid'); // printed 91 cm flat-lay
    expect(predict(shop('rosewater-palazzo-pants')).cell).toBe('trousers|wide-leg|full|fluid'); // outseam 99 cm
    expect(predict(spike('aalter-studio-2')).cell).toBe('dress|a-line|midi|medium');
  });

  it('has no sizing output: no chart girth, no payload ease or stretch, no pattern block of its own', () => {
    const r = predict(shop('woodstock-wanderer-knit-cardi'));
    const keys = (x: unknown, out: string[] = []): string[] => {
      if (x && typeof x === 'object') {
        for (const [k, v] of Object.entries(x)) {
          out.push(k);
          keys(v, out);
        }
      }
      return out;
    };
    const all = keys(r);
    for (const banned of ['sizeChart', 'ease', 'criticalFitPoints', 'stretchZones', 'girths', 'girthsCm', 'recommendedSize', 'fit']) expect(all, banned).not.toContain(banned);
    expect(r.material.stretchPct.source).toMatch(/simulation only/);
  });
});

describe('provenance and σ say what is known (P0)', () => {
  const { patternBlock: _b, subcategory: _s, ...rest } = mockGarment('aalter-studio-2');
  const bare = { ...rest, lengthCm: {} } as GarmentPayload;

  it('labels global fallbacks default with the widest σ, word rules rule, printed values merchant', () => {
    const plain = predict({ id: 'x', payload: { ...bare, name: 'Plain Dress' }, baseSize: 'M' });
    expect(plain.pattern.length).toMatchObject({ provenance: 'default', sigmaCm: SIGMA.lengthDefault });
    expect(plain.pattern.length.offsetCm.provenance).toBe('default');
    for (const v of Object.values(plain.pattern.defaultEase)) expect(v).toMatchObject({ provenance: 'default', sigma: SIGMA.easeDefault });
    const midi = predict({ id: 'x', payload: { ...bare, name: 'Midi Dress' }, baseSize: 'M' });
    expect(midi.pattern.length).toMatchObject({ provenance: 'rule', sigmaCm: SIGMA.lengthWord });
    expect(predict(spike('aalter-studio-2')).pattern.length).toMatchObject({ provenance: 'merchant', sigmaCm: SIGMA.lengthPrinted });
    // Sleeves: printed (merchant), description style, outerwear default, none known (default), none for the kind (rule).
    expect(predict(spike('aalter-studio-2')).pattern.sleeve.provenance).toBe('merchant');
    expect(predict(shop('rosewater-blouse')).pattern.sleeve.provenance).toBe('description');
    expect(predict(shop('woodstock-wanderer-knit-cardi')).pattern.sleeve.provenance).toBe('default');
    expect(predict(shop('azure-palm-baby-doll-dress')).pattern.sleeve.provenance).toBe('default');
    expect(predict(shop('crimson-wildflower-maxi-skirt')).pattern.sleeve).toMatchObject({ provenance: 'rule', sigmaCm: 0 });
    // Trousers: the default leg is wider than a word rule.
    const trousers = { ...shop('rosewater-palazzo-pants') };
    const noLeg = predict({ ...trousers, payload: { ...trousers.payload, name: 'Pants', patternBlock: undefined, subcategory: undefined } as unknown as GarmentPayload });
    expect(noLeg.pattern.legs!.hemOfThigh).toMatchObject({ provenance: 'default', sigma: SIGMA.legDefault });
    expect(predict(trousers).pattern.legs!.hemOfThigh).toMatchObject({ provenance: 'rule', sigma: SIGMA.legRatio });
    expect(SIGMA.legDefault).toBeGreaterThan(SIGMA.legRatio);
    expect(SIGMA.easeDefault).toBeGreaterThan(SIGMA.easeWord);
  });

  it('derived material values are rules on their input (σ the larger of both), unit conversions keep the input', () => {
    const merchant = predictMaterial({ ...mockGarment('aalter-studio-2'), fabric: { primary: 'viscose', stretchPct: 3, drape: 0.8, weightGsm: 130 } }, 'merchant');
    expect(merchant.stretchPct).toMatchObject({ provenance: 'merchant', sigma: 0.1 });
    expect(merchant.stretchStiffness.warp).toMatchObject({ provenance: 'rule', sigma: 0.69 });
    expect(merchant.damping).toMatchObject({ provenance: 'rule', sigma: 0.69 });
    expect(merchant.shearStiffness).toMatchObject({ provenance: 'rule', sigma: 0.69 });
    expect(merchant.thicknessMm).toMatchObject({ provenance: 'rule', sigma: 0.69 });
    expect(merchant.massKgM2).toMatchObject({ provenance: 'merchant', sigma: 0.1 });
    expect(merchant.friction).toMatchObject({ provenance: 'rule', sigma: FRICTION_SIGMA.rule });
    const none = { ...mockGarment('aalter-studio-2') } as GarmentPayload;
    delete (none as Partial<GarmentPayload>).fabric;
    const d = predictMaterial(none, 'description');
    for (const v of [d.stretchStiffness.warp, d.damping, d.shearStiffness, d.thicknessMm, d.weightGsm]) expect(v).toMatchObject({ provenance: 'default', sigma: 1.39 });
    expect(d.friction).toMatchObject({ provenance: 'default', sigma: FRICTION_SIGMA.default });
    expect(FRICTION_SIGMA.default).toBeGreaterThan(FRICTION_SIGMA.rule);
  });

  it('a construction word without a fibre leaves the fabric unknown: route reason kept, confidence halved, fields from the word', () => {
    const skirt = shop('crimson-wildflower-maxi-skirt');
    const { fabric: _f, ...noFabric } = skirt.payload;
    const knit = predict({ ...skirt, payload: { ...noFabric, name: 'Chunky Knit Sweater Skirt' } as GarmentPayload });
    expect(knit.material.key).toMatchObject({ provenance: 'default', fibreKnown: false, construction: 'sweater-knit', constructionProvenance: 'description' });
    expect(knit.material.weightGsm.provenance).toBe('description');
    expect(knit.material.stretchStiffness.warp.provenance).toBe('rule');
    expect(knit.route.reasons.join(' ')).toMatch(/fabric unknown .*construction "sweater-knit" from the title/);
    expect(knit.confidence.reasons.join(' ')).toMatch(/fabric unknown: halved/);
    const known = predict({ ...skirt, payload: { ...skirt.payload, name: 'Chunky Knit Sweater Skirt' } });
    expect(known.material.key).toMatchObject({ fibreKnown: true, provenance: 'description' });
    expect(knit.confidence.value).toBeLessThan(known.confidence.value);
    expect(knit.cell.endsWith('-knit')).toBe(true); // the construction still sets the fabric class
  });

  it('says where a title token changed a 0.3.0 default (prediction note, proxy notes)', () => {
    const tiered = predict({ id: 'x', payload: { ...bare, name: 'Tiered Maxi Dress' }, baseSize: 'M' });
    expect(titleRules(tiered.pattern).map(([k]) => k)).toEqual(['hemFlare', 'length']);
    expect(tiered.notes.join(' ')).toMatch(/title tokens set shape defaults .*hemFlare, length/);
    for (const h of HANDLES) expect(titleRules(predict(shop(h)).pattern), h).toEqual([]);
  });
});

describe('material (P0 table)', () => {
  it('has provenance per field: merchant values for merchant data, description + library for a shop draft, default without a fabric', () => {
    const merchant = predictMaterial(mockGarment('aalter-studio-2'), 'merchant');
    expect(merchant.key.provenance).toBe('merchant');
    expect(merchant.weightGsm).toMatchObject({ value: 120, provenance: 'merchant' });
    expect(merchant.drape).toMatchObject({ value: 0.45, provenance: 'merchant' });
    const draft = predict(shop('rosewater-blouse')).material;
    expect(draft.key.provenance).toBe('description');
    expect(draft.weightGsm.provenance).toBe('library');
    expect(draft.bendStiffness.provenance).toBe('library');
    expect(draft.shearStiffness.provenance).toBe('rule');
    const none = { ...mockGarment('aalter-studio-2') } as GarmentPayload;
    delete (none as Partial<GarmentPayload>).fabric;
    const d = predictMaterial(none, 'description');
    expect(d.key.provenance).toBe('default');
    expect(d.bendStiffness.provenance).toBe('default');
    expect(d.bendStiffness.sigma!).toBeGreaterThan(draft.bendStiffness.sigma!);
    expect(predict({ id: 'n', payload: none, baseSize: 'M', source: { kind: 'shop' } }).route.reasons.join(' ')).toMatch(/fabric unknown/);
  });

  it('adds sweater-knit and crochet (the cardigan is a knit, not acrylic woven), with knit shear and friction', () => {
    const cardi = predict(shop('woodstock-wanderer-knit-cardi')).material;
    expect(cardi.key.construction).toBe('sweater-knit');
    expect(cardi.key.fibres).toEqual([{ id: 'acrylic', pct: 65 }, { id: 'wool', pct: 35 }]);
    expect(cardi.stretchPct.value).toBe(35);
    expect(cardi.friction.value).toBe(0.45);
    expect(cardi.shearStiffness.value / cardi.stretchStiffness.warp.value).toBeCloseTo(0.5, 6);
    expect(cardi.texture.value).toBe('knit-loop');
    const crochet = predict({ id: 'c', payload: { ...mockGarment('aalter-studio-2'), name: 'Crochet Maxi Dress', fabric: { primary: 'cotton', stretchPct: 0, drape: 0.5 } }, baseSize: 'M', source: { kind: 'shop' } }).material;
    expect(crochet.key.construction).toBe('crochet');
    expect(crochet.opacity.value).toBe(0.5);
    const viscose = predict(shop('rosewater-blouse')).material;
    expect(viscose.friction.value).toBe(0.3);
    expect(viscose.shearStiffness.value / viscose.stretchStiffness.warp.value).toBeCloseTo(0.1, 6);
    expect(fabricKey(mockGarment('aalter-studio-2'), 'merchant').construction).toBeNull();
  });

  it('a library construction in the payload wins over a title word (denim jeans are denim)', () => {
    const jeans = MOCK_GARMENTS.find((g) => g.fabric?.primary === 'denim');
    if (!jeans) return;
    expect(predictMaterial({ ...jeans, name: `${jeans.name} knit` }, 'merchant').key.construction).toBe('denim');
  });

  it('shrinks each level to its parent (empirical Bayes) and moves the values only when the table holds observations', () => {
    const z = { logB: 0, logStretch: 0, logShear: 0, logDamping: 0, friction: 0 };
    expect(shrink(z, [], 0.3, 0.5)).toEqual(z);
    const one = shrink(z, [{ ...z, logB: 1 }], 0.3, 0.5);
    expect(one.logB).toBeCloseTo(1 / 0.09 / (1 / 0.09 + 1 / 0.25), 9); // n·x̄/σ²_obs / (n/σ²_obs + 1/σ²_prior)
    const many = shrink(z, Array.from({ length: 50 }, () => ({ ...z, logB: 1 })), 0.3, 0.5);
    expect(many.logB).toBeGreaterThan(0.99);
    const base = predict(shop('rosewater-blouse')).material;
    const table: DrapeTable = { ...DRAPE_TABLE_V0, version: 'test-table', observations: [{ productId: 'azure', familyId: null, fibre: 'viscose', construction: 'woven', delta: { ...z, logB: Math.log(2) }, source: 'generated-static' }] };
    const cal = predict(shop('rosewater-blouse'), table).material;
    expect(cal.bendStiffness.provenance).toBe('calibrated');
    expect(cal.bendStiffness.value).toBeGreaterThan(base.bendStiffness.value);
    expect(cal.levels.map((l) => l.observations)).toEqual([1, 1, 1, 1]);
    // "A silk dress behaves roughly like a silk skirt": the skirt in the same fabric reads the same cell.
    expect(predict(shop('crimson-wildflower-maxi-skirt'), table).material.bendStiffness.value).toBe(cal.bendStiffness.value);
    // A cell with no observations falls back to its parents: the knit cardigan only moves by the global level.
    const knit = predict(shop('woodstock-wanderer-knit-cardi'), table).material;
    expect(knit.levels.map((l) => l.observations)).toEqual([1, 0, 0, 0]);
    expect(knit.bendStiffness.value / predict(shop('woodstock-wanderer-knit-cardi')).material.bendStiffness.value).toBeLessThan(cal.bendStiffness.value / base.bendStiffness.value);
  });
});
