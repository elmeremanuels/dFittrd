import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, ChevronRight, Ruler, Sparkles, Heart } from 'lucide-react';
import { useAppContext } from '../context';
import { UserBodyData } from '../types';

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const { setUser, setIsOnboarded } = useAppContext();
  const [formData, setFormData] = useState<UserBodyData>({
    height: 168,
    weight: 62,
    bust: 88,
    waist: 70,
    hip: 96,
    skinTone: '#E4B692',
    hairColor: '#4A3728',
  });

  const [isFaceCaptured, setIsFaceCaptured] = useState(false);
  const [isBodyScanDone, setIsBodyScanDone] = useState(false);

  const next = () => setStep(s => s + 1);

  const complete = () => {
    setUser(formData);
    setIsOnboarded(true);
  };

  const steps = [
    {
      title: "Welcome to your DressingRoom",
      subtitle: "Let's create an avatar that truly reflects your unique proportions.",
      content: (
        <div className="flex flex-col items-center justify-center space-y-8 py-12">
          <div className="w-24 h-24 bg-coral rounded-full flex items-center justify-center shadow-lg shadow-coral/20 animate-float">
            <Sparkles className="text-white w-10 h-10" />
          </div>
          <p className="text-center text-ink/60 max-w-[240px]">
            Realistic fit, personalized style, total privacy.
          </p>
        </div>
      )
    },
    {
      title: "Measurements",
      subtitle: "Manual inputs sharpen the accuracy of our fit engine.",
      content: (
        <div className="space-y-6 py-6 overflow-y-auto max-h-[400px] px-2">
          {['height', 'weight', 'bust', 'waist', 'hip'].map((key) => (
            <div key={key} className="space-y-1">
              <div className="flex justify-between items-center px-1">
                <label className="text-sm font-medium uppercase tracking-wider text-ink/40">{key}</label>
                <span className="font-serif text-lg">{formData[key as keyof UserBodyData]} {key === 'weight' ? 'kg' : 'cm'}</span>
              </div>
              <input 
                type="range" 
                min={key === 'height' ? 140 : 40} 
                max={key === 'height' ? 220 : 180}
                value={formData[key as keyof UserBodyData] as number}
                onChange={(e) => setFormData({...formData, [key]: parseInt(e.target.value)})}
                className="w-full h-1 bg-ink/10 rounded-lg appearance-none cursor-pointer accent-coral"
              />
            </div>
          ))}
        </div>
      )
    },
    {
       title: "Real Scan",
       subtitle: "Capture your face and body for a photoreal identity tile.",
       content: (
         <div className="space-y-6 py-8">
           <div className="grid grid-cols-2 gap-4">
             <button 
               onClick={() => setIsFaceCaptured(true)}
               className={`aspect-square rounded-3xl border flex flex-col items-center justify-center space-y-2 transition-all group ${isFaceCaptured ? 'bg-coral/10 border-coral' : 'bg-white border-ink/5 hover:bg-coral/5'}`}
             >
               <div className={`p-3 rounded-full ${isFaceCaptured ? 'bg-coral text-white' : 'bg-cream text-ink group-hover:text-coral'}`}>
                 <Camera className="w-6 h-6" />
               </div>
               <span className={`text-xs font-medium ${isFaceCaptured ? 'text-coral' : 'text-ink'}`}>
                 {isFaceCaptured ? 'Face Captured' : 'Capture Face'}
               </span>
             </button>
             <button 
               onClick={() => setIsBodyScanDone(true)}
               className={`aspect-square rounded-3xl border flex flex-col items-center justify-center space-y-2 transition-all group ${isBodyScanDone ? 'bg-coral/10 border-coral' : 'bg-white border-ink/5 hover:bg-coral/5'}`}
             >
               <div className={`p-3 rounded-full ${isBodyScanDone ? 'bg-coral text-white' : 'bg-cream text-ink group-hover:text-coral'}`}>
                 <Ruler className="w-6 h-6" />
               </div>
               <span className={`text-xs font-medium ${isBodyScanDone ? 'text-coral' : 'text-ink'}`}>
                 {isBodyScanDone ? 'Scan Ready' : 'Start Body Scan'}
               </span>
             </button>
           </div>
           <div className="p-4 rounded-2xl bg-ink/5 text-[10px] leading-relaxed text-ink/40">
             <p className="font-bold uppercase mb-1">Privacy Guarantee:</p>
             Raw photos and video never leave the device. We only store a fit signature (numeric body vector).
           </div>
         </div>
       )
    },
    {
      title: "Style Vibe",
      subtitle: "Select the aesthetics that resonate most with your mood.",
      content: (
        <div className="grid grid-cols-2 gap-3 py-6">
          {['Bohemian', 'Minimal', 'Classic', 'Avant-Garde', 'Sporty', 'Eclectic'].map((vibe) => (
            <button 
              key={vibe}
              className="p-4 rounded-2xl border border-ink/5 text-sm font-medium hover:bg-coral hover:text-white transition-all text-center"
            >
              {vibe}
            </button>
          ))}
        </div>
      )
    }
  ];

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 z-50 bg-cream p-8 flex flex-col justify-between">
      <div className="mt-12 space-y-1 text-center">
        <motion.div 
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-1"
        >
          <h2 className="text-3xl font-display font-medium tracking-tight h-10">{currentStep.title}</h2>
          <p className="text-sm text-ink/50 px-8 leading-relaxed">{currentStep.subtitle}</p>
        </motion.div>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="w-full"
          >
            {currentStep.content}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="space-y-6">
        <div className="flex justify-center space-x-2">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 rounded-full transition-all duration-500 ${i === step ? 'w-8 bg-coral' : 'w-2 bg-ink/10'}`} />
          ))}
        </div>
        
        <button 
          onClick={step < steps.length - 1 ? next : complete}
          className="w-full py-4 bg-ink text-white rounded-full font-medium flex items-center justify-center space-x-2 hover:bg-ink/90 active:scale-95 transition-all shadow-xl shadow-ink/20"
        >
          <span>{step < steps.length - 1 ? 'Next' : 'Enter DressingRoom'}</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
