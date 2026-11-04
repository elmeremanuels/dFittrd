/**
 * Public API of the capture feature. The Onboarding screen mounts `<CaptureStep />`; everything
 * else is exposed for the profile/privacy screens (storage, deleteScan), the sync layer
 * (buildFitSignature) and tests.
 */
export { CaptureStep, default } from './components/CaptureStep';
export type { CaptureExtras, CaptureStepProps } from './components/CaptureStep';

export { fuseProfile, inflateByDisagreement, type FuseInput, type FuseResult, type FusedPoint, type ManualEntries, type ManualEntry } from './fuse';
export { buildFitSignature, assertNoColourData, ageBucket, type BuiltSignature, type SignatureExtras } from './signature';
export { measureScan, ellipsePerimeter, scaleCmPerPx, girthFromWidthDepth, coverageQuality, SCAN_SIGMA_CM, DEFAULT_ASPECT } from './measure';
export { populationPrior, bmi, PRIOR_COEFFICIENTS, type PriorInput, type PriorEstimate, type PriorLevel } from './prior';
export { placeLevels, LEVELS, TORSO_FRACTIONS, LIMB_FRACTIONS } from './crossSections';
export { gateFrame, gateFeatures, classifyView, selectFrames, gateHint, heightSpanStable, GATE_THRESHOLDS } from './poseGate';
export {
  estimateSkin,
  srgbToLab,
  labToSrgb,
  ita,
  monkFromIta,
  undertoneFromLab,
  seasonEstimate,
  kMeansLab,
  dominantSkinCluster,
  MONK_SWATCHES,
  MONK_ITA_THRESHOLDS,
  SEASONS,
  type Lab,
} from './faceSkin';
export {
  getDb,
  setDb,
  PaskamerDb,
  DB_NAME,
  storageAvailable,
  saveCapture,
  saveBodyProfile,
  loadBodyProfile,
  saveBaseFrame,
  loadBaseFrame,
  saveFaceTile,
  loadFaceTile,
  saveSilhouette,
  loadSilhouette,
  deleteScan,
  type SilhouetteMask,
} from './storage';
export { ScanSession, type ScanSessionOptions } from './scanSession';
export { MODEL_BASE, MODEL_FILES, choosePoseVariant, type PoseVariant } from './models';
export {
  EMPTY_MANUAL_FORM,
  MANUAL_FIELDS,
  MANUAL_RANGES,
  MEASUREMENT_LABELS,
  TAPE_INSTRUCTIONS,
  SCAN_PROTOCOL,
  validateManual,
  manualEntries,
  nextStage,
  type ManualForm,
  type Stage,
  type FlowCaps,
} from './captureMachine';
export type * from './types';
export type { WorkerInbound, WorkerOutbound, ScanResultMessage, FaceResultMessage, GateMessage } from './workerProtocol';
