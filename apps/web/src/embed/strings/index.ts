/**
 * The embed's single string lookup (DECISIONS.md D21: English first, translation packs later).
 *
 * Today there is one catalogue, English, so every locale reads English. Nothing here reads the
 * browser language or the shop page's language. The embed is shown in the interface locale the
 * shop's integration names explicitly: the SDK passes its own `data-locale` on the iframe URL as
 * `?ui=<locale>` (`uiLocaleOf`), the embed's entry hands it to `setEmbedLocale` once, before the
 * first screen is drawn, and every screen reads `embedStrings()`.
 *
 * Adding a pack later is two steps and no other code change:
 *   1. add `./<locale>.ts` exporting an `EmbedCatalogue` (TypeScript checks it has every string);
 *   2. register it in `CATALOGUES` below.
 * A shop whose integration then asks for that locale gets it; every other shop stays English.
 */
import { setUiLocale } from '@/strings';
import { EN, type EmbedCatalogue } from './en';

export type { AvatarClaims, AvatarUi, EmbedCatalogue } from './en';

/** Registered catalogues, keyed by lower-case locale (`en`, later `nl`, `pt-br`, ...). */
const CATALOGUES: { en: EmbedCatalogue } & Record<string, EmbedCatalogue> = { en: EN };

/** The locale the embed is shown in when the integration names none, or one without a pack. */
export const DEFAULT_EMBED_LOCALE = 'en';

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

/**
 * The interface state of one embed: the locale asked for and the catalogue it reads. `createEmbedStrings`
 * is exported so a test can run the real path (URL, `set`, the screens' `strings()`) over a pack
 * that is not shipped.
 */
export function createEmbedStrings(catalogues: { en: EmbedCatalogue } & Record<string, EmbedCatalogue>) {
  const lookup = createLookup<EmbedCatalogue>(catalogues);
  let active: string = DEFAULT_EMBED_LOCALE;
  return {
    set(locale: string | null | undefined): void {
      active = locale?.trim() || DEFAULT_EMBED_LOCALE;
    },
    strings: (locale: string | null = active): EmbedCatalogue => lookup(locale),
    locales: (): string[] => Object.keys(catalogues),
  };
}

let embed = createEmbedStrings(CATALOGUES);

/** The interface locale named by the integration. Called once, by the embed's entry (`mountRouter`). */
export function setEmbedLocale(locale: string | null | undefined): void {
  embed.set(locale);
  // The components the embed shares with the app read `@/strings`: one locale for the whole page.
  setUiLocale(locale);
}

/** The embed's strings in the interface locale (or the one given). A locale without a pack reads English. */
export function embedStrings(locale?: string | null): EmbedCatalogue {
  return locale === undefined ? embed.strings() : embed.strings(locale);
}

/** The locales with a registered catalogue. */
export const embedLocales = (): string[] => embed.locales();

/** Tests only: run the embed over another set of catalogues; returns the way back. */
export function swapCatalogues(catalogues: { en: EmbedCatalogue } & Record<string, EmbedCatalogue>): () => void {
  const before = embed;
  embed = createEmbedStrings(catalogues);
  return () => {
    embed = before;
  };
}

/**
 * The interface locale on the embed's own URL (`?ui=nl`, written by the SDK from the shop's
 * explicit `data-locale`), or null. Only a well-formed language tag is taken.
 */
export function uiLocaleOf(search: string): string | null {
  const v = new URLSearchParams(search).get('ui');
  return v && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$/.test(v) ? v : null;
}

/**
 * A catalogue string with one `{name}` in it, split around that mark, for a screen that puts an
 * element there: `parts('Fit by {brand}', 'brand')` is `['Fit by ', '']`.
 */
export function parts(text: string, name: string): [before: string, after: string] {
  const [before = '', ...rest] = text.split(`{${name}}`);
  return [before, rest.join('')];
}
