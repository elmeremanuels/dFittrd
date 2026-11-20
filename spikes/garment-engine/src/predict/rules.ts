/**
 * P0 shape rules (docs/PREDICTION-ENGINE.md §4.3): the defaults that were scattered over `proxy.ts` 0.3.0
 * (`FLARE_RULES`, `LEG_RULES`, `PROXY_DEFAULT_EASE`, the hem and sleeve defaults of `hemFor`/`sleeveFor`),
 * extended by the cut tokens of `cut.ts` (tiered, slip, smock, puff/bell/flutter/batwing sleeve, cropped, and
 * maxi/midi/mini from the title). Each rule reads first the words 0.3.0 read (pattern block and subcategory),
 * then the title tokens. So a product whose pattern block or subcategory matched a 0.3.0 rule gets exactly its
 * 0.3.0 numbers; a product that fell through to a 0.3.0 default CHANGES when its title holds a token (e.g. a
 * "Tiered Maxi Dress" without block or subcategory: flare 1.1 → 1.35, hem knee → ankle + 3; "Puff Sleeve Dress":
 * upper-arm ease 6 → 12). Every value a title token set says so in its `source` (`title "…"`), `titleRules()` lists
 * them, and `proxy.ts` writes them into the proxy notes, so such a change is visible in the manifest.
 *
 * Fabric never enters here: there are no hand-set fabric multipliers on shape (§4.3). The material vector goes
 * to the simulation; how much of the cut's fullness shows is the solver's business.
 */
import type { AnchorRing } from '@curtain/anchors';
import type { GarmentPayload } from '@curtain/schema';
import type { GarmentFeatures, SleeveStyle } from '../features';
import { styleWords } from './cut';
import type { ArmFractions, CutToken, LengthBand, LengthRule, PatternParams, Predicted, ProxyKind, SleeveRule } from './types';

/** Ease (cm of girth) over the mannequin where the chart gives no value for a ring. A control choice, not chart data. */
export const PROXY_DEFAULT_EASE: Readonly<Record<ProxyKind, Partial<Record<AnchorRing, number>>>> = {
  dress: { chest: 6, underbust: 6, waist: 4, hip: 6, upper_arm: 6, wrist: 4 },
  skirt: { waist: 2, hip: 5 },
  trousers: { waist: 2, hip: 5, thigh: 3, knee: 6 },
  top: { chest: 8, underbust: 8, waist: 8, hip: 6, upper_arm: 6, wrist: 4 },
  outerwear: { chest: 12, underbust: 12, waist: 12, hip: 10, upper_arm: 8, wrist: 6 },
};

/** Hem girth over hip girth for a dress or skirt, by pattern block or subcategory word (first match wins); `smock` added in P0. */
export const FLARE_RULES: readonly [RegExp, number][] = [
  [/pencil|bodycon|sheath|column|slip|tube/i, 1.0],
  [/tier|full|circle|fit-and-flare|skater|babydoll|baby-doll|empire|peasant|smock/i, 1.35],
  [/a-line|aline|trapeze|swing|maxi/i, 1.25],
];
export const DEFAULT_FLARE = 1.1;
/** Top and outerwear: hem girth over hip girth (a straight hem just below the hip). */
export const UPPER_FLARE = 1.05;

/** Trouser leg shape by pattern block or subcategory word: thigh girth floor (share of the hip girth) and hem/thigh ratio. */
export const LEG_RULES: readonly [RegExp, { thighOfHip: number; hemOfThigh: number | 'ankle' }][] = [
  [/palazzo|wide|culotte|flare|bootcut|boot-cut|barrel/i, { thighOfHip: 0.6, hemOfThigh: 1.1 }],
  [/skinny|slim|tapered|legging|jogger|cigarette/i, { thighOfHip: 0, hemOfThigh: 'ankle' }],
];
export const DEFAULT_LEG = { thighOfHip: 0, hemOfThigh: 0.85 } as const;

