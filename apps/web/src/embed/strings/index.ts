/**
 * The embed's single string lookup (DECISIONS.md D21: English first, translation packs later).
 *
 * Today there is one catalogue, English, and `EmbedLocale` is `'en'`. Nothing here reads the
 * browser language or the shop page's language: the embed asks for `EMBED_LOCALE`.
 *
 * Adding a pack later is two steps and no other code change:
 *   1. add `./<locale>.ts` exporting an `EmbedCatalogue` (TypeScript checks it has every string);
 *   2. register it in `CATALOGUES` below.
 * How a shopper's locale is then chosen is a product decision to take with the first pack.
 */
import { EN, type EmbedCatalogue } from './en';

export type { AvatarClaims, AvatarUi, EmbedCatalogue } from './en';

/** Registered catalogues, keyed by lower-case locale (`en`, later `nl`, `pt-br`, ...). */
const CATALOGUES = { en: EN } satisfies Record<string, EmbedCatalogue>;

export type EmbedLocale = keyof typeof CATALOGUES;

/** The locale the embed is shown in. D21: fixed, not derived from the browser or the shop page. */
export const EMBED_LOCALE: EmbedLocale = 'en';

/**
 * A lookup over a set of catalogues: the exact locale, else its language (`nl-BE` to `nl`), else
 * English. Exported so a test can prove the seam with a pack that is not shipped.
 */
export function createLookup<C>(catalogues: { en: C } & Record<string, C>): (locale?: string | null) => C {
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(catalogues, k);
  return (locale) => {
    const tag = (locale ?? 'en').trim().toLowerCase().replace(/_/g, '-');
    if (has(tag)) return catalogues[tag]!;
    const language = tag.split('-')[0]!;
    return has(language) ? catalogues[language]! : catalogues.en;
  };
}

const lookup = createLookup<EmbedCatalogue>(CATALOGUES);

/** The embed's strings. An unknown locale reads English. */
export function embedStrings(locale: EmbedLocale = EMBED_LOCALE): EmbedCatalogue {
  return lookup(locale);
}

/** The locales with a registered catalogue. */
export const embedLocales = (): string[] => Object.keys(CATALOGUES);
