/**
 * The avatar prompt (DECISIONS.md D19): tapping the avatar opens this sheet, where the shopper
 * chooses what is used to make the avatar look like them. Plain language, one or two short
 * sentences per item, the legal text behind a link.
 *
 * What is live in this build:
 *   - "Match my skin tone": a switch (off at first) and, once on, the ten swatches of the Monk Skin
 *     Tone scale. The shopper picks; nothing is read from a photo and no tone is guessed.
 *   - "My measurements": typed in, which is the default (D19). The button opens the About-you form.
 * What is not:
 *   - "Use my face" is drawn only when `face` is true (the build flag, default off) and is then a
 *     disabled "coming soon" row. No camera, no file picker and no upload exists behind it.
 *
 * This component makes no request and opens no camera or file input. It is a modal dialog: focus
 * moves into it, Tab stays inside, Escape and the backdrop close it.
 */
import { Check, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { luminance } from '@/render/face';
import { AVATAR_CLAIMS, AVATAR_UI, c30Text, type AvatarLang } from './avatarCopy';
import { lookForMonk, MONK_CLASSES, type SkinLook } from './look';

export interface AvatarPromptProps {
  lang: AvatarLang;
  /** The colour on the avatar now (null: the standard colour). */
  look: SkinLook | null;
  /** The shopper picked a swatch. */
  onPick: (look: SkinLook) => void;
  /** The shopper switched the colour off again. */
  onClear: () => void;
  /** "Type my measurements": close the prompt and open the About-you form. */
  onMeasurements: () => void;
  onClose: () => void;
  /** Where "Read the full privacy terms" goes (opens in a new tab). */
  termsUrl: string;
  /** The photo-based face row (disabled, "coming soon"). Default: not drawn at all. */
  face?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled])';