/** Sleeve length per style word, along the arm (`proxy.ts` resolves it on mannequin M). */
export const SLEEVE_STYLE_ALONG: Readonly<Record<SleeveStyle, { along: ArmFractions; where: string }>> = {
  sleeveless: { along: { ua: 0, fa: 0, wrist: 0, plusCm: 0 }, where: 'no sleeve shell' },
  short: { along: { ua: 0.45, fa: 0, wrist: 0, plusCm: 0 }, where: 'about half the upper arm' },
  half: { along: { ua: 1, fa: 0, wrist: 0, plusCm: 3 }, where: 'just below the elbow' },
  'three-quarter': { along: { ua: 1, fa: 0.6, wrist: 0, plusCm: 0 }, where: 'between the elbow and the wrist' },
  long: { along: { ua: 0, fa: 0, wrist: 1, plusCm: 1.5 }, where: 'to the wrist' },
};
/** Outerwear without a sleeve length or a sleeve word: to the wrist. */
export const OUTERWEAR_SLEEVE: ArmFractions = { ua: 0, fa: 0, wrist: 1, plusCm: 1.5 };

/**
 * Sleeve volume from the title's sleeve word (P0 extension): ease (cm of girth) at the upper arm and at the wrist.
 * A bell sleeve's cuff is as wide as its upper arm (the proxy's sleeve never widens towards the cuff).
 */
export const SLEEVE_VOLUME_RULES: readonly [CutToken, { upper_arm?: number; wrist?: number | 'upper_arm' }][] = [
  ['batwing-sleeve', { upper_arm: 20, wrist: 'upper_arm' }],
  ['puff-sleeve', { upper_arm: 12 }],
  ['flutter-sleeve', { upper_arm: 10 }],
  ['bell-sleeve', { wrist: 'upper_arm' }],
];

/** σ (P0 priors, not yet calibrated by shadow mode). */
export const SIGMA = {
  /** Hem flare ratio from a rule word / from the default. */
  flareRule: 0.12,
  flareDefault: 0.2,
  legRatio: 0.1,
  /** The default leg (no leg word): wider than a word rule. */
  legDefault: 0.2,
  /** Ease (cm of girth): a title sleeve-volume word; the global default (`PROXY_DEFAULT_EASE`, nothing known: run 14's empire underbust measured 20 cm over a 6 cm default). */
  easeWord: 6,
  easeDefault: 8,
  /** Length, cm: printed (flat-lay reading), from a word, default. */
  lengthPrinted: 2,
  lengthWord: 6,
  lengthDefault: 10,
  sleevePrinted: 2,
  sleeveStyle: 4,
  sleeveDefault: 8,
} as const;

const r = <T>(value: T, sigma: number | null, provenance: Predicted['provenance'], source: string): Predicted<T> => ({ value, sigma, provenance, source });

/** The first rule whose pattern matches the 0.3.0 words, else the title tokens. */
function firstRule<T>(rules: readonly [RegExp, T][], p: Pick<GarmentPayload, 'subcategory' | 'patternBlock'>, tokens: readonly CutToken[]): { value: T; via: 'style' | 'title'; word: string } | null {
  const words = styleWords(p);
  for (const [re, v] of rules) {
    const m = re.exec(words);
    if (m) return { value: v, via: 'style', word: m[0] };
  }
  const tokenText = tokens.join(' ');
  for (const [re, v] of rules) {
    const m = re.exec(tokenText);
    if (m) return { value: v, via: 'title', word: m[0] };
  }
  return null;
}

