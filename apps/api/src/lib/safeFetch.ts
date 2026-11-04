/**
 * SSRF guard for server-side fetches of merchant-supplied URLs (flat-lay photos). The render job
 * runs inside the VPS network, next to Postgres and (on cloud hosts) a metadata server, so a
 * merchant must not be able to point `flatLayPhoto` at `http://169.254.169.254/…`,
 * `http://postgres:5432`, `http://localhost:3000/v1/…` or a public name that resolves privately.
 *
 * Rules: http(s) only, no credentials in the URL, no blocked hostnames, every A/AAAA record must
 * be a public unicast address, redirects are followed manually (≤ 3) and re-checked, the body is
 * capped. The DNS lookup is injectable (tests stub it; production uses `dns.promises.lookup`).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
  // v4-mapped / v4-compatible / NAT64 well-known prefix → judge the embedded IPv4.
  const mapped = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateV4(mapped[1]!);
  if (lower === '::' || lower === '::1') return true;
  const hextets = expandV6(lower);
  if (!hextets) return true;
  const first = hextets[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && hextets[1] === 0x0db8) return true; // documentation
  if (first === 0x0064 && hextets[1] === 0xff9b) return true; // NAT64 (non-literal form)
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

export interface FetchPublicOptions {
  lookup?: LookupLike;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Accept only these content-type prefixes (e.g. `image/`); omitted → any. */
  contentTypePrefix?: string;
}

/**
 * Fetches a merchant-supplied URL with the guard applied to the URL and to every redirect hop.
 * Returns `null` when the resource is unavailable; throws `UnsafeUrlError` when it is forbidden.
 */
export async function fetchPublicBytes(fetchImpl: typeof fetch, input: string, opts: FetchPublicOptions = {}): Promise<Uint8Array | null> {
  const lookup = opts.lookup ?? systemLookup;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url } = await assertPublicUrl(current, lookup);
    let res: Response;
    try {
      res = await fetchImpl(url.href, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), headers: { accept: 'image/*' } });
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
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (opts.contentTypePrefix && type && !type.toLowerCase().startsWith(opts.contentTypePrefix)) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= maxBytes ? buf : null;
  }
  throw new UnsafeUrlError('too many redirects', 'redirects');
}
