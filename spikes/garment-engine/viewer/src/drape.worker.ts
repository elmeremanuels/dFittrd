/**
 * Drape Web Worker: runs `DrapeJob`s off the main thread, so the cloth solver is never time-sliced
 * against rendering. Jobs run first in, first out, in slices; after every slice the worker posts the
 * current positions (for the live view) and yields, so a `cancel` can land between slices.
 */
import { advance, jobCollider, progressOf, type DrapeJob, type DrapeMessage, type DrapeProgress } from './drapeJob';
import type { Collide } from './cloth';

const SLICE_MS = 40;

interface WorkerScope {
  onmessage: ((e: MessageEvent<DrapeMessage>) => void) | null;
  postMessage(message: DrapeProgress, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const queue: { job: DrapeJob; collide: Collide; computeMs: number }[] = [];
let scheduled = false;

function schedule(): void {
  if (scheduled || queue.length === 0) return;
  scheduled = true;
  setTimeout(run, 0);
}

function run(): void {
  scheduled = false;
  const head = queue[0];
  if (!head) return;
  const t0 = performance.now();
  const done = advance(head.job, head.collide, SLICE_MS);
  head.computeMs += performance.now() - t0;
  const msg = progressOf(head.job, done, head.computeMs);
  scope.postMessage(msg, [msg.pos.buffer]);
  if (done) queue.shift();
  schedule();
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    queue.push({ job: msg.job, collide: jobCollider(msg.job), computeMs: 0 });
    schedule();
  } else {
    const i = queue.findIndex((q) => q.job.id === msg.id);
    if (i >= 0) queue.splice(i, 1);
  }
};
