/**
 * The avatar prompt (DECISIONS.md D19): tapping the avatar opens this sheet, where the shopper
 * chooses what is used to make the avatar look like them. Plain language, one or two short
 * sentences per item, the legal text behind a link.
 *
 * What is live in this build:
 *   - "Match my skin tone": a switch (off at first) and, once on, the ten swatches of the Monk Skin
 *     Tone scale (CC BY 4.0, credited under the row). The shopper picks; nothing is read from a
 *     photo and no tone is guessed. The colour is in memory only unless the build saves it (`saved`).
 *   - "My measurements": typed in, which is the default (D19). The button opens the About-you form.
 * What is not:
 *   - "Use my face" is drawn only when `face` is true (the build flag, default off) and is then a
 *     "coming soon" row whose switch does nothing. No camera, file picker or upload exists behind it.
 *   - Slice 6 spike only (`faceOnHead`, passed by a host built with `VITE_AVATAR_FACE_ON_HEAD=1`,
 *     never by a normal build): the row is live with variant A of the copy (C6, C7, C9). A file
 *     picker is created only after the shopper presses "Yes, use my photo"; the host reads the
 *     picture on the device and nothing is sent.
 *
 * This component makes no request and opens no camera or file input. It is a modal dialog: focus
 * moves into it, Tab stays inside, Escape and the backdrop close it.
 */
import { X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { c30Parts } from './avatarCopy';
import { embedStrings } from './strings';
import { lookForSlider, MONK_CLASSES, type SkinLook } from './look';
import { HairPicker } from './HairPicker';
import type { HairPick } from './hair';
import { MONK_SWATCHES } from '@/features/capture/faceSkin';
import { monkAt, sliderForMonk } from './skinSlider';
import { FaceRowLive, SkinPhotoOffer, type FacePhotoState } from './FacePhotoRows';

export interface AvatarPromptProps {
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
  /**
   * This build saves the picked colour on the device under "Remember me" (C30 is then shown).
   * Default false: the colour is in memory only, and no sentence about saving it is shown.
   */
  saved?: boolean;
  /**
   * Slices 4 and 5, live (`VITE_AVATAR_FACE_PHOTO=live` only, never a normal build): the face row
   * with consent, photo and tile; the skin row with the offer to read the colour from a photo.
   */
  facePhoto?: FacePhotoState;
  /** Slice 6 spike: the live face row. Absent (every normal build): the row is the `face` "coming soon" line or not drawn. */
  faceOnHead?: FaceOnHeadRow;
  /** Hair picker (D28, OI-170): shown only with the realistic body. Absent: not drawn. */
  hair?: { pick: HairPick | null; onPick: (pick: HairPick) => void; onClear: () => void };
}

/** What the host tells the live face row (slice 6 spike). */
export interface FaceOnHeadRow {
  /** A face is on the avatar now. */
  on: boolean;
  /** The picture is being read. */
  busy: boolean;
  notice: 'notFound' | 'turned' | 'small' | 'failed' | null;
  /** The shopper chose a picture, after saying yes. */
  onPhoto: (file: File) => void;
  /** The shopper switched the face off: the host takes it off the avatar and drops it from memory. */
  onOff: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled])';

/**
 * Skin tone slider (CUR-28, WO-015): continuous slider from Light (Monk 1) to Deep (Monk 10), with
 * Medium at the midpoint (between Monk 5 and 6). The track is a CSS gradient through the 10 Monk
 * swatches, interpolated in OKLab for perceptually even steps. Arrow keys move one step (1/900 of
 * the track); Home/End jump to Light/Deep. Works at 360 px width.
 */
