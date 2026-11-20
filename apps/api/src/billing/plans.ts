/**
 * Plans (D17, Nov 2026): one paid plan, "Curtain", USD 8.99 per month per shop, flat. Billed with
 * the Shopify Billing API (one recurring line, no usage line) or a Stripe subscription with one
 * licensed price (WooCommerce, no meter).
 *
 * The try-on session stays the unit we count (D7), for merchant analytics and abuse limits only:
 * `includedSessions` is the monthly fair-use reference the per-shop daily cap is derived from
 * (`dailyBilledCap`, services/usage.ts), never a quota that triggers a charge. `overageEurPerSession`
 * is always 0, whatever a shop's settings say, so the nightly rollup has nothing to push.
 *
 * `free` is the state of a shop without an active subscription (a new install, or after a cancel,
 * decline or expiry). It is not sold.
 */
import { CURTAIN_PLAN } from '@curtain/shopify-app';
import type { Plan } from '../db/schema.js';

export interface PlanSpec {
  name: Plan;
  /** Monthly fair-use reference for the daily cap (D7); not billed. */
  includedSessions: number;
  /** Always 0 since D17: no per-session charge. Kept for the usage API's wire shape. */
  overageEurPerSession: number;
  /** List price in USD per month (0 for `free`). */
  priceUsdPerMonth: number;
  /** Shown on the Shopify approval screen and in the merchant console. */
  displayName: string;
}

/** The one plan's list price (D17). */
export const CURTAIN_PRICE_USD = CURTAIN_PLAN.priceUsdPerMonth;

export const PLAN_SPECS: Record<Plan, PlanSpec> = {
  free: { name: 'free', includedSessions: 50, overageEurPerSession: 0, priceUsdPerMonth: 0, displayName: 'No plan' },
  curtain: { name: 'curtain', includedSessions: 5000, overageEurPerSession: 0, priceUsdPerMonth: CURTAIN_PRICE_USD, displayName: CURTAIN_PLAN.name },
};

/** Plan values stored before D17 (migration 0004 rewrites them). */
export const LEGACY_PLANS = ['starter', 'pro'] as const;

/** Any stored or requested plan value → a current plan: the retired paid plans are `curtain`. */
export function normalisePlan(value: string | null | undefined): Plan {
  if (value === 'curtain' || (LEGACY_PLANS as readonly string[]).includes(value ?? '')) return 'curtain';
  return 'free';
}

/**
 * The plan's spec with a shop's fair-use override. `overageEurPerSession` overrides are ignored:
 * nothing is billed per session (D17), even for a shop whose settings still carry one.
 */
export function planSpec(plan: Plan, overrides: { includedSessions?: number; overageEurPerSession?: number } = {}): PlanSpec {
  const base = PLAN_SPECS[normalisePlan(plan)];
  const included = overrides.includedSessions;
  return { ...base, ...(typeof included === 'number' && Number.isFinite(included) && included >= 0 ? { includedSessions: Math.floor(included) } : {}) };
}

/**
 * Trial days for a new subscription: the configured trial, minus what a shop already used since
 * its first trial started (re-subscribing never restarts the trial).
 */
export function remainingTrialDays(trialDays: number, trialStartedAt: string | undefined, now: Date): number {
  if (!trialStartedAt) return trialDays;
  const started = Date.parse(trialStartedAt);
  if (!Number.isFinite(started)) return trialDays;
  const used = Math.floor((now.getTime() - started) / 86_400_000);
  return Math.max(0, Math.min(trialDays, trialDays - Math.max(0, used)));
}
