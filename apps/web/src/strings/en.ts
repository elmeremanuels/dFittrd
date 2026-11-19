/**
 * The English catalogue of `apps/web` outside the embed's own screens (DECISIONS.md D21), in three
 * parts so each can be read next to the code that shows it. A translation pack is one more file of
 * this shape (`AppCatalogue`), registered in `./index.ts`.
 */
import { APP_EN, type AppStrings } from './en/app';
import { CAPTURE_EN, type CaptureStrings } from './en/capture';
import { SHARED_EN, type SharedStrings } from './en/shared';

export interface AppCatalogue {
  /** Components the embed shares with the app: fit panel, estimate badge, size rings, avatar figure, number field. */
  shared: SharedStrings;
  /** The camera scan (`@/features/capture`). */
  capture: CaptureStrings;
  /** The consumer app: routes, onboarding, deck, wardrobe, profile, store messages. */
  app: AppStrings;
}

export const EN: AppCatalogue = { shared: SHARED_EN, capture: CAPTURE_EN, app: APP_EN };
