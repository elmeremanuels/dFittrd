/**
 * The console's Settings page (D24; merchant-settings inventory row S2): one choice per shop, each
 * with a sensible default. On it today: what happens with incomplete fabric details (D25 points 1
 * and 2; it is not a step of the first-run checklist), the "Fit by Curtain" wordmark (D25 point 7)
 * and the shop's name, colour and logo. Every string is in `strings.ts` (D21).
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { INCOMPLETE_PRODUCT_DATA_POLICIES, type MerchantSettingsUpdateRequest } from '@curtain/schema';
import { useMerchantData } from './MerchantConsole';
import { merchantStrings } from './strings';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** `#abc` as `#aabbcc`: the colour input only takes six digits. */
const sixDigits = (hex: string): string => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);

function isHttpsUrl(v: string): boolean {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function MerchantSettings(): ReactNode {
  const d = useMerchantData();
  const t = merchantStrings().console.settings;
  const s = d.settings;
  const id = useId();
  const [state, setState] = useState<SaveState>('idle');
  const [colour, setColour] = useState(s?.brandColor ?? '');
  const [logo, setLogo] = useState(s?.logoUrl ?? '');
  const [colourError, setColourError] = useState(false);
  const [logoError, setLogoError] = useState(false);

  if (!s) return <p className="card bg-white/80 text-sm text-ink-soft">{t.unavailable}</p>;

  const save = async (patch: MerchantSettingsUpdateRequest): Promise<void> => {
    setState('saving');
    try {
      await d.saveSettings(patch);
      setState('saved');
    } catch {
      setState('failed');
    }
  };
  const busy = state === 'saving';
  const held = d.products.items.filter((p) => p.heldBack).length;
  const platform = s.platform ?? d.setup?.platform ?? 'woocommerce';
  const showMark = s.showFitByCurtain !== false;

  const saveShop = (e: FormEvent): void => {
    e.preventDefault();
    const c = colour.trim();
    const l = logo.trim();
    const badColour = c !== '' && !HEX.test(c);
    const badLogo = l !== '' && !isHttpsUrl(l);
    setColourError(badColour);
    setLogoError(badLogo);
    if (badColour || badLogo) return;
    void save({ brandColor: c === '' ? null : c, logoUrl: l === '' ? null : l });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="merchant-settings">
      <header className="space-y-1">
        <h2 className="font-display text-2xl">{t.title}</h2>
        <p className="text-sm text-ink-soft">{t.intro}</p>
        {d.mode === 'mock' ? <p className="text-xs text-warn">{t.demo}</p> : null}
        <p className="min-h-5 text-sm font-medium" role="status" aria-live="polite" data-testid="settings-status">
          {state === 'saving' ? t.saving : state === 'saved' ? <span className="text-ok">{t.saved}</span> : state === 'failed' ? <span className="text-bad">{t.failed}</span> : null}
        </p>
      </header>

      <section className="card space-y-3 bg-white/80" aria-labelledby={`${id}-incomplete`}>
        <fieldset className="space-y-3" disabled={busy}>
          <legend id={`${id}-incomplete`} className="font-display text-xl">
            {t.incomplete.title}
          </legend>
          <p className="text-sm text-ink-soft">{t.incomplete.intro}</p>
          {INCOMPLETE_PRODUCT_DATA_POLICIES.map((policy) => {
            const on = s.incompleteProductData === policy;
            return (
              <div key={policy} className={`flex gap-3 rounded-2xl border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-coral ${on ? 'border-ink bg-white' : 'border-ink/15'}`}>
                <input id={`${id}-${policy}`} type="radio" name={`${id}-policy`} value={policy} checked={on} onChange={() => void save({ incompleteProductData: policy })} aria-describedby={`${id}-${policy}-text`} className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-ink" data-testid={`policy-${policy}`} />
                <div className="space-y-1">
                  <label htmlFor={`${id}-${policy}`} className="block cursor-pointer font-medium">
                    {t.incomplete.choices[policy].label}
                    {policy === 'let-through' ? <span className="ml-1 text-xs font-normal text-ink-mute">{t.incomplete.defaultMark}</span> : null}
                  </label>
                  <p id={`${id}-${policy}-text`} className="text-sm text-ink-soft">
                    {t.incomplete.choices[policy].text}
                  </p>
                </div>
              </div>
            );
          })}
          {held > 0 ? (
            <p className="text-sm text-ink-soft" data-testid="held-now">
              {t.incomplete.heldNow(held)}
            </p>
          ) : null}
        </fieldset>
      </section>

      <section className="card space-y-3 bg-white/80" aria-labelledby={`${id}-popup`}>
        <h3 id={`${id}-popup`} className="font-display text-xl">
          {t.popup.title}
        </h3>
        <div className="flex items-start gap-3">
          <input id={`${id}-mark`} type="checkbox" role="switch" aria-checked={showMark} checked={showMark} disabled={busy} onChange={(e) => void save({ showFitByCurtain: e.target.checked })} className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-ink" aria-describedby={`${id}-mark-text`} data-testid="show-fit-by-curtain" />
          <div className="space-y-1">
            <label htmlFor={`${id}-mark`} className="block cursor-pointer font-medium">
              {t.popup.wordmark}
            </label>
            <p id={`${id}-mark-text`} className="text-sm text-ink-soft">
              {t.popup.wordmarkText}
            </p>
          </div>
        </div>
      </section>

      <section className="card bg-white/80" aria-labelledby={`${id}-shop`}>
        <form className="space-y-4" onSubmit={saveShop} noValidate>
          <h3 id={`${id}-shop`} className="font-display text-xl">
            {t.shop.title}
          </h3>
          <div className="space-y-1">
            <p className="eyebrow">{t.shop.name}</p>
            <p className="font-medium" data-testid="shop-name">
              {s.shopName ?? merchantStrings().console.none}
            </p>
            <p className="text-sm text-ink-soft">{t.shop.nameFrom[platform]}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-colour`} className="eyebrow block">
              {t.shop.colour}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input type="color" aria-label={t.shop.colourPick} value={HEX.test(colour.trim()) ? sixDigits(colour.trim()) : '#000000'} onChange={(e) => setColour(e.target.value.toUpperCase())} className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-ink/15 bg-white p-1" />
              <input id={`${id}-colour`} type="text" inputMode="text" autoComplete="off" spellCheck={false} value={colour} onChange={(e) => setColour(e.target.value)} aria-invalid={colourError} aria-describedby={`${id}-colour-text`} className="field-input w-36 font-sans text-base" data-testid="brand-colour" />
              {colour !== '' ? (
                <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={() => setColour('')}>
                  {t.shop.remove}
                </button>
              ) : null}
            </div>
            <p id={`${id}-colour-text`} className={`text-sm ${colourError ? 'text-bad' : 'text-ink-soft'}`} role={colourError ? 'alert' : undefined}>
              {colourError ? t.shop.colourBad : colour.trim() === '' ? t.shop.colourNone : t.shop.colourText}
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-logo`} className="eyebrow block">
              {t.shop.logo}
            </label>
            <input id={`${id}-logo`} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder={t.shop.logoPlaceholder} value={logo} onChange={(e) => setLogo(e.target.value)} aria-invalid={logoError} aria-describedby={`${id}-logo-text`} className="field-input font-sans text-base" data-testid="logo-url" />
            <p id={`${id}-logo-text`} className={`text-sm ${logoError ? 'text-bad' : 'text-ink-soft'}`} role={logoError ? 'alert' : undefined}>
              {logoError ? t.shop.logoBad : t.shop.logoText}
            </p>
          </div>
          <button type="submit" className="btn-primary" disabled={busy} data-testid="save-shop">
            {t.shop.save}
          </button>
        </form>
      </section>
    </div>
  );
}
