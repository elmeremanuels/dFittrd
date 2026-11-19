/**
 * English strings of the cohort card (DECISIONS.md D21: one English catalogue per surface, read through one lookup).
 * The cohort counts whole calendar months only (launch-readiness finding 1), so the card says which month it runs to.
 */
export interface CohortCatalogue {
  title: string;
  people: (n: number) => string;
  empty: (k: number) => string;
  through: (month: string) => string;
  kept: (percent: number) => string;
  bar: (size: string, n: number) => string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (period: string): string => {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

export const COHORT_EN: CohortCatalogue = {
  title: 'What others kept',
  people: (n) => `${n} ${n === 1 ? 'person' : 'people'}`,
  empty: (k) => `Shown once at least ${k} people have tried this item in a month.`,
  through: (month) => `Counted in whole months, up to the end of ${monthName(month)}. Sizes chosen by only a few people are hidden.`,
  kept: (percent) => `${percent}% kept what they bought.`,
  bar: (size, n) => `Size ${size}: ${n}`,
};

export function cohortStrings(): CohortCatalogue {
  return COHORT_EN;
}
