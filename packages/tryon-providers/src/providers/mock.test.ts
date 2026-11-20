import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PoseError } from '../errors.js';
import { garment, makePng, person } from '../test-utils.js';
import { MOCK_STAMP, MockProvider, stampEstimate } from './mock.js';

describe('MockProvider', () => {
  it('returns the input image stamped, at zero cost, labelled as an estimate', async () => {
    const avatar = await makePng(600, 800, [250, 250, 250]);
    const p = new MockProvider();
    const res = await p.tryOn(person(avatar), garment(await makePng(10, 10)), { quality: 'balanced', numSamples: 2 });
    expect(res.costUsd).toBe(0);
    expect(res.provider).toBe('mock');
    expect(res.disclaimer).toBe('generated-estimate');
    expect(res.images).toHaveLength(2);
    expect(res.images[0]).toMatchObject({ width: 600, height: 800 });
    // the dark band at the bottom changes the pixels of a plain near-white image
    const band = await sharp(Buffer.from(res.images[0]!.png)).extract({ left: 0, top: 740, width: 600, height: 60 }).toBuffer();
    expect((await sharp(band).stats()).channels[0]!.mean).toBeLessThan(200);
    const top = await sharp(Buffer.from(res.images[0]!.png)).extract({ left: 0, top: 0, width: 600, height: 60 }).toBuffer();
    expect((await sharp(top).stats()).channels[0]!.mean).toBeGreaterThan(240);
    expect(p.calls).toHaveLength(1);
    expect(MOCK_STAMP).toBe('ESTIMATE · MOCK');
  });

  it('can be told to fail, for router tests', async () => {
    const p = new MockProvider({ failWith: new PoseError('no pose') });
    await expect(p.tryOn(person(await makePng(10, 10)), garment(await makePng(10, 10)), { quality: 'fast' })).rejects.toBeInstanceOf(PoseError);
    let n = 0;
    const flaky = new MockProvider({ failWith: () => (n++ < 1 ? new PoseError('first fails') : undefined) });
    await expect(flaky.tryOn(person(await makePng(10, 10)), garment(await makePng(10, 10)), { quality: 'fast' })).rejects.toBeInstanceOf(PoseError);
    await expect(flaky.tryOn(person(await makePng(10, 10)), garment(await makePng(10, 10)), { quality: 'fast' })).resolves.toBeDefined();
  });

  it('animate returns a placeholder mp4 container', async () => {
    const res = await new MockProvider().animate(await makePng(10, 10), garment(await makePng(10, 10)), { durationSec: 6, resolution: '720p' });
    expect(Buffer.from(res.mp4.subarray(4, 8)).toString('ascii')).toBe('ftyp');
    expect(res.durationSec).toBe(6);
    expect(res.costUsd).toBe(0);
  });

  it('stampEstimate escapes XML', async () => {
    const png = await makePng(200, 100);
    await expect(stampEstimate(png, 200, 100, '<a & b>')).resolves.toBeInstanceOf(Uint8Array);
  });
});
