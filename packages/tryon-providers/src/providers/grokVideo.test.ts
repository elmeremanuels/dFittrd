import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockAgent } from 'undici';
import { ConfigError, ModerationError, ProviderDisabledError, ProviderError, TimeoutError, UnsupportedError } from '../errors.js';
import type { FetchLike } from '../types.js';
import { garment, makePng, mockHttp, noSleep, person } from '../test-utils.js';
import { GrokVideoProvider, aspectRatioOf } from './grokVideo.js';

const ORIGIN = 'https://api.x.ai';
const MP4 = Buffer.from('00000018667479706973om', 'hex');

describe('GrokVideoProvider', () => {
  let agent: MockAgent;
  let fetch: FetchLike;
  let still: Uint8Array;
  let flatLay: Uint8Array;

  beforeEach(async () => {
    ({ agent, fetch } = mockHttp());
    still = await makePng(768, 1024);
    flatLay = await makePng(100, 100);
  });
  afterEach(async () => {
    agent.assertNoPendingInterceptors();
    await agent.close();
  });

  function provider(extra: Partial<ConstructorParameters<typeof GrokVideoProvider>[0]> = {}): GrokVideoProvider {
    return new GrokVideoProvider({ apiKey: ('xai' + '-test-key'), fetch, sleep: noSleep, pollIntervalMs: 1, ...extra });
  }

  it('is a video-only adapter with US processing and no EU residency', async () => {
    const p = provider();
    expect(p.capabilities.video).toBe(true);
    expect(p.capabilities.categories).toEqual([]);
    expect(p.capabilities.privacy.euResidency).toBe(false);
    expect(p.capabilities.privacy.retentionHours).toBe(720);
    expect(provider({ zdr: true, getUploadTarget: async () => ({ uploadUrl: 'u', downloadUrl: 'd' }) }).capabilities.privacy.retentionHours).toBe(0);
    expect(p.estimateVideoCost({ durationSec: 6, resolution: '720p' })).toBe(0.48);
    expect(p.estimateCost({ quality: 'balanced' })).toBe(Number.POSITIVE_INFINITY);
    await expect(p.tryOn(person(still), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(UnsupportedError);
  });

  it('requires an own upload_url under Zero Data Retention', async () => {
    const p = provider({ zdr: true });
    expect(await p.healthCheck()).toMatchObject({ ok: false, reason: expect.stringMatching(/upload_url/) });
    await expect(p.animate(still, garment(flatLay), { durationSec: 6, resolution: '720p' })).rejects.toBeInstanceOf(ConfigError);
    expect(await provider({ enabled: false }).healthCheck()).toMatchObject({ ok: false });
    await expect(provider({ enabled: false }).animate(still, garment(flatLay), { durationSec: 6, resolution: '720p' })).rejects.toBeInstanceOf(
      ProviderDisabledError,
    );
  });

  it('POSTs /v1/videos/generations, polls /v1/videos/:id and downloads the mp4', async () => {
    let body: Record<string, unknown> = {};
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/v1/videos/generations',
        method: 'POST',
        headers: { authorization: 'Bearer xai-test-key' },
        body: (b) => {
          body = JSON.parse(b) as Record<string, unknown>;
          return true;
        },
      })
      .reply(200, { request_id: 'req-1' });
    pool.intercept({ path: '/v1/videos/req-1', method: 'GET' }).reply(200, { status: 'pending', progress: 40, model: 'grok-imagine-video-1.5' });
    pool
      .intercept({ path: '/v1/videos/req-1', method: 'GET' })
      .reply(200, { status: 'done', video: { url: 'https://vidgen.x.ai/bucket/xai-video-req-1.mp4', duration: 6, respect_moderation: true } });
    agent.get('https://vidgen.x.ai').intercept({ path: '/bucket/xai-video-req-1.mp4', method: 'GET' }).reply(200, MP4, {
      headers: { 'content-type': 'video/mp4' },
    });

    const res = await provider().animate(still, garment(flatLay), { durationSec: 6, resolution: '720p' });

    expect(body.model).toBe('grok-imagine-video-1.5');
    expect(body.duration).toBe(6);
    expect(body.resolution).toBe('720p');
    expect(body.aspect_ratio).toBe('3:4');
    expect(String((body.image as { url: string }).url).startsWith('data:image/png;base64,')).toBe(true);
    expect(String(body.prompt)).toContain('240 gsm linen');
    expect(body).not.toHaveProperty('output');

    expect(Buffer.from(res.mp4)).toEqual(MP4);
    expect(res).toMatchObject({ durationSec: 6, provider: 'grok-video', model: 'grok-imagine-video-1.5', costUsd: 0.48, disclaimer: 'generated-estimate' });
    expect(res.retention).toEqual({ vendorDeletesAfterHours: 720, trainedOn: false });
  });

  it('under ZDR sends output.upload_url and reads the result from our own download URL', async () => {
    let body: Record<string, unknown> = {};
    const pool = agent.get(ORIGIN);
    pool
      .intercept({
        path: '/v1/videos/generations',
        method: 'POST',
        body: (b) => {
          body = JSON.parse(b) as Record<string, unknown>;
          return true;
        },
      })
      .reply(200, { request_id: 'req-2' });
    pool.intercept({ path: '/v1/videos/req-2', method: 'GET' }).reply(200, { status: 'done', video: { url: null, duration: 8, respect_moderation: true } });
    agent
      .get('https://media.curtain.fit')
      .intercept({ path: '/renders/abc.mp4', method: 'GET', headers: { 'x-internal': 'yes' } })
      .reply(200, MP4);

    const res = await provider({
      zdr: true,
      getUploadTarget: async () => ({
        uploadUrl: 'https://media.curtain.fit/renders/abc.mp4?signed=1',
        downloadUrl: 'https://media.curtain.fit/renders/abc.mp4',
        downloadHeaders: { 'x-internal': 'yes' },
      }),
    }).animate(still, garment(flatLay), { durationSec: 8, resolution: '480p', promptHint: 'slow turn' });

    expect(body.output).toEqual({ upload_url: 'https://media.curtain.fit/renders/abc.mp4?signed=1' });
    expect(body.prompt).toBe('slow turn');
    expect(res.costUsd).toBe(0.64);
    expect(res.retention.vendorDeletesAfterHours).toBe(0);
  });

  it('maps failed / moderated / timed-out jobs', async () => {
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: '/v1/videos/generations', method: 'POST' }).reply(200, { request_id: 'bad' });
    pool.intercept({ path: '/v1/videos/bad', method: 'GET' }).reply(200, { status: 'failed', error: { code: 'internal_error', message: 'boom' } });
    await expect(provider().animate(still, garment(flatLay), { durationSec: 4, resolution: '480p' })).rejects.toBeInstanceOf(ProviderError);

    pool.intercept({ path: '/v1/videos/generations', method: 'POST' }).reply(200, { request_id: 'mod' });
    pool.intercept({ path: '/v1/videos/mod', method: 'GET' }).reply(200, { status: 'done', video: { url: '', duration: 4, respect_moderation: false } });
    await expect(provider().animate(still, garment(flatLay), { durationSec: 4, resolution: '480p' })).rejects.toBeInstanceOf(ModerationError);

    pool.intercept({ path: '/v1/videos/generations', method: 'POST' }).reply(200, { request_id: 'slow' });
    pool.intercept({ path: '/v1/videos/slow', method: 'GET' }).reply(200, { status: 'pending', progress: 1 }).persist();
    const err = await new GrokVideoProvider({ apiKey: ('xai' + '-test-key'), fetch, pollIntervalMs: 5 })
      .animate(still, garment(flatLay), { durationSec: 4, resolution: '480p', timeoutMs: 50 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('picks the closest documented aspect ratio', () => {
    expect(aspectRatioOf(1024, 1536)).toBe('2:3');
    expect(aspectRatioOf(768, 1024)).toBe('3:4');
    expect(aspectRatioOf(1920, 1080)).toBe('16:9');
    expect(aspectRatioOf(100, 100)).toBe('1:1');
  });
});
