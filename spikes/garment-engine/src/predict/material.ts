/**
 * Material model, P0 (docs/PREDICTION-ENGINE.md §4.2): the drape table is hierarchical, global → fibre →
 * construction → fibre × construction cell, in log space θ = (log B, log k_stretch, log k_shear, log damping, μ).
 * Its prior (v0) is the `@curtain/schema` fabric library with its resolution rules (`resolveFabric`), plus what
 * §4.2 adds to v0: shear stiffness (0.1 × stretch stiffness for wovens, 0.5 for knits), friction (0.3 woven, 0.45
 * knit, 0.25 satin) and the two constructions the library lacks, `sweater-knit` and `crochet`. Each level is an
 * empirical-Bayes offset from the library prior that shrinks to its parent level:
 *
 *   δ_level = (n·mean(δ_obs)/σ²_obs + δ_parent/σ²_prior) / (n/σ²_obs + 1/σ²_prior)
 *
 * so a level without observations is its parent, and "viscose skirt" reads the cell the viscose dresses calibrated.
 * `DRAPE_TABLE_V0` has no observations: every value is the library prior. Observations come from §5 calibration
 * (not built in P0); the shrinkage is implemented and tested so the table format is fixed now.
 *
 * Provenance per field: `merchant` (a value the merchant entered), `library` (the table's prior for a known fabric
 * key), `description` (the prior of a construction word read from the title when no fibre is known, e.g. "Chunky
 * Knit Skirt" without a fabric), `calibrated` (the table moved it), `rule` (a P0 derivation from another value:
 * stretch stiffness and damping from deriveFabricSimulation, shear from stretch stiffness, thickness from weight;
 * σ is the larger of the rule's own and its input's), `default` (nothing known: the library's default woven, with the
 * widest σ: an unknown fabric is uncertainty, not information). Unit conversions (mass from weight, B in N·m) keep
 * their input's provenance and σ.
 *
 * The key's provenance is the FIBRE's: a construction word alone ("knit") leaves it `default` (fibre unknown, the
 * route keeps its "fabric unknown" reason and the confidence stays halved); `constructionProvenance` says where the
 * construction came from.
 */
import {
  ELASTANE_STRETCH_PER_PCT,
  deriveFabricSimulation,
  isFabricConstructionId,
  lookupFabricId,
  resolveFabric,
  type FabricTexturePreset,
  type GarmentPayload,
  type ResolveFabricInput,
} from '@curtain/schema';
import type { MaterialPrediction, Predicted, Provenance } from './types';

export interface Theta {
  logB: number;
  logStretch: number;
  logShear: number;
  logDamping: number;
  friction: number;
}
const THETA_KEYS = ['logB', 'logStretch', 'logShear', 'logDamping', 'friction'] as const;
const ZERO: Theta = { logB: 0, logStretch: 0, logShear: 0, logDamping: 0, friction: 0 };

/** One calibration record (§5 step 4): the fitted θ minus the library prior θ of that product, per field. */
export interface DrapeObservation {
  productId: string;
  familyId: string | null;
  /** Main fibre (library id) and construction (library id, `sweater-knit`, `crochet`, or `woven`/`knit` when none is known). */
  fibre: string;
  construction: string;
  delta: Theta;
  source: 'generated-static' | 'merchant-video' | 'swatch';
}

export interface DrapeTable {
  version: string;
  /** σ of one observation and of a level's offset around its parent, log units (μ in its own units). */
  sigmaObs: number;
  sigmaPrior: number;
  observations: readonly DrapeObservation[];
}

export const DRAPE_TABLE_V0: DrapeTable = { version: 'drape-table-0.0.0', sigmaObs: 0.3, sigmaPrior: 0.5, observations: [] };

