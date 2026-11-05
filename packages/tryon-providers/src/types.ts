/**
 * Public types of @curtain/tryon-providers.
 *
 * Adapted from docs/research/tryon-engines.md ("ADAPTER INTERFACE") with the changes
 * required by docs/DECISIONS.md D3/D4:
 *  - `PersonInput.kind` is the single literal `'avatarRender'`. There is deliberately no
 *    `'userPhoto'` member and one must never be added (AGENTS.md hard rule 1).
 *  - `PersonInput` has no `faceTile`: the real face tile is re-composited on the device after
 *    the result returns and must never reach this package.
 *  - `consentTier` is `'heroOptIn'`: the only tier that may leave the device.
 *  - Every result carries `disclaimer: 'generated-estimate'` (hard rule 3).
 */

export type GarmentCategory = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory';

export const GARMENT_CATEGORIES: readonly GarmentCategory[] = [
  'top',
  'bottom',
  'dress',
  'outerwear',
  'shoes',
  'accessory',
];

/** Fabric descriptor, same scales as the merchant payload (handoff §3.1): 0–1 for drape/opacity/sheen. */
export interface FabricMeta {
  /** linen | cotton | wool | silk | cashmere | tencel | modal | denim | … */
  primary: string;
  weightGsm?: number;
  /** 0 = non-stretch, 30 = jersey */
  stretchPct?: number;
  /** 0 = stiff, 1 = fluid */
  drape?: number;
  /** 0 = sheer, 1 = opaque */
  opacity?: number;
  /** 0 = matte, 1 = shiny */
  sheen?: number;
}

export type FitPoint = 'bust' | 'waist' | 'hip' | 'shoulder';

export interface GarmentInput {
  id: string;
  category: GarmentCategory;
  /** Preferred: background-removed flat-lay (PNG/JPEG bytes). */
  flatLayPhoto?: Uint8Array;
  /** On-model product photos, used when no flat-lay is available. */
  productPhotos?: Uint8Array[];
  primaryColorHex?: string;
  fabric?: FabricMeta;
  /** wrap | a-line | sheath | column | … */
  patternBlock?: string;
  /** Size chosen by @curtain/fit-engine on the device. */
  size?: string;
  /** Garment minus body per fit point, in cm, from the on-device fit result (handoff §4.1). */
  fitGapCm?: Partial<Record<FitPoint, number>>;
}

export type ConsentTier = 'heroOptIn';

export interface PersonInput {
  /** The only allowed kind. Never add 'userPhoto' (decision D3). */
  kind: 'avatarRender';
  /** 3:4 portrait avatar render, full body, neutral background. PNG/JPEG bytes. */
  image: Uint8Array;
  consentTier: ConsentTier;
}

export type Quality = 'fast' | 'balanced' | 'quality';
export type Resolution = '1k' | '2k' | '4k';

export interface TryOnOptions {
  quality: Quality;
  resolution?: Resolution;
  numSamples?: 1 | 2 | 3 | 4;
  seed?: number;
  preservePose?: boolean;
  /** Fabric/size language built by promptFromMetadata(); only used by prompt-capable engines. */
  promptHint?: string;
  timeoutMs?: number;
}

export type Watermark = 'synthid' | 'none';

export interface RenderedImage {
  png: Uint8Array;
  width: number;
  height: number;
  watermark?: Watermark;
}

export interface Retention {
  /** Hours after which the vendor deletes inputs/outputs; null = unknown or indefinite. */
  vendorDeletesAfterHours: number | null;
  trainedOn: false | 'unknown';
}

export const DISCLAIMER = 'generated-estimate' as const;
export type Disclaimer = typeof DISCLAIMER;

export interface TryOnResult {
  images: RenderedImage[];
  provider: string;
  model: string;
  costUsd: number;
  latencyMs: number;
  retention: Retention;
  disclaimer: Disclaimer;
}

export type VideoDurationSec = 4 | 6 | 8 | 10 | 12 | 15;
export type VideoResolution = '480p' | '720p' | '1080p';

export interface VideoOptions {
  durationSec: VideoDurationSec;
  resolution: VideoResolution;
  promptHint?: string;
  timeoutMs?: number;
}

export interface VideoResult {
  mp4: Uint8Array;
  durationSec: number;
  provider: string;
  model: string;
  costUsd: number;
  retention: Retention;
  disclaimer: Disclaimer;
}

export interface PrivacyCapabilities {
  trainsOnInputs: boolean;
  /** Vendor retention window in hours; null = unknown/indefinite; 0 = deleted on completion. */
  retentionHours: number | null;
  euResidency: boolean;
  zdrAvailable: boolean;
  selfHosted: boolean;
}

export interface ProviderCapabilities {
  categories: GarmentCategory[];
  acceptsFlatLay: boolean;
  acceptsPrompt: boolean;
  multiGarment: boolean;
  maxResolution: Resolution;
  video: boolean;
  privacy: PrivacyCapabilities;
  /** Processing region as far as the vendor documents it, e.g. 'europe-west4', 'us', 'unspecified', 'local'. */
  region: string;
}

export interface HealthStatus {
  ok: boolean;
  p50LatencyMs?: number;
  reason?: string;
}

export interface TryOnProvider {
  readonly name: string;
  /** Vendor model identifiers this adapter can call; checked against the banned-model registry. */
  readonly models: readonly string[];
  readonly capabilities: ProviderCapabilities;
  estimateCost(opts: TryOnOptions): number;
  tryOn(person: PersonInput, garment: GarmentInput, opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult>;
  tryOnOutfit?(person: PersonInput, garments: GarmentInput[], opts: TryOnOptions, signal?: AbortSignal): Promise<TryOnResult>;
  estimateVideoCost?(opts: VideoOptions): number;
  animate?(still: Uint8Array, garment: GarmentInput, opts: VideoOptions, signal?: AbortSignal): Promise<VideoResult>;
  healthCheck(): Promise<HealthStatus>;
}

/** Record written to the privacy ledger (ledger_entries) for every hero render. */
export interface LedgerRecord {
  provider: string;
  model: string;
  costUsd: number;
  retentionHours: number | null;
  trainedOn: false | 'unknown';
  region: string;
  kind: 'image' | 'video';
  latencyMs: number;
  at: string;
}

/**
 * Minimal structural fetch type satisfied by both `undici.fetch` and Node's global fetch, so the
 * adapters can be given a custom transport (tests, proxies) without pulling in DOM lib types.
 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;
