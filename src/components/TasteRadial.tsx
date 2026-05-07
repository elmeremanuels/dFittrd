import React from 'react';
import { TasteProfile } from '../types';

interface TasteRadialProps {
  profile: TasteProfile;
}

export default function TasteRadial({ profile }: TasteRadialProps) {
  // Simple SVG Radar Chart implementation
  const categories = Object.keys(profile) as Array<keyof TasteProfile>;
  const center = 100;
  const radius = 80;
  
  const points = categories.map((key, i) => {
    const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
    const value = profile[key];
    const x = center + radius * value * Math.cos(angle);
    const y = center + radius * value * Math.sin(angle);
    return `${x},${y}`;
  }).join(' ');

  const gridPoints = [0.25, 0.5, 0.75, 1].map(scale => {
    return categories.map((_, i) => {
      const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
      const x = center + radius * scale * Math.cos(angle);
      const y = center + radius * scale * Math.sin(angle);
      return `${x},${y}`;
    }).join(' ');
  });

  return (
    <div className="w-full aspect-square relative flex items-center justify-center p-8 bg-white rounded-3xl border border-ink/5 shadow-sm">
      <svg viewBox="0 0 200 200" className="w-full h-full">
        {/* Grid */}
        {gridPoints.map((gp, i) => (
          <polygon key={i} points={gp} fill="none" stroke="rgba(26, 22, 18, 0.05)" strokeWidth="1" />
        ))}
        {categories.map((_, i) => {
           const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
           const x = center + radius * Math.cos(angle);
           const y = center + radius * Math.sin(angle);
           return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="rgba(26, 22, 18, 0.05)" strokeWidth="1" />;
        })}

        {/* Data Area */}
        <polygon 
          points={points} 
          fill="rgba(255, 90, 60, 0.2)" 
          stroke="#FF5A3C" 
          strokeWidth="2" 
          className="transition-all duration-1000"
        />

        {/* Labels */}
        {categories.map((cat, i) => {
          const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
          const x = center + (radius + 20) * Math.cos(angle);
          const y = center + (radius + 20) * Math.sin(angle);
          return (
            <text 
              key={cat} 
              x={x} 
              y={y} 
              textAnchor="middle" 
              className="text-[10px] font-bold uppercase tracking-tighter fill-ink/40"
            >
              {cat}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
