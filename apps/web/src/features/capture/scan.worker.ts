/// <reference lib="webworker" />
/**
 * Body/face scan Web Worker (DECISIONS.md D5). Loads @mediapipe/tasks-vision from SAME-ORIGIN
 * assets (`/models/…`), gates every video frame with the Pose Landmarker in VIDEO mode, keeps only
 * the candidate frames, then segments the chosen 0°/90° frames (+ neighbours, majority-vote mask),
 * measures per-level widths/depths and posts back landmarks, masks, measurements, quality features,
 * ONE background-replaced base frame and ONE face tile. Video frames never leave this worker.
 */
import { FaceLandmarker, FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
import { placeLevels } from './crossSections';
import { bakeFaceTexture, MAX_FRONT_YAW_DEG, type FaceTopology } from './faceBake';
import faceMeshUv from './faceMeshUv.json';
import { buildFaceTile, photoNotices, suggestSkin } from './faceTile';
import { estimateSkin, sampleClassLab, sampleSkinLab, SKIN_SAMPLE_INDICES } from './faceSkin';
import { neighbourhood, retainedIndices } from './frameRetainer';
import { SEG } from './landmarks';
import { headTopWithoutHair, medianMask, sampleLevels, samplesToFramePx, shoulderSlopeFromMask, type CategoryMask } from './maskGeometry';
import { measureScan } from './measure';
import { installSameOriginOnly } from './sameOriginOnly';
import { MODEL_BASE, MODEL_FILES, VISION_WASM_ES_MODULE, moduleFactoryRearmer, resolveModelBase, type PoseVariant } from './models';
import { gateFrame, selectFrames } from './poseGate';
import { gateSelfie, type FaceBlendshapes } from './selfieGate';
import type { FrameFeatures, GateResult, Landmark, Sex, ViewMeasurement } from './types';
import type { ScanErrorCode, SelfieGateResult, WorkerInbound, WorkerOutbound } from './workerProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
// Before any MediaPipe task exists: refuse every request off this origin (MediaPipe's usage logger, see sameOriginOnly.ts).
installSameOriginOnly(ctx as unknown as Parameters<typeof installSameOriginOnly>[0]);
const post = (msg: WorkerOutbound, transfer: Transferable[] = []): void => ctx.postMessage(msg, transfer);

/** Cream #F5EFE7 — the design-system backdrop used to replace the background. */
const CREAM: readonly [number, number, number] = [0xf5, 0xef, 0xe7];

interface StoredFrame {
  index: number;
  timestamp: number;
  bitmap: ImageBitmap;
  landmarks: Landmark[];
  gate: GateResult;
}

let pose: PoseLandmarker | null = null;
let segmenter: ImageSegmenter | null = null;
let face: FaceLandmarker | null = null;
let modelBase = MODEL_BASE;

let frames = new Map<number, StoredFrame>();
let features: FrameFeatures[] = [];
let spans: number[] = [];
let nextIndex = 0;
let lastTs = -1;
let passed = 0;

function resetRecording(): void {
  for (const f of frames.values()) f.bitmap.close();
  frames = new Map();
  features = [];
  spans = [];
  nextIndex = 0;
  lastTs = -1;
  passed = 0;
}

async function init(variant: PoseVariant, needPose: boolean, needFace: boolean, needSegmenter = true, force?: 'GPU' | 'CPU'): Promise<void> {
  const t0 = performance.now();
  // module worker: the ES-module WASM loader is the only one that works here (see models.ts)
  const fileset = await FilesetResolver.forVisionTasks(`${modelBase}/wasm`, VISION_WASM_ES_MODULE);
  let delegate: 'GPU' | 'CPU' = 'GPU';
  const poseModel = variant === 'full' ? MODEL_FILES.poseFull : MODEL_FILES.poseLite;
  const rebase = (p: string): string => p.replace(MODEL_BASE, modelBase);
  // Every task needs the factory back: MediaPipe clears it after each one (see models.ts).
  const rearm = moduleFactoryRearmer(fileset.wasmLoaderPath);

  const make = async (d: 'GPU' | 'CPU'): Promise<void> => {
    if (needSegmenter) {
      await rearm();
      segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: rebase(MODEL_FILES.segmenter), delegate: d },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    }
    if (needPose) {
      await rearm();
      pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: rebase(poseModel), delegate: d },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    }
    if (needFace) {
      await rearm();
      face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: rebase(MODEL_FILES.face), delegate: d },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });
    }
  };
  try {
    if (force === 'CPU') throw new Error('CPU asked for');
    await make('GPU');
  } catch {
    disposeTasks();
    delegate = 'CPU';
    await make('CPU');
  }
  post({ type: 'ready', variant, delegate, loadMs: Math.round(performance.now() - t0) });
}

