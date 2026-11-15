/**
 * The SDK's single string lookup (DECISIONS.md D21: English first, translation packs later).
 *
 * Today there is one catalogue, English. `pickStrings` reads no page language and no browser
 * language: `<html lang="nl">` and a Dutch browser both get English, and so does `data-locale`
 * with a locale that has no catalogue.
 *
 * Adding a pack later is two steps and no other code change:
 *   1. add `./strings/<locale>.ts` exporting a `Strings` table (TypeScript checks it is complete);
 *   2. register it in `STRINGS` below.
 */
import { EN, type Strings } from './strings/en';

export { ESTIMATE_DISCLAIMER } from './strings/en';
export type { Strings } from './strings/en';

/** Registered catalogues, keyed by lower-case locale (`en`, later `nl`, `pt-br`, ...). */
export const STRINGS = { en: EN } satisfies Record<string, Strings>;

/** The locales with a catalogue. Today: `'en'`. */
export type SdkLocale = keyof typeof STRINGS;

/**
 * A lookup over a set of catalogues: the exact locale, else its language (`nl-BE` to `nl`), else
 * English. Exported so a test can prove the seam with a pack that is not shipped.
 */
export function createLookup<C>(catalogues: { en: C } & Record<string, C>): (locale?: string | null) => C {
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(catalogues, k);
  return (locale) => {
    const tag = (locale || 'en').trim().toLowerCase().replace(/_/g, '-');
    if (has(tag)) return catalogues[tag]!;
    const language = tag.split('-')[0]!;
    return has(language) ? catalogues[language]! : catalogues.en;
  };
}

const lookup = createLookup<Strings>(STRINGS);

/**
 * The SDK's strings for an explicitly configured locale (`data-locale` / `configure({ locale })`).
 * A locale without a catalogue, or none, reads English.
 */
export function pickStrings(locale?: string | null): Strings {
  return lookup(locale);
}

/**
 * The locale tag sent to the embed in `curtain:context`: explicit, else `<html lang>`, else the
 * browser language, else `en`. The embed uses its region for the default units (cm or in) only;
 * it never changes the language of any text (D21).
 */
export function localeTag(locale?: string | null): string {
  return (
    locale ||
    (typeof document !== 'undefined' && document.documentElement.lang) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'en'
  );
}
