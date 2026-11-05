/** Everything a route or job needs, built once in app.ts. */
import type { FastifyBaseLogger } from 'fastify';
import type { TryOnRouter } from '@curtain/tryon-providers';
import type { TokenService } from './auth/tokens.js';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import type { JobQueue } from './jobs/queue.js';
import type { LookupLike } from './lib/safeFetch.js';
import type { ShopifyClient } from './shopify/client.js';
import type { StripeClient } from './billing/stripe.js';

export type FetchLike = typeof fetch;

export interface AppContext {
  env: Env;
  db: Db;
  queue: JobQueue;
  tokens: TokenService;
  log: FastifyBaseLogger;
  /** Built lazily from env (providers + policy); tests inject a router over MockProvider. */
  tryon: () => TryOnRouter;
  shopify: ShopifyClient;
  stripe: StripeClient;
  /** Outbound HTTP (Shopify, Stripe, flat-lay fetch). Tests inject a stub. */
  fetch: FetchLike;
  /** DNS resolution for the SSRF guard on merchant-supplied URLs. Tests inject a stub. */
  lookup: LookupLike;
  now: () => Date;
}
