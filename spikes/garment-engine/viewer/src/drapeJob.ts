/**
 * One drape as a job that can leave the main thread (docs/ENGINE-HANDOFF.md §Fitting step 4): the
 * cloth, its parameters and the avatar's collision tables, all typed arrays and plain objects, so
 * the job survives `postMessage` (structured clone). `advance` runs it in time slices; the Web
 * Worker (`drape.worker.ts`) and the node tests run the same code. No DOM, no three.js.
 */
import { isSettled, stepCloth, type Cloth, type ClothParams, type Collide } from './cloth';
import { makeCollider, type BodyField } from './collide';

export interface DrapeJob {
  id: number;
  cloth: Cloth;
  params: ClothParams;
  field: BodyField;
  chains: Uint8Array;
  noCollide: Uint8Array;
  clearanceCm: number;
}

export interface DrapeProgress {
  id: number;
  pos: Float32Array;
  time: number;
  calmFrames: number;
  done: boolean;
  /** Solver time spent on this job so far, ms (excludes waiting in the queue). */
  computeMs: number;
}

export type DrapeMessage = { type: 'start'; job: DrapeJob } | { type: 'cancel'; id: number };

/** The collider of a job (built once per job, on the side that runs it). */
export function jobCollider(job: DrapeJob): Collide {
  return makeCollider(job.field, job.clearanceCm, job.chains, job.noCollide);
}

/**
 * Step the job's cloth frame by frame until it settles or `sliceMs` has passed (at least one frame).
 * Returns `true` when settled.
 */
export function advance(job: DrapeJob, collide: Collide, sliceMs: number, now: () => number = () => performance.now()): boolean {
  const t0 = now();
  do {
    if (isSettled(job.cloth, job.params)) return true;
    stepCloth(job.cloth, job.params, collide, 1);
  } while (now() - t0 < sliceMs);
  return isSettled(job.cloth, job.params);
}

export function progressOf(job: DrapeJob, done: boolean, computeMs: number): DrapeProgress {
  return { id: job.id, pos: Float32Array.from(job.cloth.pos), time: job.cloth.time, calmFrames: job.cloth.calmFrames, done, computeMs };
}
