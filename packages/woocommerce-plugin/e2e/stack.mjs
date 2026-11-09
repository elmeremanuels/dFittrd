/**
 * The real-WordPress stack for `pnpm --filter @curtain/woocommerce-plugin e2e:wp` (e2e/run.mjs):
 *
 *   mariadb     official `mariadb:11` image, host network, 127.0.0.1:<dbPort>
 *   wordpress   official `wordpress:php<X.Y>-apache` image, host network, Apache moved to <wpPort>
 *   wp-cli      official `wordpress:cli-php8.3` image, sharing the WordPress volume
 *   api + web   this repo: the api demo entry on PGlite (its own data folder, never .demo-db) and the
 *               web dev server, on their own ports so a `pnpm demo` next to it is not disturbed
 *
 * Host networking: the plugin only accepts http:// API bases on localhost (Settings::sanitize_api_base),
 * so WordPress (server side: Connect, HMAC pushes) and the browser (the SDK) must both reach the api
 * as http://localhost:<apiPort>. With `--network host` they do, with no proxy in between.
 *
 * Downloads (WooCommerce, Storefront, Twenty Twenty-Four, Plugin Check) are pinned by version and
 * cached in e2e/.cache (git-ignored); their SHA-256 is printed so a run can be compared with another.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = resolve(pluginRoot, '..', '..');
export const cacheDir = join(pluginRoot, 'e2e', '.cache');

/** Pinned downloads from downloads.wordpress.org. */
export const DOWNLOADS = {
  woocommerce: { file: 'woocommerce.11.2.2.zip', url: 'https://downloads.wordpress.org/plugin/woocommerce.11.2.2.zip' },
  storefront: { file: 'storefront.4.6.2.zip', url: 'https://downloads.wordpress.org/theme/storefront.4.6.2.zip' },
  twentytwentyfour: { file: 'twentytwentyfour.1.6.zip', url: 'https://downloads.wordpress.org/theme/twentytwentyfour.1.6.zip' },
  'plugin-check': { file: 'plugin-check.2.2.0.zip', url: 'https://downloads.wordpress.org/plugin/plugin-check.2.2.0.zip' },
};

