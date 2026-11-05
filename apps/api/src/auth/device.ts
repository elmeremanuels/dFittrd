/**
 * Anonymous device accounts: `Authorization: Bearer <device JWT>`; token_version must match (rotation).
 *
 * Expiry and rotation (carry-over #10): a token past `exp` answers 401 `token_expired` (not
 * `invalid_token`), so the client knows to rotate instead of registering a new device, which
 * would orphan this device's server rows out of reach of `DELETE /v1/me`. Only
 * `requireDeviceForRotation` accepts an expired token, up to DEVICE_TOKEN_ROTATE_GRACE_DAYS past
 * expiry, and rotation bumps token_version atomically, so each token rotates at most once.
 */
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { devices } from '../db/schema.js';
import { unauthorized } from '../lib/errors.js';

export interface DeviceAuth {
  id: string;
  tokenVersion: number;
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

const rotateGraceSec = (req: FastifyRequest): number => req.server.ctx.env.DEVICE_TOKEN_ROTATE_GRACE_DAYS * 86_400;

async function authenticate(req: FastifyRequest, opts: { allowExpired: boolean }): Promise<void> {
  const token = bearerToken(req);
  if (!token) throw unauthorized('device token required');
  const { tokens, db } = req.server.ctx;
  const claims = await tokens.verifyDevice(token, opts.allowExpired ? { graceSec: rotateGraceSec(req) } : {});
  if (!claims) {
    // Tell an expired-but-genuine token apart from garbage, so the client rotates instead of re-registering.
    if (!opts.allowExpired && (await tokens.verifyDevice(token, { graceSec: rotateGraceSec(req) }))) throw unauthorized('device token expired; rotate it', 'token_expired');
    throw unauthorized('invalid or expired device token', 'invalid_token');
  }
  const row = await db.query.devices.findFirst({ where: eq(devices.id, claims.deviceId) });
  if (!row) throw unauthorized('unknown device', 'invalid_token');
  if (row.tokenVersion !== claims.tokenVersion) throw unauthorized('token was rotated', 'token_rotated');
  req.device = { id: row.id, tokenVersion: row.tokenVersion };
  // Touch last_seen_at at most once an hour to keep writes cheap.
  if (Date.now() - row.lastSeenAt.getTime() > 3_600_000) {
    await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, row.id));
  }
}

export async function requireDevice(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await authenticate(req, { allowExpired: false });
}

/** POST /v1/devices/rotate only: also accepts a token up to DEVICE_TOKEN_ROTATE_GRACE_DAYS past its expiry. */
export async function requireDeviceForRotation(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await authenticate(req, { allowExpired: true });
}
