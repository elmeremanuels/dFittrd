import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MockAgent } from 'undici';
import { AuthError, ImageInputError, ModerationError, ProviderDisabledError, ProviderError } from '../errors.js';
import type { FetchLike } from '../types.js';
import { garment, makePng, mockHttp, person } from '../test-utils.js';
import { VERTEX_EU_LOCATIONS, VertexTryOnProvider } from './vertexTryOn.js';

const ORIGIN = 'https://europe-west4-aiplatform.googleapis.com';
const PATH = '/v1/projects/paskamer-prod/locations/europe-west4/publishers/google/models/virtual-try-on-001:predict';

describe('VertexTryOnProvider', () => {
  let agent: MockAgent;
  let fetch: FetchLike;
  let avatar: Uint8Array;
  let flatLay: Uint8Array;
  let output: Uint8Array;
  let tokens = 0;

  beforeEach(async () => {
    ({ agent, fetch } = mockHttp());
    avatar = await makePng(600, 800);
    flatLay = await makePng(500, 500, [40, 40, 200]);
    output = await makePng(600, 800, [10, 200, 10]);
    tokens = 0;
  });
  afterEach(async () => {
    agent.assertNoPendingInterceptors();
    await agent.close();
  });

  function provider(extra: Partial<ConstructorParameters<typeof VertexTryOnProvider>[0]> = {}): VertexTryOnProvider {
    return new VertexTryOnProvider({
      enabled: true,
      projectId: 'paskamer-prod',
      location: 'europe-west4',
      getAccessToken: async () => `ya29.token-${++tokens}`,
      fetch,
      ...extra,
    });
  }

  it('is disabled unless configuration says otherwise', async () => {
    const p = provider({ enabled: false });
    expect(await p.healthCheck()).toMatchObject({ ok: false });
    await expect(p.tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(ProviderDisabledError);
  });

  it('reports EU residency for documented EU regions and SynthID watermarking', () => {
    expect(VERTEX_EU_LOCATIONS).toContain('europe-west4');
    expect(provider().capabilities.privacy).toEqual({
      trainsOnInputs: false,
      retentionHours: 24,
      euResidency: true,
      zdrAvailable: true,
      selfHosted: false,
    });
    expect(provider({ location: 'us-central1' }).capabilities.privacy.euResidency).toBe(false);
    expect(provider({ cachingDisabled: true }).capabilities.privacy.retentionHours).toBe(0);
    expect(provider().capabilities.region).toBe('europe-west4');
    expect(provider().estimateCost({ quality: 'balanced', numSamples: 2 })).toBe(0.12);
  });

  it('calls the regional predict endpoint with personImage + productImages and decodes predictions', async () => {
    let body: Record<string, unknown> = {};
    agent
      .get(ORIGIN)
      .intercept({
        path: PATH,
        method: 'POST',
        headers: { authorization: 'Bearer ya29.token-1' },
        body: (b) => {
          body = JSON.parse(b) as Record<string, unknown>;
          return true;
        },
      })
      .reply(200, {
        predictions: [
          { mimeType: 'image/png', bytesBase64Encoded: Buffer.from(output).toString('base64') },
          { raiFilteredReason: 'blocked by safety filter' },
        ],
      });
    const p = provider({ cachingDisabled: true, safetySetting: 'block_only_high', personGeneration: 'allow_adult', baseSteps: 32 });
    const res = await p.tryOn(person(avatar), garment(flatLay), { quality: 'balanced', numSamples: 2, seed: 11 });

    expect(p.predictUrl).toBe(ORIGIN + PATH);
    const instances = body.instances as Array<Record<string, { image: { bytesBase64Encoded: string } } | Array<{ image: { bytesBase64Encoded: string } }>>>;
    expect(instances).toHaveLength(1);
    const inst = instances[0]!;
    expect((inst.personImage as { image: { bytesBase64Encoded: string } }).image.bytesBase64Encoded.length).toBeGreaterThan(100);
    expect((inst.productImages as Array<{ image: { bytesBase64Encoded: string } }>)).toHaveLength(1);
    expect(body.parameters).toEqual({
      sampleCount: 2,
      seed: 11,
      baseSteps: 32,
      safetySetting: 'block_only_high',
      personGeneration: 'allow_adult',
      outputOptions: { mimeType: 'image/png' },
    });

    expect(res.images).toHaveLength(1); // the filtered prediction is dropped
    expect(res.images[0]).toMatchObject({ width: 600, height: 800, watermark: 'synthid' });
    expect(res.costUsd).toBe(0.06);
    expect(res.model).toBe('virtual-try-on-001');
    expect(res.provider).toBe('vertex-tryon');
    expect(res.retention).toEqual({ vendorDeletesAfterHours: 0, trainedOn: false });
    expect(res.disclaimer).toBe('generated-estimate');
  });

  it('raises ModerationError when every prediction was filtered', async () => {
    agent.get(ORIGIN).intercept({ path: PATH, method: 'POST' }).reply(200, { predictions: [{ raiFilteredReason: 'nope' }] });
    await expect(provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(ModerationError);
  });

  it('maps auth, bad-image and server failures', async () => {
    const pool = agent.get(ORIGIN);
    pool.intercept({ path: PATH, method: 'POST' }).reply(403, { error: { code: 403, message: 'PERMISSION_DENIED' } });
    await expect(provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(AuthError);
    pool.intercept({ path: PATH, method: 'POST' }).reply(400, { error: { code: 400, message: 'Image decoding failed' } });
    await expect(provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(ImageInputError);
    pool.intercept({ path: PATH, method: 'POST' }).reply(503, { error: { message: 'unavailable' } });
    await expect(provider().tryOn(person(avatar), garment(flatLay), { quality: 'balanced' })).rejects.toBeInstanceOf(ProviderError);
  });

  it('does not support shoes/accessories', async () => {
    await expect(provider().tryOn(person(avatar), garment(flatLay, { category: 'accessory' }), { quality: 'balanced' })).rejects.toThrow(
      /not supported/,
    );
  });
});
