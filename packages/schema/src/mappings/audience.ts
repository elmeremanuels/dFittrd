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
 *   6. `title`
 *   7. `collections` weakest: "Gifts for him" style collections hold anything.
 *
 * The singular words "man", "woman", "lady", "dame", "heer" and "vrouw" are names as often as they
 * are audiences ("Iron Man", "Isle of Man", "Lady Gaga", "Notre Dame"). They are read anywhere only
 * in the override and the gender attribute. In a product type, category, tag or collection they
 * count only when they are the whole value or a whole path segment ("Man", "Man > Jeans",
 * "gender:man"); in a title they are never read.
 *
 * Three more guards against a wrong answer:
 *  - a word after "not", "non", "niet", "geen", "nicht", "kein(e)" or "from" (up to two words back)
 *    is skipped: "not for men", "borrowed from the men";
 *  - a word followed by a style word is a style, not the wearer: "menswear-inspired", "men's fit";
 *  - a Dutch or German compound counts only when a clothing word follows the prefix
 *    (`herenjeans`, `damesjas`), so place names such as Herrenberg and Herentals are not read.
 *
 * It is still a guess from text and can be wrong ("Men in Black Tee" reads as men's). That is why
 * the override exists. A wrong `men` costs more since decision D20 (a men's product without a 3D
 * figure shows "Men's clothing: coming soon"): `isWeakAudienceSource` tells the caller when the
 * answer came from a title or a collection only, so a gate can ask the merchant to confirm first.
 *
 * Inference runs for every product on its next sync, also for products that existed before the
 * audience field: the field is optional in the schema, but a shop's payloads gain it wherever the
 * product data names an audience. The override `none` switches it off per product.
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
/**
 * Singular words that are often part of a name. Read anywhere in the override and the gender
 * attribute; in a product type, category, tag or collection only as the whole value or a whole
 * path segment; never in a title.
 */
export const AUDIENCE_MEN_STRUCTURED_WORDS: readonly string[] = ['man', 'heer'];
export const AUDIENCE_WOMEN_STRUCTURED_WORDS: readonly string[] = ['woman', 'lady', 'vrouw', 'dame'];
export const AUDIENCE_UNISEX_WORDS: readonly string[] = ['unisex', 'uniseks', 'genderneutral', 'genderneutraal', 'genderless'];
/** Dutch and German compounds put the audience first: `herenjeans`, `damesjas`, `herrenhemd`. */
export const AUDIENCE_MEN_PREFIXES: readonly string[] = ['heren', 'herren', 'mannen'];
export const AUDIENCE_WOMEN_PREFIXES: readonly string[] = ['dames', 'damen', 'vrouwen'];
/**
 * What must follow the prefix for a compound to count: the start of a clothing word. Without it
 * `herenhuis` (town house), `hereniging` (reunion), Herrenberg and Herentals (towns) would read
 * as men's. ASCII only (the PHP twin may run without mbstring).
 */
export const AUDIENCE_COMPOUND_TAILS: readonly string[] = [
  'jeans', 'jas', 'jack', 'hemd', 'overhemd', 'shirt', 'tshirt', 'broek', 'hose', 'trui', 'pullover', 'pulli', 'sweater', 'hoodie',
  'vest', 'weste', 'pak', 'anzug', 'kostuum', 'colbert', 'sakko', 'blazer', 'mantel', 'kleding', 'kleidung', 'bekleidung', 'mode',
  'fashion', 'schoen', 'schuh', 'laars', 'stiefel', 'sneaker', 'sandal', 'sandaal', 'onder', 'unter', 'ober', 'boven', 'sok', 'socke',
  'zwem', 'bade', 'short', 'bermuda', 'polo', 'top', 'blouse', 'bluse', 'jurk', 'kleid', 'rok', 'rock', 'legging', 'pyjama', 'nacht',
  'boxer', 'slip', 'regen', 'winter', 'zomer', 'sommer', 'sport', 'outdoor', 'ski', 'fleece', 'thermo', 'chino', 'pantalon', 'tas',
  'riem', 'muts', 'sjaal', 'schal', 'handschoen', 'handschuh', 'maat', 'afdeling', 'collectie', 'kollektion', 'artikel',
];
/** A men's or women's word followed by one of these describes a style, not the wearer ("menswear-inspired blazer", "men's fit"). */
export const AUDIENCE_STYLE_WORDS: readonly string[] = ['inspired', 'fit', 'style', 'styled', 'cut', 'look'];
/** A men's or women's word with one of these up to two words before it is skipped ("not for men", "borrowed from the men"). */
export const AUDIENCE_NEGATING_WORDS: readonly string[] = ['not', 'non', 'niet', 'geen', 'nicht', 'kein', 'keine', 'from'];
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
  for (const p of prefixes) {
    if (!word.startsWith(p)) continue;
    const rest = word.slice(p.length);
    if (AUDIENCE_COMPOUND_TAILS.some((t) => rest.startsWith(t))) return true;
  }
  return false;
}

