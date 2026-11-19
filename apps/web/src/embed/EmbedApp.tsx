/**
 * The standalone fitting room inside the merchant page's overlay (`/embed/:token`,
 * docs/STANDALONE.md §1–2). Its own minimal shell: no phone frame, no bottom nav, no onboarding,
 * no app store, no app database.
 *
 * Privacy (D3): the body profile and the fit live in this iframe only. The network sees
 * `POST /v1/devices` (anonymous device), `GET /v1/try/:token`, ONE `POST …/fit-shown`
 * `{ intentToken, recommendedSize, confidence }`, `DELETE /v1/me` on "Forget me", and the opt-in
 * hero render of the avatar drawing. Never a measurement, a photo or a frame.
 *
 * The avatar (D19, docs/research/photo-avatar-plan.md slices 1 and 2): tapping the 2D figure opens
 * the avatar prompt. The shopper may pick a skin colour there; it colours the 2D figure and goes to
 * the 3D view as an in-memory value. By default it lives in memory only and is gone when the window
 * closes; saving it under "Remember me" is behind a build flag until the founder and counsel have
 * decided (storage.ts). It is never in a request, a postMessage or the fit. The prompt makes no
 * request at all. The opt-in hero render is drawn from a separate figure: the standard colour, no
 * face, as it was before the avatar prompt existed.
 *
 * Men's gate (D20 point 3, docs/research/men-3d-plan.md slice M0): a men's product is shown with
 * the working 3D view or not at all. The server answers `men_coming_soon` for a product that is not
 * ready; a ready one arrives with `requires3d`. Then nothing of the result (no 2D figure, no size)
 * is visible until the 3D view has settled, fit-shown waits for it, and a device without WebGL2 or
 * a failing bundle ends on "Men's clothing: coming soon".
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { BodyProfile, TryResolveResponse } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { ApiError } from '@/api/client';
import { adviseSize, EMPTY_ABOUT, fitForProfile, mergeAboutIntoScan, normalizeAbout, priorKeys, profileFromAbout, sizeConfidence, switchUnits, validateAbout, type AboutField, type AboutForm } from './aboutYou';
import { embedStrings } from './strings';
import { AvatarPrompt } from './AvatarPrompt';
import { isMockToken, mockTokensEnabled, resolveMock, type EmbedApi, type EmbedDeps } from './deps';
import { AboutScreen, BlockedScreen, EmbedFooter, EmbedFrame, LoadingScreen, ProductHeader } from './EmbedScreens';
import { classifyError, flowReducer, INITIAL_FLOW } from './flow';
import { bodyFamilyFor, Garment3D, hasWebGL2 } from './Garment3D';
import { HeroRenderPanel, heroRendersEnabled } from './HeroRender';
import { facePhotoEnabled, type SkinLook } from './look';
import { createParentChannel, parseParentMessage, resolveTargetOrigin, type ParentContext } from './protocol';
import { ringInputsFor } from '@/render/ringInputs';
import { ResultScreen } from './ResultScreen';
import { defaultUnits, type Units } from './units';

const CaptureStep = lazy(() => import('@/features/capture/components/CaptureStep'));

const NO_CONTEXT: ParentContext = { locale: null, currentVariantSize: null };

/**
 * The browser's own locale. It decides the default units (cm or in) only; D21: it never changes
 * the language of the interface, which the shop's integration names (`strings/index.ts`).
 */
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
  /** `requires3d` products only: the 3D view has settled (until then the result stays hidden and unbilled). */
  const [view3dReady, setView3dReady] = useState(false);
  /** Units the shopper picked (here or on an earlier visit to this shop); null follows the locale. */
  const [chosenUnits, setChosenUnits] = useState<Units | null>(null);
  /** The skin colour the shopper picked for the avatar (null: the standard colour). Never sent. */
  const [look, setLook] = useState<SkinLook | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  /** The prompt is on screen now (see `showPrompt`): the window's Escape handler stands down. */
  const promptShownRef = useRef(false);
  const shopperLocale = deps.locale === undefined ? browserLocale() : deps.locale;
  const units: Units = chosenUnits ?? defaultUnits(shopperLocale, context.locale);
  // The inputs follow the effective units (a stored choice, else the locale, which can arrive late
  // from the shop page). Switching never changes the metric values the fit engine reads.
  const about = useMemo(() => switchUnits(aboutState, units), [aboutState, units]);
  const apiRef = useRef<EmbedApi | null>(null);
  const fitShownFor = useRef<Set<string>>(new Set());
  const readySent = useRef(false);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  /** The figure the hero render is drawn from: standard colour, no face, no rings. */
  const heroAvatarRef = useRef<HTMLDivElement | null>(null);
  // SEC-5: `mock:` tokens are a development/demo aid only; a production build shows "expired".
  const mockToken = isMockToken(token);
  const mock = mockToken && (deps.allowMock ?? mockTokensEnabled());
  const getAvatarSvg = useCallback((): SVGSVGElement | null => heroAvatarRef.current?.querySelector('svg') ?? null, []);

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
        const resolved = mock ? resolveMock(token, deps.referrer) : await api().resolveTry(token, { enforces3dRule: true });
        if (cancelled) return;
        // Men's gate: a product that needs the 3D view is not opened on a device that cannot show it.
        if (resolved.requires3d && !resolved.shop.paused && (!resolved.asset || !(deps.webgl2 ?? hasWebGL2)())) {
          dispatch({ type: 'failed', kind: 'comingSoon' });
          return;
        }
        const remembered = await store.loadProfile(resolved.shop.id);
        const storedUnits = await store.loadUnits();
        const storedLook = await store.loadLook(resolved.shop.id);
        if (cancelled) return;
        setLook(storedLook);
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
  }, [token, attempt, mock, mockToken, deps.referrer, deps.webgl2, store, api]);

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
      // With the avatar prompt open, Escape closes the prompt, not the overlay.
      if (e.key === 'Escape' && !promptShownRef.current) channel.post({ type: 'curtain:close' });
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
    // Men's gate: nothing is "shown" (and nothing billed) before the required 3D view has settled.
    if (data.requires3d && !view3dReady) return;
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
  }, [flow.step, data, embedFit, advice, mock, token, api, view3dReady]);

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
    const errs = validateAbout(about, data.garment.category, data.garment);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setProfile(profileFromAbout(about, data.garment.category, Date.now(), data.garment));
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
    setView3dReady(false);
    setLook(null);
    closePrompt(false);
    dispatch({ type: 'forgotten' });
    setForgetStatus(serverOk ? embedStrings().footer.forgotten : embedStrings().footer.forgottenLocalOnly);
  };

  // --- the avatar prompt (D19) ------------------------------------------------------------------
  const openPrompt = (): void => setPromptOpen(true);
  const closePrompt = (refocus = true): void => {
    if (!promptOpen) return;
    setPromptOpen(false);
    // Focus goes back to the control that opened the prompt (it is inert until the next paint).
    if (refocus) setTimeout(() => mainRef.current?.querySelector<HTMLElement>('[data-testid="avatar-open"]')?.focus({ preventScroll: true }), 0);
  };
  const pickLook = (next: SkinLook): void => {
    setLook(next);
    if (data) void store.saveLook(data.shop.id, next);
  };
  const clearLook = (): void => {
    setLook(null);
    if (data) void store.clearLook(data.shop.id);
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
        garment={data.garment}
        editing={flow.editing}
        canScan={deps.canScan}
        onChange={(f) => {
          setAbout(f);
          if (Object.keys(errors).length > 0) setErrors(validateAbout(f, data.garment.category, data.garment));
        }}
        onUnits={(u) => {
          changeUnits(u);
          // Messages name the units ("Between 4 ft 0 in and 7 ft 6 in"): re-check in the new ones.
          if (Object.keys(errors).length > 0) setErrors(validateAbout(switchUnits(about, u), data.garment.category, data.garment));
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
              setProfile(mergeAboutIntoScan(p, about, data.garment.category, Date.now(), data.garment));
              dispatch({ type: 'scanDone' });
            }}
            onSkip={() => dispatch({ type: 'scanSkipped' })}
          />
        </div>
      </Suspense>
    );
  else if (flow.step === 'result' && profile && embedFit && advice && shownSize) {
    const requires3d = data.requires3d === true;
    const result = (
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
        onEdit={() => {
          // A required 3D view is mounted again when the shopper comes back to the result.
          setView3dReady(false);
          dispatch({ type: 'edit' });
        }}
        returning={flow.returning}
        chosen={chosen}
        chooseFallback={chooseFallback}
        currentVariantSize={context.currentVariantSize}
        avatarRef={avatarRef}
        units={units}
        onUnits={changeUnits}
        skinHex={look?.hex ?? null}
        onAvatar={openPrompt}
        avatarLabel={embedStrings().avatar.ui.open}
        // Slice M1b: the male 2D figure only beside the required 3D view on the male body, which
        // keeps the result hidden until it has settled and ends in "coming soon" when it fails.
        figure={requires3d && bodyFamilyFor(data.garment) === 'male' ? 'male' : 'female'}
        extra={
          <>
            {heroRendersEnabled(data) && !mock && !requires3d ? (
              <>
                {/* The hero render's person image: a separate figure in the standard colour, so the
                    picked skin colour is never in that request (see HeroRender.tsx). It is the figure
                    as it was on screen before the avatar prompt: no face, the same hem width. */}
                <div ref={heroAvatarRef} className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden inert data-testid="hero-avatar">
                  <AvatarView bare plain garment={data.garment} fit={embedFit.fit} size={shownSize} measurements={embedFit.userBody.measurements} heightCm={profile.measurements.height?.mean} hemSweepCm={ringInputsFor(data.garment)?.hem?.sweepCm[shownSize] ?? null} />
                </div>
                <HeroRenderPanel getApi={api} data={data} size={shownSize} getAvatarSvg={getAvatarSvg} />
              </>
            ) : null}
            <Garment3D
              asset={data.asset}
              paused={data.shop.paused}
              garment={data.garment}
              fit={embedFit.fit}
              size={shownSize}
              recommended={advice.size}
              measurements={embedFit.userBody.measurements}
              units={units}
              heightCm={profile.measurements.height?.mean}
              estimated={priorKeys(profile)}
              skinHex={look?.hex ?? null}
              required={requires3d}
              onRequiredState={(state) => (state === 'settled' ? setView3dReady(true) : dispatch({ type: 'comingSoon' }))}
              {...(deps.webgl2 ? { webgl2: deps.webgl2 } : {})}
              {...(deps.loadViewer ? { loadViewer: deps.loadViewer } : {})}
              aiRealism={
                data.aiRealism && !mock
                  ? {
                      garmentName: data.garment.name,
                      ids: { productId: data.garment.id, shopId: data.shop.id },
                      request: (req) => {
                        const client = api();
                        if (!client.requestRealism) throw new Error('realism unavailable');
                        return client.requestRealism(req);
                      },
                    }
                  : null
              }
              onSelect={(s) => {
                setSelected(s);
                setChosen(null);
                setChooseFallback(null);
              }}
            />
          </>
        }
      />
    );
    // Men's gate: the 2D figure and the size stay out of sight (and out of the accessibility tree)
    // until the required 3D view has settled. It is mounted meanwhile so the canvas has a size.
    // The wrapper stays the same before and after, so the view is mounted once.
    body = requires3d ? (
      <div className="relative flex flex-1 flex-col" data-testid={view3dReady ? 'requires3d-shown' : 'requires3d-pending'}>
        <div className={view3dReady ? undefined : 'invisible'} aria-hidden={!view3dReady} inert={!view3dReady}>
          {result}
        </div>
        {view3dReady ? null : (
          <div className="absolute inset-0 flex flex-col bg-cream">
            <LoadingScreen />
          </div>
        )}
      </div>
    ) : (
      result
    );
  } else body = <LoadingScreen />;

  const showPrompt = promptOpen && flow.step === 'result' && !!data;
  // Derived from what is drawn, not from "was opened": if the flow ever leaves the result while
  // the prompt is open, Escape closes the overlay again instead of going dead.
  useEffect(() => {
    promptShownRef.current = showPrompt;
  }, [showPrompt]);
  // And "open" does not outlive the screen it was opened on (it would reopen on the way back).
  if (promptOpen && !showPrompt) setPromptOpen(false);
  return (
    <EmbedFrame>
      {/* Behind the open prompt the page is inert: no focus, no clicks, not read out. */}
      <div className="contents" inert={showPrompt}>
        <ProductHeader shop={data?.shop ?? null} garment={flow.blocked === 'comingSoon' ? null : (data?.garment ?? null)} />
        <main ref={mainRef} className="flex flex-1 flex-col px-4 py-4" aria-live="off">
          {body}
        </main>
        <EmbedFooter remember={remember} onRemember={(on) => void onRemember(on)} onForget={() => void forget()} forgetStatus={forgetStatus} appUrl={deps.appUrl} />
      </div>
      {showPrompt ? (
        <AvatarPrompt
          look={look}
          onPick={pickLook}
          onClear={clearLook}
          onMeasurements={() => {
            closePrompt(false);
            setView3dReady(false);
            dispatch({ type: 'edit' });
          }}
          onClose={() => closePrompt()}
          termsUrl={`${deps.appUrl.replace(/\/+$/, '')}/privacy`}
          face={deps.facePhoto ?? facePhotoEnabled()}
          saved={store.persistsLooks}
        />
      ) : null}
    </EmbedFrame>
  );
}
