/**
 * Theme.
 *
 * One design in two lightnesses, plus following the OS. The five-palette
 * picker that used to live here (matrix, midnight, mono) was five different
 * designs wearing one layout; what replaced it is a single set of OKLCH tokens
 * whose day and night blocks differ by lightness, so there is one design to
 * keep coherent instead of five to keep in step.
 *
 * The preference is stored; the *resolved* value is what reaches the document.
 * `system` is resolved here rather than in CSS so that each palette is written
 * exactly once in index.css — a media query would need a second copy of the
 * night block, and two copies drift.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getMeta, setMeta } from '../lib/db';

/** What the owner chose. */
export type ThemePreference = 'night' | 'day' | 'system';

/** What the document is actually wearing. */
type Resolved = 'night' | 'day';

export const THEMES: { name: ThemePreference; label: string }[] = [
  { name: 'night', label: 'night' },
  { name: 'day', label: 'day' },
  { name: 'system', label: 'system' },
];

const NAMES = THEMES.map(t => t.name);

/**
 * Devices carry a theme chosen before this existed. A stored value is mapped
 * rather than discarded — the three dark palettes land on night, the two light
 * ones on day — so nobody re-picks a theme because the names changed. Anything
 * unrecognised falls through to following the OS, which is the safest guess
 * available about a device nobody has told us anything about.
 */
const LEGACY: Record<string, ThemePreference> = {
  dark: 'night',
  matrix: 'night',
  midnight: 'night',
  paper: 'day',
  mono: 'day',
};

function readPreference(value: unknown): ThemePreference {
  if (typeof value !== 'string') return 'system';
  if ((NAMES as string[]).includes(value)) return value as ThemePreference;
  return LEGACY[value] ?? 'system';
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * The installed app's status bar reads `theme-color`, and index.html declares
 * one per OS scheme. Those are right until the owner picks a side the OS
 * disagrees with, so the resolved palette overwrites them — the two literals
 * are the measured backgrounds of the two blocks in index.css.
 */
const BAR: Record<Resolved, string> = { night: '#0d0b08', day: '#f6f3ec' };

function paintStatusBar(resolved: Resolved): void {
  for (const tag of document.querySelectorAll('meta[name="theme-color"]')) {
    tag.setAttribute('content', BAR[resolved]);
    tag.removeAttribute('media');
  }
}

interface ThemeContextType {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Null until the stored preference has been read. The store is asynchronous,
  // so rendering before the answer arrives would paint one palette and then
  // swap it. Behind this gate index.css paints its two-property holding colour,
  // which follows the OS — the best guess available before the answer lands.
  const [theme, setThemeState] = useState<ThemePreference | null>(null);

  useEffect(() => {
    let live = true;
    const settle = (value: unknown) => {
      if (live) setThemeState(readPreference(value));
    };
    // A store that cannot be read is not a reason to show nothing at all.
    getMeta<unknown>('theme').then(settle, () => settle(null));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (theme === null) return;

    const apply = (resolved: Resolved) => {
      document.documentElement.setAttribute('data-theme', resolved);
      paintStatusBar(resolved);
    };

    apply(theme === 'system' ? (prefersDark() ? 'night' : 'day') : theme);

    // The applied theme is what matters; failing to remember it for next time
    // is not worth interrupting the owner over.
    void setMeta('theme', theme).catch(() => undefined);

    if (theme !== 'system') return;
    // Only `system` listens: an explicit choice must not move when the OS does.
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = (e: MediaQueryListEvent) => apply(e.matches ? 'night' : 'day');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => setThemeState(next), []);

  if (theme === null) return null;

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
