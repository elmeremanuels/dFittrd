/**
 * The standalone fitting room inside the merchant page's overlay (`/embed/:token`,
 * docs/STANDALONE.md §1–2). Its own minimal shell: no phone frame, no bottom nav, no onboarding,
 * no app store, no app database.
 *
 * Privacy (D3): the body profile and the fit live in this iframe only. The network sees
 * `POST /v1/devices` (anonymous device), `GET /v1/try/:token`, ONE `POST …/fit-shown`
 * `{ intentToken, recommendedSize, confidence }`, `DELETE /v1/me` on "Forget me", and the opt-in
 * hero render of the avatar drawing. Never a measurement, a photo or a frame.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { BodyProfile, TryResolveResponse } from '@curtain/schema';
import { ApiError } from '@/api/client';
import { adviseSize, EMPTY_ABOUT, fitForProfile, mergeAboutIntoScan, normalizeAbout, profileFromAbout, sizeConfidence, switchUnits, validateAbout, type AboutField, type AboutForm } from './aboutYou';
import { isMockToken, mockTokensEnabled, resolveMock, type EmbedApi, type EmbedDeps } from './deps';
import { AboutScreen, BlockedScreen, EmbedFooter, EmbedFrame, LoadingScreen, ProductHeader } from './EmbedScreens';
import { classifyError, flowReducer, INITIAL_FLOW } from './flow';
import { HeroRenderPanel, heroRendersEnabled } from './HeroRender';
import { createParentChannel, parseParentMessage, resolveTargetOrigin, type ParentContext } from './protocol';
import { ResultScreen } from './ResultScreen';
import { defaultUnits, type Units } from './units';

const CaptureStep = lazy(() => import('@/features/capture/components/CaptureStep'));

const NO_CONTEXT: ParentContext = { locale: null, currentVariantSize: null };

/** The browser's own language: the shopper's choice, so it decides the default units first. */
function browserLocale(): string | null {
  return typeof navigator !== 'undefined' ? (navigator.language ?? null) : null;
}

