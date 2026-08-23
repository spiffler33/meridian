/**
 * Theme System
 *
 * 5 theme options: Dark (default), Matrix, Paper, Midnight, Mono
 * Persisted to the IndexedDB `meta` store, applied via CSS custom properties.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMeta, setMeta } from '../lib/db';

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
  // Null until the stored theme has been read. The store is asynchronous, so
  // rendering before the answer arrives would paint one theme's colours and
  // then swap them. This gate covers the app's own chrome; the paint behind it
  // is the neutral holding palette on bare `:root` in index.css, which follows
  // the system canvas rather than committing to a theme. The read is one
  // IndexedDB get; nothing here waits on the network.
  const [theme, setThemeState] = useState<ThemeName | null>(null);

  useEffect(() => {
    let live = true;
    const settle = (value: unknown) => {
      if (live) setThemeState(isValidTheme(value) ? value : 'dark');
    };
    // A store that cannot be read is not a reason to show nothing at all.
    getMeta<unknown>('theme').then(settle, () => settle(null));
    return () => {
      live = false;
    };
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (theme === null) return;
    document.documentElement.setAttribute('data-theme', theme);
    // The applied theme is what matters; failing to remember it for next time
    // is not worth interrupting the owner over.
    void setMeta('theme', theme).catch(() => undefined);
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme);
  }, []);

  if (theme === null) return null;

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