/** The constructions §4.2 adds to the v0 prior (estimates, docs/research/fabrics.md method; to be replaced by swatches). */
export const PREDICT_CONSTRUCTIONS = {
  'sweater-knit': { gsm: [200, 450], stretch: [20, 50], drape: 0.55, bendStiffness: 0.15, sheen: 0.05, opacity: 0.95, texture: 'knit-loop' as FabricTexturePreset, words: /\bknit(?:ted|wear)?\b|\bsweater\b|\bjumper\b|\bpullover\b/i },
  crochet: { gsm: [150, 400], stretch: [10, 30], drape: 0.5, bendStiffness: 0.12, sheen: 0.03, opacity: 0.5, texture: 'lace' as FabricTexturePreset, words: /\bcrochet(?:ed)?\b/i },
} as const;
export type PredictConstruction = keyof typeof PREDICT_CONSTRUCTIONS;

/** Constructions that are knits (shear 0.5 × stretch stiffness, friction 0.45). */
export const KNIT_CONSTRUCTIONS: ReadonlySet<string> = new Set(['jersey', 'molton', 'terry', 'fleece', 'french-terry', 'teddy', 'cashmere', 'merino', 'mesh', 'neoprene', 'pique', 'sweater-knit', 'crochet']);
const SATIN_CONSTRUCTIONS: ReadonlySet<string> = new Set(['satin']);
/** Bulk density (g/cm³) for the thickness estimate: wovens are denser than knits. */
const DENSITY = { woven: 0.5, knit: 0.25 } as const;

/** σ of a log-space value by provenance (P0 priors). */
const SIGMA_LOG: Readonly<Record<Provenance, number>> = {
  merchant: 0.1,
  video: 0.15,
  swatch: 0.1,
  calibrated: 0.3,
  description: 0.69,
  library: 0.69,
  rule: 0.69,
  exemplar: 0.5,
  regressor: 0.5,
  default: 1.39,
  synthetic: 0,
};

export interface FabricKey {
  composition: { fibre: string; pct: number }[];
  construction: string | null;
  /** The fibre's provenance: `default` when the payload has no fabric (a construction word does not make the fibre known). */
  provenance: Provenance;
  constructionProvenance: Provenance | null;
  source: string;
}

/** Where the payload's fabric came from: the merchant typed it (spike fixtures, the chart builder), or the shop parser read it from the description. */
export type FabricOrigin = 'merchant' | 'description';

/** The fabric key of a product: payload fibres and construction, else a construction word from the title (knit, crochet). */
export function fabricKey(p: GarmentPayload, origin: FabricOrigin): FabricKey {
  const f = p.fabric as GarmentPayload['fabric'] | undefined;
  const text = `${p.name ?? ''} ${p.subcategory ?? ''}`;
  const wordConstruction = (Object.entries(PREDICT_CONSTRUCTIONS) as [PredictConstruction, (typeof PREDICT_CONSTRUCTIONS)[PredictConstruction]][]).find(([, e]) => e.words.test(text))?.[0] ?? null;
  if (!f || !f.primary) {
    return {
      composition: [],
      construction: wordConstruction,
      provenance: 'default',
      constructionProvenance: wordConstruction ? 'description' : null,
      source: wordConstruction ? `no fabric (fibre unknown); construction "${wordConstruction}" from the title` : 'no fabric in the payload: library default',
    };
  }
  const primaryId = lookupFabricId(f.primary);
  const fromPrimary = primaryId && isFabricConstructionId(primaryId) ? primaryId : null;
  const construction = fromPrimary ?? wordConstruction;
  const composition = (f.blend ?? [[f.primary, 100]]).map(([fibre, pct]) => ({ fibre, pct }));
  const what = `${composition.map((c) => `${c.fibre} ${c.pct} %`).join(', ')}${construction ? `, ${construction}` : ''}`;
  return {
    composition,
    construction,
    provenance: origin,
    constructionProvenance: fromPrimary ? origin : wordConstruction ? 'description' : null,
    source: `${origin === 'merchant' ? 'merchant fabric' : 'fabric read from the shop description'}: ${what}${!fromPrimary && wordConstruction ? ` (construction "${wordConstruction}" from the title)` : ''}`,
  };
}

