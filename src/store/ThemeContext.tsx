/**
 * Theme System
 *
 * 5 theme options: Dark (default), Matrix, Paper, Midnight, Mono
 * Persisted to localStorage, applied via CSS custom properties.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemeName = 'dark' | 'matrix' | 'paper' | 'midnight' | 'mono';

interface ThemeConfig {
  name: ThemeName;
  label: string;
  description: string;
}

export const THEMES: ThemeConfig[] = [
  { name: 'dark', label: 'Dark', description: 'Modern terminal' },
  { name: 'matrix', label: 'Matrix', description: 'Hacker aesthetic' },
  { name: 'paper', label: 'Paper', description: 'Warm, literary' },
  { name: 'midnight', label: 'Midnight', description: 'Deep blue dark' },
  { name: 'mono', label: 'Mono', description: 'Stark minimalist' },
];

const STORAGE_KEY = 'meridian-theme';
const VALID_THEMES: ThemeName[] = ['dark', 'matrix', 'paper', 'midnight', 'mono'];

function isValidTheme(value: unknown): value is ThemeName {
  return typeof value === 'string' && VALID_THEMES.includes(value as ThemeName);
}

interface ThemeContextType {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isValidTheme(stored) ? stored : 'dark';
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
