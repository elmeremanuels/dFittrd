#!/usr/bin/env node
/**
 * `pnpm check:launch`: the checks that need a browser and a running stack, in one command (OI-48, 66, 69, 70).
 * `pnpm check` stays the fast one (build, types, lint, unit tests); this is the one to run before a merge
 * into `main` and before a deploy (docs/LAUNCH-RUNBOOK.md step 7). About five minutes.
 *
 *   1  models         fetch the MediaPipe models when they are missing (about 50 MB, not in git)
 *   2  privacy e2e    apps/web privacy.spec + privacyModels.spec on the production build, under the
 *                     production security headers, with the REAL models. It cannot skip: without the
 *                     models it fails (CURTAIN_REQUIRE_MODELS=1)
 *   3  post-deploy    scripts/post-deploy-check.mjs against the local demo stack (production build and
 *                     headers), with its negative controls
 *   4  demo shop      the three storefront flows of `pnpm demo:e2e` with the embed under the production
 *                     policy; any policy violation fails
 *   5  site           every page of the marketing site under the policy Caddy sends for it
 *
 * Every step runs even when an earlier one failed, so one run shows everything that is wrong. The last
 * lines say, per step, passed or FAILED. Exit code 0 only when all passed.
 *
 * Flags: --only=<name>[,<name>]   models, privacy, post-deploy, demo-shop, site
 * Needs Chromium for Playwright (`pnpm --filter @curtain/web exec playwright install chromium`) and the
 * ports 3000, 4173, 5180 and 8787 free.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const node = process.execPath;

export const STEPS = [
  { name: 'models', title: 'MediaPipe models are present', cmd: pnpm, args: ['--filter', '@curtain/web', 'models'] },
  {
    name: 'privacy',
    title: 'privacy e2e with the real models, under the production headers',
    cmd: pnpm,
    args: ['--filter', '@curtain/web', 'e2e', 'privacy.spec.ts', 'privacyModels.spec.ts'],
    env: { CURTAIN_REQUIRE_MODELS: '1' },
  },
  { name: 'post-deploy', title: 'post-deploy check against the local demo stack', cmd: node, args: ['--test', 'scripts/post-deploy-check.test.mjs'] },
  // --skip-build: step 3 has just built the packages and the web app for the preview.
  { name: 'demo-shop', title: 'demo shop flows with the embed under the production policy', cmd: node, args: ['scripts/demo-e2e.mjs', '--preview', '--skip-build'], ifAlone: ['scripts/demo-e2e.mjs', '--preview'] },
  { name: 'site', title: 'marketing site under its production policy', cmd: node, args: ['scripts/site-csp-check.mjs'] },
];

function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',');
  const unknown = (only ?? []).filter((n) => !STEPS.some((s) => s.name === n));
  if (unknown.length) {
    console.error(`check:launch: unknown step ${unknown.join(', ')} (steps: ${STEPS.map((s) => s.name).join(', ')})`);
    process.exit(2);
  }
  const steps = STEPS.filter((s) => !only || only.includes(s.name));
  const results = [];
  for (const step of steps) {
    console.log(`\n=== ${step.name}: ${step.title} ===`);
    // The demo shop step builds for itself when the post-deploy step, which builds first, is not part of this run.
    const args = step.ifAlone && !steps.some((s) => s.name === 'post-deploy') ? step.ifAlone : step.args;
    const started = Date.now();
    const r = spawnSync(step.cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...(step.env ?? {}) } });
    results.push({ step, ok: r.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
  }
  console.log('\n=== check:launch ===');
  for (const { step, ok, seconds } of results) console.log(`${ok ? 'passed' : 'FAILED'}  ${step.name.padEnd(11)}  ${step.title} (${seconds} s)`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\ncheck:launch: ${failed} of ${results.length} steps FAILED` : `\ncheck:launch: all ${results.length} steps passed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
