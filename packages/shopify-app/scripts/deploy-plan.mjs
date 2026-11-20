#!/usr/bin/env node
/**
 * Decides whether .github/workflows/shopify-deploy.yml deploys, and whether the new app version is
 * released to merchants. Node built-ins only: the workflow's plan job runs it before `pnpm install`.
 *
 *   node packages/shopify-app/scripts/deploy-plan.mjs      # reads the GITHUB_* environment, writes $GITHUB_OUTPUT
 *
 * When it deploys:
 *   - workflow_dispatch (only offered once the workflow is on the default branch): always.
 *   - push to `release`: always (the trigger's path filter already limits it to app changes).
 *   - push to `claude/**`: only when the push added or changed .github/shopify/deploy.txt
 *     (the same pattern as .github/modal/run.txt).
 *
 * Release (make the version live for merchants) is decided in this order: the dispatch input, a
 * `release =` line in deploy.txt, then the branch (`release` releases, every other branch does not).
 *
 * deploy.txt: `key = value` lines, `#` comments. Keys: release (true|false), message (one line, at
 * most 200 characters, shown in the Partner Dashboard only), version (letters, digits, . _ -).
 * Changing any line, a comment included, triggers a run on claude/** branches.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEPLOY_TXT = '.github/shopify/deploy.txt';
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BOOLEANS = { true: true, yes: true, false: false, no: false };

/** Parse deploy.txt; never throws, returns the issues instead. */
export function parseDeployOptions(text) {
  const options = {};
  const issues = [];
  (text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^([a-z_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      issues.push(`${DEPLOY_TXT} line ${i + 1}: expected key = value`);
      return;
    }
    const [, key, value] = m;
    if (key === 'release') {
      const b = BOOLEANS[value.toLowerCase()];
      if (b === undefined) issues.push(`${DEPLOY_TXT} line ${i + 1}: release must be true or false`);
      else options.release = b;
    } else if (key === 'message') {
      // eslint-disable-next-line no-control-regex
      if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) issues.push(`${DEPLOY_TXT} line ${i + 1}: message must be one line of 1 to 200 characters`);
      else options.message = value;
    } else if (key === 'version') {
      if (!VERSION_RE.test(value)) issues.push(`${DEPLOY_TXT} line ${i + 1}: version must be 1 to 64 letters, digits, '.', '_' or '-'`);
      else options.version = value;
    } else {
      issues.push(`${DEPLOY_TXT} line ${i + 1}: unknown key '${key}' (release, message, version)`);
    }
  });
  return { options, issues };
}

/** True when any commit of a push event added or modified `path`. */
export function pushTouched(payload, path) {
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  return commits.some((c) => [...(c?.added ?? []), ...(c?.modified ?? [])].includes(path));
}

/**
 * @param {{ eventName: string, ref: string, payload?: unknown, deployTxt?: string | null,
 *   inputs?: { release?: string, message?: string }, sha: string, runNumber: string | number, runAttempt?: string | number }} ctx
 */
export function planShopifyDeploy(ctx) {
  const branch = ctx.ref.startsWith('refs/heads/') ? ctx.ref.slice('refs/heads/'.length) : ctx.ref;
  const sha12 = String(ctx.sha).slice(0, 12);
  const base = { deploy: false, release: false, message: '', version: '', issues: [], reason: '' };

  let reason;
  if (ctx.eventName === 'workflow_dispatch') reason = `manual run on ${branch}`;
  else if (ctx.eventName === 'push' && branch === 'release') reason = 'push to release';
  else if (ctx.eventName === 'push' && branch.startsWith('claude/')) {
    if (!pushTouched(ctx.payload, DEPLOY_TXT)) return { ...base, reason: `push to ${branch} did not change ${DEPLOY_TXT}` };
    reason = `${DEPLOY_TXT} changed on ${branch}`;
  } else return { ...base, reason: `${ctx.eventName} on ${branch} never deploys` };

  const { options, issues } = parseDeployOptions(ctx.deployTxt ?? '');
  const input = ctx.inputs ?? {};
  let release = branch === 'release';
  if (options.release !== undefined) release = options.release;
  if (ctx.eventName === 'workflow_dispatch' && input.release) {
    const b = BOOLEANS[String(input.release).toLowerCase()];
    if (b === undefined) issues.push('input release must be true or false');
    else release = b;
  }
  let message = options.message ?? `${branch} ${sha12}`;
  if (ctx.eventName === 'workflow_dispatch' && input.message) {
    // eslint-disable-next-line no-control-regex
    if (input.message.length > 200 || /[\u0000-\u001f\u007f]/.test(input.message)) issues.push('input message must be one line of at most 200 characters');
    else message = input.message;
  }
  const attempt = ctx.runAttempt ?? 1;
  const version = options.version ?? `git-${sha12}-r${ctx.runNumber}-${attempt}`;
  return { deploy: issues.length === 0, release, message, version, issues, reason };
}

function main() {
  const env = process.env;
  const payload = env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const deployTxtPath = env.DEPLOY_TXT_PATH ?? DEPLOY_TXT;
  const plan = planShopifyDeploy({
    eventName: env.GITHUB_EVENT_NAME ?? '',
    ref: env.GITHUB_REF ?? '',
    payload,
    deployTxt: existsSync(deployTxtPath) ? readFileSync(deployTxtPath, 'utf8') : null,
    inputs: { release: env.INPUT_RELEASE, message: env.INPUT_MESSAGE },
    sha: env.GITHUB_SHA ?? '',
    runNumber: env.GITHUB_RUN_NUMBER ?? '0',
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? '1',
  });
  console.log(`plan: ${plan.reason}`);
  for (const issue of plan.issues) console.error(`plan: ${issue}`);
  if (plan.deploy) console.log(`plan: deploy version ${plan.version}, ${plan.release ? 'and release it to merchants' : 'not released (--no-release)'}`);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, [`deploy=${plan.deploy}`, `release=${plan.release}`, `message=${plan.message}`, `version=${plan.version}`, `reason=${plan.reason}`].join('\n') + '\n');
  }
  if (plan.issues.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
