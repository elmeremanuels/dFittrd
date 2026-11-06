/**
 * Integration leftovers of the engine branch:
 *  - billing_anomalies lives in db/schema.ts and the drizzle snapshot chain covers it, so
 *    `pnpm db:generate` has nothing pending and migration 0003 matches the table definition;
 *  - the merchant views (usage/anomalies, analytics/fit-sizes) are merchant routes, not try routes,
 *    and the abandoned-opens route answers with the shared @curtain/schema DTO.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyticsAbandonedResponseSchema, AnalyticsFitSizesResponseSchema, BILLING_ANOMALY_KIND_NAMES, BillingAnomaliesResponseSchema } from '@curtain/schema';
import { BILLING_ANOMALY_KINDS, billingAnomalies, schema } from './db/schema.js';
import { billingAnomalies as reExported } from './services/usage.js';
import { merchantRoutes } from './routes/merchant.js';
import { tryRoutes } from './routes/try.js';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';

const drizzleDir = fileURLToPath(new URL('../drizzle/', import.meta.url));
const readJson = <T>(path: string): T => JSON.parse(readFileSync(`${drizzleDir}${path}`, 'utf8')) as T;

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}
interface Snapshot {
  id: string;
  prevId: string;
  tables: Record<string, { name: string; columns: Record<string, { name: string; type: string; notNull: boolean; default?: string }>; compositePrimaryKeys: Record<string, { columns: string[] }>; foreignKeys: Record<string, { tableTo: string; onDelete: string }> }>;
}

describe('billing_anomalies in db/schema.ts and the drizzle snapshots', () => {
  const journal = readJson<Journal>('meta/_journal.json');
  const snapshots = journal.entries.map((e) => readJson<Snapshot>(`meta/${String(e.idx).padStart(4, '0')}_snapshot.json`));

  it('is part of the drizzle schema object (one definition, re-exported by the usage service)', () => {
    expect(schema.billingAnomalies).toBe(billingAnomalies);
    expect(reExported).toBe(billingAnomalies);
    expect([...BILLING_ANOMALY_KINDS]).toEqual([...BILLING_ANOMALY_KIND_NAMES]);
  });

  it('every journal entry has a snapshot, chained by prevId', () => {
    expect(journal.entries.map((e) => e.tag)).toContain('0003_billing_anomalies');
    for (let i = 1; i < snapshots.length; i++) expect(snapshots[i]!.prevId).toBe(snapshots[i - 1]!.id);
  });

  it('the latest snapshot holds the table exactly as db/schema.ts defines it', () => {
    const latest = snapshots[snapshots.length - 1]!;
    const snap = latest.tables['public.billing_anomalies'];
    expect(snap).toBeDefined();
    const cfg = getTableConfig(billingAnomalies);
    expect(Object.keys(snap!.columns).sort()).toEqual(cfg.columns.map((c) => c.name).sort());
    for (const c of cfg.columns) expect(snap!.columns[c.name]!.notNull).toBe(c.notNull);
    expect(Object.values(snap!.compositePrimaryKeys)[0]!.columns).toEqual(['shop_id', 'day', 'kind']);
    expect(Object.values(snap!.foreignKeys)).toEqual([expect.objectContaining({ tableTo: 'shops', onDelete: 'cascade' })]);
    // The snapshot before 0003 does not have it: 0003 is the migration that creates it.
    const i0003 = journal.entries.findIndex((e) => e.tag === '0003_billing_anomalies');
    expect(snapshots[i0003]!.tables['public.billing_anomalies']).toBeDefined();
    expect(snapshots[i0003 - 1]!.tables['public.billing_anomalies']).toBeUndefined();
  });

  it('migration 0003 creates every column of the table', () => {
    const sql = readFileSync(`${drizzleDir}0003_billing_anomalies.sql`, 'utf8');
    for (const c of getTableConfig(billingAnomalies).columns) expect(sql).toContain(`"${c.name}"`);
    expect(sql).toContain('PRIMARY KEY("shop_id","day","kind")');
  });
});

describe('merchant views are merchant routes', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t);
  });
  afterAll(async () => {
    await t.close();
  });

  const pluginRoutes = async (plugin: typeof merchantRoutes) => {
    const bare = Fastify();
    bare.setValidatorCompiler(validatorCompiler);
    bare.setSerializerCompiler(serializerCompiler);
    bare.decorate('ctx', t.app.ctx);
    await bare.register(plugin);
    await bare.ready();
    return bare;
  };

  it('routes/merchant.ts owns usage/anomalies and analytics/fit-sizes; routes/try.ts does not', async () => {
    const merchant = await pluginRoutes(merchantRoutes);
    const tryOnly = await pluginRoutes(tryRoutes);
    for (const url of ['/v1/merchant/usage/anomalies', '/v1/merchant/analytics/fit-sizes', '/v1/merchant/analytics/abandoned']) {
      expect(merchant.hasRoute({ method: 'GET', url })).toBe(true);
      expect(tryOnly.hasRoute({ method: 'GET', url })).toBe(false);
    }
    expect(tryOnly.hasRoute({ method: 'GET', url: '/v1/try/:token' })).toBe(true);
    await merchant.close();
    await tryOnly.close();
  });

  it('the three views answer with the shared @curtain/schema DTOs', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const auth = { authorization: `Bearer ${s.apiKey}` };
    const get = (url: string) => t.app.inject({ method: 'GET', url: `${url}?from=${day}&to=${day}`, headers: auth });
    const anomalies = await get('/v1/merchant/usage/anomalies');
    expect(anomalies.statusCode).toBe(200);
    expect(BillingAnomaliesResponseSchema.parse(anomalies.json())).toMatchObject({ from: day, anomalies: [] });
    const sizes = await get('/v1/merchant/analytics/fit-sizes');
    expect(sizes.statusCode).toBe(200);
    expect(AnalyticsFitSizesResponseSchema.parse(sizes.json())).toMatchObject({ bySize: [], totals: { sessions: 0 } });
    const abandoned = await get('/v1/merchant/analytics/abandoned');
    expect(abandoned.statusCode).toBe(200);
    expect(AnalyticsAbandonedResponseSchema.parse(abandoned.json())).toMatchObject({ totals: { sessions: 0, resolved: 0, withFit: 0 } });
  });
});
