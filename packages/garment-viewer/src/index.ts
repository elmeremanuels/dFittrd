/**
 * @curtain/garment-viewer — the on-device 3D estimate of the overlay (docs/ENGINE-HANDOFF.md).
 * Consumed as TypeScript source so the host's bundler handles the drape worker URL. Loaded only by
 * `import()` after the shopper asks for the 3D view: never in the SDK, the peek or the embed entry.
 */
export { mountGarmentView, supportsWebGL2, GarmentViewError, headOf, type AvatarLook, type HeadKind, type BakedSizeView, type GarmentView, type GarmentViewSource, type GarmentViewState, type MountOptions } from './mount';
export type { BakePlace, SizeProvenance } from './drapeBake';
export { checkBundle, gradingLabel } from './bundleCheck';
export type { BodyMeasurements, BodyOptions } from './body';
export { DEFAULT_BODY_HEX, LOOK_EXTRAS, lightingOf, outlineColour, parseSkinHex, type Lighting, type LookExtras } from './scene';
export type { DrapeOptions, NotDrawn, WaistbandSpec } from './engine';
export { mountFigureView, type FigureFrame, type FigureView, type FigureViewOptions } from './figureView';
export { FACE_FADE_DEG, isFaceTexture, type FaceTexture } from './faceOverlay';
export { skinShadingOf, skinToneCare, type SkinShading, type SkinToneCare } from './skin';
export { binarise, flipRows, neighbourSize, PASS_HEIGHT, PASS_WIDTH, type ExportPassesOptions, type ViewerPassImage, type ViewerPasses } from './passes';
