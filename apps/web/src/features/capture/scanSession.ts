/**
 * Main-thread wrapper around `scan.worker.ts`. Owns the Worker, turns the message protocol into
 * promises/events, and times out model loading so the UI can degrade to manual entry when
 * MediaPipe fails to load (slow network, unsupported WASM-SIMD, blocked assets).
 */
import { choosePoseVariant, type PoseVariant } from './models';
import type { Sex } from './types';
import type { FaceResultMessage, GateMessage, ProgressMessage, ReadyMessage, ScanResultMessage, WorkerInbound, WorkerOutbound } from './workerProtocol';

export interface ScanSessionOptions {
  variant?: PoseVariant | undefined;
  modelBase?: string | undefined;
  needFace?: boolean | undefined;
  needPose?: boolean | undefined;
  /** ms; default 45 s (models are 6–12 MB on a cold cache). */
  initTimeoutMs?: number | undefined;
  /** Test seam: a factory returning a Worker-like object. */
  createWorker?: (() => Worker) | undefined;
}

type Listener<T> = (msg: T) => void;

export class ScanSession {
  private worker: Worker | null = null;
  private readonly gateListeners = new Set<Listener<GateMessage>>();
  private readonly progressListeners = new Set<Listener<ProgressMessage>>();
  private pendingResult: { resolve: (m: ScanResultMessage) => void; reject: (e: Error) => void } | null = null;
  private pendingFace: { resolve: (m: FaceResultMessage) => void; reject: (e: Error) => void } | null = null;
  private pendingReady: { resolve: (m: ReadyMessage) => void; reject: (e: Error) => void } | null = null;
  private readonly opts: Required<Pick<ScanSessionOptions, 'needFace' | 'needPose' | 'initTimeoutMs'>> & ScanSessionOptions;
  ready: ReadyMessage | null = null;
  disposed = false;

  constructor(opts: ScanSessionOptions = {}) {
    this.opts = { needFace: true, needPose: true, initTimeoutMs: 45_000, ...opts };
  }

  static isSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  }

  /** Spawn the worker and load the models. Rejects (and disposes) on error or timeout. */
  init(): Promise<ReadyMessage> {
    if (this.worker) return Promise.reject(new Error('already initialised'));
    const worker = this.opts.createWorker
      ? this.opts.createWorker()
      : new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module', name: 'paskamer-scan' });
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => this.handle(ev.data);
    worker.onerror = (ev) => this.fail(new Error(ev.message || 'scan worker crashed'));
    const variant = this.opts.variant ?? choosePoseVariant();
    return new Promise<ReadyMessage>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('model load timed out')), this.opts.initTimeoutMs);
      this.pendingReady = {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.send({ type: 'init', variant, modelBase: this.opts.modelBase ?? undefined, needFace: this.opts.needFace, needPose: this.opts.needPose } as WorkerInbound);
    });
  }

  onGate(cb: Listener<GateMessage>): () => void {
    this.gateListeners.add(cb);
    return () => this.gateListeners.delete(cb);
  }

  onProgress(cb: Listener<ProgressMessage>): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  /** Transfer one video frame to the worker; the bitmap is owned (and closed) by the worker afterwards. */
  pushFrame(bitmap: ImageBitmap, timestamp: number): void {
    if (!this.worker || this.disposed) {
      bitmap.close();
      return;
    }
    this.send({ type: 'frame', bitmap, timestamp }, [bitmap]);
  }

  finish(params: { heightCm: number; weightKg?: number | undefined; sex?: Sex | undefined }): Promise<ScanResultMessage> {
    if (this.pendingResult) return Promise.reject(new Error('finish already pending'));
    return new Promise((resolve, reject) => {
      this.pendingResult = { resolve, reject };
      this.send({ type: 'finish', ...params });
    });
  }

  analyseFace(bitmap: ImageBitmap): Promise<FaceResultMessage> {
    if (this.pendingFace) {
      bitmap.close();
      return Promise.reject(new Error('face analysis already pending'));
    }
    return new Promise((resolve, reject) => {
      this.pendingFace = { resolve, reject };
      this.send({ type: 'face', bitmap }, [bitmap]);
    });
  }

  reset(): void {
    this.send({ type: 'reset' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.send({ type: 'dispose' });
    } catch {
      /* worker already gone */
    }
    this.worker?.terminate();
    this.worker = null;
    this.fail(new Error('scan session disposed'));
  }

  private send(msg: WorkerInbound, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private fail(e: Error): void {
    this.pendingReady?.reject(e);
    this.pendingResult?.reject(e);
    this.pendingFace?.reject(e);
    this.pendingReady = null;
    this.pendingResult = null;
    this.pendingFace = null;
  }

  private handle(msg: WorkerOutbound): void {
    switch (msg.type) {
      case 'ready':
        this.ready = msg;
        this.pendingReady?.resolve(msg);
        this.pendingReady = null;
        break;
      case 'gate':
        for (const l of this.gateListeners) l(msg);
        break;
      case 'progress':
        for (const l of this.progressListeners) l(msg);
        break;
      case 'result':
        this.pendingResult?.resolve(msg);
        this.pendingResult = null;
        break;
      case 'faceResult':
        this.pendingFace?.resolve(msg);
        this.pendingFace = null;
        break;
      case 'error': {
        const e = new Error(msg.message);
        if (msg.stage === 'init') {
          this.pendingReady?.reject(e);
          this.pendingReady = null;
        } else if (msg.stage === 'finish') {
          this.pendingResult?.reject(e);
          this.pendingResult = null;
        } else if (msg.stage === 'face') {
          this.pendingFace?.reject(e);
          this.pendingFace = null;
        }
        // frame-stage errors are transient: the next frame is tried again
        break;
      }
      default:
        break;
    }
  }
}
