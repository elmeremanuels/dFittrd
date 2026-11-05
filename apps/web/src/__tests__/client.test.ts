import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, NetworkError, type DeviceCredentials } from '@/api/client';
import type { ClientLedgerEntry } from '@/db/db';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function harness(fetchImpl: typeof fetch) {
  let device: DeviceCredentials = { deviceId: null, token: null, expiresAt: null };
  const ledger: ClientLedgerEntry[] = [];
  const client = new ApiClient({
    baseUrl: 'https://api.example.test/',
    fetchImpl,
    getDevice: () => device,
    setDevice: (d) => {
      device = { deviceId: d.deviceId, token: d.token, expiresAt: d.expiresAt };
    },
    onLedger: (e) => {
      ledger.push(e);
    },
    now: () => new Date('2026-11-04T10:00:00Z'),
  });
  return { client, ledger, device: () => device };
}

const TOKEN = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'jwt.device.token', expiresAt: '2026-12-04T10:00:00.000Z', tokenVersion: 1 };

describe('ApiClient', () => {
  it('registers the device on first run and logs every write in the ledger with at/path/bytes/fields', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/v1/devices')) return json(TOKEN, 201);
      if (String(url).endsWith('/v1/me/signature')) return json({ updatedAt: '2026-11-04T10:00:01Z', ledgerEntryId: '22222222-2222-4222-8222-222222222222' });
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }) as unknown as typeof fetch;
    const { client, ledger, device } = harness(fetchImpl);

    const wire = { version: 1 as const, vector: new Array(80).fill(0), quality: 0.6 };
    const res = await client.putSignature(wire);
    expect(res.ledgerEntryId).toMatch(/^2222/);
    expect(device().token).toBe('jwt.device.token');

    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual(['POST https://api.example.test/v1/devices', 'PUT https://api.example.test/v1/me/signature']);
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt.device.token');
    expect(headers['Content-Type']).toBe('application/json');

    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ kind: 'device', method: 'POST', path: '/v1/devices', fields: ['platform', 'appVersion'], status: 201 });
    expect(ledger[1]).toMatchObject({ kind: 'signature_sync', method: 'PUT', path: '/v1/me/signature', fields: ['version', 'vector', 'quality'], status: 200 });
    expect(ledger[1]!.bytes).toBe(new TextEncoder().encode(JSON.stringify(wire)).length);
    expect(ledger[1]!.at).toBe('2026-11-04T10:00:00.000Z');
    // never values
    expect(JSON.stringify(ledger)).not.toContain('jwt.device.token');
  });

  it('reuses a valid token, does not log reads, and strips the query string from the ledger path', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/v1/swipes')) return json({ accepted: 1, duplicates: 0, usageEventsCreated: 0, ledgerEntryId: '33333333-3333-4333-8333-333333333333' });
      if (String(url).includes('/v1/me/ledger')) return json({ entries: [], nextCursor: null });
      return json({ error: { code: 'x', message: 'y' } }, 500);
    }) as unknown as typeof fetch;
    const { client, ledger } = harness(fetchImpl);
    // pre-seeded token
    await (client as unknown as { opts: { setDevice: (d: typeof TOKEN) => void } }).opts.setDevice(TOKEN);
    await client.getLedger('abc');
    expect(ledger).toHaveLength(0);
    await client.postSwipes({ events: [{ itemId: 'x', action: 'love', at: 1, sizeAtSwipe: 'M', fitScore: 0.9, dealIndex: 1, shopId: '00000000-0000-4000-8000-000000000001', clientId: 'client-id-0001' }] });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: 'swipe_batch', path: '/v1/swipes', fields: ['events'] });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no device registration
  });

  it('records failed writes and classifies errors', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1/devices')) return json(TOKEN);
      if (String(url).endsWith('/v1/swipes')) throw new TypeError('offline');
      if (String(url).endsWith('/v1/me')) return json({ error: { code: 'bad', message: 'invalid' } }, 422);
      return json({}, 200);
    }) as unknown as typeof fetch;
    const { client, ledger } = harness(fetchImpl);
    await expect(client.postSwipes({ events: [] })).rejects.toBeInstanceOf(NetworkError);
    expect(ledger.at(-1)).toMatchObject({ path: '/v1/swipes', status: 'failed' });
    const err = await client.deleteMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).permanent).toBe(true);
    expect(ledger.at(-1)).toMatchObject({ kind: 'erase', method: 'DELETE', path: '/v1/me', status: 422 });
  });

  it('only accepts avatarRender person inputs for hero renders (compile-time guard)', () => {
    type Person = Parameters<ApiClient['requestHeroRender']>[0]['person'];
    // @ts-expect-error — 'userPhoto' is not a PersonInput kind (D3)
    const bad: Person = { kind: 'userPhoto', mimeType: 'image/png', imageBase64: 'x', width: 256, height: 256 };
    expect(bad.kind).toBe('userPhoto');
  });
});

describe('device token lifetime', () => {
  const OLD = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'old.jwt', expiresAt: '2026-11-07T10:00:00.000Z' }; // 3 days left
  function withDevice(fetchImpl: typeof fetch, device: DeviceCredentials) {
    let d = device;
    const ledger: ClientLedgerEntry[] = [];
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      getDevice: () => d,
      setDevice: (n) => {
        d = { deviceId: n.deviceId || d.deviceId, token: n.token || null, expiresAt: n.expiresAt };
      },
      onLedger: (e) => {
        ledger.push(e);
      },
      now: () => new Date('2026-11-04T10:00:00Z'),
    });
    return { client, ledger, device: () => d };
  }

  it('rotates a token in its last week instead of registering a new device (keeps the device id)', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(String(url)).pathname} ${(init?.headers as Record<string, string>).Authorization ?? ''}`);
      if (String(url).endsWith('/v1/devices/rotate')) return json({ ...OLD, token: 'new.jwt', expiresAt: '2026-12-04T10:00:00.000Z', tokenVersion: 2 });
      if (String(url).endsWith('/v1/devices')) return json({ ...TOKEN, deviceId: '99999999-9999-4999-8999-999999999999' }, 201);
      return json({ erased: true, at: '2026-11-04T10:00:00Z' });
    }) as unknown as typeof fetch;
    const { client, device, ledger } = withDevice(fetchImpl, OLD);
    await client.deleteMe();
    expect(calls).toEqual(['POST /v1/devices/rotate Bearer old.jwt', 'DELETE /v1/me Bearer new.jwt']);
    expect(device()).toMatchObject({ deviceId: OLD.deviceId, token: 'new.jwt' });
    expect(ledger.map((l) => l.kind)).toEqual(['device', 'erase']);
  });

  it('keeps using a still-valid token when the rotation fails offline', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${new URL(String(url)).pathname}`);
      if (String(url).endsWith('/v1/devices/rotate')) throw new TypeError('offline');
      return json({ updatedAt: '2026-11-04T10:00:01Z', ledgerEntryId: '22222222-2222-4222-8222-222222222222' });
    }) as unknown as typeof fetch;
    const { client, device } = withDevice(fetchImpl, OLD);
    await client.putSignature({ version: 1, vector: new Array(80).fill(0), quality: 0.5 });
    expect(calls).toEqual(['POST /v1/devices/rotate', 'PUT /v1/me/signature']);
    expect(device().token).toBe('old.jwt');
  });

  it('does not rotate a token with more than a week left', async () => {
    const fetchImpl = vi.fn(async () => json({ items: [] })) as unknown as typeof fetch;
    const { client } = withDevice(fetchImpl, { ...OLD, expiresAt: '2026-11-30T10:00:00.000Z' });
    await client.getWardrobe();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
