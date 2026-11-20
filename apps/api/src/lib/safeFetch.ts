/**
 * SSRF guard for server-side fetches of merchant-supplied URLs (flat-lay and product photos, shop
 * logos, the WooCommerce domain proof). The api runs inside the VPS network, next to Postgres and
 * (on cloud hosts) a metadata server, so a merchant must not be able to point a URL at
 * `http://169.254.169.254/…`, `http://postgres:5432`, `http://localhost:3000/v1/…` or a public name
 * that resolves privately.
 *
 * Rules: http(s) only, no credentials in the URL, no blocked hostnames, every A/AAAA record must
 * be a public unicast address, redirects are followed manually (≤ 3) and every hop is re-checked,
 * the body is capped.
 *
 * DNS is PINNED (carry-over #1): each hop resolves the name once, validates every address, and the
 * transport then connects to that validated address. The production transport (`nodeTransport`)
 * hands node:http(s) a `lookup` that only returns the pinned address, so a rebinding DNS server
 * that answers a public address to our check and a private one to the connect has nothing to
 * rebind: there is no second lookup. TLS keeps the real hostname for SNI and certificate checks,
 * and the Host header carries the hostname.
 *
 * `safeFetch` is the ONLY way the api downloads a merchant-supplied URL. The garment-worker ingest
 * (docs/ENGINE-HANDOFF.md stage 1) must use the same rules: either call an api endpoint that goes
 * through `safeFetch`, or port this module (pinned resolve → validate → connect to the IP) to the
 * worker. A plain `fetch(url)` of a merchant URL anywhere server-side is a bug.
 *
 * The DNS lookup and the transport are injectable (tests stub both; nothing in the test suite
 * touches the network).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type LookupLike = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemLookup: LookupLike = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp', '.localdomain'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data', 'ip6-localhost', 'ip6-loopback']);

/** Loopback, link-local, private, CGNAT, multicast, reserved, unspecified — IPv4 and IPv6 (incl. v4-mapped). */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true; // not an IP literal at all → treat as unsafe
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]!;
  // Dotted tail (`::ffff:10.0.0.1`, `64:ff9b::10.0.0.1`) → rewrite it as two hextets first.
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  let normalized = lower;
  if (dotted) {
    if (isIP(dotted[2]!) !== 4) return true;
    const [a, b, c, d] = dotted[2]!.split('.').map(Number) as [number, number, number, number];
    normalized = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const h = expandV6(normalized);
  if (!h) return true;
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zeros = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8) || (zeros(0, 7) && h[7] === 1)) return true; // :: and ::1
  // Forms that carry an IPv4 address (WHATWG URL parsing turns `[::ffff:127.0.0.1]` into
  // `[::ffff:7f00:1]`): judge the embedded IPv4. v4-mapped ::ffff:0:0/96, SIIT ::ffff:0:0:0/96,
  // v4-compatible ::/96 (deprecated) and NAT64 64:ff9b::/96 + 64:ff9b:1::/48.
  if (zeros(0, 5) && h[5] === 0xffff) return isPrivateV4(embeddedV4(h[6]!, h[7]!));
  if (zeros(0, 4) && h[4] === 0xffff && h[5] === 0) return isPrivateV4(embeddedV4(h[6]!, h[7]!));
  if (zeros(0, 6)) return isPrivateV4(embeddedV4(h[6]!, h[7]!));
  if (h[0] === 0x0064 && h[1] === 0xff9b) return zeros(2, 6) ? isPrivateV4(embeddedV4(h[6]!, h[7]!)) : true;
  const first = h[0]!;
  if (first === 0x2002) return isPrivateV4(embeddedV4(h[1]!, h[2]!)); // 6to4 2002::/16
  if (first === 0x2001 && h[1] === 0x0000) return true; // Teredo 2001::/32 (tunnels to an arbitrary IPv4)
  if (first === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (first === 0x0100 && zeros(1, 4)) return true; // discard-only 100::/64
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function expandV6(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const all = [...head, ...Array<string>(missing).fill('0'), ...tail];
  const out = all.map((h) => parseInt(h || '0', 16));
  return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : out;
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(h)) return true;
  if (!h.includes('.')) return true; // single-label names only resolve inside the container network
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

/** Parses + validates a URL (scheme, userinfo, hostname, DNS) and returns it with its resolved addresses. */
export async function assertPublicUrl(input: string, lookup: LookupLike = systemLookup): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError('not a URL', 'bad_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError(`scheme ${url.protocol} not allowed`, 'bad_scheme');
  if (url.username || url.password) throw new UnsafeUrlError('credentials in URL', 'userinfo');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new UnsafeUrlError('empty host', 'bad_host');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError(`address ${host} is not public`, 'private_address');
    return { url, addresses: [host] };
  }
  if (isBlockedHostname(host)) throw new UnsafeUrlError(`host ${host} is blocked`, 'blocked_host');
  let resolved: ResolvedAddress[];
  try {
    resolved = await lookup(host);
  } catch {
    throw new UnsafeUrlError(`host ${host} does not resolve`, 'dns');
  }
  if (!resolved.length) throw new UnsafeUrlError(`host ${host} does not resolve`, 'dns');
  for (const r of resolved) {
    if (isPrivateAddress(r.address)) throw new UnsafeUrlError(`host ${host} resolves to non-public ${r.address}`, 'private_address');
  }
  return { url, addresses: resolved.map((r) => r.address) };
}

