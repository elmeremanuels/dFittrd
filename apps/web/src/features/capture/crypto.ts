/**
 * AES-GCM helpers around WebCrypto for the encrypted base frame (DECISIONS.md D3: "One encrypted
 * base frame (AES-GCM, non-extractable WebCrypto key) … persist in IndexedDB"). Pure over
 * `globalThis.crypto.subtle`, so it is unit-tested in node 22.
 */

export interface EncryptedBytes {
  iv: Uint8Array;
  data: ArrayBuffer;
  alg: 'AES-GCM';
}

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
};

/** A fresh non-extractable 256-bit AES-GCM key. It can be stored in IndexedDB but never exported. */
export function generateFrameKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key: CryptoKey, plain: ArrayBuffer | Uint8Array): Promise<EncryptedBytes> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const src = plain instanceof Uint8Array ? plain : new Uint8Array(plain);
  const buf = new Uint8Array(src.byteLength);
  buf.set(src);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, buf);
  return { iv, data, alg: 'AES-GCM' };
}

export async function decryptBytes(key: CryptoKey, enc: EncryptedBytes): Promise<ArrayBuffer> {
  return subtle().decrypt({ name: 'AES-GCM', iv: enc.iv }, key, enc.data);
}

export async function encryptBlob(key: CryptoKey, blob: Blob): Promise<EncryptedBytes & { mimeType: string }> {
  const enc = await encryptBytes(key, await blob.arrayBuffer());
  return { ...enc, mimeType: blob.type };
}

export async function decryptToBlob(key: CryptoKey, enc: EncryptedBytes, mimeType: string): Promise<Blob> {
  const plain = await decryptBytes(key, enc);
  return new Blob([plain], { type: mimeType });
}