/** Hem rule for a dress/skirt by length word: pattern/subcategory words first (0.3.0), then the title's maxi/midi/mini. */
function lengthByWord(p: Pick<GarmentPayload, 'subcategory' | 'patternBlock'>, tokens: readonly CutToken[], fallback: { rule: LengthRule; source: string }): { rule: LengthRule; source: string; band: LengthBand; word: boolean } {
  const words = styleWords(p);
  if (/maxi|floor|full-length/i.test(words)) return { rule: { from: 'landmark', at: ['ankle'], plusCm: 3 }, source: 'subcategory/pattern "maxi": just above the ankle', band: 'maxi', word: true };
  if (/midi|tea/i.test(words)) return { rule: { from: 'landmark', at: ['knee', 'calf'], plusCm: 0 }, source: 'subcategory/pattern "midi": between knee and calf', band: 'midi', word: true };
  if (/mini|short/i.test(words)) return { rule: { from: 'landmark', at: ['thigh', 'knee'], plusCm: 4 }, source: 'subcategory/pattern "mini": above the knee', band: 'mini', word: true };
  if (tokens.includes('maxi')) return { rule: { from: 'landmark', at: ['ankle'], plusCm: 3 }, source: 'title "maxi": just above the ankle', band: 'maxi', word: true };
  if (tokens.includes('midi')) return { rule: { from: 'landmark', at: ['knee', 'calf'], plusCm: 0 }, source: 'title "midi": between knee and calf', band: 'midi', word: true };
  if (tokens.includes('mini')) return { rule: { from: 'landmark', at: ['thigh', 'knee'], plusCm: 4 }, source: 'title "mini": above the knee', band: 'mini', word: true };
  return { ...fallback, band: 'knee', word: false };
}

/** Length band of a printed length (cm thresholds for an adult women's block; P0 rule, for the exemplar cell key only). */
export const PRINTED_BANDS: Readonly<Record<'shoulder_to_hem' | 'waist_to_hem' | 'outseam' | 'inseam', readonly [number, LengthBand][]>> = {
  shoulder_to_hem: [[55, 'cropped'], [70, 'hip'], [82, 'mini'], [95, 'above-knee'], [105, 'knee'], [118, 'midi'], [Infinity, 'maxi']],
  waist_to_hem: [[45, 'mini'], [55, 'above-knee'], [65, 'knee'], [80, 'midi'], [Infinity, 'maxi']],
  outseam: [[60, 'thigh'], [90, 'midi'], [Infinity, 'full']],
  inseam: [[30, 'thigh'], [65, 'midi'], [Infinity, 'full']],
};
export function printedBand(key: keyof typeof PRINTED_BANDS, cm: number): LengthBand {
  return PRINTED_BANDS[key].find(([below]) => cm < below)![1];
}

export interface LengthPrediction {
  rule: LengthRule;
  source: string;
  band: LengthBand;
  sigmaCm: number;
  provenance: Predicted['provenance'];
}