function SkinSlider({
  look,
  suggested,
  onPick,
  labels,
  credit,
}: {
  look: SkinLook | null;
  /** A Monk class (1..10) the face photo points to, or null. Shown as a dashed tick on the track. */
  suggested: number | null;
  onPick: (look: SkinLook) => void;
  labels: { light: string; medium: string; deep: string; slider: string; status: (label: string, hex: string) => string };
  credit: string;
}): ReactNode {
  const id = useId();
  // 10 stops, evenly spaced, matching the 10 Monk swatches.
  const gradient = useMemo(() => {
    const stops = MONK_SWATCHES.map((hex, i) => `${hex} ${(i / (MONK_SWATCHES.length - 1)) * 100}%`).join(', ');
    return `linear-gradient(to right, ${stops})`;
  }, []);

  // Slider value: 0..1 in steps of 0.001 (for smooth keyboard motion; a 1/900 snap ≈ 0.00111).
  const slider = look?.slider ?? 0;
  const suggestedSlider = suggested !== null && Number.isInteger(suggested) && suggested >= 1 && suggested <= 10 ? sliderForMonk(suggested) : null;
  // The label shown above the thumb: Light at 0, Deep at 1, Medium in the band 0.44..0.56 (around the midpoint between Monk 5 and 6).
  const thumbLabel = slider <= 0.11 ? labels.light : slider >= 0.89 ? labels.deep : Math.abs(slider - 0.5) <= 0.06 ? labels.medium : '';
  const thumbPct = Math.round(slider * 1000) / 10;

  return (
    <div data-testid="skin-slider">
      <label htmlFor={`${id}-input`} className="mb-1 block text-sm font-medium">
        {labels.slider}
      </label>
      <div className="relative w-full max-w-[360px]">
        <div aria-hidden className="h-3 w-full overflow-hidden rounded-full border border-ink/20" style={{ background: gradient }} data-testid="skin-slider-track" />
        {suggestedSlider !== null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 h-3 w-0.5 border-l-2 border-dashed border-coral"
            style={{ left: `${Math.round(suggestedSlider * 1000) / 10}%` }}
            data-testid="skin-slider-suggested"
          />
        ) : null}
        <input
          id={`${id}-input`}
          type="range"
          min={0}
          max={1}
          step={1 / 900}
          value={slider}
          onChange={(e) => onPick(lookForSlider(parseFloat(e.target.value)))}
          aria-label={labels.slider}
          aria-valuetext={thumbLabel ? labels.status(thumbLabel, look?.hex ?? '') : (look?.hex ?? '')}
          className="skin-slider absolute inset-0 h-3 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none"
          data-testid="skin-slider-input"
          style={
            {
              '--skin-thumb': look?.hex ?? '#1A1612',
              '--skin-thumb-pct': `${thumbPct}%`,
            } as React.CSSProperties
          }
        />
      </div>
      <div aria-hidden className="mt-1 flex w-full max-w-[360px] justify-between text-[11px] font-medium text-ink-soft">
        <span data-testid="skin-slider-label-light">{labels.light}</span>
        <span data-testid="skin-slider-label-medium">{labels.medium}</span>
        <span data-testid="skin-slider-label-deep">{labels.deep}</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-ink-mute" data-testid="skin-slider-hint">
        {credit}
      </p>
    </div>
  );
}


