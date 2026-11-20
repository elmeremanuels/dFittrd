/**
 * Crypto helpers: merchant keys (scrypt hash + AES-GCM recoverable copy for HMAC verification),
 * pseudonyms, request signatures, content hashes. No secret is read here — callers pass them in.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomAlnum(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALNUM[bytes[i]! % ALNUM.length];
  return out;
}

export const uuid = (): string => randomUUID();

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacHex(secret: string | Uint8Array, data: string | Uint8Array): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function hmacBase64(secret: string | Uint8Array, data: string | Uint8Array): string {
  return createHmac('sha256', secret).update(data).digest('base64');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---- merchant keys ----------------------------------------------------------------------

export type KeyMode = 'live' | 'test';

export interface MerchantKeyPair {
  /** `pk_live_…` — public, used by the SDK on the merchant page. Stable across rotations. */
  publicKeyPrefix: string;
  /** `sk_live_…` — shown once, used for HMAC / Bearer auth. */
  apiKey: string;
}

export function newPublicKeyPrefix(mode: KeyMode): string {
  return `pk_${mode}_${randomAlnum(14)}`;
}

export function newSecretKey(mode: KeyMode): string {
  return `sk_${mode}_${randomAlnum(48)}`;
}

export function newMerchantKeyPair(mode: KeyMode, existingPrefix?: string): MerchantKeyPair {
  return { publicKeyPrefix: existingPrefix ?? newPublicKeyPrefix(mode), apiKey: newSecretKey(mode) };
}

/** scrypt hash with a per-key salt and the server pepper: `scrypt$<saltHex>$<hashHex>`. */
export function hashSecret(secret: string, pepper: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret + pepper, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifySecret(secret: string, stored: string | null | undefined, pepper: string): boolean {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = scryptSync(secret + pepper, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// ---- AES-256-GCM at rest ------------------------------------------------------------------

/** `v1.<ivB64>.<tagB64>.<ctB64>` */
export function encryptString(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptString(blob: string, keyHex: string): string {
  const [v, ivB64, tagB64, ctB64] = blob.split('.');
  if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('bad ciphertext envelope');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

// ---- pseudonyms and signatures ------------------------------------------------------------

/** Per-(device, shop) pseudonym (D3): HMAC of both ids with the server pepper. Merchants only ever see this. */
export function pseudonymFor(deviceId: string, shopId: string, pepper: string): string {
  return hmacHex(pepper, `pseudonym:${deviceId}:${shopId}`).slice(0, 32);
}

/** Canonical JSON (sorted keys, no undefined) so equal payloads hash equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Merchant request signature (WooCommerce plugin): HMAC-SHA256 over
 * `${METHOD}\n${path}\n${ts}\n${sha256(body)}` with the secret key.
 */
export function merchantSigningString(method: string, path: string, ts: string, body: string | Uint8Array): string {
  return `${method.toUpperCase()}\n${path}\n${ts}\n${sha256Hex(body)}`;
}

export function signMerchantRequest(secret: string, method: string, path: string, ts: string, body: string | Uint8Array): string {
  return hmacHex(secret, merchantSigningString(method, path, ts, body));
}
