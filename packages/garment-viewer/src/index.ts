/**
 * @curtain/garment-viewer — the on-device 3D estimate of the overlay (docs/ENGINE-HANDOFF.md).
 * Consumed as TypeScript source so the host's bundler handles the drape worker URL. Loaded only by
 * `import()` after the shopper asks for the 3D view: never in the SDK, the peek or the embed entry.
 */
export { mountGarmentView, supportsWebGL2, GarmentViewError, type AvatarLook, type GarmentView, type GarmentViewSource, type GarmentViewState, type MountOptions } from './mount';
export type { SizeProvenance } from './drapeBake';
export { checkBundle, gradingLabel } from './bundleCheck';
export type { BodyMeasurements, BodyOptions } from './body';
export { DEFAULT_BODY_HEX, parseSkinHex, type Lighting } from './scene';
export type { DrapeOptions, WaistbandSpec } from './engine';