function Switch({ checked, onChange, labelledBy, describedBy, unavailable = false, onText, offText, testId }: { checked: boolean; onChange?: (on: boolean) => void; labelledBy: string; describedBy?: string; unavailable?: boolean; onText: string; offText: string; testId: string }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Not `disabled`: a disabled button is skipped by Tab, so a keyboard or screen-reader user
      // would never reach the row and hear why it does nothing ("Coming soon", via describedBy).
      aria-disabled={unavailable || undefined}
      onClick={() => {
        if (!unavailable) onChange?.(!checked);
      }}
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-full pl-2 text-xs font-medium text-ink-soft focus-visible:ring-2 focus-visible:ring-coral focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      data-testid={testId}
    >
      <span aria-hidden>{checked ? onText : offText}</span>
      <span aria-hidden className={`relative h-7 w-12 rounded-full transition-colors ${checked ? 'bg-ink' : 'bg-ink/25'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}

export function AvatarPrompt({ look, onPick, onClear, onMeasurements, onClose, termsUrl, face = false, saved = false, faceOnHead, facePhoto, hair }: AvatarPromptProps): ReactNode {
  const { claims: t, ui, faceSpike: fs } = embedStrings().avatar;
  const id = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  // On: the row of swatches is open. A colour exists only once a swatch is picked (C1).
  const [skinOn, setSkinOn] = useState(look !== null);
  const [cleared, setCleared] = useState(false);
  // Slice 6 spike: the yes/no step of the live face row, and whether the face was switched off again (C9).
  const [faceAsk, setFaceAsk] = useState(false);
  const [faceRemoved, setFaceRemoved] = useState(false);
  const total = MONK_CLASSES.length;
  const c30 = c30Parts();

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

  const pickPhoto = (): void => {
    // The file input exists only from this press on (G2: nothing is opened before the yes), and goes again after.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.dataset.testid = 'avatar-face-file';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) faceOnHead?.onPhoto(file);
    });
    input.addEventListener('cancel', () => input.remove());
    dialogRef.current?.append(input);
    setFaceAsk(false);
    input.click();
  };

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
          {facePhoto ? (
            <FaceRowLive
              state={facePhoto}
              labelledBy={`${id}-face`}
              hasLook={look !== null}
              rememberLabel={embedStrings().rememberLabel}
              renderSwitch={(checked, onChange) => <Switch checked={checked} onChange={onChange} labelledBy={`${id}-face`} describedBy={`${id}-face-text`} onText={ui.on} offText={ui.off} testId="avatar-face-switch" />}
            />
          ) : faceOnHead ? (
            <li className="card space-y-2 p-3" data-testid="avatar-item-face">
              <div className="flex items-center justify-between gap-3">
                <span id={`${id}-face`} className="text-base font-semibold">
                  {t.faceName}
                </span>
                <Switch
                  checked={faceOnHead.on || faceAsk || faceOnHead.busy}
                  onChange={(on) => {
                    if (on) {
                      setFaceAsk(true);
                      setFaceRemoved(false);
                    } else {
                      setFaceAsk(false);
                      if (faceOnHead.on) setFaceRemoved(true);
                      faceOnHead.onOff();
                    }
                  }}
                  labelledBy={`${id}-face`}
                  describedBy={`${id}-face-text`}
                  onText={ui.on}
                  offText={ui.off}
                  testId="avatar-face-switch"
                />
              </div>
              <div id={`${id}-face-text`} className="space-y-1 text-sm text-ink-soft">
                <p>{fs.c6}</p>
                <p>{fs.c7}</p>
                {!faceOnHead.on && !faceAsk && !faceOnHead.busy ? <p>{faceRemoved ? fs.c9 : t.faceOff}</p> : null}
              </div>
              {faceAsk ? (
                // G2: the two answers have the same size and weight.
                <div className="grid grid-cols-2 gap-2" data-testid="avatar-face-ask">
                  <button type="button" className="btn-ghost min-h-11 px-3 text-sm" onClick={pickPhoto} data-testid="avatar-face-yes">
                    {fs.yes}
                  </button>
                  <button type="button" className="btn-ghost min-h-11 px-3 text-sm" onClick={() => setFaceAsk(false)} data-testid="avatar-face-no">
                    {fs.no}
                  </button>
                </div>
              ) : null}
              {faceOnHead.busy ? (
                <p role="status" className="text-sm font-medium" data-testid="avatar-face-busy">
                  {fs.working}
                </p>
              ) : null}
              {faceOnHead.notice ? (
                <p role="status" className="text-sm font-medium text-ink" data-testid="avatar-face-notice">
                  {fs[faceOnHead.notice]}
                </p>
              ) : null}
            </li>
          ) : face ? (
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
                <Switch checked={false} unavailable labelledBy={`${id}-face`} describedBy={`${id}-face-soon ${id}-face-text`} onText={ui.on} offText={ui.off} testId="avatar-face-switch" />
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
            {facePhoto ? (
              <div id={`${id}-skin-text`} className="space-y-1 text-sm text-ink-soft">
                <p>{embedStrings().avatar.facePhoto.claims.c11}</p>
                <p>{embedStrings().avatar.facePhoto.claims.c12}</p>
              </div>
            ) : (
              <p id={`${id}-skin-text`} className="text-sm text-ink-soft">
                {t.c11Pick}
              </p>
            )}
            {skinOn ? (
              <>
                <SkinSlider
                  look={look}
                  suggested={facePhoto?.suggestion ?? null}
                  onPick={onPick}
                  labels={{ light: ui.skinLight, medium: ui.skinMedium, deep: ui.skinDeep, slider: ui.skinSlider, status: ui.skinSliderStatus }}
                  credit={ui.swatchCredit}
                />
                {saved ? (
                  <p className="text-xs text-ink-mute" data-testid="avatar-c30">
                    {c30.before}
                    {c30.label}
                    {c30.after}
                  </p>
                ) : null}
                {facePhoto ? <SkinPhotoOffer state={facePhoto} total={total} /> : null}
                <p className="text-[10px] leading-snug text-ink-mute" data-testid="avatar-swatch-credit">
                  {ui.swatchCredit}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-soft" data-testid="avatar-skin-state">
                {cleared ? t.c14 : t.skinOff}
              </p>
            )}
            <p role="status" aria-live="polite" className="sr-only" data-testid="avatar-skin-status">
              {skinOn && look ? ui.picked(monkAt(look.slider), total) : cleared ? t.c14 : ''}
            </p>
          </li>

          {hair ? (
            <li className="card space-y-2 p-3" data-testid="avatar-item-hair">
              <HairPicker pick={hair.pick} onPick={hair.onPick} onClear={hair.onClear} />
            </li>
          ) : null}

          <li className="card space-y-2 p-3" data-testid="avatar-item-measurements">
            <span className="block text-base font-semibold">{ui.measurementsName}</span>
            <p className="text-sm text-ink-soft">{t.bodyOff}</p>
            <button type="button" className="btn-ghost w-full" onClick={onMeasurements} data-testid="avatar-type-measurements">
              {ui.typeMeasurements}
            </button>
          </li>
        </ul>

        {face || faceOnHead || facePhoto ? (
          <p className="text-xs text-ink-mute" data-testid="avatar-c4">
            {t.c4}
          </p>
        ) : null}

        <p className="text-sm">
          <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-coral-ink underline underline-offset-2" data-testid="avatar-terms-link">
            {t.termsLink}
          </a>
          {ui.termsLanguageNote ? (
            <span className="text-xs text-ink-mute" data-testid="avatar-terms-lang">
              {' '}
              {ui.termsLanguageNote}
            </span>
          ) : null}
        </p>

        <button type="button" className="btn-coral w-full" onClick={onClose} data-testid="avatar-prompt-done">
          {ui.done}
        </button>
      </div>
    </div>
  );
}
