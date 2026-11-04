/**
 * Database handle. Production uses postgres-js; tests use PGlite (in-process WASM Postgres),
 * so the full route suite runs without Docker. Both are the same Drizzle `PgDatabase` type.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as PgliteModule from '@electric-sql/pglite';
import type * as DrizzlePglite from 'drizzle-orm/pglite';
import type * as DrizzlePgliteMigrator from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { schema, type Schema } from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
  /** Runs the SQL migrations in ./drizzle. */
  migrate(): Promise<void>;
  /** `select 1` — used by /readyz. */
  ping(): Promise<boolean>;
}

/** Absolute path of apps/api/drizzle, from src/ and from dist/. */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'drizzle');
}

export function connectPostgres(databaseUrl: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(databaseUrl, { max: opts.max ?? 10, prepare: false, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema });
  return {
    db,
    async close() {
      await client.end({ timeout: 5 });
    },
    async migrate() {
      await migratePostgres(db, { migrationsFolder: migrationsFolder() });
    },
    async ping() {
      try {
        await client`select 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** PGlite handle for tests (dev dependency; resolved lazily so production never loads it). */
export async function connectPglite(): Promise<DbHandle> {
  const require = createRequire(import.meta.url);
  const pgliteModule = (await import(require.resolve('@electric-sql/pglite'))) as typeof PgliteModule;
  const drizzleModule = (await import('drizzle-orm/pglite')) as typeof DrizzlePglite;
  const migratorModule = (await import('drizzle-orm/pglite/migrator')) as typeof DrizzlePgliteMigrator;
  const client = new pgliteModule.PGlite();
  const db = drizzleModule.drizzle(client, { schema });
  return {
    db,
    async close() {
      await client.close();
    },
    async migrate() {
      await migratorModule.migrate(db, { migrationsFolder: migrationsFolder() });
    },
    async ping() {
      try {
        await client.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
  };
}
