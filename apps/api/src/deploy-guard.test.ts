/**
 * Guards found by the go-live rehearsal (docs/GOLIVE-REHEARSAL.md): mistakes a founder can make in the
 * GitHub settings or on a laptop that the deploy path must stop before anything is shipped.
 *
 * Every test runs the real shell: workflow `run:` blocks are cut out of the YAML and run with bash the way
 * GitHub runs them (`bash --noprofile --norc -eo pipefail`); scripts/deploy.sh runs with ssh and rsync
 * replaced by stubs on PATH; pull_images is cut out of infra/scripts/deploy.sh and run with docker/compose stubs.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** The `run: |` block of the step whose `- name:` line contains `stepName`, dedented. */
function runBlock(workflowPath: string, stepName: string): string {
  const lines = read(workflowPath).split('\n');
  const start = lines.findIndex((l) => l.trimStart().startsWith('- name:') && l.includes(stepName));
  expect(start, `step "${stepName}" in ${workflowPath}`).toBeGreaterThan(-1);
  const runAt = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
  const indent = (lines[runAt + 1] ?? '').match(/^\s*/)![0].length;
  const body: string[] = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== '' && l.match(/^\s*/)![0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

function runStep(script: string, env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'curtain-guard-'));
  try {
    const file = join(dir, 'step.sh');
    writeFileSync(file, script);
    const res = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', GITHUB_STEP_SUMMARY: join(dir, 'summary'), GITHUB_OUTPUT: join(dir, 'output'), ...env },
    });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PATH = process.env.PATH ?? '/usr/bin:/bin';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'curtain-guard-'));
}

/** A directory that looks like apps/site/dist; `marker` adds the curtain-release.txt a build:release writes. */
function siteDir(marker: 'none' | 'valid' | 'stale' | 'bad-header'): string {
  const dir = tmp();
  writeFileSync(join(dir, 'index.html'), '<!doctype html><h1>Curtain</h1>');
  writeFileSync(join(dir, '404.html'), '<!doctype html><h1>Wrong size.</h1>');
  const sha = (f: string) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
  const body = `index.html ${sha('index.html')}\n404.html ${sha('404.html')}\n`;
  if (marker === 'valid' || marker === 'stale') writeFileSync(join(dir, 'curtain-release.txt'), `curtain-site-release 1\n${body}`);
  if (marker === 'bad-header') writeFileSync(join(dir, 'curtain-release.txt'), `something else\n${body}`);
  if (marker === 'stale') writeFileSync(join(dir, 'index.html'), '<!doctype html><h1>Changed after the release build</h1>');
  return dir;
}

describe('DOMAIN must be the bare domain: the stack adds www., app. and api. itself', () => {
  const deployGuard = runBlock('.github/workflows/deploy.yml', 'check the ref and the variables');
  const shopifyGuard = runBlock('.github/workflows/shopify-deploy.yml', 'guard');

  it('the deploy workflow guard passes curtain.fit and stops app./api./www. prefixes', () => {
    const base = { REF: 'refs/heads/release', APP_SUBDOMAIN: 'app', API_SUBDOMAIN: 'api' };
    for (const good of ['curtain.fit', 'shop.example.com.au', 'api.co']) expect(runStep(deployGuard, { ...base, DOMAIN: good }).status, good).toBe(0);
    for (const bad of ['app.curtain.fit', 'api.curtain.fit', 'www.curtain.fit']) {
      const res = runStep(deployGuard, { ...base, DOMAIN: bad });
      expect(res.status, bad).toBe(1);
      expect(res.out).toContain('DOMAIN must be the bare domain');
    }
    // The branch rule still comes first.
    expect(runStep(deployGuard, { ...base, REF: 'refs/heads/claude/x', DOMAIN: 'curtain.fit' }).status).toBe(1);
  });

  it('the Shopify deploy guard stops the same prefixes before rendering the app config', () => {
    const base = { HAS_PARTNERS_TOKEN: 'true', HAS_API_KEY: 'true' };
    for (const good of ['curtain.fit', 'api.co']) expect(runStep(shopifyGuard, { ...base, DOMAIN: good }).status, good).toBe(0);
    for (const bad of ['app.curtain.fit', 'api.curtain.fit', 'www.curtain.fit']) {
      const res = runStep(shopifyGuard, { ...base, DOMAIN: bad });
      expect(res.status, bad).toBe(1);
      expect(res.out).toContain('DOMAIN must be the bare domain');
    }
    expect(runStep(shopifyGuard, { ...base, HAS_API_KEY: 'false', DOMAIN: 'curtain.fit' }).status).toBe(1);
  });

  it('scripts/deploy.sh (laptop or runner) refuses a prefixed DOMAIN before any ssh', () => {
    for (const bad of ['app.curtain.fit', 'www.curtain.fit']) {
      const res = spawnSync('bash', [join(root, 'scripts/deploy.sh'), 'status'], {
        encoding: 'utf8',
        env: { PATH, VPS_HOST: '192.0.2.1', VPS_USER: 'deploy', DOMAIN: bad },
      });
      expect(res.status, bad).toBe(2);
      expect(res.stderr).toContain('DOMAIN must be the bare domain');
    }
  });
});