function disposeTasks(): void {
  pose?.close();
  segmenter?.close();
  face?.close();
  pose = null;
  segmenter = null;
  face = null;
}

function onFrame(bitmap: ImageBitmap, timestamp: number): void {
  if (!pose) {
    bitmap.close();
    return;
  }
  const ts = timestamp <= lastTs ? lastTs + 1 : timestamp;
  lastTs = ts;
  const index = nextIndex++;
  const size = { width: bitmap.width, height: bitmap.height };
  const res = pose.detectForVideo(bitmap, ts);
  const lm: Landmark[] = (res.landmarks[0] ?? []).map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
  const gate = gateFrame(lm, size, spans);
  if (lm.length === 33) spans.push(gate.features.heightSpan);
  if (spans.length > 32) spans = spans.slice(-32);
  if (gate.ok) passed++;
  features.push({ index, timestamp: ts, gate });
  frames.set(index, { index, timestamp: ts, bitmap, landmarks: lm, gate });

  const sel = selectFrames(features);
  const keep = retainedIndices({ frontIndex: sel?.frontIndex ?? -1, sideIndex: sel?.sideIndex ?? -1, latestIndex: index });
  for (const [i, f] of frames) {
    if (!keep.has(i)) {
      f.bitmap.close();
      frames.delete(i);
    }
  }
  post({
    type: 'gate',
    index,
    timestamp: ts,
    gate,
    haveFront: (sel?.frontIndex ?? -1) >= 0,
    haveSide: (sel?.sideIndex ?? -1) >= 0,
    framesSeen: nextIndex,
  });
}

function segment(bitmap: ImageBitmap): CategoryMask {
  if (!segmenter) throw new Error('segmenter not ready');
  const res = segmenter.segment(bitmap);
  const m = res.categoryMask;
  if (!m) throw new Error('segmenter returned no category mask');
  // The MPMask buffer is only valid until the next call: copy it.
  const data = new Uint8Array(m.getAsUint8Array());
  const out = { width: m.width, height: m.height, data };
  res.close();
  return out;
}

function viewMeasurement(view: 'front' | 'side', f: StoredFrame, mask: CategoryMask): ViewMeasurement {
  const aspect = f.bitmap.width / f.bitmap.height;
  const preferSide = f.gate.features.view === 'right' ? 'right' : 'left';
  const placements = placeLevels(f.landmarks, aspect, preferSide, { view });
  // widths are measured in mask pixels; the scale (head-top → heel) is in frame pixels
  const samples = samplesToFramePx(sampleLevels(mask, placements), mask.width, f.bitmap.width);
  const nose = f.landmarks[0] as Landmark;
  // Head top without hair (carry-over #16): the stature the user typed ends at the skull.
  const headTopMask = headTopWithoutHair(mask, nose.x).row;
  const headTopPx = headTopMask >= 0 ? (headTopMask / mask.height) * f.bitmap.height : Math.max(0, (nose.y - 0.08) * f.bitmap.height);
  const heelPx = Math.max(...[29, 30, 27, 28].map((i) => (f.landmarks[i] as Landmark).y)) * f.bitmap.height;
  return {
    view,
    width: f.bitmap.width,
    height: f.bitmap.height,
    landmarks: f.landmarks,
    samples,
    headTopPx,
    heelPx,
    tiltDeg: f.gate.features.tiltDeg,
    shoulderSlopeDeg: view === 'front' ? shoulderSlopeFromMask(mask, f.landmarks, { width: f.bitmap.width, height: f.bitmap.height }) : undefined,
  };
}

