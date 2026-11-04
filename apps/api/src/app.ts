/**
 * build(): the Fastify app with every route mounted. Tests call it with a PGlite db and a
 * MemoryQueue; server.ts calls it with postgres-js and pg-boss.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError, jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { TryOnRouter } from '@paskamer/tryon-providers';
import { TokenService } from './auth/tokens.js';
import { StripeClient } from './billing/stripe.js';
import { stripeRoutes } from './billing/routes.js';
import type { AppContext, FetchLike } from './context.js';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { registerJobs } from './jobs/index.js';
import type { JobQueue } from './jobs/queue.js';
import { HttpError } from './lib/errors.js';
import { appRoutes } from './routes/app.js';
import { merchantRoutes } from './routes/merchant.js';
import { opsRoutes } from './routes/ops.js';
import { renderRoutes } from './routes/renders.js';
import { sdkRoutes } from './routes/sdk.js';
import { tryRoutes } from './routes/try.js';
import { RenderStore } from './services/renders.js';
import { ShopifyClient } from './shopify/client.js';
import { shopifyRoutes } from './shopify/routes.js';
import { buildRouter } from './tryon/providers.js';

export interface BuildOptions {
  env: Env;
  db: Db;
  queue: JobQueue;
  fetch?: FetchLike;
  /** Override the try-on router (tests inject MockProvider). */
  tryon?: TryOnRouter;
  now?: () => Date;
}

export type App = FastifyInstance & { ctx: AppContext };

export async function build(opts: BuildOptions): Promise<App> {
  const { env } = opts;
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Privacy (D3): no client IP in logs unless LOG_IPS=1; never log auth headers.
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-shopify-hmac-sha256"]'], censor: '[redacted]' },
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          id: req.id,
          ...(env.LOG_IPS ? { remoteAddress: req.ip } : {}),
        }),
      },
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
    },
    trustProxy: true,
    bodyLimit: 1_048_576,
    disableRequestLogging: env.NODE_ENV === 'test',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // JSON parser that keeps the raw bytes (merchant HMAC, Shopify/Stripe webhook signatures).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    req.rawBody = buf;
    if (buf.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(buf.toString('utf8')));
    } catch {
      done(new HttpError(400, 'invalid_json', 'body is not valid JSON'), undefined);
    }
  });

  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const tokens = new TokenService(env.JWT_SECRET);
  const renders = new RenderStore(env);
  let router: TryOnRouter | undefined = opts.tryon;
  const ctx: AppContext = {
    env,
    db: opts.db,
    queue: opts.queue,
    tokens,
    log: app.log,
    fetch: fetchImpl,
    now,
    shopify: new ShopifyClient(env, opts.db, fetchImpl),
    stripe: new StripeClient(env, fetchImpl),
    tryon: () => (router ??= buildRouter({ env, fetchImpl })),
  };
  app.decorate('ctx', ctx);
  app.decorate('renders', renders);

  await app.register(helmet, { global: true, contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      error: { code: 'rate_limited', message: `rate limit exceeded, retry in ${Math.ceil(context.ttl / 1000)}s` },
    }),
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Paskamer API', version: '0.1.0', description: 'The one backend: app API, merchant API, SDK host, Shopify app backend, billing.' },
      servers: [{ url: env.PUBLIC_API_URL }],
      components: {
        securitySchemes: {
          device: { type: 'http', scheme: 'bearer', description: 'Device JWT from POST /v1/devices' },
          merchant: { type: 'http', scheme: 'bearer', description: 'sk_… merchant key, Shopify session token, or PK-HMAC' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: { code: 'validation', message: 'request validation failed', details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })) },
      });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'response serialization failed');
      return reply.code(500).send({ error: { code: 'serialization', message: 'response did not match its schema' } });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    const code = status === 429 ? 'rate_limited' : status === 413 ? 'payload_too_large' : status >= 500 ? 'internal' : 'bad_request';
    const message = status >= 500 ? 'internal error' : (e.message ?? 'bad request');
    return reply.code(status).send({ error: { code, message } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'route not found' } }));

  // One CORS policy, decided per request: the SDK routes are `*` (merchant pages anywhere),
  // everything else is limited to the PWA origin(s).
  const appOrigins = [env.PUBLIC_APP_URL, ...env.CORS_ORIGINS];
  await app.register(cors, () => async (req: FastifyRequest) => {
    const url = req.raw.url ?? '';
    const isSdk = url.startsWith('/v1/sdk/') || url.startsWith('/sdk/');
    return { origin: isSdk ? '*' : appOrigins, credentials: false, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], maxAge: 600 };
  });
  await app.register(appRoutes);
  await app.register(tryRoutes);
  await app.register(renderRoutes);
  await app.register(sdkRoutes);
  await app.register(merchantRoutes);
  await app.register(shopifyRoutes);
  await app.register(stripeRoutes);
  await app.register(opsRoutes);

  registerJobs(app as App);

  app.addHook('onClose', async () => {
    await ctx.queue.stop().catch(() => {});
  });

  return app as App;
}

declare module 'fastify' {
  interface FastifyInstance {
    renders: RenderStore;
  }
}
