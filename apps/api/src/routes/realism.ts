/**
 * POST /v1/renders/realism — the AI realism layer (D22, docs/research/ai-realism-layer.md).
 *
 *  - Behind the server flag `AI_REALISM` (default off): with the flag off the route does not exist (404).
 *  - Takes the 3D view's render passes only: colour, depth, normals, garment mask, figure mask, and
 *    the neighbouring size's garment mask. There is no field for a person photo, a face or a
 *    measurement (strict schema, AGENTS.md hard rule 1), and the passes guard refuses anything that
 *    does not look like our render (a camera picture has no flat backdrop, no depth, no normals).
 *  - Calls the realism adapter, runs the fidelity checks against the passes, and returns the image
 *    inline or a refusal. Nothing is written to disk or logged; the decoded passes live in memory
 *    for this request only. One privacy-ledger line records what went where.
 *  - Every answer is labelled `ai-enhanced-estimate` with the estimate disclaimer (rule 3).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AI_ENHANCED_LABEL, ESTIMATE_DISCLAIMER, RealismRequestSchema, RealismResponseSchema, RENDER_CONSENT_TIER, type RealismMetrics, type RealismRefusalReason } from '@curtain/schema';
import { checkRenderPasses, decodePasses, isTryOnError, realismPrompt, runRealism, type FidelityReport, type RenderPassMeta } from '@curtain/tryon-providers';
import { requireDevice } from '../auth/device.js';
import { forbidden, HttpError, notFound, unprocessable } from '../lib/errors.js';
import { writeLedger } from '../services/ledger.js';
import { asGarment, findProduct } from '../services/products.js';
import { menComingSoon, shopperReadiness } from '../services/readiness.js';
import { findShopById } from '../services/shops.js';

const REALISM_CATEGORIES = new Set(['top', 'bottom', 'dress', 'outerwear']);

function metricsOf(r: FidelityReport): RealismMetrics | null {
  if (!r.metrics) return null;
  const { pxPerCm: _px, ...m } = r.metrics;
  void _px;
  return { ...m, sizeSeparation: r.sizeSeparation ? { neighbour: r.sizeSeparation.neighbour, visible: r.sizeSeparation.visible, ok: r.sizeSeparation.ok } : null };
}

export const realismRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db, env } = app.ctx;
  if (!env.AI_REALISM) return;

  app.post(
    '/v1/renders/realism',
    {
      schema: { body: RealismRequestSchema, response: { 200: RealismResponseSchema } },
      preHandler: requireDevice,
      bodyLimit: 16 * 1024 * 1024,
      config: { rateLimit: { max: env.AI_REALISM_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { passes: wire, consent } = req.body;
      if (consent.tier !== RENDER_CONSENT_TIER || consent.ack !== true) throw forbidden('consent required', 'consent_required');
      const product = await findProduct(db, req.body.shopId, req.body.productId);
      if (!product || product.status === 'archived') throw notFound('product');
      const shop = await findShopById(db, req.body.shopId);
      if (!shop) throw notFound('shop');
      if ((await shopperReadiness({ db, env }, product, { surface: 'overlay', shop })).state === 'coming_soon') throw menComingSoon();
      const garment = asGarment(product);
      if (!garment) throw unprocessable('product_incomplete', 'product is not complete enough to render');
      if (!REALISM_CATEGORIES.has(garment.category)) throw unprocessable('unsupported_category', 'the AI-enhanced estimate covers garments with a 3D view');

      const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));
      const meta: RenderPassMeta = { ...wire.meta, size: req.body.size, category: garment.category as RenderPassMeta['category'] };
      let passes;
      try {
        passes = await decodePasses(
          {
            colour: b64(wire.colourPng),
            depth: b64(wire.depthPng),
            normal: b64(wire.normalPng),
            garmentMask: b64(wire.garmentMaskPng),
            figureMask: b64(wire.figureMaskPng),
            ...(wire.neighbour ? { neighbour: { size: wire.neighbour.size, garmentMask: b64(wire.neighbour.garmentMaskPng) } } : {}),
          },
          meta,
        );
      } catch {
        throw unprocessable('not_a_render', 'render passes could not be decoded');
      }
      if (passes.width !== wire.width || passes.height !== wire.height) throw unprocessable('not_a_render', 'declared width/height do not match the passes');
      const issues = checkRenderPasses(passes);
      if (issues.length) throw new HttpError(422, 'not_a_render', 'only the 3D view’s render passes are accepted', { issues });

      const provider = app.ctx.realism();
      const base = { label: AI_ENHANCED_LABEL, disclaimer: ESTIMATE_DISCLAIMER } as const;
      let outcome;
      try {
        outcome = await runRealism({ passes, provider, prompt: realismPrompt({ category: garment.category, fabric: garment.fabric?.primary }), maxCostUsd: env.AI_REALISM_MAX_COST_USD });
      } catch (err) {
        if (isTryOnError(err) && err.code === 'budget') throw new HttpError(402, 'over_budget', 'the AI-enhanced estimate is over its cost cap');
        req.log.warn({ code: isTryOnError(err) ? err.code : 'internal', provider: provider.name }, 'realism provider failed');
        return { status: 'refused' as const, reasons: ['provider'] as RealismRefusalReason[], metrics: null, ...base };
      }
      const bytes = wire.colourPng.length + wire.depthPng.length + wire.normalPng.length + wire.garmentMaskPng.length + wire.figureMaskPng.length + (wire.neighbour?.garmentMaskPng.length ?? 0);
      if (outcome.status !== 'refused' || outcome.stage === 'checks') {
        await writeLedger(db, {
          deviceId: req.device!.id,
          shopId: shop.id,
          productExternalId: product.externalId,
          kind: 'hero_render',
          inputs: ['renderPasses'],
          payloadSummary: {
            bytes: Math.round((bytes * 3) / 4),
            fields: ['passes.colour', 'passes.depth', 'passes.normal', 'passes.garmentMask', 'passes.figureMask', ...(wire.neighbour ? ['passes.neighbour'] : []), 'size'],
            provider: outcome.provider,
            model: outcome.model,
            retentionHours: provider.capabilities.retentionHours ?? 0,
            shopId: shop.id,
          },
        });
      }
      if (outcome.status === 'refused') {
        if (outcome.stage === 'passes') throw new HttpError(422, 'not_a_render', 'only the 3D view’s render passes are accepted', { issues: outcome.issues });
        return { status: 'refused' as const, reasons: outcome.report.reasons, metrics: metricsOf(outcome.report), ...base };
      }
      return {
        status: 'ok' as const,
        mimeType: 'image/png' as const,
        imageBase64: Buffer.from(outcome.png).toString('base64'),
        width: outcome.image.width,
        height: outcome.image.height,
        provider: outcome.provider,
        model: outcome.model,
        metrics: metricsOf(outcome.report)!,
        ...base,
      };
    },
  );
};
