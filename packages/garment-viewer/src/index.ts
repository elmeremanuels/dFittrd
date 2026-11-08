/**
 * @curtain/garment-viewer — the on-device 3D estimate of the overlay (docs/ENGINE-HANDOFF.md).
 * Consumed as TypeScript source so the host's bundler handles the drape worker URL. Loaded only by
 * `import()` after the shopper asks for the 3D view: never in the SDK, the peek or the embed entry.
 */
export { mountGarmentView, supportsWebGL2, GarmentViewError, type GarmentView, type GarmentViewState, type MountOptions } from './mount';
export { checkBundle, gradingLabel } from './bundleCheck';
export type { BodyMeasurements } from './body';
