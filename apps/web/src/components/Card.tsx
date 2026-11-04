import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from 'motion/react';
import { Bookmark, Heart, ThumbsDown, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { SwipeAction } from '@paskamer/schema';

export const SWIPE_THRESHOLD_PX = 90;

/** Resolve the dominant axis first, then apply the threshold on that axis (audit: axis priority). */
export function resolveSwipe(offset: { x: number; y: number }, threshold = SWIPE_THRESHOLD_PX): SwipeAction | null {
  if (Math.abs(offset.x) >= Math.abs(offset.y)) {
    if (offset.x > threshold) return 'love';
    if (offset.x < -threshold) return 'pass';
    return null;
  }
  if (offset.y < -threshold) return 'save';
  if (offset.y > threshold) return 'less';
  return null;
}

export interface CardProps {
  id: string;
  disabled?: boolean;
  onSwipe: (action: SwipeAction) => void | Promise<void>;
  children: ReactNode;
}

/**
 * One deck card with its OWN motion values (audit: shared x/y across keyed cards), a fly-off
 * animation on commit, dragElastic 1 so the card follows the pointer 1:1, and direction overlays.
 * Pointer gestures are an addition — the four action buttons remain the accessible path.
 */
export function Card({ id, disabled = false, onSwipe, children }: CardProps): ReactNode {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const reduce = useReducedMotion();
  const rotate = useTransform(x, [-250, 250], [-10, 10]);
  const loveOpacity = useTransform(x, [20, SWIPE_THRESHOLD_PX], [0, 1]);
  const passOpacity = useTransform(x, [-SWIPE_THRESHOLD_PX, -20], [1, 0]);
  const saveOpacity = useTransform(y, [-SWIPE_THRESHOLD_PX, -20], [1, 0]);
  const lessOpacity = useTransform(y, [20, SWIPE_THRESHOLD_PX], [0, 1]);
  const [busy, setBusy] = useState(false);
  const committed = useRef(false);

  const commit = async (action: SwipeAction): Promise<void> => {
    if (committed.current) return;
    committed.current = true;
    setBusy(true);
    const w = typeof window !== 'undefined' ? window.innerWidth : 400;
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    if (!reduce) {
      const target = action === 'love' ? { x: w * 1.2 } : action === 'pass' ? { x: -w * 1.2 } : action === 'save' ? { y: -h } : { y: h };
      await Promise.all([
        target.x !== undefined ? animate(x, target.x, { duration: 0.28, ease: 'easeIn' }).then(() => undefined) : Promise.resolve(),
        target.y !== undefined ? animate(y, target.y, { duration: 0.28, ease: 'easeIn' }).then(() => undefined) : Promise.resolve(),
      ]);
    }
    await onSwipe(action);
  };

  const onDragEnd = (_: unknown, info: PanInfo): void => {
    if (disabled || busy) return;
    const action = resolveSwipe(info.offset);
    if (action) void commit(action);
  };

  return (
    <motion.div
      key={id}
      data-testid="deck-card"
      style={{ x, y, rotate, aspectRatio: '5 / 8' }}
      drag={!disabled && !busy}
      dragElastic={1}
      dragSnapToOrigin
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={onDragEnd}
      whileTap={disabled ? undefined : { cursor: 'grabbing' }}
      className="mirror-frame mx-auto h-full w-auto max-w-full cursor-grab touch-none select-none"
    >
      {children}
      <Overlay opacity={loveOpacity} className="right-5 top-5 border-coral text-coral" icon={<Heart className="h-5 w-5" aria-hidden />} label="Love" />
      <Overlay opacity={passOpacity} className="left-5 top-5 border-ink text-ink" icon={<X className="h-5 w-5" aria-hidden />} label="Pass" />
      <Overlay opacity={saveOpacity} className="left-1/2 top-5 -translate-x-1/2 border-ink text-ink" icon={<Bookmark className="h-5 w-5" aria-hidden />} label="Save" />
      <Overlay opacity={lessOpacity} className="bottom-24 left-1/2 -translate-x-1/2 border-ink text-ink" icon={<ThumbsDown className="h-5 w-5" aria-hidden />} label="Less like this" />
    </motion.div>
  );
}

function Overlay({ opacity, className, icon, label }: { opacity: ReturnType<typeof useTransform<number, number>>; className: string; icon: ReactNode; label: string }): ReactNode {
  return (
    <motion.div style={{ opacity }} aria-hidden className={`pointer-events-none absolute z-20 flex items-center gap-1 rounded-full border-2 bg-cream/90 px-3 py-1 text-sm font-semibold uppercase tracking-wider ${className}`}>
      {icon}
      {label}
    </motion.div>
  );
}
