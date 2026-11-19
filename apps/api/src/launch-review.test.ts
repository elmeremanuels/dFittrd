/**
 * Launch-readiness security and privacy review (19 Nov 2026, branch claude/launch-readiness).
 * Each block pins a finding of docs/reports/claude/launch-readiness.md:
 *  - L1: the request log held capability tokens (try tokens, signed render URLs, Shopify id_tokens).
 *  - L2: production accepted a k-anonymity floor below the documented 5 (the api and the deploy now refuse it).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from './app.js';
import { connectPglite } from './db/client.js';
import { EnvError, K_ANON_PRODUCTION_MIN, loadEnv, testEnv } from './env.js';
import { MemoryQueue } from './jobs/queue.js';
import { logSafeUrl } from './lib/logUrl.js';
import { FetchMock, testLookup } from './test/helpers.js';

const WRITE_ENV = resolve(dirname(fileURLToPath(import.meta.url)), '../../../infra/scripts/write-env.sh');

describe('L1: logSafeUrl keeps route patterns and parameter names, never values', () => {
  it('a matched route logs its pattern, so a try token in the path never appears', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzaG9wIjoiYWJjIiwianRpIjoieHl6In0.c2lnbmF0dXJlLXZhbHVlLWhlcmU';
    expect(logSafeUrl({ url: `/v1/try/${jwt}`, routePattern: '/v1/try/:token' })).toBe('/v1/try/:token');
    expect(logSafeUrl({ url: `/v1/try/${jwt}/fit-shown`, routePattern: '/v1/try/:token/fit-shown' })).toBe('/v1/try/:token/fit-shown');
  });

  it('a signed render URL keeps exp and sig as names only', () => {
    const out = logSafeUrl({ url: '/v1/renders/3f0c2b9e-1a2b-4c3d-8e9f-0123456789ab/image?exp=1795000000&sig=abcdef0123456789abcdef', routePattern: '/v1/renders/:jobId/:kind' });
    expect(out).toBe('/v1/renders/:jobId/:kind?exp=[redacted]&sig=[redacted]');
  });

  it('the Shopify admin query (id_token, hmac, shop) is reduced to names', () => {
    const out = logSafeUrl({ url: '/shopify/admin?embedded=1&hmac=deadbeef&host=YWRtaW4&id_token=eyJ.a.b&shop=boho.myshopify.com&timestamp=1', routePattern: '/shopify/admin' });
    expect(out).toBe('/shopify/admin?embedded=[redacted]&hmac=[redacted]&host=[redacted]&id_token=[redacted]&shop=[redacted]&timestamp=[redacted]');
    expect(out).not.toMatch(/boho|eyJ|deadbeef/);
  });

  it('an unmatched path keeps short plain segments and redacts anything token-like', () => {
    expect(logSafeUrl({ url: '/wp-login.php', routePattern: undefined })).toBe('/wp-login.php');
    expect(logSafeUrl({ url: '/v1/try/eyJhbGciOiJIUzI1NiJ9.eyJ4IjoxfQ.sig', routePattern: undefined })).toBe('/v1/try/[redacted]');
    expect(logSafeUrl({ url: '/v1/nope/0123456789abcdef0123456789abcdef', routePattern: '*' })).toBe('/v1/nope/[redacted]');
  });

  it('attacker-chosen parameter names are kept short and plain', () => {
    expect(logSafeUrl({ url: '/healthz?%3Cscript%3E=1&ok=2', routePattern: '/healthz' })).toBe('/healthz?[redacted]=[redacted]&ok=[redacted]');
  });
});

describe('L1: the running api never writes a try token, a render signature or an id_token to its log', () => {
  const lines: string[] = [];
  let app: Awaited<ReturnType<typeof build>>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const env = testEnv({ LOG_LEVEL: 'info' });
    const handle = await connectPglite();
    await handle.migrate();
    const queue = new MemoryQueue();
    app = await build({ env, db: handle.db, queue, fetch: new FetchMock().fetch, lookup: testLookup, logStream: { write: (l: string) => void lines.push(l) } });
    await app.ready();
    close = async () => {
      await app.close();
      await handle.close();
    };
  });
  afterAll(async () => close());

  it('logs the route pattern for real requests and the 404 handler', async () => {
    const tryToken = 'eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJ0cnkiLCJqdGkiOiJzZWNyZXQtanRpIn0.U0VDUkVULVRSWS1TSUc';
    const sig = 'feedfacefeedfacefeedface';
    const idToken = 'eyJhbGciOiJIUzI1NiJ9.eyJkZXN0IjoiaHR0cHM6Ly9ib2hvIn0.SUQtVE9LRU4tU0lH';
    await app.inject({ method: 'GET', url: `/v1/try/${tryToken}` });
    await app.inject({ method: 'GET', url: `/v1/renders/3f0c2b9e-1a2b-4c3d-8e9f-0123456789ab/image?exp=1795000000&sig=${sig}` });
    await app.inject({ method: 'GET', url: `/shopify/admin?shop=bohohippychic.myshopify.com&id_token=${idToken}` });
    await app.inject({ method: 'GET', url: `/v1/does-not-exist/${tryToken}?token=${tryToken}` });
    const log = lines.join('');
    expect(log).toContain('/v1/try/:token');
    expect(log).toContain('/v1/renders/:jobId/:kind?exp=[redacted]&sig=[redacted]');
    for (const secret of [tryToken, sig, idToken, 'U0VDUkVULVRSWS1TSUc', 'SUQtVE9LRU4tU0lH', 'bohohippychic']) expect(log).not.toContain(secret);
  });
});

describe('L2: production refuses a k-anonymity floor below 5', () => {
  const prod = (k: string) => ({
    NODE_ENV: 'production',
    JWT_SECRET: randomBytes(32).toString('hex'),
    SHOP_KEY_PEPPER: randomBytes(16).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    K_ANON: k,
  });

  it('K_ANON=1 or 4 stops the api at start, 5 and above start', () => {
    expect(K_ANON_PRODUCTION_MIN).toBe(5);
    expect(() => loadEnv(prod('1'))).toThrow(EnvError);
    expect(() => loadEnv(prod('4'))).toThrow(/K_ANON must be at least 5/);
    expect(loadEnv(prod('5')).K_ANON).toBe(5);
    expect(loadEnv(prod('10')).K_ANON).toBe(10);
  });

  it('development and tests may still use a lower floor (fixtures with one shopper)', () => {
    expect(testEnv({ K_ANON: '1' }).K_ANON).toBe(1);
  });
});

describe('L2: the deploy stops before the swap when K_ANON is below 5 (infra/scripts/write-env.sh)', () => {
  const run = (kAnon: string | null) => {
    const dir = mkdtempSync(join(tmpdir(), 'curtain-writeenv-'));
    const secrets = join(dir, 'curtain.env');
    const lines = [
      `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`,
      `JWT_SECRET=${randomBytes(32).toString('hex')}`,
      `SHOP_KEY_PEPPER=${randomBytes(16).toString('hex')}`,
      `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
      'ACME_EMAIL=ops@curtain.test',
      ...(kAnon === null ? [] : [`K_ANON=${kAnon}`]),
    ];
    writeFileSync(secrets, `${lines.join('\n')}\n`);
    const out = join(dir, '.env');
    const r = spawnSync('bash', [WRITE_ENV, '--domain', 'curtain.test', '--image', 'ghcr.io/x/curtain-api:git-0', '--secrets', secrets, '--out', out], { encoding: 'utf8' });
    const env = r.status === 0 ? readFileSync(out, 'utf8') : '';
    rmSync(dir, { recursive: true, force: true });
    return { status: r.status, stderr: r.stderr, env };
  };

  it('the example default (5) and a raised floor pass; 1, 4 and a typo fail with the reason', () => {
    expect(run(null).status).toBe(0);
    expect(run(null).env).toMatch(/^K_ANON=5\b/m);
    expect(run('10').status).toBe(0);
    for (const bad of ['1', '4', 'five']) {
      const r = run(bad);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/K_ANON must be a whole number of at least 5/);
    }
  });
});
