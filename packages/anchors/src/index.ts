/**
 * @curtain/anchors — the one anchor vocabulary (D15) shared by the body scan, the fit engine, the
 * garment pipeline and the renderer, plus ring geometry and the grading morph.
 *
 * Pure TypeScript, zero runtime dependencies (D8). Runs in the browser and in the worker.
 */
export {
  ANCHOR_RINGS,
  ANCHOR_LENGTHS,
  ANCHOR_BREADTHS,
  BREADTH_RING,
  ANCHOR_IDS,
  CATEGORY_ANCHORS,
  anchorsForCategory,
  isAnchorRing,
  isAnchorLength,
  isAnchorBreadth,
  isAnchorId,
  type AnchorRing,
  type AnchorLength,
  type AnchorBreadth,
  type AnchorId,
  type AnchorValues,
  type AnchorCategory,
  type AnchorSubset,
} from './vocabulary';
export {
  FIT_POINT_TO_ANCHOR,
  ANCHOR_TO_FIT_POINT,
  fitPointToAnchor,
  anchorToFitPoint,
  SCAN_LEVELS,
  SCAN_LEVEL_TO_ANCHOR,
  ANCHOR_TO_SCAN_LEVEL,
  scanLevelToAnchor,
  anchorToScanLevel,
  scanValuesToAnchors,
  LENGTH_KEY_TO_ANCHOR,
  lengthKeyToAnchor,
  type AnchoredFitPoint,
  type ScanLevel,
} from './mappings';
export {
  ellipseCircumference,
  girthFromWidthDepth,
  ellipseFromCircumference,
  scaleEllipseToCircumference,
  ellipseRingPoints,
  type Ellipse,
  type RingPoint,
} from './geometry';
export {
  ANCHOR_CHAINS,
  NOMINAL_RING_HEIGHTS,
  anchorScale,
  monotoneProfile,
  gradingMorph,
  gradeSizes,
  type AnchorChain,
  type MorphOptions,
  type GradingMorph,
  type SizeTarget,
  type SizeMorph,
  type Knot,
} from './grading';
