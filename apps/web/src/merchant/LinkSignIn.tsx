/**
 * `/merchant/link#t=…` — where a one-time sign-in link from the WooCommerce plugin or the Shopify
 * admin lands (inventory S2). The token is in the URL fragment, which the browser sends to no
 * server. This page takes it out of the address bar and the history entry before anything else,
 * posts it once to the api, and keeps the session it gets in this tab only (sessionStorage), like
 * a pasted key. A used, expired or unknown link gives a plain message and no session.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ConsoleSessionResponse } from '@curtain/schema';
import { ApiError, NetworkError } from '@/api/client';
import { api } from '@/store';
import { writeMerchantKey } from './MerchantConsole';
import { merchantStrings } from './strings';

/**
 * Reads the token from the fragment and removes the fragment from the address bar in the same
 * step (replaceState: the entry with the token is rewritten, so "Back" cannot bring it up again).
 */
export function takeLinkToken(win: Pick<Window, 'location' | 'history'> = window): string | null {
  const hash = win.location.hash;
  if (!hash) return null;
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('t');
  win.history.replaceState(win.history.state, '', win.location.pathname);
  return token && token.length >= 16 && token.length <= 128 ? token : null;
}

/**
 * Why there is no session. `refused`: the link is used, too old or not a link (the api says 401 or
 * 400). `tooOften`: the route's own limit per address (429). `error`: anything else the api
 * answered, a 5xx among them; the link may still be good, but it is out of the address bar.
 */
export type LinkFailure = 'refused' | 'unreachable' | 'tooOften' | 'error';
type Outcome = { ok: true; session: ConsoleSessionResponse } | { ok: false; reason: LinkFailure };

export function linkFailure(e: unknown): LinkFailure {
  if (e instanceof NetworkError) return 'unreachable';
  if (e instanceof ApiError) {
    if (e.status === 429) return 'tooOften';
    if (e.status === 400 || e.status === 401) return 'refused';
  }
  return 'error';
}

/**
 * One exchange per page load, whatever React does with the component (it mounts an effect twice
 * in development): the link works once, so a second request would turn a good sign-in into a refusal.
 */
let attempt: Promise<Outcome> | null = null;
function signInOnce(): Promise<Outcome> {
  attempt ??= (async (): Promise<Outcome> => {
    const token = takeLinkToken();
    if (!token) return { ok: false, reason: 'refused' };
    try {
      return { ok: true, session: await api.consoleSession(token) };
    } catch (e) {
      return { ok: false, reason: linkFailure(e) };
    }
  })();
  return attempt;
}
/** Test helper: a new page load. */
export function resetLinkSignIn(): void {
  attempt = null;
}

export function MerchantLinkSignIn(): ReactNode {
  const navigate = useNavigate();
  const [failed, setFailed] = useState<LinkFailure | null>(null);
  const c = merchantStrings().console;
  const t = c.link;
  const words: Record<LinkFailure, { title: string; text: string }> = {
    refused: { title: t.failedTitle, text: t.failed },
    unreachable: { title: t.unreachableTitle, text: t.unreachable },
    tooOften: { title: t.tooOftenTitle, text: t.tooOften },
    error: { title: t.errorTitle, text: t.error },
  };

  useEffect(() => {
    let cancelled = false;
    void signInOnce().then((r) => {
      if (r.ok) {
        // The new session replaces whatever this tab held: the link says which shop.
        writeMerchantKey(r.session.sessionToken);
        if (!cancelled) navigate('/merchant', { replace: true });
      } else if (!cancelled) setFailed(r.reason);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream px-6 py-10 text-ink">
      <section className="card w-full max-w-sm space-y-4 bg-white/80">
        <header>
          <p className="eyebrow">{c.eyebrow}</p>
          <h1 className="font-display text-3xl">{c.title}</h1>
        </header>
        {failed ? (
          <>
            <div role="alert" data-testid="link-failed" data-reason={failed} className="space-y-2">
              <h2 className="text-base font-semibold">{words[failed].title}</h2>
              <p className="text-sm text-ink-soft">{words[failed].text}</p>
            </div>
            <div className="space-y-1 text-sm text-ink-soft">
              <h2 className="eyebrow">{t.whereTitle}</h2>
              <p>{t.whereWoo}</p>
              <p>{t.whereShopify}</p>
            </div>
            <p className="text-xs">
              <Link to="/merchant/login" className="underline">
                {t.withKey}
              </Link>
            </p>
          </>
        ) : (
          <p role="status" data-testid="link-working" className="text-sm text-ink-soft">
            {t.working}
          </p>
        )}
      </section>
    </main>
  );
}
