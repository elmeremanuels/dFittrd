import { ConfigError, ImageInputError, ModerationError, ProviderDisabledError, ProviderError, toTryOnError } from '../errors.js';
import { Deadline, LatencyTracker, defaultFetch, requestJson, truncate } from '../http.js';
import { fromBase64OrDataUri, normaliseImage, toBase64, toPng } from '../image.js';
import { DISCLAIMER } from '../types.js';
import type {
  FetchLike,
  GarmentCategory,
  GarmentInput,
  HealthStatus,
  PersonInput,
  ProviderCapabilities,
  TryOnOptions,
  TryOnProvider,
  TryOnResult,
} from '../types.js';
import { assertAvatarRender, round } from './fashn.js';

/**
 * Google Vertex AI Virtual Try-On, model `virtual-try-on-001` (GA). Fallback #1 per decision D4.
 *
 * REST shape (docs.cloud.google.com/vertex-ai/generative-ai/docs/image/generate-virtual-try-on-images,
 * checked 2026-11-04):
 *   POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}
 *        /publishers/google/models/virtual-try-on-001:predict
 *   { instances: [{ personImage: { image: { bytesBase64Encoded } },
 *                   productImages: [{ image: { bytesBase64Encoded } }] }],
 *     parameters: { sampleCount: 1–4, storageUri?, seed?, addWatermark?, baseSteps?, safetySetting?,
 *                   personGeneration?, outputOptions?: { mimeType, compressionQuality } } }
 *   → { predictions: [{ bytesBase64Encoded, mimeType } | { raiFilteredReason }] }
 * Only sampleCount and storageUri are shown on the GA page; the other parameters carry over from
 * the preview API and are sent only when configured. Max 2 input images, ≤ 7 MB each, PNG/JPEG,
 * output resolution = input resolution, up to 4 outputs, SynthID + C2PA on outputs.
 * EU regions documented: europe-west1, europe-west4, europe-west8, europe-west9, europe-southwest1,
 * europe-north1. $0.06 per output image. No training on inputs; implicit caching (≤ 24 h) is a
 * project-level data-governance setting, so `cachingDisabled` here records what the operator set.
 *
 * Auth is a bearer access token from a getter (ADC / service account via gcloud or
 * google-auth-library in apps/api); no Google SDK is pulled into this package.
 */

export const VERTEX_TRYON_MODEL = 'virtual-try-on-001';
export const VERTEX_TRYON_USD_PER_IMAGE = 0.06;
export const VERTEX_EU_LOCATIONS = [
  'europe-west1',
  'europe-west4',
  'europe-west8',
  'europe-west9',
  'europe-southwest1',
  'europe-north1',
] as const;

export interface VertexTryOnProviderConfig {
  /** Master switch: when false the adapter is registered but healthCheck() is not ok and tryOn() throws ProviderDisabledError. */
  enabled: boolean;
  projectId: string;
  /** Regional endpoint, e.g. 'europe-west4'. */
  location: string;
  /** Returns a fresh OAuth2 access token (scope https://www.googleapis.com/auth/cloud-platform). */
  getAccessToken: () => Promise<string>;
  fetch?: FetchLike;
  defaultTimeoutMs?: number;
  /** Record that implicit caching was disabled for the project (Vertex data-governance setting). */
  cachingDisabled?: boolean;
  /** Vertex applies SynthID by default; pass false only if the project is allowed to disable it. */
  addWatermark?: boolean;
  baseSteps?: number;
  safetySetting?: 'block_low_and_above' | 'block_medium_and_above' | 'block_only_high' | 'block_none';
  personGeneration?: 'dont_allow' | 'allow_adult' | 'allow_all';
  name?: string;
  /** Override the endpoint host, e.g. for tests. Default https://{location}-aiplatform.googleapis.com */
  endpointBaseUrl?: string;
}

export const VERTEX_CATEGORIES: GarmentCategory[] = ['top', 'bottom', 'dress', 'outerwear'];

interface PredictResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string; raiFilteredReason?: string }>;
  error?: { code?: number; message?: string; status?: string };
}

export class VertexTryOnProvider implements TryOnProvider {
  readonly name: string;
  readonly models: readonly string[] = [VERTEX_TRYON_MODEL];
  readonly capabilities: ProviderCapabilities;

  private readonly enabled: boolean;
  private readonly projectId: string;
  private readonly location: string;
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetchImpl: FetchLike;
  private readonly defaultTimeoutMs: number;
  private readonly cachingDisabled: boolean;
  private readonly addWatermark: boolean | undefined;
  private readonly baseSteps: number | undefined;
  private readonly safetySetting: VertexTryOnProviderConfig['safetySetting'];
  private readonly personGeneration: VertexTryOnProviderConfig['personGeneration'];
  private readonly endpointBaseUrl: string;
  private readonly latency = new LatencyTracker();

  constructor(config: VertexTryOnProviderConfig) {
    this.name = config.name ?? 'vertex-tryon';
    this.enabled = config.enabled;
    this.projectId = config.projectId;
    this.location = config.location;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = config.fetch ?? defaultFetch;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 60_000;
    this.cachingDisabled = config.cachingDisabled ?? false;
    this.addWatermark = config.addWatermark;
    this.baseSteps = config.baseSteps;
    this.safetySetting = config.safetySetting;
    this.personGeneration = config.personGeneration;
    this.endpointBaseUrl = (config.endpointBaseUrl ?? `https://${config.location}-aiplatform.googleapis.com`).replace(/\/+$/, '');
    const eu = (VERTEX_EU_LOCATIONS as readonly string[]).includes(config.location);
    this.capabilities = {
      categories: [...VERTEX_CATEGORIES],
      acceptsFlatLay: true, // no flat-lay flag; the engine accepts product photos of either kind
      acceptsPrompt: false,
      multiGarment: false,
      maxResolution: '1k',
      video: false,
      privacy: {
        trainsOnInputs: false,
        retentionHours: this.cachingDisabled ? 0 : 24,
        euResidency: eu,
        zdrAvailable: true,
        selfHosted: false,
      },
      region: config.location,
    };
  }