function Switch({ checked, onChange, labelledBy, describedBy, disabled = false, onText, offText, testId }: { checked: boolean; onChange?: (on: boolean) => void; labelledBy: string; describedBy?: string; disabled?: boolean; onText: string; offText: string; testId: string }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-full pl-2 text-xs font-medium text-ink-soft focus-visible:ring-2 focus-visible:ring-coral focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      data-testid={testId}
    >
      <span aria-hidden>{checked ? onText : offText}</span>
      <span aria-hidden className={`relative h-7 w-12 rounded-full transition-colors ${checked ? 'bg-ink' : 'bg-ink/25'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}

export function AvatarPrompt({ lang, look, onPick, onClear, onMeasurements, onClose, termsUrl, face = false }: AvatarPromptProps): ReactNode {
  const t = AVATAR_CLAIMS[lang];
  const ui = AVATAR_UI[lang];
  const id = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  // On: the row of swatches is open. A colour exists only once a swatch is picked (C1).
  const [skinOn, setSkinOn] = useState(look !== null);
  const [cleared, setCleared] = useState(false);
  const total = MONK_CLASSES.length;

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape closes the prompt (the embed's own Escape handler stands down while it is open) and
  // Tab stays inside the dialog.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Stop here: on `window` the embed would close the whole overlay on the shop page.
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = !!active && !!dialogRef.current?.contains(active);
      if (e.shiftKey && (active === first || active === titleRef.current || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleSkin = (on: boolean): void => {
    setSkinOn(on);
    setCleared(!on);
    if (!on) onClear();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      {/* The backdrop closes the prompt for a pointer; keyboard and screen reader use Close and Escape. */}
      <button type="button" tabIndex={-1} aria-hidden className="absolute inset-0 cursor-default bg-ink/45" onClick={onClose} data-testid="avatar-prompt-backdrop" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-intro`}
        lang={lang}
        className="relative max-h-[92dvh] w-full max-w-[560px] space-y-4 overflow-y-auto overscroll-contain rounded-t-3xl bg-cream px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-2xl"
        data-testid="avatar-prompt"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className="font-display text-2xl leading-tight focus:outline-none">
            {t.title}
          </h2>
          <button type="button" onClick={onClose} aria-label={ui.close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70 focus-visible:ring-2 focus-visible:ring-coral focus-visible:outline-none" data-testid="avatar-prompt-close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div id={`${id}-intro`} className="space-y-1 text-sm text-ink-soft">
          <p>{t.c1}</p>
          <p>{t.c2}</p>
          <p>{t.c3}</p>
        </div>

        <ul className="space-y-3">
          {face ? (
            <li className="card space-y-1 p-3" data-testid="avatar-item-face">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span id={`${id}-face`} className="text-base font-semibold">
                    {t.faceName}
                  </span>
                  <span className="chip px-2 py-0.5 text-[11px]" id={`${id}-face-soon`}>
                    {ui.comingSoon}
                  </span>
                </span>
                <Switch checked={false} disabled labelledBy={`${id}-face`} describedBy={`${id}-face-soon ${id}-face-text`} onText={ui.on} offText={ui.off} testId="avatar-face-switch" />
              </div>
              <p id={`${id}-face-text`} className="text-sm text-ink-soft">
                {t.faceOff}
              </p>
            </li>
          ) : null}

          <li className="card space-y-2 p-3" data-testid="avatar-item-skin">
            <div className="flex items-center justify-between gap-3">
              <span id={`${id}-skin`} className="text-base font-semibold">
                {t.skinName}
              </span>
              <Switch checked={skinOn} onChange={toggleSkin} labelledBy={`${id}-skin`} describedBy={`${id}-skin-text`} onText={ui.on} offText={ui.off} testId="avatar-skin-switch" />
            </div>
            <p id={`${id}-skin-text`} className="text-sm text-ink-soft">
              {t.c11Pick}
            </p>
            {skinOn ? (
              <>
                <fieldset data-testid="skin-swatches">
                  <legend className="mb-2 text-sm font-medium">{t.skinOnYes}</legend>
                  <div className="grid grid-cols-5 gap-2">
                    {MONK_CLASSES.map((n) => {
                      const swatch = lookForMonk(n)!;
                      const checked = look?.monk === n;
                      const edge = n === 1 ? `, ${ui.lightest}` : n === total ? `, ${ui.darkest}` : '';
                      return (
                        <label key={n} className="flex cursor-pointer flex-col items-center gap-0.5 text-[10px] text-ink-mute">
                          <input type="radio" name={`${id}-monk`} value={n} checked={checked} onChange={() => onPick(swatch)} className="peer sr-only" aria-label={`${ui.swatch(n, total)}${edge}`} data-testid={`skin-swatch-${n}`} />
                          <span
                            className={`flex h-12 w-full items-center justify-center rounded-xl border peer-focus-visible:ring-2 peer-focus-visible:ring-coral peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream ${checked ? 'border-ink outline outline-2 outline-offset-2 outline-ink' : 'border-ink/25'}`}
                            style={{ background: swatch.hex }}
                          >
                            {checked ? <Check className="h-5 w-5" style={{ color: luminance(swatch.hex) < 0.25 ? '#FFFFFF' : '#1A1612' }} aria-hidden /> : null}
                          </span>
                          <span aria-hidden>{n}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <p className="text-xs text-ink-mute" data-testid="avatar-c30">
                  {c30Text(lang)}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-soft" data-testid="avatar-skin-state">
                {cleared ? t.c14 : t.skinOff}
              </p>
            )}
            <p role="status" aria-live="polite" className="sr-only" data-testid="avatar-skin-status">
              {skinOn && look ? ui.picked(look.monk, total) : cleared ? t.c14 : ''}
            </p>
          </li>

          <li className="card space-y-2 p-3" data-testid="avatar-item-measurements">
            <span className="block text-base font-semibold">{ui.measurementsName}</span>
            <p className="text-sm text-ink-soft">{t.bodyOff}</p>
            <button type="button" className="btn-ghost w-full" onClick={onMeasurements} data-testid="avatar-type-measurements">
              {ui.typeMeasurements}
            </button>
          </li>
        </ul>

        {face ? (
          <p className="text-xs text-ink-mute" data-testid="avatar-c4">
            {t.c4}
          </p>
        ) : null}

        <p className="text-sm">
          <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-coral-ink underline underline-offset-2" data-testid="avatar-terms-link">
            {t.termsLink}
          </a>
        </p>

        <button type="button" className="btn-coral w-full" onClick={onClose} data-testid="avatar-prompt-done">
          {ui.done}
        </button>
      </div>
    </div>
  );
}
