import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { DEPLOY_TXT, parseDeployOptions, planShopifyDeploy } from '../scripts/deploy-plan.mjs';
import { AppConfigError, appUrlsForDomain, renderAppConfig, resolveAppConfigVars, validateAppConfig } from './appConfig';
import { SHOPIFY_COMPLIANCE_TOPICS, SHOPIFY_WEBHOOK_TOPICS } from './webhookHmac';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(pkgRoot, '..', '..');
const template = readFileSync(join(pkgRoot, 'shopify.app.toml'), 'utf8');
const clientId = '0123456789abcdef0123456789abcdef';

type Sub = { topics?: string[]; compliance_topics?: string[]; uri: string };

describe('deploy config from DOMAIN (what shopify-deploy.yml renders)', () => {
  it('points the application url, redirect url and every webhook at https://api.<domain>', () => {
    const vars = resolveAppConfigVars({ DOMAIN: 'curtain.fit', SHOPIFY_API_KEY: `${clientId}\n` });
    expect(vars.PUBLIC_API_URL).toBe('https://api.curtain.fit');
    expect(vars.PUBLIC_APP_URL).toBe('https://app.curtain.fit');
    expect(vars.SHOPIFY_API_KEY).toBe(clientId); // a pasted trailing newline is dropped
    const parsed = parse(renderAppConfig(template, vars)) as Record<string, unknown>;
    const v = validateAppConfig(parsed, { apiUrl: vars.PUBLIC_API_URL });
    expect(v.issues).toEqual([]);
    expect(parsed.client_id).toBe(clientId);
    expect(parsed.application_url).toBe('https://api.curtain.fit/shopify/admin');
    expect((parsed.auth as { redirect_urls: string[] }).redirect_urls).toEqual(['https://api.curtain.fit/shopify/auth/callback']);
    const subs = (parsed.webhooks as { subscriptions: Sub[] }).subscriptions;
    expect(new Set(subs.map((s) => s.uri))).toEqual(new Set(['https://api.curtain.fit/shopify/webhooks']));
    expect(v.topics.sort()).toEqual([...SHOPIFY_WEBHOOK_TOPICS].sort());
    expect(v.complianceTopics.sort()).toEqual([...SHOPIFY_COMPLIANCE_TOPICS].sort());
    expect(parsed.handle).toBe('curtain');
    expect((parsed.build as Record<string, unknown>).include_config_on_deploy).toBe(true);
    expect((parsed.build as Record<string, unknown>).dev_store_url).toBeUndefined();
  });

  it('accepts matching explicit urls and a handle override', () => {
    const vars = resolveAppConfigVars({ DOMAIN: 'curtain.fit', PUBLIC_API_URL: 'https://api.curtain.fit/', SHOPIFY_API_KEY: clientId, SHOPIFY_APP_HANDLE: 'curtain-pilot' });
    expect(vars.PUBLIC_API_URL).toBe('https://api.curtain.fit');
    expect(parse(renderAppConfig(template, vars)).handle).toBe('curtain-pilot');
  });

  it('rejects a DOMAIN that is not a bare lowercase domain', () => {
    for (const bad of ['https://curtain.fit', 'api.curtain.fit/', 'Curtain.fit', 'localhost', 'curtain.fit ', '-x.fit']) {
      expect(() => appUrlsForDomain(bad), bad).toThrow(AppConfigError);
    }
    expect(appUrlsForDomain('shop.example.com.au').PUBLIC_API_URL).toBe('https://api.shop.example.com.au');
  });

  it('rejects urls that disagree with DOMAIN', () => {
    expect(() => resolveAppConfigVars({ DOMAIN: 'curtain.fit', PUBLIC_API_URL: 'https://api.other.fit', SHOPIFY_API_KEY: clientId })).toThrow(/PUBLIC_API_URL does not match DOMAIN/);
  });

  it('rejects a client id that is not 32 hex characters without echoing it', () => {
    const notAnId = 'not-the-client-id-but-a-secret-value';
    try {
      resolveAppConfigVars({ DOMAIN: 'curtain.fit', SHOPIFY_API_KEY: notAnId });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/32-character hex client id/);
      expect((e as Error).message).not.toContain(notAnId);
    }
  });

  it('still needs the client id', () => {
    expect(() => renderAppConfig(template, resolveAppConfigVars({ DOMAIN: 'curtain.fit' }))).toThrow(/missing value for \{\{SHOPIFY_API_KEY\}\}/);
  });
});

// The script imports ../dist, so this needs `pnpm --filter @curtain/shopify-app build` (pnpm check builds first).
const distBuilt = existsSync(join(pkgRoot, 'dist', 'index.js'));

