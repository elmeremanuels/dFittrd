/**
 * Units for the standalone embed: metric (cm, kg) or imperial (ft/in, in, lb), for every input on
 * About you and every number on the result (the size chart, the per-point fit text).
 *
 * The fit engine only ever sees metric values. An imperial entry is converted with the exact
 * factors (1 in = 2.54 cm, 1 lb = 0.45359237 kg) and kept to 0.1 cm / 0.1 kg, the precision of the
 * metric form itself. Imperial text the shopper typed is kept as typed while it still matches the
 * metric value, so switching units back and forth never changes a number on screen or in the fit.
 *
 * Pure: no DOM, no storage. The chosen system is remembered by the embed store (`pref:units`).
 */

export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;
export type Units = (typeof UNIT_SYSTEMS)[number];

export const CM_PER_IN = 2.54;
export const KG_PER_LB = 0.45359237;
export const IN_PER_FT = 12;

/** Regions whose shoppers expect imperial body measurements by default. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

export function isUnits(v: unknown): v is Units {
  return v === 'metric' || v === 'imperial';
}

/** The region of a BCP 47 tag (`en-US` → `US`, `es-419` → `419`), or null without one. */
export function localeRegion(locale: string | null | undefined): string | null {
  if (!locale) return null;
  const parts = locale.trim().replace(/_/g, '-').split('-').slice(1);
  const region = parts.find((p) => /^[A-Za-z]{2}$|^\d{3}$/.test(p));
  return region ? region.toUpperCase() : null;
}

/**
 * The default system for a list of locales (the shopper's browser first, then the shop page):
 * the first one that names a region decides; US (and Liberia, Myanmar) is imperial, the rest metric.
 */
export function defaultUnits(...locales: (string | null | undefined)[]): Units {
  for (const l of locales) {
    const region = localeRegion(l);
    if (region) return IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
  }
  return 'metric';
}

const round = (x: number, step: number): number => Math.round(x / step) * step;

/** 0.1 precision, as a plain number without float noise (86.99499 → 87, 63.50293 → 63.5). */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export const inToCm = (inches: number): number => inches * CM_PER_IN;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;

/** Feet and inches for a height in cm, inches rounded to `step` (never "5 ft 12 in"). */
export function cmToFtIn(cm: number, step = 0.5): { ft: number; in: number } {
  const total = round(cmToIn(cm), step);
  const ft = Math.floor((total + 1e-9) / IN_PER_FT);
  const inches = Math.max(0, round(total - ft * IN_PER_FT, step));
  return { ft, in: Number(inches.toFixed(2)) };
}

export function ftInToCm(ft: number, inches: number): number {
  return inToCm(ft * IN_PER_FT + inches);
}

/** "86.995" → "87", "34.25" → "34.25", 63.5 → "63.5": a number as an input value, trailing zeros off. */
export function numberText(x: number, maxDecimals = 1): string {
  return String(Number(x.toFixed(maxDecimals)));
}

/** A metric value as the metric form holds it (0.1 precision). */
export function metricText(x: number): string {
  return numberText(round1(x), 1);
}

// ---------------------------------------------------------------------------
// Quantities shown on the result
// ---------------------------------------------------------------------------

export function lengthUnit(units: Units): 'cm' | 'in' {
  return units === 'imperial' ? 'in' : 'cm';
}

/** A chart length without its unit (the column header carries it): 88 → "88" / "34.6". */
export function chartLength(cm: number, units: Units): string {
  return units === 'imperial' ? cmToIn(cm).toFixed(1) : numberText(cm, 1);
}

/** A length difference with its unit, one decimal: 2 → "2.0 cm" / "0.8 in". */
export function lengthText(cm: number, units: Units): string {
  return units === 'imperial' ? `${cmToIn(cm).toFixed(1)} in` : `${cm.toFixed(1)} cm`;
}

/** A height for display: 170 → "170 cm" / "5 ft 7 in". */
export function heightText(cm: number, units: Units): string {
  if (units === 'metric') return `${numberText(cm, 1)} cm`;
  const { ft, in: inches } = cmToFtIn(cm);
  return `${ft} ft ${numberText(inches, 1)} in`;
}
