import React, { createContext, useContext, useState, ReactNode } from 'react';
import { UserBodyData, TasteProfile } from './types';

interface AppContextType {
  user: UserBodyData | null;
  setUser: (user: UserBodyData) => void;
  taste: TasteProfile;
  setTaste: (taste: TasteProfile) => void;
  wardrobe: string[];
  addToWardrobe: (id: string) => void;
  isOnboarded: boolean;
  setIsOnboarded: (val: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserBodyData | null>(null);
  const [taste, setTaste] = useState<TasteProfile>({
    bohemian: 0.5,
    minimal: 0.5,
    classic: 0.5,
    avantGarde: 0.5,
    sporty: 0.5,
  });
  const [wardrobe, setWardrobe] = useState<string[]>([]);
  const [isOnboarded, setIsOnboarded] = useState(false);

  const addToWardrobe = (id: string) => {
    setWardrobe(prev => [...new Set([...prev, id])]);
  };

  return (
    <AppContext.Provider value={{ 
      user, setUser, taste, setTaste, wardrobe, addToWardrobe, 
      isOnboarded, setIsOnboarded 
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
}
