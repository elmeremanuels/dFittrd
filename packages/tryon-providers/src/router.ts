import { BudgetExceededError, NoProviderAvailableError, PolicyError, UnsupportedError, toTryOnError } from './errors.js';
import type { RouterAttempt, TryOnError } from './errors.js';
import { realClock } from './http.js';
import type { Clock } from './http.js';
import { assertAvatarRender } from './providers/fashn.js';
import { ProviderRegistry } from './registry.js';
import type {
  GarmentInput,
  LedgerRecord,
  PersonInput,
  TryOnOptions,
  TryOnProvider,
  TryOnResult,
  VideoOptions,
  VideoResult,
} from './types.js';

export interface RouterPolicy {
  /** Provider names in preference order (env TRYON_ORDER, e.g. "fashn,vertex-tryon"). Unknown names are skipped. */
  order: string[];
  /** Hard ceiling per render; a provider whose estimate exceeds it is skipped. */
  maxCostUsd: number;
  /** Skip providers whose privacy.euResidency is false. */
  requireEuResidency?: boolean;
  /** Daily spend ceiling across all providers (UTC day). */
  dailyCapUsd?: number;
}

/** Spend accounting; the default is in-memory (fine for the single API process, D2). */
export interface SpendStore {
  /** USD spent so far on the given UTC day (YYYY-MM-DD). */
  get(day: string): Promise<number> | number;
  add(day: string, usd: number): Promise<void> | void;
}

export class MemorySpendStore implements SpendStore {
  private readonly byDay = new Map<string, number>();
  get(day: string): number {
    return this.byDay.get(day) ?? 0;
  }
  add(day: string, usd: number): void {
    this.byDay.set(day, (this.byDay.get(day) ?? 0) + usd);
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the provider is skipped (default 3). */
  failureThreshold?: number;
  /** How long a tripped provider is skipped (default 60 000 ms). */
  cooldownMs?: number;
}

export interface CircuitState {
  consecutiveFailures: number;
  openUntil: number | null;
}

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();
  readonly failureThreshold: number;
  readonly cooldownMs: number;

  constructor(opts: CircuitBreakerOptions = {}, private readonly clock: Clock = realClock) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
  }

  private state(name: string): CircuitState {
    let s = this.states.get(name);
    if (!s) {
      s = { consecutiveFailures: 0, openUntil: null };
      this.states.set(name, s);
    }
    return s;
  }

  /** True while the provider should be skipped. Expired cooldowns close half-open (one attempt allowed). */
  isOpen(name: string): boolean {
    const s = this.state(name);
    if (s.openUntil === null) return false;
    if (this.clock() >= s.openUntil) {
      s.openUntil = null; // half-open: allow a probe; another failure re-opens immediately
      s.consecutiveFailures = Math.max(0, this.failureThreshold - 1);
      return false;
    }
    return true;
  }

  recordSuccess(name: string): void {
    const s = this.state(name);
    s.consecutiveFailures = 0;
    s.openUntil = null;
  }

  recordFailure(name: string): void {
    const s = this.state(name);
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.failureThreshold) {
      s.openUntil = this.clock() + this.cooldownMs;
    }
  }

  snapshot(): Record<string, CircuitState> {
    const out: Record<string, CircuitState> = {};
    for (const [k, v] of this.states) out[k] = { ...v };
    return out;
  }
}

export interface TryOnRouterConfig {
  providers: Iterable<TryOnProvider> | ProviderRegistry;
  policy: RouterPolicy;
  circuit?: CircuitBreakerOptions;
  spend?: SpendStore;
  clock?: Clock;
  /** Called after every ledger-worthy render (success only). */
  onLedger?: (record: LedgerRecord) => void | Promise<void>;
  /** Called for every skipped/failed provider (observability). */
  onAttempt?: (attempt: RouterAttempt) => void;
}

export interface RoutedTryOn {
  result: TryOnResult;
  ledger: LedgerRecord;
  /** Providers that were skipped or failed before the winning one. */
  attempts: RouterAttempt[];
}

export interface RoutedVideo {
  result: VideoResult;
  ledger: LedgerRecord;
  attempts: RouterAttempt[];
}

