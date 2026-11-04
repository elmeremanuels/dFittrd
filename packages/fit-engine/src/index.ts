/**
 * @paskamer/fit-engine — pure, on-device fit scoring and size recommendation
 * (handoff §4.1–4.2, docs/research/fit-engine-spec.md, decisions D5 and D8).
 *
 * Zero runtime dependencies: only types are imported from @paskamer/schema.
 */
export { computeFit, recommendSize, easeTargetFor, footLengthFromEu } from './computeFit';
export { bandFor, bandForWithSigma, type ProbabilisticBand } from './bands';
export { parseSizingNotes, SIZE_UP_PATTERN, SIZE_DOWN_PATTERN, type SizingBias } from './sizingNotes';
export { sigmaFromBodyProfile } from './sigma';
export { fitSummary, fitGapsForRender } from './summary';
export {
  BLOCKS,
  UNKNOWN_BLOCK,
  blockRule,
  CATEGORY_EASE,
  CATEGORY_EASE as easeTable,
  CATEGORY_POINTS,
  POINTS,
  NOTE_ORDER,
  POINT_LABELS,
  ZONE_POINTS,
  DEFAULT_SLACK,
  SHOES_SLACK,
  BAND_SCORES,
  DEFAULT_CONFIDENCE,
  DEFAULT_TRUE_TO_SIZE,
  NOTHING_FITS_BELOW,
  WEARABLE_MIN_SCORE,
  type BlockRule,
  type EaseMap,
  type BandSlack,
} from './constants';
export { round1, round3, normalCdf, erf } from './math';
export {
  BANDS,
  isPointFit,
  type Band,
  type BandEdges,
  type BandProbabilities,
  type BandResult,
  type Category,
  type ComputeFitOptions,
  type FitGarment,
  type FitResult,
  type OmittedPoint,
  type Point,
  type PointFit,
  type PointSigma,
  type RenderGaps,
  type SizeFit,
  type SizeRecommendation,
  type SkippedPoint,
  type TieBreak,
} from './types';
