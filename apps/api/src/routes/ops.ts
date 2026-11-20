import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const opsRoutes: FastifyPluginAsyncZod = async (app) => {
  // `commit` is the build's git commit (env GIT_SHA, set in the image), "unknown" on a local run.
  const commit = app.ctx.env.GIT_SHA || 'unknown';
  app.get('/healthz', { schema: { response: { 200: z.object({ ok: z.literal(true), version: z.string(), commit: z.string() }) } } }, async () => ({ ok: true as const, version: '0.1.0', commit }));

  app.get('/readyz', async (_req, reply) => {
    const { ctx } = app;
    const dbOk = await ctx.db.execute?.(sqlSelect1()).then(() => true).catch(() => false);
    const jobsOk = ctx.env.JOBS === '0' || ctx.queue.started();
    const ok = Boolean(dbOk) && jobsOk;
    return reply.code(ok ? 200 : 503).send({ ok, db: Boolean(dbOk), jobs: jobsOk });
  });

  app.get('/v1/openapi.json', { config: { rateLimit: false } }, async () => app.swagger());
};

import { sql } from 'drizzle-orm';
function sqlSelect1() {
  return sql`select 1`;
}
