/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useAppContext } from './context';
import Onboarding from './components/Onboarding';
import SwipeDeck from './components/SwipeDeck';
import MerchantConsole from './components/MerchantConsole';
import { useState } from 'react';
import { LayoutDashboard, ShoppingCart, User } from 'lucide-react';

function AppContent() {
  const { isOnboarded } = useAppContext();
  const [view, setView] = useState<'app' | 'merchant'>('app');

  if (!isOnboarded) {
    return <Onboarding />;
  }

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-cream overflow-hidden">
      {/* View Switcher (For Prototype visibility) */}
      <div className="fixed top-4 left-4 z-[60] flex bg-white/50 backdrop-blur rounded-full p-1 border border-ink/5 shadow-sm">
        <button 
          onClick={() => setView('app')}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${view === 'app' ? 'bg-ink text-white' : 'text-ink/40'}`}
        >
          Customer
        </button>
        <button 
          onClick={() => setView('merchant')}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${view === 'merchant' ? 'bg-ink text-white' : 'text-ink/40'}`}
        >
          Merchant
        </button>
      </div>

      {view === 'app' ? (
        <main className="flex-1 h-full max-w-md mx-auto relative bg-white shadow-2xl shadow-ink/10 overflow-hidden">
          <SwipeDeck />
          
          {/* Navigation Bar */}
          <nav className="absolute bottom-0 left-0 right-0 h-20 bg-white/90 backdrop-blur-xl border-t border-ink/5 px-10 flex items-center justify-between pb-4 z-50">
             <button className="text-coral">
               <div className="p-2 rounded-full bg-coral/10">
                 <ShoppingCart className="w-5 h-5" />
               </div>
             </button>
             <button className="text-ink/20">
               <div className="p-2">
                 <LayoutDashboard className="w-5 h-5" />
               </div>
             </button>
             <button className="text-ink/20">
               <div className="p-2">
                 <User className="w-5 h-5" />
               </div>
             </button>
          </nav>
        </main>
      ) : (
        <main className="flex-1 overflow-y-auto">
          <MerchantConsole />
        </main>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
