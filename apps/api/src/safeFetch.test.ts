/**
 * Carry-over #1: the SSRF guard pins DNS. One resolve per hop, every address validated, the
 * connection goes to the validated address (no second lookup to rebind), redirects re-validated.
 */
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress, nodeTransport, safeFetch, UnsafeUrlError, type LookupLike, type PinnedRequest, type PinnedResponse, type PinnedTransport } from './lib/safeFetch.js';

const PUBLIC = '93.184.216.34';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A resolver that answers from a script per hostname: first call → answers[0], second → answers[1], … */
function scriptedLookup(script: Record<string, string[][]>): LookupLike & { calls: string[] } {
  const seen: Record<string, number> = {};
  const calls: string[] = [];
  const fn = (async (hostname: string) => {
    calls.push(hostname);
    const answers = script[hostname];
    if (!answers) throw new Error('ENOTFOUND');
    const i = Math.min(seen[hostname] ?? 0, answers.length - 1);
    seen[hostname] = (seen[hostname] ?? 0) + 1;
    return answers[i]!.map((address) => ({ address, family: net.isIP(address) }));
  }) as LookupLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

/** A transport that records where it was told to connect and answers from a route table. */
function recordingTransport(routes: Record<string, (req: PinnedRequest) => PinnedResponse>): PinnedTransport & { requests: PinnedRequest[] } {
  const requests: PinnedRequest[] = [];
  const fn = (async (req: PinnedRequest) => {
    requests.push(req);
    const route = routes[req.url.href];
    if (!route) return { status: 404, headers: new Headers(), body: new Uint8Array(0) };
    return route(req);
  }) as PinnedTransport & { requests: PinnedRequest[] };
  fn.requests = requests;
  return fn;
}

const png = (): PinnedResponse => ({ status: 200, headers: new Headers({ 'content-type': 'image/png' }), body: PNG });
const redirect = (location: string): PinnedResponse => ({ status: 302, headers: new Headers({ location }), body: new Uint8Array(0) });

describe('safeFetch: DNS pinning', () => {
  it('rebinding: the first lookup is public, a second would be private → we connect to the validated public address, with one lookup', async () => {
    const lookup = scriptedLookup({ 'rebind.example': [[PUBLIC], ['127.0.0.1']] });
    const transport = recordingTransport({ 'https://rebind.example/logo.png': png });
    const res = await safeFetch('https://rebind.example/logo.png', { lookup, transport });
    expect(res?.body).toEqual(PNG);
    expect(lookup.calls).toEqual(['rebind.example']);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.address).toBe(PUBLIC);
    expect(transport.requests[0]!.url.hostname).toBe('rebind.example'); // Host / SNI stay the name
  });

  it('rebinding across a redirect: each hop is resolved and validated again; a private second answer is refused before connecting', async () => {
    const lookup = scriptedLookup({ 'rebind.example': [[PUBLIC], ['10.0.0.7']] });
    const transport = recordingTransport({ 'https://rebind.example/a.png': () => redirect('/b.png') });
    await expect(safeFetch('https://rebind.example/a.png', { lookup, transport })).rejects.toMatchObject({ name: 'UnsafeUrlError', reason: 'private_address' });
    expect(lookup.calls).toEqual(['rebind.example', 'rebind.example']);
    expect(transport.requests.map((r) => r.url.href)).toEqual(['https://rebind.example/a.png']);
  });

  it('every resolved address must be public (one private record poisons the answer)', async () => {
    const lookup = scriptedLookup({ 'mixed.example': [[PUBLIC, '169.254.169.254']] });
    const transport = recordingTransport({});
    await expect(safeFetch('https://mixed.example/x.png', { lookup, transport })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(transport.requests).toHaveLength(0);
  });

  it('a redirect to a private literal or a privately resolving name is refused without connecting there', async () => {
    const lookup = scriptedLookup({ 'cdn.example': [[PUBLIC]], 'inside.example': [['192.168.1.10']] });
    const transport = recordingTransport({
      'https://cdn.example/meta': () => redirect('http://169.254.169.254/latest/meta-data/'),
      'https://cdn.example/name': () => redirect('https://inside.example/x'),
      'https://cdn.example/v6': () => redirect('http://[::ffff:127.0.0.1]/'),
    });
    for (const path of ['meta', 'name', 'v6']) await expect(safeFetch(`https://cdn.example/${path}`, { lookup, transport })).rejects.toMatchObject({ reason: 'private_address' });
    expect(transport.requests.every((r) => r.address === PUBLIC)).toBe(true);
  });

  it('a public redirect is followed to the pinned address of the new host; at most 3 hops', async () => {
    const lookup = scriptedLookup({ 'a.example': [[PUBLIC]], 'b.example': [['2606:4700::1111']] });
    const transport = recordingTransport({ 'https://a.example/x': () => redirect('https://b.example/y'), 'https://b.example/y': png, 'https://a.example/loop': () => redirect('/loop') });
    const res = await safeFetch('https://a.example/x', { lookup, transport, contentTypes: ['image/'] });
    expect(res?.url).toBe('https://b.example/y');
    expect(transport.requests.map((r) => [r.address, r.family])).toEqual([
      [PUBLIC, 4],
      ['2606:4700::1111', 6],
    ]);
    await expect(safeFetch('https://a.example/loop', { lookup, transport })).rejects.toMatchObject({ reason: 'redirects' });
  });

  it('content type and size cap: unavailable (null), not forbidden', async () => {
    const lookup = scriptedLookup({ 'cdn.example': [[PUBLIC]] });
    const transport = recordingTransport({
      'https://cdn.example/x.png': png,
      'https://cdn.example/page': () => ({ status: 200, headers: new Headers({ 'content-type': 'text/html' }), body: new TextEncoder().encode('<html>') }),
      'https://cdn.example/huge': () => ({ status: 200, headers: new Headers({ 'content-type': 'image/png' }), body: null }),
    });
    expect(await safeFetch('https://cdn.example/page', { lookup, transport, contentTypes: ['image/'] })).toBeNull();
    expect(await safeFetch('https://cdn.example/huge', { lookup, transport })).toBeNull();
    expect(await safeFetch('https://cdn.example/x.png', { lookup, transport, maxBytes: 4 })).toBeNull();
    expect((await safeFetch('https://cdn.example/x.png', { lookup, transport, contentTypes: ['image/'] }))?.contentType).toBe('image/png');
  });
});

describe('IPv6 forms that embed an IPv4 address', () => {
  it('judges the embedded IPv4, including the hex form WHATWG URL parsing produces', async () => {
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    for (const ip of ['::ffff:7f00:1', '::7f00:1', '::ffff:0:7f00:1', '64:ff9b::7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', '2002:a9fe:a9fe::1', '2001:0:1::1', 'fec0::1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['::ffff:5db8:d822', '2002:5db8:d822::1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
    await expect(assertPublicUrl('http://[::ffff:127.0.0.1]:3000/')).rejects.toMatchObject({ reason: 'private_address' });
    await expect(assertPublicUrl('http://[::ffff:a9fe:a9fe]/latest/meta-data/')).rejects.toMatchObject({ reason: 'private_address' });
  });
});

describe('nodeTransport: connects to the pinned address, keeps the hostname for Host and SNI', () => {
  const servers: net.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  async function listen(server: net.Server): Promise<number> {
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
  }

  it('HTTP: the name is never resolved (it does not exist), the socket goes to the pinned IP, Host carries the name', async () => {
    let hostHeader = '';
    const port = await listen(
      http.createServer((req, res) => {
        hostHeader = req.headers.host ?? '';
        res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(PNG));
      }),
    );
    const url = new URL(`http://does-not-resolve.invalid:${port}/logo.png`);
    const res = await nodeTransport({ url, address: '127.0.0.1', family: 4, headers: { accept: 'image/*' }, timeoutMs: 5000, maxBytes: 1024 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(PNG);
    expect(hostHeader).toBe(`does-not-resolve.invalid:${port}`);
  });

  it('HTTP: stops reading past maxBytes and does not follow redirects itself', async () => {
    const port = await listen(
      http.createServer((req, res) => {
        if (req.url === '/big') return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(64 * 1024));
        res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
      }),
    );
    const base = { address: '127.0.0.1', family: 4 as const, headers: {}, timeoutMs: 5000, maxBytes: 1024 };
    expect((await nodeTransport({ ...base, url: new URL(`http://pinned.invalid:${port}/big`) })).body).toBeNull();
    const r = await nodeTransport({ ...base, url: new URL(`http://pinned.invalid:${port}/redir`) });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('http://169.254.169.254/');
  });

  it('HTTPS: the TLS ClientHello goes to the pinned IP and carries the hostname as SNI', async () => {
    let sni: string | null = null;
    const port = await listen(
      net.createServer((socket) => {
        socket.once('data', (hello: Buffer) => {
          sni = readSni(hello);
          socket.destroy();
        });
      }),
    );
    const url = new URL(`https://shop.pinned.invalid:${port}/logo.png`);
    await expect(nodeTransport({ url, address: '127.0.0.1', family: 4, headers: {}, timeoutMs: 5000, maxBytes: 1024 })).rejects.toBeTruthy();
    expect(sni).toBe('shop.pinned.invalid');
  });
});

/** Minimal TLS ClientHello parser: returns the server_name extension's host name. */
function readSni(b: Buffer): string | null {
  if (b[0] !== 0x16 || b[5] !== 0x01) return null; // handshake record, ClientHello
  let p = 5 + 4 + 2 + 32; // record header, handshake header, version, random
  p += 1 + b[p]!; // session id
  p += 2 + b.readUInt16BE(p); // cipher suites
  p += 1 + b[p]!; // compression methods
  const end = p + 2 + b.readUInt16BE(p);
  p += 2;
  while (p + 4 <= end) {
    const type = b.readUInt16BE(p);
    const len = b.readUInt16BE(p + 2);
    if (type === 0) {
      const nameLen = b.readUInt16BE(p + 4 + 3);
      return b.subarray(p + 4 + 5, p + 4 + 5 + nameLen).toString('ascii');
    }
    p += 4 + len;
  }
  return null;
}