async function renderBaseFrame(f: StoredFrame, mask: CategoryMask): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const { width, height } = f.bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(f.bitmap, 0, 0);
  const img = g.getImageData(0, 0, width, height);
  const d = img.data;
  for (let y = 0; y < height; y++) {
    const my = Math.floor((y / height) * mask.height);
    for (let x = 0; x < width; x++) {
      const mx = Math.floor((x / width) * mask.width);
      if ((mask.data[my * mask.width + mx] ?? 0) === SEG.BACKGROUND) {
        const o = (y * width + x) * 4;
        d[o] = CREAM[0];
        d[o + 1] = CREAM[1];
        d[o + 2] = CREAM[2];
        d[o + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  return { blob, width, height };
}

async function finish(heightCm: number, weightKg: number | undefined, sex: Sex | undefined): Promise<void> {
  const sel = selectFrames(features);
  if (!sel) throw new CodedError('no_front_frame', 'no usable front frame: the whole body must be visible and still');
  const exists = (i: number): boolean => frames.has(i);
  post({ type: 'progress', stage: 'segmenting', pct: 0 });
  const frontIdx = neighbourhood(sel.frontIndex, exists);
  const frontMasks = frontIdx.map((i) => segment((frames.get(i) as StoredFrame).bitmap));
  post({ type: 'progress', stage: 'segmenting', pct: 50 });
  const frontMask = medianMask(frontMasks);
  const frontFrame = frames.get(sel.frontIndex) as StoredFrame;

  let sideMask: CategoryMask | null = null;
  let sideFrame: StoredFrame | null = null;
  if (sel.sideIndex >= 0 && frames.has(sel.sideIndex)) {
    const sideIdx = neighbourhood(sel.sideIndex, exists);
    sideMask = medianMask(sideIdx.map((i) => segment((frames.get(i) as StoredFrame).bitmap)));
    sideFrame = frames.get(sel.sideIndex) as StoredFrame;
  }
  post({ type: 'progress', stage: 'measuring', pct: 70 });
  const front = viewMeasurement('front', frontFrame, frontMask);
  const side = sideFrame && sideMask ? viewMeasurement('side', sideFrame, sideMask) : null;
  const scan = measureScan({
    heightCm,
    weightKg,
    sex,
    front,
    side,
    gatePassRate: features.length > 0 ? passed / features.length : 0,
  });
  post({ type: 'progress', stage: 'rendering', pct: 85 });
  const baseFrame = await renderBaseFrame(frontFrame, frontMask);
  const msg: WorkerOutbound = {
    type: 'result',
    scan,
    frontLandmarks: frontFrame.landmarks,
    sideLandmarks: sideFrame ? sideFrame.landmarks : null,
    baseFrame,
    silhouette: { front: frontMask, side: sideMask },
    stats: {
      frames: features.length,
      passed,
      frontIndex: sel.frontIndex,
      sideIndex: sel.sideIndex,
      frontScore: sel.frontScore,
      sideScore: sel.sideScore,
    },
  };
  post(msg, [frontMask.data.buffer, ...(sideMask ? [sideMask.data.buffer] : [])]);
  resetRecording();
}

async function analyseFace(bitmap: ImageBitmap): Promise<void> {
  try {
    if (!face || !segmenter) throw new Error('face landmarker not ready');
    const { width, height } = bitmap;
    const res = face.detect(bitmap);
    const faceCount = res.faceLandmarks.length;
    const lm: Landmark[] = (res.faceLandmarks[0] ?? []).map((l) => ({ x: l.x, y: l.y }));

    // Selfie quality gate: run before any processing, on the raw landmarks and pixels.
    let selfieGate: SelfieGateResult | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      const sCanvas = new OffscreenCanvas(width, height);
      const sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
      if (sCtx) {
        sCtx.drawImage(bitmap, 0, 0);
        const sImg = sCtx.getImageData(0, 0, width, height);
        const bs: FaceBlendshapes | null = res.faceBlendshapes?.[0]
          ? Object.fromEntries(res.faceBlendshapes[0].categories.map((c) => [c.categoryName, c.score])) as FaceBlendshapes
          : null;
        const r = gateSelfie(faceCount, lm, { width, height, data: sImg.data }, bs);
        selfieGate = { ok: r.ok, reasons: r.reasons };
      }
    }

    if (lm.length === 0) {
      post({ type: 'faceResult', skin: null, faceTile: null, faceFound: false, selfieGate });
      return;
    }
    const mask = segment(bitmap);
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas unavailable');
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('2d context unavailable');
    g.drawImage(bitmap, 0, 0);
    const img = g.getImageData(0, 0, width, height);
    const rgba = { width, height, data: img.data };
    const radius = Math.max(2, Math.round(width * 0.008));
    const skinSamples = sampleSkinLab(rgba, lm, SKIN_SAMPLE_INDICES, mask, radius);
    const hairSamples = sampleClassLab(rgba, mask, SEG.HAIR, 4);
    const skin = estimateSkin(skinSamples, hairSamples);

    // Identity tile: square crop around the face bbox (extra headroom for hair), background → cream.
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const p of lm) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const fw = (maxX - minX) * width;
    const fh = (maxY - minY) * height;
    const sizePx = Math.min(Math.max(fw * 1.9, fh * 1.7), Math.min(width, height));
    const cx = ((minX + maxX) / 2) * width;
    const cy = ((minY + maxY) / 2) * height - fh * 0.15;
    const x0 = Math.round(Math.max(0, Math.min(width - sizePx, cx - sizePx / 2)));
    const y0 = Math.round(Math.max(0, Math.min(height - sizePx, cy - sizePx / 2)));
    const s = Math.round(sizePx);
    const tile = new OffscreenCanvas(s, s);
    const tg = tile.getContext('2d', { willReadFrequently: true });
    if (!tg) throw new Error('2d context unavailable');
    tg.drawImage(bitmap, x0, y0, s, s, 0, 0, s, s);
    const td = tg.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      const my = Math.floor(((y0 + y) / height) * mask.height);
      for (let x = 0; x < s; x++) {
        const mx = Math.floor(((x0 + x) / width) * mask.width);
        if ((mask.data[my * mask.width + mx] ?? 0) === SEG.BACKGROUND) {
          const o = (y * s + x) * 4;
          td.data[o] = CREAM[0];
          td.data[o + 1] = CREAM[1];
          td.data[o + 2] = CREAM[2];
          td.data[o + 3] = 255;
        }
      }
    }
    tg.putImageData(td, 0, 0);
    const out = 320;
    const small = new OffscreenCanvas(out, out);
    const sg = small.getContext('2d');
    if (!sg) throw new Error('2d context unavailable');
    sg.drawImage(tile, 0, 0, out, out);
    const blob = await small.convertToBlob({ type: 'image/webp', quality: 0.92 });
    post({ type: 'faceResult', skin, faceTile: { blob, width: out, height: out }, faceFound: true, selfieGate });
  } finally {
    bitmap.close();
  }
}

