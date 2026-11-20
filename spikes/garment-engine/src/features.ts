/**
 * Garment construction the size chart cannot say: sleeve style, front closure and neckline, read from
 * a shop description's own words (never guessed from a photo). GarmentPayload v1 has no field for them,
 * so they sit beside the payload in products.json (`features`), like the base size.
 *
 * The control proxy (`proxy.ts`) and the neutral stage 2 prompt (`product.ts` `videoPrompt`) use them:
 * a blouse with "half sleeves" gets sleeve shells to below the elbow (without them the control video
 * shows bare arms and stage 1b's fixed sleeve band cuts a sleeve longer than it), and a cardigan with
 * a "deep V neckline" or an "open front" gets a front opening in its proxy, so the control video and the
 * stage 1b target keep it open instead of a closed jumper.
 *
 * Only words of the garment's own construction count: "pair it with the Luna Cami" or "thrown over a
 * lace cami" name another garment and say nothing about this one's sleeves.
 */
import type { GarmentCategory } from '@curtain/schema';

export const FEATURES_VERSION = 'garment-features-0.1.0';

export const SLEEVE_STYLES = ['sleeveless', 'short', 'half', 'three-quarter', 'long'] as const;
export type SleeveStyle = (typeof SLEEVE_STYLES)[number];
/** `open`: the fronts hang apart to the hem (open-front cardigan, kimono, duster); `buttoned`: a button or zip front, worn closed below the neckline. */
export type FrontClosure = 'open' | 'buttoned';
export type Neckline = 'v' | 'deep-v';

export interface GarmentFeatures {
  version: typeof FEATURES_VERSION;
  sleeve?: SleeveStyle;
  front?: FrontClosure;
  neckline?: Neckline;
  /** The phrases each feature was read from. */
  evidence: string[];
}

const SLEEVE_RULES: readonly [RegExp, SleeveStyle][] = [
  [/\bsleeveless\b|\bstrapless\b|\bspaghetti straps?\b/i, 'sleeveless'],
  [/\b(?:three[- ]quarter|3\/4)[- ]sleeve/i, 'three-quarter'],
  [/\b(?:half|elbow[- ]length)[- ]sleeve/i, 'half'],
  [/\b(?:short|cap)[- ]sleeve/i, 'short'],
  [/\blong[- ]sleeve/i, 'long'],
];
const OPEN_FRONT = /\bopen[- ]front\b|\bworn open\b|\bedge[- ]to[- ]edge\b/i;
const BUTTON_FRONT = /\bbutton(?:ed)?[- ](?:down[- ])?front\b|\bbutton[- ]through\b|\bbutton[- ]up\b|\bzip[- ]front\b/i;
const DEEP_V = /\bdeep[- ]v(?:[- ]?neck(?:line)?)?\b|\bplunging[- ]v\b|\bplunge neck/i;
const V_NECK = /\bv[- ]?neck(?:line)?\b/i;

/**
 * The garment's sleeve style, front closure and neckline from its description text. Sleeve words are
 * read for garments with a top half (dress, top, outerwear) only; the front closure and neckline for the
 * same. `undefined` fields: the text does not say.
 */
export function garmentFeatures(text: string, category: GarmentCategory | undefined): GarmentFeatures {
  const out: GarmentFeatures = { version: FEATURES_VERSION, evidence: [] };
  if (category !== 'dress' && category !== 'top' && category !== 'outerwear') return out;
  for (const [re, style] of SLEEVE_RULES) {
    const m = re.exec(text);
    if (m) {
      out.sleeve = style;
      out.evidence.push(`sleeve ${style}: "${m[0]}"`);
      break;
    }
  }
  const open = OPEN_FRONT.exec(text);
  const button = BUTTON_FRONT.exec(text);
  if (open) {
    out.front = 'open';
    out.evidence.push(`front open: "${open[0]}"`);
  } else if (button) {
    out.front = 'buttoned';
    out.evidence.push(`front buttoned: "${button[0]}"`);
  }
  const deep = DEEP_V.exec(text);
  const v = V_NECK.exec(text);
  if (deep) {
    out.neckline = 'deep-v';
    out.evidence.push(`neckline deep V: "${deep[0]}"`);
  } else if (v) {
    out.neckline = 'v';
    out.evidence.push(`neckline V: "${v[0]}"`);
  }
  return out;
}

/** Features read back from products.json (data, not code): unknown values are dropped, never trusted. */
export function parseFeatures(x: unknown): GarmentFeatures | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const out: GarmentFeatures = { version: FEATURES_VERSION, evidence: Array.isArray(o.evidence) ? o.evidence.filter((e): e is string => typeof e === 'string') : [] };
  if ((SLEEVE_STYLES as readonly unknown[]).includes(o.sleeve)) out.sleeve = o.sleeve as SleeveStyle;
  if (o.front === 'open' || o.front === 'buttoned') out.front = o.front;
  if (o.neckline === 'v' || o.neckline === 'deep-v') out.neckline = o.neckline;
  return out;
}
