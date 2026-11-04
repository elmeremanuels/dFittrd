/** Hero render files on the local volume (RENDERS_DIR) and signed URLs for them. */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Env } from '../env.js';
import type { TokenService } from '../auth/tokens.js';

export class RenderStore {
  readonly dir: string;
  constructor(env: Env) {
    this.dir = resolve(env.RENDERS_DIR);
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  path(jobId: string, kind: 'person' | 'image' | 'video'): string {
    const ext = kind === 'video' ? 'mp4' : 'png';
    return join(this.dir, `${jobId}-${kind}.${ext}`);
  }

  async write(jobId: string, kind: 'person' | 'image' | 'video', bytes: Uint8Array): Promise<string> {
    await this.init();
    const p = this.path(jobId, kind);
    await writeFile(p, bytes, { mode: 0o600 });
    return p;
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  async remove(path: string | null | undefined): Promise<void> {
    if (!path) return;
    await rm(path, { force: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}

export function signedRenderUrl(env: Env, tokens: TokenService, jobId: string, kind: 'image' | 'video', expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const sig = tokens.signRender(jobId, kind, exp);
  return `${env.PUBLIC_API_URL}/v1/renders/${jobId}/${kind}?exp=${exp}&sig=${sig}`;
}
