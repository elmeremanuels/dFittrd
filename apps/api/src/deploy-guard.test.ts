/**
 * Guards found by the go-live rehearsal (docs/GOLIVE-REHEARSAL.md): mistakes a founder can make in the
 * GitHub settings or on a laptop that the deploy path must stop before anything is shipped.
 *
 * The workflow guard is executed, not only read: its `run:` block is cut out of the YAML and run with
 * bash the way GitHub runs `run:` steps (`bash --noprofile --norc -eo pipefail`).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('DOMAIN must be the bare domain: the stack adds www., app. and api. itself', () => {
  const deployGuard = runBlock('.github/workflows/deploy.yml', 'check the ref and the variables');
  const shopifyGuard = runBlock('.github/workflows/shopify-deploy.yml', 'guard');

  it('the deploy workflow guard passes curtain.fit and stops app./api./www. prefixes', () => {
    const base = { REF: 'refs/heads/release', APP_SUBDOMAIN: 'app', API_SUBDOMAIN: 'api' };
    expect(runStep(deployGuard, { ...base, DOMAIN: 'curtain.fit' }).status).toBe(0);
    expect(runStep(deployGuard, { ...base, DOMAIN: 'shop.example.com.au' }).status).toBe(0);
    for (const bad of ['app.curtain.fit', 'api.curtain.fit', 'www.curtain.fit']) {
      const res = runStep(deployGuard, { ...base, DOMAIN: bad });
      expect(res.status, bad).toBe(1);
      expect(res.out).toContain('DOMAIN must be the bare domain');
    }
    // The branch rule still comes first.
    expect(runStep(deployGuard, { ...base, REF: 'refs/heads/claude/x', DOMAIN: 'curtain.fit' }).status).toBe(1);
  });

  it('the Shopify deploy guard stops the same prefixes before rendering the app config', () => {
    expect(shopifyGuard).toContain('www.*|app.*|api.*)');
  });

  it('scripts/deploy.sh (laptop or runner) refuses a prefixed DOMAIN before any ssh', () => {
    for (const bad of ['app.curtain.fit', 'www.curtain.fit']) {
      const res = spawnSync('bash', [join(root, 'scripts/deploy.sh'), 'status'], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', VPS_HOST: '192.0.2.1', VPS_USER: 'deploy', DOMAIN: bad },
      });
      expect(res.status, bad).toBe(2);
      expect(res.stderr).toContain('DOMAIN must be the bare domain');
    }
  });
});

describe('the site release build fails closed', () => {
  it('a refused build:release removes dist/, so a laptop deploy cannot publish a site with open launch gates', () => {
    const build = read('apps/site/scripts/build.ts');
    const release = build.slice(build.indexOf("if (process.env.CURTAIN_SITE_RELEASE === '1') {"));
    const refused = release.indexOf('Release build refused');
    expect(refused).toBeGreaterThan(-1);
    const cleanup = release.indexOf('rmSync(dist, { recursive: true, force: true });');
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(refused);
    expect(release.indexOf('process.exit(1)')).toBeGreaterThan(cleanup);
  });
});
