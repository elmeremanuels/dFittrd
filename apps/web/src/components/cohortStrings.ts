/**
 * The cohort card's strings. They live in the app catalogue (`@/strings`, section `app.cohort`;
 * DECISIONS.md D21: one English catalogue per surface, read through one lookup).
 */
import { appStrings, type AppCatalogue } from '@/strings';

export type CohortCatalogue = AppCatalogue['app']['cohort'];

export function cohortStrings(): CohortCatalogue {
  return appStrings().app.cohort;
}