/** Empirical-Bayes offset of one level from its parent (per θ component). */
export function shrink(parent: Theta, obs: readonly Theta[], sigmaObs: number, sigmaPrior: number): Theta {
  if (!obs.length) return { ...parent };
  const out = { ...parent };
  const n = obs.length;
  for (const k of THETA_KEYS) {
    const mean = obs.reduce((a, o) => a + o[k], 0) / n;
    out[k] = ((n * mean) / sigmaObs ** 2 + parent[k] / sigmaPrior ** 2) / (n / sigmaObs ** 2 + 1 / sigmaPrior ** 2);
  }
  return out;
}

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/** σ of friction (its own units) by provenance: a construction rule, the global default (nothing known), calibrated. */
export const FRICTION_SIGMA = { rule: 0.1, default: 0.2, calibrated: 0.1 } as const;
const mid = (r: readonly [number, number]): number => (r[0] + r[1]) / 2;

/**
 * The material vector of a product (§4.1): the library prior for its fabric key, merchant values winning, moved
 * by the table's calibrated offset of its cell when the table holds observations.
 */
export function predictMaterial(p: GarmentPayload, origin: FabricOrigin, table: DrapeTable = DRAPE_TABLE_V0): MaterialPrediction {
  const key = fabricKey(p, origin);
  const f = p.fabric as GarmentPayload['fabric'] | undefined;
  // Only merchant data are product values; a shop parser fills weight/stretch/drape from the library (its evidence says so),
  // so they are not passed on as product values (they equal the prior anyway).
  const merchant = origin === 'merchant' && f ? f : undefined;
  const extra = key.construction && key.construction in PREDICT_CONSTRUCTIONS ? PREDICT_CONSTRUCTIONS[key.construction as PredictConstruction] : null;
  const input: ResolveFabricInput = {
    ...(key.composition.length ? { composition: key.composition } : {}),
    ...(key.construction && !extra ? { construction: key.construction } : {}),
    ...(merchant?.weightGsm !== undefined ? { weightGsm: merchant.weightGsm } : {}),
    ...(merchant?.stretchPct !== undefined ? { stretchPct: merchant.stretchPct } : {}),
    ...(merchant?.drape !== undefined ? { drape: merchant.drape } : {}),
    ...(merchant?.sheen !== undefined ? { sheen: merchant.sheen } : {}),
    ...(merchant?.opacity !== undefined ? { opacity: merchant.opacity } : {}),
  };
  const res = resolveFabric(input);
  // The two constructions the library lacks override the blend as a library construction would (resolveFabric's rule),
  // elastane adds its stretch, merchant values win.
  let weightGsm = res.weightGsm, stretchPct = res.stretchPct, drape = res.drape, bend = res.bendStiffness, sheen = res.sheen, opacity = res.opacity;
  let texture: string = res.texture;
  const prov: Record<'weightGsm' | 'stretchPct' | 'drape' | 'bendStiffness' | 'sheen' | 'opacity' | 'texture', Provenance> = {} as never;
  const fibreKnown = key.provenance !== 'default';
  // Fields of the prior: the library's for a known fibre; a construction word's (read from the title) without one; else the default.
  const known: Provenance = fibreKnown ? 'library' : key.construction ? 'description' : 'default';
  for (const k of ['weightGsm', 'stretchPct', 'drape', 'bendStiffness', 'sheen', 'opacity', 'texture'] as const) prov[k] = res.provenance[k] === 'product' ? 'merchant' : res.provenance[k] === 'default' ? 'default' : known;
  if (extra) {
    const w = mid(extra.gsm);
    weightGsm = merchant?.weightGsm ?? Math.round(w);
    bend = round(extra.bendStiffness * (merchant?.weightGsm !== undefined ? Math.min(4, Math.max(0.25, (merchant.weightGsm / w) ** 2)) : 1), 4);
    stretchPct = merchant?.stretchPct ?? round(Math.min(100, mid(extra.stretch) + res.elastanePct * ELASTANE_STRETCH_PER_PCT), 1);
    drape = merchant?.drape ?? extra.drape;
    sheen = merchant?.sheen ?? extra.sheen;
    opacity = merchant?.opacity ?? extra.opacity;
    texture = extra.texture;
    for (const k of ['weightGsm', 'stretchPct', 'drape', 'bendStiffness', 'sheen', 'opacity', 'texture'] as const) if (prov[k] !== 'merchant') prov[k] = fibreKnown ? 'library' : 'description';
  }
  const sim = deriveFabricSimulation({ weightGsm, stretchPct, drape, bendStiffness: bend });
  const construction = key.construction;
  const knit = (construction !== null && KNIT_CONSTRUCTIONS.has(construction)) || texture.startsWith('knit');
  const satin = (construction !== null && SATIN_CONSTRUCTIONS.has(construction)) || texture === 'satin-weave';
  const shearRatio = knit ? 0.5 : 0.1;
  const friction = satin ? 0.25 : knit ? 0.45 : 0.3;

  // The table: offsets of the levels on the product's path, shrunk level by level.
  const fibres = res.fibres;
  const mainFibre = fibres.find((x) => x.id !== 'elastane')?.id ?? fibres[0]?.id ?? 'unknown';
  const cKey = construction ?? (knit ? 'knit' : 'woven');
  const obsAt = (pred: (o: DrapeObservation) => boolean): Theta[] => table.observations.filter(pred).map((o) => o.delta);
  const levels: MaterialPrediction['levels'] = [];
  let delta = ZERO;
  const steps: [MaterialPrediction['levels'][number]['level'], string, (o: DrapeObservation) => boolean][] = [
    ['global', '*', () => true],
    ['fibre', mainFibre, (o) => o.fibre === mainFibre],
    ['construction', cKey, (o) => o.construction === cKey],
    ['cell', `${mainFibre}×${cKey}`, (o) => o.fibre === mainFibre && o.construction === cKey],
  ];
  for (const [level, k, pred] of steps) {
    const obs = obsAt(pred);
    delta = shrink(delta, obs, table.sigmaObs, table.sigmaPrior);
    levels.push({ level, key: k, observations: obs.length });
  }
  const calibrated = table.observations.length > 0 && (fibreKnown || construction !== null);
  // exp(0) = 1 exactly: without observations every value is the prior to the bit.
  const scale = (x: number, d: number): number => (calibrated && d !== 0 ? x * Math.exp(d) : x);
  const bendCal = scale(bend, delta.logB);
  const stretchStiff = scale(sim.stretchStiffness, delta.logStretch);
  const shear = scale(sim.stretchStiffness * shearRatio, delta.logShear);
  const damping = scale(sim.damping, delta.logDamping);
  const mu = calibrated ? friction + delta.friction : friction;
  /**
   * `field`: the prior field the value is (or converts) from. `derived`: the value is a P0 rule applied to that field
   * (provenance `rule`, σ the larger of the rule's and the input's; `default` stays `default`).
   */
  const pv = (v: number, field: keyof typeof prov, source: string, derived = false, d = 0): Predicted => {
    const input = prov[field];
    // Only bend stiffness (never a merchant field) and the derived stiffnesses and damping carry a table offset.
    if (calibrated && d !== 0) return { value: v, sigma: SIGMA_LOG.calibrated, provenance: 'calibrated', source };
    if (!derived) return { value: v, sigma: SIGMA_LOG[input], provenance: input, source };
    const provenance: Provenance = input === 'default' ? 'default' : 'rule';
    return { value: v, sigma: Math.max(SIGMA_LOG.rule, SIGMA_LOG[input]), provenance, source };
  };
  const tableSrc = calibrated ? `; ${table.version} offsets ${levels.map((l) => `${l.level} ${l.observations}`).join(', ')}` : '';
  const thicknessMm = round(weightGsm / (knit ? DENSITY.knit : DENSITY.woven) / 1000, 2);
  return {
    key: { fibres: fibres.map((x) => ({ id: x.id, pct: x.pct })), fibreKnown, construction, constructionProvenance: key.constructionProvenance, provenance: key.provenance, source: key.source, cell: `${mainFibre}×${cKey}` },
    weightGsm: pv(weightGsm, 'weightGsm', 'weightGsm'),
    massKgM2: pv(sim.massKgM2, 'weightGsm', 'weightGsm / 1000'),
    stretchPct: pv(stretchPct, 'stretchPct', 'simulation only, never the payload (fit engine) value'),
    stretchStiffness: { warp: pv(stretchStiff, 'stretchPct', `deriveFabricSimulation: 600 N/m / strain (rule on stretchPct)${tableSrc}`, true, delta.logStretch), weft: pv(stretchStiff, 'stretchPct', 'isotropic in P0 (warp = weft)', true, delta.logStretch) },
    shearStiffness: pv(shear, 'stretchPct', `${shearRatio} × stretch stiffness (${knit ? 'knit' : 'woven'}, §4.2)${tableSrc}`, true, delta.logShear),
    bendStiffness: pv(round(bendCal, 4), 'bendStiffness', `KES-F B, gf·cm²/cm${tableSrc}`, false, delta.logB),
    bendStiffnessNm: pv(Number((bendCal * 9.80665e-5).toPrecision(4)), 'bendStiffness', 'B × 9.80665e-5', false, delta.logB),
    damping: pv(damping, 'drape', `deriveFabricSimulation: 0.02 + 0.1 × (1 − drape) (rule on drape)${tableSrc}`, true, delta.logDamping),
    friction: frictionPredicted(round(mu, 3), calibrated && delta.friction !== 0 ? 'calibrated' : fibreKnown || construction !== null ? 'rule' : 'default', `cloth on body: ${satin ? 'satin 0.25' : knit ? 'knit 0.45' : 'woven 0.3'} (§4.2)${tableSrc}`),
    thicknessMm: pv(thicknessMm, 'weightGsm', `weightGsm / ${knit ? DENSITY.knit : DENSITY.woven} g/cm³ (${knit ? 'knit' : 'woven'} bulk density, estimate)`, true),
    drape: pv(drape, 'drape', '1 − Cusick drape coefficient'),
    sheen: pv(sheen, 'sheen', 'look'),
    opacity: pv(opacity, 'opacity', 'look'),
    texture: { value: texture, sigma: null, provenance: prov.texture, source: 'surface texture preset' },
    theta: { logB: Math.log(bendCal), logStretch: Math.log(stretchStiff), logShear: Math.log(shear), logDamping: Math.log(damping), friction: mu },
    levels,
  };
}

const frictionPredicted = (value: number, provenance: 'calibrated' | 'rule' | 'default', source: string): Predicted => ({ value, sigma: FRICTION_SIGMA[provenance], provenance, source });

/** Fabric class of the exemplar cell key (§4.3): fluid / medium / crisp by drape, `-knit` for knits; `unknown` for the default fabric (no fibre and no construction word). */
export function fabricClass(m: MaterialPrediction): string {
  if (!m.key.fibreKnown && m.key.construction === null) return 'unknown';
  const d = m.drape.value;
  const cls = d >= 0.7 ? 'fluid' : d <= 0.35 ? 'crisp' : 'medium';
  const c = m.key.construction;
  const knit = (c !== null && KNIT_CONSTRUCTIONS.has(c)) || m.texture.value.startsWith('knit');
  return knit ? `${cls}-knit` : cls;
}
