import { fetch as undiciFetch } from 'undici';
import { AbortedError, AuthError, ProviderError, RateLimitError, TimeoutError } from './errors.js';
import type { FetchLike, FetchResponseLike } from './types.js';

/** Default transport: undici's fetch (same engine as Node's global fetch, but mockable with MockAgent). */
export const defaultFetch: FetchLike = (url, init) =>
  undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<FetchResponseLike>;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(t);
      reject(abortReason(signal!));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

function abortReason(signal: AbortSignal): Error {
  const r: unknown = signal.reason;
  if (r instanceof Error) return r;
  const e = new Error(typeof r === 'string' ? r : 'aborted');
  e.name = 'AbortError';
  return e;
}

/** Monotonic clock, injectable for tests. */
export type Clock = () => number;
export const realClock: Clock = () => Date.now();

/**
 * A deadline shared by every HTTP call of one try-on. Combines the caller's AbortSignal with an
 * overall timeout and tells the difference between the two when it fires.
 */
export class Deadline {
  readonly controller = new AbortController();
  private timedOut = false;
  private readonly timer: NodeJS.Timeout | undefined;
  private readonly parent: AbortSignal | undefined;
  private readonly onParentAbort: (() => void) | undefined;

  constructor(
    readonly timeoutMs: number,
    parent?: AbortSignal,
  ) {
    if (parent?.aborted) this.controller.abort(parent.reason);
    else if (parent) {
      // Removed again in dispose(): a long-lived parent (e.g. a job-level signal) must not
      // accumulate one listener per try-on.
      this.parent = parent;
      this.onParentAbort = () => this.controller.abort(parent.reason);
      parent.addEventListener('abort', this.onParentAbort, { once: true });
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      this.timer = setTimeout(() => {
        this.timedOut = true;
        this.controller.abort(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.timer.unref?.();
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Converts an abort into the matching typed error. */
  classify(provider: string, cause?: unknown): TimeoutError | AbortedError {
    if (this.timedOut) {
      return new TimeoutError(`${provider}: timed out after ${this.timeoutMs} ms`, { provider, cause });
    }
    return new AbortedError(`${provider}: request aborted by caller`, { provider, cause });
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.parent && this.onParentAbort) this.parent.removeEventListener('abort', this.onParentAbort);
  }
}

export interface JsonRequestInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface JsonResponse<T = unknown> {
  status: number;
  headers: FetchResponseLike['headers'];
  body: T;
  rawText: string;
}

/**
 * Sends a JSON request and parses the JSON body. Maps transport-level failures to typed errors:
 * 401/403 → AuthError, 429 → RateLimitError, 5xx → ProviderError, abort → Timeout/Aborted.
 * 4xx other than those are returned to the caller (vendors put domain errors there).
 */
export async function requestJson<T = unknown>(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  init: JsonRequestInit,
  deadline: Deadline,
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['content-type'] = 'application/json';
  }
  let res: FetchResponseLike;
  try {
    res = await fetchImpl(url, { method: init.method ?? 'GET', headers, body, signal: deadline.signal });
  } catch (e) {
    if (deadline.aborted) throw deadline.classify(provider, e);
    throw new ProviderError(`${provider}: network error: ${e instanceof Error ? e.message : String(e)}`, {
      provider,
      cause: e,
    });
  }
  let rawText: string;
  try {
    rawText = await res.text();
  } catch (e) {
    if (deadline.aborted) throw deadline.classify(provider, e);
    throw new ProviderError(`${provider}: could not read response body`, { provider, cause: e });
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`${provider}: authentication failed (HTTP ${res.status})`, { provider, httpStatus: res.status });
  }
  if (res.status === 429) {
    throw new RateLimitError(`${provider}: rate limited (HTTP 429)`, { provider, httpStatus: 429 });
  }
  if (res.status >= 500) {
    throw new ProviderError(`${provider}: vendor error (HTTP ${res.status}) ${truncate(rawText)}`, {
      provider,
      httpStatus: res.status,
    });
  }
  let parsed: unknown = null;
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      throw new ProviderError(`${provider}: non-JSON response (HTTP ${res.status}) ${truncate(rawText)}`, {
        provider,
        httpStatus: res.status,
        cause: e,
      });
    }
  }
  return { status: res.status, headers: res.headers, body: parsed as T, rawText };
}

/** Downloads a binary resource (vendor CDN output, our own upload target). */
export async function requestBytes(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  deadline: Deadline,
  headers: Record<string, string> = {},
): Promise<Uint8Array> {
  let res: FetchResponseLike;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal: deadline.signal });
  } catch (e) {
    if (deadline.aborted) throw deadline.classify(provider, e);
    throw new ProviderError(`${provider}: download failed: ${e instanceof Error ? e.message : String(e)}`, {
      provider,
      cause: e,
    });
  }
  if (!res.ok) {
    throw new ProviderError(`${provider}: download failed (HTTP ${res.status}) for ${redact(url)}`, {
      provider,
      httpStatus: res.status,
    });
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export function truncate(s: string, n = 200): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Strips query strings (signed URLs) before a URL goes into an error message or a log. */
export function redact(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : `${url.slice(0, q)}?…`;
}

/** Rolling latency sample used for healthCheck().p50LatencyMs. */
export class LatencyTracker {
  private readonly samples: number[] = [];
  constructor(private readonly size = 20) {}

  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }

  p50(): number | undefined {
    if (this.samples.length === 0) return undefined;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }
}

export interface PollOptions<T> {
  provider: string;
  intervalMs: number;
  deadline: Deadline;
  sleep: Sleep;
  /** Returns the final value when done, or `undefined` to keep polling. */
  step: () => Promise<T | undefined>;
}

/** Polls `step` until it returns a value, the deadline fires, or the caller aborts. */
export async function poll<T>(opts: PollOptions<T>): Promise<T> {
  for (;;) {
    if (opts.deadline.aborted) throw opts.deadline.classify(opts.provider);
    const value = await opts.step();
    if (value !== undefined) return value;
    try {
      await opts.sleep(opts.intervalMs, opts.deadline.signal);
    } catch (e) {
      throw opts.deadline.classify(opts.provider, e);
    }
  }
}
