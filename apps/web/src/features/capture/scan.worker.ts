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
import { estimateSkin, sampleClassLab, sampleSkinLab, SKIN_SAMPLE_INDICES } from './faceSkin';
import { neighbourhood, retainedIndices } from './frameRetainer';
import { SEG } from './landmarks';
import { headTopRow, medianMask, sampleLevels, type CategoryMask } from './maskGeometry';
import { measureScan } from './measure';
import { MODEL_BASE, MODEL_FILES, type PoseVariant } from './models';
import { gateFrame, selectFrames } from './poseGate';
import type { FrameFeatures, GateResult, Landmark, Sex, ViewMeasurement } from './types';
import type { WorkerInbound, WorkerOutbound } from './workerProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
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

async function init(variant: PoseVariant, needPose: boolean, needFace: boolean): Promise<void> {
  const t0 = performance.now();
  const fileset = await FilesetResolver.forVisionTasks(`${modelBase}/wasm`);
  let delegate: 'GPU' | 'CPU' = 'GPU';
  const poseModel = variant === 'full' ? MODEL_FILES.poseFull : MODEL_FILES.poseLite;
  const rebase = (p: string): string => p.replace(MODEL_BASE, modelBase);

  const make = async (d: 'GPU' | 'CPU'): Promise<void> => {
    segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: rebase(MODEL_FILES.segmenter), delegate: d },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    if (needPose) {
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
      face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: rebase(MODEL_FILES.face), delegate: d },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    }
  };
  try {
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
  const placements = placeLevels(f.landmarks, aspect, preferSide);
  const samples = sampleLevels(mask, placements);
  const nose = f.landmarks[0] as Landmark;
  const headTopMask = headTopRow(mask, nose.x);
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
  if (!sel) throw new Error('no usable front frame: the whole body must be visible and still');
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
    const lm: Landmark[] = (res.faceLandmarks[0] ?? []).map((l) => ({ x: l.x, y: l.y }));
    if (lm.length === 0) {
      post({ type: 'faceResult', skin: null, faceTile: null, faceFound: false });
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
    post({ type: 'faceResult', skin, faceTile: { blob, width: out, height: out }, faceFound: true });
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = (ev: MessageEvent<WorkerInbound>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      modelBase = msg.modelBase ?? MODEL_BASE;
      init(msg.variant, msg.needPose, msg.needFace).catch((e: unknown) => post({ type: 'error', stage: 'init', message: errMsg(e) }));
      break;
    case 'frame':
      try {
        onFrame(msg.bitmap, msg.timestamp);
      } catch (e) {
        msg.bitmap.close();
        post({ type: 'error', stage: 'frame', message: errMsg(e) });
      }
      break;
    case 'finish':
      finish(msg.heightCm, msg.weightKg, msg.sex).catch((e: unknown) => {
        post({ type: 'error', stage: 'finish', message: errMsg(e) });
        resetRecording();
      });
      break;
    case 'face':
      analyseFace(msg.bitmap).catch((e: unknown) => post({ type: 'error', stage: 'face', message: errMsg(e) }));
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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
