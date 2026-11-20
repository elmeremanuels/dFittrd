/**
 * Migration 0004 (D17 + A3) against a database that holds pre-D17 rows: the migrations up to 0003
 * run first, shops on every old plan are inserted, then 0004 runs exactly as the migrator would.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectPglite, migrationsFolder, type DbHandle } from '../db/client.js';
import { normalisePlan, planSpec, remainingTrialDays } from './plans.js';

function statements(file: string): string[] {
  return readFileSync(join(migrationsFolder(), file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run(h: DbHandle, file: string): Promise<void> {
  for (const s of statements(file)) await h.db.execute(sql.raw(s));
}

describe('migration 0004: one flat plan, refresh token columns', () => {
  let h: DbHandle;
  const files = readdirSync(migrationsFolder()).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

  beforeAll(async () => {
    h = await connectPglite();
    for (const f of files.filter((f) => f < '0004')) await run(h, f);
    const insert = (domain: string, plan: string, settings: object) =>
      h.db.execute(sql`insert into shops (platform, domain, name, plan, settings) values ('shopify', ${domain}, ${domain}, ${plan}, ${JSON.stringify(settings)}::jsonb)`);
    await insert('starter.myshopify.com', 'starter', { usageLineItemId: 'gid://shopify/AppSubscriptionLineItem/2', overageEurPerSession: 0.05, includedSessions: 800, billingCurrency: 'AUD', billingEurRate: 1.78 });
    await insert('pro.myshopify.com', 'pro', { brandColor: '#FF5A3C' });
    await insert('free.myshopify.com', 'free', {});
    await insert('odd.myshopify.com', 'enterprise', {});
    await h.db.execute(sql`insert into shopify_sessions (id, shop_id, shop_domain, access_token_enc) select 'offline_' || domain, id, domain, 'v1.x.y.z' from shops where domain = 'starter.myshopify.com'`);
    await run(h, files.find((f) => f.startsWith('0004_'))!);
  });
  afterAll(async () => {
    await h.close();
  });

  const shop = async (domain: string) => {
    const r = await h.db.execute(sql`select plan, settings from shops where domain = ${domain}`);
    const rows = (Array.isArray(r) ? r : (r as unknown as { rows: unknown[] }).rows) as Array<{ plan: string; settings: Record<string, unknown> }>;
    return rows[0]!;
  };

  it('is named 0004_* and is in the journal at index 4 (0005 garment assets follows it)', () => {
    const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
    const f0004 = files.find((f) => f.startsWith('0004_'))!;
    expect(journal.entries[4]).toMatchObject({ idx: 4, tag: f0004.replace(/\.sql$/, '') });
    expect(journal.entries.at(-1)).toMatchObject({ tag: files.at(-1)!.replace(/\.sql$/, '') });
  });

  it('moves starter and pro to curtain and remembers the old plan', async () => {
    expect(await shop('starter.myshopify.com')).toMatchObject({ plan: 'curtain', settings: { legacyPlan: 'starter' } });
    expect(await shop('pro.myshopify.com')).toEqual({ plan: 'curtain', settings: { brandColor: '#FF5A3C', legacyPlan: 'pro' } });
    expect(await shop('free.myshopify.com')).toEqual({ plan: 'free', settings: {} });
    expect(await shop('odd.myshopify.com')).toEqual({ plan: 'free', settings: { legacyPlan: 'enterprise' } });
  });

  it('drops the per-session billing settings and keeps the fair-use override and currency', async () => {
    const s = (await shop('starter.myshopify.com')).settings;
    expect(s).not.toHaveProperty('usageLineItemId');
    expect(s).not.toHaveProperty('overageEurPerSession');
    expect(s).toMatchObject({ includedSessions: 800, billingCurrency: 'AUD', billingEurRate: 1.78 });
  });

  it('refuses any plan value but free and curtain from now on', async () => {
    await expect(h.db.execute(sql`update shops set plan = 'starter' where domain = 'free.myshopify.com'`)).rejects.toThrow();
    await h.db.execute(sql`update shops set plan = 'curtain' where domain = 'free.myshopify.com'`);
  });

  it('adds nullable refresh-token columns; existing sessions stay non-expiring until migrated', async () => {
    const r = await h.db.execute(sql`select expires_at, refresh_token_enc, refresh_token_expires_at, refreshed_at from shopify_sessions`);
    const rows = (Array.isArray(r) ? r : (r as unknown as { rows: unknown[] }).rows) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ expires_at: null, refresh_token_enc: null, refresh_token_expires_at: null, refreshed_at: null }]);
  });
});

describe('plan helpers (D17)', () => {
  it('retired names normalise to curtain; overage overrides are ignored; fair-use overrides apply', () => {
    expect(normalisePlan('starter')).toBe('curtain');
    expect(normalisePlan('pro')).toBe('curtain');
    expect(normalisePlan('curtain')).toBe('curtain');
    expect(normalisePlan('free')).toBe('free');
    expect(normalisePlan(undefined)).toBe('free');
    expect(planSpec('curtain', { overageEurPerSession: 0.05, includedSessions: 800 })).toEqual({ name: 'curtain', includedSessions: 800, overageEurPerSession: 0, priceUsdPerMonth: 8.99, displayName: 'Curtain' });
    expect(planSpec('free')).toMatchObject({ priceUsdPerMonth: 0, overageEurPerSession: 0 });
  });

  it('a second subscription gets only what is left of the first trial', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    expect(remainingTrialDays(7, undefined, now)).toBe(7);
    expect(remainingTrialDays(7, '2026-11-17T12:00:00Z', now)).toBe(4);
    expect(remainingTrialDays(7, '2026-11-01T00:00:00Z', now)).toBe(0);
    expect(remainingTrialDays(7, 'not a date', now)).toBe(7);
    expect(remainingTrialDays(14, '2026-11-20T11:00:00Z', now)).toBe(14);
  });
});
