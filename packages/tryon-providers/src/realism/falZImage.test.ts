import { describe, expect, it } from 'vitest';
import { isBanned } from '../registry.js';
import type { FetchLike, FetchRequestInit } from '../types.js';
import { encodeRgba } from './codec.js';
import { FakeRealismProvider } from './fake.js';
import { FAL_ZIMAGE_ENDPOINT, FalZImageRealismProvider } from './falZImage.js';
import { runRealism } from './pipeline.js';
import { syntheticPasses } from './synthetic.js';

describe('fal Z-Image-Turbo ControlNet adapter (fake transport only; no live call)', () => {
  it('sends the depth pass and the prompt only, with payload storage off, and passes the checks on a faithful answer', async () => {
    const passes = syntheticPasses({ neighbour: { size: 'L', grow: 10, longer: 14 } });
    // The "vendor" answers with the faithful fake image as a data URI.
    const faithful = await new FakeRealismProvider().enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
    const answer = `data:image/png;base64,${Buffer.from(await encodeRgba(faithful.image)).toString('base64')}`;
    const sent: Array<{ url: string; init: FetchRequestInit | undefined }> = [];
    const fetch: FetchLike = async (url, init) => {
      sent.push({ url, init });
      const text = JSON.stringify({ images: [{ url: answer, width: passes.width, height: passes.height }] });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const provider = new FalZImageRealismProvider({ apiKey: 'test-key-not-real', fetch });
    const r = await runRealism({ passes, provider, prompt: 'photo' });
    expect(r.status).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`https://fal.run/${FAL_ZIMAGE_ENDPOINT}`);
    expect(sent[0]!.init?.headers?.['x-fal-store-io']).toBe('0');
    const body = JSON.parse(String(sent[0]!.init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['control_end', 'control_scale', 'control_start', 'enable_safety_checker', 'image_size', 'image_url', 'num_inference_steps', 'preprocess', 'prompt', 'sync_mode']);
    expect(body.preprocess).toBe('none');
    expect(String(body.image_url)).toMatch(/^data:image\/png;base64,/);
    expect(provider.estimateCostUsd({ passes })).toBeCloseTo(0.0065, 6);
    expect(isBanned(FAL_ZIMAGE_ENDPOINT)).toBe(false);
  });

  it('maps a 401 to an auth error and a missing image to a provider error', async () => {
    const reply = (status: number, body: unknown): FetchLike => async () => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
    const passes = syntheticPasses();
    const input = { kind: 'renderPasses' as const, passes, png: { colour: new Uint8Array(), depth: new Uint8Array([1]), normal: new Uint8Array(), garmentMask: new Uint8Array() }, prompt: 'x', strength: 0.3 };
    await expect(new FalZImageRealismProvider({ apiKey: 'k', fetch: reply(401, {}) }).enhance(input)).rejects.toMatchObject({ code: 'auth' });
    await expect(new FalZImageRealismProvider({ apiKey: 'k', fetch: reply(200, { images: [] }) }).enhance(input)).rejects.toMatchObject({ code: 'provider' });
  });
});
