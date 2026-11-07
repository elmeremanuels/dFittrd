/**
 * `predict(product, table, exemplars)`: the P0 drape prediction of one product (docs/PREDICTION-ENGINE.md §4.1,
 * §4.3 P0). Pure and deterministic: no I/O, no clock, no mannequin (pattern parameters are in the mannequin's own
 * terms; `proxy.ts` resolves them on mannequin M), never mutates its inputs.
 *
 * P0 is rules only: exemplars are accepted and recorded (count and hash) but not used, and the route is always the
 * GPU. The control proxy (`proxy.ts`) and the stage 4t template (built from that proxy) read their shape defaults
 * from this output, so every default is explicit, versioned and testable.
 *
 * It has no sizing output (§2): no chart girth, no fit-engine ease, no payload stretch, no pattern block.
 */
import { FABRIC_LIBRARY_VERSION, type GarmentPayload } from '@curtain/schema';
import type { GarmentFeatures } from '../features';
import { cutFeatures } from './cut';
import { DRAPE_TABLE_V0, fabricClass, predictMaterial, type DrapeTable, type FabricOrigin } from './material';
import { SIGMA, defaultEase, flareRules, lengthRule, sleeveRule, titleRules } from './rules';
import type { Exemplar, Prediction, RegionUncertainty } from './types';

/** Bump on any change to a rule, a default, the material prior or the output format. */
export const PREDICTOR_VERSION = 'drape-prior-p0-0.2.0';

/**
 * A synthetic job's length override (`exportJob` with synthetic stills of a lofted dress or top): the frames show the
 * spike's synthetic garment, dropped vertically to its own shoulder-to-hem, so the control proxy and the stage 4t
 * template take that length instead of the predicted one. Recorded in the prediction (provenance `synthetic`, the old
 * rule kept in `overridden`) so prediction.json describes the shape the job actually used. Pure: returns a new prediction.
 */
export function withSyntheticLength(pr: Prediction, shoulderToHemCm: number, source: string): Prediction {
  const length: Prediction['pattern']['length'] = {
    rule: { from: 'printed', key: 'shoulder_to_hem', cm: shoulderToHemCm, origin: 'hps', definition: 'drop' },
    offsetCm: { value: 0, sigma: 0, provenance: 'synthetic', source: 'synthetic truth: no offset' },
    source,
    sigmaCm: 0,
    provenance: 'synthetic',
    overridden: { rule: pr.pattern.length.rule, source: pr.pattern.length.source, sigmaCm: pr.pattern.length.sigmaCm, provenance: pr.pattern.length.provenance },
  };
  return {
    ...pr,
    pattern: { ...pr.pattern, length },
    notes: [...pr.notes, `length overridden for synthetic stills: ${source}; the predicted rule was "${pr.pattern.length.source}" (pattern.length.overridden). Shadow rows on the length measure nothing`],
  };
}

/** What the predictor reads of a product: the payload (public product data), the base size, the description features, and whether the fabric was typed by the merchant or read from the shop's text. */
export interface PredictProduct {
  id: string;
  payload: GarmentPayload;
  baseSize: string;
  features?: GarmentFeatures | null;
  /** `shop`: the payload is the shop parser's draft (fabric from the description, numbers from the library); else merchant data. */
  source?: { kind: string };
}

