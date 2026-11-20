import {
  ConfigError,
  ImageInputError,
  ModerationError,
  PoseError,
  ProviderError,
  UnsupportedError,
  toTryOnError,
} from '../errors.js';
import { Deadline, LatencyTracker, defaultFetch, poll, realSleep, requestBytes, requestJson, truncate } from '../http.js';
import type { Sleep } from '../http.js';
import { fromBase64OrDataUri, normaliseImage, toDataUri, toPng } from '../image.js';
import { promptFromMetadata } from '../promptFromMetadata.js';
import { DISCLAIMER } from '../types.js';
import type {
  FetchLike,
  GarmentCategory,
  GarmentInput,
  HealthStatus,
  PersonInput,
  ProviderCapabilities,
  Quality,
  Resolution,
  TryOnOptions,
  TryOnProvider,
  TryOnResult,
} from '../types.js';

/**
 * FASHN hosted API (https://docs.fashn.ai). Primary engine per decision D4.
 *
 * Documented shape (checked 2026-11-04 against docs.fashn.ai/api-reference/tryon-v1-6,
 * /api-reference/tryon-max and /api-overview/api-fundamentals):
 *   POST {baseUrl}/v1/run   { model_name, inputs: {...} }  →  { id, error }
 *   GET  {baseUrl}/v1/status/{id}  →  { id, status: starting|in_queue|processing|completed|failed,
 *                                        output?: string[], error?: { name, message } | null }
 * Rate limits: /v1/run 100 req / 60 s, /v1/status 50 req / 10 s, 6 concurrent predictions.
 * Pricing: $0.075 per credit; tryon-v1.6 = 1 credit per sample; tryon-max = 1–5 credits per
 * image depending on generation_mode × resolution. Failed predictions are not charged.
 * Privacy: base64 inputs deleted when the prediction completes, base64 outputs kept ≤ 60 min
 * (CDN URLs 3 days), no training unless opt-in. Processing region is not documented.
 */

export const FASHN_BASE_URL = 'https://api.fashn.ai';
export const FASHN_USD_PER_CREDIT = 0.075;

export type FashnModel = 'tryon-v1.6' | 'tryon-max';
export type FashnCategory = 'auto' | 'tops' | 'bottoms' | 'one-pieces';
export type FashnGarmentPhotoType = 'auto' | 'flat-lay' | 'model';
export type FashnMode = 'performance' | 'balanced' | 'quality';
export type FashnMaxMode = 'fast' | 'balanced' | 'quality';

export interface FashnProviderConfig {
  apiKey: string;
  /** Default 'tryon-v1.6'. Use 'tryon-max' for the shareable hero still and for shoes/accessories. */
  model?: FashnModel;
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: Sleep;
  /** Poll interval for /v1/status (default 2000 ms; stays within 50 req / 10 s). */
  pollIntervalMs?: number;
  /** Overall deadline per try-on when opts.timeoutMs is absent (default 90 000 ms). */
  defaultTimeoutMs?: number;
  /** 'conservative' | 'permissive' | 'none' (tryon-v1.6 only; default 'permissive'). */
  moderationLevel?: 'conservative' | 'permissive' | 'none';
  /** Provider name override, e.g. to register both models side by side. */
  name?: string;
  /** Set true when the vendor has confirmed EU processing in the DPA. */
  euResidencyConfirmed?: boolean;
}

/** Category mapping documented in the research: dresses are 'one-pieces', outerwear renders as 'tops'. */
export const FASHN_CATEGORY_MAP: Readonly<Record<GarmentCategory, FashnCategory | null>> = {
  top: 'tops',
  bottom: 'bottoms',
  dress: 'one-pieces',
  outerwear: 'tops',
  shoes: null,
  accessory: null,
};

export const FASHN_V16_CATEGORIES: GarmentCategory[] = ['top', 'bottom', 'dress', 'outerwear'];
export const FASHN_MAX_CATEGORIES: GarmentCategory[] = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'];

const V16_MODE: Record<Quality, FashnMode> = { fast: 'performance', balanced: 'balanced', quality: 'quality' };
const MAX_MODE: Record<Quality, FashnMaxMode> = { fast: 'fast', balanced: 'balanced', quality: 'quality' };

/** tryon-max credits per image: generation_mode × resolution (docs.fashn.ai/api-reference/tryon-max). */
export const FASHN_MAX_CREDITS: Record<FashnMaxMode, Record<Resolution, number>> = {
  fast: { '1k': 1, '2k': 2, '4k': 3 },
  balanced: { '1k': 2, '2k': 3, '4k': 4 },
  quality: { '1k': 3, '2k': 4, '4k': 5 },
};