/** Where the hem goes (`proxy.ts` `hemFor` resolves it on the mannequin; an explicit synthetic-stills override wins there). */
export function lengthRule(p: GarmentPayload, kind: ProxyKind, tokens: readonly CutToken[]): LengthPrediction {
  const len = (p.lengthCm ?? {}) as Partial<Record<string, number>>;
  const printed = (key: 'shoulder_to_hem' | 'waist_to_hem' | 'outseam' | 'inseam', origin: 'hps' | 'waist' | 'crotch', source: string, definition: 'drop' | 'hps_surface' = 'drop'): LengthPrediction => ({
    rule: { from: 'printed', key, cm: len[key]!, origin, definition },
    source,
    band: printedBand(key, len[key]!),
    sigmaCm: SIGMA.lengthPrinted,
    provenance: 'merchant',
  });
  const word = (w: ReturnType<typeof lengthByWord>): LengthPrediction => ({ rule: w.rule, source: w.source, band: w.band, sigmaCm: w.word ? SIGMA.lengthWord : SIGMA.lengthDefault, provenance: w.word ? 'rule' : 'default' });
  const knee = { rule: { from: 'landmark', at: ['knee'], plusCm: 0 } as LengthRule, source: 'no length given: to the knee' };
  if (kind === 'trousers') {
    if (len.outseam !== undefined) return printed('outseam', 'waist', `outseam ${len.outseam} cm from the waist`);
    if (len.inseam !== undefined) return printed('inseam', 'crotch', `inseam ${len.inseam} cm from the crotch`);
    if (len.waist_to_hem !== undefined) return printed('waist_to_hem', 'waist', `waist_to_hem ${len.waist_to_hem} cm`);
    if (/short/i.test(styleWords(p))) return { rule: { from: 'landmark', at: ['thigh'], plusCm: -4 }, source: 'subcategory/pattern "short": mid thigh', band: 'thigh', sigmaCm: SIGMA.lengthWord, provenance: 'rule' };
    if (tokens.includes('cropped')) return { rule: { from: 'landmark', at: ['knee', 'calf'], plusCm: 0 }, source: 'title "cropped": between knee and calf', band: 'midi', sigmaCm: SIGMA.lengthWord, provenance: 'rule' };
    return { rule: { from: 'landmark', at: ['ankle'], plusCm: 1 }, source: 'no length given: full length to the ankle', band: 'full', sigmaCm: SIGMA.lengthDefault, provenance: 'default' };
  }
  if (kind === 'skirt') {
    if (len.waist_to_hem !== undefined) return printed('waist_to_hem', 'waist', `waist_to_hem ${len.waist_to_hem} cm`);
    if (len.outseam !== undefined) return printed('outseam', 'waist', `outseam ${len.outseam} cm from the waist`);
    return word(lengthByWord(p, tokens, knee));
  }
  if (len.shoulder_to_hem !== undefined) return printed('shoulder_to_hem', 'hps', `shoulder_to_hem ${len.shoulder_to_hem} cm (flat-lay: along the front from the HPS)`, 'hps_surface');
  if (len.waist_to_hem !== undefined) return printed('waist_to_hem', 'waist', `waist_to_hem ${len.waist_to_hem} cm`);
  if (kind === 'dress') return word(lengthByWord(p, tokens, knee));
  if (tokens.includes('cropped')) return { rule: { from: 'landmark', at: ['waist'], plusCm: 2 }, source: 'title "cropped": just above the waist', band: 'cropped', sigmaCm: SIGMA.lengthWord, provenance: 'rule' };
  return { rule: { from: 'landmark', at: ['hip'], plusCm: -3 }, source: 'no length given: just below the hip ring', band: 'hip', sigmaCm: SIGMA.lengthDefault, provenance: 'default' };
}

export interface SleevePrediction {
  rule: SleeveRule;
  style: SleeveStyle | null;
  source: string;
  sigmaCm: number;
  provenance: Predicted['provenance'];
}

/** Sleeve length rule (`proxy.ts` `sleeveFor` resolves it on the mannequin). */
export function sleeveRule(p: GarmentPayload, kind: ProxyKind, features: GarmentFeatures | undefined): SleevePrediction {
  const given = (p.lengthCm as Partial<Record<string, number>> | undefined)?.sleeve_length;
  if (kind === 'skirt' || kind === 'trousers') return { rule: { from: 'none' }, style: null, source: 'no sleeves for this kind', sigmaCm: 0, provenance: 'rule' };
  if (given !== undefined) return { rule: { from: 'printed', cm: given }, style: null, source: `sleeve_length ${given} cm`, sigmaCm: SIGMA.sleevePrinted, provenance: 'merchant' };
  if (features?.sleeve) {
    const s = SLEEVE_STYLE_ALONG[features.sleeve];
    return { rule: { from: 'style', style: features.sleeve, along: s.along, where: s.where }, style: features.sleeve, source: `no sleeve length given; sleeve style "${features.sleeve}" from the description: ${s.where}`, sigmaCm: SIGMA.sleeveStyle, provenance: 'description' };
  }
  if (kind === 'outerwear') return { rule: { from: 'kind-default', along: OUTERWEAR_SLEEVE, where: 'to the wrist' }, style: null, source: 'no sleeve length given: outerwear default, to the wrist', sigmaCm: SIGMA.sleeveDefault, provenance: 'default' };
  return { rule: { from: 'none' }, style: null, source: 'no sleeve length given: no sleeve shell (the bare arm stays in the control)', sigmaCm: SIGMA.sleeveDefault, provenance: 'default' };
}

