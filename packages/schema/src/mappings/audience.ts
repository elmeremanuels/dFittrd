/**
 * Audience (women / men / unisex) of a product from the data a shop already has: product type,
 * taxonomy or category path, tags, title words and collections, with a merchant override
 * (photo-avatar plan, slice 3 "Men v1"). The PHP twin is `Curtain\Vocab::infer_audience`; the
 * WooCommerce tests replay the cases exported from here, so keep the two in step.
 *
 * How it reads text: lower-cased, a possessive `'s` joined to its word ("men's" → `mens`), then
 * split into whole words on everything that is not a letter or a digit. A word is compared as a
 * whole, never as a substring: "women" is one word and does not contain the word "men".
 *
 * Sources, strongest first. The first source that says anything decides; a source that names both
 * men and women, or says "unisex", decides `unisex`.
 *   1. `override`    the merchant's own value (metafield / meta box). `none` switches inference off.
 *   2. `attribute`   a gender attribute the shop keeps (WooCommerce "Gender" / "Geslacht").
 *   3. `productType` Shopify product type.
 *   4. `category`    taxonomy path or category names ("Heren > Jeans").
 *   5. `tags`
 *   6. `title`       only unambiguous words: "man", "woman" and "lady" are not read from a title
 *                    ("Iron Man Tee", "Wonder Woman Hoodie").
 *   7. `collections` weakest: "Gifts for him" style collections hold anything.
 *
 * It is a guess from text and can be wrong ("Men in Black Tee" reads as men's). That is why the
 * override exists and why the result is only used for labels and the drawn figure, never for the
 * fit maths.
 */
import { GARMENT_AUDIENCES, type GarmentAudience } from '../garment';

export const AUDIENCE_SOURCES = ['override', 'attribute', 'productType', 'category', 'tags', 'title', 'collections'] as const;
export type AudienceSource = (typeof AUDIENCE_SOURCES)[number];

type Text = string | null | undefined;

export interface AudienceHints {
  /** Merchant value: women, men, unisex (or a synonym), or `none` to leave the audience out. */
  override?: unknown;
  /** Values of a gender attribute or option. */
  attribute?: readonly Text[];
  productType?: Text;
  /** Taxonomy paths or category names. */
  category?: readonly Text[];
  tags?: readonly Text[];
  title?: Text;
  /** Collection titles or handles. */
  collections?: readonly Text[];
}

export interface AudienceDecision {
  /** `undefined` only for the override `none`: the merchant wants no audience on the payload. */
  audience: GarmentAudience | undefined;
  source: AudienceSource;
}

/** Whole words that mean men's, in English, Dutch, German and French shop data. */
export const AUDIENCE_MEN_WORDS: readonly string[] = ['men', 'mens', 'menswear', 'male', 'males', 'gents', 'gentlemen', 'heren', 'mannen', 'herren', 'homme', 'hommes'];
/** Whole words that mean women's. */
export const AUDIENCE_WOMEN_WORDS: readonly string[] = ['women', 'womens', 'womenswear', 'female', 'females', 'ladies', 'dames', 'vrouwen', 'damen', 'femme', 'femmes'];
/** Read from structured fields (type, category, tags, attribute, collections, override), never from a title. */
export const AUDIENCE_MEN_STRUCTURED_WORDS: readonly string[] = ['man', 'heer'];
export const AUDIENCE_WOMEN_STRUCTURED_WORDS: readonly string[] = ['woman', 'lady', 'vrouw', 'dame'];
export const AUDIENCE_UNISEX_WORDS: readonly string[] = ['unisex', 'uniseks', 'genderneutral', 'genderneutraal', 'genderless'];
/** Dutch and German compounds put the audience first: `herenjeans`, `damesjas`, `herrenhemd`. */
export const AUDIENCE_MEN_PREFIXES: readonly string[] = ['heren', 'herren', 'mannen'];
export const AUDIENCE_WOMEN_PREFIXES: readonly string[] = ['dames', 'damen', 'vrouwen'];
/** Words that start like a compound but are not one: `herenhuis` (town house), `hereniging` (reunion). */
export const AUDIENCE_PREFIX_EXCEPTIONS: readonly string[] = ['herenhui', 'herenig'];
/** A men's or women's word followed by one of these describes a style, not the wearer ("menswear-inspired blazer"). */
export const AUDIENCE_STYLE_WORDS: readonly string[] = ['inspired'];
/** `gender` followed by one of these means unisex ("gender neutral", "gender-free"). */
export const AUDIENCE_GENDER_NEUTRAL_WORDS: readonly string[] = ['neutral', 'neutraal', 'neutrale', 'free'];
/** Override values that mean "leave the audience out". */
export const AUDIENCE_NONE_VALUES: readonly string[] = ['none', 'unspecified', 'not specified', 'n/a', '-'];