interface RunResponse {
  id?: string;
  error?: unknown;
}

interface StatusResponse {
  id?: string;
  status?: string;
  output?: unknown;
  error?: { name?: string; message?: string } | string | null;
}

export class FashnProvider implements TryOnProvider {
  readonly name: string;
  readonly model: FashnModel;
  readonly models: readonly string[];
  readonly capabilities: ProviderCapabilities;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;
  private readonly pollIntervalMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly moderationLevel: 'conservative' | 'permissive' | 'none';
  private readonly latency = new LatencyTracker();

  constructor(config: FashnProviderConfig) {
    this.model = config.model ?? 'tryon-v1.6';
    this.name = config.name ?? (this.model === 'tryon-max' ? 'fashn-max' : 'fashn');
    this.models = [this.model];
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? FASHN_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? defaultFetch;
    this.sleep = config.sleep ?? realSleep;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 90_000;
    this.moderationLevel = config.moderationLevel ?? 'permissive';
    const isMax = this.model === 'tryon-max';
    this.capabilities = {
      categories: isMax ? [...FASHN_MAX_CATEGORIES] : [...FASHN_V16_CATEGORIES],
      acceptsFlatLay: true,
      acceptsPrompt: isMax,
      multiGarment: false,
      maxResolution: isMax ? '4k' : '1k',
      video: false,
      privacy: {
        trainsOnInputs: false,
        retentionHours: 72, // CDN outputs 3 days; base64 inputs deleted on completion, base64 outputs ≤ 1 h
        euResidency: config.euResidencyConfirmed ?? false,
        zdrAvailable: false,
        selfHosted: false,
      },
      region: config.euResidencyConfirmed ? 'eu' : 'unspecified',
    };
  }

  estimateCost(opts: TryOnOptions): number {
    const n = opts.numSamples ?? 1;
    if (this.model === 'tryon-max') {
      const credits = FASHN_MAX_CREDITS[MAX_MODE[opts.quality]][opts.resolution ?? '1k'];
      return round(credits * n * FASHN_USD_PER_CREDIT);
    }
    return round(n * FASHN_USD_PER_CREDIT);
  }

  async healthCheck(): Promise<HealthStatus> {
    // FASHN documents no health endpoint; reachability is learnt from real calls (router circuit
    // breaker). A missing key is the one failure we can detect up front.
    if (!this.apiKey) return { ok: false, reason: 'FASHN_API_KEY missing' };
    const p50 = this.latency.p50();
    return p50 === undefined ? { ok: true } : { ok: true, p50LatencyMs: p50 };
  }

