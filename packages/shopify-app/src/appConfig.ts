/**
 * shopify.app.toml handling. The committed file is a template with `{{VAR}}` placeholders
 * (Shopify CLI has no env interpolation and the client_id must not be committed for the pilot's
 * custom-distribution app). `pnpm configure` renders `shopify.app.<env>.toml`; `validateAppConfig`
 * checks the parsed TOML against what the api expects (webhook topics, path, managed install).
 */
import { DEFAULT_API_VERSION } from './types';
import { ALL_WEBHOOK_TOPICS, SHOPIFY_COMPLIANCE_TOPICS, SHOPIFY_WEBHOOK_TOPICS, WEBHOOK_PATH } from './webhookHmac';

export const APP_CONFIG_VARS = ['SHOPIFY_API_KEY', 'PUBLIC_API_URL', 'PUBLIC_APP_URL', 'SHOPIFY_API_VERSION', 'SHOPIFY_DEV_STORE', 'SHOPIFY_APP_HANDLE'] as const;
export type AppConfigVar = (typeof APP_CONFIG_VARS)[number];

export const APP_CONFIG_DEFAULTS: Partial<Record<AppConfigVar, string>> = {
  SHOPIFY_API_VERSION: DEFAULT_API_VERSION,
  SHOPIFY_DEV_STORE: '',
  SHOPIFY_APP_HANDLE: 'curtain',
};

export const REQUIRED_SCOPES = ['read_products', 'write_products'] as const;
/** D7: order attribution is off by default; `read_orders` is only added when the founder enables it. */
export const OPTIONAL_SCOPES = ['read_orders'] as const;

const PLACEHOLDER_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

export class AppConfigError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = 'AppConfigError';
  }
}

/** Replace `{{VAR}}` placeholders; throws listing every unresolved or unknown variable. */
export function renderAppConfig(template: string, vars: Partial<Record<AppConfigVar, string | undefined>>): string {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const substitute = (line: string): string =>
    line.replace(PLACEHOLDER_RE, (_m, name: string) => {
      if (!(APP_CONFIG_VARS as readonly string[]).includes(name)) {
        unknown.add(name);
        return '';
      }
      const v = vars[name as AppConfigVar] ?? APP_CONFIG_DEFAULTS[name as AppConfigVar];
      if (v === undefined || (v === '' && name !== 'SHOPIFY_DEV_STORE')) {
        missing.add(name);
        return '';
      }
      return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    });
  // Full-line TOML comments are left untouched (they may mention the {{VAR}} syntax itself).
  const out = template.split('\n').map((line) => (/^\s*#/.test(line) ? line : substitute(line)));
  const issues = [...[...missing].map((m) => `missing value for {{${m}}}`), ...[...unknown].map((u) => `unknown placeholder {{${u}}}`)];
  if (issues.length) throw new AppConfigError(`shopify.app.toml: ${issues.join('; ')}`, issues);
  // Lines with an empty optional value (dev_store_url = "") are dropped so the CLI prompts instead.
  return out.filter((line) => !/^\s*[a-z_]+\s*=\s*""\s*$/.test(line)).join('\n');
}

export interface ParsedAppConfig {
  name?: unknown;
  client_id?: unknown;
  application_url?: unknown;
  embedded?: unknown;
  handle?: unknown;
  access_scopes?: { scopes?: unknown; use_legacy_install_flow?: unknown; optional_scopes?: unknown };
  auth?: { redirect_urls?: unknown };
  webhooks?: { api_version?: unknown; subscriptions?: Array<{ topics?: unknown; compliance_topics?: unknown; uri?: unknown }> };
  [k: string]: unknown;
}

export interface AppConfigValidation {
  ok: boolean;
  issues: string[];
  topics: string[];
  complianceTopics: string[];
  scopes: string[];
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Structural checks against the api's contracts (does not talk to Shopify). */
export function validateAppConfig(parsed: unknown, opts: { apiUrl?: string } = {}): AppConfigValidation {
  const issues: string[] = [];
  const c = (parsed ?? {}) as ParsedAppConfig;

  if (typeof c.client_id !== 'string' || !/^[a-f0-9]{32}$/i.test(c.client_id)) issues.push('client_id must be the 32-hex client id from the Partner Dashboard');
  if (typeof c.application_url !== 'string' || !/^https:\/\//.test(c.application_url)) issues.push('application_url must be an https URL');
  if (c.embedded !== true) issues.push('embedded must be true (App Bridge admin page)');
  if (typeof c.name !== 'string' || !c.name) issues.push('name is required');

  const scopes = typeof c.access_scopes?.scopes === 'string' ? c.access_scopes.scopes.split(',').map((s) => s.trim()).filter(Boolean) : [];
  for (const s of REQUIRED_SCOPES) if (!scopes.includes(s)) issues.push(`access_scopes.scopes must include ${s}`);
  if (c.access_scopes?.use_legacy_install_flow === true) issues.push('use_legacy_install_flow must be false (managed installation, D6)');
  for (const s of scopes) {
    if (!(REQUIRED_SCOPES as readonly string[]).includes(s) && !(OPTIONAL_SCOPES as readonly string[]).includes(s)) issues.push(`unexpected scope ${s} (Protected Customer Data minimum, D7)`);
  }

  const redirects = asStringArray(c.auth?.redirect_urls);
  if (redirects.length === 0) issues.push('auth.redirect_urls must list at least one https URL');
  for (const r of redirects) if (!/^https:\/\//.test(r)) issues.push(`auth.redirect_urls entry is not https: ${r}`);

  if (typeof c.webhooks?.api_version !== 'string' || !/^\d{4}-\d{2}$/.test(c.webhooks.api_version)) issues.push(`webhooks.api_version must look like YYYY-MM (e.g. ${DEFAULT_API_VERSION})`);
  const subs = Array.isArray(c.webhooks?.subscriptions) ? c.webhooks!.subscriptions! : [];
  const topics: string[] = [];
  const complianceTopics: string[] = [];
  for (const s of subs) {
    const t = asStringArray(s.topics);
    const ct = asStringArray(s.compliance_topics);
    topics.push(...t);
    complianceTopics.push(...ct);
    const uri = typeof s.uri === 'string' ? s.uri : '';
    const okUri = uri === WEBHOOK_PATH || (opts.apiUrl ? uri === `${opts.apiUrl.replace(/\/$/, '')}${WEBHOOK_PATH}` : /^https:\/\/[^/]+\/shopify\/webhooks$/.test(uri));
    if (!okUri) issues.push(`subscription uri must be ${WEBHOOK_PATH} (relative) or https://<api>${WEBHOOK_PATH}: got '${uri}'`);
  }
  for (const t of SHOPIFY_WEBHOOK_TOPICS) if (!topics.includes(t)) issues.push(`webhook topic ${t} is not subscribed`);
  for (const t of SHOPIFY_COMPLIANCE_TOPICS) if (!complianceTopics.includes(t)) issues.push(`compliance topic ${t} is not declared`);
  for (const t of topics) if (!(ALL_WEBHOOK_TOPICS as readonly string[]).includes(t)) issues.push(`topic ${t} has no handler in the api`);

  return { ok: issues.length === 0, issues, topics, complianceTopics, scopes };
}