export function config(overrides = {}) {
  const php = overrides.php ?? process.env.CURTAIN_WP_PHP ?? '8.3';
  const tag = php.replace('.', '');
  return {
    php,
    prefix: `curtain-wpe2e-${tag}`,
    dbPort: Number(process.env.CURTAIN_WP_DB_PORT ?? 3390 + Number(tag.slice(-1))),
    wpPort: Number(process.env.CURTAIN_WP_PORT ?? 8090 + Number(tag.slice(-1))),
    apiPort: Number(process.env.CURTAIN_WP_API_PORT ?? 8797),
    webPort: Number(process.env.CURTAIN_WP_WEB_PORT ?? 3010),
    wpImage: process.env.CURTAIN_WP_IMAGE ?? `wordpress:php${php}-apache`,
    cliImage: process.env.CURTAIN_WP_CLI_IMAGE ?? 'wordpress:cli-php8.3',
    dbImage: process.env.CURTAIN_WP_DB_IMAGE ?? 'mariadb:11',
    ...overrides,
  };
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

export async function fetchDownloads(log) {
  mkdirSync(cacheDir, { recursive: true });
  const out = {};
  for (const [name, d] of Object.entries(DOWNLOADS)) {
    const path = join(cacheDir, d.file);
    if (!existsSync(path)) {
      log(`download ${d.url}`);
      const res = await fetch(d.url);
      if (!res.ok) throw new Error(`download ${d.url}: HTTP ${res.status}`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    }
    const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
    log(`${d.file} sha256 ${sha}`);
    out[name] = path;
  }
  return out;
}

export function pullImages(cfg, log) {
  for (const image of [cfg.dbImage, cfg.wpImage, cfg.cliImage]) {
    const have = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
    if (have) continue;
    log(`docker pull ${image}`);
    const r = spawnSync('docker', ['pull', image], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`docker pull ${image} failed: Docker Hub not reachable through this network? (see docs/LAUNCH-WOO.md, "Fallback")`);
  }
}

export function removeStack(cfg) {
  for (const c of [`${cfg.prefix}-wp`, `${cfg.prefix}-db`]) spawnSync('docker', ['rm', '-f', '-v', c], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', '-f', `${cfg.prefix}-html`], { stdio: 'ignore' });
}

async function waitHttp(url, ok, timeoutMs, what) {
  const until = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
      if (ok(res.status)) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String(e.cause?.code ?? e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not answer on ${url} within ${timeoutMs / 1000} s (${last})`);
}

/** Start MariaDB + WordPress (fresh volume). */
export async function startWordPress(cfg, log) {
  removeStack(cfg);
  log(`start ${cfg.dbImage} on 127.0.0.1:${cfg.dbPort}`);
  sh('docker', ['run', '-d', '--name', `${cfg.prefix}-db`, '--network', 'host', '-e', 'MARIADB_ROOT_PASSWORD=e2e-root', '-e', 'MARIADB_DATABASE=wp', '-e', 'MARIADB_USER=wp', '-e', 'MARIADB_PASSWORD=e2e-wp', cfg.dbImage, `--port=${cfg.dbPort}`, '--bind-address=127.0.0.1']);
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const r = spawnSync('docker', ['exec', `${cfg.prefix}-db`, 'mariadb', '-uwp', '-pe2e-wp', `-P${cfg.dbPort}`, '-h127.0.0.1', '-e', 'SELECT 1', 'wp'], { stdio: 'ignore' });
    if (r.status === 0) break;
    await new Promise((r2) => setTimeout(r2, 700));
  }
  log(`start ${cfg.wpImage} on http://localhost:${cfg.wpPort}`);
  sh('docker', ['volume', 'create', `${cfg.prefix}-html`]);
  const extra = "define('WP_DEBUG_LOG', true); define('WP_DEBUG_DISPLAY', false); define('WP_ENVIRONMENT_TYPE', 'local');";
  const apache = `sed -i 's/^Listen 80$/Listen ${cfg.wpPort}/' /etc/apache2/ports.conf && sed -i 's/:80>/:${cfg.wpPort}>/' /etc/apache2/sites-enabled/000-default.conf && exec docker-entrypoint.sh apache2-foreground`;
  sh('docker', [
    'run', '-d', '--name', `${cfg.prefix}-wp`, '--network', 'host', '-v', `${cfg.prefix}-html:/var/www/html`,
    '-e', `WORDPRESS_DB_HOST=127.0.0.1:${cfg.dbPort}`, '-e', 'WORDPRESS_DB_USER=wp', '-e', 'WORDPRESS_DB_PASSWORD=e2e-wp', '-e', 'WORDPRESS_DB_NAME=wp',
    '-e', 'WORDPRESS_DEBUG=1', '-e', `WORDPRESS_CONFIG_EXTRA=${extra}`,
    '--entrypoint', 'sh', cfg.wpImage, '-c', apache,
  ]);
  await waitHttp(`http://localhost:${cfg.wpPort}/`, (s) => s === 302 || s === 200, 90_000, 'WordPress');
  const versions = sh('docker', ['exec', `${cfg.prefix}-wp`, 'sh', '-c', "php -r 'echo PHP_VERSION;'; echo; grep -o \"wp_version = '[^']*'\" /var/www/html/wp-includes/version.php"]);
  log(`container: PHP ${versions.split('\n')[0]}, WordPress ${versions.split('\n')[1]?.replace(/.*= '|'/g, '')}`);
}

/** wp-cli against the stack. `mounts` maps host paths to container paths (read-only). */
export function wp(cfg, args, { mounts = {}, input, allowFail = false } = {}) {
  const vol = ['-v', `${cfg.prefix}-html:/var/www/html`];
  for (const [host, ctr] of Object.entries(mounts)) vol.push('-v', `${host}:${ctr}:ro`);
  const r = spawnSync(
    'docker',
    ['run', '--rm', '-i', '--network', 'host', '--user', '33:33', ...vol, '-e', `WORDPRESS_DB_HOST=127.0.0.1:${cfg.dbPort}`, '-e', 'WORDPRESS_DB_USER=wp', '-e', 'WORDPRESS_DB_PASSWORD=e2e-wp', '-e', 'WORDPRESS_DB_NAME=wp', cfg.cliImage, 'wp', ...args],
    { encoding: 'utf8', input: input ?? '' },
  );
  if (r.status !== 0 && !allowFail) throw new Error(`wp ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return allowFail ? { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() } : r.stdout.trim();
}

/** The PHP error log of the WordPress container (WP_DEBUG_LOG). */
export function debugLog(cfg) {
  const r = spawnSync('docker', ['exec', `${cfg.prefix}-wp`, 'sh', '-c', 'cat /var/www/html/wp-content/debug.log 2>/dev/null || true'], { encoding: 'utf8' });
  return r.stdout ?? '';
}

// ---- api + web ---------------------------------------------------------------------------------

/**
 * The api (demo entry: PGlite, mock try-on, no keys) and the web dev server. `proof` sets
 * WOO_DOMAIN_PROOF: on by default, as in production.
 */
export function apiService(cfg, { dataDir, logFile }) {
  let child = null;
  const lines = [];
  const start = async ({ proof = true } = {}) => {
    const env = {
      ...process.env,
      PORT: String(cfg.apiPort),
      DEMO_DB_DIR: dataDir,
      PUBLIC_APP_URL: `http://localhost:${cfg.webPort}`,
      PUBLIC_API_URL: `http://localhost:${cfg.apiPort}`,
      CORS_ORIGINS: [`http://localhost:${cfg.wpPort}`, `http://localhost:${cfg.webPort}`].join(','),
      WOO_DOMAIN_PROOF: proof ? '1' : '0',
      LOG_LEVEL: 'info',
      FORCE_COLOR: '0',
    };
    child = spawn('pnpm', ['--filter', '@curtain/api', 'demo'], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const onData = (b) => {
      const text = b.toString();
      lines.push(...text.split('\n').filter(Boolean));
      if (logFile) writeFileSync(logFile, text, { flag: 'a' });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    await waitHttp(`http://localhost:${cfg.apiPort}/healthz`, (s) => s === 200, 90_000, 'api');
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const c = child;
    await new Promise((r) => {
      c.once('exit', r);
      try {
        process.kill(-c.pid, 'SIGTERM');
      } catch {
        r();
      }
      setTimeout(() => {
        try {
          process.kill(-c.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
        r();
      }, 8000);
    });
    child = null;
  };
  return { start, stop, lines };
}

export function webService(cfg, { logFile }) {
  let child = null;
  const start = async () => {
    const env = { ...process.env, VITE_API_URL: `http://localhost:${cfg.apiPort}`, FORCE_COLOR: '0' };
    child = spawn('pnpm', ['exec', 'vite', `--port=${cfg.webPort}`, '--host=127.0.0.1', '--strictPort'], { cwd: join(repoRoot, 'apps/web'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const onData = (b) => logFile && writeFileSync(logFile, b.toString(), { flag: 'a' });
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    await waitHttp(`http://localhost:${cfg.webPort}/`, (s) => s === 200, 120_000, 'web');
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
    child = null;
  };
  return { start, stop };
}

export function freshDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
