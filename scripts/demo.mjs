#!/usr/bin/env node
/**
 * `pnpm demo` (docs/STANDALONE.md §4): the whole standalone flow locally, no Docker and no keys.
 *
 *   api         http://localhost:8787  @curtain/api demo (PGlite in .demo-db, seeded "Aalter Studio", mock try-on)
 *   web         http://localhost:3000  @curtain/web dev (Vite) — serves the framable /embed/<token>
 *   storefront  http://localhost:5180  apps/demo-shop (WooCommerce- and Dawn-style product pages)
 *
 * Builds the workspace packages first when their dist/ is missing, and always rebuilds the SDK so
 * the api serves the current sdk.v1.js. A service already answering on its port is reused, not
 * restarted. Ctrl-C (or the parent exiting) stops every child it started.
 *
 * Flags: --skip-build   do not build anything
 *
 * Also importable: `const demo = await startDemo(); …; await demo.stop();` (scripts/demo-e2e.mjs).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export const URLS = {
  api: 'http://localhost:8787',
  web: 'http://localhost:3000',
  storefront: 'http://localhost:5180',
};

const SERVICES = [
  { name: 'api', url: URLS.api, health: `${URLS.api}/healthz`, cmd: pnpm, args: ['--filter', '@curtain/api', 'demo'], env: { LOG_LEVEL: 'warn' } },
  // The web app talks to the demo api directly (no Caddy in the demo).
  { name: 'web', url: URLS.web, health: `${URLS.web}/`, cmd: pnpm, args: ['--filter', '@curtain/web', 'dev'], env: { VITE_API_URL: URLS.api } },
  { name: 'storefront', url: URLS.storefront, health: `${URLS.storefront}/`, cmd: process.execPath, args: [join(root, 'apps/demo-shop/server.mjs')], env: { PORT: '5180' } },
];

async function healthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500), headers: { accept: 'text/html,application/json' } });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(url, { timeoutMs, child, name }) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child && child.exitCode !== null) throw new Error(`${name} exited with code ${child.exitCode} before it was ready`);
    if (await healthy(url)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${name} did not answer on ${url} within ${Math.round(timeoutMs / 1000)} s`);
}

function run(cmd, args, label) {
  console.log(`> ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

export function buildForDemo() {
  const needed = ['schema', 'fit-engine', 'taste-engine', 'tryon-providers', 'sdk'].filter((p) => !existsSync(join(root, 'packages', p, 'dist')));
  if (needed.length) run(pnpm, ['-r', '--filter', './packages/**', 'build'], `pnpm build:packages (missing dist: ${needed.join(', ')})`);
  else run(pnpm, ['--filter', '@curtain/sdk', 'build'], 'pnpm --filter @curtain/sdk build');
}

/**
 * Start (or reuse) the three services. `log` 'inherit' streams child output with a prefix;
 * 'quiet' only keeps the last lines for error messages.
 */
export async function startDemo({ build = true, log = 'inherit' } = {}) {
  if (build) buildForDemo();
  const children = [];
  const tails = new Map();
  let stopping = false;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    for (const { child } of children) killTree(child, 'SIGTERM');
    await Promise.all(
      children.map(
        ({ child }) =>
          new Promise((r) => {
            if (child.exitCode !== null || child.signalCode !== null) return r();
            const t = setTimeout(() => {
              killTree(child, 'SIGKILL');
              r();
            }, 5000);
            child.once('exit', () => {
              clearTimeout(t);
              r();
            });
          }),
      ),
    );
  };

  try {
    for (const svc of SERVICES) {
      if (await healthy(svc.health)) {
        console.log(`[demo] ${svc.name} is already running on ${svc.url}, reusing it`);
        continue;
      }
      // detached: the child leads its own process group, so killTree() also stops pnpm's grandchildren (tsx, vite).
      const child = spawn(svc.cmd, svc.args, { cwd: root, env: { ...process.env, ...svc.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      children.push({ name: svc.name, child });
      tails.set(svc.name, []);
      const onData = (buf) => {
        const lines = buf.toString().split('\n').filter((l) => l.trim());
        const tail = tails.get(svc.name);
        tail.push(...lines);
        tail.splice(0, Math.max(0, tail.length - 40));
        if (log === 'inherit') for (const l of lines) console.log(`[${svc.name}] ${l}`);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      try {
        await waitFor(svc.health, { timeoutMs: svc.name === 'web' ? 90_000 : 60_000, child, name: svc.name });
      } catch (err) {
        err.message += `\n--- last output of ${svc.name} ---\n${tails.get(svc.name).join('\n')}`;
        throw err;
      }
    }
  } catch (err) {
    await stop();
    throw err;
  }
  return { urls: URLS, stop, children };
}

function killTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

async function main() {
  const demo = await startDemo({ build: !process.argv.includes('--skip-build') });
  let down = false;
  const shutdown = async (code = 0) => {
    if (down) return;
    down = true;
    console.log('\n[demo] stopping…');
    await demo.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.on('exit', () => {
    for (const { child } of demo.children) killTree(child, 'SIGKILL');
  });
  for (const { name, child } of demo.children) {
    child.once('exit', (code) => {
      if (down) return;
      console.error(`[demo] ${name} exited (code ${code}); stopping the rest`);
      void shutdown(1);
    });
  }
  console.log(`
Curtain demo is running (standalone mode: no app needed).

  Storefront home          ${URLS.storefront}/
  WooCommerce product      ${URLS.storefront}/product/aalter-studio-1
  Shopify Dawn product     ${URLS.storefront}/products/aalter-studio-1
  Web app (embed origin)   ${URLS.web}/
  API                      ${URLS.api}/healthz

Open a product page and press "Try it on". Ctrl-C stops everything.
`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[demo] ${err.message}`);
    process.exit(1);
  });
}