describe('only a site release build is ever published (a preview build has open launch gates)', () => {
  const check = join(root, 'infra/scripts/site-release-check.sh');
  const runCheck = (dir: string) => spawnSync('bash', [check, dir], { encoding: 'utf8', env: { PATH } });

  it('infra/scripts/site-release-check.sh accepts a release marker that matches the pages and nothing else', () => {
    const dirs = { none: siteDir('none'), valid: siteDir('valid'), stale: siteDir('stale'), header: siteDir('bad-header') };
    try {
      expect(runCheck(dirs.valid).status).toBe(0);
      const none = runCheck(dirs.none);
      expect(none.status).toBe(1);
      expect(none.stderr).toContain('not a release build');
      expect(runCheck(dirs.stale).stderr).toContain('does not match the release marker');
      expect(runCheck(dirs.stale).status).toBe(1);
      expect(runCheck(dirs.header).status).toBe(1);
      expect(runCheck(join(dirs.none, 'missing')).status).toBe(1);
    } finally {
      for (const d of Object.values(dirs)) rmSync(d, { recursive: true, force: true });
    }
  });

  /** scripts/deploy.sh deploy with ssh and rsync stubbed: returns the output and every ssh/rsync call. */
  function laptopDeploy(siteDist: string) {
    const dir = tmp();
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      const log = join(dir, 'calls');
      for (const tool of ['ssh', 'rsync']) {
        writeFileSync(join(bin, tool), `#!/usr/bin/env bash\nprintf '${tool} %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`);
        chmodSync(join(bin, tool), 0o755);
      }
      const res = spawnSync('bash', [join(root, 'scripts/deploy.sh'), 'deploy'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:${PATH}`, VPS_HOST: '192.0.2.1', VPS_USER: 'deploy', DOMAIN: 'curtain.fit', IMAGE_REPO: 'ghcr.io/example/curtain-api', TAG: 'abc123', SITE_DIST: siteDist },
      });
      let calls = '';
      try { calls = readFileSync(log, 'utf8'); } catch { /* no calls */ }
      return { status: res.status, out: `${res.stdout}${res.stderr}`, calls };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('scripts/deploy.sh skips a preview build of the site (e.g. apps/site/dist after `pnpm check`) and still deploys app and api', () => {
    const preview = siteDir('none');
    try {
      const res = laptopDeploy(preview);
      expect(res.status, res.out).toBe(0);
      expect(res.out).toContain('not a site release build');
      expect(res.calls).not.toContain('site/releases/abc123/');
      expect(res.calls).not.toContain('--site-release');
      expect(res.calls).toContain('--tag abc123');
    } finally {
      rmSync(preview, { recursive: true, force: true });
    }
  });

  it('scripts/deploy.sh uploads and publishes a release build', () => {
    const release = siteDir('valid');
    try {
      const res = laptopDeploy(release);
      expect(res.status, res.out).toBe(0);
      expect(res.calls).toContain('site/releases/abc123/');
      expect(res.calls).toContain('--site-release /opt/curtain/site/releases/abc123');
    } finally {
      rmSync(release, { recursive: true, force: true });
    }
  });

  it('the server side checks again before publishing, and never copies the marker into the site volume', () => {
    const serverDeploy = read('infra/scripts/deploy.sh');
    const fn = serverDeploy.slice(serverDeploy.indexOf('publish_site() {'), serverDeploy.indexOf('\n}\n', serverDeploy.indexOf('publish_site() {')));
    expect(fn).toContain('"$HERE/scripts/site-release-check.sh" "$release" || return 1');
    expect(fn).toContain('! -path ./curtain-release.txt');
  });
});

describe('the server deploy does not depend on Docker Hub for images it already has', () => {
  const serverDeploy = read('infra/scripts/deploy.sh');
  const fnStart = serverDeploy.indexOf('pull_images() {');
  const pullImages = serverDeploy.slice(fnStart, serverDeploy.indexOf('\n}\n', fnStart) + 3);

  /**
   * Runs the real pull_images with docker and compose replaced by bash functions.
   * `hub`: does a pull from Docker Hub work; `local`: images already on the host; `config`: does `compose config` work.
   */
  function pull(opts: { api?: boolean; hub?: boolean; local?: string[]; config?: 'ok' | 'fail' | 'empty' }) {
    const { api = true, hub = true, local = [], config = 'ok' } = opts;
    const script = `set -euo pipefail
NEW_IMAGE=ghcr.io/example/curtain-api:abc
log() { echo "LOG $*"; }
compose() {
  case "$1" in
    pull) ${api ? 'echo "PULLED api"' : 'return 1'} ;;
    config) ${config === 'fail' ? 'return 1' : config === 'empty' ? 'return 0' : 'printf "caddy:2.9-alpine\\npostgres:16-alpine\\n"'} ;;
  esac
}
docker() {
  case "$1" in
    pull) ${hub ? 'echo "PULLED $3" >&2' : 'return 1'} ;;
    image) case " ${local.join(' ')} " in *" $3 "*) return 0 ;; *) return 1 ;; esac ;;
  esac
}
${pullImages}
if ! pull_images; then echo RESULT=fail; exit 1; fi
echo RESULT=ok`;
    const res = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH } });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  }

  it('pulls everything when Docker Hub answers', () => {
    const res = pull({});
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain('PULLED caddy:2.9-alpine');
    expect(res.out).toContain('PULLED postgres:16-alpine');
  });

  it('warns and goes on when Docker Hub is down but caddy and postgres are on the host', () => {
    const res = pull({ hub: false, local: ['caddy:2.9-alpine', 'postgres:16-alpine'] });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain('WARNING: could not pull postgres:16-alpine');
  });

  it('fails when an image is neither pullable nor on the host, when the api pull fails, or when the image list is unknown', () => {
    expect(pull({ hub: false, local: ['caddy:2.9-alpine'] }).out).toContain('could not pull postgres:16-alpine and it is not on this host');
    expect(pull({ hub: false, local: ['caddy:2.9-alpine'] }).status).toBe(1);
    expect(pull({ api: false }).status).toBe(1);
    expect(pull({ config: 'fail' }).status).toBe(1);
    expect(pull({ config: 'empty' }).status).toBe(1);
  });

  it('a failed pull stops before anything changes and puts infra/.env back on the running image', () => {
    const failed = serverDeploy.slice(serverDeploy.indexOf('if ! pull_images; then'));
    expect(failed.indexOf('write-env.sh" --domain "$DOMAIN" --image "$CUR_IMAGE"')).toBeLessThan(failed.indexOf('exit 1'));
    expect(serverDeploy.indexOf('if ! pull_images; then')).toBeLessThan(serverDeploy.indexOf('log "running migrations"'));
  });
});