/** Hem flare and trouser legs. */
export function flareRules(p: GarmentPayload, kind: ProxyKind, tokens: readonly CutToken[]): Pick<PatternParams, 'hemFlare' | 'legs'> {
  if (kind === 'trousers') {
    const hit = firstRule(LEG_RULES, p, tokens);
    const rule = hit?.value ?? DEFAULT_LEG;
    const why = hit ? `${hit.via === 'style' ? 'pattern/subcategory' : 'title'} "${hit.word}"` : 'default leg';
    const prov = hit ? 'rule' : 'default';
    const sigma = hit ? SIGMA.legRatio : SIGMA.legDefault;
    return {
      hemFlare: r(rule.hemOfThigh === 'ankle' ? null : rule.hemOfThigh, sigma, prov, `${why}: hem/thigh ${rule.hemOfThigh}`),
      legs: {
        thighOfHip: r(rule.thighOfHip, sigma, prov, `${why}: thigh girth at least ${rule.thighOfHip} × the hip girth`),
        hemOfThigh: r(rule.hemOfThigh, sigma, prov, `${why}: hem/thigh ${rule.hemOfThigh}`),
      },
    };
  }
  if (kind === 'dress' || kind === 'skirt') {
    const hit = firstRule(FLARE_RULES, p, tokens);
    if (hit) return { hemFlare: r(hit.value, SIGMA.flareRule, 'rule', `${hit.via === 'style' ? 'pattern/subcategory' : 'title'} "${hit.word}": hem/hip ${hit.value}`), legs: null };
    return { hemFlare: r(DEFAULT_FLARE, SIGMA.flareDefault, 'default', `no flare word: default hem/hip ${DEFAULT_FLARE}`), legs: null };
  }
  return { hemFlare: r(UPPER_FLARE, SIGMA.flareRule, 'rule', `${kind}: straight hem, hem/hip ${UPPER_FLARE}`), legs: null };
}

/** Default ease per ring (`PROXY_DEFAULT_EASE`), with the title's sleeve volume word. */
export function defaultEase(kind: ProxyKind, tokens: readonly CutToken[]): PatternParams['defaultEase'] {
  const out: PatternParams['defaultEase'] = {};
  for (const [ring, v] of Object.entries(PROXY_DEFAULT_EASE[kind]) as [AnchorRing, number][]) out[ring] = r(v, SIGMA.easeDefault, 'default', `PROXY_DEFAULT_EASE.${kind}.${ring} (global default: nothing known)`);
  if (kind === 'skirt' || kind === 'trousers') return out;
  const vol = SLEEVE_VOLUME_RULES.find(([t]) => tokens.includes(t));
  if (vol) {
    const [token, v] = vol;
    if (v.upper_arm !== undefined) out.upper_arm = r(v.upper_arm, SIGMA.easeWord, 'rule', `title "${token}": upper-arm ease ${v.upper_arm} cm`);
    if (v.wrist !== undefined) {
      const w = v.wrist === 'upper_arm' ? out.upper_arm!.value : v.wrist;
      out.wrist = r(w, SIGMA.easeWord, 'rule', `title "${token}": cuff as wide as the upper arm (${w} cm ease)`);
    }
  }
  return out;
}

/** The values a title token set (where the pattern block and subcategory said nothing): `[parameter, source]`. */
export function titleRules(pattern: Pick<PatternParams, 'hemFlare' | 'legs' | 'defaultEase' | 'length'>): [string, string][] {
  const out: [string, string][] = [];
  const isTitle = (src: string): boolean => /\btitle "/.test(src);
  if (isTitle(pattern.hemFlare.source)) out.push(['hemFlare', pattern.hemFlare.source]);
  if (pattern.legs && isTitle(pattern.legs.thighOfHip.source)) out.push(['legs', pattern.legs.thighOfHip.source]);
  for (const [ring, v] of Object.entries(pattern.defaultEase)) if (v && isTitle(v.source)) out.push([`defaultEase.${ring}`, v.source]);
  if (isTitle(pattern.length.source)) out.push(['length', pattern.length.source]);
  return out;
}
