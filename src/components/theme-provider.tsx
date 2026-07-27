"use client";

import { createContext,ReactNode,useContext,useEffect,useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Always use dark theme
    document.documentElement.classList.add("dark");
    setMounted(true);
  }, []);

  const contextValue = { theme: "dark" as Theme, toggleTheme: () => {} };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    // Fallback to prevent crashes during SSR/hydration
    return { theme: "dark" as Theme, toggleTheme: () => {} };
  }
  return context;
}