  get predictUrl(): string {
    return `${this.endpointBaseUrl}/v1/projects/${encodeURIComponent(this.projectId)}/locations/${encodeURIComponent(this.location)}/publishers/google/models/${VERTEX_TRYON_MODEL}:predict`;
  }

  estimateCost(opts: TryOnOptions): number {
    return round((opts.numSamples ?? 1) * VERTEX_TRYON_USD_PER_IMAGE);
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.enabled) return { ok: false, reason: 'disabled by configuration (VERTEX_TRYON_ENABLED)' };
    if (!this.projectId || !this.location) return { ok: false, reason: 'VERTEX_PROJECT / VERTEX_LOCATION missing' };
    const p50 = this.latency.p50();
    return p50 === undefined ? { ok: true } : { ok: true, p50LatencyMs: p50 };
  }

  async tryOn(person: PersonInput, garment: GarmentInput, opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult> {
    if (!this.enabled) {
      throw new ProviderDisabledError(`${this.name}: disabled by configuration`, { provider: this.name });
    }
    if (!this.projectId || !this.location) {
      throw new ConfigError(`${this.name}: VERTEX_PROJECT / VERTEX_LOCATION missing`, { provider: this.name });
    }
    assertAvatarRender(person, this.name);
    if (!this.capabilities.categories.includes(garment.category)) {
      throw new ProviderError(`${this.name}: category "${garment.category}" not supported`, { provider: this.name });
    }
    const garmentBytes = garment.flatLayPhoto ?? garment.productPhotos?.[0];
    if (!garmentBytes) {
      throw new ImageInputError(`${this.name}: garment ${garment.id} has no image`, { provider: this.name });
    }
    const started = Date.now();
    const deadline = new Deadline(opts.timeoutMs ?? this.defaultTimeoutMs, signal);
    try {
      const [personImg, garmentImg, token] = await Promise.all([
        normaliseImage(person.image),
        normaliseImage(garmentBytes),
        this.getAccessToken(),
      ]);
      if (!token) throw new ConfigError(`${this.name}: access token getter returned nothing`, { provider: this.name });
      const parameters: Record<string, unknown> = { sampleCount: opts.numSamples ?? 1 };
      if (typeof opts.seed === 'number') parameters.seed = opts.seed;
      if (typeof this.addWatermark === 'boolean') parameters.addWatermark = this.addWatermark;
      if (typeof this.baseSteps === 'number') parameters.baseSteps = this.baseSteps;
      if (this.safetySetting) parameters.safetySetting = this.safetySetting;
      if (this.personGeneration) parameters.personGeneration = this.personGeneration;
      parameters.outputOptions = { mimeType: 'image/png' };

      const res = await requestJson<PredictResponse>(
        this.fetchImpl,
        this.name,
        this.predictUrl,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: {
            instances: [
              {
                personImage: { image: { bytesBase64Encoded: toBase64(personImg.png) } },
                productImages: [{ image: { bytesBase64Encoded: toBase64(garmentImg.png) } }],
              },
            ],
            parameters,
          },
        },
        deadline,
      );
      if (res.status !== 200) {
        const msg = res.body?.error?.message ?? truncate(res.rawText);
        if (res.status === 400 && /image|decode|base64/i.test(msg)) {
          throw new ImageInputError(`${this.name}: ${msg}`, { provider: this.name, httpStatus: res.status });
        }
        throw new ProviderError(`${this.name}: HTTP ${res.status}: ${msg}`, { provider: this.name, httpStatus: res.status });
      }
      const predictions = res.body?.predictions ?? [];
      const filtered = predictions.filter((p) => typeof p.raiFilteredReason === 'string');
      const rendered = predictions.filter((p) => typeof p.bytesBase64Encoded === 'string');
      if (rendered.length === 0) {
        if (filtered.length > 0) {
          throw new ModerationError(`${this.name}: filtered: ${filtered[0]?.raiFilteredReason}`, {
            provider: this.name,
            vendorCode: 'raiFiltered',
          });
        }
        throw new ProviderError(`${this.name}: no predictions returned`, { provider: this.name });
      }
      const images = await Promise.all(
        rendered.map(async (p) => {
          const png = await toPng(fromBase64OrDataUri(p.bytesBase64Encoded as string));
          return { ...png, watermark: this.addWatermark === false ? ('none' as const) : ('synthid' as const) };
        }),
      );
      const latencyMs = Date.now() - started;
      this.latency.record(latencyMs);
      return {
        images,
        provider: this.name,
        model: VERTEX_TRYON_MODEL,
        costUsd: round(images.length * VERTEX_TRYON_USD_PER_IMAGE),
        latencyMs,
        retention: { vendorDeletesAfterHours: this.cachingDisabled ? 0 : 24, trainedOn: false },
        disclaimer: DISCLAIMER,
      };
    } catch (e) {
      if (deadline.aborted) throw deadline.classify(this.name, e);
      throw toTryOnError(e, this.name);
    } finally {
      deadline.dispose();
    }
  }
}
