/** Anonymous device accounts: `Authorization: Bearer <device JWT>`; token_version must match (rotation). */
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

export async function requireDevice(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = bearerToken(req);
  if (!token) throw unauthorized('device token required');
  const claims = await req.server.ctx.tokens.verifyDevice(token);
  if (!claims) throw unauthorized('invalid or expired device token', 'invalid_token');
  const { db } = req.server.ctx;
  const row = await db.query.devices.findFirst({ where: eq(devices.id, claims.deviceId) });
  if (!row) throw unauthorized('unknown device', 'invalid_token');
  if (row.tokenVersion !== claims.tokenVersion) throw unauthorized('token was rotated', 'token_rotated');
  req.device = { id: row.id, tokenVersion: row.tokenVersion };
  // Touch last_seen_at at most once an hour to keep writes cheap.
  if (Date.now() - row.lastSeenAt.getTime() > 3_600_000) {
    await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, row.id));
  }
}
