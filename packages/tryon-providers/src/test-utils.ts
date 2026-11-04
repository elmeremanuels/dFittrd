import sharp from 'sharp';
import { MockAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';
import type { FetchLike, FetchResponseLike, GarmentInput, PersonInput } from './types.js';

export async function makePng(width = 600, height = 800, rgb: [number, number, number] = [200, 120, 90]): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

/** A JPEG carrying EXIF (orientation + copyright) and an embedded sRGB ICC profile. */
export async function makeTaggedJpeg(width = 400, height = 300): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 90 } } })
    .jpeg()
    .withIccProfile('srgb')
    .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'paskamer-test', ImageDescription: 'tagged' } } })
    .toBuffer();
  return new Uint8Array(buf);
}

export function person(image: Uint8Array): PersonInput {
  return { kind: 'avatarRender', image, consentTier: 'heroOptIn' };
}

export function garment(flatLay: Uint8Array, overrides: Partial<GarmentInput> = {}): GarmentInput {
  return {
    id: 'aalter-studio-1',
    category: 'dress',
    flatLayPhoto: flatLay,
    primaryColorHex: '#C97A4F',
    fabric: { primary: 'linen', weightGsm: 240, stretchPct: 2, drape: 0.78, opacity: 0.92, sheen: 0.15 },
    patternBlock: 'wrap',
    size: 'M',
    fitGapCm: { bust: 1, waist: 4 },
    ...overrides,
  };
}

/** Creates a MockAgent that refuses real network access and a FetchLike bound to it. */
export function mockHttp(): { agent: MockAgent; fetch: FetchLike } {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const fetch: FetchLike = (url, init) =>
    undiciFetch(url, { ...(init as object), dispatcher: agent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<FetchResponseLike>;
  return { agent, fetch };
}

export const noSleep = async (): Promise<void> => {};

export function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}
