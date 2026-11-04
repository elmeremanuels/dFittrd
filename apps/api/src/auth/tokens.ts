/**
 * JWTs (jose, HS256 with JWT_SECRET):
 *  - device tokens: 30 days, `sub` = device id, `ver` = token_version (rotation invalidates old ones);
 *  - try tokens: 10 minutes, `jti` stored in try_sessions, carries shop + product;
 *  - signed render URLs: HMAC, not JWT (short and cacheable).
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { hmacHex, safeEqual, uuid } from '../lib/crypto.js';

export interface DeviceClaims {
  deviceId: string;
  tokenVersion: number;
  expiresAt: Date;
}

export interface TryClaims {
  jti: string;
  shopId: string;
  productId: string;
  expiresAt: Date;
}

export class TokenService {
  private readonly key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async signDevice(deviceId: string, tokenVersion: number, ttlDays: number): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    const token = await new SignJWT({ ver: tokenVersion, typ: 'device' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(deviceId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verifyDevice(token: string): Promise<DeviceClaims | null> {
    const p = await this.verify(token);
    if (!p || p.typ !== 'device' || typeof p.sub !== 'string' || typeof p.ver !== 'number' || !p.exp) return null;
    return { deviceId: p.sub, tokenVersion: p.ver, expiresAt: new Date(p.exp * 1000) };
  }

  async signTry(shopId: string, productId: string, ttlSec: number): Promise<{ token: string; jti: string; expiresAt: Date }> {
    const jti = uuid();
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    const token = await new SignJWT({ typ: 'try', sid: shopId, pid: productId })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, jti, expiresAt };
  }

  async verifyTry(token: string): Promise<TryClaims | null> {
    const p = await this.verify(token);
    if (!p || p.typ !== 'try' || typeof p.jti !== 'string' || typeof p.sid !== 'string' || typeof p.pid !== 'string' || !p.exp) return null;
    return { jti: p.jti, shopId: p.sid, productId: p.pid, expiresAt: new Date(p.exp * 1000) };
  }

  /** Signed render URL query: `exp` (unix seconds) + `sig`. */
  signRender(jobId: string, kind: 'image' | 'video', exp: number): string {
    return hmacHex(this.key, `render:${kind}:${jobId}:${exp}`).slice(0, 40);
  }

  verifyRender(jobId: string, kind: 'image' | 'video', exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < now) return false;
    return safeEqual(this.signRender(jobId, kind, exp), sig);
  }

  private async verify(token: string): Promise<JWTPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      return payload;
    } catch {
      return null;
    }
  }
}
