import { assertServerOnly } from './serverOnly.js';

// Decision D3: fail at import time if this ever ends up in a browser bundle.
assertServerOnly();

export * from './types.js';
export * from './errors.js';
export { assertServerOnly, isBrowserLike, ServerOnlyViolation } from './serverOnly.js';
export {
  drapeWord,
  sheenWord,
  opacityWord,
  easeWord,
  fitGapPhrase,
  fabricPhrase,
  promptFromMetadata,
  motionPromptFromMetadata,
} from './promptFromMetadata.js';
export { normaliseImage, readDimensions, toPng, toBase64, toDataUri, fromBase64OrDataUri, MAX_WIDTH, MAX_HEIGHT } from './image.js';
export type { NormalisedImage } from './image.js';
export { BANNED_MODELS, isBanned, findBanned, assertNotBanned, ProviderRegistry, createRegistry } from './registry.js';
export type { BannedModel } from './registry.js';
export {
  TryOnRouter,
  CircuitBreaker,
  MemorySpendStore,
  parseOrder,
  utcDay,
} from './router.js';
export type {
  RouterPolicy,
  SpendStore,
  CircuitBreakerOptions,
  CircuitState,
  TryOnRouterConfig,
  RoutedTryOn,
  RoutedVideo,
} from './router.js';
export { LatencyTracker, Deadline, defaultFetch, realSleep } from './http.js';
export type { Sleep, Clock } from './http.js';
export {
  FashnProvider,
  FASHN_BASE_URL,
  FASHN_USD_PER_CREDIT,
  FASHN_CATEGORY_MAP,
  FASHN_MAX_CREDITS,
  FASHN_V16_CATEGORIES,
  FASHN_MAX_CATEGORIES,
} from './providers/fashn.js';
export type { FashnProviderConfig, FashnModel, FashnCategory, FashnGarmentPhotoType, FashnMode, FashnMaxMode } from './providers/fashn.js';
export {
  VertexTryOnProvider,
  VERTEX_TRYON_MODEL,
  VERTEX_TRYON_USD_PER_IMAGE,
  VERTEX_EU_LOCATIONS,
  VERTEX_CATEGORIES,
} from './providers/vertexTryOn.js';
export type { VertexTryOnProviderConfig } from './providers/vertexTryOn.js';
export { GrokVideoProvider, GROK_VIDEO_MODEL, GROK_VIDEO_USD_PER_SECOND, XAI_BASE_URL, aspectRatioOf } from './providers/grokVideo.js';
export type { GrokVideoProviderConfig, UploadTarget } from './providers/grokVideo.js';
export { MockProvider, MOCK_STAMP, stampEstimate } from './providers/mock.js';
export type { MockProviderConfig } from './providers/mock.js';
