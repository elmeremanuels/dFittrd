/**
 * fal.ai Z-Image-Turbo ControlNet adapter for the realism layer (docs/research/ai-realism-layer.md,
 * primary choice). The depth pass goes in as the control image with `preprocess: 'none'`; nothing
 * but the render passes and the prompt is sent (AGENTS.md hard rule 1).
 *
 * Read at the source on 2026-11-19 (https://fal.ai/models/fal-ai/z-image/turbo/controlnet/llms.txt):
 * `image_url` (control image), `preprocess` none|canny|depth|pose, `control_scale` 0–1,
 * `control_start` / `control_end` 0–1, `num_inference_steps` 1–8, `enable_safety_checker`; price
 * "$0.0065 per megapixels". Weights: Tongyi-MAI/Z-Image-Turbo and alibaba-pai
 * Z-Image-Turbo-Fun-Controlnet-Union, both Apache-2.0. Retention: fal stores inputs and outputs for
 * 90 days unless the request sends `X-Fal-Store-IO: 0` (https://fal.ai/docs/model-apis/data-retention),
 * which this adapter always does, and inputs go as data URIs so nothing is uploaded to fal storage.
 * NOT verified against the live API (no key, no paid calls): `image_size` and `sync_mode` are fal's
 * common fields, not listed on that page; the adapter accepts a data URI or a URL in the answer.
 * The key is read in apps/api/src/env.ts only (rule 2).
 */
import { Deadline, defaultFetch, requestBytes, requestJson } from '../http.js';
import { ProviderError } from '../errors.js';
import { DISCLAIMER, type FetchLike } from '../types.js';
import { fromBase64OrDataUri, toDataUri } from '../image.js';
import { decodeOutput } from './codec.js';
import type { RealismCapabilities, RealismInput, RealismOutput, RealismProvider } from './provider.js';

export const FAL_ZIMAGE_ENDPOINT = 'fal-ai/z-image/turbo/controlnet';
export const FAL_USD_PER_MP = 0.0065;

export interface FalZImageConfig {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  /** ControlNet weight (default 0.9: the structure is the point). */
  controlScale?: number;
  steps?: number;
}

interface FalAnswer {
  images?: Array<{ url?: string; width?: number; height?: number }>;
}

export class FalZImageRealismProvider implements RealismProvider {
  readonly name = 'fal-z-image';
  readonly models = [FAL_ZIMAGE_ENDPOINT] as const;
  readonly capabilities: RealismCapabilities = { structure: ['depth', 'canny'], region: 'unspecified', retentionHours: null, trainsOnInputs: false };
  // retentionHours null: `X-Fal-Store-IO: 0` turns off payload storage, but zero data retention is "contact sales" (not confirmed).
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly config: FalZImageConfig) {
    if (!config.apiKey) throw new ProviderError('fal-z-image: apiKey missing', { provider: 'fal-z-image' });
    this.fetchImpl = config.fetch ?? defaultFetch;
    this.baseUrl = (config.baseUrl ?? 'https://fal.run').replace(/\/+$/, '');
  }

  /** Billed per megapixel; rounded up to a whole megapixel to stay on the safe side. */
  estimateCostUsd(input: Pick<RealismInput, 'passes'>): number {
    const mp = Math.max(1, Math.ceil((input.passes.width * input.passes.height) / 1e6));
    return mp * FAL_USD_PER_MP;
  }

  async enhance(input: RealismInput, signal?: AbortSignal): Promise<RealismOutput> {
    if (input.kind !== 'renderPasses') throw new ProviderError('fal-z-image: only render passes may be sent', { provider: this.name });
    const t0 = Date.now();
    const deadline = new Deadline(this.config.timeoutMs ?? 60_000, signal);
    try {
      const res = await requestJson<FalAnswer>(
        this.fetchImpl,
        this.name,
        `${this.baseUrl}/${FAL_ZIMAGE_ENDPOINT}`,
        {
          method: 'POST',
          headers: { authorization: `Key ${this.config.apiKey}`, 'x-fal-store-io': '0' },
          body: {
            prompt: input.prompt,
            image_url: toDataUri(input.png.depth, 'image/png'),
            preprocess: 'none',
            control_scale: this.config.controlScale ?? 0.9,
            control_start: 0,
            control_end: 1,
            num_inference_steps: this.config.steps ?? 8,
            image_size: { width: input.passes.width, height: input.passes.height },
            enable_safety_checker: true,
            sync_mode: true,
            ...(input.seed !== undefined ? { seed: input.seed } : {}),
          },
        },
        deadline,
      );
      if (res.status >= 400) throw new ProviderError(`fal-z-image: HTTP ${res.status}`, { provider: this.name, httpStatus: res.status });
      const url = res.body?.images?.[0]?.url;
      if (!url) throw new ProviderError('fal-z-image: no image in the answer', { provider: this.name });
      const bytes = url.startsWith('data:') ? fromBase64OrDataUri(url) : await requestBytes(this.fetchImpl, this.name, url, deadline);
      const image = await decodeOutput(bytes);
      return {
        image,
        provider: this.name,
        model: FAL_ZIMAGE_ENDPOINT,
        costUsd: this.estimateCostUsd(input),
        latencyMs: Date.now() - t0,
        retention: { vendorDeletesAfterHours: null, trainedOn: false },
        region: this.capabilities.region,
        disclaimer: DISCLAIMER,
      };
    } finally {
      deadline.dispose();
    }
  }
}
