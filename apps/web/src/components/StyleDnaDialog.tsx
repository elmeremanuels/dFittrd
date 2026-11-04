import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { styleDna, type TasteProfile } from '@paskamer/taste-engine';
import { TasteRadial } from './TasteRadial';

/**
 * Native <dialog>: modal focus trap, Escape and backdrop handled by the platform. Copy comes from
 * styleDna() — archetype = argmax axis, its %, and 'Refined by N swipes' (nothing fabricated).
 */
export function StyleDnaDialog({ open, profile, onClose }: { open: boolean; profile: TasteProfile; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const dna = styleDna(profile);
  return (
    <dialog
      ref={ref}
      aria-labelledby="style-dna-title"
      aria-describedby="style-dna-subtitle"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(92vw,24rem)] rounded-[2.5rem] bg-cream p-0 text-ink shadow-2xl backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
    >
      <div className="relative space-y-5 p-7">
        <button type="button" onClick={onClose} aria-label="Close Style DNA" className="absolute top-5 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 hover:bg-ink/10">
          <X className="h-5 w-5" aria-hidden />
        </button>
        <header className="pr-12">
          <h2 id="style-dna-title" className="font-display text-3xl leading-tight">
            Your Style DNA
          </h2>
          <p id="style-dna-subtitle" className="text-sm text-ink-soft">
            {dna.subtitle}
          </p>
        </header>
        <TasteRadial axes={profile.axes} />
        <div className="card flex items-center justify-between bg-white/80">
          <div className="flex items-center gap-3">
            <div className="h-10 w-1.5 rounded-full bg-coral" aria-hidden />
            <div>
              <p className="eyebrow">Primary archetype</p>
              <p className="text-sm font-medium">{dna.archetypeLabel}</p>
            </div>
          </div>
          <p className="font-display text-2xl">{dna.percent}%</p>
        </div>
        <p className="text-xs text-ink-mute">On-device estimate from your swipes and onboarding vibes. Nothing about your body is in here.</p>
      </div>
    </dialog>
  );
}