  async tryOn(person: PersonInput, garment: GarmentInput, opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult> {
    if (!this.apiKey) throw new ConfigError(`${this.name}: FASHN_API_KEY missing`, { provider: this.name });
    assertAvatarRender(person, this.name);
    const category = FASHN_CATEGORY_MAP[garment.category];
    if (this.model === 'tryon-v1.6' && category === null) {
      throw new UnsupportedError(`${this.name}: tryon-v1.6 does not support category "${garment.category}"`, {
        provider: this.name,
      });
    }
    const garmentBytes = garment.flatLayPhoto ?? garment.productPhotos?.[0];
    if (!garmentBytes) {
      throw new ImageInputError(`${this.name}: garment ${garment.id} has neither flatLayPhoto nor productPhotos`, {
        provider: this.name,
      });
    }
    const started = Date.now();
    const deadline = new Deadline(opts.timeoutMs ?? this.defaultTimeoutMs, signal);
    try {
      const [personImg, garmentImg] = await Promise.all([normaliseImage(person.image), normaliseImage(garmentBytes)]);
      const inputs = this.buildInputs(toDataUri(personImg.png), toDataUri(garmentImg.png), garment, opts, category);
      const run = await requestJson<RunResponse>(
        this.fetchImpl,
        this.name,
        `${this.baseUrl}/v1/run`,
        { method: 'POST', headers: this.headers(), body: { model_name: this.model, inputs } },
        deadline,
      );
      if (run.status !== 200 || typeof run.body?.id !== 'string') {
        throw this.mapVendorError(run.body?.error, run.status);
      }
      const id = run.body.id;
      const output = await poll<string[]>({
        provider: this.name,
        intervalMs: this.pollIntervalMs,
        deadline,
        sleep: this.sleep,
        step: async () => {
          const st = await requestJson<StatusResponse>(
            this.fetchImpl,
            this.name,
            `${this.baseUrl}/v1/status/${encodeURIComponent(id)}`,
            { method: 'GET', headers: this.headers() },
            deadline,
          );
          if (st.status !== 200) throw this.mapVendorError(st.body?.error, st.status);
          const status = st.body?.status;
          if (status === 'completed') {
            const out = st.body?.output;
            if (!Array.isArray(out) || out.length === 0 || !out.every((o) => typeof o === 'string')) {
              throw new ProviderError(`${this.name}: completed without output`, { provider: this.name });
            }
            return out as string[];
          }
          if (status === 'failed') throw this.mapVendorError(st.body?.error, 200);
          if (status === 'starting' || status === 'in_queue' || status === 'processing' || status === undefined) {
            return undefined;
          }
          throw new ProviderError(`${this.name}: unknown status "${String(status)}"`, { provider: this.name });
        },
      });
      const images = await Promise.all(
        output.map(async (item) => {
          const bytes = item.startsWith('http://') || item.startsWith('https://')
            ? await requestBytes(this.fetchImpl, this.name, item, deadline)
            : fromBase64OrDataUri(item);
          const png = await toPng(bytes);
          return { ...png, watermark: 'none' as const };
        }),
      );
      const latencyMs = Date.now() - started;
      this.latency.record(latencyMs);
      return {
        images,
        provider: this.name,
        model: this.model,
        costUsd: round(images.length * (this.estimateCost(opts) / (opts.numSamples ?? 1))),
        latencyMs,
        retention: { vendorDeletesAfterHours: 72, trainedOn: false },
        disclaimer: DISCLAIMER,
      };
    } catch (e) {
      if (deadline.aborted && !(e instanceof PoseError)) throw deadline.classify(this.name, e);
      throw toTryOnError(e, this.name);
    } finally {
      deadline.dispose();
    }
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  private buildInputs(
    modelImage: string,
    garmentImage: string,
    garment: GarmentInput,
    opts: TryOnOptions,
    category: FashnCategory | null,
  ): Record<string, unknown> {
    const n = opts.numSamples ?? 1;
    const seed = opts.seed ?? 42;
    if (this.model === 'tryon-max') {
      const inputs: Record<string, unknown> = {
        model_image: modelImage,
        product_image: garmentImage,
        prompt: opts.promptHint ?? promptFromMetadata(garment),
        resolution: opts.resolution ?? '1k',
        generation_mode: MAX_MODE[opts.quality],
        num_images: n,
        output_format: 'png',
        return_base64: true,
        seed,
      };
      return inputs;
    }
    return {
      model_image: modelImage,
      garment_image: garmentImage,
      category: category ?? 'auto',
      garment_photo_type: garment.flatLayPhoto ? 'flat-lay' : 'model',
      mode: V16_MODE[opts.quality],
      num_samples: n,
      output_format: 'png',
      return_base64: true,
      seed,
      segmentation_free: true,
      moderation_level: this.moderationLevel,
    };
  }

  /** Maps FASHN's `{ name, message }` error object (or a bare string) to a typed error. */
  private mapVendorError(error: unknown, httpStatus: number): Error {
    let name = '';
    let message = '';
    if (typeof error === 'string') message = error;
    else if (error && typeof error === 'object') {
      const o = error as { name?: unknown; message?: unknown; error?: unknown };
      name = typeof o.name === 'string' ? o.name : typeof o.error === 'string' ? o.error : '';
      message = typeof o.message === 'string' ? o.message : '';
    }
    const init = { provider: this.name, httpStatus, vendorCode: name || undefined };
    const text = `${this.name}: ${name || 'error'}${message ? `: ${truncate(message)}` : ''}`;
    if (/pose/i.test(name)) return new PoseError(text, init);
    if (/moderation|nsfw|safety/i.test(name) || /moderation/i.test(message)) return new ModerationError(text, init);
    if (/imageload|photo ?type|invalid ?image|image ?error/i.test(name.replace(/\s/g, ''))) {
      return new ImageInputError(text, init);
    }
    if (httpStatus === 400 || httpStatus === 422) return new ImageInputError(text, init);
    return new ProviderError(text, init);
  }
}

export function assertAvatarRender(person: PersonInput, provider: string): void {
  // Type-level guarantee (D3) plus a runtime one, since the API boundary is JSON.
  const kind: string = person.kind;
  if (kind !== 'avatarRender') {
    throw new ConfigError(`${provider}: PersonInput.kind must be 'avatarRender' (got "${kind}")`, { provider });
  }
  const tier: string = person.consentTier;
  if (tier !== 'heroOptIn') {
    throw new ConfigError(`${provider}: hosted rendering requires consentTier 'heroOptIn' (got "${tier}")`, { provider });
  }
}

export function round(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}
