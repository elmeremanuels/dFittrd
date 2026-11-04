import { defineConfig } from 'drizzle-kit';

// Used by `pnpm db:generate` only (SQL migrations in ./drizzle). The running server applies them
// with drizzle-orm's migrator (src/migrate.ts), so drizzle-kit never needs DATABASE_URL at build time.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