/**
 * Picks the first provider in `policy.order` that is healthy, supports the garment category,
 * satisfies the privacy policy and fits the budget; falls through to the next one on errors that
 * another engine might not hit (PoseError, timeouts, rate limits, vendor 5xx, auth, disabled).
 * Trips a per-provider circuit breaker after 3 consecutive failures (60 s cooldown).
 */
export class TryOnRouter {
  readonly registry: ProviderRegistry;
  readonly policy: RouterPolicy;
  readonly circuit: CircuitBreaker;
  private readonly spend: SpendStore;
  private readonly clock: Clock;
  private readonly onLedger: TryOnRouterConfig['onLedger'];
  private readonly onAttempt: TryOnRouterConfig['onAttempt'];

  constructor(config: TryOnRouterConfig) {
    this.registry = config.providers instanceof ProviderRegistry ? config.providers : new ProviderRegistry(config.providers);
    this.policy = { ...config.policy, order: [...config.policy.order] };
    this.clock = config.clock ?? realClock;
    this.circuit = new CircuitBreaker(config.circuit, this.clock);
    this.spend = config.spend ?? new MemorySpendStore();
    this.onLedger = config.onLedger;
    this.onAttempt = config.onAttempt;
    if (this.policy.order.length === 0) throw new PolicyError('TryOnRouter: policy.order is empty');
    if (!(this.policy.maxCostUsd > 0)) throw new PolicyError('TryOnRouter: policy.maxCostUsd must be > 0');
  }

  async render(person: PersonInput, garment: GarmentInput, opts: TryOnOptions, signal?: AbortSignal): Promise<RoutedTryOn> {
    // Hard rule 1 / D3, enforced once at the router boundary as well as in each adapter: the
    // request arrived as JSON, so the type alone does not stop a raw photo or a missing consent.
    assertAvatarRender(person, 'router');
    const attempts: RouterAttempt[] = [];
    for (const name of this.policy.order) {
      const provider = this.registry.get(name);
      if (!provider) {
        this.skip(attempts, name, 'not registered');
        continue;
      }
      if (!provider.capabilities.categories.includes(garment.category)) {
        this.skip(attempts, name, `does not support category "${garment.category}"`);
        continue;
      }
      const cost = provider.estimateCost(opts);
      const gate = await this.gate(provider, cost, attempts);
      if (!gate) continue;
      const started = this.clock();
      let result: TryOnResult;
      try {
        result = await provider.tryOn(person, garment, opts, signal);
      } catch (e) {
        const err = toTryOnError(e, name);
        if (!this.handleFailure(name, err, attempts, this.clock() - started)) throw err;
        continue;
      }
      // Settle OUTSIDE the try: the render succeeded and was paid for. A spend-store or ledger
      // failure must surface to the caller, not be mistaken for a vendor fault (which would trip
      // the breaker and buy a second render from the next provider).
      return { result, ledger: await this.settle(provider, result.model, result.costUsd, result.latencyMs, 'image'), attempts };
    }
    throw new NoProviderAvailableError(
      `no try-on provider available for category "${garment.category}" (${attempts.map((a) => `${a.provider}: ${a.reason}`).join('; ')})`,
      attempts,
    );
  }

  /** Animates an already rendered still (hero video). Same policy; only providers with `video` + `animate`. */
  async animate(still: Uint8Array, garment: GarmentInput, opts: VideoOptions, signal?: AbortSignal): Promise<RoutedVideo> {
    const attempts: RouterAttempt[] = [];
    for (const name of this.policy.order) {
      const provider = this.registry.get(name);
      if (!provider) {
        this.skip(attempts, name, 'not registered');
        continue;
      }
      if (!provider.capabilities.video || !provider.animate) {
        this.skip(attempts, name, 'no video support');
        continue;
      }
      const cost = provider.estimateVideoCost ? provider.estimateVideoCost(opts) : Number.POSITIVE_INFINITY;
      const gate = await this.gate(provider, cost, attempts);
      if (!gate) continue;
      const started = this.clock();
      let result: VideoResult;
      try {
        result = await provider.animate(still, garment, opts, signal);
      } catch (e) {
        const err = toTryOnError(e, name);
        if (!this.handleFailure(name, err, attempts, this.clock() - started)) throw err;
        continue;
      }
      return {
        result,
        ledger: await this.settle(provider, result.model, result.costUsd, this.clock() - started, 'video'),
        attempts,
      };
    }
    throw new NoProviderAvailableError(
      `no video provider available (${attempts.map((a) => `${a.provider}: ${a.reason}`).join('; ')})`,
      attempts,
    );
  }