/** One pinned HTTP GET: connect to `address` (already validated), speak HTTP to `url`'s host. */
export interface PinnedRequest {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}
export interface PinnedResponse {
  status: number;
  headers: Headers;
  /** `null` when the body exceeded `maxBytes` (the transport stops reading). Empty for redirects. */
  body: Uint8Array | null;
}
export type PinnedTransport = (req: PinnedRequest) => Promise<PinnedResponse>;

/**
 * Production transport: node:http(s) with a `lookup` that answers only the pinned address (so no
 * second DNS query happens), `agent: false` (no pooled socket to some earlier address), the
 * hostname as TLS servername (SNI + certificate verification against the name, not the IP).
 */
export const nodeTransport: PinnedTransport = (req) =>
  new Promise<PinnedResponse>((resolve, reject) => {
    const isHttps = req.url.protocol === 'https:';
    const host = req.url.hostname.replace(/^\[|\]$/g, '');
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if ((options as { all?: boolean }).all) (callback as unknown as (err: null, addrs: Array<{ address: string; family: number }>) => void)(null, [{ address: req.address, family: req.family }]);
      else callback(null, req.address, req.family);
    };
    const options: https.RequestOptions = {
      protocol: req.url.protocol,
      hostname: host,
      port: req.url.port ? Number(req.url.port) : isHttps ? 443 : 80,
      path: `${req.url.pathname}${req.url.search}`,
      method: 'GET',
      headers: { ...req.headers, host: req.url.host },
      lookup: pinned,
      agent: false,
      ...(isHttps && !isIP(host) ? { servername: host } : {}),
    };
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const request = (isHttps ? https : http).request(options, (res) => {
      const headers = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.destroy();
        return done(() => resolve({ status, headers, body: new Uint8Array(0) }));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > req.maxBytes) {
          res.destroy();
          done(() => resolve({ status, headers, body: null }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => done(() => resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)) })));
      res.on('error', (err) => done(() => reject(err)));
    });
    const timer = setTimeout(() => request.destroy(new Error('timeout')), req.timeoutMs);
    request.on('error', (err) => done(() => reject(err)));
    request.end();
  });

/**
 * Adapter over a fetch-like, for TESTS ONLY (the harness injects a FetchMock). It cannot pin: a
 * real `fetch` would resolve the name again. `app.ts` uses it only when a test passes `fetch`.
 */
export function fetchTransport(fetchImpl: typeof fetch): PinnedTransport {
  return async (req) => {
    const res = await fetchImpl(req.url.href, { redirect: 'manual', signal: AbortSignal.timeout(req.timeoutMs), headers: req.headers });
    if (res.status >= 300 && res.status < 400) return { status: res.status, headers: res.headers, body: new Uint8Array(0) };
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > req.maxBytes) return { status: res.status, headers: res.headers, body: null };
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body: buf.length <= req.maxBytes ? buf : null };
  };
}

export interface SafeFetchOptions {
  lookup?: LookupLike;
  /** Defaults to `nodeTransport` (pinned). */
  transport?: PinnedTransport;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** `accept` request header; default: any type. */
  accept?: string;
  /** Accept only these content-type prefixes (e.g. `image/`); omitted → any. A missing content type fails when set. */
  contentTypes?: readonly string[];
}

export interface SafeFetchResult {
  /** The final URL after redirects. */
  url: string;
  status: number;
  /** Lower-cased media type without parameters (`image/png`), or '' when absent. */
  contentType: string;
  headers: Headers;
  body: Uint8Array;
}

/**
 * GET a merchant-supplied URL with the guard applied to the URL and to every redirect hop, DNS
 * pinned per hop. Returns `null` when the resource is unavailable (network error, non-2xx, wrong
 * content type, over the size cap, empty); throws `UnsafeUrlError` when it is forbidden.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult | null> {
  const lookup = opts.lookup ?? systemLookup;
  const transport = opts.transport ?? nodeTransport;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url, addresses } = await assertPublicUrl(current, lookup);
    const address = addresses[0]!;
    let res: PinnedResponse;
    try {
      res = await transport({ url, address, family: isIP(address) === 6 ? 6 : 4, headers: { accept: opts.accept ?? '*/*', 'user-agent': 'CurtainFetch/1 (+https://curtain.fit)' }, timeoutMs: opts.timeoutMs ?? 10_000, maxBytes });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return null;
      }
      current = next.href;
      continue;
    }
    if (res.status < 200 || res.status >= 300) return null;
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (opts.contentTypes && !opts.contentTypes.some((p) => contentType.startsWith(p))) return null;
    if (!res.body || res.body.length === 0 || res.body.length > maxBytes) return null;
    return { url: url.href, status: res.status, contentType, headers: res.headers, body: res.body };
  }
  throw new UnsafeUrlError('too many redirects', 'redirects');
}

export interface FetchPublicOptions {
  lookup?: LookupLike;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Accept only these content-type prefixes (e.g. `image/`); omitted → any. */
  contentTypePrefix?: string;
}

/** Bytes of a merchant-supplied URL through `safeFetch` (kept for the render job's call shape). */
export async function fetchPublicBytes(transport: PinnedTransport, input: string, opts: FetchPublicOptions = {}): Promise<Uint8Array | null> {
  const res = await safeFetch(input, {
    transport,
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.maxRedirects !== undefined ? { maxRedirects: opts.maxRedirects } : {}),
    ...(opts.contentTypePrefix ? { contentTypes: [opts.contentTypePrefix], accept: `${opts.contentTypePrefix}*` } : {}),
  });
  return res?.body ?? null;
}
