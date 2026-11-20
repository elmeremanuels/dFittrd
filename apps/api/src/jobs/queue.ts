/**
 * Job queue abstraction: pg-boss in production (in-process, D2), an in-memory queue in tests.
 * Handlers are registered by name; `send` enqueues, `schedule` registers a cron.
 */
import { PgBoss } from 'pg-boss';

export type JobHandler<T = unknown> = (data: T, ctx: { id: string; signal?: AbortSignal }) => Promise<void>;

export interface SendOptions {
  /** Delay in seconds (or absolute Date). */
  startAfter?: number | Date;
  /** Dedupe key: a queued/active job with the same key is not enqueued twice. */
  singletonKey?: string;
  retryLimit?: number;
  expireInSeconds?: number;
}

export interface JobQueue {
  readonly kind: 'pg-boss' | 'memory';
  register<T>(name: string, handler: JobHandler<T>): void;
  send<T extends object>(name: string, data: T, opts?: SendOptions): Promise<string | null>;
  schedule(name: string, cron: string, data?: object): Promise<void>;
  start(opts?: { work: boolean }): Promise<void>;
  stop(): Promise<void>;
  started(): boolean;
}

interface MemoryJob {
  id: string;
  name: string;
  data: unknown;
  runAt: number;
  singletonKey?: string;
}

/**
 * In-memory queue for tests and `JOBS=0` dev runs. `drain()` runs every due job; with
 * `autoRun` jobs run on a timer like a real worker would.
 */
export class MemoryQueue implements JobQueue {
  readonly kind = 'memory' as const;
  private readonly handlers = new Map<string, JobHandler<never>>();
  private readonly jobs: MemoryJob[] = [];
  readonly schedules: Array<{ name: string; cron: string; data?: object }> = [];
  readonly completed: Array<{ name: string; data: unknown }> = [];
  readonly failed: Array<{ name: string; data: unknown; error: unknown }> = [];
  private seq = 0;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: { autoRun?: boolean; tickMs?: number } = {}) {}

  register<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<never>);
  }

  async send<T extends object>(name: string, data: T, opts: SendOptions = {}): Promise<string | null> {
    if (opts.singletonKey && this.jobs.some((j) => j.name === name && j.singletonKey === opts.singletonKey)) return null;
    const id = `mem-${++this.seq}`;
    const delay = opts.startAfter instanceof Date ? opts.startAfter.getTime() - Date.now() : (opts.startAfter ?? 0) * 1000;
    const job: MemoryJob = { id, name, data, runAt: Date.now() + Math.max(0, delay) };
    if (opts.singletonKey) job.singletonKey = opts.singletonKey;
    this.jobs.push(job);
    return id;
  }

  async schedule(name: string, cron: string, data?: object): Promise<void> {
    this.schedules.push(data ? { name, cron, data } : { name, cron });
  }

  async start(opts: { work: boolean } = { work: true }): Promise<void> {
    this.running = true;
    if (opts.work && this.opts.autoRun) {
      this.timer = setInterval(() => void this.drain(), this.opts.tickMs ?? 50);
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  started(): boolean {
    return this.running;
  }

  pending(name?: string): MemoryJob[] {
    return this.jobs.filter((j) => !name || j.name === name);
  }

  /** Runs every due job (ignoring delays when `force`). Returns how many ran. */
  async drain(force = false): Promise<number> {
    let ran = 0;
    const now = Date.now();
    const due = this.jobs.filter((j) => force || j.runAt <= now);
    for (const job of due) {
      const idx = this.jobs.indexOf(job);
      if (idx >= 0) this.jobs.splice(idx, 1);
      const handler = this.handlers.get(job.name);
      if (!handler) continue;
      try {
        await handler(job.data as never, { id: job.id });
        this.completed.push({ name: job.name, data: job.data });
      } catch (error) {
        this.failed.push({ name: job.name, data: job.data, error });
      }
      ran++;
    }
    return ran;
  }
}

export interface PgBossQueueOptions {
  connectionString: string;
  schema?: string;
  onError?: (err: Error) => void;
}

export class PgBossQueue implements JobQueue {
  readonly kind = 'pg-boss' as const;
  private readonly boss: PgBoss;
  private readonly handlers = new Map<string, JobHandler<never>>();
  private isStarted = false;

  constructor(opts: PgBossQueueOptions) {
    this.boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema ?? 'pgboss',
      max: 4,
    });
    this.boss.on('error', (err) => opts.onError?.(err as Error));
  }

  register<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<never>);
  }

  async send<T extends object>(name: string, data: T, opts: SendOptions = {}): Promise<string | null> {
    const options: Record<string, unknown> = {};
    if (opts.startAfter !== undefined) options.startAfter = opts.startAfter;
    if (opts.singletonKey) options.singletonKey = opts.singletonKey;
    if (opts.retryLimit !== undefined) options.retryLimit = opts.retryLimit;
    if (opts.expireInSeconds !== undefined) options.expireInSeconds = opts.expireInSeconds;
    return this.boss.send(name, data, options);
  }

  async schedule(name: string, cron: string, data?: object): Promise<void> {
    await this.boss.schedule(name, cron, data ?? null, { tz: 'UTC' });
  }

  async start(opts: { work: boolean } = { work: true }): Promise<void> {
    await this.boss.start();
    for (const name of this.handlers.keys()) {
      await this.boss.createQueue(name, { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 15 * 60 }).catch(() => {});
    }
    if (opts.work) {
      for (const [name, handler] of this.handlers) {
        await this.boss.work(name, { batchSize: 1 }, async (jobs) => {
          for (const job of jobs) await handler(job.data as never, { id: job.id, signal: job.signal });
        });
      }
    }
    this.isStarted = true;
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;
    await this.boss.stop({ graceful: true, timeout: 10_000 });
    this.isStarted = false;
  }

  started(): boolean {
    return this.isStarted;
  }
}

export const JOB = {
  renderHero: 'render-hero',
  pruneRenders: 'prune-renders',
  syncShopifyProduct: 'sync-shopify-product',
  purgeShop: 'purge-shop',
  usageRollup: 'usage-rollup',
  backfillShopify: 'backfill-shopify',
  shopifyTokens: 'shopify-tokens',
} as const;
export type JobName = (typeof JOB)[keyof typeof JOB];
