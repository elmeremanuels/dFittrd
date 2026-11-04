/**
 * Message contract between the main thread and `scan.worker.ts`.
 *
 * Privacy invariant (AGENTS.md rule 1): video frames go INTO the worker as transferred ImageBitmaps
 * and are closed there. What comes OUT is only: landmarks, two category masks, level widths/depths,
 * quality features, ONE base frame (front view, background replaced with cream) and ONE face tile.
 */
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

export type WorkerInbound = WorkerInit | WorkerFrame | WorkerFinish | WorkerFace | { type: 'reset' } | { type: 'dispose' };

export interface ReadyMessage {
  type: 'ready';
  variant: PoseVariant;
  delegate: 'GPU' | 'CPU';
  loadMs: number;
}

export interface ErrorMessage {
  type: 'error';
  stage: 'init' | 'frame' | 'finish' | 'face';
  message: string;
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

export type WorkerOutbound = ReadyMessage | ErrorMessage | GateMessage | ProgressMessage | ScanResultMessage | FaceResultMessage;
