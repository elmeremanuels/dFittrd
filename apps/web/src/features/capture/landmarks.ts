/** MediaPipe Pose Landmarker (BlazePose GHUM) 33-point index map. */
export const POSE = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export const POSE_LANDMARK_COUNT = 33;

/** Multiclass selfie segmenter class ids (selfie_multiclass_256x256). */
export const SEG = {
  BACKGROUND: 0,
  HAIR: 1,
  BODY_SKIN: 2,
  FACE_SKIN: 3,
  CLOTHES: 4,
  ACCESSORIES: 5,
} as const;

/** Face Landmarker (478 pts) indices used for skin sampling. Approximate canonical-mesh regions. */
export const FACE_REGIONS = {
  leftCheek: [50, 101, 118, 117, 123, 187, 205, 36, 142, 203],
  rightCheek: [280, 330, 347, 346, 352, 411, 425, 266, 371, 423],
  forehead: [10, 109, 338, 67, 297, 103, 332, 9, 151, 108, 337],
  noseBridge: [6, 197, 195, 5, 4],
} as const;

/** Iris centre landmarks (refined landmarks on). */
export const FACE_IRIS = { left: 468, right: 473 } as const;
