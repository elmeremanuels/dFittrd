// @vitest-environment jsdom
/**
 * `/merchant/link#t=…`: the page a one-time sign-in link opens (inventory S2). The token leaves
 * the address bar before the request, is posted once, and a refusal leaves no session behind.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, NetworkError, isConsoleSession } from '@/api/client';
import { api } from '@/store';
import { MerchantLinkSignIn, linkFailure, resetLinkSignIn, takeLinkToken } from './LinkSignIn';
import { readMerchantKey, writeMerchantKey } from './MerchantConsole';
import { merchantStrings } from './strings';

const t = merchantStrings().console;
const TOKEN = 'cl_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const SESSION = 'cs_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0F9e';
const granted = { sessionToken: SESSION, expiresAt: '2026-11-20T22:00:00.000Z', shopName: 'Aalter Studio' };

function open(hash: string, opts: { strict?: boolean } = {}) {
  window.history.replaceState(null, '', `/merchant/link${hash}`);
  const router = createMemoryRouter(
    [
      { path: '/merchant/link', element: <MerchantLinkSignIn /> },
      { path: '/merchant', element: <p data-testid="console">console</p> },
      { path: '/merchant/login', element: <p data-testid="login">login</p> },
    ],
    { initialEntries: ['/merchant/link'] },
  );
  const tree = <RouterProvider router={router} />;
  render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return router;
}

beforeEach(() => {
  resetLinkSignIn();
  writeMerchantKey(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('signing in by link', () => {
  it('exchanges the token once and opens the console with the session in this tab', async () => {
    const exchange = vi.spyOn(api, 'consoleSession').mockResolvedValue(granted);
    const router = open(`#t=${TOKEN}`);
    expect(screen.getByTestId('link-working')).toHaveTextContent(t.link.working);
    await waitFor(() => expect(screen.getByTestId('console')).toBeInTheDocument());
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith(TOKEN);
    expect(readMerchantKey()).toBe(SESSION);
    expect(isConsoleSession(SESSION)).toBe(true);
    // "Back" does not return to the link page.
    expect(router.state.historyAction).toBe('REPLACE');
    // The session is in sessionStorage (this tab), nowhere that outlives it.
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('takes the token out of the address bar before the request is sent', async () => {
    let urlAtRequest = '';
    vi.spyOn(api, 'consoleSession').mockImplementation(async () => {
      urlAtRequest = window.location.href;
      return granted;
    });
    const before = window.history.length;
    open(`#t=${TOKEN}`);
    await waitFor(() => expect(screen.getByTestId('console')).toBeInTheDocument());
    expect(urlAtRequest).toMatch(/\/merchant\/link$/);
    expect(urlAtRequest).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    // The entry was rewritten, not followed by a new one: no history entry holds the token.
    expect(window.history.length).toBe(before);
  });

  it('sends one request even when React mounts the page twice (the link works once)', async () => {
    const exchange = vi.spyOn(api, 'consoleSession').mockResolvedValue(granted);
    open(`#t=${TOKEN}`, { strict: true });
    await waitFor(() => expect(screen.getByTestId('console')).toBeInTheDocument());
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('replaces a session this tab already held: the link says which shop', async () => {
    writeMerchantKey('cs_' + 'old'.repeat(14));
    vi.spyOn(api, 'consoleSession').mockResolvedValue(granted);
    open(`#t=${TOKEN}`);
    await waitFor(() => expect(readMerchantKey()).toBe(SESSION));
  });

  it('posts the token in the body to the api, with no credentials and not in the URL', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(granted), { status: 200, headers: { 'content-type': 'application/json' } }));
    const onLedger = vi.fn();
    const client = new ApiClient({ baseUrl: 'https://api.curtain.test', appVersion: 't', fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1000, now: () => new Date(), getDevice: () => ({}) as never, setDevice: async () => {}, onLedger } as unknown as ConstructorParameters<typeof ApiClient>[0]);
    await expect(client.consoleSession(TOKEN)).resolves.toEqual(granted);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.curtain.test/v1/merchant/console-session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(onLedger).not.toHaveBeenCalled();
  });
});

describe('a link that does not work', () => {
  const refused = () => new ApiError(401, 'invalid_console_link', 'this sign-in link is not valid');

  it('says so in plain words, says where to get a new one, and leaves no session', async () => {
    vi.spyOn(api, 'consoleSession').mockRejectedValue(refused());
    open(`#t=${TOKEN}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.link.failedTitle);
    expect(alert).toHaveTextContent(t.link.failed);
    expect(screen.getByText(t.link.whereWoo)).toBeInTheDocument();
    expect(screen.getByText(t.link.whereShopify)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.link.withKey })).toHaveAttribute('href', '/merchant/login');
    expect(readMerchantKey()).toBeNull();
    expect(screen.queryByTestId('console')).not.toBeInTheDocument();
    // The api's own sentence and the token are not shown.
    expect(document.body.textContent).not.toContain('not valid');
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('keeps the session the tab already had when the link is refused', async () => {
    const mine = 'cs_' + 'mine'.repeat(11);
    writeMerchantKey(mine);
    vi.spyOn(api, 'consoleSession').mockRejectedValue(refused());
    open(`#t=${TOKEN}`);
    await screen.findByRole('alert');
    expect(readMerchantKey()).toBe(mine);
  });

  it.each([
    ['no token at all', ''],
    ['an empty token', '#t='],
    ['another parameter', '#token=abcdefghijklmnopqrstuvwxyz'],
    ['a token that is too short', '#t=short'],
    ['a token that is too long', `#t=${'x'.repeat(200)}`],
  ])('gives the same message for %s, without asking the api', async (_name, hash) => {
    const exchange = vi.spyOn(api, 'consoleSession');
    open(hash);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.link.failedTitle);
    expect(exchange).not.toHaveBeenCalled();
    expect(readMerchantKey()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('says that Curtain could not be reached when the request did not arrive', async () => {
    vi.spyOn(api, 'consoleSession').mockRejectedValue(new NetworkError('offline', new Error('x')));
    open(`#t=${TOKEN}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.link.unreachableTitle);
    expect(alert).toHaveTextContent(t.link.unreachable);
    expect(readMerchantKey()).toBeNull();
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("says so when the route's limit for this address is reached, and does not blame the link", async () => {
    vi.spyOn(api, 'consoleSession').mockRejectedValue(new ApiError(429, 'rate_limited', 'Rate limit exceeded, retry in 1 minute'));
    open(`#t=${TOKEN}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.link.tooOftenTitle);
    expect(alert).toHaveTextContent(t.link.tooOften);
    expect(alert).not.toHaveTextContent(t.link.failedTitle);
    expect(document.body.textContent).not.toContain('Rate limit exceeded');
    expect(readMerchantKey()).toBeNull();
  });

  it.each([500, 502, 503, 403])('says that Curtain failed, not the link, when the api answers %i', async (status) => {
    vi.spyOn(api, 'consoleSession').mockRejectedValue(new ApiError(status, 'internal', 'boom at the server'));
    open(`#t=${TOKEN}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.link.errorTitle);
    expect(alert).toHaveTextContent(t.link.error);
    expect(alert).not.toHaveTextContent(t.link.failedTitle);
    expect(document.body.textContent).not.toContain('boom');
    expect(screen.getByText(t.link.whereWoo)).toBeInTheDocument();
    expect(readMerchantKey()).toBeNull();
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('reads a refusal only from 400 and 401', () => {
    expect(linkFailure(new ApiError(401, 'invalid_console_link', 'x'))).toBe('refused');
    expect(linkFailure(new ApiError(400, 'bad_request', 'x'))).toBe('refused');
    expect(linkFailure(new ApiError(429, 'rate_limited', 'x'))).toBe('tooOften');
    expect(linkFailure(new NetworkError('offline', new Error('x')))).toBe('unreachable');
    expect(linkFailure(new Error('anything else'))).toBe('error');
  });
});

describe('takeLinkToken', () => {
  it('reads the token and rewrites the entry without the fragment or a query', () => {
    window.history.replaceState({ k: 1 }, '', `/merchant/link#t=${TOKEN}`);
    expect(takeLinkToken()).toBe(TOKEN);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/merchant/link');
    expect(window.history.state).toEqual({ k: 1 });
    expect(takeLinkToken()).toBeNull();
  });
});
