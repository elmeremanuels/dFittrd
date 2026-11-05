import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { AXES, AXIS_LABELS, type AxisVector } from '@curtain/taste-engine';

/**
 * Style DNA radar. Fixed axis order (AXES = schema TASTE_AXES), display labels, a viewBox with
 * room for the labels, role="img" + <title>, and the polygon animated with motion (CSS cannot
 * transition `points`).
 */
const CENTER = 100;
const RADIUS = 72;

function polar(i: number, value: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
  return { x: CENTER + RADIUS * value * Math.cos(angle), y: CENTER + RADIUS * value * Math.sin(angle) };
}

export function TasteRadial({ axes, title = 'Your Style DNA' }: { axes: AxisVector; title?: string }): ReactNode {
  const reduce = useReducedMotion();
  const points = AXES.map((a, i) => {
    const p = polar(i, Math.max(0, Math.min(1, axes[a])));
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map((s) => AXES.map((_, i) => `${polar(i, s).x.toFixed(1)},${polar(i, s).y.toFixed(1)}`).join(' '));
  const desc = AXES.map((a) => `${AXIS_LABELS[a]} ${Math.round(axes[a] * 100)}%`).join(', ');

  return (
    <div className="card aspect-square w-full bg-white/80 p-3">
      <svg viewBox="-36 -24 272 248" className="h-full w-full" role="img" aria-labelledby="taste-radial-title taste-radial-desc">
        <title id="taste-radial-title">{title}</title>
        <desc id="taste-radial-desc">{desc}</desc>
        {rings.map((r, i) => (
          <polygon key={`ring-${i}`} points={r} fill="none" stroke="rgba(26,22,18,0.08)" strokeWidth="1" />
        ))}
        {AXES.map((a, i) => {
          const p = polar(i, 1);
          return <line key={`spoke-${a}`} x1={CENTER} y1={CENTER} x2={p.x} y2={p.y} stroke="rgba(26,22,18,0.08)" strokeWidth="1" />;
        })}
        <motion.polygon
          initial={reduce ? false : { opacity: 0 }}
          animate={{ points, opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.6, ease: 'easeOut' }}
          fill="rgba(255,90,60,0.22)"
          stroke="#FF5A3C"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {AXES.map((a, i) => {
          const p = polar(i, 1.28);
          return (
            <text key={`label-${a}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight="600" fill="#4a423b">
              {AXIS_LABELS[a]}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default TasteRadial;
