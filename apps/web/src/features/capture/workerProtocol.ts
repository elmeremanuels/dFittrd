/**
 * Message contract between the main thread and `scan.worker.ts`.
 *
 * Privacy invariant (AGENTS.md rule 1): video frames go INTO the worker as transferred ImageBitmaps
 * and are closed there. What comes OUT is only: landmarks, two category masks, level widths/depths,
 * quality features, ONE base frame (front view, background replaced with cream) and ONE face tile.
 */
import type { FaceBakeStats } from './faceBake';
import type { PhotoNotice, SkinSuggestion } from './faceTile';
import type { PoseVariant } from './models';
import type { GateResult, Landmark, ScanMeasurements, Sex, SkinEstimate } from './types';
import type { SilhouetteMask } from './storage';

export interface WorkerInit {
  type: 'init';
  variant: PoseVariant;
  /** Same-origin base path of the self-hosted assets; defaults to MODEL_BASE. */
  modelBase?: string;
  needFace: boolean;
  needPose: boolean;
  /** Load the 16 MB multiclass segmenter (default true). The face-on-head bake does not need it. */
  needSegmenter?: boolean;
  /** Force a delegate (default: GPU, CPU when GPU fails). For measurement only. */
  delegate?: 'GPU' | 'CPU';
}

export interface WorkerFrame {
  type: 'frame';
  bitmap: ImageBitmap;
  /** ms, monotonic. */
  timestamp: number;
}

export interface WorkerFinish {
  type: 'finish';
  heightCm: number;
  weightKg?: number | undefined;
  sex?: Sex | undefined;
}

export interface WorkerFace {
  type: 'face';
  bitmap: ImageBitmap;
}

/**
 * Slice 6 spike (face on the 3D head, behind VITE_AVATAR_FACE_ON_HEAD): bake ONE face photo into a
 * face texture. The bitmap is transferred in and closed here; the landmarks never leave the worker.
 */
export interface WorkerFaceTexture {
  type: 'faceTexture';
  bitmap: ImageBitmap;
  /** The skin colour on the body (`#rrggbb`) the face is matched to; null: not matched. */
  targetSkinHex: string | null;
}

/**
 * Slices 4 and 5 (face photo → skin tone suggestion and a stylised 2D face tile, behind
 * VITE_AVATAR_FACE_PHOTO=live): ONE photo, transferred in and closed here. Only what the shopper said
 * yes to is made: the tile (`tile`, "Use my face") and/or the suggestion (`skin`, "read it from my photo").
 */
export interface WorkerFaceLook {
  type: 'faceLook';
  bitmap: ImageBitmap;
  tile: boolean;
  skin: boolean;
  /** Height over width of the tile (the 2D head). */
  aspect?: number;
}

export type WorkerInbound = WorkerInit | WorkerFrame | WorkerFinish | WorkerFace | WorkerFaceTexture | WorkerFaceLook | { type: 'reset' } | { type: 'dispose' };

export interface ReadyMessage {
  type: 'ready';
  variant: PoseVariant;
  delegate: 'GPU' | 'CPU';
  loadMs: number;
}

/**
 * Errors of the worker that the shopper is told about. The worker sends the code; the page finds
 * the text in its catalogue (`capture.scanErrors`), since the worker cannot know the page's locale.
 */
export type ScanErrorCode = 'no_front_frame';

export interface ErrorMessage {
  type: 'error';
  stage: 'init' | 'frame' | 'finish' | 'face' | 'faceTexture' | 'faceLook';
  /** A diagnostic in English, for the console and the tests; not interface text. */
  message: string;
  /** Set when the error is one the interface has words for. */
  code?: ScanErrorCode;
}

export interface GateMessage {
  type: 'gate';
  index: number;
  timestamp: number;
  gate: GateResult;
  /** Whether a usable front / side frame has been seen so far. */
  haveFront: boolean;
  haveSide: boolean;
  framesSeen: number;
}

export interface ProgressMessage {
  type: 'progress';
  stage: 'segmenting' | 'measuring' | 'rendering';
  pct: number;
}

export interface ScanResultMessage {
  type: 'result';
  scan: ScanMeasurements;
  frontLandmarks: Landmark[];
  sideLandmarks: Landmark[] | null;
  baseFrame: { blob: Blob; width: number; height: number } | null;
  silhouette: { front: SilhouetteMask; side: SilhouetteMask | null };
  stats: { frames: number; passed: number; frontIndex: number; sideIndex: number; frontScore: number; sideScore: number };
}

export interface FaceResultMessage {
  type: 'faceResult';
  skin: SkinEstimate | null;
  faceTile: { blob: Blob; width: number; height: number } | null;
  faceFound: boolean;
}

/** What the face texture bake returns: the texture (RGBA, transferred), a few numbers and the time of each step. No landmark. */
export interface FaceTextureMessage {
  type: 'faceTextureResult';
  faceFound: boolean;
  texture: { rgba: ArrayBuffer; size: number } | null;
  stats: FaceBakeStats | null;
  /** `turned`: the head is turned more than MAX_FRONT_YAW_DEG; `small`: the face is under 160 px wide in the photo. */
  warnings: ('turned' | 'small')[];
  /** ms per step in the worker: pixels out of the bitmap, landmark detection, the bake. */
  timings: { pixelsMs: number; detectMs: number; bakeMs: number };
}

/** What the face-look step returns: a tile (RGBA, transferred), a suggestion and light notices. No landmark, no photo. */
export interface FaceLookMessage {
  type: 'faceLookResult';
  faceFound: boolean;
  tile: { width: number; height: number; rgba: ArrayBuffer; skinLab: { L: number; a: number; b: number } } | null;
  suggestion: SkinSuggestion | null;
  notices: PhotoNotice[];
  /** ms per step in the worker. */
  timings: { pixelsMs: number; detectMs: number; tileMs: number; skinMs: number };
}

export type WorkerOutbound = ReadyMessage | ErrorMessage | GateMessage | ProgressMessage | ScanResultMessage | FaceResultMessage | FaceTextureMessage | FaceLookMessage;
