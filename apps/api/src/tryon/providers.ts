/**
 * Builds the TryOnRouter from env (D4): provider order TRYON_ORDER (default 'mock'), keys only
 * from env.ts. Nothing here ever receives a raw user photo — PersonInput.kind is 'avatarRender'.
 */
import {
  FashnProvider,
  GrokVideoProvider,
  MemorySpendStore,
  MockProvider,
  TryOnRouter,
  VertexTryOnProvider,
  parseOrder,
  type LedgerRecord,
  type SpendStore,
  type TryOnProvider,
} from '@curtain/tryon-providers';
import type { Env } from '../env.js';

export interface BuildRouterOptions {
  env: Env;
  spend?: SpendStore;
  onLedger?: (record: LedgerRecord) => void | Promise<void>;
  extraProviders?: TryOnProvider[];
  fetchImpl?: typeof fetch;
}

export function providersFromEnv(env: Env, fetchImpl?: typeof fetch): TryOnProvider[] {
  const list: TryOnProvider[] = [];
  const fetchOpt = fetchImpl ? { fetch: fetchImpl as never } : {};
  if (env.FASHN_API_KEY) {
    list.push(new FashnProvider({ apiKey: env.FASHN_API_KEY, model: 'tryon-v1.6', euResidencyConfirmed: env.FASHN_EU_RESIDENCY_CONFIRMED, ...fetchOpt }));
    list.push(new FashnProvider({ apiKey: env.FASHN_API_KEY, model: 'tryon-max', name: 'fashn-max', euResidencyConfirmed: env.FASHN_EU_RESIDENCY_CONFIRMED, ...fetchOpt }));
  }
  if (env.VERTEX_TRYON_ENABLED && env.VERTEX_PROJECT) {
    list.push(
      new VertexTryOnProvider({
        enabled: true,
        projectId: env.VERTEX_PROJECT,
        location: env.VERTEX_LOCATION,
        getAccessToken: () => vertexAccessToken(env, fetchImpl ?? fetch),
        ...fetchOpt,
      }),
    );
  }
  if (env.XAI_API_KEY) {
    list.push(new GrokVideoProvider({ apiKey: env.XAI_API_KEY, zdr: env.XAI_ZDR, ...fetchOpt }));
  }
  list.push(new MockProvider({ video: true }));
  return list;
}

/** Static token for dev (VERTEX_ACCESS_TOKEN) or the GCE/Cloud Run metadata server in production. */
async function vertexAccessToken(env: Env, fetchImpl: typeof fetch): Promise<string> {
  if (env.VERTEX_ACCESS_TOKEN) return env.VERTEX_ACCESS_TOKEN;
  const res = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!res.ok) throw new Error(`metadata server token failed (${res.status})`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export function buildRouter(opts: BuildRouterOptions): TryOnRouter {
  const { env } = opts;
  const providers = [...(opts.extraProviders ?? []), ...providersFromEnv(env, opts.fetchImpl)];
  const cfg = {
    providers,
    policy: {
      order: parseOrder(env.TRYON_ORDER, ['mock']),
      maxCostUsd: env.TRYON_MAX_COST_USD,
      requireEuResidency: env.TRYON_REQUIRE_EU,
      dailyCapUsd: env.TRYON_DAILY_CAP_USD,
    },
    spend: opts.spend ?? new MemorySpendStore(),
    ...(opts.onLedger ? { onLedger: opts.onLedger } : {}),
  };
  return new TryOnRouter(cfg);
}