/** FNV-1a, 32 bit, over a string (a pure, dependency-free set hash; not a security hash). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** JSON with sorted keys (undefined dropped), for hashing. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x as Record<string, unknown>)
      .filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x);
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const r2 = (x: number): number => Math.round(x * 100) / 100;
const region = (sigmaCm: number, reasons: string[]): RegionUncertainty => ({ sigmaCm: r2(sigmaCm), confidence: r2(clamp01(1 - sigmaCm / 5)), reasons });

export function predict(product: PredictProduct, table: DrapeTable = DRAPE_TABLE_V0, exemplars: readonly Exemplar[] = []): Prediction {
  const p = product.payload;
  const features = product.features ?? undefined;
  const cutBase = cutFeatures(p, features);
  const kind = cutBase.kind;
  const tokens = cutBase.tokens;
  const length = lengthRule(p, kind, tokens);
  const sleeve = sleeveRule(p, kind, features);
  const { hemFlare, legs } = flareRules(p, kind, tokens);
  const ease = defaultEase(kind, tokens);
  const origin: FabricOrigin = product.source?.kind === 'shop' ? 'description' : 'merchant';
  const material = predictMaterial(p, origin, table);
  const cut = { ...cutBase, lengthBand: length.band };
  const cell = `${kind}|${p.patternBlock ?? '-'}|${length.band}|${fabricClass(material)}`;

  // Region σ (cm of surface): P0 priors from the parameters' σ, not yet calibrated against shadow data (§7 V1).
  const hasBust = p.sizeChart.some((r) => r.bust !== undefined);
  const hasHip = p.sizeChart.some((r) => r.hip !== undefined);
  const hipRadius = 16; // ≈ 100 cm hip girth / 2π: turns a ratio σ into a radial cm σ
  const regions: Prediction['regions'] = {};
  if (kind !== 'skirt' && kind !== 'trousers') {
    regions.shoulders = region(1.5, ['template from the mannequin shoulder line; no pattern parameter in P0']);
    regions.bodice = region(hasBust ? 1 : 2, [hasBust ? 'chest pinned to the chart (D15)' : 'no bust in the chart: default ease']);
  }
  if (kind === 'dress' || kind === 'skirt') {
    const s = Math.hypot((hemFlare.sigma ?? SIGMA.flareDefault) * hipRadius, length.sigmaCm * 0.25);
    regions.skirt = region(s, [hemFlare.source, length.source, hasHip ? 'hip pinned to the chart where the block fits it' : 'no hip in the chart: default ease']);
  }
  if (kind === 'trousers') {
    const s = Math.hypot((legs?.hemOfThigh.sigma ?? SIGMA.legRatio) * 10, length.sigmaCm * 0.25);
    regions.legs = region(s, [legs?.hemOfThigh.source ?? '', length.source]);
  }
  if (sleeve.rule.from !== 'none') {
    const ua = ease.upper_arm?.sigma ?? SIGMA.easeDefault;
    regions.sleeves = region(Math.hypot(ua / (2 * Math.PI), sleeve.sigmaCm * 0.25), [sleeve.source, ease.upper_arm?.source ?? 'default upper-arm ease']);
  }

  const routeReasons = ['P0: rules only; P0 never skips a GPU run (design §4.3)'];
  if (cut.hardFeatures.length) routeReasons.push(`hard features outside the v1 pattern vocabulary: ${cut.hardFeatures.join(', ')} (§4.4: always GPU)`);
  if (material.key.provenance === 'default') {
    routeReasons.push(`fabric unknown (fibre provenance default${material.key.construction ? `; only the construction "${material.key.construction}" from the title` : ''}): GPU until the merchant confirms it (§6.4)`);
  }
  if (p.category === 'outerwear') routeReasons.push('outerwear: structured outerwear is on the high-risk list (§6.1)');

  const conf = Object.values(regions).map((x) => x!.confidence);
  const confReasons = ['P0 rule priors, uncalibrated (σ calibration comes from shadow mode, §7)'];
  let confidence = conf.length ? Math.min(...conf) : 0;
  if (material.key.provenance === 'default') {
    confidence *= 0.5;
    confReasons.push('fabric unknown: halved');
  }
  if (cut.hardFeatures.length) {
    confidence *= 0.5;
    confReasons.push('hard features: halved');
  }

  const sorted = [...exemplars].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  const notes: string[] = [];
  if (exemplars.length) notes.push(`${exemplars.length} exemplar(s) given; P0 does not use exemplars (P1 blends them)`);
  const fromTitle = titleRules({ hemFlare, legs, defaultEase: ease, length: { source: length.source } as Prediction['pattern']['length'] });
  if (fromTitle.length) notes.push(`title tokens set shape defaults where the pattern block and subcategory said nothing (proxy 0.3.0 used its defaults there): ${fromTitle.map(([k]) => k).join(', ')}`);
  if (origin === 'description') notes.push('fabric from the shop description; its weight/stretch/drape numbers in the payload are library defaults, not merchant values');

  return {
    format: 'curtain.drape.prediction',
    formatVersion: 1,
    predictorVersion: PREDICTOR_VERSION,
    tier: 'P0',
    drapeTableVersion: table.version,
    fabricLibraryVersion: FABRIC_LIBRARY_VERSION,
    exemplars: { count: exemplars.length, setHash: `fnv1a32:${fnv1a(canonical(sorted))}`, used: 0 },
    productId: product.id,
    payloadId: String(p.id),
    baseSize: product.baseSize,
    cut,
    cell,
    material,
    pattern: {
      kind,
      hemFlare,
      legs,
      defaultEase: ease,
      length: { rule: length.rule, offsetCm: { value: 0, sigma: length.sigmaCm, provenance: length.provenance, source: 'P0: no length offset (P1 learns the hang from exemplars)' }, source: length.source, sigmaCm: length.sigmaCm, provenance: length.provenance },
      sleeve: { rule: sleeve.rule, style: sleeve.style, source: sleeve.source, sigmaCm: sleeve.sigmaCm, provenance: sleeve.provenance },
      front: kind === 'outerwear' && (cut.front || cut.neckline) ? { front: cut.front, neckline: cut.neckline } : null,
      tiers: null,
      elasticWaist: cut.elasticWaist,
    },
    regions,
    route: { decision: 'gpu', designRoute: 'full', reasons: routeReasons },
    confidence: { value: r2(confidence), reasons: confReasons },
    notes,
  };
}
