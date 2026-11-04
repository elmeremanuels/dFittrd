import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { Heart, X, Bookmark, ThumbsDown, User, ShoppingBag, BarChart2 } from 'lucide-react';
import { useAppContext } from '../context';
import { MOCK_GARMENTS } from '../constants';
import { Garment } from '../types';
import Avatar from './Avatar';
import TasteRadial from './TasteRadial';
import { useFitEngine } from '../hooks/useFitEngine';

export default function SwipeDeck() {
  const { user, addToWardrobe, taste, setTaste } = useAppContext();
  const { calculateFit } = useFitEngine();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [fitData, setFitData] = useState<any>(null);
  const [showTaste, setShowTaste] = useState(false);

  const currentGarment = MOCK_GARMENTS[currentIndex % MOCK_GARMENTS.length];

  useEffect(() => {
    if (user && currentGarment) {
      setIsLoading(true);
      const timer = setTimeout(() => {
        const fit = calculateFit(currentGarment, user);
        setFitData(fit);
        setIsLoading(false);
      }, 800); // Simulate rendering/fit calculation
      return () => clearTimeout(timer);
    }
  }, [currentIndex, user]);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-30, 30]);
  const opacity = useTransform(x, [-200, -150, 0, 150, 200], [0.5, 1, 1, 1, 0.5]);

  const handleSwipe = (direction: 'left' | 'right' | 'up' | 'down') => {
    switch (direction) {
      case 'right': // Love
        addToWardrobe(currentGarment.id);
        break;
      case 'up': // Save
        addToWardrobe(currentGarment.id);
        break;
      case 'down': // Less like this
        // Update taste profile negatively (simplified)
        break;
    }
    setCurrentIndex(prev => prev + 1);
  };

  if (!user) return null;

  return (
    <div className="relative h-full flex flex-col pt-12 pb-8 overflow-hidden bg-cream">
      {/* Header */}
      <div className="px-8 flex justify-between items-center mb-4">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full bg-coral/20 flex items-center justify-center">
            <Heart className="w-4 h-4 text-coral" fill="currentColor" />
          </div>
          <span className="font-display text-xl font-medium tracking-tight">DressingRoom</span>
        </div>
        <div className="flex items-center space-x-2">
          <button 
            onClick={() => setShowTaste(true)}
            className="p-2 rounded-full bg-white shadow-sm border border-ink/5"
          >
            <BarChart2 className="w-5 h-5 text-ink/60" />
          </button>
          <button className="p-2 rounded-full bg-white shadow-sm border border-ink/5">
            <User className="w-5 h-5 text-ink/60" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showTaste && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-sm flex items-center justify-center p-8"
            onClick={() => setShowTaste(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-sm bg-cream rounded-[3rem] p-8 shadow-2xl relative"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowTaste(false)}
                className="absolute top-6 right-6 w-10 h-10 rounded-full bg-ink/5 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
              <h2 className="text-3xl font-display font-medium mb-2 pr-12 leading-tight">Your Style DNA</h2>
              <p className="text-sm text-ink/40 mb-8">Refined by your love/pass signals across 32 data points.</p>
              
              <TasteRadial profile={taste} />

              <div className="mt-8 space-y-4">
                <div className="flex justify-between items-center p-4 bg-white rounded-2xl border border-ink/5">
                   <div className="flex items-center space-x-3">
                     <div className="w-2 h-10 bg-coral rounded-full" />
                     <div>
                       <p className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Primary Archetype</p>
                       <p className="text-sm font-medium">Modern Minimalist</p>
                     </div>
                   </div>
                   <div className="text-right">
                     <p className="text-xl font-display">84%</p>
                   </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Mirror Area */}
      <div className="flex-1 px-4 relative flex items-center justify-center">
        <AnimatePresence>
          <motion.div
            key={currentIndex}
            style={{ x, y, rotate, opacity }}
            drag
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            onDragEnd={(_, info) => {
              const THRESHOLD = 100;
              if (info.offset.x > THRESHOLD) handleSwipe('right');
              else if (info.offset.x < -THRESHOLD) handleSwipe('left');
              else if (info.offset.y < -THRESHOLD) handleSwipe('up');
              else if (info.offset.y > THRESHOLD) handleSwipe('down');
            }}
            className="w-full max-w-[340px] aspect-[1/1.6] mirror-frame border-[8px] cursor-grab active:cursor-grabbing shadow-2xl relative"
          >
            <Avatar user={user} garment={currentGarment} isLoading={isLoading} />
            
            {/* Fit Indicator */}
            {fitData && !isLoading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-6 left-6 right-6 p-4 glass-panel rounded-2xl flex items-center justify-between"
              >
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-1">Recommended Size</h4>
                  <p className="text-lg font-display font-medium text-coral">{fitData.recommendedSize}</p>
                </div>
                <div className="text-right">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-ink/40 mb-1">Fit Score</h4>
                  <div className="text-lg font-display font-medium">{Math.round(fitData.score * 100)}%</div>
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Swipe Guides */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between items-center py-20">
          <div className="flex flex-col items-center text-ink/20 animate-pulse">
            <Bookmark className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Save</span>
          </div>
          <div className="w-full flex justify-between px-12 items-center text-ink/20 animate-pulse">
             <div className="flex flex-col items-center">
              <X className="w-6 h-6 mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-tighter">Pass</span>
            </div>
             <div className="flex flex-col items-center">
              <Heart className="w-6 h-6 mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-tighter">Love</span>
            </div>
          </div>
          <div className="flex flex-col items-center text-ink/20 animate-pulse">
            <ThumbsDown className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Less Like</span>
          </div>
        </div>
      </div>

      {/* Garment Details */}
      <div className="mt-4 px-8 pb-48 flex justify-between items-end relative z-30">
        <div className="max-w-[180px]">
          <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-coral/60">{currentGarment.brand}</span>
          <h3 className="text-xl font-display font-medium leading-tight mt-1 truncate">{currentGarment.name}</h3>
          <p className="text-ink/40 text-[10px] font-medium uppercase tracking-wider mt-1">{currentGarment.fabric.primary} · {currentGarment.fabric.weightGsm}gsm</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-display font-medium">€{currentGarment.priceEur}</p>
          <button className="mt-2 flex items-center space-x-1 text-[10px] font-bold uppercase tracking-widest text-ink/40 hover:text-ink transition-colors">
            <ShoppingBag className="w-3 h-3" />
            <span>Shop</span>
          </button>
        </div>
      </div>

      {/* Action Ring (Floating Buttons) */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center space-x-6 z-40">
        {[
          { icon: X, color: 'bg-white text-ink/40', action: () => handleSwipe('left') },
          { icon: Heart, color: 'bg-coral text-white', action: () => handleSwipe('right'), large: true },
          { icon: Bookmark, color: 'bg-white text-ink/40', action: () => handleSwipe('up') }
        ].map((btn, i) => (
          <button
            key={i}
            onClick={btn.action}
            className={`rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-95 border border-ink/5 ${btn.large ? 'w-20 h-20' : 'w-14 h-14'} ${btn.color} hover:shadow-coral/20`}
          >
            <btn.icon className={btn.large ? 'w-10 h-10' : 'w-6 h-6'} />
          </button>
        ))}
      </div>
    </div>
  );
}
