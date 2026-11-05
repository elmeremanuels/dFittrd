import { createContext, useContext, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Which product the capture runs in (COPY-1). `app`: the Curtain app (face tile, signature sync).
 * `embed`: the standalone fitting room on a shop's page (docs/STANDALONE.md): no identity tile,
 * nothing ever syncs, and the shopper may be on a laptop rather than a phone.
 */
export type CaptureVariant = 'app' | 'embed';
export const CaptureVariantContext = createContext<CaptureVariant>('app');
export const useCaptureVariant = (): CaptureVariant => useContext(CaptureVariantContext);

export function StepHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }): ReactNode {
  return (
    <header className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink/40">{eyebrow}</p>
      <h2 className="font-display text-3xl leading-tight text-ink">{title}</h2>
      {subtitle ? <p className="text-sm text-ink/60">{subtitle}</p> : null}
    </header>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-coral px-6 text-base font-medium text-white shadow-lg shadow-coral/20 transition-colors hover:bg-coral/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-ink/10 bg-white/40 px-5 text-sm font-medium text-ink/80 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }): ReactNode {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: reduce ? 0 : 0.25, ease: 'easeOut' }}
      className={`glass-panel rounded-[2rem] p-5 ${className}`}
    >
      {children}
    </motion.section>
  );
}

export function EstimateBadge({ children = 'estimate' }: { children?: ReactNode }): ReactNode {
  return (
    <span className="inline-flex items-center rounded-full border border-ink/10 bg-white/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink/50">
      {children}
    </span>
  );
}

export function ConfidenceBar({ value, label }: { value: number; label: string }): ReactNode {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = pct >= 85 ? 'bg-emerald-500' : pct >= 60 ? 'bg-coral' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-ink/60">{pct}%</span>
    </div>
  );
}

export function PrivacyNote(): ReactNode {
  const variant = useCaptureVariant();
  if (variant === 'embed')
    return (
      <p className="text-xs leading-relaxed text-ink/50" data-testid="privacy-note">
        Video stays on this device. It is processed in this browser and never uploaded, and no measurement is sent to Curtain or the shop.
      </p>
    );
  return (
    <p className="text-xs leading-relaxed text-ink/50">
      Photos and video stay on this device. They are processed in a background worker, never uploaded, and only an
      anonymised fit signature (about 80 numbers, no face or skin data) ever syncs.
    </p>
  );
}