/**
 * Slice 6 spike: one face photo → a face texture in the head v2 face frame. The landmarks live only
 * in this function and are dropped when it returns; the photo's pixels and the bitmap too.
 */
async function bakeFace(bitmap: ImageBitmap, targetSkinHex: string | null): Promise<void> {
  try {
    if (!face) throw new Error('face landmarker not ready');
    const t0 = performance.now();
    const res = face.detect(bitmap);
    const t1 = performance.now();
    const lm = res.faceLandmarks[0] ?? [];
    if (lm.length < 468) {
      post({ type: 'faceTextureResult', faceFound: false, texture: null, stats: null, warnings: [], timings: { pixelsMs: 0, detectMs: Math.round(t1 - t0), bakeMs: 0 } });
      return;
    }
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas unavailable');
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('2d context unavailable');
    g.drawImage(bitmap, 0, 0);
    const img = g.getImageData(0, 0, width, height);
    const t2 = performance.now();
    const bake = bakeFaceTexture(img, lm, faceMeshUv as unknown as FaceTopology, { targetSkinHex });
    const t3 = performance.now();
    const warnings: ('turned' | 'small')[] = [];
    if (Math.abs(bake.stats.yawDeg) > MAX_FRONT_YAW_DEG) warnings.push('turned');
    if (bake.stats.facePx < 160) warnings.push('small');
    const rgba = bake.rgba.buffer as ArrayBuffer;
    post(
      { type: 'faceTextureResult', faceFound: true, texture: { rgba, size: bake.size }, stats: bake.stats, warnings, timings: { pixelsMs: Math.round(t2 - t1), detectMs: Math.round(t1 - t0), bakeMs: Math.round(t3 - t2) } },
      [rgba],
    );
  } finally {
    bitmap.close();
  }
}