/**
 * How one source reads the singular name-like words ("man", "woman", "lady", ...):
 * `anywhere` (override, gender attribute), `whole` (only as the whole value or a whole path
 * segment: product type, category, tags, collections) or `never` (title).
 */
export type AudienceSingularMode = 'anywhere' | 'whole' | 'never';

/** Path and prefix separators inside one value: "Man > Jeans", "Kleding/Heer", "gender:man", "Man, Sale". */
const SEGMENT_SPLIT = /[>/|:;,]+/;

/** What a list of texts from one source says. */
export function audienceOfTexts(texts: readonly Text[], singular: AudienceSingularMode): GarmentAudience | undefined {
  let men = false;
  let women = false;
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    for (const segment of text.split(SEGMENT_SPLIT)) {
      const words = audienceWords(segment);
      const readSingular = singular === 'anywhere' || (singular === 'whole' && words.length === 1);
      for (let i = 0; i < words.length; i++) {
        const w = words[i]!;
        const next = words[i + 1];
        if (AUDIENCE_UNISEX_WORDS.includes(w)) return 'unisex';
        if (w === 'gender' && next !== undefined && AUDIENCE_GENDER_NEUTRAL_WORDS.includes(next)) return 'unisex';
        if (next !== undefined && AUDIENCE_STYLE_WORDS.includes(next)) continue;
        if ((i >= 1 && AUDIENCE_NEGATING_WORDS.includes(words[i - 1]!)) || (i >= 2 && AUDIENCE_NEGATING_WORDS.includes(words[i - 2]!))) continue;
        if (AUDIENCE_MEN_WORDS.includes(w) || (readSingular && AUDIENCE_MEN_STRUCTURED_WORDS.includes(w)) || isCompound(w, AUDIENCE_MEN_PREFIXES)) men = true;
        else if (AUDIENCE_WOMEN_WORDS.includes(w) || (readSingular && AUDIENCE_WOMEN_STRUCTURED_WORDS.includes(w)) || isCompound(w, AUDIENCE_WOMEN_PREFIXES)) women = true;
      }
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
  return audienceOfTexts([t], 'anywhere');
}

/** The audience and the source that decided it; `undefined` when nothing says anything. */
export function inferAudienceDecision(hints: AudienceHints): AudienceDecision | undefined {
  const override = coerceAudienceOverride(hints.override);
  if (override !== undefined) return { audience: override === 'none' ? undefined : override, source: 'override' };
  const steps: ReadonlyArray<[AudienceSource, readonly Text[], AudienceSingularMode]> = [
    ['attribute', hints.attribute ?? [], 'anywhere'],
    ['productType', [hints.productType], 'whole'],
    ['category', hints.category ?? [], 'whole'],
    ['tags', hints.tags ?? [], 'whole'],
    ['title', [hints.title], 'never'],
    ['collections', hints.collections ?? [], 'whole'],
  ];
  for (const [source, texts, singular] of steps) {
    const audience = audienceOfTexts(texts, singular);
    if (audience) return { audience, source };
  }
  return undefined;
}

/** The audience for the payload, or `undefined` (leave the field out: nothing changes for that product). */
export function inferAudience(hints: AudienceHints): GarmentAudience | undefined {
  return inferAudienceDecision(hints)?.audience;
}

/** Sources that are guesses from free text: a title or a collection name. */
export const AUDIENCE_WEAK_SOURCES: readonly AudienceSource[] = ['title', 'collections'];

/**
 * True when the audience was read from a title or a collection only. A caller that hides
 * something for men's products (decision D20) should not do so on a weak source without the
 * merchant's confirmation; the override makes the answer strong.
 */
export function isWeakAudienceSource(source: AudienceSource): boolean {
  return AUDIENCE_WEAK_SOURCES.includes(source);
}

/** Attribute names that hold the audience in English, Dutch and German shops (WooCommerce attributes). */
export const AUDIENCE_ATTRIBUTE_FIELD = /^(?:pa_)?(?:gender|geslacht|sex|doelgroep|audience|department|afdeling|geschlecht|zielgruppe|target[-_ ]?(?:group|gender|audience))$/i;
