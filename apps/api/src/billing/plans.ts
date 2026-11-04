/** Plans (handoff + architecture-panel "Billing"): plugin paid, app free, one billing unit = try-on session (D7). */
import type { Plan } from '../db/schema.js';

export interface PlanSpec {
  name: Plan;
  includedSessions: number;
  overageEurPerSession: number;
  priceEurPerMonth: number;
  trialDays: number;
}

export const PLAN_SPECS: Record<Plan, PlanSpec> = {
  free: { name: 'free', includedSessions: 50, overageEurPerSession: 0, priceEurPerMonth: 0, trialDays: 14 },
  starter: { name: 'starter', includedSessions: 500, overageEurPerSession: 0.05, priceEurPerMonth: 29, trialDays: 14 },
  pro: { name: 'pro', includedSessions: 5000, overageEurPerSession: 0.03, priceEurPerMonth: 149, trialDays: 14 },
};

export function planSpec(plan: Plan, overrides: { includedSessions?: number; overageEurPerSession?: number } = {}): PlanSpec {
  const base = PLAN_SPECS[plan];
  return { ...base, ...compactDefined(overrides) };
}

function compactDefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
