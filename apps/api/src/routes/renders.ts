/**
 * Hero render (opt-in) — the ONLY image-accepting route (D3). Enforced here, again:
 *  - `person.kind` must be 'avatarRender' (the schema literal has no other member);
 *  - consent { tier: 'heroOptIn', ack: true } is required;
 *  - the PNG/JPEG/WebP must decode, be ≤ 1024×1536, and is re-encoded with metadata stripped;
 *  - the job runs through TryOnRouter; results live ≤ 24 h on the local volume.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import { ESTIMATE_DISCLAIMER, HeroRenderAcceptedSchema, HeroRenderRequestSchema, HeroRenderStatusSchema, RENDER_CONSENT_TIER } from '@paskamer/schema';
import { MAX_HEIGHT, MAX_WIDTH } from '@paskamer/tryon-providers';
import { requireDevice } from '../auth/device.js';
import { renderJobs } from '../db/schema.js';
import { JOB } from '../jobs/queue.js';
import { badRequest, forbidden, notFound, tooLarge, unprocessable } from '../lib/errors.js';
import { HOUR } from '../lib/time.js';
import { asGarment, findProduct } from '../services/products.js';
import { signedRenderUrl } from '../services/renders.js';
import { findShopById } from '../services/shops.js';

const MAX_DECODED_BYTES = 7 * 1024 * 1024;

export const renderRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env, tokens, queue, now } = app.ctx;

  app.post(
    '/v1/renders/hero',
    {
      schema: { body: HeroRenderRequestSchema, response: { 202: HeroRenderAcceptedSchema } },
      preHandler: requireDevice,
      bodyLimit: 12 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { person, consent } = req.body;
      // Belt and braces: the schema already rejects anything but 'avatarRender'.
      if ((person as { kind: string }).kind !== 'avatarRender') throw forbidden('only avatar renders may be sent', 'person_kind');
      if (consent.tier !== RENDER_CONSENT_TIER || consent.ack !== true) throw forbidden('hero render consent required', 'consent_required');

      const bytes = Buffer.from(person.imageBase64, 'base64');
      if (bytes.length === 0) throw badRequest('bad_image', 'imageBase64 is empty');
      if (bytes.length > MAX_DECODED_BYTES) throw tooLarge('image exceeds 7 MB');
      let meta: Metadata;
      try {
        meta = await sharp(bytes, { limitInputPixels: MAX_WIDTH * MAX_HEIGHT * 4 }).metadata();
      } catch {
        throw unprocessable('bad_image', 'image could not be decoded');
      }
      const okFormat = meta.format === 'png' || meta.format === 'jpeg' || meta.format === 'webp';
      if (!okFormat || !meta.width || !meta.height) throw unprocessable('bad_image', 'image must be PNG, JPEG or WebP');
      if (meta.width > MAX_WIDTH || meta.height > MAX_HEIGHT) throw unprocessable('image_too_large', `image must be at most ${MAX_WIDTH}×${MAX_HEIGHT}`);
      if (meta.width !== person.width || meta.height !== person.height) throw unprocessable('bad_image', 'declared width/height do not match the image');
      // Re-encode as PNG: sharp drops EXIF/ICC/XMP unless withMetadata() is called.
      const stripped = await sharp(bytes).rotate().png().toBuffer();

      const product = await findProduct(db, req.body.shopId, req.body.productId);
      if (!product || product.status === 'archived') throw notFound('product');
      const shop = await findShopById(db, req.body.shopId);
      if (!shop) throw notFound('shop');
      if (!asGarment(product)) throw unprocessable('product_incomplete', 'product is not complete enough to render');

      const createdAt = now();
      const retentionHours = Math.min(env.RENDER_RETENTION_HOURS, 24);
      const [job] = await db
        .insert(renderJobs)
        .values({
          deviceId: req.device!.id,
          shopId: shop.id,
          productId: product.id,
          size: req.body.size,
          tier: 'heroOptIn',
          consentAcknowledgedAt: new Date(consent.acknowledgedAt),
          videoSeconds: req.body.video?.seconds ?? null,
          status: 'queued',
          retentionHours,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + retentionHours * HOUR),
        })
        .returning();
      const personPath = await app.renders.write(job!.id, 'person', stripped);
      await db.update(renderJobs).set({ personPath }).where(eq(renderJobs.id, job!.id));
      await queue.send(JOB.renderHero, { jobId: job!.id }, { singletonKey: job!.id, retryLimit: 2, expireInSeconds: 600 });
      return reply.code(202).send({ jobId: job!.id, status: 'queued' as const, disclaimer: ESTIMATE_DISCLAIMER });
    },
  );

  app.get('/v1/renders/:jobId', { schema: { params: z.object({ jobId: z.uuid() }), response: { 200: HeroRenderStatusSchema } }, preHandler: requireDevice }, async (req) => {
    const job = await db.query.renderJobs.findFirst({ where: and(eq(renderJobs.id, req.params.jobId), eq(renderJobs.deviceId, req.device!.id)) });
    if (!job) throw notFound('render job');
    const expired = job.status === 'expired' || job.expiresAt < now();
    const status = expired && job.status === 'done' ? 'expired' : job.status;
    return {
      jobId: job.id,
      status,
      ...(status === 'done' && job.resultPath ? { imageUrl: signedRenderUrl(env, tokens, job.id, 'image', job.expiresAt) } : {}),
      ...(status === 'done' && job.videoPath ? { videoUrl: signedRenderUrl(env, tokens, job.id, 'video', job.expiresAt) } : {}),
      ...(job.provider ? { provider: job.provider } : {}),
      ...(job.model ? { model: job.model } : {}),
      retentionHours: job.retentionHours,
      disclaimer: ESTIMATE_DISCLAIMER,
      ...(job.error ? { error: job.error } : {}),
      createdAt: job.createdAt.toISOString(),
      ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {}),
    };
  });

  /** Signed, short-lived file URLs (no device auth so <img src> works; the signature is the capability). */
  app.get(
    '/v1/renders/:jobId/:kind',
    { schema: { params: z.object({ jobId: z.uuid(), kind: z.enum(['image', 'video']) }), querystring: z.object({ exp: z.coerce.number().int(), sig: z.string().min(8).max(64) }) } },
    async (req, reply) => {
      const { jobId, kind } = req.params;
      if (!tokens.verifyRender(jobId, kind, req.query.exp, req.query.sig, now().getTime())) throw forbidden('bad or expired signature', 'bad_signature');
      const job = await db.query.renderJobs.findFirst({ where: eq(renderJobs.id, jobId) });
      if (!job || job.status !== 'done' || job.expiresAt < now()) throw notFound('render');
      const path = kind === 'image' ? job.resultPath : job.videoPath;
      const bytes = path ? await app.renders.read(path) : null;
      if (!bytes) throw notFound('render file');
      return reply
        .header('content-type', kind === 'image' ? 'image/png' : 'video/mp4')
        .header('cache-control', 'private, max-age=600')
        .header('x-paskamer-disclaimer', 'generated-estimate')
        .send(Buffer.from(bytes));
    },
  );
};
