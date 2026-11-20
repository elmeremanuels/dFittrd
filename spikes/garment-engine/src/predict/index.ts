/**
 * The drape prediction engine, P0 (docs/PREDICTION-ENGINE.md, decision D18), spike version. Promoted to
 * `packages/drape-prior` only after gate G1. Imports nothing from capture, body or fit modules (`src/predictBoundary.test.ts`,
 * and the eslint rule on `src/predict/**`).
 */
export { PREDICTOR_VERSION, predict, canonical, fnv1a, withSyntheticLength, type PredictProduct } from './predict';
export { DRAPE_TABLE_V0, FRICTION_SIGMA, KNIT_CONSTRUCTIONS, PREDICT_CONSTRUCTIONS, fabricClass, fabricKey, predictMaterial, shrink, type DrapeObservation, type DrapeTable, type FabricOrigin, type Theta } from './material';
export { DEFAULT_FLARE, DEFAULT_LEG, FLARE_RULES, LEG_RULES, OUTERWEAR_SLEEVE, PROXY_DEFAULT_EASE, SIGMA, SLEEVE_STYLE_ALONG, SLEEVE_VOLUME_RULES, UPPER_FLARE, titleRules } from './rules';
export { TOKEN_RULES, cutFeatures, cutText, cutTokens, proxyKind, styleWords } from './cut';
export * from './types';
