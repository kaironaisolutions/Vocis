import React, { createContext, useContext, useState } from 'react';

interface SecurityContextType {
  isCompromised: boolean;
  setIsCompromised: (val: boolean) => void;
}

const SecurityContext = createContext<SecurityContextType>({
  isCompromised: false,
  setIsCompromised: () => {},
});

export function SecurityProvider({ children }: { children: React.ReactNode }) {
  const [isCompromised, setIsCompromised] = useState(false);
  return (
    <SecurityContext.Provider value={{ isCompromised, setIsCompromised }}>
      {children}
    </SecurityContext.Provider>
  );
}

export function useSecurity() {
  return useContext(SecurityContext);
}
