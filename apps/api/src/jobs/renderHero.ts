/**
 * Hero render job: avatar render (never a raw photo) + merchant flat-lay → TryOnRouter →
 * PNG on the local volume (≤ 24 h) + ledger entry + usage event. Optional video of the still.
 */
import { eq } from 'drizzle-orm';
import { isTryOnError, motionPromptFromMetadata, promptFromMetadata, type GarmentInput, type PersonInput, type VideoOptions } from '@paskamer/tryon-providers';
import type { App } from '../app.js';
import { renderJobs } from '../db/schema.js';
import { writeLedger } from '../services/ledger.js';
import { asGarment, findProductById } from '../services/products.js';
import { recordUsage } from '../services/usage.js';

export interface RenderHeroJob {
  jobId: string;
}

const FLAT_LAY_MAX_BYTES = 10 * 1024 * 1024;

export async function fetchImage(fetchImpl: typeof fetch, url: string, timeoutMs = 10_000): Promise<Uint8Array | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= FLAT_LAY_MAX_BYTES ? buf : null;
  } catch {
    return null;
  }
}

export function videoDuration(seconds: number): VideoOptions['durationSec'] {
  const allowed: VideoOptions['durationSec'][] = [4, 6, 8, 10, 12, 15];
  return allowed.reduce((best, d) => (Math.abs(d - seconds) < Math.abs(best - seconds) ? d : best), allowed[0]!);
}

export function makeRenderHeroHandler(app: App) {
  const { db, fetch: fetchImpl, now } = app.ctx;
  return async ({ jobId }: RenderHeroJob): Promise<void> => {
    const job = await db.query.renderJobs.findFirst({ where: eq(renderJobs.id, jobId) });
    if (!job || job.status === 'done' || job.status === 'expired') return;
    await db.update(renderJobs).set({ status: 'running', startedAt: now() }).where(eq(renderJobs.id, jobId));
    const fail = async (error: string) => {
      await db.update(renderJobs).set({ status: 'failed', error: error.slice(0, 500), finishedAt: now() }).where(eq(renderJobs.id, jobId));
      await app.renders.remove(job.personPath);
      await db.update(renderJobs).set({ personPath: null }).where(eq(renderJobs.id, jobId));
    };
    try {
      const product = await findProductById(db, job.productId);
      const garment = product ? asGarment(product) : null;
      const personBytes = job.personPath ? await app.renders.read(job.personPath) : null;
      if (!product || !garment) return fail('product_unavailable');
      if (!personBytes) return fail('person_image_missing');

      const flatLay = garment.flatLayPhoto ? await fetchImage(fetchImpl, garment.flatLayPhoto) : null;
      const garmentInput: GarmentInput = {
        id: product.externalId,
        category: garment.category,
        ...(flatLay ? { flatLayPhoto: flatLay } : {}),
        primaryColorHex: garment.primaryColorHex,
        fabric: {
          primary: garment.fabric.primary,
          ...(garment.fabric.weightGsm !== undefined ? { weightGsm: garment.fabric.weightGsm } : {}),
          stretchPct: garment.fabric.stretchPct,
          drape: garment.fabric.drape,
          ...(garment.fabric.opacity !== undefined ? { opacity: garment.fabric.opacity } : {}),
          ...(garment.fabric.sheen !== undefined ? { sheen: garment.fabric.sheen } : {}),
        },
        patternBlock: garment.patternBlock,
        size: job.size,
      };
      // The only PersonInput shape that exists: an avatar render under the heroOptIn tier.
      const person: PersonInput = { kind: 'avatarRender', image: personBytes, consentTier: 'heroOptIn' };
      const inputs = ['avatarRender', ...(flatLay ? ['flatLayPhoto'] : []), 'metadataPrompt'];

      const router = app.ctx.tryon();
      const { result, ledger } = await router.render(person, garmentInput, { quality: 'balanced', promptHint: promptFromMetadata(garmentInput) });
      const image = result.images[0];
      if (!image) return fail('provider_returned_no_image');
      const resultPath = await app.renders.write(jobId, 'image', image.png);

      let videoPath: string | null = null;
      let costUsd = ledger.costUsd;
      if (job.videoSeconds) {
        try {
          const v = await router.animate(image.png, garmentInput, { durationSec: videoDuration(job.videoSeconds), resolution: '720p', promptHint: motionPromptFromMetadata(garmentInput) });
          videoPath = await app.renders.write(jobId, 'video', v.result.mp4);
          costUsd += v.ledger.costUsd;
        } catch (err) {
          app.log.warn({ err, jobId }, 'hero video failed; still delivered without a clip');
        }
      }

      await db
        .update(renderJobs)
        .set({ status: 'done', provider: ledger.provider, model: ledger.model, costUsd, latencyMs: ledger.latencyMs, resultPath, videoPath, finishedAt: now(), personPath: null })
        .where(eq(renderJobs.id, jobId));
      await app.renders.remove(job.personPath);

      const retentionHours = Math.min(job.retentionHours, ledger.retentionHours ?? job.retentionHours);
      await writeLedger(db, {
        deviceId: job.deviceId,
        shopId: job.shopId,
        productExternalId: product.externalId,
        kind: 'hero_render',
        inputs,
        payloadSummary: {
          bytes: personBytes.length,
          fields: ['person', 'productId', 'shopId', 'size', 'consent'],
          provider: ledger.provider,
          model: ledger.model,
          retentionHours,
          shopId: job.shopId,
        },
      });
      await recordUsage(db, { shopId: job.shopId, deviceId: job.deviceId, productId: product.id, kind: 'hero_render', costUsd, idempotencyKey: `render:${jobId}` });
    } catch (err) {
      const code = isTryOnError(err) ? err.code : 'internal';
      app.log.error({ err, jobId, code }, 'hero render failed');
      await fail(code);
    }
  };
}
