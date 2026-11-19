/**
 * The live face photo parts of the avatar prompt (photo-avatar plan slices 4 and 5), drawn only when
 * the build sets `VITE_AVATAR_FACE_PHOTO=live` (off by default; a normal build shows the disabled
 * "coming soon" row or nothing, because counsel has not answered, D20.4). Variant A of the consent
 * copy: everything runs on the device and nothing is sent.
 *
 * The order of a yes (plan gate G2, copy C1, C5, C26):
 *   switch on (or "Read it from my photo") → the ask: what happens, the age line, an unticked age
 *   box, "Yes" and "No" of the same size and weight → only after the yes: the two photo buttons
 *   ("Take a photo", "Choose a photo"), and only on a press of one of those does a file input
 *   exist (created for that press, removed after). Nothing is opened, read or sent before.
 *
 * This component makes no request and keeps no photo: the file goes straight to the host
 * (`onPhoto`), which reads it on the device and drops it.
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { embedStrings } from './strings';
import { FACE_PHOTO_MIN_AGE } from './look';

export type FacePhotoNotice = 'turned' | 'small' | 'bright' | 'dark' | 'side' | 'cast';

/** What the host tells the live rows. */
export interface FacePhotoState {
  /** The face tile on the avatar now (`blob:` URL of this page), or null: the standard face. */
  tileUrl: string | null;
  /** A photo is being read now, for the face or for the skin tone. */
  busy: 'face' | 'skin' | null;
  /** The last photo could not be used. */
  error: { for: 'face' | 'skin'; kind: 'notFound' | 'failed' } | null;
  /** Light and pose notices of the last photo (they warn, never block). */
  notices: { for: 'face' | 'skin'; list: FacePhotoNotice[] } | null;
  /** The Monk class the last photo points to (a proposal: the shopper taps the swatch). */
  suggestion: number | null;
  /** "Remember my photo on this device" (C19), off at first. */
  rememberPhoto: boolean;
  /** "Remember me on this shop" is on: without it nothing is stored, so C19 cannot be switched on. */
  canRemember: boolean;
  onPhoto: (purpose: 'face' | 'skin', file: File) => void;
  /** The face switch off (C9): the face goes from the avatar and from this device. */
  onFaceOff: () => void;
  /** "Delete my photo" (C20): the face and the colour read from the photo go. */
  onDeletePhoto: () => void;
  onRememberPhoto: (on: boolean) => void;
}

/** A file input made for one press only (G2: nothing that can read a file exists before the yes). */
function pickFile(host: HTMLElement | null, camera: boolean, onFile: (f: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (camera) input.setAttribute('capture', 'user');
  input.hidden = true;
  input.dataset.testid = camera ? 'face-photo-camera-input' : 'face-photo-file-input';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) onFile(file);
  });
  input.addEventListener('cancel', () => input.remove());
  (host ?? document.body).append(input);
  input.click();
}

