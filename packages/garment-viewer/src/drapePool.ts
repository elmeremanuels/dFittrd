/**
 * Main-thread side of the drape workers: a small pool of `drape.worker.ts`, one job per worker
 * where possible (each shown size drapes in parallel). `DrapePool.create` returns `null` where
 * module workers are not available; the viewer then steps the cloth on the main thread as before.
 */
import type { DrapeJob, DrapeMessage, DrapeProgress } from './drapeJob';

type Handler = (p: DrapeProgress) => void;

export class DrapePool {
  private readonly workers: { worker: Worker; jobs: Set<number> }[];
  private readonly handlers = new Map<number, { handler: Handler; slot: number }>();
  private nextId = 1;

  private constructor(workers: Worker[], onError: (err: unknown) => void) {
    this.workers = workers.map((worker) => ({ worker, jobs: new Set<number>() }));
    this.workers.forEach(({ worker, jobs }) => {
      worker.onmessage = (e: MessageEvent<DrapeProgress>) => {
        const h = this.handlers.get(e.data.id);
        if (!h) return;
        if (e.data.done) {
          jobs.delete(e.data.id);
          this.handlers.delete(e.data.id);
        }
        h.handler(e.data);
      };
      worker.onerror = (e) => onError(e);
    });
  }

  /** `size` workers (default: one per core but one, at most 3), or `null` without module workers. */
  static create(onError: (err: unknown) => void, size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1))): DrapePool | null {
    try {
      const workers = Array.from({ length: size }, () => new Worker(new URL('./drape.worker.ts', import.meta.url), { type: 'module' }));
      return new DrapePool(workers, onError);
    } catch {
      return null;
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Queue a job on the least busy worker; `handler` gets every progress message. Returns the job id. */
  start(job: Omit<DrapeJob, 'id'>, handler: Handler): number {
    const id = this.nextId++;
    let slot = 0;
    for (let k = 1; k < this.workers.length; k++) if (this.workers[k]!.jobs.size < this.workers[slot]!.jobs.size) slot = k;
    this.workers[slot]!.jobs.add(id);
    this.handlers.set(id, { handler, slot });
    const msg: DrapeMessage = { type: 'start', job: { ...job, id } };
    this.workers[slot]!.worker.postMessage(msg);
    return id;
  }

  cancel(id: number): void {
    const h = this.handlers.get(id);
    if (!h) return;
    this.handlers.delete(id);
    this.workers[h.slot]!.jobs.delete(id);
    const msg: DrapeMessage = { type: 'cancel', id };
    this.workers[h.slot]!.worker.postMessage(msg);
  }

  /** Jobs not finished yet. */
  get pending(): number {
    return this.handlers.size;
  }

  /** Stop every worker (the view was closed). */
  terminate(): void {
    this.handlers.clear();
    for (const { worker } of this.workers) worker.terminate();
  }
}
