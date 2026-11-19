/**
 * The string lookup of everything in `apps/web` outside the embed's own screens (DECISIONS.md D21:
 * English first, translation packs later): the components the embed shares with the app
 * (`@/components`, `@/render`), the camera scan (`@/features/capture`) and the consumer app
 * (`@/routes`, `@/store`). The merchant console has its own catalogue (`@/merchant/strings`).
 *
 * One interface locale for the whole page. Nothing here reads the browser language. The embed's
 * entry names the locale once (`setEmbedLocale` in `@/embed/strings` hands it on to `setUiLocale`),
 * so a shared component drawn inside the embed follows the same pack as the screen around it. The
 * consumer app names none and reads English.
 *
 * Adding a pack: add `./<locale>.ts` exporting an `AppCatalogue` (TypeScript checks it has every
 * string) and register it in `CATALOGUES` below. `scripts/check-language-packs.mjs` fails when a
 * language is on one surface and not on this one.
 */
import { EN, type AppCatalogue } from './en';

export type { AppCatalogue } from './en';

type Catalogues = { en: AppCatalogue } & Record<string, AppCatalogue>;

const CATALOGUES: Catalogues = { en: EN };

export const DEFAULT_UI_LOCALE = 'en';

let catalogues: Catalogues = CATALOGUES;
let active: string = DEFAULT_UI_LOCALE;

const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(catalogues, k);

/** The interface locale of this page. Called by the embed's lookup only; the app stays on English. */
export function setUiLocale(locale: string | null | undefined): void {
  active = locale?.trim() || DEFAULT_UI_LOCALE;
}

/** The strings in the interface locale: the exact locale, else its language, else English. */
export function appStrings(): AppCatalogue {
  const tag = active.toLowerCase().replace(/_/g, '-');
  if (has(tag)) return catalogues[tag]!;
  const language = tag.split('-')[0]!;
  return has(language) ? catalogues[language]! : catalogues.en;
}

/** The locales with a registered catalogue. */
export const appLocales = (): string[] => Object.keys(catalogues);

/** Tests only: run over another set of catalogues; returns the way back. */
export function swapAppCatalogues(next: Catalogues): () => void {
  const before = catalogues;
  catalogues = next;
  return () => {
    catalogues = before;
  };
}