/** The ask (claims, age line, unticked age box, Yes and No of equal weight), then the two photo buttons. */
function PhotoAsk({ purpose, lines, yes, no, onNo, onFile }: { purpose: 'face' | 'skin'; lines: string[]; yes: string; no: string; onNo: () => void; onFile: (f: File) => void }): ReactNode {
  const { claims: c, ui } = embedStrings().avatar.facePhoto;
  const id = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  const [age, setAge] = useState(false);
  const [said, setSaid] = useState(false);
  return (
    <div ref={ref} className="space-y-2 rounded-2xl border border-ink/15 bg-white/60 p-3" data-testid={`${purpose}-photo-ask`}>
      {said ? (
        <>
          <p className="text-sm text-ink-soft">{c.faceOnYes}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-ghost min-h-11 px-3 text-sm" onClick={() => pickFile(ref.current, true, onFile)} data-testid={`${purpose}-photo-take`}>
              {ui.takePhoto}
            </button>
            <button type="button" className="btn-ghost min-h-11 px-3 text-sm" onClick={() => pickFile(ref.current, false, onFile)} data-testid={`${purpose}-photo-choose`}>
              {ui.choosePhoto}
            </button>
          </div>
        </>
      ) : (
        <>
          {lines.map((l) => (
            <p key={l} className="text-sm text-ink-soft">
              {l}
            </p>
          ))}
          <p className="text-xs text-ink-mute" data-testid={`${purpose}-photo-c5`}>
            {c.c5.replace('{age}', String(FACE_PHOTO_MIN_AGE))}
          </p>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium" htmlFor={`${id}-age`}>
            <input id={`${id}-age`} type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="h-5 w-5 accent-ink" data-testid={`${purpose}-photo-age`} />
            {ui.ageConfirm(FACE_PHOTO_MIN_AGE)}
          </label>
          {/* G2: the two answers have the same size and weight. Yes waits for the age box. */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-ghost min-h-11 px-3 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50" aria-disabled={!age || undefined} onClick={() => age && setSaid(true)} data-testid={`${purpose}-photo-yes`}>
              {yes}
            </button>
            <button type="button" className="btn-ghost min-h-11 px-3 text-sm" onClick={onNo} data-testid={`${purpose}-photo-no`}>
              {no}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Notices({ state, purpose }: { state: FacePhotoState; purpose: 'face' | 'skin' }): ReactNode {
  const { ui } = embedStrings().avatar.facePhoto;
  const err = state.error?.for === purpose ? state.error.kind : null;
  const list = state.notices?.for === purpose ? state.notices.list : [];
  if (!err && list.length === 0) return null;
  return (
    <div role="status" className="space-y-1 rounded-xl bg-coral/10 p-2 text-sm text-ink" data-testid={`${purpose}-photo-notice`}>
      {err ? <p>{ui[err]}</p> : null}
      {list.map((n) => (
        <p key={n} data-notice={n}>
          {ui.notices[n]}
        </p>
      ))}
      {purpose === 'skin' ? <p className="text-ink-soft">{ui.orPick}</p> : null}
    </div>
  );
}

/**
 * The "Use my face" row, live. `switchEl` is the prompt's own switch, rendered by the caller with
 * the checked state and handler this component gives it.
 */
export function FaceRowLive({ state, labelledBy, renderSwitch, hasLook, rememberLabel }: { state: FacePhotoState; labelledBy: string; renderSwitch: (checked: boolean, onChange: (on: boolean) => void) => ReactNode; hasLook: boolean; rememberLabel: string }): ReactNode {
  const { claims: c, ui } = embedStrings().avatar.facePhoto;
  const [asking, setAsking] = useState(false);
  const [moment, setMoment] = useState<'start' | 'no' | 'off'>('start');
  const on = !!state.tileUrl;
  const checked = on || asking || state.busy === 'face';
  const id = useId();
  return (
    <li className="card space-y-2 p-3" data-testid="avatar-item-face" data-live="1">
      <div className="flex items-center justify-between gap-3">
        <span id={labelledBy} className="text-base font-semibold">
          {embedStrings().avatar.claims.faceName}
        </span>
        {renderSwitch(checked, (next) => {
          if (next) {
            setAsking(true);
          } else {
            setAsking(false);
            if (on || state.busy === 'face') {
              state.onFaceOff();
              setMoment('off');
            }
          }
        })}
      </div>
      <div id={`${labelledBy}-text`} className="space-y-1 text-sm text-ink-soft">
        <p>{c.c6}</p>
        <p>{c.c7}</p>
        {!checked ? <p data-testid="face-moment">{moment === 'off' ? c.c9 : moment === 'no' ? c.faceOnNo : embedStrings().avatar.claims.faceOff}</p> : null}
      </div>
      {asking && !on && state.busy !== 'face' ? (
        <PhotoAsk
          purpose="face"
          lines={[]}
          yes={c.yes}
          no={c.no}
          onNo={() => {
            setAsking(false);
            setMoment('no');
          }}
          onFile={(f) => {
            setAsking(false);
            state.onPhoto('face', f);
          }}
        />
      ) : null}
      {state.busy === 'face' ? (
        <p role="status" className="text-sm font-medium" data-testid="face-photo-busy">
          {ui.workingFace}
        </p>
      ) : null}
      <Notices state={state} purpose="face" />
      {on ? (
        <div className="space-y-2" data-testid="face-photo-on">
          <div className="flex items-center gap-3">
            <span className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-cream shadow" role="img" aria-label={ui.preview}>
              <img src={state.tileUrl!} alt="" className="h-full w-full object-cover" data-testid="face-photo-preview" />
            </span>
            <p className="text-sm font-medium">{c.c27}</p>
          </div>
          {!hasLook ? (
            <p className="text-xs text-ink-mute" data-testid="face-photo-match-hint">
              {ui.matchHint}
            </p>
          ) : null}
          <div className="flex items-start justify-between gap-3 border-t border-ink/10 pt-2">
            <div className="min-w-0">
              <p id={`${id}-remember`} className="text-sm font-semibold">
                {c.c19Label}
              </p>
              <p id={`${id}-remember-text`} className="text-xs text-ink-mute">
                {c.c19}
              </p>
              {!state.canRemember ? (
                <p className="text-xs text-ink-mute" data-testid="face-photo-needs-remember">
                  {ui.needsRemember(rememberLabel)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.rememberPhoto}
              aria-labelledby={`${id}-remember`}
              aria-describedby={`${id}-remember-text`}
              aria-disabled={!state.canRemember || undefined}
              onClick={() => state.canRemember && state.onRememberPhoto(!state.rememberPhoto)}
              className="flex min-h-11 shrink-0 items-center rounded-full focus-visible:ring-2 focus-visible:ring-coral focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              data-testid="face-photo-remember"
            >
              <span aria-hidden className={`relative h-7 w-12 rounded-full transition-colors ${state.rememberPhoto ? 'bg-ink' : 'bg-ink/25'}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${state.rememberPhoto ? 'left-6' : 'left-1'}`} />
              </span>
            </button>
          </div>
          <div className="space-y-1 border-t border-ink/10 pt-2">
            <button
              type="button"
              className="btn-ghost min-h-11 w-full text-sm"
              onClick={() => {
                state.onDeletePhoto();
                setMoment('off');
              }}
              aria-describedby={`${id}-delete-text`}
              data-testid="face-photo-delete"
            >
              {c.c20Label}
            </button>
            <p id={`${id}-delete-text`} className="text-xs text-ink-mute">
              {c.c20}
            </p>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Under the swatches of "Match my skin tone", live: C26, the offer to read the colour from a photo, the suggestion. */
export function SkinPhotoOffer({ state, total }: { state: FacePhotoState; total: number }): ReactNode {
  const { claims: c, ui } = embedStrings().avatar.facePhoto;
  const [asking, setAsking] = useState(false);
  return (
    <div className="space-y-2" data-testid="skin-photo-offer">
      <p className="text-xs text-ink-mute" data-testid="skin-photo-c26">
        {c.c26}
      </p>
      {state.suggestion ? (
        <p role="status" className="rounded-xl bg-white/70 p-2 text-sm text-ink" data-testid="skin-photo-suggestion">
          {ui.suggestion(state.suggestion, total)}
        </p>
      ) : null}
      {state.busy === 'skin' ? (
        <p role="status" className="text-sm font-medium" data-testid="skin-photo-busy">
          {ui.workingSkin}
        </p>
      ) : asking ? (
        <PhotoAsk
          purpose="skin"
          lines={[]}
          yes={c.yes}
          no={ui.skinAskNo}
          onNo={() => setAsking(false)}
          onFile={(f) => {
            setAsking(false);
            state.onPhoto('skin', f);
          }}
        />
      ) : (
        <button type="button" className="btn-ghost min-h-11 w-full text-sm" onClick={() => setAsking(true)} data-testid="skin-photo-read">
          {ui.readFromPhoto}
        </button>
      )}
      <Notices state={state} purpose="skin" />
    </div>
  );
}
