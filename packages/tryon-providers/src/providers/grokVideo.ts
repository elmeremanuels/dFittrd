import { ConfigError, ModerationError, ProviderDisabledError, ProviderError, UnsupportedError, toTryOnError } from '../errors.js';
import { Deadline, LatencyTracker, defaultFetch, poll, realSleep, requestBytes, requestJson, truncate } from '../http.js';
import type { Sleep } from '../http.js';
import { normaliseImage, toDataUri } from '../image.js';
import { motionPromptFromMetadata } from '../promptFromMetadata.js';
import { DISCLAIMER } from '../types.js';
import type {
  FetchLike,
  GarmentInput,
  HealthStatus,
  PersonInput,
  ProviderCapabilities,
  TryOnOptions,
  TryOnProvider,
  TryOnResult,
  VideoOptions,
  VideoResult,
} from '../types.js';
import { round } from './fashn.js';

/**
 * xAI Grok Imagine video, model `grok-imagine-video-1.5`. Animates an ALREADY RENDERED try-on
 * still (decision D4): the raw capture never goes to xAI. Video-only adapter: tryOn() throws.
 *
 * REST shape (docs.x.ai/developers/rest-api-reference/inference/videos, checked 2026-11-04):
 *   POST https://api.x.ai/v1/videos/generations
 *     { model, prompt, image: { url }, duration: 1–15, resolution: 480p|720p|1080p,
 *       aspect_ratio?, reference_images?, output?: { upload_url } }  →  { request_id }
 *   GET  https://api.x.ai/v1/videos/{request_id}
 *     { status: pending|done|failed(|expired), progress?, error?: { code, message },
 *       video?: { url, duration, respect_moderation, storage_error } }
 * Pricing: $0.080 per output second, flat (fact-check correction). Processing is US-only
 * (us-east-1, us-west-2, us-saltlake-2) → euResidency false. Retention 30 days, no training;
 * team-wide Zero Data Retention is available, and under ZDR xAI cannot store the output, so the
 * caller MUST supply its own `upload_url` (signed PUT, Content-Type video/mp4) and a matching
 * download URL for us to fetch the result from.
 */

export const XAI_BASE_URL = 'https://api.x.ai';
export const GROK_VIDEO_MODEL = 'grok-imagine-video-1.5';
export const GROK_VIDEO_USD_PER_SECOND = 0.08;

export interface UploadTarget {
  /** Signed URL xAI will PUT the mp4 to. */
  uploadUrl: string;
  /** URL we read the mp4 back from once the job is done. */
  downloadUrl: string;
  /** Optional headers for the download (e.g. our own storage auth). */
  downloadHeaders?: Record<string, string>;
}

export interface GrokVideoProviderConfig {
  apiKey: string;
  /** Master switch (XAI_VIDEO_ENABLED). Default true when a key is present. */
  enabled?: boolean;
  /** Whether the xAI team has Zero Data Retention switched on. When true `getUploadTarget` is required. */
  zdr?: boolean;
  /** Produces a fresh upload/download pair per render (required under ZDR, optional otherwise). */
  getUploadTarget?: () => Promise<UploadTarget>;
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: Sleep;
  pollIntervalMs?: number;
  defaultTimeoutMs?: number;
  name?: string;
}

interface GenerationResponse {
  request_id?: string;
  id?: string;
  error?: { code?: string; message?: string } | string;
}

interface VideoStatusResponse {
  status?: string;
  progress?: number;
  error?: { code?: string; message?: string } | string | null;
  video?: { url?: string | null; duration?: number; respect_moderation?: boolean; storage_error?: string | null };
}

export class GrokVideoProvider implements TryOnProvider {
  readonly name: string;
  readonly models: readonly string[] = [GROK_VIDEO_MODEL];
  readonly capabilities: ProviderCapabilities;

  private readonly apiKey: string;
  private readonly enabled: boolean;
  private readonly zdr: boolean;
  private readonly getUploadTarget: (() => Promise<UploadTarget>) | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;
  private readonly pollIntervalMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly latency = new LatencyTracker();

  constructor(config: GrokVideoProviderConfig) {
    this.name = config.name ?? 'grok-video';
    this.apiKey = config.apiKey;
    this.enabled = config.enabled ?? Boolean(config.apiKey);
    this.zdr = config.zdr ?? false;
    this.getUploadTarget = config.getUploadTarget;
    this.baseUrl = (config.baseUrl ?? XAI_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? defaultFetch;
    this.sleep = config.sleep ?? realSleep;
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 300_000;
    this.capabilities = {
      categories: [], // no still try-on: never selected by TryOnRouter.render()
      acceptsFlatLay: false,
      acceptsPrompt: true,
      multiGarment: false,
      maxResolution: '1k',
      video: true,
      privacy: {
        trainsOnInputs: false,
        retentionHours: this.zdr ? 0 : 30 * 24,
        euResidency: false,
        zdrAvailable: true,
        selfHosted: false,
      },
      region: 'us',
    };
  }

  estimateCost(_opts: TryOnOptions): number {
    return Number.POSITIVE_INFINITY; // still try-on is not offered by this adapter
  }

  estimateVideoCost(opts: VideoOptions): number {
    return round(opts.durationSec * GROK_VIDEO_USD_PER_SECOND);
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.enabled) return { ok: false, reason: 'disabled by configuration (XAI_VIDEO_ENABLED)' };
    if (!this.apiKey) return { ok: false, reason: 'XAI_API_KEY missing' };
    if (this.zdr && !this.getUploadTarget) return { ok: false, reason: 'ZDR requires an upload_url provider' };
    const p50 = this.latency.p50();
    return p50 === undefined ? { ok: true } : { ok: true, p50LatencyMs: p50 };
  }

