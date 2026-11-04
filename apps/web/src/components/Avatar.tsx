import React from 'react';
import { motion } from 'motion/react';
import { UserBodyData, Garment } from '../types';

interface AvatarProps {
  user: UserBodyData;
  garment?: Garment;
  isLoading?: boolean;
}

export default function Avatar({ user, garment, isLoading }: AvatarProps) {
  const bodyOpacity = isLoading ? 0.3 : 1;
  
  return (
    <div className="relative w-full h-full flex items-center justify-center p-4">
      {/* Mirror Reflection Background */}
      <div className="absolute inset-4 rounded-[3rem] border border-white/30 bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-xl shadow-inner" />
      
      {/* Avatar Container */}
      <div className="relative w-full max-w-[260px] h-full flex items-center justify-center">
        <motion.div 
          animate={{ opacity: bodyOpacity }}
          className="relative transition-all duration-700 w-full"
        >
          {/* Detailed SVG Avatar */}
          <svg viewBox="0 0 200 500" className="w-full h-auto drop-shadow-[0_20px_50px_rgba(0,0,0,0.15)]">
            <defs>
              {/* Skin Texture Simulation */}
              <filter id="skinTexture" x="0%" y="0%" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" result="noise" />
                <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.1 0" />
              </filter>
              
              {/* Fabric Texture Simulation */}
              <filter id="fabricTexture" x="0%" y="0%" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" result="noise" />
                <feDiffuseLighting in="noise" lightingColor="white" surfaceScale="1" result="light">
                  <feDistantLight azimuth="45" elevation="60" />
                </feDiffuseLighting>
                <feComposite operator="in" in="light" in2="SourceGraphic" />
              </filter>

              <linearGradient id="bodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.1)" />
                <stop offset="50%" stopColor="rgba(0,0,0,0)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
              </linearGradient>

              {/* Dynamic Skin Tone Gradient */}
              <radialGradient id="skinToneGrad" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor={user.skinTone || "#DFC3A8"} />
                <stop offset="100%" stopColor={adjustColor(user.skinTone || "#DFC3A8", -20)} />
              </radialGradient>
            </defs>
            
            {/* Realistic Personalized Silhouette */}
            <g>
              <path 
                d={getBodyPath(user)}
                fill="url(#skinToneGrad)"
                className="transition-all duration-1000"
              />
              {/* Skin Shadow Layer */}
              <path 
                d={getBodyPath(user)}
                fill="url(#bodyGrad)"
                className="transition-all duration-1000 opacity-40"
              />
              {/* Fine Skin Texture Overlay */}
              <rect width="200" height="500" filter="url(#skinTexture)" pointerEvents="none" className="mix-blend-overlay" />
            </g>

            {/* Garment Overlay with Realistic Drape Simulation */}
            {garment && (
              <motion.g
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                key={garment.id}
              >
                <path
                  d={getGarmentPath(garment, user)}
                  fill={garment.primaryColorHex}
                  filter="url(#fabricTexture)"
                  className="mix-blend-normal transition-all duration-700"
                />
                {/* Garment Highlights/Shadows */}
                <path
                  d={getGarmentPath(garment, user)}
                  fill="url(#bodyGrad)"
                  className="mix-blend-overlay opacity-30 pointer-events-none"
                />
              </motion.g>
            )}
          </svg>
          
          {/* Photoreal Face Identity Tile */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full overflow-hidden border-2 border-white shadow-xl mt-4 ring-4 ring-white/10">
            {user.faceImage ? (
              <img src={user.faceImage} alt="Face" className="w-full h-full object-cover" />
            ) : (
              <div 
                className="w-full h-full" 
                style={{ backgroundColor: user.skinTone }} 
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
          </div>
        </motion.div>
        
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
            <div className="w-10 h-10 border-2 border-coral border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-[10px] font-bold tracking-[0.2em] text-ink/40 uppercase bg-cream/80 px-3 py-1 rounded-full backdrop-blur-sm">Simulating Drape</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Logic to darken/lighten skin tone for shadows
function adjustColor(hex: string, amt: number) {
  let usePound = false;
  if (hex[0] === "#") { hex = hex.slice(1); usePound = true; }
  const num = parseInt(hex, 16);
  let r = (num >> 16) + amt;
  if (r > 255) r = 255; else if (r < 0) r = 0;
  let b = ((num >> 8) & 0x00FF) + amt;
  if (b > 255) b = 255; else if (b < 0) b = 0;
  let g = (num & 0x0000FF) + amt;
  if (g > 255) g = 255; else if (g < 0) g = 0;
  return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

function getBodyPath(user: UserBodyData) {
  // Parametric body based on real measurements
  const bustWidth = (user.bust / 100) * 80;
  const waistWidth = (user.waist / 100) * 70;
  const hipWidth = (user.hip / 100) * 90;

  return `
    M 100,20 
    C 112,20 125,32 125,50 
    C 125,68 112,80 100,80 
    C 88,80 75,68 75,50 
    C 75,32 88,20 100,20
    M 100,80 
    C 85,85 ${100 - bustWidth / 2},100 ${100 - bustWidth / 2},140 
    L ${100 - bustWidth / 2},180 
    C ${100 - bustWidth / 2},210 ${100 - waistWidth / 2},220 100,225 
    C ${100 + waistWidth / 2},220 ${100 + bustWidth / 2},210 ${100 + bustWidth / 2},180 
    L ${100 + bustWidth / 2},140 
    C ${100 + bustWidth / 2},100 115,85 100,80
    M ${100 - waistWidth / 2},225
    C ${100 - hipWidth / 2},235 ${100 - hipWidth / 2},280 ${100 - hipWidth / 2},320
    L ${100 - hipWidth / 2 + 5},480
    L ${100 - hipWidth / 2 + 25},480
    L ${100},300
    L ${100 + hipWidth / 2 - 25},480
    L ${100 + hipWidth / 2 - 5},480
    L ${100 + hipWidth / 2},320
    C ${100 + hipWidth / 2},280 ${100 + hipWidth / 2},235 ${100 + waistWidth / 2},225 Z
  `;
}

function getGarmentPath(garment: Garment, user: UserBodyData) {
  const bustWidth = (user.bust / 100) * 85;
  const waistWidth = (user.waist / 100) * 75;
  const hipWidth = (user.hip / 100) * 100;
  
  // Drape simulation based on fabric properties
  const drapeFactor = garment.fabric.drape * 20;

  switch (garment.category) {
    case 'dress':
      return `
        M ${100 - bustWidth / 2},130 
        C ${100 - bustWidth / 2},130 ${100 - bustWidth / 2 - 10},130 ${100 - bustWidth / 2 - 10},150 
        L ${100 - hipWidth / 2 - drapeFactor},420 
        C 100,${420 + drapeFactor} 100,${420 + drapeFactor} ${100 + hipWidth / 2 + drapeFactor},420 
        L ${100 + bustWidth / 2 + 10},150 
        C ${100 + bustWidth / 2 + 10},130 ${100 + bustWidth / 2},130 ${100 + bustWidth / 2},130 Z
      `;
    case 'top':
      return `
        M ${100 - bustWidth / 2},130 
        C ${100 - bustWidth / 2 - 5},130 ${100 - bustWidth / 2 - 15},140 ${100 - bustWidth / 2 - 10},240 
        C 100,250 100,250 ${100 + bustWidth / 2 + 10},240 
        C ${100 + bustWidth / 2 + 15},140 ${100 + bustWidth / 2 + 5},130 ${100 + bustWidth / 2},130 Z
      `;
    case 'bottom':
      return `
        M ${100 - waistWidth / 2 - 5},220 
        L ${100 + waistWidth / 2 + 5},220 
        L ${100 + hipWidth / 2},470 
        L ${100 + 10},470 
        L 100,280 
        L ${100 - 10},470 
        L ${100 - hipWidth / 2},470 Z
      `;
    default:
      return "";
  }
}
