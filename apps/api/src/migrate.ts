/** `node dist/migrate.js` — applies ./drizzle migrations; the container runs it before the server. */
import { connectPostgres } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const handle = connectPostgres(env.DATABASE_URL, { max: 1 });
try {
  await handle.migrate();
  console.log('migrations applied');
} finally {
  await handle.close();
}