/**
 * Slices 4 and 5: one face photo → a stylised 2D face tile and/or a skin tone suggestion, only what
 * was asked for. The landmarks live only in this function; the photo's pixels and the bitmap too.
 */
async function faceLook(bitmap: ImageBitmap, wantTile: boolean, wantSkin: boolean, aspect: number | undefined): Promise<void> {
  try {
    if (!face) throw new Error('face landmarker not ready');
    const t0 = performance.now();
    const res = face.detect(bitmap);
    const t1 = performance.now();
    const lm = res.faceLandmarks[0] ?? [];
    if (lm.length < 468) {
      post({ type: 'faceLookResult', faceFound: false, tile: null, suggestion: null, notices: [], timings: { pixelsMs: 0, detectMs: Math.round(t1 - t0), tileMs: 0, skinMs: 0 } });
      return;
    }
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas unavailable');
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('2d context unavailable');
    g.drawImage(bitmap, 0, 0);
    const img = g.getImageData(0, 0, width, height);
    const t2 = performance.now();
    const tile = wantTile ? buildFaceTile(img, lm, aspect ? { aspect } : {}) : null;
    const t3 = performance.now();
    const suggestion = wantSkin ? suggestSkin(img, lm) : null;
    const notices = photoNotices(img, lm).filter((n) => wantSkin || n === 'turned' || n === 'small');
    const t4 = performance.now();
    const rgba = tile ? (tile.rgba.buffer as ArrayBuffer) : null;
    post(
      {
        type: 'faceLookResult',
        faceFound: true,
        tile: tile && rgba ? { width: tile.width, height: tile.height, rgba, skinLab: tile.skinLab } : null,
        suggestion,
        notices,
        timings: { pixelsMs: Math.round(t2 - t1), detectMs: Math.round(t1 - t0), tileMs: Math.round(t3 - t2), skinMs: Math.round(t4 - t3) },
      },
      rgba ? [rgba] : [],
    );
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = (ev: MessageEvent<WorkerInbound>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      Promise.resolve()
        .then(() => {
          // same-origin only (D3: zero third-party requests); throws for any other origin
          modelBase = resolveModelBase(msg.modelBase, ctx.location.href);
          return init(msg.variant, msg.needPose, msg.needFace, msg.needSegmenter ?? true, msg.delegate);
        })
        .catch((e: unknown) => post({ type: 'error', stage: 'init', ...errFields(e) }));
      break;
    case 'frame':
      try {
        onFrame(msg.bitmap, msg.timestamp);
      } catch (e) {
        msg.bitmap.close();
        post({ type: 'error', stage: 'frame', ...errFields(e) });
      }
      break;
    case 'finish':
      finish(msg.heightCm, msg.weightKg, msg.sex).catch((e: unknown) => {
        post({ type: 'error', stage: 'finish', ...errFields(e) });
        resetRecording();
      });
      break;
    case 'face':
      analyseFace(msg.bitmap).catch((e: unknown) => post({ type: 'error', stage: 'face', ...errFields(e) }));
      break;
    case 'faceTexture':
      bakeFace(msg.bitmap, msg.targetSkinHex).catch((e: unknown) => post({ type: 'error', stage: 'faceTexture', ...errFields(e) }));
      break;
    case 'faceLook':
      faceLook(msg.bitmap, msg.tile, msg.skin, msg.aspect).catch((e: unknown) => post({ type: 'error', stage: 'faceLook', ...errFields(e) }));
      break;
    case 'reset':
      resetRecording();
      break;
    case 'dispose':
      resetRecording();
      disposeTasks();
      ctx.close();
      break;
    default:
      break;
  }
};

/** An error the page has words for: it travels as a code, the message is only a diagnostic. */
class CodedError extends Error {
  constructor(
    readonly code: ScanErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function errFields(e: unknown): { message: string; code?: ScanErrorCode } {
  const message = e instanceof Error ? e.message : String(e);
  return e instanceof CodedError ? { message, code: e.code } : { message };
}