describe.skipIf(!distBuilt)('scripts/configure.mjs --dry-run', () => {
  const run = (env: Record<string, string>, args: string[]) =>
    spawnSync(process.execPath, [join(pkgRoot, 'scripts', 'configure.mjs'), ...args], {
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
    });

  it('prints the rendered prod config and writes nothing', () => {
    const out = join(pkgRoot, 'shopify.app.dryruntest.toml');
    const r = run({ DOMAIN: 'curtain.fit', SHOPIFY_API_KEY: clientId }, ['dryruntest', '--dry-run']);
    expect(r.stderr).toContain('nothing written');
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(false);
    const parsed = parse(r.stdout) as Record<string, unknown>;
    expect(parsed.application_url).toBe('https://api.curtain.fit/shopify/admin');
    expect(validateAppConfig(parsed, { apiUrl: 'https://api.curtain.fit' }).ok).toBe(true);
    expect(r.stderr).toContain('webhooks: https://api.curtain.fit/shopify/webhooks');
  });

  it('fails with a readable message when DOMAIN is malformed or the client id is missing', () => {
    const bad = run({ DOMAIN: 'https://curtain.fit', SHOPIFY_API_KEY: clientId }, ['prod', '--dry-run']);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('DOMAIN must be a bare lowercase domain');
    const missing = run({ DOMAIN: 'curtain.fit' }, ['prod', '--dry-run']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('missing value for {{SHOPIFY_API_KEY}}');
    expect(run({}, ['prod', '--bogus']).status).toBe(1);
  });
});

describe('scripts/deploy-plan.mjs', () => {
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  const touched = { commits: [{ added: [], modified: [DEPLOY_TXT] }] };
  const untouched = { commits: [{ added: ['packages/shopify-app/src/x.ts'], modified: [] }] };
  const base = { sha, runNumber: 7, runAttempt: 1 };

  it('deploys on release and releases by default', () => {
    const p = planShopifyDeploy({ ...base, eventName: 'push', ref: 'refs/heads/release', payload: untouched });
    expect(p).toMatchObject({ deploy: true, release: true, version: 'git-abcdef012345-r7-1', message: 'release abcdef012345', issues: [] });
  });

  it('on claude/** deploys only when deploy.txt changed, and does not release unless asked', () => {
    expect(planShopifyDeploy({ ...base, eventName: 'push', ref: 'refs/heads/claude/garment-engine', payload: untouched }).deploy).toBe(false);
    const p = planShopifyDeploy({ ...base, eventName: 'push', ref: 'refs/heads/claude/garment-engine', payload: touched, deployTxt: '# pilot dry run\n' });
    expect(p).toMatchObject({ deploy: true, release: false });
    const r = planShopifyDeploy({ ...base, eventName: 'push', ref: 'refs/heads/claude/x', payload: { commits: [{ added: [DEPLOY_TXT] }] }, deployTxt: 'release = true\nmessage = pilot block v2\nversion = pilot-2' });
    expect(r).toMatchObject({ deploy: true, release: true, message: 'pilot block v2', version: 'pilot-2' });
  });

  it('never deploys from other branches or events', () => {
    expect(planShopifyDeploy({ ...base, eventName: 'push', ref: 'refs/heads/feature/x', payload: touched }).deploy).toBe(false);
    expect(planShopifyDeploy({ ...base, eventName: 'pull_request', ref: 'refs/pull/1/merge', payload: touched }).deploy).toBe(false);
  });

  it('lets the dispatch input win over deploy.txt and the branch', () => {
    const p = planShopifyDeploy({ ...base, eventName: 'workflow_dispatch', ref: 'refs/heads/main', deployTxt: 'release=true', inputs: { release: 'false', message: 'hotfix' } });
    expect(p).toMatchObject({ deploy: true, release: false, message: 'hotfix' });
    expect(planShopifyDeploy({ ...base, eventName: 'workflow_dispatch', ref: 'refs/heads/main', deployTxt: 'release=true' }).release).toBe(true);
    expect(planShopifyDeploy({ ...base, eventName: 'push', ref: 'refs/heads/release', deployTxt: 'release = no' }).release).toBe(false);
  });

  it('blocks the deploy on a malformed deploy.txt', () => {
    const { issues } = parseDeployOptions('release = maybe\nversion = has space\nmessage =\ncolour = red\njust text');
    expect(issues).toHaveLength(5);
    const p = planShopifyDeploy({ ...base, eventName: 'push', ref: 'refs/heads/claude/x', payload: touched, deployTxt: 'release = maybe' });
    expect(p.deploy).toBe(false);
    expect(p.issues).toEqual([`${DEPLOY_TXT} line 1: release must be true or false`]);
  });

  it('writes the plan to GITHUB_OUTPUT when run as the workflow runs it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'curtain-plan-'));
    try {
      const event = join(dir, 'event.json');
      const output = join(dir, 'output');
      const txt = join(dir, 'deploy.txt');
      writeFileSync(event, JSON.stringify(touched));
      writeFileSync(txt, 'release = true\n');
      writeFileSync(output, '');
      const r = spawnSync(process.execPath, [join(pkgRoot, 'scripts', 'deploy-plan.mjs')], {
        env: { PATH: process.env.PATH ?? '', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/claude/x', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_SHA: sha, GITHUB_RUN_NUMBER: '3', GITHUB_RUN_ATTEMPT: '2', DEPLOY_TXT_PATH: txt },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(readFileSync(output, 'utf8').split('\n')).toEqual(expect.arrayContaining(['deploy=true', 'release=true', 'version=git-abcdef012345-r3-2']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('.github/workflows/shopify-deploy.yml', () => {
  const wf = readFileSync(join(repoRoot, '.github', 'workflows', 'shopify-deploy.yml'), 'utf8');

  it('pins the Shopify CLI to an exact version and calls the scripts that exist', () => {
    expect(wf).toMatch(/SHOPIFY_CLI_VERSION: '\d+\.\d+\.\d+'/);
    expect(wf).toContain('"@shopify/cli@${SHOPIFY_CLI_VERSION}"');
    expect(wf).toContain('packages/shopify-app/scripts/deploy-plan.mjs');
    expect(wf).toContain('configure prod');
    expect(wf).toContain(DEPLOY_TXT);
  });

  it('hands the partners token value to the deploy step only; the guard sees whether it is set', () => {
    expect(wf.split('${{ secrets.SHOPIFY_CLI_PARTNERS_TOKEN }}').length - 1).toBe(1);
    expect(wf).toContain("${{ secrets.SHOPIFY_CLI_PARTNERS_TOKEN != '' }}");
    const deployLine = wf.split('\n').find((l) => /^\s*shopify app deploy /.test(l)) ?? '';
    expect(deployLine).toContain('--config prod');
    expect(deployLine).not.toContain('--allow-deletes');
  });
});