export function EmbedApp({ token, deps }: { token: string; deps: EmbedDeps }): ReactNode {
  const { store } = deps;
  const [flow, dispatch] = useReducer(flowReducer, INITIAL_FLOW);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<TryResolveResponse | null>(null);
  const [aboutState, setAbout] = useState<AboutForm>(EMPTY_ABOUT);
  const [errors, setErrors] = useState<Partial<Record<AboutField, string>>>({});
  const [profile, setProfile] = useState<BodyProfile | null>(null);
  const [remember, setRememberState] = useState(store.remember);
  const [selected, setSelected] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [chooseFallback, setChooseFallback] = useState<string | null>(null);
  const [forgetStatus, setForgetStatus] = useState<string | null>(null);
  const [context, setContext] = useState<ParentContext>(NO_CONTEXT);
  /** Units the shopper picked (here or on an earlier visit to this shop); null follows the locale. */
  const [chosenUnits, setChosenUnits] = useState<Units | null>(null);
  const shopperLocale = deps.locale === undefined ? browserLocale() : deps.locale;
  const units: Units = chosenUnits ?? defaultUnits(shopperLocale, context.locale);
  // The inputs follow the effective units (a stored choice, else the locale, which can arrive late
  // from the shop page). Switching never changes the metric values the fit engine reads.
  const about = useMemo(() => switchUnits(aboutState, units), [aboutState, units]);
  const apiRef = useRef<EmbedApi | null>(null);
  const fitShownFor = useRef<Set<string>>(new Set());
  const readySent = useRef(false);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  // SEC-5: `mock:` tokens are a development/demo aid only; a production build shows "expired".
  const mockToken = isMockToken(token);
  const mock = mockToken && (deps.allowMock ?? mockTokensEnabled());
  const getAvatarSvg = useCallback((): SVGSVGElement | null => avatarRef.current?.querySelector('svg') ?? null, []);

  const api = useCallback((): EmbedApi => {
    if (!apiRef.current) apiRef.current = deps.makeApi(store);
    return apiRef.current;
  }, [deps, store]);

  // --- resolve the try token (and the remembered profile) -------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await store.init();
        // The stored "Remember me" opt-out is only known after init (UX-1 / F2).
        if (!cancelled) setRememberState(store.remember);
        if (mockToken && !mock) throw new ApiError(410, 'gone', 'try link expired');
        const resolved = mock ? resolveMock(token, deps.referrer) : await api().resolveTry(token);
        if (cancelled) return;
        const remembered = await store.loadProfile(resolved.shop.id);
        const storedUnits = await store.loadUnits();
        if (cancelled) return;
        setData(resolved);
        if (storedUnits) setChosenUnits(storedUnits);
        if (remembered) {
          setAbout(normalizeAbout(remembered.about));
          setProfile(remembered.profile);
        }
        dispatch({ type: 'resolved', paused: resolved.shop.paused, remembered: !!remembered });
      } catch (e) {
        if (!cancelled) dispatch({ type: 'failed', kind: classifyError(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, attempt, mock, mockToken, deps.referrer, store, api]);

  // --- parent channel ---------------------------------------------------------------------------
  const targetOrigin = useMemo(
    () => (data ? resolveTargetOrigin({ allowedOrigins: data.embed.allowedOrigins, referrer: deps.referrer, ancestorOrigins: deps.ancestorOrigins, framed: !!deps.parent }) : null),
    [data, deps.referrer, deps.ancestorOrigins, deps.parent],
  );
  const channel = useMemo(() => createParentChannel(deps.parent, targetOrigin), [deps.parent, targetOrigin]);

  // curtain:ready after the first paint of real content.
  useEffect(() => {
    if (flow.step === 'loading' || readySent.current || !channel.canPost) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
    const id = raf(() => {
      if (readySent.current) return;
      readySent.current = true;
      channel.post({ type: 'curtain:ready' });
    });
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    };
  }, [flow.step, channel]);

  // curtain:context from the parent (exact origin + window only).
  useEffect(() => {
    if (!targetOrigin || !deps.parent) return;
    const onMessage = (event: MessageEvent): void => {
      const ctx = parseParentMessage(event, { targetOrigin, parent: deps.parent });
      if (ctx) setContext(ctx);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [targetOrigin, deps.parent]);

  // Escape inside the iframe never reaches the parent page: ask the overlay to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') channel.post({ type: 'curtain:close' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channel]);

  // --- the fit (on device) ----------------------------------------------------------------------
  const embedFit = useMemo(() => (data && profile ? fitForProfile(data.garment, profile) : null), [data, profile]);
  const advice = useMemo(() => (embedFit ? adviseSize(embedFit.fit, about.preference) : null), [embedFit, about.preference]);
  const defaultSize = advice?.size ?? advice?.closest ?? data?.garment.sizeChart[0]?.size ?? null;
  const shownSize = selected && embedFit?.fit.perSize.some((s) => s.size === selected) ? selected : defaultSize;

  // fit-shown: once per intent token, when the first real recommendation is on screen. Never for
  // "no size fits well" (UX-2) or "we can't recommend a size yet" (F1): no size was recommended.
  useEffect(() => {
    if (flow.step !== 'result' || !data || !embedFit || !advice || mock || !advice.size) return;
    const intent = data.trySession.intentToken;
    if (fitShownFor.current.has(intent)) return;
    fitShownFor.current.add(intent);
    const recommendedSize = advice.size.slice(0, 16);
    // F3: the confidence of the size we recommend (after the preference), not the engine pick's.
    const confidence = advice.adjusted ? sizeConfidence(embedFit.fit, advice.size) : embedFit.fit.confidence;
    api()
      .fitShown(token, { intentToken: intent, recommendedSize, confidence: Math.max(0, Math.min(1, confidence)) })
      .catch((e: unknown) => {
        if (e instanceof ApiError && (e.status === 402 || e.code === 'shop_paused')) dispatch({ type: 'paused' });
        // Anything else: the shopper still has their size; analytics simply miss this one.
      });
  }, [flow.step, data, embedFit, advice, mock, token, api]);

  // Remember the profile on this shop (only with "Remember me" on; the store enforces that too).
  useEffect(() => {
    if (flow.step !== 'result' || !data || !profile || !remember) return;
    void store.saveProfile({ shopId: data.shop.id, profile, about, savedAt: Date.now() });
  }, [flow.step, data, profile, about, remember, store]);

  // A11Y-1: on every step change, start at the top and move focus to the new screen's heading so
  // keyboard and screen-reader users land on (and hear) the new content. Not on the first screen
  // after loading: focus must not jump into the iframe before the shopper interacts with it.
  const mainRef = useRef<HTMLElement | null>(null);
  const stepKey = `${flow.step}:${flow.blocked ?? ''}:${flow.editing ? 'edit' : ''}`;
  const prevStepKey = useRef(stepKey);
  useEffect(() => {
    const prev = prevStepKey.current;
    prevStepKey.current = stepKey;
    if (prev === stepKey || prev.startsWith('loading:')) return;
    try {
      window.scrollTo(0, 0);
    } catch {
      // jsdom and old browsers
    }
    const focusHeading = (): boolean => {
      const heading = mainRef.current?.querySelector<HTMLElement>('[data-step-heading], h1, h2');
      if (!heading) return false;
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      return true;
    };
    // The scan step loads lazily: retry on the next frames until its heading exists.
    if (focusHeading()) return;
    let tries = 0;
    const id = setInterval(() => {
      if (focusHeading() || ++tries > 20) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [stepKey]);

  // --- actions ----------------------------------------------------------------------------------
  const submitAbout = (scan: boolean): void => {
    if (!data) return;
    const errs = validateAbout(about, data.garment.category);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setProfile(profileFromAbout(about, data.garment.category));
    setSelected(null);
    setChosen(null);
    setChooseFallback(null);
    dispatch({ type: 'submitAbout', scan });
  };

  const choose = (): void => {
    if (!data || !shownSize) return;
    const sent = channel.post({ type: 'curtain:size-selected', productExternalId: data.garment.id, size: shownSize });
    setChosen(sent ? shownSize : null);
    setChooseFallback(sent ? null : shownSize);
  };

  const onRemember = async (on: boolean): Promise<void> => {
    setRememberState(on);
    await store.setRemember(on);
    if (on && data && profile) await store.saveProfile({ shopId: data.shop.id, profile, about, savedAt: Date.now() });
    setForgetStatus(null);
  };

  const forget = async (): Promise<void> => {
    let serverOk = true;
    if (!mock && store.getDevice().token) {
      try {
        await api().deleteMe();
      } catch {
        serverOk = false;
      }
    }
    await store.forget();
    apiRef.current = null;
    setProfile(null);
    setAbout(EMPTY_ABOUT);
    setErrors({});
    setSelected(null);
    setChosen(null);
    setChooseFallback(null);
    dispatch({ type: 'forgotten' });
    setForgetStatus(serverOk ? 'Forgotten. Nothing about you is stored here any more.' : 'Deleted from this browser. We could not reach Curtain to delete the anonymous device; try again later.');
  };

  const changeUnits = (u: Units): void => {
    setChosenUnits(u);
    setAbout(switchUnits(about, u));
    void store.saveUnits(u);
  };

  const close = channel.canPost ? () => channel.post({ type: 'curtain:close' }) : null;

  // --- render -----------------------------------------------------------------------------------
  let body: ReactNode;
  if (flow.step === 'loading') body = <LoadingScreen />;
  else if (flow.step === 'blocked' && flow.blocked)
    body = (
      <BlockedScreen
        kind={flow.blocked}
        onRetry={
          flow.blocked === 'offline' || flow.blocked === 'busy' || flow.blocked === 'error'
            ? () => {
                dispatch({ type: 'retry' });
                setAttempt((a) => a + 1);
              }
            : null
        }
        onClose={close}
      />
    );
  else if (!data) body = <LoadingScreen />;
  else if (flow.step === 'about')
    body = (
      <AboutScreen
        form={about}
        errors={errors}
        category={data.garment.category}
        editing={flow.editing}
        canScan={deps.canScan}
        onChange={(f) => {
          setAbout(f);
          if (Object.keys(errors).length > 0) setErrors(validateAbout(f, data.garment.category));
        }}
        onUnits={(u) => {
          changeUnits(u);
          // Messages name the units ("Between 4 ft 0 in and 7 ft 6 in"): re-check in the new ones.
          if (Object.keys(errors).length > 0) setErrors(validateAbout(switchUnits(about, u), data.garment.category));
        }}
        onSubmit={submitAbout}
      />
    );
  else if (flow.step === 'scan')
    body = (
      <Suspense fallback={<LoadingScreen />}>
        <div className="-mx-4">
          <CaptureStep
            persist={false}
            variant="embed"
            initialForm={{ height: about.height, weight: about.weight, bust: about.bust, waist: about.waist, hip: about.hip, footEu: about.footEu, sex: about.sex, method: about.tape ? 'tape' : 'memory' }}
            onComplete={(p) => {
              // F5: keep what the scan's form does not ask for (inseam for bottoms).
              setProfile(mergeAboutIntoScan(p, about, data.garment.category));
              dispatch({ type: 'scanDone' });
            }}
            onSkip={() => dispatch({ type: 'scanSkipped' })}
          />
        </div>
      </Suspense>
    );
  else if (flow.step === 'result' && profile && embedFit && advice && shownSize)
    body = (
      <ResultScreen
        garment={data.garment}
        profile={profile}
        embedFit={embedFit}
        advice={advice}
        preference={about.preference}
        selected={shownSize}
        onSelect={(s) => {
          setSelected(s);
          setChosen(null);
          setChooseFallback(null);
        }}
        onChoose={choose}
        onEdit={() => dispatch({ type: 'edit' })}
        returning={flow.returning}
        chosen={chosen}
        chooseFallback={chooseFallback}
        currentVariantSize={context.currentVariantSize}
        avatarRef={avatarRef}
        units={units}
        onUnits={changeUnits}
        extra={heroRendersEnabled(data) && !mock ? <HeroRenderPanel getApi={api} data={data} size={shownSize} getAvatarSvg={getAvatarSvg} /> : null}
      />
    );
  else body = <LoadingScreen />;

  return (
    <EmbedFrame>
      <ProductHeader shop={data?.shop ?? null} garment={data?.garment ?? null} />
      <main ref={mainRef} className="flex flex-1 flex-col px-4 py-4" aria-live="off">
        {body}
      </main>
      <EmbedFooter remember={remember} onRemember={(on) => void onRemember(on)} onForget={() => void forget()} forgetStatus={forgetStatus} appUrl={deps.appUrl} />
    </EmbedFrame>
  );
}
