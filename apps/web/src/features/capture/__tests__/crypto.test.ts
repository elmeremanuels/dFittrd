import { describe, expect, it } from 'vitest';
import { decryptBytes, decryptToBlob, encryptBlob, encryptBytes, generateFrameKey } from '../crypto';

describe('AES-GCM frame encryption', () => {
  it('generates a non-extractable key and round-trips bytes', async () => {
    const key = await generateFrameKey();
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    const plain = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const enc = await encryptBytes(key, plain);
    expect(enc.iv).toHaveLength(12);
    expect(enc.data.byteLength).toBe(plain.length + 16); // GCM tag
    expect(new Uint8Array(await decryptBytes(key, enc))).toEqual(plain);
  });

  it('uses a fresh IV per call and fails with another key', async () => {
    const key = await generateFrameKey();
    const other = await generateFrameKey();
    const a = await encryptBytes(key, new Uint8Array([9]));
    const b = await encryptBytes(key, new Uint8Array([9]));
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    await expect(decryptBytes(other, a)).rejects.toBeDefined();
  });

  it('round-trips a Blob with its MIME type', async () => {
    const key = await generateFrameKey();
    const blob = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' });
    const enc = await encryptBlob(key, blob);
    expect(enc.mimeType).toBe('image/webp');
    const back = await decryptToBlob(key, enc, enc.mimeType);
    expect(back.type).toBe('image/webp');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46]));
  });
});
