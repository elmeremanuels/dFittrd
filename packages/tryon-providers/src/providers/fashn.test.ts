import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockAgent } from 'undici';
import { AuthError, ImageInputError, ModerationError, PoseError, ProviderError, RateLimitError, TimeoutError, UnsupportedError } from '../errors.js';
import type { FetchLike } from '../types.js';
import { garment, makePng, mockHttp, noSleep, person, pngDataUri } from '../test-utils.js';
import { FASHN_CATEGORY_MAP, FashnProvider } from './fashn.js';

const ORIGIN = 'https://api.fashn.ai';

describe('FashnProvider', () => {
  let agent: MockAgent;
  let fetch: FetchLike;
  let avatar: Uint8Array;
  let flatLay: Uint8Array;
  let output: Uint8Array;

  beforeEach(async () => {
    ({ agent, fetch } = mockHttp());
    avatar = await makePng(600, 800);
    flatLay = await makePng(500, 500, [40, 40, 200]);
    output = await makePng(864, 1296, [10, 200, 10]);
  });
  afterEach(async () => {
    agent.assertNoPendingInterceptors();
    await agent.close();
  });

  function provider(extra: Partial<ConstructorParameters<typeof FashnProvider>[0]> = {}): FashnProvider {
    return new FashnProvider({ apiKey: 'fa-test-key', fetch, sleep: noSleep, pollIntervalMs: 1, ...extra });
  }

  it('maps categories per the research doc', () => {
    expect(FASHN_CATEGORY_MAP).toEqual({ top: 'tops', bottom: 'bottoms', dress: 'one-pieces', outerwear: 'tops', shoes: null, accessory: null });
  });

  it('runs tryon-v1.6: POST /v1/run, polls /v1/status/:id, decodes base64 output', async () => {
    let runBody: Record<string, unknown> = {};
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/v1/run',
        method: 'POST',
        headers: { authorization: 'Bearer fa-test-key', 'content-type': 'application/json' },
        body: (b) => {
          runBody = JSON.parse(b) as Record<string, unknown>;
          return true;
        },
      })
      .reply(200, { id: 'pred-1', error: null });
    pool.intercept({ path: '/v1/status/pred-1', method: 'GET' }).reply(200, { id: 'pred-1', status: 'in_queue', error: null });
    pool.intercept({ path: '/v1/status/pred-1', method: 'GET' }).reply(200, { id: 'pred-1', status: 'processing', error: null });
    pool
      .intercept({ path: '/v1/status/pred-1', method: 'GET' })
      .reply(200, { id: 'pred-1', status: 'completed', output: [pngDataUri(output)], error: null }, { headers: { 'x-fashn-credits-used': '1' } });

    const p = provider();
    const res = await p.tryOn(person(avatar), garment(flatLay), { quality: 'balanced', seed: 7 });

    expect(runBody.model_name).toBe('tryon-v1.6');
    const inputs = runBody.inputs as Record<string, unknown>;
    expect(inputs.category).toBe('one-pieces');
    expect(inputs.garment_photo_type).toBe('flat-lay');
    expect(inputs.mode).toBe('balanced');
    expect(inputs.num_samples).toBe(1);
    expect(inputs.return_base64).toBe(true);
    expect(inputs.output_format).toBe('png');
    expect(inputs.seed).toBe(7);
    expect(inputs.segmentation_free).toBe(true);
    expect(inputs.moderation_level).toBe('permissive');
    expect(String(inputs.model_image).startsWith('data:image/png;base64,')).toBe(true);
    expect(String(inputs.garment_image).startsWith('data:image/png;base64,')).toBe(true);
    expect(inputs).not.toHaveProperty('prompt');

    expect(res.provider).toBe('fashn');
    expect(res.model).toBe('tryon-v1.6');
    expect(res.costUsd).toBe(0.075);
    expect(res.disclaimer).toBe('generated-estimate');
    expect(res.retention).toEqual({ vendorDeletesAfterHours: 72, trainedOn: false });
    expect(res.images).toHaveLength(1);
    expect(res.images[0]).toMatchObject({ width: 864, height: 1296, watermark: 'none' });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect((await p.healthCheck()).p50LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('uses garment_photo_type "model" when only product photos exist and accepts raw base64 output', async () => {
    let inputs: Record<string, unknown> = {};
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/v1/run',
        method: 'POST',
        body: (b) => {
          inputs = (JSON.parse(b) as { inputs: Record<string, unknown> }).inputs;
          return true;
        },
      })
      .reply(200, { id: 'pred-2', error: null });
    pool
      .intercept({ path: '/v1/status/pred-2', method: 'GET' })
      .reply(200, { status: 'completed', output: [Buffer.from(output).toString('base64')], error: null });
    const res = await provider().tryOn(
      person(avatar),
      garment(flatLay, { category: 'top', flatLayPhoto: undefined, productPhotos: [flatLay] }),
      { quality: 'fast', numSamples: 1 },
    );
    expect(inputs.garment_photo_type).toBe('model');
    expect(inputs.category).toBe('tops');
    expect(inputs.mode).toBe('performance');
    expect(res.images[0]?.width).toBe(864);
  });

  it('downloads CDN URLs when the vendor returns them', async () => {
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(200, { id: 'pred-3', error: null });
    pool
      .intercept({ path: '/v1/status/pred-3', method: 'GET' })
      .reply(200, { status: 'completed', output: ['https://cdn.fashn.ai/pred-3/output_0.png'], error: null });
    agent.get('https://cdn.fashn.ai').intercept({ path: '/pred-3/output_0.png', method: 'GET' }).reply(200, Buffer.from(output), {
      headers: { 'content-type': 'image/png' },
    });
    const res = await provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' });
    expect(res.images[0]?.height).toBe(1296);
  });

  it('tryon-max sends product_image + prompt + resolution and prices by credits', async () => {
    let body: Record<string, unknown> = {};
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/v1/run',
        method: 'POST',
        body: (b) => {
          body = JSON.parse(b) as Record<string, unknown>;
          return true;
        },
      })
      .reply(200, { id: 'max-1', error: null });
    pool.intercept({ path: '/v1/status/max-1', method: 'GET' }).reply(200, { status: 'completed', output: [pngDataUri(output)], error: null });

    const p = provider({ model: 'tryon-max' });
    expect(p.name).toBe('fashn-max');
    expect(p.capabilities.categories).toContain('shoes');
    expect(p.capabilities.acceptsPrompt).toBe(true);
    expect(p.estimateCost({ quality: 'balanced', resolution: '2k' })).toBe(0.225);
    expect(p.estimateCost({ quality: 'fast', resolution: '1k' })).toBe(0.075);
    expect(p.estimateCost({ quality: 'quality', resolution: '4k', numSamples: 2 })).toBe(0.75);

    const res = await p.tryOn(person(avatar), garment(flatLay, { category: 'shoes' }), { quality: 'balanced', resolution: '2k' });
    expect(body.model_name).toBe('tryon-max');
    const inputs = body.inputs as Record<string, unknown>;
    expect(inputs.product_image).toBeDefined();
    expect(inputs).not.toHaveProperty('garment_image');
    expect(inputs).not.toHaveProperty('category');
    expect(inputs.resolution).toBe('2k');
    expect(inputs.generation_mode).toBe('balanced');
    expect(inputs.num_images).toBe(1);
    expect(String(inputs.prompt)).toContain('240 gsm linen');
    expect(String(inputs.prompt)).toContain('size M');
    expect(res.costUsd).toBe(0.225);
    expect(res.model).toBe('tryon-max');
  });

  it('honours an explicit promptHint on tryon-max', async () => {
    let inputs: Record<string, unknown> = {};
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/v1/run',
        method: 'POST',
        body: (b) => {
          inputs = (JSON.parse(b) as { inputs: Record<string, unknown> }).inputs;
          return true;
        },
      })
      .reply(200, { id: 'max-2', error: null });
    pool.intercept({ path: '/v1/status/max-2', method: 'GET' }).reply(200, { status: 'completed', output: [pngDataUri(output)], error: null });
    await provider({ model: 'tryon-max' }).tryOn(person(avatar), garment(flatLay), { quality: 'fast', promptHint: 'tuck in shirt' });
    expect(inputs.prompt).toBe('tuck in shirt');
  });

  it('rejects shoes/accessories on tryon-v1.6 before any network call', async () => {
    await expect(provider().tryOn(person(avatar), garment(flatLay, { category: 'shoes' }), { quality: 'balanced' })).rejects.toBeInstanceOf(
      UnsupportedError,
    );
  });

  it('maps a failed prediction with PoseError to the typed PoseError (fallthrough)', async () => {
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(200, { id: 'pred-4', error: null });
    pool
      .intercept({ path: '/v1/status/pred-4', method: 'GET' })
      .reply(200, { status: 'failed', error: { name: 'PoseError', message: 'No body pose detected in model image' }, output: null });
    const err = await provider()
      .tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PoseError);
    expect((err as PoseError).fallthrough).toBe(true);
    expect((err as PoseError).vendorCode).toBe('PoseError');
    expect((err as PoseError).provider).toBe('fashn');
  });

  it('maps moderation and image-load failures to non-fallthrough errors', async () => {
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(200, { id: 'pred-5', error: null });
    pool
      .intercept({ path: '/v1/status/pred-5', method: 'GET' })
      .reply(200, { status: 'failed', error: { name: 'ContentModerationError', message: 'flagged' } });
    const mod = await provider()
      .tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })
      .catch((e: unknown) => e);
    expect(mod).toBeInstanceOf(ModerationError);
    expect((mod as ModerationError).fallthrough).toBe(false);

    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(200, { id: 'pred-6', error: null });
    pool
      .intercept({ path: '/v1/status/pred-6', method: 'GET' })
      .reply(200, { status: 'failed', error: { name: 'ImageLoadError', message: 'Error loading model image' } });
    await expect(provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(ImageInputError);
  });

  it('maps HTTP 401 / 429 / 5xx on /v1/run', async () => {
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(401, { error: 'UnauthorizedAccess', message: 'Invalid API key' });
    await expect(provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(AuthError);
    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(429, { error: 'RateLimitExceeded', message: 'slow down' });
    await expect(provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(RateLimitError);
    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(500, 'oversized payload');
    const err = await provider()
      .tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).httpStatus).toBe(500);
  });

  it('times out while polling and reports TimeoutError', async () => {
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/v1/run', method: 'POST' }).reply(200, { id: 'slow', error: null });
    pool.intercept({ path: '/v1/status/slow', method: 'GET' }).reply(200, { status: 'processing', error: null }).persist();
    const p = new FashnProvider({ apiKey: 'fa-test-key', fetch, pollIntervalMs: 5 });
    const err = await p
      .tryOn(person(avatar), garment(flatLay), { quality: 'balanced', timeoutMs: 60 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).fallthrough).toBe(true);
  });

  it('refuses to run without an API key and reports it in healthCheck', async () => {
    const p = new FashnProvider({ apiKey: '', fetch });
    expect(await p.healthCheck()).toEqual({ ok: false, reason: 'FASHN_API_KEY missing' });
    await expect(p.tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toThrow(/FASHN_API_KEY/);
  });

  it('refuses anything but an avatar render with hero opt-in (D3)', async () => {
    const bad = { kind: 'userPhoto', image: avatar, consentTier: 'heroOptIn' } as unknown as Parameters<FashnProvider['tryOn']>[0];
    await expect(provider().tryOn(bad, garment(flatLay), { quality: 'balanced' })).rejects.toThrow(/avatarRender/);
  });
});
