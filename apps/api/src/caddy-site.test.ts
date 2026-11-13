/**
 * The marketing site on <domain> (apps/site, docs/SITE.md) in the VPS stack: the Caddy site blocks for the apex and
 * www, the site volume, and the deploy path that publishes it without ever blocking the app and api deploy.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const caddyfile = read('infra/Caddyfile');
const compose = read('infra/docker-compose.yml');
const serverDeploy = read('infra/scripts/deploy.sh');
const runnerDeploy = read('scripts/deploy.sh');
const workflow = read('.github/workflows/deploy.yml');

/** The body of a top-level site block, e.g. `{$DOMAIN} {` … the next `}` at column 0. */
function block(address: string): string {
  const start = caddyfile.indexOf(`\n${address} {\n`);
  if (start < 0) return '';
  const end = caddyfile.indexOf('\n}\n', start + 1);
  return caddyfile.slice(start, end);
}

function csp(body: string): Map<string, string[]> {
  const m = /Content-Security-Policy "([^"]+)"/.exec(body);
  const directives = new Map<string, string[]>();
  for (const part of (m?.[1] ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name, values);
  }
  return directives;
}

describe('infra/Caddyfile: the site on <domain>', () => {
  const site = block('{$DOMAIN}');

  it('serves the static site from the read-only site volume, with security headers', () => {
    expect(site).toContain('import base_headers');
    expect(site).toContain('root * /srv/site');
    expect(site).toContain('file_server');
    expect(site).toContain('try_files {path} {path}/index.html');
    expect(site).toContain('X-Frame-Options "DENY"');
    expect(compose).toMatch(/- site:\/srv\/site:ro/);
    expect(compose).toMatch(/\nvolumes:\n(?: {2}\w+:\n)*? {2}site:\n/);
  });

  it('has a same-origin CSP: no third parties, the waitlist form may open mailto:', () => {
    const p = csp(site);
    expect(p.get('default-src')).toEqual(["'self'"]);
    for (const d of ['script-src', 'style-src', 'font-src', 'connect-src']) expect(p.get(d)).toEqual(["'self'"]);
    expect(p.get('img-src')).toEqual(["'self'", 'data:']);
    // Only the image crops (object-position) use a style attribute; no inline <style> or <script>.
    expect(p.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
    expect(p.get('frame-ancestors')).toEqual(["'none'"]);
    expect(p.get('form-action')).toEqual(["'self'", 'mailto:']);
    expect(site).not.toMatch(/https?:\/\/(?!\{\$DOMAIN\})/);
  });

  it('caches hashed assets for a year, images for a day and revalidates HTML', () => {
    expect(site).toMatch(/@immutable path \/assets\/\* \/fonts\/\*\n\theader @immutable Cache-Control "public, max-age=31536000, immutable"/);
    expect(site).toMatch(/@img path \/img\/\*\n\theader @img Cache-Control "public, max-age=86400"/);
    expect(site).toMatch(/@html path \/ \*\.html \*\/\n\theader @html Cache-Control "no-cache"/);
  });

  it('sends HSTS from the apex without includeSubDomains (the mailbox hosts are not ours)', () => {
    expect(site).toContain('header Strict-Transport-Security "max-age=31536000"\n');
    expect(site).not.toContain('includeSubDomains');
    expect(caddyfile).toMatch(/\(security_headers\) \{\n\timport base_headers\n\theader Strict-Transport-Security "max-age=31536000; includeSubDomains"/);
    for (const host of ['www.{$DOMAIN}', 'app.{$DOMAIN}', 'api.{$DOMAIN}']) expect(block(host)).toContain('import security_headers');
  });

  it('redirects a directory page without its slash, so every page has one URL and the HTML cache header', () => {
    expect(site).toMatch(/@noslash \{\n\t\tnot path \*\/\n\t\tfile \{path\}\/index\.html\n\t\}\n\tredir @noslash \{path\}\/ 308/);
  });

  it('answers unknown paths with the site 404 page', () => {
    expect(site).toMatch(/handle_errors 404 \{\n\t\trewrite \* \/404\.html[\s\S]*file_server/);
  });

  it('redirects www to the apex, permanently, keeping the path', () => {
    expect(block('www.{$DOMAIN}')).toContain('redir https://{$DOMAIN}{uri} permanent');
  });

  it('every page the site build writes uses no inline script or style element the CSP would block', () => {
    const pages = ['index.html', 'pilot/index.html', '404.html'];
    const dist = join(root, 'apps/site/dist');
    // The site is built by `pnpm build:apps`, after the tests in `pnpm check`; on a fresh checkout there is nothing to read.
    if (!existsSync(join(dist, '404.html'))) return;
    for (const p of pages) {
      const html = readFileSync(join(dist, p), 'utf8');
      expect(html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? []).toEqual([]);
      expect(html).not.toMatch(/<style[\s>]/);
      expect(html).not.toMatch(/\son[a-z]+="/);
    }
  });
});

describe('deploy: the site is published like the web app but never blocks it', () => {
  it('the server deploy takes --site-release, swaps HTML last and records the site with the release', () => {
    expect(serverDeploy).toContain('--site-release) SITE_RELEASE="$2"');
    expect(serverDeploy).toMatch(/publish_site\(\) \{[\s\S]*! -name "\*\.html"[\s\S]*-name "\*\.html"[\s\S]*\.next" && mv -f/);
    expect(serverDeploy).toContain('write_state current "$NEW_IMAGE" "$WEB_RELEASE" "$SITE_RELEASE"');
    // A rollback puts the site of the previous release back with its image.
    expect(serverDeploy).toContain('rollback_to "$PREV_IMAGE" "$PREV_WEB" "$CUR_WEB" "$PREV_SITE" "$CUR_SITE"');
    expect(serverDeploy).toContain('rollback_to "$CUR_IMAGE" "$CUR_WEB" "$WEB_RELEASE" "$CUR_SITE" "$SITE_RELEASE"');
  });

  it('validates the Caddyfile in CI and on the server, and puts the last good one back on failure', () => {
    const checkJob = workflow.slice(workflow.indexOf('\n  check:\n'), workflow.indexOf('\n  web:\n'));
    expect(checkJob).toContain('infra/scripts/caddy-validate.sh');
    expect(serverDeploy).toMatch(/if ! validate_caddyfile; then[\s\S]*?exit 1\nfi/);
    // Validation runs before migrations and before the api swap.
    expect(serverDeploy.indexOf('if ! validate_caddyfile')).toBeLessThan(serverDeploy.indexOf('log "running migrations"'));
    expect(serverDeploy).toContain('cp "$HERE/Caddyfile" "$CADDY_GOOD.tmp" && mv "$CADDY_GOOD.tmp" "$CADDY_GOOD"');
    expect(serverDeploy.indexOf('restore_caddyfile\n')).toBeLessThan(serverDeploy.lastIndexOf('rollback_to "$CUR_IMAGE"'));
    expect(serverDeploy).toContain('compose up -d --no-deps --force-recreate caddy');
    expect(runnerDeploy).toContain('cp Caddyfile .deploy/Caddyfile.good');
  });

  it('a failed site publish only warns', () => {
    expect(serverDeploy).toMatch(/try_publish_site\(\) \{[\s\S]*WARNING: publishing the site/);
    expect(serverDeploy).toContain('if try_publish_site "$SITE_RELEASE" "$CUR_SITE"; then check_site; else SITE_RELEASE="$CUR_SITE"; fi');
    expect(serverDeploy).not.toMatch(/^\s*publish_site "\$SITE_RELEASE"/m);
  });

  it('reads release state written before the site existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'curtain-deploy-'));
    try {
      cpSync(join(root, 'infra/scripts'), join(dir, 'scripts'), { recursive: true });
      mkdirSync(join(dir, '.deploy'));
      writeFileSync(join(dir, '.deploy/current'), 'ghcr.io/o/curtain-api:git-1 /opt/curtain/web/releases/git-1\n');
      writeFileSync(join(dir, '.deploy/previous'), 'ghcr.io/o/curtain-api:git-0 - /opt/curtain/site/releases/git-0\n');
      const out = execFileSync('bash', [join(dir, 'scripts/deploy.sh'), '--status'], { encoding: 'utf8' });
      expect(out).toContain('current:  ghcr.io/o/curtain-api:git-1 /opt/curtain/web/releases/git-1 -');
      expect(out).toContain('previous: ghcr.io/o/curtain-api:git-0 - /opt/curtain/site/releases/git-0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the runner uploads SITE_DIST as its own release and skips it with a warning when it is not a site release build', () => {
    expect(runnerDeploy).toContain('SITE_RELEASE="$REMOTE_DIR/site/releases/$TAG"');
    expect(runnerDeploy).toContain("SITE_ARGS=\"$(printf ' --site-release %q' \"$SITE_RELEASE\")\"");
    expect(runnerDeploy).toMatch(/WARNING: \$SITE_DIST is not a site release build/);
    expect(runnerDeploy).toContain('$WEB_ARGS$SITE_ARGS');
  });

  it('the workflow builds the site with build:release and deploys app and api whatever the site job did', () => {
    expect(workflow).toContain('pnpm --filter @curtain/site build:release');
    const deployJob = workflow.slice(workflow.indexOf('\n  deploy:\n'), workflow.indexOf('\n  operate:\n'));
    expect(deployJob).toContain('needs: [guard, check, web, image, site]');
    const condition = /if: >-\n([\s\S]*?)\n {4}runs-on/.exec(deployJob)?.[1] ?? '';
    expect(condition).not.toContain('needs.site');
    expect(deployJob).toContain("SITE_DIST: ${{ needs.site.outputs.built == 'true' && 'site-dist' || '' }}");
    const siteJob = workflow.slice(workflow.indexOf('\n  site:\n'), workflow.indexOf('\n  image:\n'));
    expect(siteJob).toContain('echo "built=false" >> "$GITHUB_OUTPUT"');
    expect(siteJob).toContain("if: steps.build.outputs.built == 'true'");
  });
});
