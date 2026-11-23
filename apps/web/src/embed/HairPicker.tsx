import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { HAIR_COLOURS, HAIR_LENGTHS, HAIR_PALETTE, HAIR_TYPES, type HairColourId, type HairLength, type HairPick, type HairType } from './hair';
import { embedStrings } from './strings';

export interface HairPickerProps {
  /** The hair on the avatar now (null: bald). */
  pick: HairPick | null;
  /** The shopper picked a hair option. */
  onPick: (pick: HairPick) => void;
  /** The shopper switched hair off. */
  onClear: () => void;
}

/**
 * The hair picker (D28, OI-170): type, length and colour, next to the skin tone in the avatar
 * prompt. Keyboard accessible, works at 360 px phone width. The choice is on the device only.
 */
export function HairPicker({ pick, onPick, onClear }: HairPickerProps): ReactNode {
  const id = useId();
  const t = embedStrings().avatar.hair;
  const on = pick !== null;

  const setType = (type: HairType) => onPick({ type, length: pick?.length ?? 'shoulder', colour: pick?.colour ?? 'brown' });
  const setLength = (length: HairLength) => onPick({ type: pick?.type ?? '2A', length, colour: pick?.colour ?? 'brown' });
  const setColour = (colour: HairColourId) => onPick({ type: pick?.type ?? '2A', length: pick?.length ?? 'shoulder', colour });

  return (
    <div className="space-y-3" data-testid="hair-picker">
      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-hair`} className="text-base font-semibold">
          {t.name}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-hair`}
          onClick={() => (on ? onClear() : onPick({ type: '2A', length: 'shoulder', colour: 'brown' }))}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full pl-2 text-xs font-medium text-ink-soft focus-visible:ring-2 focus-visible:ring-coral focus-visible:outline-none"
          data-testid="hair-switch"
        >
          <span aria-hidden>{on ? embedStrings().avatar.ui.on : embedStrings().avatar.ui.off}</span>
          <span aria-hidden className={`relative h-7 w-12 rounded-full transition-colors ${on ? 'bg-ink' : 'bg-ink/25'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-6' : 'left-1'}`} />
          </span>
        </button>
      </div>

      {on ? (
        <>
          <p className="text-sm text-ink-soft">{t.on}</p>

          <fieldset data-testid="hair-types">
            <legend className="mb-1 text-sm font-medium">{t.type}</legend>
            <div className="grid grid-cols-5 gap-1.5">
              {HAIR_TYPES.map((type) => {
                const checked = pick?.type === type;
                return (
                  <label key={type} className="flex cursor-pointer flex-col items-center gap-0.5 text-[10px] text-ink-mute">
                    <input
                      type="radio"
                      name={`${id}-type`}
                      value={type}
                      checked={checked}
                      onChange={() => setType(type)}
                      className="peer sr-only"
                      aria-label={t.typeLabel(type)}
                      data-testid={`hair-type-${type}`}
                    />
                    <span
                      className={`flex h-8 w-full items-center justify-center rounded-lg border text-xs font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-coral peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream ${checked ? 'border-ink bg-ink text-cream' : 'border-ink/40 text-ink'}`}
                    >
                      {type}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset data-testid="hair-lengths">
            <legend className="mb-1 text-sm font-medium">{t.length}</legend>
            <div className="grid grid-cols-4 gap-1.5">
              {HAIR_LENGTHS.map((length) => {
                const checked = pick?.length === length;
                return (
                  <label key={length} className="flex cursor-pointer flex-col items-center gap-0.5 text-[10px] text-ink-mute">
                    <input
                      type="radio"
                      name={`${id}-length`}
                      value={length}
                      checked={checked}
                      onChange={() => setLength(length)}
                      className="peer sr-only"
                      aria-label={t.lengthLabel(length)}
                      data-testid={`hair-length-${length}`}
                    />
                    <span
                      className={`flex h-8 w-full items-center justify-center rounded-lg border text-xs capitalize peer-focus-visible:ring-2 peer-focus-visible:ring-coral peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream ${checked ? 'border-ink bg-ink text-cream' : 'border-ink/40 text-ink'}`}
                    >
                      {length}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset data-testid="hair-colours">
            <legend className="mb-1 text-sm font-medium">{t.colour}</legend>
            <div className="grid grid-cols-5 gap-1.5">
              {HAIR_COLOURS.map((colour) => {
                const checked = pick?.colour === colour;
                const hex = HAIR_PALETTE[colour];
                return (
                  <label key={colour} className="flex cursor-pointer flex-col items-center gap-0.5 text-[9px] text-ink-mute">
                    <input
                      type="radio"
                      name={`${id}-colour`}
                      value={colour}
                      checked={checked}
                      onChange={() => setColour(colour)}
                      className="peer sr-only"
                      aria-label={t.colourLabel(colour)}
                      data-testid={`hair-colour-${colour}`}
                    />
                    <span
                      className={`flex h-9 w-full items-center justify-center rounded-lg border peer-focus-visible:ring-2 peer-focus-visible:ring-coral peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream ${checked ? 'border-ink outline outline-2 outline-offset-2 outline-ink' : 'border-ink/40'}`}
                      style={{ background: hex }}
                    >
                      {checked ? <Check className="h-4 w-4" style={{ color: luminance(hex) < 0.25 ? '#FFFFFF' : '#1A1612' }} aria-hidden /> : null}
                    </span>
                    <span className="text-center leading-tight capitalize">{t.colourLabel(colour)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <p role="status" aria-live="polite" className="sr-only" data-testid="hair-status">
            {pick ? t.picked(pick.type, pick.length, pick.colour) : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-soft" data-testid="hair-state">
          {t.off}
        </p>
      )}
    </div>
  );
}

/** Relative luminance (0..1) of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