  async tryOn(_person: PersonInput, _garment: GarmentInput, _opts: TryOnOptions): Promise<TryOnResult> {
    throw new UnsupportedError(`${this.name}: video-only adapter; use animate() on a rendered still`, {
      provider: this.name,
    });
  }

  async animate(still: Uint8Array, garment: GarmentInput, opts: VideoOptions, signal?: AbortSignal): Promise<VideoResult> {
    if (!this.enabled) throw new ProviderDisabledError(`${this.name}: disabled by configuration`, { provider: this.name });
    if (!this.apiKey) throw new ConfigError(`${this.name}: XAI_API_KEY missing`, { provider: this.name });
    if (this.zdr && !this.getUploadTarget) {
      throw new ConfigError(`${this.name}: Zero Data Retention is on, so an own upload_url is required`, {
        provider: this.name,
      });
    }
    const started = Date.now();
    const deadline = new Deadline(opts.timeoutMs ?? this.defaultTimeoutMs, signal);
    try {
      const [img, target] = await Promise.all([
        normaliseImage(still),
        this.getUploadTarget ? this.getUploadTarget() : Promise.resolve(undefined),
      ]);
      const body: Record<string, unknown> = {
        model: GROK_VIDEO_MODEL,
        prompt: opts.promptHint ?? motionPromptFromMetadata(garment),
        image: { url: toDataUri(img.png) },
        duration: opts.durationSec,
        resolution: opts.resolution,
        aspect_ratio: aspectRatioOf(img.width, img.height),
      };
      if (target) body.output = { upload_url: target.uploadUrl };

      const gen = await requestJson<GenerationResponse>(
        this.fetchImpl,
        this.name,
        `${this.baseUrl}/v1/videos/generations`,
        { method: 'POST', headers: this.headers(), body },
        deadline,
      );
      const requestId = gen.body?.request_id ?? gen.body?.id;
      if (gen.status !== 200 || typeof requestId !== 'string') {
        throw this.mapVendorError(gen.body?.error, gen.status);
      }
      const done = await poll<NonNullable<VideoStatusResponse['video']>>({
        provider: this.name,
        intervalMs: this.pollIntervalMs,
        deadline,
        sleep: this.sleep,
        step: async () => {
          const st = await requestJson<VideoStatusResponse>(
            this.fetchImpl,
            this.name,
            `${this.baseUrl}/v1/videos/${encodeURIComponent(requestId)}`,
            { method: 'GET', headers: this.headers() },
            deadline,
          );
          if (st.status !== 200) throw this.mapVendorError(st.body?.error, st.status);
          const status = st.body?.status;
          if (status === 'done') {
            const video = st.body?.video;
            if (!video) throw new ProviderError(`${this.name}: done without video`, { provider: this.name });
            if (video.respect_moderation === false) {
              throw new ModerationError(`${this.name}: output failed moderation`, { provider: this.name });
            }
            if (video.storage_error) {
              throw new ProviderError(`${this.name}: storage error: ${video.storage_error}`, { provider: this.name });
            }
            return video;
          }
          if (status === 'failed' || status === 'expired') throw this.mapVendorError(st.body?.error, 200, status);
          return undefined;
        },
      });
      const downloadUrl = target?.downloadUrl ?? done.url ?? undefined;
      if (!downloadUrl) {
        throw new ProviderError(`${this.name}: no video URL (ZDR without upload target?)`, { provider: this.name });
      }
      const mp4 = await requestBytes(this.fetchImpl, this.name, downloadUrl, deadline, target?.downloadHeaders ?? {});
      const durationSec = typeof done.duration === 'number' && done.duration > 0 ? done.duration : opts.durationSec;
      const latencyMs = Date.now() - started;
      this.latency.record(latencyMs);
      return {
        mp4,
        durationSec,
        provider: this.name,
        model: GROK_VIDEO_MODEL,
        costUsd: round(durationSec * GROK_VIDEO_USD_PER_SECOND),
        retention: { vendorDeletesAfterHours: this.zdr ? 0 : 30 * 24, trainedOn: false },
        disclaimer: DISCLAIMER,
      };
    } catch (e) {
      if (deadline.aborted) throw deadline.classify(this.name, e);
      throw toTryOnError(e, this.name);
    } finally {
      deadline.dispose();
    }
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  private mapVendorError(error: unknown, httpStatus: number, status?: string): Error {
    let code = '';
    let message = '';
    if (typeof error === 'string') message = error;
    else if (error && typeof error === 'object') {
      const o = error as { code?: unknown; message?: unknown };
      code = typeof o.code === 'string' ? o.code : '';
      message = typeof o.message === 'string' ? o.message : '';
    }
    const init = { provider: this.name, httpStatus, vendorCode: code || status };
    const text = `${this.name}: ${status ?? code ?? 'error'}${message ? `: ${truncate(message)}` : ''}`;
    if (/moderat|safety|policy/i.test(`${code} ${message}`)) return new ModerationError(text, init);
    if (code === 'invalid_argument') return new ConfigError(text, init);
    if (code === 'permission_denied') return new ConfigError(text, init);
    return new ProviderError(text, init);
  }
}

/** Picks the closest documented aspect ratio for the still (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9, 5:2). */
export function aspectRatioOf(width: number, height: number): string {
  const candidates: Array<[string, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
    ['21:9', 21 / 9],
    ['5:2', 5 / 2],
  ];
  const r = width / height;
  let best = candidates[0]!;
  for (const c of candidates) if (Math.abs(c[1] - r) < Math.abs(best[1] - r)) best = c;
  return best[0];
}