  /** Spend so far on the current UTC day. */
  async spentTodayUsd(): Promise<number> {
    return this.spend.get(utcDay(this.clock()));
  }

  /** Policy + health + budget checks shared by render() and animate(). Returns false when skipped. */
  private async gate(provider: TryOnProvider, cost: number, attempts: RouterAttempt[]): Promise<boolean> {
    const name = provider.name;
    if (this.circuit.isOpen(name)) {
      this.skip(attempts, name, 'circuit open');
      return false;
    }
    if (this.policy.requireEuResidency && !provider.capabilities.privacy.euResidency) {
      this.skip(attempts, name, 'no EU residency', new PolicyError(`${name}: policy requires EU residency`, { provider: name }));
      return false;
    }
    if (provider.capabilities.privacy.trainsOnInputs) {
      this.skip(attempts, name, 'trains on inputs', new PolicyError(`${name}: trains on inputs`, { provider: name }));
      return false;
    }
    if (!Number.isFinite(cost) || cost > this.policy.maxCostUsd) {
      this.skip(
        attempts,
        name,
        `estimated $${fmt(cost)} exceeds maxCostUsd $${fmt(this.policy.maxCostUsd)}`,
        new BudgetExceededError(`${name}: estimated $${fmt(cost)} exceeds maxCostUsd $${fmt(this.policy.maxCostUsd)}`, {
          provider: name,
        }),
      );
      return false;
    }
    if (typeof this.policy.dailyCapUsd === 'number') {
      const spent = await this.spend.get(utcDay(this.clock()));
      if (spent + cost > this.policy.dailyCapUsd) {
        this.skip(
          attempts,
          name,
          `daily cap: $${fmt(spent)} spent + $${fmt(cost)} > $${fmt(this.policy.dailyCapUsd)}`,
          new BudgetExceededError(`${name}: daily cap of $${fmt(this.policy.dailyCapUsd)} reached`, { provider: name }),
        );
        return false;
      }
    }
    let health;
    try {
      health = await provider.healthCheck();
    } catch (e) {
      health = { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    if (!health.ok) {
      this.skip(attempts, name, `unhealthy: ${health.reason ?? 'healthCheck failed'}`);
      return false;
    }
    return true;
  }

  private async settle(provider: TryOnProvider, model: string, costUsd: number, latencyMs: number, kind: 'image' | 'video'): Promise<LedgerRecord> {
    this.circuit.recordSuccess(provider.name);
    const now = this.clock();
    await this.spend.add(utcDay(now), costUsd);
    const record: LedgerRecord = {
      provider: provider.name,
      model,
      costUsd,
      retentionHours: provider.capabilities.privacy.retentionHours,
      trainedOn: provider.capabilities.privacy.trainsOnInputs ? 'unknown' : false,
      region: provider.capabilities.region,
      kind,
      latencyMs,
      at: new Date(now).toISOString(),
    };
    await this.onLedger?.(record);
    return record;
  }

  /** Returns true when the router should move on to the next provider. */
  private handleFailure(name: string, err: TryOnError, attempts: RouterAttempt[], latencyMs: number): boolean {
    // Unsupported/config/policy mistakes are not vendor faults: do not trip the breaker.
    const vendorFault = !(err instanceof UnsupportedError) && err.code !== 'config' && err.code !== 'policy' && err.code !== 'aborted';
    if (vendorFault) this.circuit.recordFailure(name);
    const reason = `${err.code}: ${err.message} (${latencyMs} ms)`;
    this.skip(attempts, name, reason, err);
    return err.fallthrough || err instanceof UnsupportedError;
  }

  private skip(attempts: RouterAttempt[], provider: string, reason: string, error?: TryOnError): void {
    const attempt: RouterAttempt = error ? { provider, reason, error } : { provider, reason };
    attempts.push(attempt);
    this.onAttempt?.(attempt);
  }
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : '∞';
}

/** Parses TRYON_ORDER ("fashn, vertex-tryon") into a provider order. */
export function parseOrder(value: string | undefined, fallback: string[] = ['fashn', 'vertex-tryon']): string[] {
  if (!value) return [...fallback];
  const names = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? names : [...fallback];
}
