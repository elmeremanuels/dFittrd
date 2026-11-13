import sharp from 'sharp';
import { TryOnError } from '../errors.js';
import { normaliseImage } from '../image.js';
import { DISCLAIMER } from '../types.js';
import type {
  GarmentCategory,
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
import { GARMENT_CATEGORIES } from '../types.js';
import { assertAvatarRender } from './fashn.js';

/**
 * Development/test provider. Returns the (normalised) avatar render stamped with
 * "ESTIMATE · MOCK" so nobody can mistake it for a real render. Zero cost, nothing leaves the
 * process. `failWith` / `latencyMs` make router behaviour testable.
 */
export const MOCK_STAMP = 'ESTIMATE · MOCK';

export interface MockProviderConfig {
  name?: string;
  categories?: GarmentCategory[];
  /** Simulated processing time. */
  latencyMs?: number;
  /** Throw this error instead of rendering; a function is called per request (e.g. fail N times). */
  failWith?: TryOnError | (() => TryOnError | undefined);
  /** Pretend to be in the EU for router policy tests. */
  euResidency?: boolean;
  /** Override the reported cost (default 0). */
  costUsd?: number;
  healthy?: boolean;
  video?: boolean;
}

export class MockProvider implements TryOnProvider {
  readonly name: string;
  readonly models: readonly string[] = ['mock-stamp'];
  readonly capabilities: ProviderCapabilities;
  /** Every call, for assertions. */
  readonly calls: Array<{ kind: 'image' | 'video'; garmentId: string; opts: TryOnOptions | VideoOptions }> = [];

  private readonly latencyMs: number;
  private readonly failWith: MockProviderConfig['failWith'];
  private readonly costUsd: number;
  private readonly healthy: boolean;

  constructor(config: MockProviderConfig = {}) {
    this.name = config.name ?? 'mock';
    this.latencyMs = config.latencyMs ?? 0;
    this.failWith = config.failWith;
    this.costUsd = config.costUsd ?? 0;
    this.healthy = config.healthy ?? true;
    this.capabilities = {
      categories: config.categories ?? [...GARMENT_CATEGORIES],
      acceptsFlatLay: true,
      acceptsPrompt: true,
      multiGarment: true,
      maxResolution: '1k',
      video: config.video ?? true,
      privacy: {
        trainsOnInputs: false,
        retentionHours: 0,
        euResidency: config.euResidency ?? true,
        zdrAvailable: true,
        selfHosted: true,
      },
      region: 'local',
    };
  }

  estimateCost(opts: TryOnOptions): number {
    return this.costUsd * (opts.numSamples ?? 1);
  }

  estimateVideoCost(_opts: VideoOptions): number {
    return this.costUsd;
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.healthy ? { ok: true, p50LatencyMs: this.latencyMs } : { ok: false, reason: 'mock unhealthy' };
  }

  async tryOn(person: PersonInput, garment: GarmentInput, opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult> {
    this.calls.push({ kind: 'image', garmentId: garment.id, opts });
    assertAvatarRender(person, this.name);
    const started = Date.now();
    await this.simulate(signal);
    const base = await normaliseImage(person.image, { flatten: true });
    const stamped = await stampEstimate(base.png, base.width, base.height, `${MOCK_STAMP} · ${garment.id}`);
    const n = opts.numSamples ?? 1;
    const images = Array.from({ length: n }, () => ({
      png: stamped,
      width: base.width,
      height: base.height,
      watermark: 'none' as const,
    }));
    return {
      images,
      provider: this.name,
      model: 'mock-stamp',
      costUsd: this.estimateCost(opts),
      latencyMs: Date.now() - started,
      retention: { vendorDeletesAfterHours: 0, trainedOn: false },
      disclaimer: DISCLAIMER,
    };
  }

  async tryOnOutfit(person: PersonInput, garments: GarmentInput[], opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult> {
    const first = garments[0];
    if (!first) throw new TryOnError('unsupported', false, `${this.name}: tryOnOutfit needs at least one garment`);
    return this.tryOn(person, { ...first, id: garments.map((g) => g.id).join('+') }, opts, signal);
  }

  /** Returns a minimal, clearly fake MP4 container (just an `ftyp` box) so pipelines can be exercised. */
  async animate(_still: Uint8Array, garment: GarmentInput, opts: VideoOptions, signal?: AbortSignal): Promise<VideoResult> {
    this.calls.push({ kind: 'video', garmentId: garment.id, opts });
    await this.simulate(signal);
    const ftyp = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom', 'ascii'),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from('isomiso2', 'ascii'),
    ]);
    return {
      mp4: new Uint8Array(ftyp),
      durationSec: opts.durationSec,
      provider: this.name,
      model: 'mock-stamp',
      costUsd: this.costUsd,
      retention: { vendorDeletesAfterHours: 0, trainedOn: false },
      disclaimer: DISCLAIMER,
    };
  }

  private async simulate(signal?: AbortSignal): Promise<void> {
    const fail = typeof this.failWith === 'function' ? this.failWith() : this.failWith;
    if (fail) throw fail;
    if (this.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.latencyMs);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new TryOnError('aborted', false, `${this.name}: aborted`));
          },
          { once: true },
        );
      });
    }
  }
}

/** Overlays a translucent band with the given text across the lower part of a PNG. */
export async function stampEstimate(png: Uint8Array, width: number, height: number, text: string): Promise<Uint8Array> {
  const fontSize = Math.max(14, Math.round(width / 18));
  const bandHeight = Math.round(fontSize * 2.2);
  const y = height - bandHeight;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="${y}" width="${width}" height="${bandHeight}" fill="#1A1612" fill-opacity="0.72"/>
  <text x="${width / 2}" y="${y + bandHeight * 0.66}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#F5EFE7" text-anchor="middle">${escapeXml(text)}</text>
</svg>`;
  const out = await sharp(Buffer.from(png.buffer, png.byteOffset, png.byteLength))
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);
}
