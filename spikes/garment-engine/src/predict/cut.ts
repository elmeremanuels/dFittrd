/**
 * The cut of a product as the predictor reads it: the proxy kind (category, and for bottoms "skirt"), and cut
 * tokens from the title, subcategory and pattern block (design §3.2 "Cut"). The tokens extend the shop parser's
 * `BLOCK_RULES` (`shop.ts`), which still sets the payload's `patternBlock` for the fit engine; the tokens are the
 * predictor's own and are never written to the payload (§2: a predicted block would change the size advice).
 */
import type { GarmentPayload } from '@curtain/schema';
import type { GarmentFeatures } from '../features';
import { HARD_FEATURES, type CutFeatures, type CutToken, type ProxyKind } from './types';

/** The proxy kind of a product: the category, and for bottoms the word "skirt" in subcategory or pattern block. */
export function proxyKind(p: Pick<GarmentPayload, 'category' | 'subcategory' | 'patternBlock'>): ProxyKind {
  switch (p.category) {
    case 'dress':
    case 'top':
    case 'outerwear':
      return p.category;
    case 'bottom':
      return /skirt|skort/i.test(`${p.subcategory ?? ''} ${p.patternBlock ?? ''}`) ? 'skirt' : 'trousers';
    default:
      throw new Error(`no control proxy for category ${p.category}`);
  }
}

/** The words the P0 shape rules read first: pattern block and subcategory (as `proxy.ts` 0.3.0 did). */
export const styleWords = (p: Pick<GarmentPayload, 'subcategory' | 'patternBlock'>): string => `${p.patternBlock ?? ''} ${p.subcategory ?? ''}`;

/** Cut tokens and the words that give them (first match per token; tested on title + subcategory + pattern block). */
export const TOKEN_RULES: readonly [RegExp, CutToken][] = [
  [/\bmaxi\b|floor[- ]length|full[- ]length/i, 'maxi'],
  [/\bmidi\b|tea[- ]length/i, 'midi'],
  [/\bmini\b/i, 'mini'],
  [/\btier(?:ed|s)?\b/i, 'tiered'],
  [/\bwrap\b/i, 'wrap'],
  [/\bslip\b/i, 'slip'],
  [/\bsmock(?:ed|ing)?\b|\bshirred\b/i, 'smock'],
  [/\bempire\b/i, 'empire'],
  [/\bbaby[- ]?doll\b/i, 'babydoll'],
  [/\ba[- ]?line\b/i, 'a-line'],
  [/\bshift\b/i, 'shift'],
  [/\bshirt\b|\bblouse\b/i, 'shirt'],
  [/\boversized?\b|\bslouchy\b/i, 'oversized'],
  [/\bboxy\b/i, 'boxy'],
  [/\bcrop(?:ped)?\b/i, 'cropped'],
  [/\bpuff(?:ed|y)?[- ]?sleeves?\b|\bpuff\b/i, 'puff-sleeve'],
  [/\bbell[- ]?sleeves?\b/i, 'bell-sleeve'],
  [/\bflutter[- ]?sleeves?\b/i, 'flutter-sleeve'],
  [/\bbatwing\b|\bdolman\b/i, 'batwing-sleeve'],
  [/\bwide[- ]?leg\b/i, 'wide-leg'],
  [/\bpalazzo\b/i, 'palazzo'],
  [/\bstraight[- ]?leg\b/i, 'straight-leg'],
  [/\btapered\b|\bjogger\b/i, 'tapered'],
  [/\bharem\b/i, 'harem'],
  [/\bjeans?\b/i, 'jeans'],
  [/\bbias\b/i, 'bias'],
  [/\blined\b/i, 'lined'],
  [/\bruffle[ds]?\b|\bfrill(?:s|ed|y)?\b/i, 'ruffle'],
  [/\bfringe[ds]?\b|\btassel(?:s|led)?\b/i, 'fringe'],
  [/\basymmetric(?:al)?\b|\bhandkerchief\b|\bhigh[- ]low\b/i, 'asymmetric-hem'],
  [/\bcut[- ]?outs?\b/i, 'cut-out'],
  [/\bcowl\b/i, 'cowl'],
  [/\bpeplum\b/i, 'peplum'],
  [/\bpatchwork\b/i, 'patchwork'],
  [/\bjumpsuit\b|\bplaysuit\b|\bromper\b/i, 'jumpsuit'],
];

export interface CutTokens {
  tokens: CutToken[];
  evidence: string[];
}

/** Tokens of a text, in `TOKEN_RULES` order. */
export function cutTokens(text: string): CutTokens {
  const tokens: CutToken[] = [];
  const evidence: string[] = [];
  for (const [re, token] of TOKEN_RULES) {
    const m = re.exec(text);
    if (m && !tokens.includes(token)) {
      tokens.push(token);
      evidence.push(`${token}: "${m[0]}"`);
    }
  }
  return { tokens, evidence };
}

/** The text the tokens are read from: the product name (title), subcategory and pattern block. Never the brand. */
export function cutText(p: Pick<GarmentPayload, 'name' | 'subcategory' | 'patternBlock'>): string {
  return `${p.name ?? ''} ${p.subcategory ?? ''} ${p.patternBlock ?? ''}`.replace(/-/g, ' ');
}

export function cutFeatures(p: GarmentPayload, features: GarmentFeatures | undefined): Omit<CutFeatures, 'lengthBand'> {
  const kind = proxyKind(p);
  const { tokens, evidence } = cutTokens(cutText(p));
  return {
    kind,
    category: p.category,
    patternBlock: p.patternBlock ?? null,
    subcategory: p.subcategory ?? null,
    tokens,
    tokenEvidence: evidence,
    hardFeatures: tokens.filter((t) => HARD_FEATURES.includes(t)),
    sleeveStyle: features?.sleeve ?? null,
    front: features?.front ?? null,
    neckline: features?.neckline ?? null,
    elasticWaist: (p.stretchZones ?? []).some((z) => /waistband|waist-tie/i.test(String(z))),
  };
}
