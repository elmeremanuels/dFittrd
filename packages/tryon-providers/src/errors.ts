/**
 * Typed errors. `fallthrough` tells the TryOnRouter whether trying the next provider makes sense:
 * a pose failure, a timeout or a vendor outage might succeed elsewhere; a moderation refusal, a
 * malformed input or a policy violation would not.
 */
export type TryOnErrorCode =
  | 'pose'
  | 'timeout'
  | 'rate_limit'
  | 'auth'
  | 'provider'
  | 'disabled'
  | 'moderation'
  | 'image'
  | 'unsupported'
  | 'config'
  | 'policy'
  | 'budget'
  | 'aborted'
  | 'no_provider';

export interface TryOnErrorInit {
  provider?: string;
  cause?: unknown;
  httpStatus?: number;
  vendorCode?: string;
}

export class TryOnError extends Error {
  readonly code: TryOnErrorCode;
  readonly fallthrough: boolean;
  readonly provider: string | undefined;
  readonly httpStatus: number | undefined;
  readonly vendorCode: string | undefined;

  constructor(code: TryOnErrorCode, fallthrough: boolean, message: string, init: TryOnErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.code = code;
    this.fallthrough = fallthrough;
    this.provider = init.provider;
    this.httpStatus = init.httpStatus;
    this.vendorCode = init.vendorCode;
  }
}

/** The engine could not detect a body pose in the person (or on-model garment) image. */
export class PoseError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('pose', true, message, init);
  }
}

export class TimeoutError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('timeout', true, message, init);
  }
}

export class RateLimitError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('rate_limit', true, message, init);
  }
}

export class AuthError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('auth', true, message, init);
  }
}

/** Vendor-side failure (5xx, pipeline error, malformed response). */
export class ProviderError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('provider', true, message, init);
  }
}

/** Adapter exists but is switched off by configuration (e.g. VERTEX_TRYON_ENABLED unset). */
export class ProviderDisabledError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('disabled', true, message, init);
  }
}

export class ModerationError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('moderation', false, message, init);
  }
}

/** The input images could not be decoded/loaded by the vendor or by sharp. */
export class ImageInputError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('image', false, message, init);
  }
}

export class UnsupportedError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('unsupported', false, message, init);
  }
}

export class ConfigError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('config', false, message, init);
  }
}

export class PolicyError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('policy', false, message, init);
  }
}

export class BudgetExceededError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('budget', false, message, init);
  }
}

export class AbortedError extends TryOnError {
  constructor(message: string, init?: TryOnErrorInit) {
    super('aborted', false, message, init);
  }
}

export interface RouterAttempt {
  provider: string;
  reason: string;
  error?: TryOnError;
}

export class NoProviderAvailableError extends TryOnError {
  readonly attempts: readonly RouterAttempt[];
  constructor(message: string, attempts: RouterAttempt[]) {
    super('no_provider', false, message);
    this.attempts = attempts;
  }
}

export function isTryOnError(e: unknown): e is TryOnError {
  return e instanceof TryOnError;
}

/** Wrap anything thrown by a transport into a typed error. */
export function toTryOnError(e: unknown, provider: string): TryOnError {
  if (e instanceof TryOnError) return e;
  if (e instanceof Error && e.name === 'AbortError') {
    return new AbortedError(`${provider}: request aborted`, { provider, cause: e });
  }
  if (e instanceof Error && (e.name === 'TimeoutError' || /timed? ?out/i.test(e.message))) {
    return new TimeoutError(`${provider}: ${e.message}`, { provider, cause: e });
  }
  const message = e instanceof Error ? e.message : String(e);
  return new ProviderError(`${provider}: ${message}`, { provider, cause: e });
}