/** Text → whole words (see the file header). */
export function audienceWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’`´]s(?![\p{L}\p{N}])/gu, 's')
    .replace(/['’`´]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function isCompound(word: string, prefixes: readonly string[]): boolean {
  if (AUDIENCE_PREFIX_EXCEPTIONS.some((x) => word.startsWith(x))) return false;
  return prefixes.some((p) => word.length >= p.length + 3 && word.startsWith(p));
}

/**
 * What a list of texts from one source says. `structured` also reads the words that are too
 * ambiguous for a title ("man", "woman", "lady").
 */
export function audienceOfTexts(texts: readonly Text[], structured: boolean): GarmentAudience | undefined {
  let men = false;
  let women = false;
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    const words = audienceWords(text);
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const next = words[i + 1];
      if (AUDIENCE_UNISEX_WORDS.includes(w)) return 'unisex';
      if (w === 'gender' && next !== undefined && AUDIENCE_GENDER_NEUTRAL_WORDS.includes(next)) return 'unisex';
      if (next !== undefined && AUDIENCE_STYLE_WORDS.includes(next)) continue;
      if (AUDIENCE_MEN_WORDS.includes(w) || (structured && AUDIENCE_MEN_STRUCTURED_WORDS.includes(w)) || isCompound(w, AUDIENCE_MEN_PREFIXES)) men = true;
      else if (AUDIENCE_WOMEN_WORDS.includes(w) || (structured && AUDIENCE_WOMEN_STRUCTURED_WORDS.includes(w)) || isCompound(w, AUDIENCE_WOMEN_PREFIXES)) women = true;
    }
  }
  if (men && women) return 'unisex';
  if (men) return 'men';
  if (women) return 'women';
  return undefined;
}

/**
 * The merchant's override: an audience, `'none'` (leave it out, do not infer), or `undefined`
 * when the value is empty or not understood (inference then runs as if there were no override).
 */
export function coerceAudienceOverride(value: unknown): GarmentAudience | 'none' | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim().toLowerCase();
  if (t === '') return undefined;
  if ((GARMENT_AUDIENCES as readonly string[]).includes(t)) return t as GarmentAudience;
  if (AUDIENCE_NONE_VALUES.includes(t)) return 'none';
  return audienceOfTexts([t], true);
}

/** The audience and the source that decided it; `undefined` when nothing says anything. */
export function inferAudienceDecision(hints: AudienceHints): AudienceDecision | undefined {
  const override = coerceAudienceOverride(hints.override);
  if (override !== undefined) return { audience: override === 'none' ? undefined : override, source: 'override' };
  const steps: ReadonlyArray<[AudienceSource, readonly Text[], boolean]> = [
    ['attribute', hints.attribute ?? [], true],
    ['productType', [hints.productType], true],
    ['category', hints.category ?? [], true],
    ['tags', hints.tags ?? [], true],
    ['title', [hints.title], false],
    ['collections', hints.collections ?? [], true],
  ];
  for (const [source, texts, structured] of steps) {
    const audience = audienceOfTexts(texts, structured);
    if (audience) return { audience, source };
  }
  return undefined;
}

/** The audience for the payload, or `undefined` (leave the field out: nothing changes for that product). */
export function inferAudience(hints: AudienceHints): GarmentAudience | undefined {
  return inferAudienceDecision(hints)?.audience;
}

/** Attribute names that hold the audience in English, Dutch and German shops (WooCommerce attributes). */
export const AUDIENCE_ATTRIBUTE_FIELD = /^(?:pa_)?(?:gender|geslacht|sex|doelgroep|audience|department|afdeling|geschlecht|zielgruppe|target[-_ ]?(?:group|gender|audience))$/i;
